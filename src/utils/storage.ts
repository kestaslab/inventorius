import {
  Department,
  Room,
  User,
  InventoryItem,
  MovementRecord,
  WriteOffAct,
  AuditSession,
  AuthSettings,
  OrganizationSettings,
  formatRoomName,
} from '../types/inventory';
import {
  INITIAL_DEPARTMENTS,
  INITIAL_ROOMS,
  INITIAL_USERS,
  INITIAL_ITEMS,
  INITIAL_MOVEMENTS,
  INITIAL_WRITEOFF_ACTS,
  INITIAL_AUDIT_SESSION,
  INITIAL_AUTH_SETTINGS,
} from '../data/initialData';
import {
  AppDatabase,
  CURRENT_DB_VERSION,
  validateAndMigrateDatabase,
} from './databaseValidation';
import {
  DbMutation,
  applyDbMutation,
  getTouchedEntityKeys,
  getOperationReferencedKeys,
} from './dbOperations';
import { DEFAULT_ORGANIZATION_SETTINGS, cloneOrganizationSettings } from './organization';
import { resolveAssetClass } from './accountingUtils';
import { buildCsvContent, formatCsvMoney, formatCsvOptionalMoney } from './csvUtils';
import { getCurrentYearVilnius } from './dateUtils';

export type { AppDatabase } from './databaseValidation';
export type { DbMutation } from './dbOperations';

const STORAGE_KEYS = {
  DEPARTMENTS: 'school_inv_departments_v1',
  ROOMS: 'school_inv_rooms_v1',
  USERS: 'school_inv_users_v1',
  ITEMS: 'school_inv_items_v1',
  MOVEMENTS: 'school_inv_movements_v1',
  WRITEOFFS: 'school_inv_writeoffs_v1',
  AUDIT_SESSIONS: 'school_inv_audits_v1',
  ACTIVE_USER_ID: 'school_inv_active_user_v1',
  AUTH_SETTINGS: 'school_inv_auth_settings_v1',
  ORG_SETTINGS: 'school_inv_org_settings_v1',
  SERVER_REVISION: 'school_inv_server_revision_v1',
  PENDING_OPS: 'school_inv_pending_ops_v1',
  LOCAL_PREVIEW: 'school_inv_local_preview_v1',
};

export type SyncStatus =
  | 'loading'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict'
  | 'local_preview'
  | 'uninitialized';

export interface PendingOp {
  clientOpId: string;
  baseRevision: number;
  operation: DbMutation;
  createdAt: string;
  precedingClientOpIds?: string[];
  status?: 'pending' | 'needs_resolution';
  blockedReason?: string;
  blockedByOpId?: string;
}

export interface RejectedOpRecord {
  clientOpId: string;
  operation: DbMutation;
  errorMessage: string;
  statusCode: number;
  rejectedAt: string;
}

export interface SyncState {
  status: SyncStatus;
  revision: number;
  serverHasDb: boolean;
  lastSavedAt?: string;
  errorMessage?: string;
  pendingCount: number;
  blockedCount: number;
  memoryOnlyQueue?: boolean;
  localPreviewMode: boolean;
  storageWarning?: string;
  blockedOps?: PendingOp[];
  rejectedOps?: RejectedOpRecord[];
}

function isQuotaError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    );
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name?: unknown }).name);
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }
  return false;
}

function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): { ok: boolean; quotaExceeded?: boolean } {
  try {
    if (typeof localStorage === 'undefined') return { ok: false };
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn(`Naršyklės localStorage talpa viršyta įrašant „${key}“`);
      return { ok: false, quotaExceeded: true };
    }
    console.warn(`Klaida įrašant į localStorage („${key}“):`, err);
    return { ok: false };
  }
}

