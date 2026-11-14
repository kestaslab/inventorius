import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { validateAndMigrateDatabase, CURRENT_DB_VERSION } from '../src/utils/databaseValidation.ts';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
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

function buildValidFixtureDb(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    exportedAt: '2026-03-01T10:00:00.000Z',
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: structuredClone(INITIAL_WRITEOFF_ACTS),
    auditSessions: [structuredClone(INITIAL_AUDIT_SESSION)],
    authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
    ...overrides,
  };
}

// Minimal valid 1x1 PNG data URL
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function withTempServer(
  run: (baseUrl: string, tempDir: string) => Promise<void>
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage1-'));
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, tempDir);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Production school_database.json (when present) or 1.0.0 backup passes validation and migrates cleanly without losing records', () => {
  const realPath = path.resolve(process.cwd(), 'data/school_database.json');
  const raw = fs.existsSync(realPath)
    ? JSON.parse(fs.readFileSync(realPath, 'utf-8'))
    : buildValidFixtureDb({ version: '1.0.0' });
  const res = validateAndMigrateDatabase(raw);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (res.ok) {
    assert.equal(res.data.version, CURRENT_DB_VERSION);
    assert.equal(res.data.departments.length, raw.departments.length);
    assert.equal(res.data.rooms.length, raw.rooms.length);
    assert.equal(res.data.users.length, raw.users.length);
    assert.equal(res.data.items.length, raw.items.length);
    assert.equal(res.data.movements.length, raw.movements.length);
    assert.equal(res.data.writeOffActs.length, raw.writeOffActs.length);
    assert.equal(res.data.auditSessions.length, raw.auditSessions.length);
  }
});

test('validateAndMigrateDatabase rejects unsupported versions, duplicate IDs/numbers, and broken relations', () => {
  // 1. Unsupported version
  const badVer = validateAndMigrateDatabase(buildValidFixtureDb({ version: '9.9.9' }));
  assert.equal(badVer.ok, false);

  // 2. Duplicate inventoryNumber (case-insensitive)
  const dupItems = structuredClone(INITIAL_ITEMS);
  dupItems[1] = {
    ...dupItems[1],
    inventoryNumber: dupItems[0].inventoryNumber.toLowerCase(),
  };
  const badInv = validateAndMigrateDatabase(buildValidFixtureDb({ items: dupItems }));
  assert.equal(badInv.ok, false);
  if (!badInv.ok) assert.match(badInv.error, /pasikartojantis inventorinis numeris/i);

  // 3. Broken roomId relation
  const brokenRoomItems = structuredClone(INITIAL_ITEMS);
  brokenRoomItems[0] = { ...brokenRoomItems[0], roomId: 'room-does-not-exist' };
  const badRel = validateAndMigrateDatabase(buildValidFixtureDb({ items: brokenRoomItems }));
  assert.equal(badRel.ok, false);
  if (!badRel.ok) assert.match(badRel.error, /kabinetas/i);

  // 4. Item assigned to a room from another department
  const crossDeptItems = structuredClone(INITIAL_ITEMS);
  const firstItem = crossDeptItems[0];
  const otherDeptRoom = INITIAL_ROOMS.find((r) => r.departmentId !== firstItem.departmentId);
  assert.ok(otherDeptRoom, 'Expected another department room in fixture');
  crossDeptItems[0] = { ...firstItem, roomId: otherDeptRoom.id };
  const badCross = validateAndMigrateDatabase(buildValidFixtureDb({ items: crossDeptItems }));
  assert.equal(badCross.ok, false);
  if (!badCross.ok) assert.match(badCross.error, /nepriklauso skyriui/i);

  // 5. Duplicate ID
  const dupDepts = [...INITIAL_DEPARTMENTS, { ...INITIAL_DEPARTMENTS[0] }];
  const badId = validateAndMigrateDatabase(buildValidFixtureDb({ departments: dupDepts }));
  assert.equal(badId.ok, false);
});

