import {
  Department,
  Room,
  User,
  InventoryItem,
  MovementRecord,
  WriteOffAct,
  AuditSession,
  AuthSettings,
  DefectReport,
  ItemCondition,
  formatRoomName,
  getUserAssignedRoomIds,
} from '../types/inventory';
import { AppDatabase, CURRENT_DB_VERSION, isValidIsoDateString } from './databaseValidation';

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
    }
  | {
      type: 'APPROVE_ITEM_WRITEOFF';
      itemId: string;
      approvalYear: number;
      actNumber: string;
      approvedDate: string;
      fallbackNotes?: string;
    }
  | { type: 'REJECT_WRITEOFF'; itemId: string }
  | { type: 'RESTORE_FROM_ARCHIVE'; itemId: string; noteAppend: string }
  | { type: 'SAVE_WRITEOFF_ACT'; act: WriteOffAct }
  | {
      type: 'APPROVE_WRITEOFF_ACT';
      actId: string;
      approvalYear: number;
      approvedDate: string;
    }
  | {
      type: 'SAVE_FAULT_REPORT';
      itemId: string;
      defectReport: DefectReport;
      defectNote: string;
      newCondition: ItemCondition;
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
  | { type: 'UPDATE_AUDIT_SESSION'; session: AuditSession }
  | {
      type: 'RELOCATE_AUDIT_ITEM';
      itemId: string;
      newRoomId: string;
      auditDate: string;
    };

export function getTouchedEntityKeys(db: AppDatabase, op: DbMutation): string[] {
  switch (op.type) {
    case 'SAVE_ITEM':
      return [`item:${op.item.id}`];
    case 'DELETE_ITEM':
      return [`item:${op.itemId}`];
    case 'TRANSFER_ITEM':
      return [`item:${op.record.itemId}`, `movement:${op.record.id}`];
    case 'CONFIRM_WRITEOFF':
      return [`item:${op.itemId}`, `act:${op.act.id}`];
    case 'APPROVE_ITEM_WRITEOFF': {
      const actKeys = db.writeOffActs
        .filter((a) => a.items.some((ai) => ai.itemId === op.itemId))
        .map((a) => `act:${a.id}`);
      return [`item:${op.itemId}`, ...actKeys];
    }
    case 'REJECT_WRITEOFF':
      return [`item:${op.itemId}`];
    case 'RESTORE_FROM_ARCHIVE':
      return [`item:${op.itemId}`];
    case 'SAVE_WRITEOFF_ACT':
      return [`act:${op.act.id}`];
    case 'APPROVE_WRITEOFF_ACT': {
      const act = db.writeOffActs.find((a) => a.id === op.actId);
      const itemKeys = act ? act.items.map((it) => `item:${it.itemId}`) : [];
      return [`act:${op.actId}`, ...itemKeys];
    }
    case 'SAVE_FAULT_REPORT':
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
    case 'UPDATE_AUDIT_SESSION':
      return [`audit:${op.session.id}`];
    case 'RELOCATE_AUDIT_ITEM':
      return [`item:${op.itemId}`];
  }
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
  const year = new Date().getFullYear();
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
    date: params.date || new Date().toISOString().replace('T', ' ').slice(0, 16),
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
  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);

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
      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'to_writeoff' as const,
              condition: 'poor' as const,
              notes: op.notes ? `${i.notes ? i.notes + ' | ' : ''}Defektas: ${op.notes}` : i.notes,
            }
          : i
      );
      const writeOffActs = [op.act, ...db.writeOffActs];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, writeOffActs },
      };
    }

    case 'APPROVE_ITEM_WRITEOFF': {
      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'written_off' as const,
              writtenOffDate: op.approvedDate,
              writtenOffYear: op.approvalYear,
              writeOffActNumber: op.actNumber,
              writeOffReason:
                i.writeOffReason || op.fallbackNotes || 'Komisijos patvirtintas nurašymas',
            }
          : i
      );
      const writeOffActs = db.writeOffActs.map((act) =>
        act.items.some((actItem) => actItem.itemId === op.itemId)
          ? {
              ...act,
              status: 'approved' as const,
              actYear: op.approvalYear,
              approvedDate: op.approvedDate,
            }
          : act
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, writeOffActs },
      };
    }

    case 'REJECT_WRITEOFF': {
      const items = db.items.map((i) =>
        i.id === op.itemId ? { ...i, status: 'active' as const } : i
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'RESTORE_FROM_ARCHIVE': {
      const items = db.items.map((i) =>
        i.id === op.itemId
          ? {
              ...i,
              status: 'active' as const,
              condition: 'good' as const,
              notes: i.notes
                ? `${i.notes} (${op.noteAppend || `Atkurta iš ${i.writtenOffYear || ''} m. archyvo`})`
                : 'Atkurta iš archyvo',
            }
          : i
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items },
      };
    }

    case 'SAVE_WRITEOFF_ACT': {
      const exists = db.writeOffActs.some((a) => a.id === op.act.id);
      const writeOffActs = exists
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
      const writeOffActs = db.writeOffActs.map((a) =>
        a.id === op.actId
          ? {
              ...a,
              status: 'approved' as const,
              actYear: op.approvalYear,
              approvedDate: op.approvedDate,
            }
          : a
      );
      const actItemIds = new Set(targetAct.items.map((it) => it.itemId));
      const items = db.items.map((i) =>
        actItemIds.has(i.id)
          ? {
              ...i,
              status: 'written_off' as const,
              writtenOffDate: op.approvedDate,
              writtenOffYear: op.approvalYear,
              writeOffActNumber: targetAct.actNumber,
              writeOffReason: targetAct.reasonCategory,
              writeOffActId: targetAct.id,
            }
          : i
      );
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, writeOffActs, items },
      };
    }

    case 'SAVE_FAULT_REPORT': {
      const items = db.items.map((i) => {
        if (i.id !== op.itemId) return i;
        const existingReports = i.defectReports || [];
        return {
          ...i,
          status: 'in_repair' as const,
          condition: op.newCondition,
          notes: i.notes ? `${i.notes} | ${op.defectNote}` : op.defectNote,
          activeDefectNote: op.defectReport.description,
          defectReports: [...existingReports, op.defectReport],
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
      const linkedAuditsCount = db.auditSessions.filter((s) => s.departmentId === op.departmentId).length;

      if (linkedRoomsCount > 0 || linkedItemsCount > 0 || linkedUsersCount > 0 || linkedAuditsCount > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima ištrinti skyriaus „${targetDept.name}“, nes jis susietas su įrašais (${linkedRoomsCount} kab., ${linkedItemsCount} turto vnt., ${linkedUsersCount} darbuotojais). Pirmiausia perleiskite susijusius įrašus kitam skyriui arba archyvuokite skyrių.`,
        };
      }

      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const departments = db.departments.filter((d) => d.id !== op.departmentId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, departments, movements },
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
      const auditSessions = db.auditSessions.map((s) =>
        s.departmentId === op.departmentId ? { ...s, departmentId: op.targetDepartmentId } : s
      );
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
      const linkedAuditsCount = db.auditSessions.filter((s) => s.committeeChairmanId === op.userId).length;

      if (linkedItemsCount > 0 || linkedDeptsCount > 0 || linkedRoomsCount > 0 || linkedAuditsCount > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `Negalima pašalinti darbuotojo „${targetUser.fullName}“, nes jam priskirtas turtas arba pareigos (${linkedItemsCount} turto vnt., ${linkedRoomsCount} kab., ${linkedDeptsCount} sk.). Pirmiausia perleiskite atsakomybę kitam asmeniui arba archyvuokite darbuotoją.`,
        };
      }

      const movements = backfillMovementSnapshots(db.movements, db.departments, db.rooms, db.users);
      const users = db.users.filter((u) => u.id !== op.userId);
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, users, movements },
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
      const auditSessions = db.auditSessions.map((s) =>
        s.committeeChairmanId === op.userId
          ? {
              ...s,
              committeeChairmanId: op.targetUserId,
              committeeChairman: `${targetUser.fullName} (${targetUser.roleTitle || 'Komisijos pirmininkas'})`,
            }
          : s
      );
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
      const updatedUsers = [...db.users];
      op.users.forEach((newUser) => {
        const idx = updatedUsers.findIndex(
          (u) => u.email.toLowerCase() === newUser.email.toLowerCase()
        );
        if (idx !== -1) {
          updatedUsers[idx] = { ...updatedUsers[idx], ...newUser };
        } else {
          updatedUsers.push(newUser);
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

    case 'UPDATE_AUDIT_SESSION': {
      const exists = db.auditSessions.some((s) => s.id === op.session.id);
      const auditSessions = exists
        ? db.auditSessions.map((s) => (s.id === op.session.id ? op.session : s))
        : [op.session, ...db.auditSessions];
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, auditSessions },
      };
    }

    case 'RELOCATE_AUDIT_ITEM': {
      const targetItem = db.items.find((i) => i.id === op.itemId);
      if (!targetItem) {
        return { ok: false, statusCode: 404, error: 'Turtas nerastas.' };
      }
      const targetRoom = db.rooms.find((r) => r.id === op.newRoomId);
      if (!targetRoom) {
        return { ok: false, statusCode: 404, error: 'Tikslinis kabinetas nerastas.' };
      }
      const nextResponsibleUserId =
        targetRoom.defaultResponsiblePersonId || targetItem.responsibleUserId;
      let movements = db.movements;

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
          reason: `Perkėlimas užfiksuotas inventorizacijos patikros metu (${op.auditDate})`,
        });
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
      return {
        ok: true,
        database: { ...db, version: CURRENT_DB_VERSION, exportedAt: nowIso, items, movements },
      };
    }
  }
}
