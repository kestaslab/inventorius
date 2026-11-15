import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import JSZip from 'jszip';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
import {
  AppDatabase,
  CURRENT_DB_VERSION,
} from '../src/utils/databaseValidation.ts';
import {
  INITIAL_AUDIT_SESSION,
  INITIAL_AUTH_SETTINGS,
  INITIAL_DEPARTMENTS,
  INITIAL_ITEMS,
  INITIAL_MOVEMENTS,
  INITIAL_ROOMS,
  INITIAL_USERS,
  INITIAL_WRITEOFF_ACTS,
} from '../src/data/initialData.ts';
import { DEFAULT_ORGANIZATION_SETTINGS } from '../src/utils/organization.ts';
import { DefectReport, Department, InventoryItem, Room, User } from '../src/types/inventory.ts';
import {
  canStartDefectRepair,
  computeActiveDefectNote,
  getActiveDefects,
  getMyInventorySummary,
  isItemAssignedToUserScope,
} from '../src/utils/defectUtils.ts';
import { applyDbMutation } from '../src/utils/dbOperations.ts';
import {
  applyPrintDialogOutcome,
  confirmLabelApplied,
  encodeCode128B,
  filterLabelItems,
  getBarcodeValue,
  getLabelCacheKey,
  renderCode128PngBytes,
  unmarkLabelApplied,
} from '../src/utils/labelUtils.ts';
import {
  buildBrotherPrintHtml,
  generateQrMapForItems,
} from '../src/utils/brotherPrinter.ts';
import { generateLabelsDocxBuffer, sanitizeDocxText } from '../src/utils/docxExport.ts';
import { buildItemQrPayload, resolveScannedInventoryItem } from '../src/utils/qrUtils.ts';
import { buildCsvContent } from '../src/utils/csvUtils.ts';
import {
  analyzeUsersCsvImport,
  buildFinalBatchUsersFromPreview,
  parseCsvMatrix,
} from '../src/utils/userCsvImport.ts';

function buildFixtureDb(revision = 1): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
    exportedAt: new Date().toISOString(),
    revision,
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: structuredClone(INITIAL_WRITEOFF_ACTS),
    auditSessions: [structuredClone(INITIAL_AUDIT_SESSION)],
    authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
    organizationSettings: structuredClone(DEFAULT_ORGANIZATION_SETTINGS),
  };
}

