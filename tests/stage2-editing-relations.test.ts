import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateAndMigrateDatabase, AppDatabase, CURRENT_DB_VERSION } from '../src/utils/databaseValidation.ts';
import { applyDbMutation } from '../src/utils/dbOperations.ts';
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
import { InventoryItem } from '../src/types/inventory.ts';

function buildFixtureDb(): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
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

test('SAVE_ITEM preserves non-form fields and does not overwrite untouched fields', () => {
  const db = buildFixtureDb();
  const baseItem = db.items[0];
  db.items[0] = {
    ...baseItem,
    assetClass: 'short_term',
    residualValue: 123.45,
    barcode: 'BC-001',
    lastAuditDate: '2026-03-15',
    activeDefectNote: 'Mirguliuoja ekranas',
    defectReports: [
      {
        id: 'def-1',
        reportedAt: '2026-03-10T09:00:00Z',
        reportedByUserId: db.users[0].id,
        reportedByUserName: 'Mokytojas',
        description: 'Mirguliuoja ekranas',
        severity: 'medium',
        status: 'reported',
      },
    ],
    writtenOffDate: undefined,
    writtenOffYear: undefined,
    writeOffActNumber: undefined,
    writeOffReason: undefined,
    writeOffActId: undefined,
  };

  // Simulate editing only name & purchasePrice with omitted optional/non-form fields
  const partialEdit: InventoryItem = {
    id: baseItem.id,
    inventoryNumber: baseItem.inventoryNumber,
    name: 'Atnaujintas pavadinimas',
    category: baseItem.category,
    purchasePrice: 900,
    residualValue: 123.45,
    assetClass: 'short_term',
    fundingSource: baseItem.fundingSource,
    acquisitionDate: baseItem.acquisitionDate,
    departmentId: baseItem.departmentId,
    roomId: baseItem.roomId,
    responsibleUserId: baseItem.responsibleUserId,
    status: baseItem.status,
    condition: baseItem.condition,
  };

  const res = applyDbMutation(db, { type: 'SAVE_ITEM', item: partialEdit });
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;

  const updated = res.database.items.find((i) => i.id === baseItem.id)!;
  assert.equal(updated.name, 'Atnaujintas pavadinimas');
  assert.equal(updated.purchasePrice, 900);
  assert.equal(updated.residualValue, 123.45);
  assert.equal(updated.assetClass, 'short_term');
  assert.equal(updated.barcode, 'BC-001');
  assert.equal(updated.lastAuditDate, '2026-03-15');
  assert.equal(updated.activeDefectNote, 'Mirguliuoja ekranas');
  assert.equal(updated.defectReports?.length, 1);

  // Also test write-off non-form fields preservation when editing an already written_off item's note/name
  const woDb = buildFixtureDb();
  woDb.items[1] = {
    ...woDb.items[1],
    status: 'written_off',
    writtenOffDate: '2025-11-20',
    writtenOffYear: 2025,
    writeOffActNumber: 'NUR-2025-07',
    writeOffReason: 'Sugedęs',
    writeOffActId: 'act-2025-7',
  };
  const editWo: InventoryItem = {
    ...woDb.items[1],
    writtenOffDate: undefined,
    writtenOffYear: undefined,
    writeOffActNumber: undefined,
    writeOffReason: undefined,
    writeOffActId: undefined,
    notes: 'Papildoma pastaba archyve',
  };
  const woRes = applyDbMutation(woDb, { type: 'SAVE_ITEM', item: editWo });
  assert.equal(woRes.ok, true);
  if (woRes.ok) {
    const savedWo = woRes.database.items[1];
    assert.equal(savedWo.writtenOffDate, '2025-11-20');
    assert.equal(savedWo.writtenOffYear, 2025);
    assert.equal(savedWo.writeOffActNumber, 'NUR-2025-07');
    assert.equal(savedWo.writeOffReason, 'Sugedęs');
    assert.equal(savedWo.writeOffActId, 'act-2025-7');
  }
});

