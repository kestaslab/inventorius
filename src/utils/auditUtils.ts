import {
  AuditCheckItemSnapshot,
  AuditCheckRecord,
  AuditSession,
  AuditSnapshotItem,
  Department,
  InventoryItem,
  ItemCategory,
  ItemStatus,
  Room,
  User,
  formatRoomName,
} from '../types/inventory';

export interface AuditScopeOptions {
  departmentId?: string;
  includeInRepair?: boolean;
  includeToWriteOff?: boolean;
}

export function isItemInAuditScope(
  item: InventoryItem,
  options: AuditScopeOptions = {}
): boolean {
  // Nurašytas turtas pagal nutylėjimą NIEKADA neįtraukiamas į aktyvaus turto inventorizaciją
  if (item.status === 'written_off') return false;
  if (options.departmentId && item.departmentId !== options.departmentId) return false;
  if (options.includeInRepair === false && item.status === 'in_repair') return false;
  if (options.includeToWriteOff === false && item.status === 'to_writeoff') return false;
  return true;
}

export function buildAuditSnapshotItems(
  parts: {
    items: InventoryItem[];
    departments: Department[];
    rooms: Room[];
    users: User[];
  },
  scope: AuditScopeOptions = {}
): AuditSnapshotItem[] {
  const deptMap = new Map(parts.departments.map((d) => [d.id, d]));
  const roomMap = new Map(parts.rooms.map((r) => [r.id, r]));
  const userMap = new Map(parts.users.map((u) => [u.id, u]));

  return parts.items
    .filter((item) => isItemInAuditScope(item, scope))
    .map((item) => {
      const dept = deptMap.get(item.departmentId);
      const room = roomMap.get(item.roomId);
      const resp = userMap.get(item.responsibleUserId);

      return {
        itemId: item.id,
        inventoryNumber: item.inventoryNumber,
        ...(item.serialNumber ? { serialNumber: item.serialNumber } : {}),
        name: item.name,
        category: item.category,
        expectedDepartmentId: item.departmentId,
        expectedDepartmentName: dept?.name || 'Nežinomas skyrius',
        ...(dept?.code ? { expectedDepartmentCode: dept.code } : {}),
        expectedRoomId: item.roomId,
        expectedRoomName: formatRoomName(room, true),
        responsibleUserId: item.responsibleUserId,
        responsibleUserName: resp?.fullName || 'Nenurodytas atsakingas asmuo',
        purchasePrice: Number(item.purchasePrice) || 0,
        ...(typeof item.residualValue === 'number' ? { residualValue: item.residualValue } : {}),
        statusAtStart: item.status,
      };
    });
}

export function buildAuditCheckItemSnapshot(
  parts: {
    departments: Department[];
    users: User[];
  },
  item: InventoryItem,
  expectedDepartmentId: string,
  snapMatch?: AuditSnapshotItem
): AuditCheckItemSnapshot {
  const dept = parts.departments.find((d) => d.id === expectedDepartmentId);
  const resp = parts.users.find((u) => u.id === (snapMatch?.responsibleUserId || item.responsibleUserId));

  return {
    inventoryNumber: snapMatch?.inventoryNumber || item.inventoryNumber,
    ...((snapMatch?.serialNumber ?? item.serialNumber)
      ? { serialNumber: snapMatch?.serialNumber ?? item.serialNumber }
      : {}),
    name: snapMatch?.name || item.name,
    category: snapMatch?.category || item.category,
    expectedDepartmentName: snapMatch?.expectedDepartmentName || dept?.name || 'Nežinomas skyrius',
    ...((snapMatch?.expectedDepartmentCode ?? dept?.code)
      ? { expectedDepartmentCode: snapMatch?.expectedDepartmentCode ?? dept?.code }
      : {}),
    responsibleUserId: snapMatch?.responsibleUserId || item.responsibleUserId,
    responsibleUserName:
      snapMatch?.responsibleUserName || resp?.fullName || 'Nenurodytas atsakingas asmuo',
    purchasePrice: snapMatch?.purchasePrice ?? (Number(item.purchasePrice) || 0),
    ...((snapMatch?.residualValue ?? item.residualValue) !== undefined
      ? { residualValue: snapMatch?.residualValue ?? item.residualValue }
      : {}),
    statusAtCheck: item.status,
  };
}