async function startTestServer(initialDb: AppDatabase) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage6-'));
  const dbPath = path.join(tempDir, 'school_database.json');
  fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2), 'utf-8');

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  return {
    baseUrl,
    cleanup: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

// ============================================================================
// 1. GEDIMŲ IR REMONTO PROCESAS
// ============================================================================

test('Stage 6 Defects: reporting defect preserves active status and condition, and supports multi-defect start/resolve lifecycle', () => {
  let db = buildFixtureDb();
  const target = db.items.find((i) => i.status === 'active')!;
  const initialCondition = target.condition;
  const initialNotes = target.notes;

  const defect1: DefectReport = {
    id: 'def-s6-1',
    reportedAt: '2026-10-01T08:00:00.000Z',
    reportedByUserId: 'usr-teacher-1',
    reportedByUserName: 'Rasa Jonaitienė',
    description: 'Neveikia HDMI jungtis',
    severity: 'medium',
    status: 'reported',
  };

  // 1) Pranešimas apie gedimą neturi automatiškai pradėti remonto ar bloginti būklės
  const r1 = applyDbMutation(db, {
    type: 'SAVE_FAULT_REPORT',
    itemId: target.id,
    defectReport: defect1,
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  db = r1.database;

  let updatedItem = db.items.find((i) => i.id === target.id)!;
  assert.equal(updatedItem.status, 'active', 'Pranešimas negali automatiškai perjungti daikto į in_repair');
  assert.equal(updatedItem.condition, initialCondition, 'Pranešimas negali tyliai pabloginti daikto būklės');
  assert.equal(updatedItem.notes, initialNotes, 'Pranešimas negali teršti bendro notes lauko');
  assert.equal(updatedItem.defectReports?.length, 1);
  assert.equal(updatedItem.defectReports?.[0].status, 'reported');
  assert.equal(updatedItem.activeDefectNote, 'Neveikia HDMI jungtis');

  // 2) Antras gedimas ant to paties daikto
  const defect2: DefectReport = {
    id: 'def-s6-2',
    reportedAt: '2026-10-02T08:00:00.000Z',
    reportedByUserId: 'usr-teacher-1',
    reportedByUserName: 'Rasa Jonaitienė',
    description: 'Barška aušinimo ventiliatorius',
    severity: 'low',
    status: 'reported',
  };
  const r2 = applyDbMutation(db, {
    type: 'SAVE_FAULT_REPORT',
    itemId: target.id,
    defectReport: defect2,
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  db = r2.database;

  // 3) Pradedame pirmo gedimo remontą
  const r3 = applyDbMutation(db, {
    type: 'START_DEFECT_REPAIR',
    itemId: target.id,
    defectId: 'def-s6-1',
    startedByUserId: 'usr-admin-1',
    startedByUserName: 'Ona Direktoriūtė',
    startedAt: '2026-10-03T09:15:00.000Z',
    repairNotes: 'Perduota į servisą HDMI lizdo litavimui',
  });
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  db = r3.database;

  updatedItem = db.items.find((i) => i.id === target.id)!;
  assert.equal(updatedItem.status, 'in_repair');
  const d1InRepair = updatedItem.defectReports?.find((d) => d.id === 'def-s6-1')!;
  assert.equal(d1InRepair.status, 'in_repair');
  assert.equal(d1InRepair.repairStartedByUserName, 'Ona Direktoriūtė');
  assert.equal(d1InRepair.repairStartedAt, '2026-10-03T09:15:00.000Z');
  assert.equal(d1InRepair.repairNotes, 'Perduota į servisą HDMI lizdo litavimui');

  // 4) Užbaigti gedimą be sprendimo pastabos neleidžiama
  const emptyNoteFail = applyDbMutation(db, {
    type: 'RESOLVE_DEFECT',
    itemId: target.id,
    defectId: 'def-s6-1',
    resolvedByUserId: 'usr-admin-1',
    resolvedByUserName: 'Ona Direktoriūtė',
    resolutionNotes: '   ',
  });
  assert.equal(emptyNoteFail.ok, false);
  if (!emptyNoteFail.ok) {
    assert.equal(emptyNoteFail.statusCode, 400);
  }

  // 5) Užbaigiame def-s6-1, bet def-s6-2 vis dar aktyvus -> daiktas NEGALI grįžti į active
  const r4 = applyDbMutation(db, {
    type: 'RESOLVE_DEFECT',
    itemId: target.id,
    defectId: 'def-s6-1',
    resolvedByUserId: 'usr-admin-1',
    resolvedByUserName: 'Ona Direktoriūtė',
    resolvedAt: '2026-10-05T11:30:00.000Z',
    resolutionNotes: 'Pakeistas HDMI lizdas ir ištestuota.',
  });
  assert.equal(r4.ok, true);
  if (!r4.ok) return;
  db = r4.database;

  updatedItem = db.items.find((i) => i.id === target.id)!;
  assert.equal(updatedItem.status, 'in_repair', 'Likęs aktyvus def-s6-2 turi išlaikyti remonto būseną');
  assert.equal(getActiveDefects(updatedItem).length, 1);
  assert.equal(getActiveDefects(updatedItem)[0].id, 'def-s6-2');
  assert.equal(updatedItem.activeDefectNote, 'Barška aušinimo ventiliatorius');

  // 6) Išsprendžiame paskutinį aktyvų gedimą -> daiktas grįžta į active, bet visa istorija išlieka
  const r5 = applyDbMutation(db, {
    type: 'RESOLVE_DEFECT',
    itemId: target.id,
    defectId: 'def-s6-2',
    resolvedByUserId: 'usr-admin-1',
    resolvedByUserName: 'Ona Direktoriūtė',
    resolvedAt: '2026-10-06T14:00:00.000Z',
    resolutionNotes: 'Išvalytas ir suteptas aušintuvas.',
  });
  assert.equal(r5.ok, true);
  if (!r5.ok) return;
  db = r5.database;

  updatedItem = db.items.find((i) => i.id === target.id)!;
  assert.equal(updatedItem.status, 'active');
  assert.equal(getActiveDefects(updatedItem).length, 0);
  assert.equal(updatedItem.defectReports?.length, 2, 'Visa gedimų istorija turi būti išsaugota');
  assert.equal(computeActiveDefectNote(updatedItem.defectReports), undefined);
  assert.equal(updatedItem.activeDefectNote, undefined);
});

test('Stage 6 Defects: write-off and archive statuses have strict priority over repair transitions', () => {
  const db = buildFixtureDb();
  const base = db.items[0];
  db.items = [
    {
      ...base,
      id: 'item-wo-priority',
      status: 'to_writeoff',
      defectReports: [
        {
          id: 'def-wo-1',
          reportedAt: '2026-10-10T08:00:00.000Z',
          reportedByUserId: 'usr-1',
          reportedByUserName: 'Jonas',
          description: 'Visiškai sugedęs ekranas',
          severity: 'high',
          status: 'reported',
        },
      ],
    },
    {
      ...base,
      id: 'item-arch-priority',
      inventoryNumber: 'TM-ARCH-99',
      status: 'written_off',
      defectReports: [
        {
          id: 'def-arch-1',
          reportedAt: '2026-10-10T08:00:00.000Z',
          reportedByUserId: 'usr-1',
          reportedByUserName: 'Jonas',
          description: 'Senas gedimas',
          severity: 'medium',
          status: 'reported',
        },
      ],
    },
  ];

  assert.equal(
    canStartDefectRepair(db.items[0], db.items[0].defectReports![0]).allowed,
    false
  );
  assert.equal(
    canStartDefectRepair(db.items[1], db.items[1].defectReports![0]).allowed,
    false
  );

  // Naujas gedimo pranešimas ant to_writeoff daikto išsaugo to_writeoff būseną
  const repRes = applyDbMutation(db, {
    type: 'SAVE_FAULT_REPORT',
    itemId: 'item-wo-priority',
    defectReport: {
      id: 'def-wo-2',
      reportedAt: '2026-10-11T08:00:00.000Z',
      reportedByUserId: 'usr-1',
      reportedByUserName: 'Jonas',
      description: 'Papildomas aprašymas aktui',
      severity: 'medium',
      status: 'reported',
    },
  });
  assert.equal(repRes.ok, true);
  if (repRes.ok) {
    assert.equal(repRes.database.items[0].status, 'to_writeoff');
    assert.equal(repRes.database.items[0].defectReports?.length, 2);
  }

  // Bandymas pradėti remontą to_writeoff arba written_off daiktui atmetamas 409 Conflict
  const startWoFail = applyDbMutation(db, {
    type: 'START_DEFECT_REPAIR',
    itemId: 'item-wo-priority',
    defectId: 'def-wo-1',
    startedByUserName: 'Admin',
  });
  assert.equal(startWoFail.ok, false);
  if (!startWoFail.ok) assert.equal(startWoFail.statusCode, 409);

  const startArchFail = applyDbMutation(db, {
    type: 'START_DEFECT_REPAIR',
    itemId: 'item-arch-priority',
    defectId: 'def-arch-1',
    startedByUserName: 'Admin',
  });
  assert.equal(startArchFail.ok, false);
  if (!startArchFail.ok) assert.equal(startArchFail.statusCode, 409);
});

test('Stage 6 Defects: concurrent server mutations on the same item return 409 Conflict without silent overwrite', async () => {
  const initialDb = buildFixtureDb(1);
  const targetItem = initialDb.items[0];
  const srv = await startTestServer(initialDb);

  try {
    // Klientas A praneša gedimą #1 pagal baseRevision = 1
    const resA = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'op-a-1',
        operation: {
          type: 'SAVE_FAULT_REPORT',
          itemId: targetItem.id,
          defectReport: {
            id: 'def-conc-a',
            reportedAt: '2026-10-12T08:00:00.000Z',
            reportedByUserId: 'usr-a',
            reportedByUserName: 'Klientas A',
            description: 'Gedimas A',
            severity: 'medium',
            status: 'reported',
          },
        },
      }),
    });
    assert.equal(resA.status, 200);

    // Klientas B tuo pačiu metu bando pakeisti tą patį daiktą su pasenusia baseRevision = 1
    const resB = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'op-b-1',
        operation: {
          type: 'SAVE_FAULT_REPORT',
          itemId: targetItem.id,
          defectReport: {
            id: 'def-conc-b',
            reportedAt: '2026-10-12T08:05:00.000Z',
            reportedByUserId: 'usr-b',
            reportedByUserName: 'Klientas B',
            description: 'Gedimas B',
            severity: 'high',
            status: 'reported',
          },
        },
      }),
    });
    assert.equal(resB.status, 409, 'Lygiagretus to paties daikto keitimas privalo grąžinti 409 Conflict');

    const dbRes = await fetch(`${srv.baseUrl}/database`);
    const latest = (await dbRes.json()) as AppDatabase;
    const savedItem = latest.items.find((i) => i.id === targetItem.id)!;
    assert.equal(
      savedItem.defectReports?.some((d) => d.id === 'def-conc-a'),
      true
    );
    assert.equal(
      savedItem.defectReports?.some((d) => d.id === 'def-conc-b'),
      false,
      'Konfliktinė operacija negali perrašyti kito naudotojo pakeitimo'
    );
  } finally {
    await srv.cleanup();
  }
});