function safeRemoveLocalStorage(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function createOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPendingOpsFromStorage(): PendingOp[] {
  try {
    const raw = safeGetLocalStorage(STORAGE_KEYS.PENDING_OPS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readInitialServerRevision(): number {
  try {
    const raw = safeGetLocalStorage(STORAGE_KEYS.SERVER_REVISION);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function readInitialLocalPreview(): boolean {
  return safeGetLocalStorage(STORAGE_KEYS.LOCAL_PREVIEW) === 'true';
}

// Autoritetinga darbinės atminties būsena (veikia net kai localStorage meta klaidą ar yra pilna)
let memoryDb: AppDatabase | null = null;
let serverRevision: number = readInitialServerRevision();
let memoryPendingOps: PendingOp[] = readPendingOpsFromStorage();
let memoryRejectedOps: RejectedOpRecord[] = [];
let queueStorageWarning: string | undefined = undefined;
let cacheStorageWarning: string | undefined = undefined;

function composeStorageWarning(): string | undefined {
  if (queueStorageWarning && cacheStorageWarning) {
    return `${queueStorageWarning} ${cacheStorageWarning}`;
  }
  return queueStorageWarning || cacheStorageWarning;
}

function buildInitialSyncState(): SyncState {
  const sendableCount = memoryPendingOps.filter((o) => o.status !== 'needs_resolution').length;
  const blockedOps = memoryPendingOps.filter((o) => o.status === 'needs_resolution');
  const localPreview = readInitialLocalPreview();
  return {
    status: localPreview ? 'local_preview' : 'loading',
    revision: serverRevision,
    serverHasDb: serverRevision > 0,
    pendingCount: sendableCount,
    blockedCount: blockedOps.length,
    memoryOnlyQueue: false,
    localPreviewMode: localPreview,
    blockedOps: blockedOps.length > 0 ? blockedOps : undefined,
    rejectedOps: memoryRejectedOps.length > 0 ? memoryRejectedOps : undefined,
    storageWarning: composeStorageWarning(),
  };
}

let syncState: SyncState = buildInitialSyncState();

const syncListeners = new Set<(state: SyncState) => void>();
const dbUpdateListeners = new Set<(db: AppDatabase) => void>();

function notifySyncListeners() {
  const snapshot = {
    ...syncState,
    blockedOps: syncState.blockedOps ? [...syncState.blockedOps] : undefined,
    rejectedOps: syncState.rejectedOps ? [...syncState.rejectedOps] : undefined,
  };
  syncListeners.forEach((cb) => cb(snapshot));
}

function updateSyncState(patch: Partial<SyncState>) {
  syncState = { ...syncState, ...patch };
  notifySyncListeners();
}

function notifyDbListeners(db: AppDatabase) {
  dbUpdateListeners.forEach((cb) => cb(db));
}

function getPendingOps(): PendingOp[] {
  return [...memoryPendingOps];
}

function setPendingOps(ops: PendingOp[]): boolean {
  memoryPendingOps = [...ops];
  const res = safeSetLocalStorage(STORAGE_KEYS.PENDING_OPS, JSON.stringify(memoryPendingOps));

  const sendableCount = memoryPendingOps.filter((o) => o.status !== 'needs_resolution').length;
  const blockedOps = memoryPendingOps.filter((o) => o.status === 'needs_resolution');
  const hasAnyQueued = memoryPendingOps.length > 0;

  let memoryOnlyQueue = false;
  if (!res.ok && hasAnyQueued) {
    memoryOnlyQueue = true;
    queueStorageWarning =
      'Nepavyko įrašyti pakeitimų eilės į naršyklės saugyklą (localStorage). Pakeitimai laikomi tik darbinėje atmintyje – uždarius ar perkrovus puslapį prieš išsaugant serveryje, jie bus prarasti!';
  } else {
    memoryOnlyQueue = false;
    queueStorageWarning = undefined;
  }

  updateSyncState({
    pendingCount: sendableCount,
    blockedCount: blockedOps.length,
    blockedOps: blockedOps.length > 0 ? blockedOps : undefined,
    memoryOnlyQueue,
    storageWarning: composeStorageWarning(),
  });

  return res.ok;
}

function persistSnapshotToLocalCache(db: AppDatabase, isServerAuthoritative: boolean) {
  memoryDb = db;
  if (isServerAuthoritative && typeof db.revision === 'number') {
    serverRevision = db.revision;
    safeSetLocalStorage(STORAGE_KEYS.SERVER_REVISION, String(serverRevision));
  }

  const results = [
    safeSetLocalStorage(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(db.departments)),
    safeSetLocalStorage(STORAGE_KEYS.ROOMS, JSON.stringify(db.rooms)),
    safeSetLocalStorage(STORAGE_KEYS.USERS, JSON.stringify(db.users)),
    safeSetLocalStorage(STORAGE_KEYS.ITEMS, JSON.stringify(db.items)),
    safeSetLocalStorage(STORAGE_KEYS.MOVEMENTS, JSON.stringify(db.movements)),
    safeSetLocalStorage(STORAGE_KEYS.WRITEOFFS, JSON.stringify(db.writeOffActs)),
    safeSetLocalStorage(STORAGE_KEYS.AUDIT_SESSIONS, JSON.stringify(db.auditSessions)),
  ];
  if (db.authSettings) {
    results.push(safeSetLocalStorage(STORAGE_KEYS.AUTH_SETTINGS, JSON.stringify(db.authSettings)));
  }
  if (db.organizationSettings) {
    results.push(
      safeSetLocalStorage(STORAGE_KEYS.ORG_SETTINGS, JSON.stringify(db.organizationSettings))
    );
  } else {
    safeRemoveLocalStorage(STORAGE_KEYS.ORG_SETTINGS);
  }

  if (results.some((r) => !r.ok)) {
    cacheStorageWarning =
      'Naršyklės vietinė saugykla (localStorage) negalėjo išsaugoti visų duomenų kopijos – duomenys laikomi darbinėje atmintyje.';
  } else {
    cacheStorageWarning = undefined;
  }
  updateSyncState({ storageWarning: composeStorageWarning() });
}

function buildDemoDatabase(): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
    revision: 0,
    exportedAt: new Date().toISOString(),
    departments: INITIAL_DEPARTMENTS,
    rooms: INITIAL_ROOMS,
    users: INITIAL_USERS,
    items: INITIAL_ITEMS,
    movements: INITIAL_MOVEMENTS,
    writeOffActs: INITIAL_WRITEOFF_ACTS,
    auditSessions: [INITIAL_AUDIT_SESSION],
    authSettings: INITIAL_AUTH_SETTINGS,
    organizationSettings: DEFAULT_ORGANIZATION_SETTINGS,
  };
}

let activeQueuePromise: Promise<{ ok: boolean; error?: string; conflict?: boolean }> | null = null;

async function fetchAuthoritativeServerDbSafely(): Promise<AppDatabase | null> {
  try {
    const res = await fetch('/api/database');
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw) return null;
    const validation = validateAndMigrateDatabase(raw);
    if (!validation.ok) return null;
    return validation.data;
  } catch {
    return null;
  }
}

function replayActiveOpsOverServerDb(serverDb: AppDatabase, ops: PendingOp[]): AppDatabase {
  let acc = serverDb;
  for (const op of ops) {
    if (op.status === 'needs_resolution') continue;
    const applied = applyDbMutation(acc, op.operation);
    if (applied.ok) {
      acc = applied.database;
    }
  }
  return acc;
}

async function processMutationQueue(): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  if (activeQueuePromise) {
    return activeQueuePromise;
  }

  activeQueuePromise = (async () => {
    let confirmedServerWriteThisPass = false;
    let batchRejectionError: string | undefined = undefined;

    try {
      while (true) {
        const allOps = getPendingOps();
        const sendableOps = allOps.filter((o) => o.status !== 'needs_resolution');
        const blockedOps = allOps.filter((o) => o.status === 'needs_resolution');

        if (sendableOps.length === 0) {
          if (blockedOps.length > 0 || batchRejectionError || memoryRejectedOps.length > 0) {
            const finalErr =
              batchRejectionError ||
              syncState.errorMessage ||
              `Dalis operacijų reikalauja sprendimo (${blockedOps.length}).`;
            updateSyncState({
              status: 'error',
              errorMessage: finalErr,
              pendingCount: 0,
              blockedCount: blockedOps.length,
              blockedOps: blockedOps.length > 0 ? blockedOps : undefined,
              rejectedOps: memoryRejectedOps.length > 0 ? [...memoryRejectedOps] : undefined,
            });
            return { ok: false, error: finalErr };
          }

          if (syncState.localPreviewMode) {
            updateSyncState({ status: 'local_preview', pendingCount: 0, blockedCount: 0 });
            return { ok: true };
          }

          if (confirmedServerWriteThisPass) {
            updateSyncState({
              status: 'saved',
              errorMessage: undefined,
              pendingCount: 0,
              blockedCount: 0,
              memoryOnlyQueue: false,
            });
            return { ok: true };
          }

          // Be tikro serverio patvirtinimo šio siuntimo metu NIEKADA neperjungiame į „saved“ iš „saving“/„error“!
          if (syncState.status === 'saved') {
            return { ok: true };
          }
          return {
            ok: false,
            error:
              syncState.errorMessage ||
              'Nėra patvirtinto išsaugojimo serveryje (eilė buvo tuščia be patvirtinimo).',
          };
        }

        if (syncState.localPreviewMode) {
          updateSyncState({ status: 'local_preview' });
          return { ok: true };
        }

        const head = sendableOps[0];
        updateSyncState({
          status: 'saving',
          errorMessage: batchRejectionError,
          pendingCount: sendableOps.length,
          blockedCount: blockedOps.length,
        });

        let response: Response;
        try {
          response = await fetch('/api/mutate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseRevision: head.baseRevision > 0 ? head.baseRevision : serverRevision,
              clientOpId: head.clientOpId,
              operation: head.operation,
              ...(head.precedingClientOpIds && head.precedingClientOpIds.length > 0
                ? { precedingClientOpIds: head.precedingClientOpIds }
                : {}),
            }),
          });
        } catch {
          const netErr = syncState.memoryOnlyQueue
            ? 'Nepavyko išsaugoti: nėra ryšio su serveriu. Pakeitimai laikomi tik darbinėje atmintyje – neuždarykite puslapio ir paspauskite „Bandyti dar kartą“.'
            : 'Nepavyko išsaugoti: nėra ryšio su serveriu. Jūsų pakeitimai išsaugoti naršyklėje – paspauskite „Bandyti dar kartą“.';
          updateSyncState({
            status: 'error',
            pendingCount: sendableOps.length,
            blockedCount: blockedOps.length,
            errorMessage: netErr,
          });
          return {
            ok: false,
            error: netErr,
          };
        }

        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (response.ok && payload?.success && payload?.database) {
          confirmedServerWriteThisPass = true;
          const nextRevision =
            typeof payload.revision === 'number'
              ? payload.revision
              : payload.database.revision || serverRevision + 1;

          // Pašaliname TIK įvykdytą operaciją ir NIEKADA neperrašome kitų laukiančių operacijų baseRevision!
          const remaining = getPendingOps().filter((op) => op.clientOpId !== head.clientOpId);
          setPendingOps(remaining);

          const serverDb = payload.database as AppDatabase;
          const remainingSendable = remaining.filter((o) => o.status !== 'needs_resolution');
          const remainingBlocked = remaining.filter((o) => o.status === 'needs_resolution');

          // Atnaujiname serverio reviziją; jei dar liko nepriklausomų laukiančių operacijų, lokaliame vaizde jas pritaikome ant viršaus
          persistSnapshotToLocalCache(
            remainingSendable.length > 0
              ? replayActiveOpsOverServerDb(serverDb, remainingSendable)
              : serverDb,
            true
          );
          // Išsaugome tikrą serverio reviziją atskirai (serverDb.revision)
          serverRevision = nextRevision;
          safeSetLocalStorage(STORAGE_KEYS.SERVER_REVISION, String(serverRevision));

          updateSyncState({
            revision: nextRevision,
            serverHasDb: true,
            lastSavedAt: new Date().toISOString(),
            status:
              remainingSendable.length > 0
                ? 'saving'
                : remainingBlocked.length > 0 || batchRejectionError || memoryRejectedOps.length > 0
                ? 'error'
                : 'saved',
            errorMessage:
              remainingSendable.length === 0 &&
              remainingBlocked.length === 0 &&
              !batchRejectionError &&
              memoryRejectedOps.length === 0
                ? undefined
                : batchRejectionError || syncState.errorMessage,
          });
          notifyDbListeners(memoryDb || serverDb);
          continue;
        }

        if (response.status === 409) {
          const msg =
            payload?.error ||
            'Aptiktas duomenų konfliktas: šį įrašą ką tik pakeitė kitas naudotojas.';
          if (typeof payload?.currentRevision === 'number') {
            serverRevision = payload.currentRevision;
            safeSetLocalStorage(STORAGE_KEYS.SERVER_REVISION, String(serverRevision));
          }
          updateSyncState({
            status: 'conflict',
            revision: serverRevision,
            serverHasDb: serverRevision > 0,
            errorMessage: msg,
            pendingCount: sendableOps.length,
            blockedCount: blockedOps.length,
          });
          return { ok: false, error: msg, conflict: true };
        }

        if (response.status === 400 || response.status === 413 || response.status === 404) {
          // Pašaliname TIK atmestą operaciją, jos priklausomus veiksmus pažymime „needs_resolution“,
          // o visus kitus nepriklausomus teisingus pakeitimus IŠSAUGOME ir tęsiame eilę!
          const errMsg =
            payload?.error ||
            (response.status === 413
              ? 'Užklausa arba nuotrauka viršija serverio dydžio limitą.'
              : 'Serveris atmetė neteisingus duomenis.');

          memoryRejectedOps = [
            ...memoryRejectedOps,
            {
              clientOpId: head.clientOpId,
              operation: head.operation,
              errorMessage: errMsg,
              statusCode: response.status,
              rejectedAt: new Date().toISOString(),
            },
          ];

          const fetchedServerDb = await fetchAuthoritativeServerDbSafely();
          const refDb = fetchedServerDb || memoryDb || StorageService.getCurrentDatabaseSnapshot();
          const blockedKeys = new Set<string>(getTouchedEntityKeys(refDb, head.operation));

          const remainingAfterReject = getPendingOps()
            .filter((op) => op.clientOpId !== head.clientOpId)
            .map((op) => {
              if (op.status === 'needs_resolution') {
                for (const k of getTouchedEntityKeys(refDb, op.operation)) {
                  blockedKeys.add(k);
                }
                return op;
              }
              const refs = getOperationReferencedKeys(refDb, op.operation);
              const isDependent = refs.some((k) => blockedKeys.has(k));
              if (isDependent) {
                for (const k of getTouchedEntityKeys(refDb, op.operation)) {
                  blockedKeys.add(k);
                }
                return {
                  ...op,
                  status: 'needs_resolution' as const,
                  blockedByOpId: head.clientOpId,
                  blockedReason: `Priklauso nuo atmestos operacijos: ${errMsg}`,
                };
              }
              return op;
            });

          setPendingOps(remainingAfterReject);

          const nextSendable = remainingAfterReject.filter((o) => o.status !== 'needs_resolution');
          const nextBlocked = remainingAfterReject.filter((o) => o.status === 'needs_resolution');

          if (fetchedServerDb) {
            const reconstructed = replayActiveOpsOverServerDb(fetchedServerDb, nextSendable);
            persistSnapshotToLocalCache(reconstructed, true);
            notifyDbListeners(reconstructed);
          }

          batchRejectionError =
            nextBlocked.length > 0
              ? `${errMsg} Priklausomi pakeitimai (${nextBlocked.length}) išsaugoti ir pažymėti kaip reikalaujantys sprendimo.`
              : errMsg;

          updateSyncState({
            status: nextSendable.length > 0 ? 'saving' : 'error',
            errorMessage: batchRejectionError,
            pendingCount: nextSendable.length,
            blockedCount: nextBlocked.length,
            blockedOps: nextBlocked.length > 0 ? nextBlocked : undefined,
            rejectedOps: [...memoryRejectedOps],
          });
          // Tęsiame ciklą, kad nepriklausomi teisingi pakeitimai būtų išsiųsti į serverį!
          continue;
        }

        // Serverio klaida (500/502/503) – neištriname pakeitimų iš eilės!
        const serverErr =
          payload?.error ||
          `Serverio klaida (${response.status}). Pakeitimai neištrinti – paspauskite „Bandyti dar kartą“.`;
        updateSyncState({
          status: 'error',
          errorMessage: serverErr,
          pendingCount: sendableOps.length,
          blockedCount: blockedOps.length,
        });
        return { ok: false, error: serverErr };
      }
    } finally {
      activeQueuePromise = null;
    }
  })();

  return activeQueuePromise;
}

