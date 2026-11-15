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
  evaluateItemAuditScope,
  getAuditCameraErrorMessage,
  getEffectiveSessionRows,
  isItemInAuditScope,
} from '../src/utils/auditUtils.ts';
import {
  CameraStreamLike,
  CameraVideoElementLike,
  createAuditCameraController,
} from '../src/utils/cameraController.ts';
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
    additionalFindingsCount: 0,
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

test('1. Užbaigtos inventorizacijos papildomų radinių momentinė istorija išlieka po redagavimo, trynimo ir eksporto/importo', async () => {
  const db = buildFixtureDb(1);
  const deptA = db.departments[0];
  const roomA = db.rooms.find((r) => r.departmentId === deptA.id)!;
  const deptB = db.departments.find(
    (d) => d.id !== deptA.id && db.rooms.some((r) => r.departmentId === d.id)
  )!;
  const roomB = db.rooms.find((r) => r.departmentId === deptB.id)!;

  // Pridedame aiškų aktyvų daiktą į B skyrių (nebus A skyriaus pradiniame sąraše)
  const extraItem: InventoryItem = {
    ...db.items[0],
    id: 'item-extra-b-history',
    inventoryNumber: 'TM-EXTRA-777',
    serialNumber: 'SN-EXTRA-777',
    name: 'Nešiojamas projektorius Epson (pradinis)',
    category: db.items[0].category,
    departmentId: deptB.id,
    roomId: roomB.id,
    responsibleUserId: db.users[1]?.id || db.users[0].id,
    purchasePrice: 845.5,
    residualValue: 600,
    status: 'active',
  };
  db.items.push(extraItem);

  const expectedRespName =
    db.users.find((u) => u.id === extraItem.responsibleUserId)?.fullName || 'Nenurodyta';

  await withTempServer(async (baseUrl) => {
    // 1. Sukuriame A skyriaus sesiją
    const createRes = await postMutate(
      baseUrl,
      1,
      {
        type: 'CREATE_AUDIT_SESSION',
        session: {
          id: 'audit-dept-a-history',
          year: 2026,
          title: 'A skyriaus inventorizacija',
          startDate: '2026-06-01',
          departmentId: deptA.id,
          includeInRepair: true,
          includeToWriteOff: true,
          committeeMembers: ['Sigita Navickienė'],
        },
      },
      'op-hist-create'
    );
    assert.equal(createRes.status, 200);
    const sessAfterCreate: AuditSession = createRes.body.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-dept-a-history'
    );
    const initialSnapshotCount = sessAfterCreate.snapshotItems!.length;
    assert.equal(
      sessAfterCreate.snapshotItems!.some((s) => s.itemId === extraItem.id),
      false,
      'Kito skyriaus turtas negali būti pradiniame A skyriaus sąraše'
    );

    // 2. Užregistruojame B skyriaus daiktą kaip papildomą radinį A skyriaus kabinete
    const checkExtraRes = await postMutate(
      baseUrl,
      createRes.body.revision,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-dept-a-history',
        itemId: extraItem.id,
        actualRoomId: roomA.id,
        method: 'qr',
        checkedByUserName: 'Komisijos narys',
        checkedAt: '2026-06-01T10:00:00.000Z',
      },
      'op-hist-check-extra'
    );
    assert.equal(checkExtraRes.status, 200);
    const sessAfterCheck: AuditSession = checkExtraRes.body.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-dept-a-history'
    );
    assert.equal(sessAfterCheck.snapshotItems!.length, initialSnapshotCount);
    const rec = sessAfterCheck.checkRecords![extraItem.id];
    assert.equal(rec.isAdditionalFinding, true);
    assert.ok(rec.itemSnapshot);
    assert.equal(rec.itemSnapshot!.name, extraItem.name);
    assert.equal(rec.itemSnapshot!.purchasePrice, 845.5);
    assert.equal(rec.itemSnapshot!.responsibleUserName, expectedRespName);

    // 3. Užbaigiame sesiją – pradinė apimtis turi išlikti nepakitusi, papildomi radiniai atskirti
    const completeRes = await postMutate(
      baseUrl,
      checkExtraRes.body.revision,
      {
        type: 'COMPLETE_AUDIT_SESSION',
        sessionId: 'audit-dept-a-history',
        completedDate: '2026-06-02',
      },
      'op-hist-complete'
    );
    assert.equal(completeRes.status, 200);
    const completedSess: AuditSession = completeRes.body.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-dept-a-history'
    );
    assert.equal(completedSess.completionSummary!.totalExpected, initialSnapshotCount);
    assert.equal(completedSess.completionSummary!.additionalFindingsCount, 1);
    assert.equal(
      completedSess.completionSummary!.foundInPlaceCount +
        completedSess.completionSummary!.foundElsewhereCount +
        completedSess.completionSummary!.missingCount,
      initialSnapshotCount
    );

    // 4. Po užbaigimo pakeičiame papildomo radinio pavadinimą, kainą, atsakingą asmenį registre
    const otherUser = db.users.find((u) => u.id !== extraItem.responsibleUserId) || db.users[0];
    const editRes = await postMutate(
      baseUrl,
      completeRes.body.revision,
      {
        type: 'SAVE_ITEM',
        item: {
          ...extraItem,
          name: 'VISIŠKAI NAUJAS PAVADINIMAS PO INVENTORIZACIJOS',
          purchasePrice: 9999.99,
          responsibleUserId: otherUser.id,
        },
      },
      'op-hist-edit-after'
    );
    assert.equal(editRes.status, 200);

    const rowsAfterEdit = getEffectiveSessionRows(
      editRes.body.database.auditSessions.find((s: AuditSession) => s.id === 'audit-dept-a-history'),
      editRes.body.database.items,
      editRes.body.database.departments,
      editRes.body.database.rooms,
      editRes.body.database.users
    );
    const extraRowAfterEdit = rowsAfterEdit.find((r) => r.itemId === extraItem.id)!;
    assert.equal(extraRowAfterEdit.isAdditionalFinding, true);
    assert.equal(extraRowAfterEdit.name, extraItem.name);
    assert.equal(extraRowAfterEdit.purchasePrice, 845.5);
    assert.equal(extraRowAfterEdit.responsibleUserName, expectedRespName);
    assert.equal(computeAuditStats(rowsAfterEdit).total, initialSnapshotCount);
    assert.equal(computeAuditStats(rowsAfterEdit).additionalFindingsCount, 1);

    // 5. Pašaliname tą daiktą iš registro – užbaigto apyrašo eilutė vis tiek išlieka pilna
    const delRes = await postMutate(
      baseUrl,
      editRes.body.revision,
      { type: 'DELETE_ITEM', itemId: extraItem.id },
      'op-hist-delete-after'
    );
    assert.equal(delRes.status, 200);
    const rowsAfterDelete = getEffectiveSessionRows(
      delRes.body.database.auditSessions.find((s: AuditSession) => s.id === 'audit-dept-a-history'),
      delRes.body.database.items,
      delRes.body.database.departments,
      delRes.body.database.rooms,
      delRes.body.database.users
    );
    const extraRowAfterDelete = rowsAfterDelete.find((r) => r.itemId === extraItem.id)!;
    assert.equal(extraRowAfterDelete.name, extraItem.name);
    assert.equal(extraRowAfterDelete.purchasePrice, 845.5);
    assert.equal(extraRowAfterDelete.responsibleUserName, expectedRespName);
    assert.equal(extraRowAfterDelete.hasIncompleteHistory, undefined);

    // 6. Patikriname eksporto ir pakartotinio importo suderinamumą
    const backupRes = await fetch(`${baseUrl}/api/database/backup`);
    assert.equal(backupRes.status, 200);
    const backupJson = await backupRes.json();
    const importRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: backupJson, expectedRevision: delRes.body.revision }),
    });
    assert.equal(importRes.status, 200);
    const importBody = await importRes.json();
    const importedSession = importBody.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-dept-a-history'
    );
    assert.equal(
      importedSession.checkRecords[extraItem.id].itemSnapshot.name,
      extraItem.name
    );
    assert.equal(importedSession.completionSummary.additionalFindingsCount, 1);
  }, db);

  // 7. Senos sesijos be itemSnapshot neturi išgalvoti trūkstamos informacijos – pažymima hasIncompleteHistory
  const legacySessionMissingSnapshot: AuditSession = {
    id: 'legacy-extra-no-snap',
    year: 2025,
    title: 'Sena 2025 m. sesija',
    status: 'completed',
    startDate: '2025-05-01',
    completedDate: '2025-05-02',
    committeeMembers: [],
    scannedItemIds: ['deleted-legacy-item'],
    missingItemIds: [],
    relocatedItemIds: [],
    snapshotItems: [],
    checkRecords: {
      'deleted-legacy-item': {
        itemId: 'deleted-legacy-item',
        outcome: 'found_elsewhere',
        method: 'qr',
        checkedAt: '2025-05-01T12:00:00.000Z',
        checkedByUserName: 'Komisija',
        expectedDepartmentId: deptB.id,
        expectedRoomId: roomB.id,
        expectedRoomName: 'Kab. B',
        actualDepartmentId: deptA.id,
        actualRoomId: roomA.id,
        actualRoomName: 'Kab. A',
      },
    },
  };
  const legacyRows = getEffectiveSessionRows(
    legacySessionMissingSnapshot,
    db.items,
    db.departments,
    db.rooms,
    db.users
  );
  assert.equal(legacyRows.length, 1);
  assert.equal(legacyRows[0].hasIncompleteHistory, true);
  assert.equal(legacyRows[0].isAdditionalFinding, true);
  assert.match(legacyRows[0].name, /nėra momentinių duomenų/i);
});