test('Stage 6 Defects & MyInventory: sidebar count matches assigned active items and separates written_off + resolved defects', () => {
  const user: User = {
    id: 'usr-scope-1',
    fullName: 'Petras Mokytojas',
    email: 'petras@tryskiai.lt',
    role: 'teacher',
    roleTitle: 'Fizikos mokytojas',
    departmentId: 'dept-1',
    assignedRoomId: 'room-1',
    assignedRoomIds: ['room-1', 'room-2'],
    isActive: true,
    isArchived: false,
  };

  const rooms: Room[] = [
    { id: 'room-1', departmentId: 'dept-1', number: '101', name: 'Fizikos kab.', floor: 1 },
    { id: 'room-2', departmentId: 'dept-1', number: '102', name: 'Laboratorija', floor: 1 },
    { id: 'room-3', departmentId: 'dept-1', number: '103', name: 'Dailės kab.', floor: 1, defaultResponsiblePersonId: 'usr-scope-1' },
    { id: 'room-4', departmentId: 'dept-1', number: '104', name: 'Kitas kab.', floor: 2 },
  ];

  const base = INITIAL_ITEMS[0];
  const items: InventoryItem[] = [
    { ...base, id: 'it-1', inventoryNumber: 'TM-1', roomId: 'room-1', responsibleUserId: 'usr-other', status: 'active' },
    {
      ...base,
      id: 'it-2',
      inventoryNumber: 'TM-2',
      roomId: 'room-4',
      responsibleUserId: 'usr-scope-1',
      status: 'active',
      defectReports: [
        { id: 'd-rep', reportedAt: '2026-10-01T08:00:00.000Z', reportedByUserId: 'usr-scope-1', reportedByUserName: 'Petras', description: 'Praneštas', severity: 'medium', status: 'reported' },
        { id: 'd-res', reportedAt: '2026-09-01T08:00:00.000Z', reportedByUserId: 'usr-scope-1', reportedByUserName: 'Petras', description: 'Išspręstas senas', severity: 'low', status: 'resolved', resolutionNotes: 'Sutaisyta' },
      ],
    },
    {
      ...base,
      id: 'it-3',
      inventoryNumber: 'TM-3',
      roomId: 'room-3', // per defaultResponsiblePersonId
      responsibleUserId: 'usr-other',
      status: 'in_repair',
      defectReports: [
        { id: 'd-inrep', reportedAt: '2026-10-02T08:00:00.000Z', reportedByUserId: 'usr-scope-1', reportedByUserName: 'Petras', description: 'Remonte', severity: 'high', status: 'in_repair' },
      ],
    },
    {
      ...base,
      id: 'it-4-wo',
      inventoryNumber: 'TM-4',
      roomId: 'room-2',
      responsibleUserId: 'usr-scope-1',
      status: 'written_off',
    },
    {
      ...base,
      id: 'it-5-other',
      inventoryNumber: 'TM-5',
      roomId: 'room-4',
      responsibleUserId: 'usr-other',
      status: 'active',
    },
  ];

  assert.equal(isItemAssignedToUserScope(items[0], user, rooms), true);
  assert.equal(isItemAssignedToUserScope(items[2], user, rooms), true);
  assert.equal(isItemAssignedToUserScope(items[4], user, rooms), false);

  const summary = getMyInventorySummary(items, user, rooms);
  assert.equal(summary.assignedItems.length, 3, 'written_off turi būti atskirtas nuo numatytojo aktyvaus sąrašo');
  assert.equal(summary.writtenOffItems.length, 1);
  assert.equal(summary.writtenOffItems[0].id, 'it-4-wo');
  assert.equal(summary.operationalItemsCount, 2);
  assert.equal(summary.inRepairItemsCount, 1);
  assert.equal(summary.activeDefectItemsCount, 2, 'Tiek it-2 (reported), tiek it-3 (in_repair) turi aktyvų gedimą');
  assert.equal(summary.activeDefectReportsCount, 2, 'Išspręstas gedimas d-res neturi būti skaičiuojamas kaip aktyvus');
  assert.equal(summary.resolvedDefectReportsCount, 1);
});

