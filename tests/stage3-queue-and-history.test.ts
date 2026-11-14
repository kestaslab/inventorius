import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
import { AppDatabase, CURRENT_DB_VERSION } from '../src/utils/databaseValidation.ts';
import { StorageService } from '../src/utils/storage.ts';
import { DbMutation } from '../src/utils/dbOperations.ts';
import {
  INITIAL_DEPARTMENTS,
  INITIAL_ROOMS,
  INITIAL_USERS,
  INITIAL_ITEMS,
  INITIAL_MOVEMENTS,
  INITIAL_WRITEOFF_ACTS,
  INITIAL_AUDIT_SESSION,
  INITIAL_AUTH_SETTINGS,
} from '../src/data/initialData.ts';
import { InventoryItem, MovementRecord, Room } from '../src/types/inventory.ts';

function buildFixtureDb(revision = 1): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
    revision,
    exportedAt: '2026-04-01T10:00:00.000Z',
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: structuredClone(INITIAL_WRITEOFF_ACTS),
    auditSessions: [structuredClone(INITIAL_AUDIT_SESSION)],
    authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
  };
}

interface MockStorageOptions {
  throwOnSetKeys?: string[];
  makeQuotaError?: boolean;
}

function installEnvironmentMocks(
  fetchImpl: typeof fetch,
  storageOpts: MockStorageOptions = {}
): {
  storageMap: Map<string, string>;
  restore: () => void;
} {
  const prevFetch = globalThis.fetch;
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storageMap = new Map<string, string>();
  const throwKeys = new Set(storageOpts.throwOnSetKeys ?? []);

  const mockStorage: Storage = {
    get length() {
      return storageMap.size;
    },
    clear() {
      storageMap.clear();
    },
    getItem(key: string) {
      return storageMap.has(key) ? storageMap.get(key)! : null;
    },
    key(index: number) {
      return Array.from(storageMap.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storageMap.delete(key);
    },
    setItem(key: string, value: string) {
      if (throwKeys.has(key) || throwKeys.has('*')) {
        if (storageOpts.makeQuotaError) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        throw new Error(`Mock localStorage write failure for ${key}`);
      }
      storageMap.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  globalThis.fetch = fetchImpl;
  StorageService.resetForTests();

  return {
    storageMap,
    restore() {
      globalThis.fetch = prevFetch;
      if (prevLocalStorageDesc) {
        Object.defineProperty(globalThis, 'localStorage', prevLocalStorageDesc);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
      StorageService.resetForTests();
    },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function withTempServer(
  run: (baseUrl: string) => Promise<void>
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage3-q-'));
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Issue 1: Rejecting one op (400/404/413) preserves independent valid ops and marks dependent ops as needs_resolution', async () => {
  for (const rejectStatus of [400, 404, 413] as const) {
    let serverDb = buildFixtureDb(1);
    let online = false;
    const sentOpIds: string[] = [];
    const serverAppliedOpIds: string[] = [];

    const badRoomId = `room-bad-${rejectStatus}`;
    const badItemId = `item-bad-${rejectStatus}`;
    const existingItem = structuredClone(serverDb.items[0]);
    const validUpdatedItem: InventoryItem = {
      ...existingItem,
      name: `${existingItem.name} (Nepriklausomas atnaujinimas ${rejectStatus})`,
    };

    const dept0Id = serverDb.departments[0].id;
    const roomInDept0 = serverDb.rooms.find((r) => r.departmentId === dept0Id) ?? serverDb.rooms[0];
    const user0Id = serverDb.users[0].id;

    const badRoom: Room = {
      id: badRoomId,
      departmentId: dept0Id,
      number: '999',
      name: 'Klaidingas kabinetas',
      floor: 1,
      defaultResponsiblePersonId: user0Id,
    };

    const dependentItem: InventoryItem = {
      ...structuredClone(serverDb.items[0]),
      id: badItemId,
      inventoryNumber: `TM-2026-9${rejectStatus}`,
      name: 'Daiktas priklausantis nuo atmesto kabineto',
      departmentId: dept0Id,
      roomId: badRoomId,
      responsibleUserId: user0Id,
    };

    const transitiveMovement: MovementRecord = {
      id: `mov-dep-${rejectStatus}`,
      itemId: badItemId,
      itemName: dependentItem.name,
      inventoryNumber: dependentItem.inventoryNumber,
      fromDepartmentId: dept0Id,
      fromRoomId: badRoomId,
      toDepartmentId: dept0Id,
      toRoomId: roomInDept0.id,
      fromUserId: user0Id,
      toUserId: user0Id,
      reason: 'Tranzityviai priklausomas perkėlimas',
      date: '2026-04-10',
      actNumber: `AKT-TEST-${rejectStatus}`,
    };

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/database' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(200, serverDb);
      }
      if (url === '/api/mutate' && init?.method === 'POST') {
        if (!online) {
          throw new Error('Network offline');
        }
        const body = JSON.parse(String(init.body)) as {
          clientOpId: string;
          operation: DbMutation;
        };
        sentOpIds.push(body.clientOpId);

        if (
          body.operation.type === 'SAVE_ROOM' &&
          body.operation.room.id === badRoomId
        ) {
          return jsonResponse(rejectStatus, {
            success: false,
            error: `Serveris atmetė kabinetą su kodu ${rejectStatus}`,
          });
        }

        if (
          body.operation.type === 'SAVE_ITEM' &&
          body.operation.item.id === validUpdatedItem.id
        ) {
          serverAppliedOpIds.push(body.clientOpId);
          serverDb = {
            ...serverDb,
            revision: (serverDb.revision ?? 1) + 1,
            items: serverDb.items.map((it) =>
              it.id === validUpdatedItem.id ? validUpdatedItem : it
            ),
          };
          return jsonResponse(200, {
            success: true,
            revision: serverDb.revision,
            database: serverDb,
          });
        }

        return jsonResponse(400, {
          success: false,
          error: `Netikėta operacija išsiųsta į serverį: ${body.operation.type}`,
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const env = installEnvironmentMocks(mockFetch);
    try {
      const loaded = await StorageService.loadFromServer();
      assert.equal(loaded, true);

      // Sukuriame eilę neprisijungus: Op1 (bus atmesta), Op2 (priklauso nuo Op1), Op3 (tranzityviai priklauso nuo Op2), Op4 (nepriklausoma)
      const r1 = await StorageService.executeMutation({ type: 'SAVE_ROOM', room: badRoom });
      assert.equal(r1.ok, false);
      const r2 = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: dependentItem });
      assert.equal(r2.ok, false);
      const r3 = await StorageService.executeMutation({ type: 'TRANSFER_ITEM', record: transitiveMovement });
      assert.equal(r3.ok, false);
      const r4 = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: validUpdatedItem });
      assert.equal(r4.ok, false);

      assert.equal(StorageService.getPendingOperationsSnapshot().length, 4);

      // Grąžiname ryšį – Op1 atmetama su rejectStatus, Op4 (nepriklausoma) privalo pasiekti serverį, o Op2 + Op3 išlieka kaip needs_resolution
      online = true;
      const flushRes = await StorageService.retryPendingMutations();
      assert.equal(flushRes.ok, false);

      // Nepriklausoma teisinga operacija privalo būti įvykdyta serveryje
      assert.equal(serverAppliedOpIds.length, 1);
      assert.equal(
        serverDb.items.find((i) => i.id === validUpdatedItem.id)?.name,
        validUpdatedItem.name
      );

      // Atmesta Op1 užfiksuota rejectedOps, o priklausomos Op2 ir Op3 IŠLIKUSIOS eilėje su status='needs_resolution'
      const sync = StorageService.getSyncState();
      assert.equal(sync.status, 'error');
      assert.equal(sync.pendingCount, 0);
      assert.equal(sync.blockedCount, 2);
      assert.equal(sync.rejectedOps?.length, 1);
      assert.equal(sync.rejectedOps?.[0]?.statusCode, rejectStatus);

      const remaining = StorageService.getPendingOperationsSnapshot();
      assert.equal(remaining.length, 2);
      assert.ok(remaining.every((op) => op.status === 'needs_resolution' && Boolean(op.blockedReason)));
      assert.deepEqual(
        remaining.map((op) => op.operation.type),
        ['SAVE_ITEM', 'TRANSFER_ITEM']
      );

      // Priklausomos operacijos neturėjo būti išsiųstos į serverį po pirmojo atmetimo
      assert.equal(sentOpIds.length, 2); // tik Op1 (atmesta) ir Op4 (įvykdyta)

      // Patikriname rankinį atsisakymą nuo blokuotų operacijų
      StorageService.dismissBlockedOperation(remaining[0].clientOpId);
      assert.equal(StorageService.getPendingOperationsSnapshot().length, 1);
    } finally {
      env.restore();
    }
  }
});

test('Issue 2: Preserving true baseRevision catches 409 conflicts on stale queued ops while merging disjoint edits cleanly', async () => {
  await withTempServer(async (baseUrl) => {
    const initialDb = buildFixtureDb(1);
    const seedRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: initialDb, source: 'backup_import' }),
    });
    assert.equal(seedRes.status, 200);

    const realFetch = globalThis.fetch;
    let clientOnline = true;
    const sentRequests: Array<{ baseRevision: number; clientOpId: string; opType: string; precedingClientOpIds?: string[] }> = [];

    const spyFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/')) {
        if (url === '/api/mutate' && init?.method === 'POST') {
          if (!clientOnline) {
            throw new Error('Offline simulated');
          }
          const parsed = JSON.parse(String(init.body));
          sentRequests.push({
            baseRevision: parsed.baseRevision,
            clientOpId: parsed.clientOpId,
            opType: parsed.operation?.type,
            precedingClientOpIds: parsed.precedingClientOpIds,
          });
        }
        return realFetch(`${baseUrl}${url}`, init);
      }
      return realFetch(input, init);
    };

    const env = installEnvironmentMocks(spyFetch);
    try {
      const loaded = await StorageService.loadFromServer();
      assert.equal(loaded, true);
      assert.equal(StorageService.getSyncState().revision, 1);

      // 1 naudotojas atsijungęs: eilėje kaupia pakeitimus A (item[0]) ir B (item[1]) pagal rev=1
      clientOnline = false;
      const itemAUpdated: InventoryItem = {
        ...StorageService.getItems()[0],
        notes: 'Naudotojo 1 pakeitimas A',
      };
      const itemBStaleEdit: InventoryItem = {
        ...StorageService.getItems()[1],
        notes: 'Naudotojo 1 pasenęs pakeitimas B',
      };

      const qA = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: itemAUpdated });
      const qB = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: itemBStaleEdit });
      assert.equal(qA.ok, false);
      assert.equal(qB.ok, false);

      const queuedBeforeFlush = StorageService.getPendingOperationsSnapshot();
      assert.equal(queuedBeforeFlush.length, 2);
      assert.equal(queuedBeforeFlush[0].baseRevision, 1);
      assert.equal(queuedBeforeFlush[1].baseRevision, 1);

      // Tuo metu 2 naudotojas serveryje atnaujina item[1] -> serverio revizija tampa 2
      const itemBConcurrentEdit: InventoryItem = {
        ...initialDb.items[1],
        notes: 'Naudotojo 2 naujesnis pakeitimas B',
      };
      const user2Res = await fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 1,
          clientOpId: 'user2-op-b',
          operation: { type: 'SAVE_ITEM', item: itemBConcurrentEdit },
        }),
      });
      assert.equal(user2Res.status, 200);

      // 1 naudotojas grįžta į tinklą ir siunčia eilę
      clientOnline = true;
      const flushRes = await StorageService.retryPendingMutations();
      assert.equal(flushRes.ok, false);
      assert.equal(flushRes.conflict, true);

      // Abu užklausimai PRIVALĖJO siųsti savo tikrąjį baseRevision=1 (OpB baseRevision negalėjo būti pakeltas iki 3!)
      assert.equal(sentRequests.length, 2);
      assert.equal(sentRequests[0].baseRevision, 1);
      assert.equal(sentRequests[1].baseRevision, 1);

      // Būsenoje fiksuotas 409 konfliktas, OpB liko eilėje, o serveryje išliko 2 naudotojo darbas
      assert.equal(StorageService.getSyncState().status, 'conflict');
      const remainingQueue = StorageService.getPendingOperationsSnapshot();
      assert.equal(remainingQueue.length, 1);
      assert.equal(remainingQueue[0].baseRevision, 1);

      const serverAfter = (await (await fetch(`${baseUrl}/api/database`)).json()) as AppDatabase;
      assert.equal(serverAfter.revision, 3);
      assert.equal(
        serverAfter.items.find((i) => i.id === itemAUpdated.id)?.notes,
        'Naudotojo 1 pakeitimas A'
      );
      assert.equal(
        serverAfter.items.find((i) => i.id === itemBConcurrentEdit.id)?.notes,
        'Naudotojo 2 naujesnis pakeitimas B'
      );

      // Išsprendžiame konfliktą perkraudami iš serverio ir patikriname, kad tas pats klientas neprisijungęs gali atlikti kelis nuoseklius pakeitimus tam pačiam daiktui + kitam daiktui
      await StorageService.resolveConflictByReloadingServer();
      sentRequests.length = 0;

      clientOnline = false;
      const revNow = StorageService.getSyncState().revision;
      assert.equal(revNow, 3);

      const item0Edit1: InventoryItem = {
        ...StorageService.getItems()[0],
        notes: 'Sekos pakeitimas 1',
      };
      const item0Edit2: InventoryItem = {
        ...StorageService.getItems()[0],
        notes: 'Sekos pakeitimas 2',
      };
      const item2Edit: InventoryItem = {
        ...StorageService.getItems()[2],
        notes: 'Nepriklausomas daiktas 3',
      };

      await StorageService.executeMutation({ type: 'SAVE_ITEM', item: item0Edit1 });
      await StorageService.executeMutation({ type: 'SAVE_ITEM', item: item0Edit2 });
      await StorageService.executeMutation({ type: 'SAVE_ITEM', item: item2Edit });

      // Kitam daiktui (items[1]) tuo metu kitas naudotojas atlieka pakeitimą -> rev=4
      await fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 3,
          clientOpId: 'user2-disjoint-op',
          operation: {
            type: 'SAVE_ITEM',
            item: { ...initialDb.items[1], notes: 'Konkuruojantis pakeitimas kitam daiktui' },
          },
        }),
      });

      clientOnline = true;
      const cleanMerge = await StorageService.retryPendingMutations();
      assert.equal(cleanMerge.ok, true);
      assert.equal(StorageService.getSyncState().status, 'saved');
      assert.equal(StorageService.getPendingOperationsSnapshot().length, 0);
      assert.equal(sentRequests.length, 3);
      assert.ok(sentRequests.every((r) => r.baseRevision === 3));
      assert.ok((sentRequests[1].precedingClientOpIds?.length ?? 0) === 1);
    } finally {
      env.restore();
    }
  });
});