test('2. Apimties taisyklės: remontuojamas ir nurašomas turtas neįtraukiamas tyliai, išimtis reikalauja patvirtinimo, o pradinis snapshot išlieka', async () => {
  const db = buildFixtureDb(1);
  const deptA = db.departments[0];
  const roomA = db.rooms.find((r) => r.departmentId === deptA.id)!;
  const deptB = db.departments.find(
    (d) => d.id !== deptA.id && db.rooms.some((r) => r.departmentId === d.id)
  )!;
  const roomB = db.rooms.find((r) => r.departmentId === deptB.id)!;

  const activeItemInA = db.items.find(
    (i) => i.departmentId === deptA.id && i.status === 'active'
  )!;

  const repairItem: InventoryItem = {
    ...db.items[0],
    id: 'item-scope-repair',
    inventoryNumber: 'TM-SC-REP',
    name: 'Monitorius remonte',
    departmentId: deptA.id,
    roomId: roomA.id,
    status: 'in_repair',
  };
  const toWriteOffItem: InventoryItem = {
    ...db.items[0],
    id: 'item-scope-wo',
    inventoryNumber: 'TM-SC-TWO',
    name: 'Spausdintuvas nurašymui',
    departmentId: deptA.id,
    roomId: roomA.id,
    status: 'to_writeoff',
  };
  const otherDeptActiveItem: InventoryItem = {
    ...db.items[0],
    id: 'item-scope-other-dept',
    inventoryNumber: 'TM-SC-OTHER',
    name: 'Kėdė iš kito skyriaus',
    departmentId: deptB.id,
    roomId: roomB.id,
    status: 'active',
  };
  db.items.push(repairItem, toWriteOffItem, otherDeptActiveItem);

  await withTempServer(async (baseUrl) => {
    const createRes = await postMutate(
      baseUrl,
      1,
      {
        type: 'CREATE_AUDIT_SESSION',
        session: {
          id: 'audit-scope-strict',
          year: 2026,
          title: 'Griežtos apimties inventorizacija',
          startDate: '2026-06-05',
          departmentId: deptA.id,
          includeInRepair: false,
          includeToWriteOff: false,
          committeeMembers: ['Dalia Vaitkutė'],
        },
      },
      'op-scope-create'
    );
    assert.equal(createRes.status, 200);
    let rev: number = createRes.body.revision;
    const sess: AuditSession = createRes.body.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-scope-strict'
    );

    // Pradiniame sąraše neturi būti nei repairItem, nei toWriteOffItem, nei kito skyriaus daikto
    assert.equal(sess.snapshotItems!.some((s) => s.itemId === repairItem.id), false);
    assert.equal(sess.snapshotItems!.some((s) => s.itemId === toWriteOffItem.id), false);
    assert.equal(sess.snapshotItems!.some((s) => s.itemId === otherDeptActiveItem.id), false);
    assert.equal(sess.snapshotItems!.some((s) => s.itemId === activeItemInA.id), true);

    // Sąmoningai neįtrauktų būsenų daiktai be išimties patvirtinimo turi būti ATMESTI tiek tikrinant, tiek perkeliant, tiek žymint trūkstamu
    for (const blockedItem of [repairItem, toWriteOffItem]) {
      const chk = await postMutate(
        baseUrl,
        rev,
        {
          type: 'RECORD_AUDIT_CHECK',
          sessionId: 'audit-scope-strict',
          itemId: blockedItem.id,
          actualRoomId: roomA.id,
          method: 'qr',
          checkedByUserName: 'Komisija',
        },
        `op-block-chk-${blockedItem.id}`
      );
      assert.equal(chk.status, 400);

      const reloc = await postMutate(
        baseUrl,
        rev,
        {
          type: 'RELOCATE_AUDIT_ITEM',
          itemId: blockedItem.id,
          newRoomId: roomA.id,
          auditDate: '2026-06-05',
          sessionId: 'audit-scope-strict',
        },
        `op-block-rel-${blockedItem.id}`
      );
      assert.equal(reloc.status, 400);

      const miss = await postMutate(
        baseUrl,
        rev,
        {
          type: 'MARK_AUDIT_ITEM_MISSING',
          sessionId: 'audit-scope-strict',
          itemId: blockedItem.id,
        },
        `op-block-miss-${blockedItem.id}`
      );
      assert.equal(miss.status, 400);
    }

    // Kito skyriaus aktyvus daiktas jo paties skyriaus kabinete negali būti patikrintas A skyriaus sesijoje
    const otherDeptOwnRoomRes = await postMutate(
      baseUrl,
      rev,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-scope-strict',
        itemId: otherDeptActiveItem.id,
        actualRoomId: roomB.id,
        method: 'qr',
        checkedByUserName: 'Komisija',
      },
      'op-other-own-room-reject'
    );
    assert.equal(otherDeptOwnRoomRes.status, 400);

    // Kito skyriaus aktyvus daiktas, rastas A skyriaus kabinete, leidžiamas tik kaip papildomas radinys
    const otherDeptInARes = await postMutate(
      baseUrl,
      rev,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-scope-strict',
        itemId: otherDeptActiveItem.id,
        actualRoomId: roomA.id,
        method: 'qr',
        checkedByUserName: 'Komisija',
      },
      'op-other-in-a-ok'
    );
    assert.equal(otherDeptInARes.status, 200);
    rev = otherDeptInARes.body.revision;
    assert.equal(
      otherDeptInARes.body.database.auditSessions.find(
        (s: AuditSession) => s.id === 'audit-scope-strict'
      ).checkRecords[otherDeptActiveItem.id].isAdditionalFinding,
      true
    );

    // AIŠKIAI patvirtinus išimtį (confirmExcludedStatus: true), remontuojamas daiktas užfiksuojamas kaip papildomas radinys su išimties požymiu
    const exceptionRes = await postMutate(
      baseUrl,
      rev,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-scope-strict',
        itemId: repairItem.id,
        actualRoomId: roomA.id,
        method: 'manual_list',
        checkedByUserName: 'Komisija',
        confirmExcludedStatus: true,
      },
      'op-repair-exception-ok'
    );
    assert.equal(exceptionRes.status, 200);
    rev = exceptionRes.body.revision;
    const excRecord = exceptionRes.body.database.auditSessions.find(
      (s: AuditSession) => s.id === 'audit-scope-strict'
    ).checkRecords[repairItem.id];
    assert.equal(excRecord.isAdditionalFinding, true);
    assert.equal(excRecord.excludedStatusException, true);

    // Jei daiktas BUVO pradiniame snapshotItems sąraše, vėliau jį pervedus į in_repair jis vis tiek išlieka pradinėje apimtyje!
    const statusChangeRes = await postMutate(
      baseUrl,
      rev,
      {
        type: 'SAVE_ITEM',
        item: {
          ...activeItemInA,
          status: 'in_repair',
        },
      },
      'op-change-snap-item-status'
    );
    assert.equal(statusChangeRes.status, 200);
    rev = statusChangeRes.body.revision;

    const checkSnapItemRes = await postMutate(
      baseUrl,
      rev,
      {
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-scope-strict',
        itemId: activeItemInA.id,
        actualRoomId: activeItemInA.roomId,
        method: 'qr',
        checkedByUserName: 'Komisija',
      },
      'op-check-snap-item-after-status-change'
    );
    assert.equal(checkSnapItemRes.status, 200);

    // Patikriname tiesiogiai evaluateItemAuditScope kodą
    const scopeCheckRepair = evaluateItemAuditScope(sess, repairItem, roomA, { action: 'check' });
    assert.equal(scopeCheckRepair.allowed, false);
    if (!scopeCheckRepair.allowed) {
      assert.equal(scopeCheckRepair.code, 'EXCLUDED_BY_STATUS');
    }
  }, db);
});