// ============================================================================
// 2. ETIKETĖS IR SPAUSDINIMO EIGA
// ============================================================================

test('Stage 6 Labels: preSelectedIds strictly limits exported items and cache key invalidates on item edits', () => {
  const allItems = INITIAL_ITEMS.slice(0, 4).map((it, idx) => ({
    ...it,
    id: `lbl-${idx}`,
    status: idx === 3 ? ('written_off' as const) : ('active' as const),
  }));

  const strictFiltered = filterLabelItems(allItems, {
    preSelectedIds: ['lbl-1', 'lbl-3'],
    usePreselection: true,
  });
  // lbl-3 yra written_off, tad lieka TIK lbl-1 (jokių kitų daiktų tyliai neprijungiama!)
  assert.deepEqual(
    strictFiltered.map((i) => i.id),
    ['lbl-1']
  );

  const baseItem = allItems[0];
  const keyOriginal = getLabelCacheKey(baseItem);
  const keyRenamed = getLabelCacheKey({ ...baseItem, name: `${baseItem.name} PRO` });
  const keyMoved = getLabelCacheKey({ ...baseItem, roomId: 'room-changed' });
  const keyBarcodeChanged = getLabelCacheKey({ ...baseItem, barcode: 'BC-999' });

  assert.notEqual(keyOriginal, keyRenamed);
  assert.notEqual(keyOriginal, keyMoved);
  assert.notEqual(keyOriginal, keyBarcodeChanged);
});