test('Issue 3: Failing to persist queue in localStorage keeps authoritative memory queue, sends fetch, warns clearly, and never returns false saved', async () => {
  let serverDb = buildFixtureDb(1);
  let mutateShouldFail = true;
  let mutateFetchCount = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/database') {
      return jsonResponse(200, serverDb);
    }
    if (url === '/api/mutate' && init?.method === 'POST') {
      mutateFetchCount++;
      if (mutateShouldFail) {
        return jsonResponse(503, { success: false, error: 'Serveris laikinai nepasiekiamas' });
      }
      const body = JSON.parse(String(init.body)) as { operation: DbMutation };
      if (body.operation.type === 'SAVE_ITEM') {
        const updatedItem = body.operation.item;
        serverDb = {
          ...serverDb,
          revision: (serverDb.revision ?? 1) + 1,
          items: serverDb.items.map((it) => (it.id === updatedItem.id ? updatedItem : it)),
        };
      }
      return jsonResponse(200, {
        success: true,
        revision: serverDb.revision,
        database: serverDb,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  // localStorage.setItem meta QuotaExceededError įrašant PENDING_OPS
  const env = installEnvironmentMocks(mockFetch, {
    throwOnSetKeys: ['school_inv_pending_ops_v1'],
    makeQuotaError: true,
  });

  try {
    await StorageService.loadFromServer();
    const updatedItem: InventoryItem = {
      ...StorageService.getItems()[0],
      notes: 'Tik atmintyje laikomas pakeitimas',
    };

    // 1. Serveris gražina 503, o localStorage metė klaidą – anksčiau čia grįždavo ok=true ir status='saved'
    const res1 = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: updatedItem });
    assert.equal(mutateFetchCount, 1, 'Užklausa į /api/mutate privalėjo būti išsiųsta iš darbinės atminties');
    assert.equal(res1.ok, false);

    const stateAfterFail = StorageService.getSyncState();
    assert.equal(stateAfterFail.status, 'error');
    assert.notEqual(stateAfterFail.status, 'saved');
    assert.equal(stateAfterFail.pendingCount, 1);
    assert.equal(stateAfterFail.memoryOnlyQueue, true);
    assert.ok(stateAfterFail.storageWarning);
    assert.match(stateAfterFail.storageWarning!, /darbinėje atmintyje/i);
    assert.match(stateAfterFail.storageWarning!, /uždarius|perkrovus/i);
    assert.equal(StorageService.getPendingOperationsSnapshot().length, 1);

    // 2. Serveriui atsigavus, pakartotinis siuntimas iš darbinės atminties sėkmingai išsaugo
    mutateShouldFail = false;
    const res2 = await StorageService.retryPendingMutations();
    assert.equal(mutateFetchCount, 2);
    assert.equal(res2.ok, true);

    const stateAfterSuccess = StorageService.getSyncState();
    assert.equal(stateAfterSuccess.status, 'saved');
    assert.equal(stateAfterSuccess.pendingCount, 0);
    assert.equal(stateAfterSuccess.memoryOnlyQueue, false);
    assert.equal(StorageService.getPendingOperationsSnapshot().length, 0);
    assert.equal(serverDb.items[0].notes, 'Tik atmintyje laikomas pakeitimas');

    // 3. Tuščia eilė esant ne-'saved' būsenai negali grąžinti klaidingos sėkmės be serverio patvirtinimo
    // (imituojame klaidos būseną po nepavykusio užklausos bandymo be laukiančios eilės)
    mutateShouldFail = true;
    const failLoadEnv = await fetch; // tiesiogiai sukeliame loadFromServer klaidą pakeisdami globalThis.fetch
    void failLoadEnv;
    globalThis.fetch = async () => jsonResponse(500, { error: 'Server error' });
    await StorageService.loadFromServer();
    assert.equal(StorageService.getSyncState().status, 'error');
    const falseRetry = await StorageService.retryPendingMutations();
    assert.equal(falseRetry.ok, false);
    assert.notEqual(StorageService.getSyncState().status, 'saved');
  } finally {
    env.restore();
  }
});