test('3. Kameros valdiklis apsaugo nuo uždarymo, perjungimo, pavėluotų klaidų ir asinchroninio dekodavimo lenktynių', async () => {
  const createMockStream = (deviceId: string) => {
    let stoppedCount = 0;
    const stream: CameraStreamLike = {
      getTracks: () => [
        {
          stop: () => {
            stoppedCount++;
          },
          getSettings: () => ({ deviceId }),
        },
      ],
      getVideoTracks: () => [
        {
          stop: () => {
            stoppedCount++;
          },
          getSettings: () => ({ deviceId }),
        },
      ],
    };
    return { stream, getStoppedCount: () => stoppedCount };
  };

  // A. Uždarymas kol getUserMedia dar neatsakė -> pavėluotas srautas iškart sustabdomas, status lieka 'idle'
  {
    let resolveGUM!: (s: CameraStreamLike) => void;
    const lateStream = createMockStream('cam-rear');
    const states: string[] = [];
    const videoEl: CameraVideoElementLike = {
      srcObject: null,
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
      play: async () => {},
      pause: () => {},
    };

    const controller = createAuditCameraController({
      env: {
        getUserMedia: () =>
          new Promise<CameraStreamLike>((res) => {
            resolveGUM = res;
          }),
        requestFrame: () => 1,
        cancelFrame: () => {},
        now: () => 1000,
        getVideoElement: () => videoEl,
        decodeFrame: async () => null,
      },
      onStateChange: (s) => states.push(s.status),
      onDecodedCode: () => {},
    });

    const startPromise = controller.start();
    controller.stop();
    resolveGUM(lateStream.stream);
    await startPromise;

    assert.equal(lateStream.getStoppedCount(), 1, 'Pavėluotas srautas privalo būti sustabdytas');
    assert.equal(controller.hasActiveStream(), false);
    assert.equal(controller.getState().status, 'idle');
    assert.equal(videoEl.srcObject, null);
    assert.equal(states[states.length - 1], 'idle');
  }

  // B. Greitas kameros perjungimas: start(cam-1) lėtas ir vėliau sufeilina/grįžta, start(cam-2) laimi -> cam-1 nepakeičia cam-2
  {
    let rejectCam1!: (e: Error) => void;
    let resolveCam2!: (s: CameraStreamLike) => void;
    const cam2 = createMockStream('cam-2');
    let getUserMediaCalls = 0;
    let scheduledRafCount = 0;

    const videoEl: CameraVideoElementLike = {
      srcObject: null,
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
      play: async () => {},
      pause: () => {},
    };

    const controller = createAuditCameraController({
      env: {
        getUserMedia: (constraints) => {
          getUserMediaCalls++;
          const vid = constraints.video as MediaTrackConstraints;
          const requestedId =
            typeof vid.deviceId === 'object' && vid.deviceId && 'exact' in vid.deviceId
              ? String(vid.deviceId.exact)
              : 'cam-1';
          if (requestedId === 'cam-1') {
            return new Promise((_, rej) => {
              rejectCam1 = rej;
            });
          }
          return new Promise((res) => {
            resolveCam2 = res;
          });
        },
        enumerateDevices: async () => [
          { deviceId: 'cam-1', kind: 'videoinput', label: 'Back camera' },
          { deviceId: 'cam-2', kind: 'videoinput', label: 'Front camera' },
        ],
        requestFrame: () => {
          scheduledRafCount++;
          return scheduledRafCount;
        },
        cancelFrame: () => {},
        now: () => 2000,
        getVideoElement: () => videoEl,
        decodeFrame: async () => null,
      },
      onStateChange: () => {},
      onDecodedCode: () => {},
    });

    const p1 = controller.start('cam-1');
    const p2 = controller.start('cam-2');
    resolveCam2(cam2.stream);
    await p2;

    // Pavėluota cam-1 klaida neturi išjungti ar sugadinti cam-2
    rejectCam1(Object.assign(new Error('Busy'), { name: 'NotReadableError' }));
    await p1;

    assert.equal(controller.getState().status, 'active');
    assert.equal(controller.getState().errorMessage, null);
    assert.equal(controller.getState().activeDeviceId, 'cam-2');
    assert.equal(cam2.getStoppedCount(), 0);
    // enumerateDevices neturi sukelti papildomo getUserMedia paleidimo!
    assert.equal(getUserMediaCalls, 2);

    controller.stop();
  }

  // C. Uždarymas kol asinchroninis decodeFrame dar vyksta -> kodas nebegrąžinamas ir kitas RAF nebeplanuojamas
  {
    const cam = createMockStream('cam-1');
    let capturedFrameCb: ((ts: number) => void) | null = null;
    let resolveDecode!: (v: string | null) => void;
    const decodedCodes: string[] = [];
    let rafIdCounter = 0;

    const videoEl: CameraVideoElementLike = {
      srcObject: null,
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
      play: async () => {},
      pause: () => {},
    };

    const controller = createAuditCameraController({
      env: {
        getUserMedia: async () => cam.stream,
        requestFrame: (cb) => {
          capturedFrameCb = cb;
          rafIdCounter++;
          return rafIdCounter;
        },
        cancelFrame: () => {},
        now: () => 3000,
        getVideoElement: () => videoEl,
        decodeFrame: () =>
          new Promise<string | null>((res) => {
            resolveDecode = res;
          }),
      },
      onStateChange: () => {},
      onDecodedCode: (code) => decodedCodes.push(code),
    });

    await controller.start('cam-1');
    const frameCb = capturedFrameCb as ((ts: number) => void) | null;
    assert.ok(frameCb, 'Turėjo suplanuoti pirmą kadrą');
    const initialRafCount = rafIdCounter;

    // Paleidžiame dekodavimo žingsnį ir uždarome kamerą kol decodeFrame dar neatsakė
    frameCb(500);
    controller.stop();
    resolveDecode('TM-LATE-CODE');
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(decodedCodes, [], 'Uždarius kamerą pavėluotas dekodavimas neturi išsiųsti kodo');
    assert.equal(rafIdCounter, initialRafCount, 'Po sustabdymo naujas kadrų ciklas neturi būti planuojamas');
  }
});