test('SAVE_ITEM validates prices, residualValue, dates, cross-department relations, and blocks status bypasses', () => {
  const db = buildFixtureDb();
  const base = db.items[0];

  // Negative price
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, purchasePrice: -10 } }).ok,
    false
  );

  // Negative residualValue
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, residualValue: -1 } }).ok,
    false
  );

  // ResidualValue > purchasePrice
  const overRes = applyDbMutation(db, {
    type: 'SAVE_ITEM',
    item: { ...base, purchasePrice: 200, residualValue: 250 },
  });
  assert.equal(overRes.ok, false);

  // Invalid calendar date (Feb 30) & future date
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, acquisitionDate: '2024-02-30' } }).ok,
    false
  );
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, acquisitionDate: '2099-01-01' } }).ok,
    false
  );

  // Cross-department room mismatch
  const foreignRoom = db.rooms.find((r) => r.departmentId !== base.departmentId)!;
  assert.ok(foreignRoom);
  const crossDept = applyDbMutation(db, {
    type: 'SAVE_ITEM',
    item: { ...base, roomId: foreignRoom.id },
  });
  assert.equal(crossDept.ok, false);

  // Duplicate inventoryNumber (409)
  const dupRes = applyDbMutation(db, {
    type: 'SAVE_ITEM',
    item: { ...base, id: 'brand-new-id', inventoryNumber: db.items[1].inventoryNumber.toLowerCase() },
  });
  assert.equal(dupRes.ok, false);
  if (!dupRes.ok) assert.equal(dupRes.statusCode, 409);

  // Status bypass protections
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, status: 'written_off' } }).ok,
    false
  );
  assert.equal(
    applyDbMutation(db, { type: 'SAVE_ITEM', item: { ...base, status: 'to_writeoff' } }).ok,
    false
  );

  const dbWithWo = buildFixtureDb();
  dbWithWo.items[0] = { ...base, status: 'written_off' };
  assert.equal(
    applyDbMutation(dbWithWo, { type: 'SAVE_ITEM', item: { ...base, status: 'active' } }).ok,
    false
  );
});

test('Location or responsible person edits create MovementRecord snapshots across SAVE_ITEM, RELOCATE_AUDIT_ITEM, and SAVE_ROOM', () => {
  const db = buildFixtureDb();
  const item = db.items[0];
  const initialMovCount = db.movements.length;

  // 1. Editing item's responsibleUserId via SAVE_ITEM leaves a MovementRecord with name snapshots
  const otherUser = db.users.find((u) => u.id !== item.responsibleUserId)!;
  const resSave = applyDbMutation(db, {
    type: 'SAVE_ITEM',
    item: { ...item, responsibleUserId: otherUser.id },
  });
  assert.equal(resSave.ok, true);
  if (!resSave.ok) return;
  assert.equal(resSave.database.movements.length, initialMovCount + 1);
  assert.equal(resSave.database.movements[0].toUserName, otherUser.fullName);
  assert.ok(resSave.database.movements[0].fromRoomName);

  // 2. Relocating during audit leaves a MovementRecord and updates item's department & room
  const otherRoom = db.rooms.find((r) => r.departmentId !== item.departmentId)!;
  const resAudit = applyDbMutation(resSave.database, {
    type: 'RELOCATE_AUDIT_ITEM',
    itemId: item.id,
    newRoomId: otherRoom.id,
    auditDate: '2026-04-15',
  });
  assert.equal(resAudit.ok, true);
  if (!resAudit.ok) return;
  assert.equal(resAudit.database.movements.length, initialMovCount + 2);
  const relocatedItem = resAudit.database.items.find((i) => i.id === item.id)!;
  assert.equal(relocatedItem.roomId, otherRoom.id);
  assert.equal(relocatedItem.departmentId, otherRoom.departmentId);

  // 3. Changing a room's departmentId via SAVE_ROOM updates all items in that room & records movements
  const targetDept = db.departments.find((d) => d.id !== otherRoom.departmentId)!;
  const movedRoomItemsCount = resAudit.database.items.filter((i) => i.roomId === otherRoom.id).length;
  assert.ok(movedRoomItemsCount >= 1);
  const resRoomMove = applyDbMutation(resAudit.database, {
    type: 'SAVE_ROOM',
    room: { ...otherRoom, departmentId: targetDept.id, name: 'Perkelta patalpa' },
  });
  assert.equal(resRoomMove.ok, true);
  if (!resRoomMove.ok) return;
  assert.equal(
    resRoomMove.database.items.filter((i) => i.roomId === otherRoom.id && i.departmentId === targetDept.id).length,
    movedRoomItemsCount
  );
  assert.equal(resRoomMove.database.movements.length, initialMovCount + 2 + movedRoomItemsCount);
});