test('History integrity: TRANSFER_AND_DELETE_USER and DELETE_USER preserve historical committeeChairman on completed audits', async () => {
  await withTempServer(async (baseUrl) => {
    const db = buildFixtureDb(1);
    const sourceUser = db.users.find((u) => u.role === 'teacher') ?? db.users[1];
    const targetUser = db.users.find((u) => u.id !== sourceUser.id && !u.isArchived)!;
    assert.ok(sourceUser && targetUser);

    const completedWithSnapshot = {
      ...structuredClone(INITIAL_AUDIT_SESSION),
      id: 'audit-completed-2025',
      year: 2025,
      title: '2025 m. užbaigta inventorizacija',
      status: 'completed' as const,
      committeeChairmanId: sourceUser.id,
      committeeChairman: `${sourceUser.fullName} (Istorinis pirmininkas)`,
    };
    const completedMissingSnapshot = {
      ...structuredClone(INITIAL_AUDIT_SESSION),
      id: 'audit-completed-2024',
      year: 2024,
      title: '2024 m. užbaigta inventorizacija',
      status: 'completed' as const,
      committeeChairmanId: sourceUser.id,
      committeeChairman: '',
    };
    const activeAudit = {
      ...structuredClone(INITIAL_AUDIT_SESSION),
      id: 'audit-active-2026',
      year: 2026,
      title: '2026 m. vykdoma inventorizacija',
      status: 'in_progress' as const,
      committeeChairmanId: sourceUser.id,
      committeeChairman: `${sourceUser.fullName} (Vykdomas pirmininkas)`,
    };

    db.auditSessions = [activeAudit, completedWithSnapshot, completedMissingSnapshot];

    // Priskiriame bent vieną daiktą sourceUser, kad TRANSFER_AND_DELETE_USER turėtų ką perduoti
    db.items[0] = { ...db.items[0], responsibleUserId: sourceUser.id };

    const seedRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: db, source: 'backup_import' }),
    });
    assert.equal(seedRes.status, 200);

    // 1. DELETE_USER turi būti blokuojamas, nes yra VYKDOMA inventorizacija ir priskirtas turtas
    const blockedDelete = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'del-blocked',
        operation: { type: 'DELETE_USER', userId: sourceUser.id },
      }),
    });
    assert.equal(blockedDelete.status, 400);

    // 2. TRANSFER_AND_DELETE_USER perleidžia aktyvią atsakomybę ir vykdomą inventorizaciją, bet NELIEČIA užbaigtų inventorizacijų istorinio pirmininko
    const transferDelete = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'transfer-del-1',
        operation: {
          type: 'TRANSFER_AND_DELETE_USER',
          userId: sourceUser.id,
          targetUserId: targetUser.id,
        },
      }),
    });
    assert.equal(transferDelete.status, 200);
    const payload = (await transferDelete.json()) as { database: AppDatabase; revision: number };
    const updatedDb = payload.database;

    assert.equal(updatedDb.users.some((u) => u.id === sourceUser.id), false);
    assert.equal(
      updatedDb.items.some((i) => i.responsibleUserId === sourceUser.id),
      false
    );

    const nextActive = updatedDb.auditSessions.find((s) => s.id === 'audit-active-2026')!;
    assert.equal(nextActive.committeeChairmanId, targetUser.id);
    assert.ok(nextActive.committeeChairman?.includes(targetUser.fullName));

    const nextCompleted2025 = updatedDb.auditSessions.find((s) => s.id === 'audit-completed-2025')!;
    assert.equal(nextCompleted2025.committeeChairmanId, sourceUser.id);
    assert.equal(nextCompleted2025.committeeChairman, `${sourceUser.fullName} (Istorinis pirmininkas)`);
    assert.equal(nextCompleted2025.committeeChairman?.includes(targetUser.fullName), false);

    const nextCompleted2024 = updatedDb.auditSessions.find((s) => s.id === 'audit-completed-2024')!;
    assert.ok(nextCompleted2024.committeeChairman?.includes(sourceUser.fullName));
    assert.equal(nextCompleted2024.committeeChairman?.includes(targetUser.fullName), false);

    // 3. DELETE_USER darbuotojui, kuris yra tik UŽBAIGTOS inventorizacijos pirmininkas (be turto ar vykdomų pareigų), privalo pavykti ir išsaugoti istoriją
    const cleanCompletedUserRes = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: payload.revision,
        clientOpId: 'save-extra-user',
        operation: {
          type: 'SAVE_USER',
          user: {
            id: 'user-retired-chair',
            fullName: 'Išėjęs Pirmininkas',
            email: 'isejes@mokykla.lt',
            role: 'teacher',
            roleTitle: 'Mokytojas metodininkas',
            departmentId: updatedDb.departments[0].id,
            isActive: true,
          },
        },
      }),
    });
    assert.equal(cleanCompletedUserRes.status, 200);
    const revAfterUser = (await cleanCompletedUserRes.json()).revision as number;

    const completedForRetired = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: revAfterUser,
        clientOpId: 'save-completed-audit',
        operation: {
          type: 'UPDATE_AUDIT_SESSION',
          session: {
            ...completedWithSnapshot,
            id: 'audit-completed-2023',
            year: 2023,
            title: '2023 m. archyvinė inventorizacija',
            committeeChairmanId: 'user-retired-chair',
            committeeChairman: '',
          },
        },
      }),
    });
    assert.equal(completedForRetired.status, 200);
    const revAfterAudit = (await completedForRetired.json()).revision as number;

    const deleteRetiredChair = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: revAfterAudit,
        clientOpId: 'del-retired-chair',
        operation: { type: 'DELETE_USER', userId: 'user-retired-chair' },
      }),
    });
    assert.equal(deleteRetiredChair.status, 200);
    const finalDb = (await deleteRetiredChair.json()).database as AppDatabase;
    const arch2023 = finalDb.auditSessions.find((s) => s.id === 'audit-completed-2023')!;
    assert.ok(arch2023.committeeChairman?.includes('Išėjęs Pirmininkas'));
  });
});