export type AuditScopeEvaluationResult =
  | {
      allowed: true;
      isInInitialSnapshot: boolean;
      isAdditionalFinding: boolean;
      excludedStatusException: boolean;
    }
  | {
      allowed: false;
      code: 'WRITTEN_OFF' | 'EXCLUDED_BY_STATUS' | 'OUTSIDE_DEPARTMENT_SCOPE' | 'NOT_IN_INITIAL_SCOPE';
      excludedStatus?: ItemStatus;
      message: string;
    };

/**
 * Nuosekliai patikrina sesijos apimties taisykles (tiek serveryje, tiek UI):
 * - Jei daiktas buvo sesijos pradžios snapshotItems sąraše, jis išlieka istorinėje apimtyje net ir vėliau pakeitus būseną (išskyrus written_off).
 * - Sąmoningai neįtraukto statuso (in_repair / to_writeoff) turtas neleidžiamas tyliai kaip įprastas patikrinimas – reikalingas aiškus išimties sprendimas.
 * - Kito skyriaus aktyvus turtas, rastas tikrinamo skyriaus kabinete, atskiriamas kaip papildomas radinys.
 */
export function evaluateItemAuditScope(
  session: AuditSession,
  item: InventoryItem,
  actualRoom: Room | null | undefined,
  options?: {
    action?: 'check' | 'mark_missing' | 'relocate';
    confirmExcludedStatus?: boolean;
  }
): AuditScopeEvaluationResult {
  const action = options?.action || 'check';

  if (item.status === 'written_off') {
    return {
      allowed: false,
      code: 'WRITTEN_OFF',
      excludedStatus: 'written_off',
      message: `Turtas [${item.inventoryNumber}] „${item.name}“ yra nurašytas ir neįtraukiamas į aktyvaus turto inventorizaciją.`,
    };
  }

  const snapMatch = session.snapshotItems?.find((s) => s.itemId === item.id);
  const hasSnapshot = Array.isArray(session.snapshotItems);
  const isInInitialScope = hasSnapshot
    ? Boolean(snapMatch)
    : isItemInAuditScope(item, {
        departmentId: session.departmentId,
        includeInRepair: session.includeInRepair,
        includeToWriteOff: session.includeToWriteOff,
      });

  if (isInInitialScope) {
    return {
      allowed: true,
      isInInitialSnapshot: true,
      isAdditionalFinding: false,
      excludedStatusException: false,
    };
  }

  // Žymėti kaip trūkstamą galima tik pradinėje sesijos apimtyje buvusį turtą
  if (action === 'mark_missing') {
    return {
      allowed: false,
      code: 'NOT_IN_INITIAL_SCOPE',
      message: `Turtas [${item.inventoryNumber}] nebuvo įtrauktas į pradinį šios inventorizacijos apimties sąrašą, todėl negali būti pažymėtas kaip trūkstamas.`,
    };
  }

  // Tikriname, ar daiktas sąmoningai neįtrauktas pagal statusą
  if (session.includeInRepair === false && item.status === 'in_repair') {
    if (!options?.confirmExcludedStatus) {
      return {
        allowed: false,
        code: 'EXCLUDED_BY_STATUS',
        excludedStatus: 'in_repair',
        message: `Turtas [${item.inventoryNumber}] „${item.name}“ yra būsenos „Remontuojamas“ ir buvo sąmoningai neįtrauktas į šios inventorizacijos apimtį.`,
      };
    }
  }

  if (session.includeToWriteOff === false && item.status === 'to_writeoff') {
    if (!options?.confirmExcludedStatus) {
      return {
        allowed: false,
        code: 'EXCLUDED_BY_STATUS',
        excludedStatus: 'to_writeoff',
        message: `Turtas [${item.inventoryNumber}] „${item.name}“ yra pateiktas nurašymui ir buvo sąmoningai neįtrauktas į šios inventorizacijos apimtį.`,
      };
    }
  }

  // Tikriname skyriaus ribas (papildomas kito skyriaus radinys galimas tik jei faktiškai rastas sesijos skyriaus patalpoje)
  const expectedDeptId = snapMatch?.expectedDepartmentId || item.departmentId;
  if (
    session.departmentId &&
    expectedDeptId !== session.departmentId &&
    actualRoom?.departmentId !== session.departmentId
  ) {
    return {
      allowed: false,
      code: 'OUTSIDE_DEPARTMENT_SCOPE',
      message: `Turtas [${item.inventoryNumber}] nepriklauso pasirinktai šios inventorizacijos skyriaus apimčiai.`,
    };
  }

  const excludedStatusException = Boolean(
    options?.confirmExcludedStatus &&
      ((session.includeInRepair === false && item.status === 'in_repair') ||
        (session.includeToWriteOff === false && item.status === 'to_writeoff'))
  );

  return {
    allowed: true,
    isInInitialSnapshot: false,
    isAdditionalFinding: true,
    excludedStatusException,
  };
}