test('Used departments, rooms, and users cannot be deleted directly; transfer-and-delete and archiving preserve movement clarity', () => {
  const db = buildFixtureDb();
  const usedRoom = db.rooms.find((r) => db.items.some((i) => i.roomId === r.id))!;
  const targetRoom = db.rooms.find((r) => r.id !== usedRoom.id)!;
  const usedDept = db.departments.find((d) => db.items.some((i) => i.departmentId === d.id))!;
  const targetDept = db.departments.find((d) => d.id !== usedDept.id)!;
  const usedUser = db.users.find((u) => db.items.some((i) => i.responsibleUserId === u.id))!;
  const targetUser = db.users.find((u) => u.id !== usedUser.id)!;

  // Bare deletions must be rejected
  assert.equal(applyDbMutation(db, { type: 'DELETE_ROOM', roomId: usedRoom.id }).ok, false);
  assert.equal(applyDbMutation(db, { type: 'DELETE_DEPARTMENT', departmentId: usedDept.id }).ok, false);
  assert.equal(applyDbMutation(db, { type: 'DELETE_USER', userId: usedUser.id }).ok, false);

  // Transfer and delete room moves items + records snapshots in movements
  const movedRoomItems = db.items.filter((i) => i.roomId === usedRoom.id).length;
  const resRoomTd = applyDbMutation(db, {
    type: 'TRANSFER_AND_DELETE_ROOM',
    roomId: usedRoom.id,
    targetRoomId: targetRoom.id,
  });
  assert.equal(resRoomTd.ok, true, resRoomTd.ok ? '' : resRoomTd.error);
  if (!resRoomTd.ok) return;
  assert.equal(resRoomTd.database.rooms.some((r) => r.id === usedRoom.id), false);
  assert.equal(resRoomTd.database.items.filter((i) => i.roomId === usedRoom.id).length, 0);
  assert.ok(resRoomTd.database.movements.length >= db.movements.length + movedRoomItems);
  // Even after room is deleted, snapshot names remain on the movements!
  assert.ok(resRoomTd.database.movements[0].fromRoomName);
  assert.ok(resRoomTd.database.movements[0].toRoomName);

  // Archive user + preserve historical snapshots
  const resArchiveUser = applyDbMutation(resRoomTd.database, {
    type: 'ARCHIVE_USER',
    userId: usedUser.id,
    isArchived: true,
  });
  assert.equal(resArchiveUser.ok, true);
  if (!resArchiveUser.ok) return;
  const archivedUser = resArchiveUser.database.users.find((u) => u.id === usedUser.id)!;
  assert.equal(archivedUser.isArchived, true);
  assert.equal(archivedUser.isActive, false);

  // Transfer and delete user moves responsibility and removes user
  const resUserTd = applyDbMutation(db, {
    type: 'TRANSFER_AND_DELETE_USER',
    userId: usedUser.id,
    targetUserId: targetUser.id,
  });
  assert.equal(resUserTd.ok, true);
  if (!resUserTd.ok) return;
  assert.equal(resUserTd.database.users.some((u) => u.id === usedUser.id), false);
  assert.equal(resUserTd.database.items.filter((i) => i.responsibleUserId === usedUser.id).length, 0);

  // Transfer and delete department
  const resDeptTd = applyDbMutation(db, {
    type: 'TRANSFER_AND_DELETE_DEPARTMENT',
    departmentId: usedDept.id,
    targetDepartmentId: targetDept.id,
  });
  assert.equal(resDeptTd.ok, true);
  if (!resDeptTd.ok) return;
  assert.equal(resDeptTd.database.departments.some((d) => d.id === usedDept.id), false);
  assert.equal(resDeptTd.database.items.filter((i) => i.departmentId === usedDept.id).length, 0);
  assert.equal(resDeptTd.database.rooms.filter((r) => r.departmentId === usedDept.id).length, 0);
  assert.equal(validateAndMigrateDatabase(resDeptTd.database).ok, true);
});

test('Production school_database.json (when present) or migrated fixture stays valid and compatible with Stage 2 schema', () => {
  const realPath = path.resolve(process.cwd(), 'data/school_database.json');
  const raw = fs.existsSync(realPath)
    ? JSON.parse(fs.readFileSync(realPath, 'utf-8'))
    : { ...buildFixtureDb(), version: '1.0.0' };
  const res = validateAndMigrateDatabase(raw);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
});