test('Stage 6 Labels: closing print dialog or encountering an error NEVER auto-marks item as labeled', () => {
  let labeled = new Set<string>();

  const onClose = applyPrintDialogOutcome({ status: 'dialog_closed' }, 'item-1');
  assert.equal(onClose.status, 'awaiting_confirmation');
  assert.equal(labeled.has('item-1'), false, 'Dialogo uždarymas negali automatiškai pažymėti paženklintu');

  const onErr = applyPrintDialogOutcome(
    { status: 'error', error: 'Spausdintuvas nepasiekiamas' },
    'item-2'
  );
  assert.equal(onErr.status, 'error');
  assert.match(onErr.errorMessage || '', /nepasiekiamas/i);
  assert.equal(labeled.has('item-2'), false);

  labeled = confirmLabelApplied(labeled, 'item-1');
  assert.equal(labeled.has('item-1'), true);

  labeled = unmarkLabelApplied(labeled, 'item-1');
  assert.equal(labeled.has('item-1'), false);
});

test('Stage 6 Labels: QR payload round-trip, Code128 SVG/PNG, and HTML layouts work across qr_code, barcode_1d, and both', async () => {
  const sampleItem: InventoryItem = {
    ...INITIAL_ITEMS[0],
    id: 'it-code-test',
    inventoryNumber: 'TM-2026-0077',
    name: 'Švietimo projektorius Epson & "HD"',
    barcode: 'EPSC-7788',
    serialNumber: 'SN-889900',
  };

  // QR turinio suderinamumas su inventorizacijos skaitytuvu
  const qrPayload = buildItemQrPayload(sampleItem);
  const parsedBack = resolveScannedInventoryItem(qrPayload, [sampleItem]);
  assert.equal(parsedBack.ok, true);
  if (parsedBack.ok) {
    assert.equal(parsedBack.item.id, sampleItem.id);
    assert.equal(parsedBack.format, 'json_qr');
  }

  // 1D brūkšninio kodo reikšmės suderinamumas su inventorizacijos skaitytuvu
  const barcodeVal = getBarcodeValue(sampleItem);
  assert.equal(barcodeVal, 'EPSC-7788');
  const scanned1D = resolveScannedInventoryItem(barcodeVal, [sampleItem]);
  assert.equal(scanned1D.ok, true);
  if (scanned1D.ok) {
    assert.equal(scanned1D.item.id, sampleItem.id);
    assert.equal(scanned1D.matchedBy, 'barcode');
  }

  // Deterministinis Code128 PNG ir bitų modelis
  const bits = encodeCode128B(barcodeVal);
  assert.ok(bits.startsWith('0000') && bits.endsWith('0000'));
  const pngBytes = renderCode128PngBytes(barcodeVal, 2, 40);
  assert.deepEqual(Array.from(pngBytes.slice(0, 4)), [137, 80, 78, 71], 'Turi būti validus PNG parašas');

  const qrMap = await generateQrMapForItems([sampleItem]);
  assert.ok(qrMap[getLabelCacheKey(sampleItem)].startsWith('data:image/png;base64,'));

  // 1) Tik QR
  const htmlQr = buildBrotherPrintHtml(
    {
      items: [sampleItem],
      rooms: INITIAL_ROOMS,
      departments: INITIAL_DEPARTMENTS,
      codeType: 'qr_code',
      organization: DEFAULT_ORGANIZATION_SETTINGS,
    },
    qrMap
  );
  assert.equal(htmlQr.includes('<img src="data:image/png;base64,'), true);
  assert.equal(htmlQr.includes('<svg '), false);
  assert.equal(htmlQr.includes('LAZDYNYŲ'), false);
  assert.equal(htmlQr.includes('Lazdynų Pelėdos'), true);

  // 2) Tik 1D
  const html1D = buildBrotherPrintHtml(
    {
      items: [sampleItem],
      rooms: INITIAL_ROOMS,
      departments: INITIAL_DEPARTMENTS,
      codeType: 'barcode_1d',
      organization: DEFAULT_ORGANIZATION_SETTINGS,
    },
    qrMap
  );
  assert.equal(html1D.includes('<svg '), true);
  assert.equal(html1D.includes('<img '), false);
  assert.equal(html1D.includes('EPSC-7788'), true);

  // 3) QR + 1D
  const htmlBoth = buildBrotherPrintHtml(
    {
      items: [sampleItem],
      rooms: INITIAL_ROOMS,
      departments: INITIAL_DEPARTMENTS,
      codeType: 'both',
      organization: DEFAULT_ORGANIZATION_SETTINGS,
    },
    qrMap
  );
  assert.equal(htmlBoth.includes('<img src="data:image/png;base64,'), true);
  assert.equal(htmlBoth.includes('<svg '), true);
});

