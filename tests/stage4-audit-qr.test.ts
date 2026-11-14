import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
import {
  AppDatabase,
  CURRENT_DB_VERSION,
  validateAndMigrateDatabase,
} from '../src/utils/databaseValidation.ts';
import {
  buildItemQrPayload,
  parseQrOrManualCode,
  resolveScannedInventoryItem,
} from '../src/utils/qrUtils.ts';
import {
  buildAuditSnapshotItems,
  computeAuditStats,
  getAuditCameraErrorMessage,
  getEffectiveSessionRows,
  isItemInAuditScope,
} from '../src/utils/auditUtils.ts';
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
import { AuditSession, InventoryItem } from '../src/types/inventory.ts';

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

async function withTempServer(
  run: (baseUrl: string, dataDir: string) => Promise<void>,
  seedDb?: AppDatabase
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage4-'));
  if (seedDb) {
    fs.writeFileSync(
      path.join(tempDir, 'school_database.json'),
      JSON.stringify(seedDb, null, 2),
      'utf-8'
    );
  }
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to start test server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl, tempDir);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function postMutate(
  baseUrl: string,
  baseRevision: number,
  operation: unknown,
  clientOpId: string
) {
  const res = await fetch(`${baseUrl}/api/mutate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, operation, clientOpId }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

test('QR kodų generavimas ir atpažinimas palaiko JSON QR, Inv. Nr., S/N, brūkšninį kodą ir saugiai apdoroja klaidas', () => {
  const sampleItems: InventoryItem[] = structuredClone(INITIAL_ITEMS);
  const firstItem = {
    ...sampleItems[0],
    barcode: '4771234567890',
    serialNumber: 'SN-STAGE4-XYZ',
  };
  const items = [firstItem, ...sampleItems.slice(1)];

  // 1. Etiketės sugeneruotas JSON QR kodas turi tiksliai atpažinti daiktą
  const qrPayload = buildItemQrPayload(firstItem);
  const resJson = resolveScannedInventoryItem(qrPayload, items);
  assert.equal(resJson.ok, true);
  if (resJson.ok) {
    assert.equal(resJson.item.id, firstItem.id);
    assert.equal(resJson.format, 'json_qr');
    assert.equal(resJson.matchedBy, 'inv');
  }

  // 2. Paprastas Inv. Nr., SN, brūkšninis kodas, ID ir CSV pipe eilutė
  for (const [input, expectedMatch] of [
    [firstItem.inventoryNumber.toLowerCase(), 'inv'],
    ['sn-stage4-xyz', 'serial'],
    ['4771234567890', 'barcode'],
    [firstItem.id, 'id'],
    [`${firstItem.inventoryNumber} | ${firstItem.name} | Mokykla`, 'inv'],
  ] as const) {
    const r = resolveScannedInventoryItem(input, items);
    assert.equal(r.ok, true, `Turėjo atpažinti: ${input}`);
    if (r.ok) {
      assert.equal(r.item.id, firstItem.id);
      assert.equal(r.matchedBy, expectedMatch);
    }
  }

  // 3. Netinkami / nežinomi kodai neturi mesti išimties ir grąžina aiškų pranešimą
  for (const invalid of ['', '   ', '{sugadintas json', '{"foo":"bar"}', '[1,2]', 'NEZINOMAS-999']) {
    const r = resolveScannedInventoryItem(invalid, items);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.message.length > 5);
    }
  }
  assert.equal(parseQrOrManualCode('{"inv": " "}').ok, false);
});

test('Apimties taisyklės, tuščia sesija (jokio NaN%), dar nepatikrinta vs trūksta ir kameros klaidų žinutės', () => {
  const items = structuredClone(INITIAL_ITEMS);
  const writtenOffItem: InventoryItem = {
    ...items[0],
    id: 'item-wo-hidden',
    inventoryNumber: 'TM-WO-999',
    status: 'written_off',
  };
  const repairItem: InventoryItem = {
    ...items[0],
    id: 'item-repair-only',
    inventoryNumber: 'TM-REP-01',
    status: 'in_repair',
  };

  // Nurašytas turtas visada praleidžiamas
  assert.equal(isItemInAuditScope(writtenOffItem, {}), false);
  assert.equal(isItemInAuditScope(writtenOffItem, { includeInRepair: true, includeToWriteOff: true }), false);
  assert.equal(isItemInAuditScope(repairItem, { includeInRepair: false }), false);
  assert.equal(isItemInAuditScope(repairItem, { includeInRepair: true }), true);

  // Tuščia sesija arba null neturi duoti NaN%
  assert.deepEqual(computeAuditStats([]), {
    total: 0,
    checkedCount: 0,
    foundInPlaceCount: 0,
    foundElsewhereCount: 0,
    missingCount: 0,
    uncheckedCount: 0,
    progressPercent: 0,
  });
  assert.deepEqual(getEffectiveSessionRows(null, items, INITIAL_DEPARTMENTS, INITIAL_ROOMS, INITIAL_USERS), []);

  // Atskirti 'unchecked' nuo 'missing' vykdomoje sesijoje
  const activeSession: AuditSession = {
    id: 'audit-empty-progress',
    year: 2026,
    title: 'Testas',
    status: 'in_progress',
    startDate: '2026-05-01',
    committeeMembers: [],
    scannedItemIds: [],
    missingItemIds: [items[1].id],
    relocatedItemIds: [],
    snapshotItems: buildAuditSnapshotItems({
      items: [items[0], items[1]],
      departments: INITIAL_DEPARTMENTS,
      rooms: INITIAL_ROOMS,
      users: INITIAL_USERS,
    }),
    checkRecords: {},
  };
  const rows = getEffectiveSessionRows(
    activeSession,
    items,
    INITIAL_DEPARTMENTS,
    INITIAL_ROOMS,
    INITIAL_USERS
  );
  assert.equal(rows[0].auditState, 'unchecked');
  assert.equal(rows[1].auditState, 'missing');

  // Kameros klaidų pranešimai
  assert.match(getAuditCameraErrorMessage({ name: 'NotAllowedError' }), /užblokuota|atmesta/i);
  assert.match(getAuditCameraErrorMessage({ name: 'NotFoundError' }), /nerasta/i);
  assert.match(getAuditCameraErrorMessage({ name: 'NotReadableError' }), /kita programa/i);
  assert.match(getAuditCameraErrorMessage({ name: 'SecurityError' }), /HTTPS/i);
});

test('Nauja inventorizacija pradeda nuo nulio, atskiria faktinę vietą nuo oficialaus perkėlimo ir sulieja lygiagrečius skenavimus', async () => {
  const db = buildFixtureDb(1);
  // Pažymime vieną turtą kaip nurašytą – jis neturi patekti į naujos sesijos momentinį sąrašą
  const woTargetId = db.items[db.items.length - 1].id;
  db.items = db.items.map((it) =>
    it.id === woTargetId ? { ...it, status: 'written_off', writeOffReason: 'Susidėvėjęs' } : it
  );

  await withTempServer(async (baseUrl) => {
    const firstActive = db.items.find((i) => i.status === 'active')!;
    const secondActive = db.items.find((i) => i.status === 'active' && i.id !== firstActive.id)!;
    const otherRoom = db.rooms.find((r) => r.id !== firstActive.roomId)!;

    // 1. Sukuriame naują sesiją tais pačiais metais – ji negali paveldėti senų patikrinimų
    const createRes = await postMutate(
      baseUrl,
      1,
      {
        type: 'CREATE_AUDIT_SESSION',
        session: {
          id: 'audit-2026-new',
          year: 2026,
          title: '2026 m. nauja pakartotinė inventorizacija',
          startDate: '2026-05-10',
          includeInRepair: true,
          includeToWriteOff: true,
          committeeChairman: 'Kęstutis Labanauskas',
          committeeChairmanId: db.users[0].id,
          committeeMembers: ['Sigita Navickienė'],
          orderNumber: 'V-99',
          orderDate: '2026-05-10',
        },
      },
      'op-create-1'
    );
    assert.equal(createRes.status, 200);
    const createdDb: AppDatabase = createRes.body.database;
    const createdSession = createdDb.auditSessions.find((s) => s.id === 'audit-2026-new')!;
    assert.ok(createdSession);
    assert.equal(createdSession.scannedItemIds.length, 0);
    assert.equal(createdSession.missingItemIds.length, 0);
    assert.ok(Array.isArray(createdSession.snapshotItems));
    assert.equal(
      createdSession.snapshotItems!.some((s) => s.itemId === woTargetId),
      false,
      'Nurašytas turtas neturi patekti į aktyvaus turto inventorizaciją'
    );

    const revAfterCreate: number = createRes.body.revision;

    // 2. Nurašyto daikto patikra turi būti atmesta
    const woCheck = await postMutate(
      baseUrl,
      revAfterCreate,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-2026-new',
        itemId: woTargetId,
        actualRoomId: firstActive.roomId,
        method: 'qr',
        checkedByUserName: 'Komisija 1',
      },
      'op-wo-reject'
    );
    assert.equal(woCheck.status, 400);

    // 3. Lygiagretus dviejų komisijos narių skenavimas iš TOS PAČIOS revizijos (baseRevision):
    // Narys A randa firstActive KITAME kabinete (nekeičiant registro vietos),
    // Narys B randa secondActive jo tikėtiname kabinete.
    const [scanA, scanB] = await Promise.all([
      postMutate(
        baseUrl,
        revAfterCreate,
        {
          type: 'RECORD_AUDIT_CHECK',
          sessionId: 'audit-2026-new',
          itemId: firstActive.id,
          actualRoomId: otherRoom.id,
          method: 'qr',
          checkedByUserId: db.users[0].id,
          checkedByUserName: 'Komisijos narys A',
          checkedAt: '2026-05-10T09:15:00.000Z',
        },
        'op-scan-a'
      ),
      postMutate(
        baseUrl,
        revAfterCreate,
        {
          type: 'RECORD_AUDIT_CHECK',
          sessionId: 'audit-2026-new',
          itemId: secondActive.id,
          actualRoomId: secondActive.roomId,
          method: 'manual_code',
          checkedByUserId: db.users[1]?.id,
          checkedByUserName: 'Komisijos narys B',
          checkedAt: '2026-05-10T09:15:05.000Z',
        },
        'op-scan-b'
      ),
    ]);

    assert.equal(scanA.status, 200);
    assert.equal(scanB.status, 200);

    // Paimame naujausią DB iš serverio ir įsitikiname, kad ABU patikrinimai išliko!
    const latestRes = await fetch(`${baseUrl}/api/database`);
    const afterConcurrentDb: AppDatabase = await latestRes.json();
    const revConcurrent: number = afterConcurrentDb.revision || 1;
    const sessConcurrent = afterConcurrentDb.auditSessions.find((s) => s.id === 'audit-2026-new')!;

    assert.ok(sessConcurrent.scannedItemIds.includes(firstActive.id));
    assert.ok(sessConcurrent.scannedItemIds.includes(secondActive.id));
    assert.equal(sessConcurrent.checkRecords![firstActive.id].outcome, 'found_elsewhere');
    assert.equal(sessConcurrent.checkRecords![firstActive.id].actualRoomId, otherRoom.id);
    assert.equal(sessConcurrent.checkRecords![firstActive.id].expectedRoomId, firstActive.roomId);
    assert.equal(sessConcurrent.checkRecords![secondActive.id].outcome, 'found');
    assert.equal(sessConcurrent.checkRecords![secondActive.id].checkedByUserName, 'Komisijos narys B');

    // Svarbiausia: užfiksavus „rasta kitur“, registro vieta NEBUVO pakeista automatiškai, o lastAuditDate atnaujinta!
    const firstRegAfterCheck = afterConcurrentDb.items.find((i) => i.id === firstActive.id)!;
    assert.equal(firstRegAfterCheck.roomId, firstActive.roomId);
    assert.equal(firstRegAfterCheck.lastAuditDate, '2026-05-10');

    // 4. Dabar atliekamas ATSKIRAS oficialus perkėlimas (RELOCATE_AUDIT_ITEM) su sessionId ->
    // atnaujina registro vietą, sukuria MovementRecord ir pažymi checkRecord kaip officialTransferDone
    const relocRes = await postMutate(
      baseUrl,
      revConcurrent,
      {
        type: 'RELOCATE_AUDIT_ITEM',
        itemId: firstActive.id,
        newRoomId: otherRoom.id,
        auditDate: '2026-05-10',
        sessionId: 'audit-2026-new',
        transferredByUserId: db.users[0].id,
        transferredByUserName: 'Komisijos pirmininkas',
      },
      'op-official-reloc'
    );
    assert.equal(relocRes.status, 200);
    const dbAfterReloc: AppDatabase = relocRes.body.database;
    assert.equal(dbAfterReloc.items.find((i) => i.id === firstActive.id)!.roomId, otherRoom.id);
    assert.equal(dbAfterReloc.movements.length, db.movements.length + 1);
    assert.equal(
      dbAfterReloc.auditSessions
        .find((s) => s.id === 'audit-2026-new')!
        .checkRecords![firstActive.id].officialTransferDone,
      true
    );

    // 5. Užbaigiame sesiją ir patikriname užbaigtos sesijos užrakinimą bei istorinį nekintamumą
    const completeRes = await postMutate(
      baseUrl,
      relocRes.body.revision,
      {
        type: 'COMPLETE_AUDIT_SESSION',
        sessionId: 'audit-2026-new',
        completedDate: '2026-05-11',
        completedByUserId: db.users[0].id,
        completedByUserName: 'Kęstutis Labanauskas',
      },
      'op-complete-1'
    );
    assert.equal(completeRes.status, 200);
    const completedDb: AppDatabase = completeRes.body.database;
    const completedSess = completedDb.auditSessions.find((s) => s.id === 'audit-2026-new')!;
    assert.equal(completedSess.status, 'completed');
    assert.ok(completedSess.completionSummary);
    assert.equal(
      completedSess.completionSummary!.foundInPlaceCount +
        completedSess.completionSummary!.foundElsewhereCount +
        completedSess.completionSummary!.missingCount,
      completedSess.completionSummary!.totalExpected
    );

    // Užbaigtos sesijos modifikavimas turi būti užblokuotas (HTTP 400)
    const editCompletedRes = await postMutate(
      baseUrl,
      completeRes.body.revision,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-2026-new',
        itemId: secondActive.id,
        actualRoomId: secondActive.roomId,
        method: 'qr',
        checkedByUserName: 'Kitas',
      },
      'op-edit-completed-blocked'
    );
    assert.equal(editCompletedRes.status, 400);

    const completeAgainRes = await postMutate(
      baseUrl,
      completeRes.body.revision,
      {
        type: 'COMPLETE_AUDIT_SESSION',
        sessionId: 'audit-2026-new',
        completedDate: '2026-05-12',
      },
      'op-complete-again-blocked'
    );
    assert.equal(completeAgainRes.status, 400);

    // Vėliau pervadintas daiktas registre NEKEIČIA užbaigtos sesijos apyrašo rezultatų!
    const renameItemRes = await postMutate(
      baseUrl,
      completeRes.body.revision,
      {
        type: 'SAVE_ITEM',
        item: {
          ...dbAfterReloc.items.find((i) => i.id === secondActive.id)!,
          name: 'Pakeistas pavadinimas po inventorizacijos',
        },
      },
      'op-rename-after-audit'
    );
    assert.equal(renameItemRes.status, 200);
    const postRenameDb: AppDatabase = renameItemRes.body.database;
    const historicalRows = getEffectiveSessionRows(
      postRenameDb.auditSessions.find((s) => s.id === 'audit-2026-new')!,
      postRenameDb.items,
      postRenameDb.departments,
      postRenameDb.rooms,
      postRenameDb.users
    );
    const secondHistRow = historicalRows.find((r) => r.itemId === secondActive.id)!;
    assert.equal(secondHistRow.name, secondActive.name);
    assert.equal(secondHistRow.isFromSnapshot, true);
  }, db);
});

test('Suderinamumas su senomis JSON kopijomis (v1.0.0 be snapshotItems ir checkRecords)', async () => {
  const legacyDb = {
    version: '1.0.0',
    exportedAt: '2025-05-01T10:00:00.000Z',
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: [],
    auditSessions: [
      {
        id: 'legacy-audit-2025',
        year: 2025,
        title: '2025 m. sena inventorizacija',
        status: 'completed',
        startDate: '2025-04-01',
        completedDate: '2025-04-15',
        committeeMembers: ['Kęstutis Labanauskas'],
        scannedItemIds: [INITIAL_ITEMS[0].id],
        missingItemIds: [INITIAL_ITEMS[1].id],
        relocatedItemIds: [],
      },
    ],
  };

  const validated = validateAndMigrateDatabase(legacyDb);
  assert.equal(validated.ok, true);
  if (validated.ok) {
    const migratedSess = validated.data.auditSessions[0];
    // Neišgalvojami nesantys istoriniai laukai
    assert.equal(migratedSess.snapshotItems, undefined);
    assert.equal(migratedSess.checkRecords, undefined);

    const rows = getEffectiveSessionRows(
      migratedSess,
      validated.data.items,
      validated.data.departments,
      validated.data.rooms,
      validated.data.users
    );
    const first = rows.find((r) => r.itemId === INITIAL_ITEMS[0].id)!;
    const second = rows.find((r) => r.itemId === INITIAL_ITEMS[1].id)!;
    assert.equal(first.auditState, 'found');
    assert.equal(first.checkRecord, undefined);
    assert.equal(second.auditState, 'missing');
  }
});
