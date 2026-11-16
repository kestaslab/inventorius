import {
  Department,
  Room,
  User,
  InventoryItem,
  MovementRecord,
  WriteOffAct,
  AuditSession,
  AuditCheckMethod,
  AuditCheckRecord,
  AuthSettings,
  OrganizationSettings,
  DefectReport,
  ItemCondition,
  WriteOffHistoryEntry,
  WriteOffRejectionEntry,
  WriteOffRejectedItemRecord,
  formatRoomName,
  getUserAssignedRoomIds,
} from '../types/inventory';
import { AppDatabase, CURRENT_DB_VERSION, isValidIsoDateString } from './databaseValidation';
import { cloneOrganizationSettings } from './organization';
import {
  formatDateTimeVilnius,
  getCalendarDatePart,
  getCalendarYearFromDate,
  getCurrentYearVilnius,
  getTodayVilniusDate,
} from './dateUtils';
import {
  findActiveDraftActForItem,
  generateNextWriteOffActNumber,
  isWriteOffActNumberUnique,
} from './writeOffUtils';
import {
  buildAuditCheckItemSnapshot,
  buildAuditSnapshotItems,
  evaluateItemAuditScope,
  isItemInAuditScope,
} from './auditUtils';
import {
  canStartDefectRepair,
  computeActiveDefectNote,
  getActiveDefects,
} from './defectUtils';

export type DbMutation =
  | { type: 'SAVE_ITEM'; item: InventoryItem }
  | { type: 'DELETE_ITEM'; itemId: string }
  | { type: 'TRANSFER_ITEM'; record: MovementRecord }
  | {
      type: 'CONFIRM_WRITEOFF';
      itemId: string;
      reasonCategory: string;
      notes: string;
      act: WriteOffAct;
      targetActId?: string;
    }
  | {
      type: 'APPROVE_ITEM_WRITEOFF';
      itemId: string;
      approvalYear: number;
      actNumber: string;
      approvedDate: string;
      fallbackNotes?: string;
    }
  | {
      type: 'REJECT_WRITEOFF';
      itemId: string;
      reason?: string;
      rejectedByUserId?: string;
      rejectedByUserName?: string;
    }
  | {
      type: 'RESTORE_FROM_ARCHIVE';
      itemId: string;
      condition?: ItemCondition;
      reason?: string;
      restoredByUserId?: string;
      restoredByUserName?: string;
      restoredAt?: string;
      noteAppend?: string;
    }
  | { type: 'SAVE_WRITEOFF_ACT'; act: WriteOffAct }
  | {
      type: 'APPROVE_WRITEOFF_ACT';
      actId: string;
      approvalYear: number;
      approvedDate: string;
      actNumber?: string;
      approvedByUserId?: string;
      approvedByUserName?: string;
    }
  | {
      type: 'RECONCILE_WRITEOFF_ISSUE';
      action: 'return_to_active' | 'remove_stale_draft_item' | 'link_by_existing_act_number';
      itemId?: string;
      actId?: string;
    }
  | {
      type: 'SAVE_FAULT_REPORT';
      itemId: string;
      defectReport: DefectReport;
      defectNote?: string;
      newCondition?: ItemCondition;
    }
  | {
      type: 'START_DEFECT_REPAIR';
      itemId: string;
      defectId: string;
      startedByUserId?: string;
      startedByUserName: string;
      startedAt?: string;
      repairNotes?: string;
    }
  | {
      type: 'RESOLVE_DEFECT';
      itemId: string;
      defectId: string;
      resolvedByUserId?: string;
      resolvedByUserName: string;
      resolvedAt?: string;
      resolutionNotes: string;
      returnToActive?: boolean;
      newCondition?: ItemCondition;
    }
  | { type: 'SAVE_DEPARTMENT'; department: Department }
  | { type: 'DELETE_DEPARTMENT'; departmentId: string }
  | {
      type: 'TRANSFER_AND_DELETE_DEPARTMENT';
      departmentId: string;
      targetDepartmentId: string;
    }
  | { type: 'ARCHIVE_DEPARTMENT'; departmentId: string; isArchived: boolean }
  | { type: 'SAVE_ROOM'; room: Room }
  | { type: 'DELETE_ROOM'; roomId: string }
  | { type: 'TRANSFER_AND_DELETE_ROOM'; roomId: string; targetRoomId: string }
  | { type: 'ARCHIVE_ROOM'; roomId: string; isArchived: boolean }
  | { type: 'SAVE_USER'; user: User }
  | { type: 'DELETE_USER'; userId: string }
  | { type: 'TRANSFER_AND_DELETE_USER'; userId: string; targetUserId: string }
  | { type: 'ARCHIVE_USER'; userId: string; isArchived: boolean }
  | { type: 'BATCH_IMPORT_USERS'; users: User[] }
  | { type: 'UPDATE_AUTH_SETTINGS'; authSettings: AuthSettings }
  | { type: 'UPDATE_ORGANIZATION_SETTINGS'; organizationSettings: OrganizationSettings }
  | { type: 'UPDATE_AUDIT_SESSION'; session: AuditSession }
  | {
      type: 'CREATE_AUDIT_SESSION';
      session: {
        id: string;
        year: number;
        title: string;
        startDate: string;
        departmentId?: string;
        includeInRepair?: boolean;
        includeToWriteOff?: boolean;
        committeeChairman?: string;
        committeeChairmanId?: string;
        committeeMembers: string[];
        orderNumber?: string;
        orderDate?: string;
        notes?: string;
      };
    }
  | {
      type: 'UPDATE_AUDIT_SESSION_SETTINGS';
      sessionId: string;
      title: string;
      year: number;
      committeeChairman?: string;
      committeeChairmanId?: string;
      committeeMembers: string[];
      orderNumber?: string;
      orderDate?: string;
      notes?: string;
    }
  | {
      type: 'RECORD_AUDIT_CHECK';
      sessionId: string;
      itemId: string;
      actualRoomId: string;
      method: AuditCheckMethod;
      checkedByUserId?: string;
      checkedByUserName: string;
      checkedAt?: string;
      notes?: string;
      confirmExcludedStatus?: boolean;
    }
  | {
      type: 'MARK_AUDIT_ITEM_MISSING';
      sessionId: string;
      itemId: string;
      notes?: string;
    }
  | {
      type: 'COMPLETE_AUDIT_SESSION';
      sessionId: string;
      completedDate: string;
      completedByUserId?: string;
      completedByUserName?: string;
      notes?: string;
    }
  | {
      type: 'RELOCATE_AUDIT_ITEM';
      itemId: string;
      newRoomId: string;
      auditDate: string;
      sessionId?: string;
      transferredByUserId?: string;
      transferredByUserName?: string;
      confirmExcludedStatus?: boolean;
    };

export function getTouchedEntityKeys(db: AppDatabase, op: DbMutation): string[] {
  switch (op.type) {
    case 'SAVE_ITEM':
      return [`item:${op.item.id}`];
    case 'DELETE_ITEM':
      return [`item:${op.itemId}`];
    case 'TRANSFER_ITEM':
      return [`item:${op.record.itemId}`, `movement:${op.record.id}`];
    case 'CONFIRM_WRITEOFF': {
      const targetActId = op.targetActId || op.act.id;
      const keys = [`item:${op.itemId}`, `act:${targetActId}`];
      const customNum = op.act.actNumber?.trim();
      if (customNum && customNum.toUpperCase() !== 'AUTO') {
        keys.push(`act_number:${customNum.toUpperCase()}`);
      }
      return keys;
    }
    case 'APPROVE_ITEM_WRITEOFF': {
      const actKeys = db.writeOffActs
        .filter((a) => a.items.some((ai) => ai.itemId === op.itemId))
        .map((a) => `act:${a.id}`);
      const keys = [`item:${op.itemId}`, ...actKeys];
      if (op.actNumber?.trim()) {
        keys.push(`act_number:${op.actNumber.trim().toUpperCase()}`);
      }
      return keys;
    }
    case 'REJECT_WRITEOFF': {
      const draftActKeys = db.writeOffActs
        .filter((a) => a.status === 'draft' && a.items.some((ai) => ai.itemId === op.itemId))
        .map((a) => `act:${a.id}`);
      return [`item:${op.itemId}`, ...draftActKeys];
    }
    case 'RESTORE_FROM_ARCHIVE':
      return [`item:${op.itemId}`];
    case 'SAVE_WRITEOFF_ACT': {
      const keys = [`act:${op.act.id}`];
      if (op.act.actNumber?.trim()) {
        keys.push(`act_number:${op.act.actNumber.trim().toUpperCase()}`);
      }
      return keys;
    }
    case 'APPROVE_WRITEOFF_ACT': {
      const act = db.writeOffActs.find((a) => a.id === op.actId);
      const itemKeys = act ? act.items.map((it) => `item:${it.itemId}`) : [];
      const keys = [`act:${op.actId}`, ...itemKeys];
      const finalNum = (op.actNumber ?? act?.actNumber)?.trim();
      if (finalNum) {
        keys.push(`act_number:${finalNum.toUpperCase()}`);
      }
      return keys;
    }
    case 'RECONCILE_WRITEOFF_ISSUE': {
      const keys: string[] = [];
      if (op.itemId) keys.push(`item:${op.itemId}`);
      if (op.actId) keys.push(`act:${op.actId}`);
      return keys;
    }
    case 'SAVE_FAULT_REPORT':
    case 'START_DEFECT_REPAIR':
    case 'RESOLVE_DEFECT':
      return [`item:${op.itemId}`];
    case 'SAVE_DEPARTMENT':
      return [`department:${op.department.id}`];
    case 'DELETE_DEPARTMENT':
    case 'ARCHIVE_DEPARTMENT':
      return [`department:${op.departmentId}`];
    case 'TRANSFER_AND_DELETE_DEPARTMENT': {
      const itemKeys = db.items
        .filter((i) => i.departmentId === op.departmentId)
        .map((i) => `item:${i.id}`);
      const roomKeys = db.rooms
        .filter((r) => r.departmentId === op.departmentId)
        .map((r) => `room:${r.id}`);
      return [
        `department:${op.departmentId}`,
        `department:${op.targetDepartmentId}`,
        ...roomKeys,
        ...itemKeys,
      ];
    }
    case 'SAVE_ROOM': {
      const existing = db.rooms.find((r) => r.id === op.room.id);
      if (existing && existing.departmentId !== op.room.departmentId) {
        const itemKeys = db.items
          .filter((i) => i.roomId === op.room.id)
          .map((i) => `item:${i.id}`);
        return [`room:${op.room.id}`, ...itemKeys];
      }
      return [`room:${op.room.id}`];
    }
    case 'DELETE_ROOM':
    case 'ARCHIVE_ROOM':
      return [`room:${op.roomId}`];
    case 'TRANSFER_AND_DELETE_ROOM': {
      const itemKeys = db.items
        .filter((i) => i.roomId === op.roomId)
        .map((i) => `item:${i.id}`);
      return [`room:${op.roomId}`, `room:${op.targetRoomId}`, ...itemKeys];
    }
    case 'SAVE_USER':
      return op.user.role === 'admin' && op.user.pinCode
        ? [`user:${op.user.id}`, 'authSettings']
        : [`user:${op.user.id}`];
    case 'DELETE_USER':
    case 'ARCHIVE_USER':
      return [`user:${op.userId}`];
    case 'TRANSFER_AND_DELETE_USER': {
      const itemKeys = db.items
        .filter((i) => i.responsibleUserId === op.userId)
        .map((i) => `item:${i.id}`);
      return [`user:${op.userId}`, `user:${op.targetUserId}`, ...itemKeys];
    }
    case 'BATCH_IMPORT_USERS':
      return op.users.map((u) => `user_email:${u.email.toLowerCase()}`);
    case 'UPDATE_AUTH_SETTINGS':
      return ['authSettings'];
    case 'UPDATE_ORGANIZATION_SETTINGS':
      return ['organizationSettings'];
    case 'UPDATE_AUDIT_SESSION':
      return [`audit:${op.session.id}`];
    case 'CREATE_AUDIT_SESSION':
      return [`audit:${op.session.id}`, `audit_settings:${op.session.id}`];
    case 'UPDATE_AUDIT_SESSION_SETTINGS':
      return [`audit_settings:${op.sessionId}`];
    case 'RECORD_AUDIT_CHECK':
      return [`audit_check:${op.sessionId}:${op.itemId}`, `item:${op.itemId}`];
    case 'MARK_AUDIT_ITEM_MISSING':
      return [`audit_check:${op.sessionId}:${op.itemId}`];
    case 'COMPLETE_AUDIT_SESSION':
      return [`audit:${op.sessionId}`, `audit_settings:${op.sessionId}`];
    case 'RELOCATE_AUDIT_ITEM':
      return op.sessionId
        ? [`item:${op.itemId}`, `audit_check:${op.sessionId}:${op.itemId}`]
        : [`item:${op.itemId}`];
  }
}