export const StorageService = {
  getSyncState(): SyncState {
    return { ...syncState };
  },

  subscribeSyncState(listener: (state: SyncState) => void): () => void {
    syncListeners.add(listener);
    listener({ ...syncState });
    return () => {
      syncListeners.delete(listener);
    };
  },

  subscribeDatabaseUpdated(listener: (db: AppDatabase) => void): () => void {
    dbUpdateListeners.add(listener);
    return () => {
      dbUpdateListeners.delete(listener);
    };
  },

  getCurrentDatabaseSnapshot(): AppDatabase {
    if (memoryDb) return memoryDb;
    return {
      version: CURRENT_DB_VERSION,
      revision: serverRevision,
      exportedAt: new Date().toISOString(),
      departments: this.getDepartments(),
      rooms: this.getRooms(),
      users: this.getUsers(),
      items: this.getItems(),
      movements: this.getMovements(),
      writeOffActs: this.getWriteOffActs(),
      auditSessions: this.getAuditSessions(),
      authSettings: this.getAuthSettings(),
      organizationSettings: this.getOrganizationSettings(),
    };
  },

  getDepartments(): Department[] {
    if (memoryDb) return memoryDb.departments;
    const raw = safeGetLocalStorage(STORAGE_KEYS.DEPARTMENTS);
    if (!raw) return INITIAL_DEPARTMENTS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_DEPARTMENTS;
    }
  },

  getRooms(): Room[] {
    if (memoryDb) return memoryDb.rooms;
    const raw = safeGetLocalStorage(STORAGE_KEYS.ROOMS);
    if (!raw) return INITIAL_ROOMS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_ROOMS;
    }
  },

  getUsers(): User[] {
    if (memoryDb) return memoryDb.users;
    const raw = safeGetLocalStorage(STORAGE_KEYS.USERS);
    if (!raw) return INITIAL_USERS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_USERS;
    }
  },

  getItems(): InventoryItem[] {
    if (memoryDb) return memoryDb.items;
    const raw = safeGetLocalStorage(STORAGE_KEYS.ITEMS);
    let items: InventoryItem[] = INITIAL_ITEMS;
    if (raw) {
      try {
        items = JSON.parse(raw);
      } catch {
        items = INITIAL_ITEMS;
      }
    }

    return items.map((item) => {
      const initialMatch = INITIAL_ITEMS.find((i) => i.id === item.id);
      let cat = item.category as any;
      if (cat === 'IT įranga') {
        if (initialMatch?.category && (initialMatch.category as string) !== 'IT įranga') {
          cat = initialMatch.category;
        } else if (
          item.specs?.computerType ||
          item.specs?.cpu ||
          item.name.toLowerCase().includes('kompiuter') ||
          item.name.toLowerCase().includes('thinkpad') ||
          item.name.toLowerCase().includes('serveris') ||
          item.name.toLowerCase().includes('ipad') ||
          item.name.toLowerCase().includes('planšet')
        ) {
          cat = 'Kompiuteriai';
        } else {
          cat = 'Kita IT įranga';
        }
      }

      let itemSpecs = item.specs || initialMatch?.specs;
      if (itemSpecs && (itemSpecs.computerType as any) === 'all_in_one') {
        itemSpecs = { ...itemSpecs, computerType: 'desktop' };
      }

      return {
        ...item,
        category: cat,
        assetClass: item.assetClass || (Number(item.purchasePrice) >= 750 ? 'long_term' : 'short_term'),
        fundingSource: item.fundingSource || 'school',
        specs: itemSpecs,
      };
    });
  },

  getMovements(): MovementRecord[] {
    if (memoryDb) return memoryDb.movements;
    const raw = safeGetLocalStorage(STORAGE_KEYS.MOVEMENTS);
    if (!raw) return INITIAL_MOVEMENTS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_MOVEMENTS;
    }
  },

  getWriteOffActs(): WriteOffAct[] {
    if (memoryDb) return memoryDb.writeOffActs;
    const raw = safeGetLocalStorage(STORAGE_KEYS.WRITEOFFS);
    if (!raw) return INITIAL_WRITEOFF_ACTS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_WRITEOFF_ACTS;
    }
  },

  getAuditSessions(): AuditSession[] {
    if (memoryDb) return memoryDb.auditSessions;
    const raw = safeGetLocalStorage(STORAGE_KEYS.AUDIT_SESSIONS);
    if (!raw) return [INITIAL_AUDIT_SESSION];
    try {
      return JSON.parse(raw);
    } catch {
      return [INITIAL_AUDIT_SESSION];
    }
  },

  getActiveUserId(): string | null {
    return safeGetLocalStorage(STORAGE_KEYS.ACTIVE_USER_ID);
  },

  setActiveUserId(id: string) {
    safeSetLocalStorage(STORAGE_KEYS.ACTIVE_USER_ID, id);
  },

  clearActiveUserId() {
    safeRemoveLocalStorage(STORAGE_KEYS.ACTIVE_USER_ID);
  },

  getAuthSettings(): AuthSettings {
    if (memoryDb?.authSettings) return memoryDb.authSettings;
    const raw = safeGetLocalStorage(STORAGE_KEYS.AUTH_SETTINGS);
    if (!raw) return INITIAL_AUTH_SETTINGS;
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_AUTH_SETTINGS;
    }
  },

  getOrganizationSettings(): OrganizationSettings | undefined {
    if (memoryDb) {
      return memoryDb.organizationSettings
        ? cloneOrganizationSettings(memoryDb.organizationSettings)
        : undefined;
    }
    const raw = safeGetLocalStorage(STORAGE_KEYS.ORG_SETTINGS);
    if (!raw) return undefined;
    try {
      return cloneOrganizationSettings(JSON.parse(raw));
    } catch {
      return undefined;
    }
  },

  getPendingOperationsSnapshot(): PendingOp[] {
    return getPendingOps();
  },

  /**
   * Įkelia duomenis iš serverio.
   * Pradinio įkėlimo metu NIEKADA nesiunčia naršyklės ar demonstracinių duomenų į serverį!
   */
  async loadFromServer(discardPendingOps = false): Promise<boolean> {
    if (syncState.localPreviewMode && !discardPendingOps) {
      updateSyncState({ status: 'local_preview' });
      return false;
    }

    if (discardPendingOps) {
      memoryRejectedOps = [];
      setPendingOps([]);
      updateSyncState({ rejectedOps: undefined, errorMessage: undefined });
    }

    updateSyncState({ status: 'loading', errorMessage: undefined });

    try {
      const res = await fetch('/api/database');
      if (!res.ok) {
        updateSyncState({
          status: 'error',
          errorMessage: `Nepavyko įkelti duomenų iš serverio (HTTP ${res.status}). Rodomi vietiniai talpyklos duomenys.`,
        });
        return false;
      }

      const raw = await res.json();
      if (!raw) {
        // Serveris dar neturi DB – NEIŠSIUNČIAME demonstracinių duomenų automatiškai!
        serverRevision = 0;
        safeSetLocalStorage(STORAGE_KEYS.SERVER_REVISION, '0');
        updateSyncState({
          status: 'uninitialized',
          revision: 0,
          serverHasDb: false,
          errorMessage:
            'Centrinė serverio duomenų bazė dar tuščia. Galite atkurti atsarginę kopiją arba inicijuoti bazę administratoriaus pulte.',
        });
        return false;
      }

      const validation = validateAndMigrateDatabase(raw);
      if (!validation.ok) {
        updateSyncState({
          status: 'error',
          errorMessage: `Serverio duomenų klaida: ${validation.error}`,
        });
        return false;
      }

      const pending = getPendingOps();
      const sendablePending = pending.filter((o) => o.status !== 'needs_resolution');
      if (sendablePending.length > 0 && !discardPendingOps) {
        // Turime neišsiųstų pakeitimų – išsaugome kiekvieno originalų baseRevision ir vykdome nuosekliai!
        const srvRev = validation.data.revision || 1;
        serverRevision = srvRev;
        safeSetLocalStorage(STORAGE_KEYS.SERVER_REVISION, String(serverRevision));
        const reconstructed = replayActiveOpsOverServerDb(validation.data, sendablePending);
        persistSnapshotToLocalCache(reconstructed, false);
        updateSyncState({
          revision: serverRevision,
          serverHasDb: true,
        });
        await processMutationQueue();
        return true;
      }

      persistSnapshotToLocalCache(validation.data, true);
      const blocked = pending.filter((o) => o.status === 'needs_resolution');
      updateSyncState({
        status: blocked.length > 0 || memoryRejectedOps.length > 0 ? 'error' : 'saved',
        revision: validation.data.revision || 1,
        serverHasDb: true,
        lastSavedAt: new Date().toISOString(),
        errorMessage:
          blocked.length > 0
            ? `Yra ${blocked.length} sprendimo reikalaujančių operacijų nuo ankstesnės klaidos.`
            : undefined,
      });
      notifyDbListeners(validation.data);
      return true;
    } catch (err) {
      console.warn('Nepavyko pasiekti /api/database:', err);
      updateSyncState({
        status: 'error',
        errorMessage:
          'Nepavyko prisijungti prie serverio – dirbama su vietine talpykla. Ryšiui grįžus pakeitimai nebus prarasti.',
      });
      return false;
    }
  },

  /**
   * Vykdo atominę operaciją: pirma patikrina ir pritaiko lokaliai, tada nuosekliai išsiunčia į serverį.
   */
  async executeMutation(
    operation: DbMutation
  ): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
    const current = this.getCurrentDatabaseSnapshot();
    const applied = applyDbMutation(current, operation);
    if (!applied.ok) {
      return { ok: false, error: applied.error };
    }

    if (syncState.localPreviewMode) {
      persistSnapshotToLocalCache(applied.database, false);
      notifyDbListeners(applied.database);
      updateSyncState({ status: 'local_preview' });
      return { ok: true };
    }

    if (syncState.status === 'loading') {
      return {
        ok: false,
        error: 'Palaukite, kol baigsis pradinis duomenų įkėlimas iš serverio.',
      };
    }

    if (syncState.status === 'conflict') {
      return {
        ok: false,
        conflict: true,
        error:
          'Yra neišspręstas duomenų konfliktas. Pirmiausia atnaujinkite duomenis iš serverio viršutinėje juostoje.',
      };
    }

    persistSnapshotToLocalCache(applied.database, false);
    notifyDbListeners(applied.database);

    const existingOps = getPendingOps();
    const newTouched = new Set(getTouchedEntityKeys(current, operation));
    const precedingClientOpIds = existingOps
      .filter(
        (p) =>
          p.status !== 'needs_resolution' &&
          getTouchedEntityKeys(current, p.operation).some((k) => newTouched.has(k))
      )
      .map((p) => p.clientOpId);

    // Kiekviena nauja operacija fiksuoja tikrą šiuo metu žinomą serverio reviziją!
    const nextPending: PendingOp[] = [
      ...existingOps,
      {
        clientOpId: createOpId(),
        baseRevision: serverRevision,
        operation,
        createdAt: new Date().toISOString(),
        ...(precedingClientOpIds.length > 0 ? { precedingClientOpIds } : {}),
        status: 'pending',
      },
    ];
    setPendingOps(nextPending);

    return processMutationQueue();
  },

  async retryPendingMutations(): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
    if (syncState.localPreviewMode) return { ok: true };
    return processMutationQueue();
  },

  async retryBlockedOperation(
    clientOpId: string
  ): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
    const nextOps = getPendingOps().map((op) =>
      op.clientOpId === clientOpId
        ? {
            ...op,
            status: 'pending' as const,
            blockedReason: undefined,
            blockedByOpId: undefined,
          }
        : op
    );
    setPendingOps(nextOps);
    return processMutationQueue();
  },

  dismissBlockedOperation(clientOpId: string): void {
    const nextOps = getPendingOps().filter((op) => op.clientOpId !== clientOpId);
    setPendingOps(nextOps);
    const remainingBlocked = nextOps.filter((o) => o.status === 'needs_resolution');
    const remainingSendable = nextOps.filter((o) => o.status !== 'needs_resolution');
    if (remainingBlocked.length === 0 && remainingSendable.length === 0 && memoryRejectedOps.length === 0) {
      updateSyncState({
        status: syncState.serverHasDb ? 'saved' : syncState.status,
        errorMessage: undefined,
      });
    }
  },

  clearRejectedOps(): void {
    memoryRejectedOps = [];
    const remaining = getPendingOps();
    const remainingBlocked = remaining.filter((o) => o.status === 'needs_resolution');
    const remainingSendable = remaining.filter((o) => o.status !== 'needs_resolution');
    updateSyncState({
      rejectedOps: undefined,
      errorMessage:
        remainingBlocked.length > 0
          ? `Yra ${remainingBlocked.length} sprendimo reikalaujančių operacijų.`
          : undefined,
      status:
        remainingBlocked.length === 0 && remainingSendable.length === 0 && syncState.serverHasDb
          ? 'saved'
          : syncState.status,
    });
  },

  async resolveConflictByReloadingServer(): Promise<boolean> {
    return this.loadFromServer(true);
  },

  resetForTests(): void {
    activeQueuePromise = null;
    memoryDb = null;
    serverRevision = readInitialServerRevision();
    memoryPendingOps = readPendingOpsFromStorage();
    memoryRejectedOps = [];
    queueStorageWarning = undefined;
    cacheStorageWarning = undefined;
    syncState = buildInitialSyncState();
  },

  /**
   * Įkelia suspaustą nuotrauką į atskirą serverio failų saugyklą.
   * Jei serveris nepasiekiamas, grąžina base64 su offlineFallback vėliavėle, kad pakeitimas nebūtų prarastas.
   */
  async uploadPhoto(
    dataUrl: string
  ): Promise<{ ok: true; url: string; offlineFallback?: boolean } | { ok: false; error: string }> {
    if (syncState.localPreviewMode) {
      return { ok: true, url: dataUrl };
    }

    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (res.ok && payload?.success && typeof payload.url === 'string') {
        return { ok: true, url: payload.url };
      }

      if (res.status === 413 || res.status === 400) {
        return {
          ok: false,
          error:
            payload?.error ||
            'Nuotrauka per didelė arba netinkamo formato. Pasirinkite mažesnį failą.',
        };
      }

      // Serverio klaida (5xx) – leidžiame išsaugoti eilėje, kad neprarastų nuotraukos
      return { ok: true, url: dataUrl, offlineFallback: true };
    } catch {
      return { ok: true, url: dataUrl, offlineFallback: true };
    }
  },

  /**
   * Eksportuoja pilną JSON atsarginę kopiją (iš serverio kartu su visomis nuotraukomis).
   */
  async exportFullBackupAsync(): Promise<string> {
    if (!syncState.localPreviewMode) {
      try {
        const res = await fetch('/api/database/backup');
        if (res.ok) {
          const data = await res.json();
          return JSON.stringify(data, null, 2);
        }
      } catch {
        // Fallback žemiau
      }
    }
    return this.exportFullBackup();
  },

  exportFullBackup(): string {
    const snap = this.getCurrentDatabaseSnapshot();
    const payload: AppDatabase = {
      ...snap,
      version: CURRENT_DB_VERSION,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },

  /**
   * Vientisas ir griežtai validuojamas JSON atsarginės kopijos importas.
   * Atmetus importą ankstesni duomenys (tiek serveryje, tiek naršyklėje) lieka 100 % nepakeisti.
   */
  async importFullBackup(
    jsonContent: string
  ): Promise<
    { ok: true; migrated: boolean; backupFile?: string; warnings?: string[] } | { ok: false; error: string }
  > {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      return {
        ok: false,
        error: 'Failas nėra galiojantis JSON dokumentas (sintaksės klaida). Ankstesni duomenys nepakeisti.',
      };
    }

    const validation = validateAndMigrateDatabase(parsed);
    if (!validation.ok) {
      return {
        ok: false,
        error: `${validation.error} Ankstesni duomenys liko nepakeisti.`,
      };
    }

    if (syncState.localPreviewMode) {
      persistSnapshotToLocalCache(validation.data, false);
      notifyDbListeners(validation.data);
      return {
        ok: true,
        migrated: validation.migrated,
        warnings: validation.warnings,
      };
    }

    updateSyncState({ status: 'saving', errorMessage: undefined });

    try {
      const res = await fetch('/api/database/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: syncState.serverHasDb ? serverRevision : undefined,
          database: validation.data,
          source: 'backup_import',
        }),
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok || !payload?.success || !payload?.database) {
        const errMsg =
          payload?.error ||
          (res.status === 413
            ? 'Importuojamas failas viršija serverio dydžio limitą.'
            : `Nepavyko importuoti į serverį (HTTP ${res.status}). Ankstesni duomenys nepakeisti.`);
        updateSyncState({
          status: res.status === 409 ? 'conflict' : 'error',
          errorMessage: errMsg,
        });
        return { ok: false, error: errMsg };
      }

      setPendingOps([]);
      const nextDb = payload.database as AppDatabase;
      persistSnapshotToLocalCache(nextDb, true);
      updateSyncState({
        status: 'saved',
        revision: payload.revision || nextDb.revision || 1,
        serverHasDb: true,
        lastSavedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      notifyDbListeners(nextDb);

      return {
        ok: true,
        migrated: Boolean(payload.migrated || validation.migrated),
        backupFile: payload.backupFile,
        warnings: Array.isArray(payload.warnings) ? payload.warnings : validation.warnings,
      };
    } catch {
      const msg =
        'Nepavyko prisijungti prie serverio importuojant kopiją. Ankstesni duomenys liko nepakeisti.';
      updateSyncState({ status: 'error', errorMessage: msg });
      return { ok: false, error: msg };
    }
  },

  /**
   * 1. Vietinė demonstracinių duomenų peržiūra – neliečia centrinės serverio duomenų bazės!
   */
  activateLocalDemoPreview(): void {
    const demoDb = buildDemoDatabase();
    safeSetLocalStorage(STORAGE_KEYS.LOCAL_PREVIEW, 'true');
    setPendingOps([]);
    persistSnapshotToLocalCache(demoDb, false);
    updateSyncState({
      status: 'local_preview',
      localPreviewMode: true,
      errorMessage: undefined,
    });
    notifyDbListeners(demoDb);
  },

  /**
   * Išjungia vietinę peržiūrą ir grįžta prie pagrindinių serverio duomenų.
   */
  async exitLocalDemoPreview(): Promise<boolean> {
    safeRemoveLocalStorage(STORAGE_KEYS.LOCAL_PREVIEW);
    memoryDb = null;
    updateSyncState({ localPreviewMode: false });
    return this.loadFromServer(true);
  },

  /**
   * 2. Centrinės serverio bazės pakeitimas pradiniais duomenimis (tik Admin, prieš tai padarant kopiją serveryje).
   */
  async resetCentralServerToDemo(): Promise<{ ok: true; backupFile?: string } | { ok: false; error: string }> {
    const demoDb = buildDemoDatabase();
    updateSyncState({ status: 'saving', errorMessage: undefined });

    try {
      const res = await fetch('/api/database/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: syncState.serverHasDb ? serverRevision : undefined,
          database: demoDb,
          source: 'demo_reset',
        }),
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok || !payload?.success || !payload?.database) {
        const errMsg =
          payload?.error || `Nepavyko atkurti centrinės bazės (HTTP ${res.status}).`;
        updateSyncState({
          status: res.status === 409 ? 'conflict' : 'error',
          errorMessage: errMsg,
        });
        return { ok: false, error: errMsg };
      }

      safeRemoveLocalStorage(STORAGE_KEYS.LOCAL_PREVIEW);
      setPendingOps([]);
      const nextDb = payload.database as AppDatabase;
      persistSnapshotToLocalCache(nextDb, true);
      updateSyncState({
        status: 'saved',
        localPreviewMode: false,
        revision: payload.revision || nextDb.revision || 1,
        serverHasDb: true,
        lastSavedAt: new Date().toISOString(),
        errorMessage: undefined,
      });
      notifyDbListeners(nextDb);

      return { ok: true, backupFile: payload.backupFile };
    } catch {
      const msg = 'Nepavyko prisijungti prie serverio atkuriant centrinę bazę.';
      updateSyncState({ status: 'error', errorMessage: msg });
      return { ok: false, error: msg };
    }
  },

  generateNextInventoryNumber(items: InventoryItem[]): string {
    const currentYear = getCurrentYearVilnius();
    const prefix = `TM-${currentYear}-`;
    const yearNumbers = items
      .map((i) => i.inventoryNumber)
      .filter((num) => num && num.startsWith(prefix))
      .map((num) => parseInt(num.replace(prefix, ''), 10))
      .filter((n) => !isNaN(n));

    const nextIndex = yearNumbers.length > 0 ? Math.max(...yearNumbers) + 1 : 1;
    return `${prefix}${nextIndex.toString().padStart(4, '0')}`;
  },

  exportToCSV(items: InventoryItem[], departments: Department[], rooms: Room[], users: User[]): string {
    const headers = [
      'Inventorinis numeris',
      'Pavadinimas',
      'Turto grupė (IMT/TMT)',
      'Turto kilmė (Panauda/Mokykla)',
      'Kategorija',
      'Serijos numeris',
      'Skyrius',
      'Kabinetas / Patalpa',
      'Atsakingas asmuo',
      'Įsigijimo data',
      'Įsigijimo kaina (€)',
      'Likutinė vertė (€)',
      'Būsena',
      'Būklė',
      'IT Įrenginio tipas',
      'Procesorius (CPU)',
      'RAM (GB)',
      'Diskas (Storage)',
      'Operacinė sistema (OS)',
      'MAC adresas',
      'Pastabos',
    ];

    const rows = items.map((item) => {
      const dept = departments.find((d) => d.id === item.departmentId)?.name || '';
      const room = rooms.find((r) => r.id === item.roomId);
      const roomStr = formatRoomName(room);
      const user = users.find((u) => u.id === item.responsibleUserId)?.fullName || '';

      const assetClassStr =
        resolveAssetClass(item) === 'long_term'
          ? 'Ilgalaikis (IMT ≥ 750 €)'
          : 'Trumpalaikis / Mažavertis (< 750 €)';

      const fundingStr =
        item.fundingSource === 'ministry'
          ? 'ŠMSM panauda'
          : item.fundingSource === 'municipality'
          ? 'Savivaldybės panauda'
          : item.fundingSource === 'project'
          ? 'ES / STEAM projektai'
          : item.fundingSource === 'donation'
          ? 'Kita'
          : 'Gimnazijos lėšos';

      const statusLt =
        item.status === 'active'
          ? 'Aktyvus'
          : item.status === 'in_repair'
          ? 'Remontuojamas'
          : item.status === 'to_writeoff'
          ? 'Teikiamas nurašyti'
          : 'Nurašytas';

      const conditionLt =
        item.condition === 'new'
          ? 'Nauja'
          : item.condition === 'good'
          ? 'Gera'
          : item.condition === 'fair'
          ? 'Patenkinama'
          : 'Prasta';

      const compType = item.specs?.computerType
        ? item.specs.computerType === 'laptop'
          ? 'Nešiojamas'
          : item.specs.computerType === 'desktop'
          ? 'Stacionarus'
          : item.specs.computerType === 'server'
          ? 'Serveris'
          : item.specs.computerType === 'tablet'
          ? 'Planšetė'
          : 'Monoblokas'
        : '';

      return [
        item.inventoryNumber,
        item.name,
        assetClassStr,
        fundingStr,
        item.category,
        item.serialNumber || '',
        dept,
        roomStr,
        user,
        item.acquisitionDate,
        formatCsvMoney(item.purchasePrice),
        formatCsvOptionalMoney(item.residualValue),
        statusLt,
        conditionLt,
        compType,
        item.specs?.cpu || '',
        item.specs?.ramGb ?? '',
        item.specs?.storage || '',
        item.specs?.os || '',
        item.specs?.macAddress || '',
        item.notes || '',
      ];
    });

    return buildCsvContent(headers, rows, ';');
  },
};