test('Stage 6 Labels: DOCX and CSV exports generate valid OOXML ZIP with embedded PNGs and UTF-8 BOM CSV', async () => {
  const sampleItems = INITIAL_ITEMS.slice(0, 2);

  await assert.rejects(
    () =>
      generateLabelsDocxBuffer({
        items: [],
        rooms: INITIAL_ROOMS,
        departments: INITIAL_DEPARTMENTS,
        tapeWidthMm: 36,
        labelLengthMm: 68,
        codeType: 'qr_code',
      }),
    /Nepasirinkta/
  );

  for (const mode of ['qr_code', 'barcode_1d', 'both'] as const) {
    const buffer = await generateLabelsDocxBuffer({
      items: sampleItems,
      rooms: INITIAL_ROOMS,
      departments: INITIAL_DEPARTMENTS,
      tapeWidthMm: 36,
      labelLengthMm: 68,
      codeType: mode,
      organization: DEFAULT_ORGANIZATION_SETTINGS,
    });
    assert.equal(buffer[0], 0x50); // 'P'
    assert.equal(buffer[1], 0x4b); // 'K'
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    assert.ok(docXml && docXml.includes(sampleItems[0].inventoryNumber));
    assert.equal(docXml.includes('LAZDYNYŲ'), false);
    const mediaFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('word/media/') && f.endsWith('.png')
    );
    const expectedMinImages = mode === 'both' ? sampleItems.length * 2 : sampleItems.length;
    assert.ok(
      mediaFiles.length >= expectedMinImages,
      `DOCX režime ${mode} turi būti bent ${expectedMinImages} PNG paveikslėlių`
    );
  }

  assert.equal(sanitizeDocxText('Ąžuolas\u0007 <>&"'), 'Ąžuolas <>&"');

  const csv = buildCsvContent(
    ['Inv. Nr.', 'Pavadinimas', 'QR duomenys'],
    [[sampleItems[0].inventoryNumber, 'Monitorius "Dell"; 24"', buildItemQrPayload(sampleItems[0])]]
  );
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.ok(csv.includes('"Monitorius ""Dell""; 24"""'));
});

// ============================================================================
// 3. DARBUOTOJŲ CSV IMPORTAS
// ============================================================================

test('Stage 6 CSV Import: RFC-4180 parser supports UTF-8 BOM, Lithuanian letters, multiline & quoted delimiters', () => {
  const csv =
    '\uFEFFVardas Pavardė;El. paštas;Pareigos;Skyrius;Kabinetas;Telefonas\r\n' +
    '"Žygimantas Ąžuolaitis";"Zygis@tryskiai.lt";"Fizikos; IT mokytojas";Pagrindinis;"101, 102";"+37060011122"\r\n' +
    '"Ona ""Vyresnioji""\nMokytoja";ona@tryskiai.lt;Mokytoja;Pagrindinis;101;+37060033344\r\n';

  const parsed = parseCsvMatrix(csv);
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.headers, [
    'Vardas Pavardė',
    'El. paštas',
    'Pareigos',
    'Skyrius',
    'Kabinetas',
    'Telefonas',
  ]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][0], 'Žygimantas Ąžuolaitis');
  assert.equal(parsed.rows[0][2], 'Fizikos; IT mokytojas');
  assert.equal(parsed.rows[0][4], '101, 102');
  assert.equal(parsed.rows[1][0], 'Ona "Vyresnioji"\nMokytoja');
});