/**
 * Grąžina visų objektų raktus, nuo kurių priklauso arba kuriuos nuskaito / susieja operacija
 * (įskaitant pačius keičiamus objektus ir tėvinius skyrius, kabinetus, naudotojus ar aktus).
 */
export function getOperationReferencedKeys(db: AppDatabase, op: DbMutation): string[] {
  const keys = new Set<string>(getTouchedEntityKeys(db, op));

  switch (op.type) {
    case 'SAVE_ITEM':
      if (op.item.departmentId) keys.add(`department:${op.item.departmentId}`);
      if (op.item.roomId) keys.add(`room:${op.item.roomId}`);
      if (op.item.responsibleUserId) keys.add(`user:${op.item.responsibleUserId}`);
      if (op.item.writeOffActId) keys.add(`act:${op.item.writeOffActId}`);
      break;
    case 'TRANSFER_ITEM':
      if (op.record.fromDepartmentId) keys.add(`department:${op.record.fromDepartmentId}`);
      if (op.record.toDepartmentId) keys.add(`department:${op.record.toDepartmentId}`);
      if (op.record.fromRoomId) keys.add(`room:${op.record.fromRoomId}`);
      if (op.record.toRoomId) keys.add(`room:${op.record.toRoomId}`);
      if (op.record.fromUserId) keys.add(`user:${op.record.fromUserId}`);
      if (op.record.toUserId) keys.add(`user:${op.record.toUserId}`);
      break;
    case 'CONFIRM_WRITEOFF':
      keys.add(`item:${op.itemId}`);
      keys.add(`act:${op.targetActId || op.act.id}`);
      break;
    case 'APPROVE_ITEM_WRITEOFF':
    case 'REJECT_WRITEOFF':
    case 'RESTORE_FROM_ARCHIVE':
    case 'SAVE_FAULT_REPORT':
    case 'START_DEFECT_REPAIR':
    case 'RESOLVE_DEFECT':
    case 'DELETE_ITEM':
      keys.add(`item:${op.itemId}`);
      break;
    case 'SAVE_WRITEOFF_ACT':
      keys.add(`act:${op.act.id}`);
      for (const ai of op.act.items || []) {
        keys.add(`item:${ai.itemId}`);
      }
      break;
    case 'APPROVE_WRITEOFF_ACT':
      keys.add(`act:${op.actId}`);
      break;
    case 'RECONCILE_WRITEOFF_ISSUE':
      if (op.itemId) keys.add(`item:${op.itemId}`);
      if (op.actId) keys.add(`act:${op.actId}`);
      break;
    case 'SAVE_ROOM':
      if (op.room.departmentId) keys.add(`department:${op.room.departmentId}`);
      if (op.room.defaultResponsiblePersonId) {
        keys.add(`user:${op.room.defaultResponsiblePersonId}`);
      }
      break;
    case 'SAVE_DEPARTMENT':
      if (op.department.managerId) keys.add(`user:${op.department.managerId}`);
      break;
    case 'TRANSFER_AND_DELETE_ROOM':
      keys.add(`room:${op.roomId}`);
      keys.add(`room:${op.targetRoomId}`);
      break;
    case 'TRANSFER_AND_DELETE_DEPARTMENT':
      keys.add(`department:${op.departmentId}`);
      keys.add(`department:${op.targetDepartmentId}`);
      break;
    case 'TRANSFER_AND_DELETE_USER':
      keys.add(`user:${op.userId}`);
      keys.add(`user:${op.targetUserId}`);
      break;
    case 'RELOCATE_AUDIT_ITEM':
      keys.add(`item:${op.itemId}`);
      keys.add(`room:${op.newRoomId}`);
      if (op.sessionId) keys.add(`audit:${op.sessionId}`);
      break;
    case 'RECORD_AUDIT_CHECK':
      keys.add(`audit:${op.sessionId}`);
      keys.add(`item:${op.itemId}`);
      keys.add(`room:${op.actualRoomId}`);
      break;
    case 'MARK_AUDIT_ITEM_MISSING':
      keys.add(`audit:${op.sessionId}`);
      keys.add(`item:${op.itemId}`);
      break;
    case 'UPDATE_AUDIT_SESSION_SETTINGS':
    case 'COMPLETE_AUDIT_SESSION':
      keys.add(`audit:${op.sessionId}`);
      break;
    case 'CREATE_AUDIT_SESSION':
      if (op.session.departmentId) keys.add(`department:${op.session.departmentId}`);
      break;
    case 'BATCH_IMPORT_USERS':
      for (const u of op.users || []) {
        if (u.departmentId) keys.add(`department:${u.departmentId}`);
        for (const rId of getUserAssignedRoomIds(u)) {
          keys.add(`room:${rId}`);
        }
        const matched = db.users.find(
          (ex) => ex.email.toLowerCase() === (u.email || '').trim().toLowerCase()
        );
        if (matched) keys.add(`user:${matched.id}`);
      }
      break;
  }

  return Array.from(keys);
}

export type MutationApplyResult =
  | { ok: true; database: AppDatabase }
  | { ok: false; error: string; statusCode?: number };