test('Server enforces revision checks, merges disjoint edits, blocks conflicts, handles photos and backups atomically', async () => {
  await withTempServer(async (baseUrl, tempDir) => {
    // 1. Empty server returns null and blocks stale mutation
    const initGet = await fetch(`${baseUrl}/api/database`);
    assert.equal(initGet.status, 200);
    assert.equal(await initGet.json(), null);
    assert.equal(initGet.headers.get('x-db-revision'), '0');

    const emptyMut = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 0,
        clientOpId: 'op-empty',
        operation: { type: 'SAVE_ITEM', item: INITIAL_ITEMS[0] },
      }),
    });
    assert.equal(emptyMut.status, 409);

    // 2. Reject invalid backup import without initializing or corrupting DB
    const badImport = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: { version: '1.0.0', items: [] },
      }),
    });
    assert.equal(badImport.status, 400);
    assert.equal(fs.existsSync(path.join(tempDir, 'school_database.json')), false);

    // 3. Valid import with legacy base64 photo extracts photo to disk and creates rev 1
    const fixtureWithPhoto = buildValidFixtureDb();
    fixtureWithPhoto.items[0] = {
      ...fixtureWithPhoto.items[0],
      photoUrl: TINY_PNG_DATA_URL,
    };

    const goodImport = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: fixtureWithPhoto, source: 'backup_import' }),
    });
    assert.equal(goodImport.status, 200);
    const importBody = (await goodImport.json()) as any;
    assert.equal(importBody.success, true);
    assert.equal(importBody.revision, 1);
    assert.equal(importBody.migrated, true);
    assert.match(importBody.database.items[0].photoUrl, /^\/api\/photos\/photo_/);

    // Photo URL is servable over HTTP
    const photoRes = await fetch(`${baseUrl}${importBody.database.items[0].photoUrl}`);
    assert.equal(photoRes.status, 200);
    assert.equal(photoRes.headers.get('content-type'), 'image/png');

    // 4. Concurrent disjoint mutations at same baseRevision=1: BOTH succeed without overwriting each other!
    const itemA = { ...importBody.database.items[0], name: 'Atnaujintas A daiktas' };
    const itemB = { ...importBody.database.items[1], name: 'Atnaujintas B daiktas' };

    const mutA = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'op-a-1',
        operation: { type: 'SAVE_ITEM', item: itemA },
      }),
    });
    assert.equal(mutA.status, 200);
    const bodyA = (await mutA.json()) as any;
    assert.equal(bodyA.revision, 2);
    assert.equal(bodyA.merged, false);

    const mutB = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1, // stale relative to rev 2, but disjoint item!
        clientOpId: 'op-b-1',
        operation: { type: 'SAVE_ITEM', item: itemB },
      }),
    });
    assert.equal(mutB.status, 200);
    const bodyB = (await mutB.json()) as any;
    assert.equal(bodyB.revision, 3);
    assert.equal(bodyB.merged, true);
    assert.equal(bodyB.database.items[0].name, 'Atnaujintas A daiktas');
    assert.equal(bodyB.database.items[1].name, 'Atnaujintas B daiktas');

    // 5. Same-entity conflict (editing item[0] again using stale baseRevision=1) returns 409 Conflict!
    const mutConflict = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'op-conflict-1',
        operation: {
          type: 'SAVE_ITEM',
          item: { ...itemA, name: 'Pasenęs perrašymas' },
        },
      }),
    });
    assert.equal(mutConflict.status, 409);

    // 6. Atomic TRANSFER_ITEM updates movement and item location together
    const targetRoom = INITIAL_ROOMS.find((r) => r.id !== itemA.roomId)!;
    const transferMut = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 3,
        clientOpId: 'op-transfer-1',
        operation: {
          type: 'TRANSFER_ITEM',
          record: {
            id: 'mov-stage1-test',
            itemId: itemA.id,
            itemName: itemA.name,
            inventoryNumber: itemA.inventoryNumber,
            date: '2026-04-01',
            fromDepartmentId: itemA.departmentId,
            fromRoomId: itemA.roomId,
            fromUserId: itemA.responsibleUserId,
            toDepartmentId: targetRoom.departmentId,
            toRoomId: targetRoom.id,
            toUserId: itemA.responsibleUserId,
            reason: 'Testinis perkėlimas',
            actNumber: 'PER-2026-999',
          },
        },
      }),
    });
    assert.equal(transferMut.status, 200);
    const bodyTransfer = (await transferMut.json()) as any;
    assert.equal(bodyTransfer.revision, 4);
    assert.equal(bodyTransfer.database.items[0].roomId, targetRoom.id);
    assert.equal(bodyTransfer.database.movements[0].id, 'mov-stage1-test');

    // 7. Server-side duplicate inventoryNumber prevention
    const dupInvMut = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 4,
        clientOpId: 'op-dup-inv',
        operation: {
          type: 'SAVE_ITEM',
          item: {
            ...itemA,
            id: 'item-brand-new-dup',
            inventoryNumber: itemB.inventoryNumber,
          },
        },
      }),
    });
    assert.equal(dupInvMut.status, 409);

    // 8. Export portable backup includes embedded photos dictionary and re-import saves a pre_import backup on server
    const backupRes = await fetch(`${baseUrl}/api/database/backup`);
    assert.equal(backupRes.status, 200);
    const backupJson = (await backupRes.json()) as any;
    assert.ok(backupJson.photos && Object.keys(backupJson.photos).length >= 1);

    const reimport = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 4,
        database: backupJson,
        source: 'backup_import',
      }),
    });
    assert.equal(reimport.status, 200);
    const reimportBody = (await reimport.json()) as any;
    assert.ok(reimportBody.backupFile, 'Server must create backup before full import overwrite');
    assert.ok(fs.existsSync(path.join(tempDir, 'backups', reimportBody.backupFile)));

    // 9. Oversized photo (> 5 MB) returns 413
    const hugeBase64 = 'A'.repeat(7_200_000);
    const hugePhotoRes = await fetch(`${baseUrl}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${hugeBase64}` }),
    });
    assert.equal(hugePhotoRes.status, 413);
  });
});