test('Stage 6 CSV Import: detects ambiguity without auto-picking room, preserves omitted fields/security/archive, and handles multi-room + duplicates', () => {
  const depts: Department[] = [
    { id: 'dept-a', name: 'Pagrindinis pastatas', code: 'PAG', building: 'A korpusas', description: 'Pagrindinis korpusas' },
    { id: 'dept-b', name: 'Pradinės klasės', code: 'PRA', building: 'B korpusas', description: 'Pradinių klasių korpusas' },
  ];
  const rooms: Room[] = [
    { id: 'rm-a-101', departmentId: 'dept-a', number: '101', name: 'Biologijos kab.', floor: 1 },
    { id: 'rm-a-102', departmentId: 'dept-a', number: '102', name: 'Chemijos kab.', floor: 1 },
    { id: 'rm-b-101', departmentId: 'dept-b', number: '101', name: 'Pradinukų kab.', floor: 1 },
  ];
  const existingUsers: User[] = [
    {
      id: 'usr-existing-admin',
      fullName: 'Rasa Senoji',
      email: 'rasa.j@tryskiai.lt',
      allowedGmail: 'rasa.personal@gmail.com',
      role: 'admin',
      pinCode: '9999',
      roleTitle: 'Direktoriaus pavaduotoja',
      departmentId: 'dept-a',
      assignedRoomId: 'rm-a-101',
      assignedRoomIds: ['rm-a-101', 'rm-a-102'],
      phone: '+37061100000',
      isActive: true,
      isArchived: false,
    },
    {
      id: 'usr-archived',
      fullName: 'Jonas Archyvuotas',
      email: 'jonas.arch@tryskiai.lt',
      role: 'teacher',
      roleTitle: 'Mokytojas',
      departmentId: 'dept-b',
      isActive: false,
      isArchived: true,
    },
  ];

  const csvText = [
    'Vardas Pavardė;El. paštas;Pareigos;Skyrius;Kabinetas;Telefonas;Rolė;PIN',
    // 2: esamas admin su tuščiais Kabinetas ir Telefonas langeliais + ignoruojami Rolė/PIN -> išsaugo admin/9999 ir abu kabinetus
    'Rasa Naujoji;RASA.J@Tryskiai.lt;;;;;teacher;1111',
    // 3: archyvuotas darbuotojas -> atnaujinamos pareigos, bet išlieka archyvuotas/neaktyvus
    'Jonas Archyvuotas;jonas.arch@tryskiai.lt;Laborantas;;;+37065555555;admin;0000',
    // 4: dviprasmiškas kabinetas "101" be skyriaus -> PRIVALO patekti į resolutionRows, ne parinkti pirmojo
    'Aistė Dviprasmė;aiste@tryskiai.lt;Mokytoja;;101;;;',
    // 5: naujas su keliais kabinetais nurodytame skyriuje
    'Tomas KeliKabinetai;tomas@tryskiai.lt;Chemikas;Pagrindinis pastatas;"101, 102";;;',
    // 6: dublikatas pašte su eilute #4 -> skipRows
    'Aistė Dublikatas;aiste@tryskiai.lt;Mokytoja;PAG;101;;;',
  ].join('\n');

  const analysis = analyzeUsersCsvImport({
    csvText,
    existingUsers,
    departments: depts,
    rooms,
  });

  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.ignoredAccessColumns, ['Rolė', 'PIN']);
  assert.equal(analysis.updateRows.length, 2);
  assert.equal(analysis.createRows.length, 1);
  assert.equal(analysis.resolutionRows.length, 1);
  assert.equal(analysis.skipRows.length, 1);

  // Esamo admin atnaujinimas be saugumo ar ryšių praradimo
  const updatedAdmin = analysis.updateRows.find((r) => r.existingUser?.id === 'usr-existing-admin')!;
  assert.equal(updatedAdmin.proposedUser?.role, 'admin');
  assert.equal(updatedAdmin.proposedUser?.pinCode, '9999');
  assert.equal(updatedAdmin.proposedUser?.phone, '+37061100000');
  assert.equal(updatedAdmin.proposedUser?.allowedGmail, 'rasa.personal@gmail.com');
  assert.deepEqual(updatedAdmin.proposedUser?.assignedRoomIds, ['rm-a-101', 'rm-a-102']);
  assert.equal(updatedAdmin.proposedUser?.roleTitle, 'Direktoriaus pavaduotoja');

  // Archyvuotas darbuotojas lieka archyvuotas ir neaktyvus
  const updatedArchived = analysis.updateRows.find((r) => r.existingUser?.id === 'usr-archived')!;
  assert.equal(updatedArchived.preservesArchivedStatus, true);
  assert.equal(updatedArchived.proposedUser?.isArchived, true);
  assert.equal(updatedArchived.proposedUser?.isActive, false);

  // Dviprasmiškas kabinetas 101 nepriskirtas automatiškai
  const ambRow = analysis.resolutionRows[0];
  assert.equal(ambRow.unresolvedRooms.length, 1);
  assert.equal(ambRow.unresolvedRooms[0].candidates.length, 2);

  // Kelių kabinetų priskyrimas naujam darbuotojui
  const createdTomas = analysis.createRows[0].proposedUser!;
  assert.equal(createdTomas.role, 'teacher');
  assert.equal(createdTomas.departmentId, 'dept-a');
  assert.deepEqual(createdTomas.assignedRoomIds, ['rm-a-101', 'rm-a-102']);
  assert.equal(createdTomas.assignedRoomId, 'rm-a-101');

  // Neišsprendus dviprasmybės, final build turi atmesti su aiškia klaida
  const failWithoutChoice = buildFinalBatchUsersFromPreview(analysis, {}, rooms, depts);
  assert.equal(failWithoutChoice.ok, false);

  // Parinkus konkretų kabinetą rm-b-101, galutinis sąrašas suformuojamas deterministiškai
  const okWithChoice = buildFinalBatchUsersFromPreview(
    analysis,
    { roomChoices: { [`${ambRow.rowNumber}:0`]: 'rm-b-101' } },
    rooms,
    depts
  );
  assert.equal(okWithChoice.ok, true);
  if (okWithChoice.ok) {
    const aiste = okWithChoice.users.find((u) => u.email === 'aiste@tryskiai.lt')!;
    assert.deepEqual(aiste.assignedRoomIds, ['rm-b-101']);
    assert.equal(aiste.departmentId, 'dept-b');
  }
});