function nextMovementActNumber(movements: MovementRecord[], year: number): string {
  const prefix = `PER-${year}-`;
  let maxNum = 100;
  for (const m of movements) {
    if (typeof m.actNumber === 'string' && m.actNumber.startsWith(prefix)) {
      const suffix = parseInt(m.actNumber.slice(prefix.length), 10);
      if (Number.isFinite(suffix) && suffix > maxNum) {
        maxNum = suffix;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

function buildMovementRecord(
  db: AppDatabase,
  existingMovements: MovementRecord[],
  params: {
    id?: string;
    item: InventoryItem;
    fromDepartmentId: string;
    fromRoomId: string;
    fromUserId: string;
    toDepartmentId: string;
    toRoomId: string;
    toUserId: string;
    date?: string;
    reason: string;
    actNumber?: string;
    seqOffset?: number;
  }
): MovementRecord {
  const nowDate = new Date();
  const year = getCurrentYearVilnius(nowDate);
  const fromDept = db.departments.find((d) => d.id === params.fromDepartmentId);
  const toDept = db.departments.find((d) => d.id === params.toDepartmentId);
  const fromRoom = db.rooms.find((r) => r.id === params.fromRoomId);
  const toRoom = db.rooms.find((r) => r.id === params.toRoomId);
  const fromUser = db.users.find((u) => u.id === params.fromUserId);
  const toUser = db.users.find((u) => u.id === params.toUserId);

  const suffixOffset = params.seqOffset ?? 0;
  const generatedId =
    params.id || `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}${suffixOffset ? `-${suffixOffset}` : ''}`;

  return {
    id: generatedId,
    itemId: params.item.id,
    itemName: params.item.name,
    inventoryNumber: params.item.inventoryNumber,
    fromDepartmentId: params.fromDepartmentId,
    fromRoomId: params.fromRoomId,
    toDepartmentId: params.toDepartmentId,
    toRoomId: params.toRoomId,
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    fromDepartmentName: fromDept?.name,
    fromRoomName: fromRoom ? formatRoomName(fromRoom, true) : undefined,
    fromUserName: fromUser?.fullName,
    toDepartmentName: toDept?.name,
    toRoomName: toRoom ? formatRoomName(toRoom, true) : undefined,
    toUserName: toUser?.fullName,
    date: params.date || formatDateTimeVilnius(nowDate.toISOString()),
    reason: params.reason,
    actNumber: params.actNumber || nextMovementActNumber(existingMovements, year),
  };
}

/**
 * Užtikrina, kad prieš pervadinant ar šalinant skyrių/kabinetą/darbuotoją,
 * esami judėjimo istorijos įrašai išsaugotų to meto pavadinimų momentines kopijas.
 */
function backfillMovementSnapshots(
  movements: MovementRecord[],
  departments: Department[],
  rooms: Room[],
  users: User[]
): MovementRecord[] {
  const deptMap = new Map(departments.map((d) => [d.id, d]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  let changed = false;
  const next = movements.map((m) => {
    const patch: Partial<MovementRecord> = {};
    if (!m.fromDepartmentName && deptMap.has(m.fromDepartmentId)) {
      patch.fromDepartmentName = deptMap.get(m.fromDepartmentId)!.name;
    }
    if (!m.toDepartmentName && deptMap.has(m.toDepartmentId)) {
      patch.toDepartmentName = deptMap.get(m.toDepartmentId)!.name;
    }
    if (!m.fromRoomName && roomMap.has(m.fromRoomId)) {
      patch.fromRoomName = formatRoomName(roomMap.get(m.fromRoomId)!, true);
    }
    if (!m.toRoomName && roomMap.has(m.toRoomId)) {
      patch.toRoomName = formatRoomName(roomMap.get(m.toRoomId)!, true);
    }
    if (!m.fromUserName && userMap.has(m.fromUserId)) {
      patch.fromUserName = userMap.get(m.fromUserId)!.fullName;
    }
    if (!m.toUserName && userMap.has(m.toUserId)) {
      patch.toUserName = userMap.get(m.toUserId)!.fullName;
    }
    if (Object.keys(patch).length > 0) {
      changed = true;
      return { ...m, ...patch };
    }
    return m;
  });

  return changed ? next : movements;
}

export function applyDbMutation(db: AppDatabase, op: DbMutation): MutationApplyResult {
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const todayStr = getTodayVilniusDate(nowDate);

  switch (op.type) {
    case 'SAVE_ITEM': {
      const trimmedName = op.item.name?.trim();
      const trimmedInv = op.item.inventoryNumber?.trim();
      if (!trimmedName) {
        return { ok: false, statusCode: 400, error: 'Turto pavadinimas negali būti tuščias.' };
      }
      if (!trimmedInv) {
        return { ok: false, statusCode: 400, error: 'Inventorinis numeris negali būti tuščias.' };
      }

      const normalizedInv = trimmedInv.toUpperCase();
      const duplicate = db.items.find(
        (i) => i.id !== op.item.id && i.inventoryNumber.trim().toUpperCase() === normalizedInv
      );
      if (duplicate) {
        return {
          ok: false,
          statusCode: 409,
          error: `Inventorinis numeris „${op.item.inventoryNumber}“ jau priskirtas kitam turtui („${duplicate.name}“).`,
        };
      }

      if (typeof op.item.purchasePrice !== 'number' || !Number.isFinite(op.item.purchasePrice) || op.item.purchasePrice < 0) {
        return { ok: false, statusCode: 400, error: 'Įsigijimo kaina negali būti neigiama ar neteisingo formato.' };
      }

      if (op.item.residualValue !== undefined) {
        if (typeof op.item.residualValue !== 'number' || !Number.isFinite(op.item.residualValue) || op.item.residualValue < 0) {
          return { ok: false, statusCode: 400, error: 'Likutinė vertė negali būti neigiama.' };
        }
        if (op.item.residualValue > op.item.purchasePrice) {
          return {
            ok: false,
            statusCode: 400,
            error: `Likutinė vertė (${op.item.residualValue.toFixed(2)} €) negali viršyti įsigijimo kainos (${op.item.purchasePrice.toFixed(2)} €).`,
          };
        }
      }

      if (!op.item.acquisitionDate || !isValidIsoDateString(op.item.acquisitionDate.trim())) {
        return { ok: false, statusCode: 400, error: 'Netinkamas įsigijimo datos formatas (tikimasi YYYY-MM-DD).' };
      }
      if (op.item.acquisitionDate.trim() > todayStr) {
        return { ok: false, statusCode: 400, error: 'Įsigijimo data negali būti ateityje.' };
      }

      const dept = db.departments.find((d) => d.id === op.item.departmentId);
      if (!dept) {
        return { ok: false, statusCode: 400, error: 'Nurodytas skyrius sistemoje nerastas.' };
      }
      const room = db.rooms.find((r) => r.id === op.item.roomId);
      if (!room) {
        return { ok: false, statusCode: 400, error: 'Nurodytas kabinetas / patalpa sistemoje nerasta.' };
      }
      if (room.departmentId !== op.item.departmentId) {
        return {
          ok: false,
          statusCode: 400,
          error: `Kabinetas „${formatRoomName(room, true)}“ nepriklauso skyriui „${dept.name}“.`,
        };
      }
      const respUser = db.users.find((u) => u.id === op.item.responsibleUserId);
      if (!respUser) {
        return { ok: false, statusCode: 400, error: 'Nurodytas atsakingas asmuo sistemoje nerastas.' };
      }

      const existing = db.items.find((i) => i.id === op.item.id);

      // Būsenų apsauga: paprastas redagavimas negali apeiti nurašymo arba atkūrimo procedūrų
      if (!existing) {
        if (op.item.status === 'to_writeoff' || op.item.status === 'written_off') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Registruojant naują turtą negalima iš karto nustatyti nurašymo būsenos. Naudokite nurašymo procedūrą.',
          };
        }
      } else {
        if (existing.status === 'written_off' && op.item.status !== 'written_off') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Nurašyto turto būsenos negalima pakeisti redaguojant. Naudokite „Atkurti iš archyvo“ procedūrą.',
          };
        }
        if (existing.status === 'to_writeoff' && op.item.status !== 'to_writeoff') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Teikiamo nurašyti turto būsenos negalima pakeisti redaguojant. Patvirtinkite arba atmeskite nurašymą.',
          };
        }
        if (
          (existing.status === 'active' || existing.status === 'in_repair') &&
          (op.item.status === 'to_writeoff' || op.item.status === 'written_off')
        ) {
          return {
            ok: false,
            statusCode: 400,
            error: 'Negalima nurašyti turto per paprastą redagavimo formą. Naudokite „Teikti nurašymui“ procedūrą.',
          };
        }
      }

      const savedItem: InventoryItem = existing
        ? {
            ...existing,
            ...op.item,
            inventoryNumber: trimmedInv.toUpperCase(),
            name: trimmedName,
            acquisitionDate: op.item.acquisitionDate.trim(),
            // Išsaugome neforminius laukus, jei klientas jų neperdavė
            defectReports: op.item.defectReports ?? existing.defectReports,
            activeDefectNote: op.item.activeDefectNote ?? existing.activeDefectNote,
            writtenOffDate: op.item.writtenOffDate ?? existing.writtenOffDate,
            writtenOffYear: op.item.writtenOffYear ?? existing.writtenOffYear,
            writeOffActNumber: op.item.writeOffActNumber ?? existing.writeOffActNumber,
            writeOffReason: op.item.writeOffReason ?? existing.writeOffReason,
            writeOffActId: op.item.writeOffActId ?? existing.writeOffActId,
            writeOffHistory: op.item.writeOffHistory ?? existing.writeOffHistory,
            writeOffRejectionHistory:
              op.item.writeOffRejectionHistory ?? existing.writeOffRejectionHistory,
            barcode: op.item.barcode ?? existing.barcode,
            lastAuditDate: op.item.lastAuditDate ?? existing.lastAuditDate,
          }
        : {
            ...op.item,
            inventoryNumber: trimmedInv.toUpperCase(),
            name: trimmedName,
            acquisitionDate: op.item.acquisitionDate.trim(),
          };

      let movements = db.movements;
      if (
        existing &&
        (existing.departmentId !== savedItem.departmentId ||
          existing.roomId !== savedItem.roomId ||
          existing.responsibleUserId !== savedItem.responsibleUserId)
      ) {
        const mov = buildMovementRecord(db, db.movements, {
          item: savedItem,
          fromDepartmentId: existing.departmentId,
          fromRoomId: existing.roomId,
          fromUserId: existing.responsibleUserId,
          toDepartmentId: savedItem.departmentId,
          toRoomId: savedItem.roomId,
          toUserId: savedItem.responsibleUserId,
          reason: 'Vietos arba atsakingo asmens pakeitimas redaguojant turto kortelę',
        });
        movements = [mov, ...db.movements];
      }

      const items = existing
        ? db.items.map((i) => (i.id === op.item.id ? savedItem : i))
        : [savedItem, ...db.items];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, movements },
      };
    }

    case 'DELETE_ITEM': {
      const items = db.items.filter((i) => i.id !== op.itemId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'TRANSFER_ITEM': {
      const targetItem = db.items.find((i) => i.id === op.record.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Perkeliamas turtas nerastas.' };
      }
      if (targetItem.status === 'written_off') {
        return { ok: false, statusCode: 400, error: 'Negalima perkelti jau nurašyto turto.' };
      }
      const toDept = db.departments.find((d) => d.id === op.record.toDepartmentId);
      if (!toDept) {
        return { ok: false, statusCode: 400, error: 'Pasirinktas paskirties skyrius nerastas.' };
      }
      const toRoom = db.rooms.find((r) => r.id === op.record.toRoomId);
      if (!toRoom) {
        return { ok: false, statusCode: 400, error: 'Pasirinktas paskirties kabinetas nerastas.' };
      }
      if (toRoom.departmentId !== op.record.toDepartmentId) {
        return {
          ok: false,
          statusCode: 400,
          error: `Kabinetas „${formatRoomName(toRoom, true)}“ nepriklauso skyriui „${toDept.name}“.`,
        };
      }
      const toUser = db.users.find((u) => u.id === op.record.toUserId);
      if (!toUser) {
        return { ok: false, statusCode: 400, error: 'Pasirinktas naujas atsakingas asmuo nerastas.' };
      }
      if (
        targetItem.departmentId === op.record.toDepartmentId &&
        targetItem.roomId === op.record.toRoomId &&
        targetItem.responsibleUserId === op.record.toUserId
      ) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Nauja vieta ir atsakingas asmuo sutampa su esama.',
        };
      }
      if (!op.record.reason || !op.record.reason.trim()) {
        return { ok: false, statusCode: 400, error: 'Nurodykite perkėlimo priežastį / pagrindą.' };
      }

      const fromDept = db.departments.find((d) => d.id === targetItem.departmentId);
      const fromRoom = db.rooms.find((r) => r.id === targetItem.roomId);
      const fromUser = db.users.find((u) => u.id === targetItem.responsibleUserId);

      const enrichedRecord: MovementRecord = {
        ...op.record,
        itemName: op.record.itemName || targetItem.name,
        inventoryNumber: op.record.inventoryNumber || targetItem.inventoryNumber,
        fromDepartmentId: targetItem.departmentId,
        fromRoomId: targetItem.roomId,
        fromUserId: targetItem.responsibleUserId,
        fromDepartmentName: op.record.fromDepartmentName || fromDept?.name,
        fromRoomName: op.record.fromRoomName || (fromRoom ? formatRoomName(fromRoom, true) : undefined),
        fromUserName: op.record.fromUserName || fromUser?.fullName,
        toDepartmentName: op.record.toDepartmentName || toDept.name,
        toRoomName: op.record.toRoomName || formatRoomName(toRoom, true),
        toUserName: op.record.toUserName || toUser.fullName,
        reason: op.record.reason.trim(),
      };

      const movements = [enrichedRecord, ...db.movements];
      const items = db.items.map((i) =>
        i.id === op.record.itemId
          ? {
              ...i,
              departmentId: op.record.toDepartmentId,
              roomId: op.record.toRoomId,
              responsibleUserId: op.record.toUserId,
            }
          : i
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, movements, items },
      };
    }

    case 'CONFIRM_WRITEOFF': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Nurašymui teikiamas turtas nerastas.' };
      }
      if (targetItem.status === 'to_writeoff') {
        return {
          ok: false,
          statusCode: 409,
          error: `Turtas [${targetItem.inventoryNumber}] jau yra pateiktas nurašymui.`,
        };
      }
      if (targetItem.status === 'written_off') {
        return {
          ok: false,
          statusCode: 400,
          error: `Turtas [${targetItem.inventoryNumber}] jau yra nurašytas archyve. Prieš pakartotinį nurašymą jį reikia atkurti iš archyvo.`,
        };
      }
      const existingActiveDraft = db.writeOffActs.find(
        (a) => a.status === 'draft' && a.items.some((ai) => ai.itemId === op.itemId)
      );
      if (existingActiveDraft) {
        return {
          ok: false,
          statusCode: 409,
          error: `Turtas [${targetItem.inventoryNumber}] jau įtrauktas į aktyvų nurašymo projektą „${existingActiveDraft.actNumber}“. Negalima pateikti į kelis projektus vienu metu.`,
        };
      }
      if (!op.reasonCategory?.trim() || !op.notes?.trim()) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Nurodykite nurašymo priežasties kategoriją ir defekto aprašymą.',
        };
      }

      const cleanReasonCategory = op.reasonCategory.trim();
      const cleanNotes = op.notes.trim();
      const entryItem = {
        itemId: targetItem.id,
        name: targetItem.name,
        inventoryNumber: targetItem.inventoryNumber,
        price: targetItem.purchasePrice,
        residualPrice: targetItem.residualValue ?? 0,
        reason: cleanNotes,
      };

      let targetAct: WriteOffAct;
      let writeOffActs: WriteOffAct[];

      if (op.targetActId) {
        const existingDraft = db.writeOffActs.find((a) => a.id === op.targetActId);
        if (!existingDraft) {
          return {
            ok: false,
            statusCode: 404,
            error: 'Pasirinktas nurašymo akto projektas nerastas.',
          };
        }
        if (existingDraft.status !== 'draft') {
          return {
            ok: false,
            statusCode: 400,
            error: `Negalima įtraukti turto į aktą „${existingDraft.actNumber}“, nes jo būsena yra „${existingDraft.status}“ (nebe projektas).`,
          };
        }
        if (existingDraft.items.some((ai) => ai.itemId === targetItem.id)) {
          return {
            ok: false,
            statusCode: 409,
            error: `Turtas [${targetItem.inventoryNumber}] jau yra akte „${existingDraft.actNumber}“.`,
          };
        }
        targetAct = {
          ...existingDraft,
          items: [...existingDraft.items, entryItem],
          notes: existingDraft.notes
            ? `${existingDraft.notes}\n[${targetItem.inventoryNumber}] ${cleanNotes}`
            : cleanNotes,
        };
        writeOffActs = db.writeOffActs.map((a) => (a.id === targetAct.id ? targetAct : a));
      } else {
        if (db.writeOffActs.some((a) => a.id === op.act.id)) {
          return { ok: false, statusCode: 409, error: 'Nurašymo aktas tokiu ID jau egzistuoja.' };
        }
        const actDate =
          op.act.date && isValidIsoDateString(op.act.date) ? op.act.date : todayStr;
        const year =
          op.act.actYear || getCalendarYearFromDate(actDate) || getCurrentYearVilnius();
        const rawNumber = (op.act.actNumber || '').trim();
        let assignedNumber: string;

        if (!rawNumber || rawNumber.toUpperCase() === 'AUTO') {
          assignedNumber = generateNextWriteOffActNumber(db.writeOffActs, year);
        } else {
          if (!isWriteOffActNumberUnique(db.writeOffActs, rawNumber)) {
            return {
              ok: false,
              statusCode: 409,
              error: `Nurašymo akto numeris „${rawNumber}“ jau naudojamas kitame akte.`,
            };
          }
          assignedNumber = rawNumber;
        }

        targetAct = {
          ...op.act,
          actNumber: assignedNumber,
          date: actDate,
          actYear: year,
          status: 'draft',
          reasonCategory: cleanReasonCategory,
          notes: cleanNotes,
          items: [entryItem],
        };
        writeOffActs = [targetAct, ...db.writeOffActs];
      }

      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'to_writeoff' as const,
              condition: 'poor' as const,
              writeOffActId: targetAct.id,
              writeOffActNumber: targetAct.actNumber,
              writeOffReason: `${cleanReasonCategory}: ${cleanNotes}`,
              writtenOffDate: undefined,
              writtenOffYear: undefined,
              notes: cleanNotes
                ? `${i.notes ? i.notes + ' | ' : ''}Nurašymo teikimas (${targetAct.actNumber}): ${cleanNotes}`
                : i.notes,
            }
          : i
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, writeOffActs },
      };
    }

    case 'APPROVE_ITEM_WRITEOFF': {
      // Viena bendra taisyklė: nurašymas tvirtinamas tik per susietą aktą (visas aktas kartu).
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      if (targetItem.status !== 'to_writeoff') {
        return {
          ok: false,
          statusCode: 400,
          error: `Turtas [${targetItem.inventoryNumber}] nėra būsenoje „Teikiamas nurašyti“.`,
        };
      }
      const linkedDraft = findActiveDraftActForItem(db.writeOffActs, targetItem);
      if (!linkedDraft) {
        return {
          ok: false,
          statusCode: 400,
          error: `Nerastas aktyvus nurašymo akto projektas daiktui [${targetItem.inventoryNumber}].`,
        };
      }
      if (linkedDraft.items.length > 1) {
        return {
          ok: false,
          statusCode: 400,
          error: `Daiktas priklauso kelių daiktų aktui „${linkedDraft.actNumber}“ (${linkedDraft.items.length} vnt.). Pagal nustatytą taisyklę visas aktas turi būti tvirtinamas kartu.`,
        };
      }
      return applyDbMutation(db, {
        type: 'APPROVE_WRITEOFF_ACT',
        actId: linkedDraft.id,
        approvalYear: op.approvalYear,
        approvedDate: op.approvedDate,
        actNumber: op.actNumber || linkedDraft.actNumber,
      });
    }

    case 'REJECT_WRITEOFF': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      if (targetItem.status !== 'to_writeoff') {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima atmesti teikimo: turto [${targetItem.inventoryNumber}] būsena nėra „Teikiamas nurašyti“.`,
        };
      }

      const rejectionReason = op.reason?.trim() || 'Nurašymo teikimas atmestas komisijos / atsakingo asmens sprendimu';
      const newRejectionEntries: WriteOffRejectionEntry[] = [];

      const writeOffActs = db.writeOffActs.map((act) => {
        if (act.status !== 'draft') return act;
        const matchedItem = act.items.find((ai) => ai.itemId === op.itemId);
        if (!matchedItem) return act;

        const remainingItems = act.items.filter((ai) => ai.itemId !== op.itemId);
        const rejectedRecord: WriteOffRejectedItemRecord = {
          itemId: matchedItem.itemId,
          name: matchedItem.name,
          inventoryNumber: matchedItem.inventoryNumber,
          price: matchedItem.price,
          residualPrice: matchedItem.residualPrice,
          submissionReason: matchedItem.reason,
          rejectedAt: nowIso,
          ...(op.rejectedByUserId ? { rejectedByUserId: op.rejectedByUserId } : {}),
          ...(op.rejectedByUserName ? { rejectedByUserName: op.rejectedByUserName } : {}),
          rejectionReason,
        };

        newRejectionEntries.push({
          id: `wrej-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          actId: act.id,
          actNumber: act.actNumber,
          rejectedAt: nowIso,
          ...(op.rejectedByUserId ? { rejectedByUserId: op.rejectedByUserId } : {}),
          ...(op.rejectedByUserName ? { rejectedByUserName: op.rejectedByUserName } : {}),
          reason: rejectionReason,
        });

        return {
          ...act,
          status: remainingItems.length === 0 ? ('cancelled' as const) : ('draft' as const),
          items: remainingItems,
          rejectedItems: [...(act.rejectedItems || []), rejectedRecord],
        };
      });

      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'active' as const,
              writeOffActId: undefined,
              writeOffActNumber: undefined,
              writeOffReason: undefined,
              writtenOffDate: undefined,
              writtenOffYear: undefined,
              writeOffRejectionHistory: [
                ...(i.writeOffRejectionHistory || []),
                ...newRejectionEntries,
              ],
              notes: i.notes
                ? `${i.notes} | Teikimas atmestas (${todayStr}): ${rejectionReason}`
                : `Teikimas atmestas (${todayStr}): ${rejectionReason}`,
            }
          : i
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, writeOffActs },
      };
    }

    case 'RESTORE_FROM_ARCHIVE': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Atkuriamas turtas nerastas.' };
      }
      if (targetItem.status !== 'written_off') {
        return {
          ok: false,
          statusCode: 400,
          error: `Turtas [${targetItem.inventoryNumber}] nėra nurašyto turto archyve.`,
        };
      }

      const validConditions: ReadonlySet<ItemCondition> = new Set(['new', 'good', 'fair', 'poor']);
      if (!op.condition || !validConditions.has(op.condition)) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Atkuriant turtą iš archyvo būtina nurodyti faktinę jo būklę (Nauja, Gera, Patenkinama arba Prasta).',
        };
      }

      const restorationReason = (op.reason || op.noteAppend || '').trim();
      if (!restorationReason) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Nurodykite priežastį, kodėl turtas atkuriamas iš archyvo į apskaitą.',
        };
      }

      const restoredAt = op.restoredAt || nowIso;
      const conditionLt =
        op.condition === 'new'
          ? 'Nauja'
          : op.condition === 'good'
          ? 'Gera'
          : op.condition === 'fair'
          ? 'Patenkinama'
          : 'Prasta';

      const historyEntry: WriteOffHistoryEntry = {
        id: `wh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        actId: targetItem.writeOffActId,
        actNumber: targetItem.writeOffActNumber,
        writtenOffDate: targetItem.writtenOffDate,
        writtenOffYear: targetItem.writtenOffYear,
        writeOffReason: targetItem.writeOffReason,
        restoredAt,
        ...(op.restoredByUserId ? { restoredByUserId: op.restoredByUserId } : {}),
        ...(op.restoredByUserName ? { restoredByUserName: op.restoredByUserName } : {}),
        restorationReason,
        conditionOnRestore: op.condition,
      };

      const whoLabel = op.restoredByUserName || 'Atsakingas asmuo';
      const noteText = `Atkurta iš archyvo (${restoredAt.slice(0, 10)}, ${whoLabel}, būklė: ${conditionLt}): ${restorationReason}${
        targetItem.writeOffActNumber ? ` [ankst. aktas ${targetItem.writeOffActNumber}]` : ''
      }`;

      // Istorinis WriteOffAct lieka nepakeistas! Išvalomi tik aktyvūs daikto nurašymo ryšiai, kad vėlesnis nurašymas nesusimaišytų su ankstesniu.
      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'active' as const,
              condition: op.condition as ItemCondition,
              writtenOffDate: undefined,
              writtenOffYear: undefined,
              writeOffActNumber: undefined,
              writeOffReason: undefined,
              writeOffActId: undefined,
              writeOffHistory: [...(i.writeOffHistory || []), historyEntry],
              notes: i.notes ? `${i.notes} | ${noteText}` : noteText,
            }
          : i
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'SAVE_WRITEOFF_ACT': {
      const existing = db.writeOffActs.find((a) => a.id === op.act.id);
      if (!op.act.actNumber?.trim()) {
        return { ok: false, statusCode: 400, error: 'Nurašymo akto numeris negali būti tuščias.' };
      }
      if (!isWriteOffActNumberUnique(db.writeOffActs, op.act.actNumber, op.act.id)) {
        return {
          ok: false,
          statusCode: 409,
          error: `Nurašymo akto numeris „${op.act.actNumber}“ jau egzistuoja kitame akte.`,
        };
      }
      if (existing && (existing.status === 'approved' || existing.status === 'cancelled')) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Jau patvirtinto arba atšaukto nurašymo akto keisti negalima.',
        };
      }
      const writeOffActs = existing
        ? db.writeOffActs.map((a) => (a.id === op.act.id ? op.act : a))
        : [op.act, ...db.writeOffActs];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, writeOffActs },
      };
    }

    case 'APPROVE_WRITEOFF_ACT': {
      const targetAct = db.writeOffActs.find((a) => a.id === op.actId);
      if (!targetAct) {
        return { ok: false, statusCode: 404, error: 'Nurašymo aktas nerastas.' };
      }
      if (targetAct.status === 'approved') {
        return {
          ok: false,
          statusCode: 400,
          error: `Nurašymo aktas „${targetAct.actNumber}“ jau yra patvirtintas. Pakartotinis tvirtinimas negalimas.`,
        };
      }
      if (targetAct.status === 'cancelled') {
        return {
          ok: false,
          statusCode: 400,
          error: `Nurašymo projektas „${targetAct.actNumber}“ buvo atšauktas atmetus visus jo daiktus.`,
        };
      }
      if (!targetAct.items || targetAct.items.length === 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Nurašymo akte „${targetAct.actNumber}“ nėra nė vieno galiojančio daikto.`,
        };
      }
      if (!op.approvedDate || !isValidIsoDateString(op.approvedDate.trim())) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Netinkamas patvirtinimo datos formatas (tikimasi YYYY-MM-DD).',
        };
      }
      if (!Number.isInteger(op.approvalYear) || op.approvalYear < 1990 || op.approvalYear > 2100) {
        return { ok: false, statusCode: 400, error: 'Netinkami nurašymo archyvo metai.' };
      }

      const finalActNumber = (op.actNumber ?? targetAct.actNumber).trim();
      if (!finalActNumber) {
        return { ok: false, statusCode: 400, error: 'Nurašymo akto numeris negali būti tuščias.' };
      }
      if (!isWriteOffActNumberUnique(db.writeOffActs, finalActNumber, targetAct.id)) {
        return {
          ok: false,
          statusCode: 409,
          error: `Nurašymo akto numeris „${finalActNumber}“ jau naudojamas kitame akte.`,
        };
      }

      // Prieš bet kokį keitimą griežtai patikriname VISUS akto daiktus (jokio dalinio išsaugojimo klaidos atveju!)
      const seenItemIds = new Set<string>();
      const rejectedInAct = new Set((targetAct.rejectedItems || []).map((r) => r.itemId));
      const itemMap = new Map(db.items.map((it) => [it.id, it]));

      for (const actItem of targetAct.items) {
        if (seenItemIds.has(actItem.itemId)) {
          return {
            ok: false,
            statusCode: 400,
            error: `Akte „${finalActNumber}“ dubliuojamas daiktas [${actItem.inventoryNumber}].`,
          };
        }
        seenItemIds.add(actItem.itemId);

        if (rejectedInAct.has(actItem.itemId)) {
          return {
            ok: false,
            statusCode: 400,
            error: `Daiktas [${actItem.inventoryNumber}] buvo atmestas šiame projekte ir negali būti nurašytas be naujo teikimo.`,
          };
        }

        const realItem = itemMap.get(actItem.itemId);
        if (!realItem) {
          return {
            ok: false,
            statusCode: 400,
            error: `Akte nurodytas daiktas [${actItem.inventoryNumber}] (${actItem.name}) neegzistuoja inventoriaus sąraše. Aktas nepatvirtintas.`,
          };
        }
        if (realItem.status !== 'to_writeoff') {
          return {
            ok: false,
            statusCode: 400,
            error: `Daikto [${realItem.inventoryNumber}] „${realItem.name}“ būsena yra „${realItem.status}“, o ne „Teikiamas nurašyti“. Aktas nepatvirtintas.`,
          };
        }
        if (realItem.writeOffActId && realItem.writeOffActId !== targetAct.id) {
          return {
            ok: false,
            statusCode: 400,
            error: `Daiktas [${realItem.inventoryNumber}] priklauso kitam nurašymo projektui (${realItem.writeOffActNumber || realItem.writeOffActId}). Aktas nepatvirtintas.`,
          };
        }
      }

      const approvedDateClean = op.approvedDate.trim();
      const orgSnap = db.organizationSettings
        ? cloneOrganizationSettings(db.organizationSettings)
        : undefined;
      const writeOffActs = db.writeOffActs.map((a) =>
        a.id === op.actId
          ? {
              ...a,
              actNumber: finalActNumber,
              status: 'approved' as const,
              actYear: op.approvalYear,
              approvedDate: approvedDateClean,
              ...(orgSnap ? { organizationSnapshot: orgSnap } : {}),
              ...(op.approvedByUserId ? { approvedByUserId: op.approvedByUserId } : {}),
              ...(op.approvedByUserName ? { approvedByUserName: op.approvedByUserName } : {}),
            }
          : a
      );

      const actReasonMap = new Map(targetAct.items.map((it) => [it.itemId, it.reason]));
      const items = db.items.map((i) =>
        seenItemIds.has(i.id)
          ? {
              ...i,
              status: 'written_off' as const,
              writtenOffDate: approvedDateClean,
              writtenOffYear: op.approvalYear,
              writeOffActNumber: finalActNumber,
              writeOffReason: targetAct.reasonCategory || actReasonMap.get(i.id) || i.writeOffReason,
              writeOffActId: targetAct.id,
            }
          : i
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, writeOffActs, items },
      };
    }

    case 'RECONCILE_WRITEOFF_ISSUE': {
      if (op.action === 'return_to_active') {
        if (!op.itemId) return { ok: false, statusCode: 400, error: 'Trūksta daikto ID.' };
        const target = db.items.find((i) => i.id === op.itemId);
        if (!target) return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
        if (target.status !== 'to_writeoff') {
          return { ok: false, statusCode: 400, error: 'Šį veiksmą galima taikyti tik „to_writeoff“ daiktams.' };
        }
        const stillInDraft = db.writeOffActs.some(
          (a) => a.status === 'draft' && a.items.some((ai) => ai.itemId === op.itemId)
        );
        if (stillInDraft) {
          return {
            ok: false,
            statusCode: 400,
            error: 'Daiktas vis dar yra aktyviame nurašymo projekte – naudokite „Atmesti“.',
          };
        }
        const items = db.items.map((i) =>
          i.id === op.itemId
            ? {
                ...i,
                status: 'active' as const,
                writeOffActId: undefined,
                writeOffActNumber: undefined,
                writeOffReason: undefined,
                notes: i.notes
                  ? `${i.notes} | Sutvarkytas nesusietas nurašymo teikimas (${todayStr})`
                  : `Sutvarkytas nesusietas nurašymo teikimas (${todayStr})`,
              }
            : i
        );
        return {
          ok: true,
          database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
        };
      }

      if (op.action === 'remove_stale_draft_item') {
        if (!op.actId || !op.itemId) {
          return { ok: false, statusCode: 400, error: 'Trūksta akto arba daikto ID.' };
        }
        const targetAct = db.writeOffActs.find((a) => a.id === op.actId);
        if (!targetAct || targetAct.status !== 'draft') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Valyti galima tik nepatvirtintų nurašymo projektų įrašus.',
          };
        }
        const writeOffActs = db.writeOffActs.map((a) => {
          if (a.id !== op.actId) return a;
          const remaining = a.items.filter((ai) => ai.itemId !== op.itemId);
          return {
            ...a,
            items: remaining,
            status: remaining.length === 0 ? ('cancelled' as const) : ('draft' as const),
          };
        });
        return {
          ok: true,
          database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, writeOffActs },
        };
      }

      if (op.action === 'link_by_existing_act_number') {
        if (!op.itemId || !op.actId) {
          return { ok: false, statusCode: 400, error: 'Trūksta daikto arba akto ID.' };
        }
        const targetItem = db.items.find((i) => i.id === op.itemId);
        const targetAct = db.writeOffActs.find((a) => a.id === op.actId);
        if (!targetItem || !targetAct || targetAct.status !== 'approved') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Nerastas patvirtintas aktas susiejimui.',
          };
        }
        if (!targetAct.items.some((ai) => ai.itemId === targetItem.id)) {
          return {
            ok: false,
            statusCode: 400,
            error: 'Šis daiktas nėra įtrauktas nurodyto akto sąraše.',
          };
        }
        const items = db.items.map((i) =>
          i.id === op.itemId ? { ...i, writeOffActId: targetAct.id } : i
        );
        return {
          ok: true,
          database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
        };
      }

      return { ok: false, statusCode: 400, error: 'Nežinomas sutvarkymo veiksmas.' };
    }

    case 'SAVE_FAULT_REPORT': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      const desc = op.defectReport?.description?.trim();
      if (!desc) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Gedimo aprašymas yra privalomas.',
        };
      }

      const normalizedReport: DefectReport = {
        ...op.defectReport,
        description: desc,
        status: 'reported',
      };

      const items = db.items.map((i) => {
        if (i.id !== op.itemId) return i;
        const nextReports = [...(i.defectReports || []), normalizedReport];
        // Svarbu: naujas gedimo pranešimas NEKEIČIA item.status (nepradeda remonto,
        // neperrašo to_writeoff / written_off) ir NEBLOGINA item.condition!
        return {
          ...i,
          activeDefectNote: computeActiveDefectNote(nextReports),
          defectReports: nextReports,
        };
      });
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'START_DEFECT_REPAIR': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      const targetDefect = (targetItem.defectReports || []).find((d) => d.id === op.defectId);
      if (!targetDefect) {
        return { ok: false, statusCode: 404, error: 'Gedimo įrašas nerastas.' };
      }

      const permission = canStartDefectRepair(targetItem, targetDefect);
      if (!permission.allowed) {
        return {
          ok: false,
          statusCode: 409,
          error: permission.reason || 'Negalima pradėti remonto šiam daiktui.',
        };
      }

      const startedAt = op.startedAt || nowIso;
      const startedByName = op.startedByUserName?.trim() || 'Darbuotojas';
      const repairNotes = op.repairNotes?.trim();

      const items = db.items.map((i) => {
        if (i.id !== op.itemId) return i;
        const nextReports: DefectReport[] = (i.defectReports || []).map((d) =>
          d.id === op.defectId
            ? {
                ...d,
                status: 'in_repair',
                repairStartedAt: startedAt,
                ...(op.startedByUserId ? { repairStartedByUserId: op.startedByUserId } : {}),
                repairStartedByUserName: startedByName,
                ...(repairNotes ? { repairNotes } : {}),
              }
            : d
        );
        return {
          ...i,
          status: 'in_repair' as const,
          defectReports: nextReports,
          activeDefectNote: computeActiveDefectNote(nextReports),
        };
      });

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'RESOLVE_DEFECT': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      const resolutionNotes = op.resolutionNotes?.trim();
      if (!resolutionNotes) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Užbaigiant gedimą privaloma įrašyti sprendimo pastabą (kas buvo atlikta).',
        };
      }
      const targetDefect = (targetItem.defectReports || []).find((d) => d.id === op.defectId);
      if (!targetDefect) {
        return { ok: false, statusCode: 404, error: 'Gedimo įrašas nerastas.' };
      }
      if (targetDefect.status === 'resolved') {
        return {
          ok: false,
          statusCode: 409,
          error: 'Šis gedimas jau yra pažymėtas kaip išspręstas.',
        };
      }

      const resolvedAt = op.resolvedAt || nowIso;
      const resolvedByName = op.resolvedByUserName?.trim() || 'Darbuotojas';

      const items = db.items.map((i) => {
        if (i.id !== op.itemId) return i;
        const nextReports: DefectReport[] = (i.defectReports || []).map((d) =>
          d.id === op.defectId
            ? {
                ...d,
                status: 'resolved',
                resolvedAt,
                ...(op.resolvedByUserId ? { resolvedByUserId: op.resolvedByUserId } : {}),
                resolvedByUserName: resolvedByName,
                resolutionNotes,
              }
            : d
        );
        const remainingActive = getActiveDefects({ defectReports: nextReports });
        const hasWriteOffPriority = i.status === 'written_off' || i.status === 'to_writeoff';

        let nextStatus = i.status;
        if (!hasWriteOffPriority && remainingActive.length === 0 && op.returnToActive !== false) {
          if (i.status === 'in_repair') {
            nextStatus = 'active';
          }
        }

        const nextCondition =
          !hasWriteOffPriority && op.newCondition ? op.newCondition : i.condition;

        return {
          ...i,
          status: nextStatus,
          condition: nextCondition,
          defectReports: nextReports,
          activeDefectNote: computeActiveDefectNote(nextReports),
        };
      });

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'SAVE_DEPARTMENT': {
      if (!op.department.name?.trim() || !op.department.code?.trim()) {
        return { ok: false, statusCode: 400, error: 'Skyriaus pavadinimas ir kodas yra privalomi.' };
      }
      const exists = db.departments.some((d) => d.id === op.department.id);
      const movements = exists
        ? backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users)
        : db.movements;
      const normalizedDept: Department = {
        ...op.department,
        name: op.department.name.trim(),
        code: op.department.code.trim().toUpperCase(),
      };
      const departments = exists
        ? db.departments.map((d) => (d.id === op.department.id ? normalizedDept : d))
        : [...db.departments, normalizedDept];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, departments, movements },
      };
    }

    case 'DELETE_DEPARTMENT': {
      const targetDept = db.departments.find((d) => d.id === op.departmentId);
      if (!targetDept) {
        return { ok: false, statusCode: 404, error: 'Skyrius nerastas.' };
      }
      const linkedRoomsCount = db.rooms.filter((r) => r.departmentId === op.departmentId).length;
      const linkedItemsCount = db.items.filter((i) => i.departmentId === op.departmentId).length;
      const linkedUsersCount = db.users.filter((u) => u.departmentId === op.departmentId).length;
      const linkedAuditsCount = db.auditSessions.filter(
        (s) => s.status !== 'completed' && s.departmentId === op.departmentId
      ).length;

      if (linkedRoomsCount > 0 || linkedItemsCount > 0 || linkedUsersCount > 0 || linkedAuditsCount > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima ištrinti skyriaus „${targetDept.name}“, nes jis susietas su įrašais (${linkedRoomsCount} kab., ${linkedItemsCount} turto vnt., ${linkedUsersCount} darbuotojais). Pirmiausia perleiskite susijusius įrašus kitam skyriui arba archyvuokite skyrių.`,
        };
      }

      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const auditSessions = db.auditSessions.map((s) =>
        s.status === 'completed' && s.departmentId === op.departmentId && !s.scopeDepartmentName
          ? { ...s, scopeDepartmentName: targetDept.name }
          : s
      );
      const departments = db.departments.filter((d) => d.id !== op.departmentId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, departments, movements, auditSessions },
      };
    }

    case 'ARCHIVE_DEPARTMENT': {
      const targetDept = db.departments.find((d) => d.id === op.departmentId);
      if (!targetDept) {
        return { ok: false, statusCode: 404, error: 'Skyrius nerastas.' };
      }
      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const departments = db.departments.map((d) =>
        d.id === op.departmentId ? { ...d, isArchived: op.isArchived } : d
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, departments, movements },
      };
    }

    case 'TRANSFER_AND_DELETE_DEPARTMENT': {
      if (op.departmentId === op.targetDepartmentId) {
        return { ok: false, statusCode: 400, error: 'Negalima perleisti į tą patį skyrių.' };
      }
      const sourceDept = db.departments.find((d) => d.id === op.departmentId);
      const targetDept = db.departments.find((d) => d.id === op.targetDepartmentId);
      if (!sourceDept || !targetDept) {
        return { ok: false, statusCode: 404, error: 'Šaltinio arba paskirties skyrius nerastas.' };
      }
      if (targetDept.isArchived) {
        return { ok: false, statusCode: 400, error: 'Negalima perleisti įrašų į archyvuotą skyrių.' };
      }

      let movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const addedMovements: MovementRecord[] = [];
      let seqOffset = 0;

      const rooms = db.rooms.map((r) =>
        r.departmentId === op.departmentId ? { ...r, departmentId: op.targetDepartmentId } : r
      );
      const items = db.items.map((it) => {
        if (it.departmentId !== op.departmentId) return it;
        const mov = buildMovementRecord(db, [...addedMovements, ...movements], {
          item: it,
          fromDepartmentId: it.departmentId,
          fromRoomId: it.roomId,
          fromUserId: it.responsibleUserId,
          toDepartmentId: op.targetDepartmentId,
          toRoomId: it.roomId,
          toUserId: it.responsibleUserId,
          reason: `Skyriaus „${sourceDept.name}“ likvidavimas ir perkėlimas į „${targetDept.name}“`,
          seqOffset: seqOffset++,
        });
        addedMovements.unshift(mov);
        return { ...it, departmentId: op.targetDepartmentId };
      });
      movements = [...addedMovements, ...movements];

      const users = db.users.map((u) =>
        u.departmentId === op.departmentId ? { ...u, departmentId: op.targetDepartmentId } : u
      );
      const auditSessions = db.auditSessions.map((s) => {
        if (s.departmentId !== op.departmentId) return s;
        if (s.status === 'completed') {
          return s.scopeDepartmentName ? s : { ...s, scopeDepartmentName: sourceDept.name };
        }
        return { ...s, departmentId: op.targetDepartmentId, scopeDepartmentName: targetDept.name };
      });
      const departments = db.departments.filter((d) => d.id !== op.departmentId);

      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          departments,
          rooms,
          items,
          users,
          auditSessions,
          movements,
        },
      };
    }

    case 'SAVE_ROOM': {
      if (!op.room.name?.trim()) {
        return { ok: false, statusCode: 400, error: 'Patalpos pavadinimas yra privalomas.' };
      }
      const targetDept = db.departments.find((d) => d.id === op.room.departmentId);
      if (!targetDept) {
        return { ok: false, statusCode: 400, error: 'Nurodytas kabineto skyrius nerastas.' };
      }

      const existingRoom = db.rooms.find((r) => r.id === op.room.id);
      let movements = existingRoom
        ? backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users)
        : db.movements;
      let items = db.items;

      // Jei pakeistas kabineto skyrius, nuosekliai atnaujiname visų jame esančių daiktų skyrių ir paliekame judėjimo įrašą
      if (existingRoom && existingRoom.departmentId !== op.room.departmentId) {
        const addedMovements: MovementRecord[] = [];
        let seqOffset = 0;
        const oldDept = db.departments.find((d) => d.id === existingRoom.departmentId);
        items = db.items.map((it) => {
          if (it.roomId !== op.room.id) return it;
          const updatedItem: InventoryItem = {
            ...it,
            departmentId: op.room.departmentId,
          };
          const mov = buildMovementRecord(db, [...addedMovements, ...movements], {
            item: updatedItem,
            fromDepartmentId: it.departmentId,
            fromRoomId: it.roomId,
            fromUserId: it.responsibleUserId,
            toDepartmentId: op.room.departmentId,
            toRoomId: op.room.id,
            toUserId: it.responsibleUserId,
            reason: `Kabineto „${formatRoomName(op.room, true)}“ skyrius pakeistas iš „${oldDept?.name || it.departmentId}“ į „${targetDept.name}“`,
            seqOffset: seqOffset++,
          });
          mov.toRoomName = formatRoomName(op.room, true);
          mov.toDepartmentName = targetDept.name;
          addedMovements.unshift(mov);
          return updatedItem;
        });
        movements = [...addedMovements, ...movements];
      }

      const normalizedRoom: Room = {
        ...op.room,
        name: op.room.name.trim(),
        number: op.room.number?.trim() || undefined,
      };
      const rooms = existingRoom
        ? db.rooms.map((r) => (r.id === op.room.id ? normalizedRoom : r))
        : [...db.rooms, normalizedRoom];
      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          rooms,
          items,
          movements,
        },
      };
    }

    case 'DELETE_ROOM': {
      const targetRoom = db.rooms.find((r) => r.id === op.roomId);
      if (!targetRoom) {
        return { ok: false, statusCode: 404, error: 'Kabinetas nerastas.' };
      }
      const linkedItemsCount = db.items.filter((i) => i.roomId === op.roomId).length;
      const linkedUsersCount = db.users.filter((u) => getUserAssignedRoomIds(u).includes(op.roomId)).length;

      if (linkedItemsCount > 0 || linkedUsersCount > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima ištrinti patalpos „${formatRoomName(targetRoom, true)}“, nes ji vis dar naudojama (${linkedItemsCount} turto vnt., ${linkedUsersCount} darbuotojų priskyrimai). Pirmiausia perkelkite turtą į kitą kabinetą arba archyvuokite patalpą.`,
        };
      }

      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const rooms = db.rooms.filter((r) => r.id !== op.roomId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, rooms, movements },
      };
    }

    case 'ARCHIVE_ROOM': {
      const targetRoom = db.rooms.find((r) => r.id === op.roomId);
      if (!targetRoom) {
        return { ok: false, statusCode: 404, error: 'Kabinetas nerastas.' };
      }
      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const rooms = db.rooms.map((r) =>
        r.id === op.roomId ? { ...r, isArchived: op.isArchived } : r
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, rooms, movements },
      };
    }

    case 'TRANSFER_AND_DELETE_ROOM': {
      if (op.roomId === op.targetRoomId) {
        return { ok: false, statusCode: 400, error: 'Negalima perkelti į tą patį kabinetą.' };
      }
      const sourceRoom = db.rooms.find((r) => r.id === op.roomId);
      const targetRoom = db.rooms.find((r) => r.id === op.targetRoomId);
      if (!sourceRoom || !targetRoom) {
        return { ok: false, statusCode: 404, error: 'Šaltinio arba paskirties kabinetas nerastas.' };
      }
      if (targetRoom.isArchived) {
        return { ok: false, statusCode: 400, error: 'Negalima perkelti turto į archyvuotą kabinetą.' };
      }

      let movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const addedMovements: MovementRecord[] = [];
      let seqOffset = 0;

      const items = db.items.map((it) => {
        if (it.roomId !== op.roomId) return it;
        const mov = buildMovementRecord(db, [...addedMovements, ...movements], {
          item: it,
          fromDepartmentId: it.departmentId,
          fromRoomId: it.roomId,
          fromUserId: it.responsibleUserId,
          toDepartmentId: targetRoom.departmentId,
          toRoomId: targetRoom.id,
          toUserId: it.responsibleUserId,
          reason: `Patalpos „${formatRoomName(sourceRoom, true)}“ perkėlimas į „${formatRoomName(targetRoom, true)}“`,
          seqOffset: seqOffset++,
        });
        addedMovements.unshift(mov);
        return {
          ...it,
          roomId: targetRoom.id,
          departmentId: targetRoom.departmentId,
        };
      });
      movements = [...addedMovements, ...movements];

      const users = db.users.map((u) => {
        const assigned = getUserAssignedRoomIds(u);
        if (!assigned.includes(op.roomId)) return u;
        const updatedIds = Array.from(
          new Set(assigned.map((id) => (id === op.roomId ? op.targetRoomId : id)))
        );
        return {
          ...u,
          assignedRoomId: updatedIds[0],
          assignedRoomIds: updatedIds,
        };
      });

      const rooms = db.rooms.filter((r) => r.id !== op.roomId);

      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          rooms,
          items,
          users,
          movements,
        },
      };
    }

    case 'SAVE_USER': {
      if (!op.user.fullName?.trim() || !op.user.email?.trim()) {
        return { ok: false, statusCode: 400, error: 'Darbuotojo vardas ir el. paštas yra privalomi.' };
      }
      const exists = db.users.some((u) => u.id === op.user.id);
      const movements = exists
        ? backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users)
        : db.movements;
      const users = exists
        ? db.users.map((u) => (u.id === op.user.id ? op.user : u))
        : [...db.users, op.user];
      let authSettings = db.authSettings;
      if (op.user.role === 'admin' && op.user.pinCode && authSettings) {
        authSettings = { ...authSettings, adminPin: op.user.pinCode };
      }
      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          users,
          movements,
          ...(authSettings ? { authSettings } : {}),
        },
      };
    }

    case 'DELETE_USER': {
      const targetUser = db.users.find((u) => u.id === op.userId);
      if (!targetUser) {
        return { ok: false, statusCode: 404, error: 'Darbuotojas nerastas.' };
      }
      const linkedItemsCount = db.items.filter((i) => i.responsibleUserId === op.userId).length;
      const linkedDeptsCount = db.departments.filter((d) => d.managerId === op.userId).length;
      const linkedRoomsCount = db.rooms.filter((r) => r.defaultResponsiblePersonId === op.userId).length;
      const linkedAuditsCount = db.auditSessions.filter(
        (s) => s.status !== 'completed' && s.committeeChairmanId === op.userId
      ).length;

      if (linkedItemsCount > 0 || linkedDeptsCount > 0 || linkedRoomsCount > 0 || linkedAuditsCount > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima pašalinti darbuotojo „${targetUser.fullName}“, nes jam priskirtas turtas arba pareigos (${linkedItemsCount} turto vnt., ${linkedRoomsCount} kab., ${linkedDeptsCount} sk.). Pirmiausia perleiskite atsakomybę kitam asmeniui arba archyvuokite darbuotoją.`,
        };
      }

      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const auditSessions = db.auditSessions.map((s) =>
        s.status === 'completed' && s.committeeChairmanId === op.userId && !s.committeeChairman
          ? {
              ...s,
              committeeChairman: `${targetUser.fullName} (${targetUser.roleTitle || 'Komisijos pirmininkas'})`,
            }
          : s
      );
      const users = db.users.filter((u) => u.id !== op.userId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, users, movements, auditSessions },
      };
    }

    case 'ARCHIVE_USER': {
      const targetUser = db.users.find((u) => u.id === op.userId);
      if (!targetUser) {
        return { ok: false, statusCode: 404, error: 'Darbuotojas nerastas.' };
      }
      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const users = db.users.map((u) =>
        u.id === op.userId
          ? {
              ...u,
              isArchived: op.isArchived,
              isActive: op.isArchived ? false : true,
            }
          : u
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, users, movements },
      };
    }

    case 'TRANSFER_AND_DELETE_USER': {
      if (op.userId === op.targetUserId) {
        return { ok: false, statusCode: 400, error: 'Negalima perleisti atsakomybės tam pačiam darbuotojui.' };
      }
      const sourceUser = db.users.find((u) => u.id === op.userId);
      const targetUser = db.users.find((u) => u.id === op.targetUserId);
      if (!sourceUser || !targetUser) {
        return { ok: false, statusCode: 404, error: 'Šaltinio arba paskirties darbuotojas nerastas.' };
      }
      if (targetUser.isArchived) {
        return { ok: false, statusCode: 400, error: 'Negalima perleisti turto archyvuotam darbuotojui.' };
      }

      let movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const addedMovements: MovementRecord[] = [];
      let seqOffset = 0;

      const items = db.items.map((it) => {
        if (it.responsibleUserId !== op.userId) return it;
        const mov = buildMovementRecord(db, [...addedMovements, ...movements], {
          item: it,
          fromDepartmentId: it.departmentId,
          fromRoomId: it.roomId,
          fromUserId: it.responsibleUserId,
          toDepartmentId: it.departmentId,
          toRoomId: it.roomId,
          toUserId: op.targetUserId,
          reason: `Materialinės atsakomybės perdavimas iš „${sourceUser.fullName}“ darbuotojui „${targetUser.fullName}“`,
          seqOffset: seqOffset++,
        });
        addedMovements.unshift(mov);
        return { ...it, responsibleUserId: op.targetUserId };
      });
      movements = [...addedMovements, ...movements];

      const departments = db.departments.map((d) =>
        d.managerId === op.userId ? { ...d, managerId: op.targetUserId } : d
      );
      const rooms = db.rooms.map((r) =>
        r.defaultResponsiblePersonId === op.userId
          ? { ...r, defaultResponsiblePersonId: op.targetUserId }
          : r
      );
      const auditSessions = db.auditSessions.map((s) => {
        if (s.committeeChairmanId !== op.userId) return s;
        if (s.status === 'completed') {
          // Užbaigtų inventorizacijų istorinio pirmininko niekada neperrašome nauju darbuotoju!
          return s.committeeChairman
            ? s
            : {
                ...s,
                committeeChairman: `${sourceUser.fullName} (${sourceUser.roleTitle || 'Komisijos pirmininkas'})`,
              };
        }
        return {
          ...s,
          committeeChairmanId: op.targetUserId,
          committeeChairman: `${targetUser.fullName} (${targetUser.roleTitle || 'Komisijos pirmininkas'})`,
        };
      });
      const users = db.users.filter((u) => u.id !== op.userId);

      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          users,
          items,
          departments,
          rooms,
          auditSessions,
          movements,
        },
      };
    }

    case 'BATCH_IMPORT_USERS': {
      if (!Array.isArray(op.users) || op.users.length === 0) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Importuojamų darbuotojų sąrašas negali būti tuščias.',
        };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const batchSeenEmails = new Set<string>();
      const batchSeenGmails = new Set<string>();
      const validatedIncoming: User[] = [];

      // Atominė visų eilučių patikra prieš atliekant bet kokius pakeitimus
      for (let i = 0; i < op.users.length; i++) {
        const rawUser = op.users[i];
        const rowLabel = `Įrašas #${i + 1}`;
        const fullName = rawUser?.fullName?.trim();
        const email = rawUser?.email?.trim().toLowerCase();

        if (!fullName) {
          return {
            ok: false,
            statusCode: 400,
            error: `${rowLabel}: trūksta darbuotojo vardo ir pavardės.`,
          };
        }
        if (!email || !emailRegex.test(email)) {
          return {
            ok: false,
            statusCode: 400,
            error: `${rowLabel} („${fullName}“): neteisingas el. pašto adresas („${rawUser?.email || ''}“).`,
          };
        }
        if (batchSeenEmails.has(email)) {
          return {
            ok: false,
            statusCode: 400,
            error: `${rowLabel}: pasikartojantis el. paštas „${email}“ tame pačiame importe.`,
          };
        }
        batchSeenEmails.add(email);

        const allowedGmail = rawUser.allowedGmail?.trim().toLowerCase() || undefined;
        if (allowedGmail) {
          if (!emailRegex.test(allowedGmail)) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel} („${fullName}“): neteisingas papildomas Gmail adresas „${allowedGmail}“.`,
            };
          }
          if (batchSeenGmails.has(allowedGmail)) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel}: pasikartojantis leidžiamas Gmail „${allowedGmail}“ tame pačiame importe.`,
            };
          }
          batchSeenGmails.add(allowedGmail);
        }

        if (rawUser.departmentId) {
          const dept = db.departments.find((d) => d.id === rawUser.departmentId);
          if (!dept) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel} („${fullName}“): nurodytas neegzistuojantis skyrius „${rawUser.departmentId}“.`,
            };
          }
          if (dept.isArchived) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel} („${fullName}“): negalima priskirti archyvuoto skyriaus „${dept.name}“.`,
            };
          }
        }

        const roomIds = getUserAssignedRoomIds(rawUser);
        for (const rId of roomIds) {
          const room = db.rooms.find((r) => r.id === rId);
          if (!room) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel} („${fullName}“): nurodytas neegzistuojantis kabinetas „${rId}“.`,
            };
          }
          if (room.isArchived) {
            return {
              ok: false,
              statusCode: 400,
              error: `${rowLabel} („${fullName}“): negalima priskirti archyvuotos patalpos „${formatRoomName(room)}“.`,
            };
          }
        }

        const existingMatch = db.users.find((u) => u.email.trim().toLowerCase() === email);
        const gmailOwner = allowedGmail
          ? db.users.find(
              (u) =>
                u.id !== existingMatch?.id &&
                (u.email.trim().toLowerCase() === allowedGmail ||
                  (u.allowedGmail && u.allowedGmail.trim().toLowerCase() === allowedGmail))
            )
          : undefined;
        if (gmailOwner) {
          return {
            ok: false,
            statusCode: 400,
            error: `${rowLabel} („${fullName}“): Gmail „${allowedGmail}“ jau priskirtas darbuotojui „${gmailOwner.fullName}“.`,
          };
        }

        const emailInOtherGmail = db.users.find(
          (u) =>
            u.id !== existingMatch?.id &&
            u.allowedGmail &&
            u.allowedGmail.trim().toLowerCase() === email
        );
        if (emailInOtherGmail) {
          return {
            ok: false,
            statusCode: 400,
            error: `${rowLabel} („${fullName}“): el. paštas „${email}“ jau naudojamas darbuotojo „${emailInOtherGmail.fullName}“ Gmail lauke.`,
          };
        }

        validatedIncoming.push({
          ...rawUser,
          fullName,
          email,
          ...(allowedGmail ? { allowedGmail } : {}),
          assignedRoomId: roomIds[0] || undefined,
          assignedRoomIds: roomIds.length > 0 ? roomIds : undefined,
        });
      }

      const updatedUsers = [...db.users];
      const usedIds = new Set(updatedUsers.map((u) => u.id));

      validatedIncoming.forEach((incoming, idx) => {
        const existingIdx = updatedUsers.findIndex(
          (u) => u.email.trim().toLowerCase() === incoming.email
        );

        if (existingIdx !== -1) {
          const existing = updatedUsers[existingIdx];
          const incomingRooms = getUserAssignedRoomIds(incoming);
          const preservedRooms = getUserAssignedRoomIds(existing);
          const finalRooms = incomingRooms.length > 0 ? incomingRooms : preservedRooms;
          const finalDept = incoming.departmentId || existing.departmentId;
          const finalRoleTitle = incoming.roleTitle?.trim() || existing.roleTitle || 'Mokytojas';
          const finalPhone = incoming.phone?.trim() || existing.phone;
          const finalGmail = incoming.allowedGmail || existing.allowedGmail;

          updatedUsers[existingIdx] = {
            ...existing,
            fullName: incoming.fullName,
            email: existing.email.trim().toLowerCase(),
            roleTitle: finalRoleTitle,
            // Griežta apsauga: masinis CSV importas NIEKADA nekeičia esamų rolių, PIN, aktyvumo ar archyvavimo
            role: existing.role,
            pinCode: existing.pinCode,
            isActive: existing.isArchived ? false : existing.isActive,
            isArchived: existing.isArchived,
            ...(finalPhone ? { phone: finalPhone } : {}),
            ...(finalGmail ? { allowedGmail: finalGmail } : {}),
            ...(finalDept ? { departmentId: finalDept } : {}),
            assignedRoomId: finalRooms[0] || undefined,
            assignedRoomIds: finalRooms.length > 0 ? finalRooms : undefined,
          };
        } else {
          let newId = incoming.id?.trim() || `usr-${Date.now().toString(36)}-${idx}`;
          while (usedIds.has(newId)) {
            newId = `${newId}-${Math.random().toString(36).slice(2, 6)}`;
          }
          usedIds.add(newId);
          const finalRooms = getUserAssignedRoomIds(incoming);
          const inferredDept =
            incoming.departmentId ||
            (finalRooms[0] ? db.rooms.find((r) => r.id === finalRooms[0])?.departmentId : undefined);

          updatedUsers.push({
            id: newId,
            fullName: incoming.fullName,
            email: incoming.email,
            role: 'teacher',
            roleTitle: incoming.roleTitle?.trim() || 'Mokytojas',
            ...(inferredDept ? { departmentId: inferredDept } : {}),
            ...(finalRooms[0] ? { assignedRoomId: finalRooms[0] } : {}),
            ...(finalRooms.length > 0 ? { assignedRoomIds: finalRooms } : {}),
            ...(incoming.phone?.trim() ? { phone: incoming.phone.trim() } : {}),
            ...(incoming.allowedGmail ? { allowedGmail: incoming.allowedGmail } : {}),
            isActive: true,
            isArchived: false,
          });
        }
      });

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, users: updatedUsers },
      };
    }

    case 'UPDATE_AUTH_SETTINGS': {
      const users = op.authSettings.adminPin
        ? db.users.map((u) =>
            u.role === 'admin' ? { ...u, pinCode: op.authSettings.adminPin } : u
          )
        : db.users;
      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          authSettings: op.authSettings,
          users,
        },
      };
    }

    case 'UPDATE_ORGANIZATION_SETTINGS': {
      const s = op.organizationSettings;
      if (!s.name?.trim() || !s.code?.trim() || !s.address?.trim() || !s.directorTitle?.trim()) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Įstaigos pavadinimas, juridinio asmens kodas, adresas ir vadovo pareigos yra privalomi.',
        };
      }
      const nextSettings = cloneOrganizationSettings(s);
      // Istoriniai jau užbaigti dokumentai (completed AuditSession ir approved WriteOffAct) NIEKADA neperrašomi!
      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          organizationSettings: nextSettings,
        },
      };
    }

    case 'UPDATE_AUDIT_SESSION': {
      const existing = db.auditSessions.find((s) => s.id === op.session.id);
      if (existing?.status === 'completed') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Užbaigtos inventorizacijos sesijos rezultatų negalima tyliai redaguoti.',
        };
      }
      const auditSessions = existing
        ? db.auditSessions.map((s) => (s.id === op.session.id ? op.session : s))
        : [op.session, ...db.auditSessions];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions },
      };
    }

    case 'CREATE_AUDIT_SESSION': {
      const trimmedTitle = op.session.title?.trim();
      if (!trimmedTitle) {
        return { ok: false, statusCode: 400, error: 'Inventorizacijos pavadinimas yra privalomas.' };
      }
      if (!Number.isFinite(op.session.year) || op.session.year < 2000 || op.session.year > 2100) {
        return { ok: false, statusCode: 400, error: 'Nurodyti neteisingi inventorizacijos metai.' };
      }
      if (db.auditSessions.some((s) => s.id === op.session.id)) {
        return { ok: false, statusCode: 409, error: 'Sesija su tokiu ID jau egzistuoja.' };
      }
      let scopeDeptName = 'Visi skyriai (visa gimnazija)';
      if (op.session.departmentId) {
        const dept = db.departments.find((d) => d.id === op.session.departmentId);
        if (!dept) {
          return { ok: false, statusCode: 404, error: 'Pasirinktas skyrius nerastas.' };
        }
        scopeDeptName = dept.name;
      }

      const includeInRepair = op.session.includeInRepair ?? true;
      const includeToWriteOff = op.session.includeToWriteOff ?? true;
      const snapshotItems = buildAuditSnapshotItems(db, {
        departmentId: op.session.departmentId,
        includeInRepair,
        includeToWriteOff,
      });

      const created: AuditSession = {
        id: op.session.id,
        year: op.session.year,
        title: trimmedTitle,
        status: 'in_progress',
        startDate: op.session.startDate || todayStr,
        ...(op.session.departmentId ? { departmentId: op.session.departmentId } : {}),
        scopeDepartmentName: scopeDeptName,
        includeInRepair,
        includeToWriteOff,
        committeeChairman: op.session.committeeChairman,
        committeeChairmanId: op.session.committeeChairmanId,
        committeeMembers: op.session.committeeMembers || [],
        orderNumber: op.session.orderNumber,
        orderDate: op.session.orderDate,
        notes: op.session.notes,
        scannedItemIds: [],
        missingItemIds: [],
        relocatedItemIds: [],
        snapshotItems,
        checkRecords: {},
      };

      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          auditSessions: [created, ...db.auditSessions],
        },
      };
    }

    case 'UPDATE_AUDIT_SESSION_SETTINGS': {
      const target = db.auditSessions.find((s) => s.id === op.sessionId);
      if (!target) {
        return { ok: false, statusCode: 404, error: 'Inventorizacijos sesija nerasta.' };
      }
      if (target.status === 'completed') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Užbaigtos inventorizacijos sesijos nustatymų keisti negalima.',
        };
      }
      const trimmedTitle = op.title?.trim();
      if (!trimmedTitle) {
        return { ok: false, statusCode: 400, error: 'Inventorizacijos pavadinimas negali būti tuščias.' };
      }

      const auditSessions = db.auditSessions.map((s) =>
        s.id === op.sessionId
          ? {
              ...s,
              title: trimmedTitle,
              year: op.year,
              committeeChairman: op.committeeChairman,
              committeeChairmanId: op.committeeChairmanId,
              committeeMembers: op.committeeMembers,
              orderNumber: op.orderNumber,
              orderDate: op.orderDate,
              notes: op.notes,
            }
          : s
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions },
      };
    }

    case 'RECORD_AUDIT_CHECK': {
      const session = db.auditSessions.find((s) => s.id === op.sessionId);
      if (!session) {
        return { ok: false, statusCode: 404, error: 'Inventorizacijos sesija nerasta.' };
      }
      if (session.status === 'completed') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Užbaigtoje inventorizacijos sesijoje naujų patikrinimų registruoti negalima.',
        };
      }

      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }

      const actualRoom = db.rooms.find((r) => r.id === op.actualRoomId);
      if (!actualRoom) {
        return { ok: false, statusCode: 404, error: 'Nurodytas tikrinimo kabinetas nerastas.' };
      }

      const scopeEval = evaluateItemAuditScope(session, targetItem, actualRoom, {
        action: 'check',
        confirmExcludedStatus: op.confirmExcludedStatus,
      });
      if (!scopeEval.allowed) {
        return {
          ok: false,
          statusCode: 400,
          error: scopeEval.message,
        };
      }

      const existingRecord = session.checkRecords?.[op.itemId];
      const snapMatch = session.snapshotItems?.find((s) => s.itemId === op.itemId);
      const expectedDeptId =
        snapMatch?.expectedDepartmentId || existingRecord?.expectedDepartmentId || targetItem.departmentId;
      const expectedRoomId =
        snapMatch?.expectedRoomId || existingRecord?.expectedRoomId || targetItem.roomId;

      const expectedRoom = db.rooms.find((r) => r.id === expectedRoomId);
      const expectedRoomName =
        snapMatch?.expectedRoomName ||
        existingRecord?.expectedRoomName ||
        formatRoomName(expectedRoom, true);
      const actualRoomName = formatRoomName(actualRoom, true);
      const outcome = expectedRoomId === actualRoom.id ? 'found' : 'found_elsewhere';
      const checkedAt = op.checkedAt || nowIso;
      const auditDateOnly = getCalendarDatePart(checkedAt) || todayStr;

      const itemSnapshot =
        existingRecord?.itemSnapshot ||
        buildAuditCheckItemSnapshot(
          { departments: db.departments, users: db.users },
          targetItem,
          expectedDeptId,
          snapMatch
        );
      const isAdditionalFinding = existingRecord?.isAdditionalFinding ?? scopeEval.isAdditionalFinding;
      const excludedStatusException = Boolean(
        existingRecord?.excludedStatusException || scopeEval.excludedStatusException
      );

      const nextRecord: AuditCheckRecord = {
        itemId: op.itemId,
        outcome,
        method: op.method,
        checkedAt,
        ...(op.checkedByUserId ? { checkedByUserId: op.checkedByUserId } : {}),
        checkedByUserName: op.checkedByUserName || 'Komisijos narys',
        expectedDepartmentId: expectedDeptId,
        expectedRoomId,
        expectedRoomName,
        actualDepartmentId: actualRoom.departmentId,
        actualRoomId: actualRoom.id,
        actualRoomName,
        isAdditionalFinding,
        ...(excludedStatusException ? { excludedStatusException: true } : {}),
        itemSnapshot,
        ...(existingRecord?.officialTransferDone
          ? {
              officialTransferDone: existingRecord.officialTransferDone,
              officialMovementId: existingRecord.officialMovementId,
              officialTransferredAt: existingRecord.officialTransferredAt,
              officialTransferredByName: existingRecord.officialTransferredByName,
            }
          : {}),
        ...(op.notes ? { notes: op.notes } : existingRecord?.notes ? { notes: existingRecord.notes } : {}),
      };

      const auditSessions = db.auditSessions.map((s) => {
        if (s.id !== op.sessionId) return s;
        const scannedItemIds = s.scannedItemIds.includes(op.itemId)
          ? s.scannedItemIds
          : [...s.scannedItemIds, op.itemId];
        const missingItemIds = s.missingItemIds.filter((id) => id !== op.itemId);
        const relocatedItemIds =
          outcome === 'found_elsewhere' || existingRecord?.officialTransferDone
            ? s.relocatedItemIds.includes(op.itemId)
              ? s.relocatedItemIds
              : [...s.relocatedItemIds, op.itemId]
            : s.relocatedItemIds.filter((id) => id !== op.itemId);

        return {
          ...s,
          scannedItemIds,
          missingItemIds,
          relocatedItemIds,
          checkRecords: {
            ...(s.checkRecords || {}),
            [op.itemId]: nextRecord,
          },
        };
      });

      // Atnaujiname TIK daikto lastAuditDate – registro vietos (roomId/departmentId) NEKEIČIAME automatiškai!
      const items = db.items.map((i) =>
        i.id === op.itemId ? { ...i, lastAuditDate: auditDateOnly } : i
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions, items },
      };
    }

    case 'MARK_AUDIT_ITEM_MISSING': {
      const session = db.auditSessions.find((s) => s.id === op.sessionId);
      if (!session) {
        return { ok: false, statusCode: 404, error: 'Inventorizacijos sesija nerasta.' };
      }
      if (session.status === 'completed') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Užbaigtos inventorizacijos sesijos rezultatų keisti negalima.',
        };
      }
      const targetItem = db.items.find((i) => i.id === op.itemId);
      const inSnapshot = session.snapshotItems?.some((s) => s.itemId === op.itemId) ?? false;
      if (!targetItem && !inSnapshot) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      if (targetItem) {
        const scopeEval = evaluateItemAuditScope(session, targetItem, null, {
          action: 'mark_missing',
        });
        if (!scopeEval.allowed) {
          return {
            ok: false,
            statusCode: 400,
            error: scopeEval.message,
          };
        }
      }
      if (session.checkRecords?.[op.itemId] || session.scannedItemIds.includes(op.itemId)) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Šis turtas šioje sesijoje jau užfiksuotas kaip rastas.',
        };
      }
      const auditSessions = db.auditSessions.map((s) =>
        s.id === op.sessionId
          ? {
              ...s,
              missingItemIds: s.missingItemIds.includes(op.itemId)
                ? s.missingItemIds
                : [...s.missingItemIds, op.itemId],
            }
          : s
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions },
      };
    }

    case 'COMPLETE_AUDIT_SESSION': {
      const session = db.auditSessions.find((s) => s.id === op.sessionId);
      if (!session) {
        return { ok: false, statusCode: 404, error: 'Inventorizacijos sesija nerasta.' };
      }
      if (session.status === 'completed') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Ši inventorizacijos sesija jau yra užbaigta.',
        };
      }

      const frozenSnapshot =
        session.snapshotItems ??
        (() => {
          const scopeItems = db.items.filter(
            (item) =>
              isItemInAuditScope(item, {
                departmentId: session.departmentId,
                includeInRepair: session.includeInRepair,
                includeToWriteOff: session.includeToWriteOff,
              }) ||
              session.scannedItemIds.includes(item.id) ||
              session.missingItemIds.includes(item.id)
          );
          return buildAuditSnapshotItems(
            { items: scopeItems, departments: db.departments, rooms: db.rooms, users: db.users },
            {}
          );
        })();

      const checkRecords = session.checkRecords || {};
      const scannedSet = new Set(session.scannedItemIds || []);
      const missingSet = new Set(session.missingItemIds || []);
      const relocatedSet = new Set(session.relocatedItemIds || []);

      let foundInPlaceCount = 0;
      let foundElsewhereCount = 0;
      const finalMissingIds = new Set(missingSet);

      for (const snap of frozenSnapshot) {
        const rec = checkRecords[snap.itemId];
        if (rec) {
          finalMissingIds.delete(snap.itemId);
          if (rec.outcome === 'found_elsewhere') foundElsewhereCount++;
          else foundInPlaceCount++;
        } else if (relocatedSet.has(snap.itemId)) {
          finalMissingIds.delete(snap.itemId);
          foundElsewhereCount++;
        } else if (scannedSet.has(snap.itemId)) {
          finalMissingIds.delete(snap.itemId);
          foundInPlaceCount++;
        } else {
          finalMissingIds.add(snap.itemId);
        }
      }

      // Papildomus radinius (nebuvusius pradiniame sąraše) skaičiuojame atskirai, kad pradinė apimtis nesikeistų
      const snapIds = new Set(frozenSnapshot.map((s) => s.itemId));
      let additionalFindingsCount = 0;
      for (const id of Object.keys(checkRecords)) {
        if (!snapIds.has(id)) {
          additionalFindingsCount++;
        }
      }

      const sessionOrgSnapshot = db.organizationSettings
        ? cloneOrganizationSettings(db.organizationSettings)
        : undefined;
      const auditSessions = db.auditSessions.map((s) =>
        s.id === op.sessionId
          ? {
              ...s,
              status: 'completed' as const,
              completedDate: op.completedDate || todayStr,
              ...(op.completedByUserId ? { completedByUserId: op.completedByUserId } : {}),
              ...(op.completedByUserName ? { completedByUserName: op.completedByUserName } : {}),
              snapshotItems: frozenSnapshot,
              missingItemIds: Array.from(finalMissingIds),
              ...(sessionOrgSnapshot ? { organizationSnapshot: sessionOrgSnapshot } : {}),
              completionSummary: {
                totalExpected: frozenSnapshot.length,
                foundInPlaceCount,
                foundElsewhereCount,
                missingCount: finalMissingIds.size,
                additionalFindingsCount,
              },
              ...(op.notes !== undefined ? { notes: op.notes } : {}),
            }
          : s
      );

      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions },
      };
    }

    case 'RELOCATE_AUDIT_ITEM': {
      let targetSession: AuditSession | undefined;
      if (op.sessionId) {
        targetSession = db.auditSessions.find((s) => s.id === op.sessionId);
        if (!targetSession) {
          return { ok: false, statusCode: 404, error: 'Inventorizacijos sesija nerasta.' };
        }
        if (targetSession.status === 'completed') {
          return {
            ok: false,
            statusCode: 400,
            error: 'Užbaigtoje inventorizacijos sesijoje turto perkėlimo registruoti negalima.',
          };
        }
      }

      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      if (targetItem.status === 'written_off') {
        return {
          ok: false,
          statusCode: 400,
          error: 'Negalima perkelti jau nurašyto turto.',
        };
      }
      const targetRoom = db.rooms.find((r) => r.id === op.newRoomId);
      if (!targetRoom) {
        return { ok: false, statusCode: 404, error: 'Tikslinis kabinetas nerastas.' };
      }

      let relocateScopeEval: ReturnType<typeof evaluateItemAuditScope> | null = null;
      if (targetSession) {
        relocateScopeEval = evaluateItemAuditScope(targetSession, targetItem, targetRoom, {
          action: 'relocate',
          confirmExcludedStatus: op.confirmExcludedStatus,
        });
        if (!relocateScopeEval.allowed) {
          return {
            ok: false,
            statusCode: 400,
            error: relocateScopeEval.message,
          };
        }
      }

      const nextResponsibleUserId =
        targetRoom.defaultResponsiblePersonId || targetItem.responsibleUserId;
      let movements = db.movements;
      let createdMovementId: string | undefined;

      if (
        targetItem.roomId !== op.newRoomId ||
        targetItem.departmentId !== targetRoom.departmentId ||
        targetItem.responsibleUserId !== nextResponsibleUserId
      ) {
        const mov = buildMovementRecord(db, db.movements, {
          item: targetItem,
          fromDepartmentId: targetItem.departmentId,
          fromRoomId: targetItem.roomId,
          fromUserId: targetItem.responsibleUserId,
          toDepartmentId: targetRoom.departmentId,
          toRoomId: op.newRoomId,
          toUserId: nextResponsibleUserId,
          reason: `Oficialus perkėlimas po inventorizacijos patikros (${op.auditDate})`,
        });
        createdMovementId = mov.id;
        movements = [mov, ...db.movements];
      }

      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              roomId: op.newRoomId,
              departmentId: targetRoom.departmentId,
              responsibleUserId: nextResponsibleUserId,
              lastAuditDate: op.auditDate,
            }
          : i
      );

      let auditSessions = db.auditSessions;
      if (op.sessionId) {
        auditSessions = db.auditSessions.map((s) => {
          if (s.id !== op.sessionId) return s;
          const prevRec = s.checkRecords?.[op.itemId];
          const snapMatch = s.snapshotItems?.find((sn) => sn.itemId === op.itemId);
          const expectedDeptId =
            snapMatch?.expectedDepartmentId || prevRec?.expectedDepartmentId || targetItem.departmentId;
          const expectedRoomId =
            snapMatch?.expectedRoomId || prevRec?.expectedRoomId || targetItem.roomId;
          const expectedRoom = db.rooms.find((r) => r.id === expectedRoomId);
          const itemSnapshot =
            prevRec?.itemSnapshot ||
            buildAuditCheckItemSnapshot(
              { departments: db.departments, users: db.users },
              targetItem,
              expectedDeptId,
              snapMatch
            );
          const isAdditionalFinding =
            prevRec?.isAdditionalFinding ??
            (relocateScopeEval?.allowed ? relocateScopeEval.isAdditionalFinding : false);
          const excludedStatusException = Boolean(
            prevRec?.excludedStatusException ||
              (relocateScopeEval?.allowed && relocateScopeEval.excludedStatusException)
          );

          const updatedRec: AuditCheckRecord = {
            itemId: op.itemId,
            outcome: expectedRoomId === targetRoom.id ? 'found' : 'found_elsewhere',
            method: prevRec?.method || 'qr',
            checkedAt: prevRec?.checkedAt || nowIso,
            checkedByUserId: prevRec?.checkedByUserId || op.transferredByUserId,
            checkedByUserName:
              prevRec?.checkedByUserName || op.transferredByUserName || 'Komisijos narys',
            expectedDepartmentId: expectedDeptId,
            expectedRoomId,
            expectedRoomName:
              snapMatch?.expectedRoomName ||
              prevRec?.expectedRoomName ||
              formatRoomName(expectedRoom, true),
            actualDepartmentId: targetRoom.departmentId,
            actualRoomId: targetRoom.id,
            actualRoomName: formatRoomName(targetRoom, true),
            isAdditionalFinding,
            ...(excludedStatusException ? { excludedStatusException: true } : {}),
            itemSnapshot,
            officialTransferDone: true,
            ...(createdMovementId ? { officialMovementId: createdMovementId } : {}),
            officialTransferredAt: nowIso,
            ...(op.transferredByUserName
              ? { officialTransferredByName: op.transferredByUserName }
              : {}),
            ...(prevRec?.notes ? { notes: prevRec.notes } : {}),
          };

          return {
            ...s,
            scannedItemIds: s.scannedItemIds.includes(op.itemId)
              ? s.scannedItemIds
              : [...s.scannedItemIds, op.itemId],
            missingItemIds: s.missingItemIds.filter((id) => id !== op.itemId),
            relocatedItemIds: s.relocatedItemIds.includes(op.itemId)
              ? s.relocatedItemIds
              : [...s.relocatedItemIds, op.itemId],
            checkRecords: {
              ...(s.checkRecords || {}),
              [op.itemId]: updatedRec,
            },
          };
        });
      }

      return {
        ok: true,
        database: {
          ...db,
          version: CURRENT_DB_VERSION,
          exportedAt: nowIso,
          items,
          movements,
          auditSessions,
        },
      };
    }
  }
}