export type EffectiveAuditItemState = 'found' | 'found_elsewhere' | 'missing' | 'unchecked';

export interface EffectiveAuditRow {
  itemId: string;
  inventoryNumber: string;
  serialNumber?: string;
  name: string;
  category: ItemCategory;
  expectedDepartmentId: string;
  expectedDepartmentName: string;
  expectedDepartmentCode?: string;
  expectedRoomId: string;
  expectedRoomName: string;
  responsibleUserName: string;
  purchasePrice: number;
  auditState: EffectiveAuditItemState;
  checkRecord?: AuditCheckRecord;
  notes?: string;
  isFromSnapshot: boolean;
  isOutsideOriginalScope?: boolean;
  isAdditionalFinding?: boolean;
  excludedStatusException?: boolean;
  hasIncompleteHistory?: boolean;
}

export function getEffectiveSessionRows(
  session: AuditSession | undefined | null,
  registryItems: InventoryItem[],
  departments: Department[],
  rooms: Room[],
  users: User[],
  departmentFilterId: string = 'all'
): EffectiveAuditRow[] {
  if (!session) return [];

  const deptMap = new Map(departments.map((d) => [d.id, d]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const registryMap = new Map(registryItems.map((i) => [i.id, i]));

  const checkRecords = session.checkRecords || {};
  const scannedSet = new Set(session.scannedItemIds || []);
  const missingSet = new Set(session.missingItemIds || []);
  const relocatedSet = new Set(session.relocatedItemIds || []);

  const rows: EffectiveAuditRow[] = [];
  const seenIds = new Set<string>();

  const resolveAuditState = (itemId: string): EffectiveAuditItemState => {
    const rec = checkRecords[itemId];
    if (rec) {
      return rec.outcome;
    }
    if (relocatedSet.has(itemId)) return 'found_elsewhere';
    if (scannedSet.has(itemId)) return 'found';
    if (missingSet.has(itemId)) return 'missing';
    return session.status === 'completed' ? 'missing' : 'unchecked';
  };

  if (Array.isArray(session.snapshotItems)) {
    for (const snap of session.snapshotItems) {
      seenIds.add(snap.itemId);
      const rec = checkRecords[snap.itemId];
      rows.push({
        itemId: snap.itemId,
        inventoryNumber: snap.inventoryNumber,
        serialNumber: snap.serialNumber,
        name: snap.name,
        category: snap.category,
        expectedDepartmentId: snap.expectedDepartmentId,
        expectedDepartmentName: snap.expectedDepartmentName,
        expectedDepartmentCode: snap.expectedDepartmentCode,
        expectedRoomId: snap.expectedRoomId,
        expectedRoomName: snap.expectedRoomName,
        responsibleUserName: snap.responsibleUserName,
        purchasePrice: snap.purchasePrice,
        auditState: resolveAuditState(snap.itemId),
        checkRecord: rec,
        notes: rec?.notes,
        isFromSnapshot: true,
        isOutsideOriginalScope: false,
        isAdditionalFinding: false,
      });
    }
  } else {
    // Suderinamumas su senomis JSON kopijomis be snapshotItems – neišgalvojame nesančių istorinių laukų
    const legacyCandidateIds = new Set<string>();
    registryItems
      .filter((item) =>
        isItemInAuditScope(item, {
          departmentId: session.departmentId,
          includeInRepair: session.includeInRepair,
          includeToWriteOff: session.includeToWriteOff,
        })
      )
      .forEach((item) => legacyCandidateIds.add(item.id));
    session.scannedItemIds.forEach((id) => legacyCandidateIds.add(id));
    session.missingItemIds.forEach((id) => legacyCandidateIds.add(id));
    session.relocatedItemIds.forEach((id) => legacyCandidateIds.add(id));
    Object.keys(checkRecords).forEach((id) => legacyCandidateIds.add(id));

    for (const itemId of legacyCandidateIds) {
      seenIds.add(itemId);
      const item = registryMap.get(itemId);
      const rec = checkRecords[itemId];
      const snap = rec?.itemSnapshot;
      const expDeptId = rec?.expectedDepartmentId || item?.departmentId || '';
      const expRoomId = rec?.expectedRoomId || item?.roomId || '';
      const dept = deptMap.get(expDeptId);
      const room = roomMap.get(expRoomId);
      const resp = item ? userMap.get(item.responsibleUserId) : undefined;
      const incomplete = !snap && session.status === 'completed';

      rows.push({
        itemId,
        inventoryNumber: snap?.inventoryNumber || item?.inventoryNumber || itemId,
        serialNumber: snap ? snap.serialNumber : item?.serialNumber,
        name:
          snap?.name ||
          item?.name ||
          `Archyvuotas / pašalintas įrašas (${itemId}) – senos sesijos momentinių duomenų nėra`,
        category: snap?.category || item?.category || 'Kita',
        expectedDepartmentId: expDeptId,
        expectedDepartmentName:
          snap?.expectedDepartmentName || dept?.name || session.scopeDepartmentName || 'Nenurodyta',
        expectedDepartmentCode: snap ? snap.expectedDepartmentCode : dept?.code,
        expectedRoomId: expRoomId,
        expectedRoomName: rec?.expectedRoomName || formatRoomName(room, true),
        responsibleUserName: snap?.responsibleUserName || resp?.fullName || 'Nenurodyta',
        purchasePrice: snap?.purchasePrice ?? item?.purchasePrice ?? 0,
        auditState: resolveAuditState(itemId),
        checkRecord: rec,
        notes: rec?.notes,
        isFromSnapshot: Boolean(snap),
        isOutsideOriginalScope: Boolean(rec?.isAdditionalFinding),
        isAdditionalFinding: Boolean(rec?.isAdditionalFinding),
        excludedStatusException: Boolean(rec?.excludedStatusException),
        ...(incomplete ? { hasIncompleteHistory: true } : {}),
      });
    }
  }

  // Papildomi radiniai (nebuvę pradiniame snapshotItems sąraše, bet patikrinti sesijos metu)
  for (const [itemId, rec] of Object.entries(checkRecords)) {
    if (seenIds.has(itemId)) continue;
    const snap = rec.itemSnapshot;
    const item = snap ? undefined : registryMap.get(itemId);
    const dept = snap ? undefined : deptMap.get(rec.expectedDepartmentId);
    const room = snap ? undefined : roomMap.get(rec.expectedRoomId);
    const resp = !snap && item ? userMap.get(item.responsibleUserId) : undefined;
    const incomplete = !snap;

    rows.push({
      itemId,
      inventoryNumber: snap?.inventoryNumber || item?.inventoryNumber || itemId,
      serialNumber: snap ? snap.serialNumber : item?.serialNumber,
      name:
        snap?.name ||
        item?.name ||
        `Pašalintas įrašas (${itemId}) – nėra momentinių duomenų`,
      category: snap?.category || item?.category || 'Kita',
      expectedDepartmentId: rec.expectedDepartmentId,
      expectedDepartmentName:
        snap?.expectedDepartmentName || dept?.name || 'Kitas skyrius (duomenys riboti)',
      expectedDepartmentCode: snap ? snap.expectedDepartmentCode : dept?.code,
      expectedRoomId: rec.expectedRoomId,
      expectedRoomName: rec.expectedRoomName || formatRoomName(room, true),
      responsibleUserName: snap?.responsibleUserName || resp?.fullName || 'Nenurodyta',
      purchasePrice: snap?.purchasePrice ?? item?.purchasePrice ?? 0,
      auditState: rec.outcome,
      checkRecord: rec,
      notes: rec.notes,
      isFromSnapshot: false,
      isOutsideOriginalScope: true,
      isAdditionalFinding: true,
      excludedStatusException: Boolean(rec.excludedStatusException),
      ...(incomplete ? { hasIncompleteHistory: true } : {}),
    });
  }

  if (departmentFilterId && departmentFilterId !== 'all') {
    return rows.filter(
      (r) =>
        r.expectedDepartmentId === departmentFilterId ||
        r.checkRecord?.actualDepartmentId === departmentFilterId
    );
  }
  return rows;
}

export interface AuditProgressStats {
  total: number;
  checkedCount: number;
  foundInPlaceCount: number;
  foundElsewhereCount: number;
  missingCount: number;
  uncheckedCount: number;
  additionalFindingsCount: number;
  progressPercent: number;
}

export function computeAuditStats(rows: EffectiveAuditRow[]): AuditProgressStats {
  let total = 0;
  let foundInPlaceCount = 0;
  let foundElsewhereCount = 0;
  let missingCount = 0;
  let uncheckedCount = 0;
  let additionalFindingsCount = 0;

  for (const r of rows) {
    if (r.isOutsideOriginalScope || r.isAdditionalFinding) {
      additionalFindingsCount++;
      continue;
    }
    total++;
    if (r.auditState === 'found') foundInPlaceCount++;
    else if (r.auditState === 'found_elsewhere') foundElsewhereCount++;
    else if (r.auditState === 'missing') missingCount++;
    else uncheckedCount++;
  }

  const checkedCount = foundInPlaceCount + foundElsewhereCount;
  const completedActions = checkedCount + missingCount;
  const progressPercent = total > 0 ? Math.round((completedActions / total) * 100) : 0;

  return {
    total,
    checkedCount,
    foundInPlaceCount,
    foundElsewhereCount,
    missingCount,
    uncheckedCount,
    additionalFindingsCount,
    progressPercent,
  };
}

export function getAuditCameraErrorMessage(err: unknown): string {
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name?: unknown }).name)
      : '';
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message)
      : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Kameros prieiga užblokuota arba atmesta. Leiskite naršyklei naudoti kamerą nustatymuose arba naudokite rankinį įvedimą / USB skaitytuvą.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Šiame įrenginyje nerasta jokia kamera. Galite įvesti kodą ranka arba prijungti USB skaitytuvą.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamerą šiuo metu naudoja kita programa arba nepavyko jos paleisti. Uždarykite kitas kameros programėles ir bandykite dar kartą.';
  }
  if (name === 'OverconstrainedError') {
    return 'Nepavyko parinkti galinės kameros su nurodytais parametrais.';
  }
  if (name === 'SecurityError' || message.toLowerCase().includes('secure')) {
    return 'Kamera naršyklėje veikia tik per saugų HTTPS ryšį arba localhost adresą.';
  }
  return 'Nepavyko įjungti kameros. Naudokite rankinį kodo įvedimą arba USB skaitytuvą.';
}
