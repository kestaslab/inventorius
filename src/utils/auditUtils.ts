import {
  AuditCheckRecord,
  AuditSession,
  AuditSnapshotItem,
  Department,
  InventoryItem,
  ItemCategory,
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
      });
    }
  } else {
    // Suderinamumas su senomis JSON kopijomis be snapshotItems – neišgalvojame nesančių istorinių laukų
    const legacyCandidateIds = new Set<string>();
    if (session.status === 'in_progress') {
      registryItems
        .filter((item) =>
          isItemInAuditScope(item, {
            departmentId: session.departmentId,
            includeInRepair: session.includeInRepair,
            includeToWriteOff: session.includeToWriteOff,
          })
        )
        .forEach((item) => legacyCandidateIds.add(item.id));
    } else {
      registryItems
        .filter((item) =>
          isItemInAuditScope(item, {
            departmentId: session.departmentId,
            includeInRepair: session.includeInRepair,
            includeToWriteOff: session.includeToWriteOff,
          })
        )
        .forEach((item) => legacyCandidateIds.add(item.id));
    }
    session.scannedItemIds.forEach((id) => legacyCandidateIds.add(id));
    session.missingItemIds.forEach((id) => legacyCandidateIds.add(id));
    session.relocatedItemIds.forEach((id) => legacyCandidateIds.add(id));
    Object.keys(checkRecords).forEach((id) => legacyCandidateIds.add(id));

    for (const itemId of legacyCandidateIds) {
      seenIds.add(itemId);
      const item = registryMap.get(itemId);
      const rec = checkRecords[itemId];
      const expDeptId = rec?.expectedDepartmentId || item?.departmentId || '';
      const expRoomId = rec?.expectedRoomId || item?.roomId || '';
      const dept = deptMap.get(expDeptId);
      const room = roomMap.get(expRoomId);
      const resp = item ? userMap.get(item.responsibleUserId) : undefined;

      rows.push({
        itemId,
        inventoryNumber: item?.inventoryNumber || itemId,
        serialNumber: item?.serialNumber,
        name: item?.name || `Archyvuotas / pašalintas įrašas (${itemId})`,
        category: item?.category || 'Kita',
        expectedDepartmentId: expDeptId,
        expectedDepartmentName: dept?.name || session.scopeDepartmentName || 'Nenurodyta',
        expectedDepartmentCode: dept?.code,
        expectedRoomId: expRoomId,
        expectedRoomName: rec?.expectedRoomName || formatRoomName(room, true),
        responsibleUserName: resp?.fullName || 'Nenurodyta',
        purchasePrice: item?.purchasePrice ?? 0,
        auditState: resolveAuditState(itemId),
        checkRecord: rec,
        notes: rec?.notes,
        isFromSnapshot: false,
      });
    }
  }

  // Jei sesijos metu kito skyriaus daiktas buvo faktiškai rastas čia (outside original snapshot)
  for (const [itemId, rec] of Object.entries(checkRecords)) {
    if (seenIds.has(itemId)) continue;
    const item = registryMap.get(itemId);
    const dept = deptMap.get(rec.expectedDepartmentId);
    const room = roomMap.get(rec.expectedRoomId);
    const resp = item ? userMap.get(item.responsibleUserId) : undefined;
    rows.push({
      itemId,
      inventoryNumber: item?.inventoryNumber || itemId,
      serialNumber: item?.serialNumber,
      name: item?.name || `Daiktas (${itemId})`,
      category: item?.category || 'Kita',
      expectedDepartmentId: rec.expectedDepartmentId,
      expectedDepartmentName: dept?.name || 'Kitas skyrius',
      expectedDepartmentCode: dept?.code,
      expectedRoomId: rec.expectedRoomId,
      expectedRoomName: rec.expectedRoomName || formatRoomName(room, true),
      responsibleUserName: resp?.fullName || 'Nenurodyta',
      purchasePrice: item?.purchasePrice ?? 0,
      auditState: rec.outcome,
      checkRecord: rec,
      notes: rec.notes,
      isFromSnapshot: false,
      isOutsideOriginalScope: true,
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
  progressPercent: number;
}

export function computeAuditStats(rows: EffectiveAuditRow[]): AuditProgressStats {
  const total = rows.length;
  let foundInPlaceCount = 0;
  let foundElsewhereCount = 0;
  let missingCount = 0;
  let uncheckedCount = 0;

  for (const r of rows) {
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