test('Stage 6 CSV Import Server Atomicity: BATCH_IMPORT_USERS rejects partial invalid batches atomically and persists valid batches safely', async () => {
  const initialDb = buildFixtureDb(1);
  const existingAdmin = initialDb.users.find((u) => u.role === 'admin')!;
  const initialUsersCount = initialDb.users.length;
  const activeDept = initialDb.departments.find((d) => !d.isArchived)!;
  const activeRooms = initialDb.rooms.filter((r) => !r.isArchived);

  const srv = await startTestServer(initialDb);
  try {
    // 1) Atominis atmetimas: pirma eilutė gera, antra turi neegzistuojantį kabinetą -> NETURI likti dalinių pakeitimų!
    const badRes = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'batch-bad-1',
        operation: {
          type: 'BATCH_IMPORT_USERS',
          users: [
            {
              id: 'usr-partial-should-not-exist',
              fullName: 'Teisingas Bet Atšauktas',
              email: 'teisingas@tryskiai.lt',
              role: 'teacher',
              roleTitle: 'Mokytojas',
              departmentId: activeDept.id,
              isActive: true,
            },
            {
              id: 'usr-bad-room',
              fullName: 'Blogas Kabinetas',
              email: 'blogas@tryskiai.lt',
              role: 'teacher',
              roleTitle: 'Mokytojas',
              departmentId: activeDept.id,
              assignedRoomId: 'room-nonexistent-999',
              assignedRoomIds: ['room-nonexistent-999'],
              isActive: true,
            },
          ],
        },
      }),
    });
    assert.equal(badRes.status, 400);

    const checkAfterBad = (await (await fetch(`${srv.baseUrl}/database`)).json()) as AppDatabase;
    assert.equal(checkAfterBad.users.length, initialUsersCount);
    assert.equal(
      checkAfterBad.users.some((u) => u.email === 'teisingas@tryskiai.lt'),
      false,
      'Klaidingas paketas negali išsaugoti net ir ankstesnių teisingų eilučių'
    );

    // 2) Sėkmingas atominis paketas su esamo administratoriaus duomenų atnaujinimu (bandant įkišti teacher/0000) ir nauju darbuotoju su keliais kabinetais
    const goodRes = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: checkAfterBad.revision,
        clientOpId: 'batch-good-1',
        operation: {
          type: 'BATCH_IMPORT_USERS',
          users: [
            {
              id: existingAdmin.id,
              fullName: existingAdmin.fullName,
              email: existingAdmin.email.toUpperCase(),
              role: 'teacher', // privalo būti ignoruota serveryje esamam naudotojui!
              pinCode: '0000', // privalo būti ignoruota serveryje!
              roleTitle: 'Atnaujintos pareigos',
              isActive: true,
            },
            {
              id: 'usr-new-csv-1',
              fullName: 'Lina Naujokė',
              email: 'lina.naujoke@tryskiai.lt',
              role: 'teacher',
              roleTitle: 'Matematikos mokytoja',
              departmentId: activeDept.id,
              assignedRoomId: activeRooms[0].id,
              assignedRoomIds: activeRooms.slice(0, 2).map((r) => r.id),
              isActive: true,
            },
          ],
        },
      }),
    });
    assert.equal(goodRes.status, 200);

    const checkAfterGood = (await (await fetch(`${srv.baseUrl}/database`)).json()) as AppDatabase;
    assert.equal(checkAfterGood.users.length, initialUsersCount + 1);

    const savedAdmin = checkAfterGood.users.find((u) => u.id === existingAdmin.id)!;
    assert.equal(savedAdmin.role, existingAdmin.role, 'Serveris negali leisti CSV perrašyti rolės');
    assert.equal(savedAdmin.pinCode, existingAdmin.pinCode, 'Serveris negali leisti CSV perrašyti PIN kodo');
    assert.equal(savedAdmin.roleTitle, 'Atnaujintos pareigos');

    const savedNew = checkAfterGood.users.find((u) => u.email === 'lina.naujoke@tryskiai.lt')!;
    assert.equal(savedNew.role, 'teacher');
    assert.deepEqual(
      savedNew.assignedRoomIds,
      activeRooms.slice(0, 2).map((r) => r.id)
    );
  } finally {
    await srv.cleanup();
  }
});
