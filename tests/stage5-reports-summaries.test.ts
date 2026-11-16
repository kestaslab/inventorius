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
  validateAndMigrateDatabase,
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
import {
  AuditSession,
  InventoryItem,
  OrganizationSettings,
  WriteOffAct,
} from '../src/types/inventory.ts';
import {
  computeInventorySummary,
  formatMoneyFixed,
  resolveAssetClass,
  sumMoney,
  summarizeResidualValues,
} from '../src/utils/accountingUtils.ts';
import {
  calculateCalendarAgeYears,
  formatDateTimeVilnius,
  getCalendarDatePart,
  getCalendarYearFromDate,
} from '../src/utils/dateUtils.ts';
import { DEFAULT_ORGANIZATION_SETTINGS } from '../src/utils/organization.ts';
import {
  buildAuditSessionReportData,
  buildRegistrySheetReportData,
  buildReportCsv,
  buildResidualSummaryText,
  buildUserSheetReportData,
  buildWriteOffActReportData,
} from '../src/utils/reportUtils.ts';
import { generateReportDocxBuffer } from '../src/utils/docxExport.ts';
import { StorageService } from '../src/utils/storage.ts';
import { getWriteOffActYear } from '../src/utils/writeOffUtils.ts';

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage5-'));
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

test('Stage 5: Audit session report preserves states, separates additional findings, and never shows "Yra"', () => {
  const db = buildFixtureDb();
  const baseItem1 = db.items[0];
  const baseItem2 = db.items[1];
  const baseItem3 = db.items[2];
  const extraItem = db.items[3];

  const session: AuditSession = {
    id: 'audit-stage5-1',
    year: 2027,
    title: '2027 m. pavasario inventorizacija',
    status: 'in_progress',
    startDate: '2027-04-10',
    committeeChairman: 'Ona Pirmininkė',
    committeeMembers: ['Petras Narys', 'Birutė Narė'],
    orderNumber: 'V-99',
    orderDate: '2027-04-05',
    scannedItemIds: [baseItem1.id, baseItem2.id],
    missingItemIds: [],
    relocatedItemIds: [baseItem2.id],
    snapshotItems: [
      {
        itemId: baseItem1.id,
        inventoryNumber: baseItem1.inventoryNumber,
        name: baseItem1.name,
        category: baseItem1.category,
        expectedDepartmentId: baseItem1.departmentId,
        expectedDepartmentName: 'Pagrindinis korpusas',
        expectedRoomId: baseItem1.roomId,
        expectedRoomName: '101 kab.',
        responsibleUserId: baseItem1.responsibleUserId,
        responsibleUserName: 'Jonas Atsakingas',
        purchasePrice: 510.25,
        statusAtStart: baseItem1.status,
      },
      {
        itemId: baseItem2.id,
        inventoryNumber: baseItem2.inventoryNumber,
        name: baseItem2.name,
        category: baseItem2.category,
        expectedDepartmentId: baseItem2.departmentId,
        expectedDepartmentName: 'Pagrindinis korpusas',
        expectedRoomId: baseItem2.roomId,
        expectedRoomName: '102 kab.',
        responsibleUserId: baseItem2.responsibleUserId,
        responsibleUserName: 'Jonas Atsakingas',
        purchasePrice: 120.75,
        statusAtStart: baseItem2.status,
      },
      {
        itemId: baseItem3.id,
        inventoryNumber: baseItem3.inventoryNumber,
        name: baseItem3.name,
        category: baseItem3.category,
        expectedDepartmentId: baseItem3.departmentId,
        expectedDepartmentName: 'Pagrindinis korpusas',
        expectedRoomId: baseItem3.roomId,
        expectedRoomName: '103 kab.',
        responsibleUserId: baseItem3.responsibleUserId,
        responsibleUserName: 'Jonas Atsakingas',
        purchasePrice: 89.0,
        statusAtStart: baseItem3.status,
      },
    ],
    checkRecords: {
      [baseItem1.id]: {
        itemId: baseItem1.id,
        outcome: 'found',
        method: 'qr',
        checkedAt: '2027-04-10T10:00:00.000Z',
        checkedByUserName: 'Ona Pirmininkė',
        expectedDepartmentId: baseItem1.departmentId,
        expectedRoomId: baseItem1.roomId,
        expectedRoomName: '101 kab.',
        actualDepartmentId: baseItem1.departmentId,
        actualRoomId: baseItem1.roomId,
        actualRoomName: '101 kab.',
      },
      [baseItem2.id]: {
        itemId: baseItem2.id,
        outcome: 'found_elsewhere',
        method: 'manual_code',
        checkedAt: '2027-04-10T10:05:00.000Z',
        checkedByUserName: 'Petras Narys',
        expectedDepartmentId: baseItem2.departmentId,
        expectedRoomId: baseItem2.roomId,
        expectedRoomName: '102 kab.',
        actualDepartmentId: baseItem1.departmentId,
        actualRoomId: baseItem1.roomId,
        actualRoomName: '101 kab.',
      },
      [extraItem.id]: {
        itemId: extraItem.id,
        outcome: 'found_elsewhere',
        method: 'qr',
        checkedAt: '2027-04-10T10:15:00.000Z',
        checkedByUserName: 'Ona Pirmininkė',
        expectedDepartmentId: extraItem.departmentId,
        expectedRoomId: extraItem.roomId,
        expectedRoomName: '201 kab.',
        actualDepartmentId: baseItem1.departmentId,
        actualRoomId: baseItem1.roomId,
        actualRoomName: '101 kab.',
        isAdditionalFinding: true,
        itemSnapshot: {
          inventoryNumber: extraItem.inventoryNumber,
          name: 'Papildomas momentinis įrašas',
          category: extraItem.category,
          expectedDepartmentName: 'Kitas skyrius',
          responsibleUserId: extraItem.responsibleUserId,
          responsibleUserName: 'Kitas Asmuo',
          purchasePrice: 333.33,
          statusAtCheck: extraItem.status,
        },
      },
    },
  };

  const report = buildAuditSessionReportData({
    session,
    items: db.items,
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    organizationSettings: db.organizationSettings,
    generatedDate: '2027-04-10',
  });

  assert.equal(report.expectedRows.length, 3);
  assert.equal(report.additionalRows.length, 1);
  assert.equal(report.expectedRows[0].auditStateLabel, 'Rastas vietoje');
  assert.equal(report.expectedRows[1].auditStateLabel, 'Rastas kitur (101 kab.)');
  assert.equal(report.expectedRows[2].auditStateLabel, 'Dar nepatikrinta');
  assert.equal(report.additionalRows[0].name, 'Papildomas momentinis įrašas');
  assert.equal(report.expectedTotalValue, 720.0);
  assert.equal(report.additionalTotalValue, 333.33);
  assert.equal(report.committeeChairman, 'Ona Pirmininkė');
  assert.deepEqual(report.committeeMembers, ['Petras Narys', 'Birutė Narė']);

  const csv = buildReportCsv(report);
  assert.ok(!csv.content.includes(';Yra;'));
  assert.ok(csv.content.includes('Dar nepatikrinta'));
  assert.ok(csv.content.includes('Papildomas radinys'));
  assert.ok(csv.content.includes('Papildomas momentinis įrašas'));
});

test('Stage 5: Completed audit session and approved act remain immutable after registry edits/deletions and org changes', async () => {
  const initialDb = buildFixtureDb(1);
  const { baseUrl, cleanup } = await startTestServer(initialDb);

  try {
    const itemA = initialDb.items[0];
    const extraB = initialDb.items[1];
    const sessionId = 'audit-immutable-1';

    // 1. Create audit session scoped to itemA's department
    const createRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-1',
        baseRevision: 1,
        operation: {
          type: 'CREATE_AUDIT_SESSION',
          session: {
            id: sessionId,
            year: 2027,
            title: '2027 m. užrakinta inventorizacija',
            startDate: '2027-05-01',
            departmentId: itemA.departmentId,
            committeeChairman: 'Pirmininkė Asta',
            committeeMembers: ['Narys Tomas'],
            orderNumber: 'V-55',
            orderDate: '2027-04-29',
          },
        },
      }),
    });
    const createdJson = await createRes.json();
    assert.equal(createRes.status, 200);
    let rev = createdJson.database.revision;

    // 2. Check extraB as additional finding (simulate item in another dept found in itemA room if needed)
    const targetRoomId = itemA.roomId;
    const otherDeptItem = initialDb.items.find((i) => i.departmentId !== itemA.departmentId) || extraB;

    const checkRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-2',
        baseRevision: rev,
        operation: {
          type: 'RECORD_AUDIT_CHECK',
          sessionId,
          itemId: otherDeptItem.id,
          actualRoomId: targetRoomId,
          method: 'qr',
          checkedByUserName: 'Pirmininkė Asta',
          checkedAt: '2027-05-01T12:00:00.000Z',
        },
      }),
    });
    const checkedJson = await checkRes.json();
    assert.equal(checkRes.status, 200);
    rev = checkedJson.database.revision;

    // 3. Complete audit session (freezes organizationSnapshot and completionSummary)
    const completeRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-3',
        baseRevision: rev,
        operation: {
          type: 'COMPLETE_AUDIT_SESSION',
          sessionId,
          completedDate: '2027-05-02',
          completedByUserName: 'Pirmininkė Asta',
        },
      }),
    });
    const completedJson = await completeRes.json();
    assert.equal(completeRes.status, 200);
    rev = completedJson.database.revision;

    const completedSessionBefore = completedJson.database.auditSessions.find(
      (s: AuditSession) => s.id === sessionId
    );
    assert.ok(completedSessionBefore.organizationSnapshot);
    const frozenReportBefore = buildAuditSessionReportData({
      session: completedSessionBefore,
      items: completedJson.database.items,
      departments: completedJson.database.departments,
      rooms: completedJson.database.rooms,
      users: completedJson.database.users,
      organizationSettings: completedJson.database.organizationSettings,
      generatedDate: '2027-05-02',
    });

    // 4. Approve a draft write-off act so it freezes its organizationSnapshot too
    const draftAct = completedJson.database.writeOffActs.find(
      (a: WriteOffAct) => a.status === 'draft' && a.items.length > 0
    );
    let actIdToVerify = draftAct?.id;
    if (draftAct) {
      const appRes = await fetch(`${baseUrl}/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientOpId: 'op-3b',
          baseRevision: rev,
          operation: {
            type: 'APPROVE_WRITEOFF_ACT',
            actId: draftAct.id,
            approvalYear: 2027,
            approvedDate: '2027-05-03',
            approvedByUserName: 'Direktorė',
          },
        }),
      });
      const appJson = await appRes.json();
      assert.equal(appRes.status, 200);
      rev = appJson.database.revision;
    }

    // 5. Mutate OrganizationSettings + edit itemA + delete otherDeptItem
    const newOrg: OrganizationSettings = {
      name: 'Pakeistas įstaigos pavadinimas',
      code: '999999999',
      address: 'Nauja gatvė 1',
      directorTitle: 'Laikinasis vadovas',
      directorName: 'Vardas Pavardė',
    };
    const orgRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-4',
        baseRevision: rev,
        operation: { type: 'UPDATE_ORGANIZATION_SETTINGS', organizationSettings: newOrg },
      }),
    });
    const orgJson = await orgRes.json();
    assert.equal(orgRes.status, 200);
    rev = orgJson.database.revision;

    const editRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-5',
        baseRevision: rev,
        operation: {
          type: 'SAVE_ITEM',
          item: { ...itemA, name: 'VISIŠKAI PAKEISTAS PAVADINIMAS', purchasePrice: 99999 },
        },
      }),
    });
    const editJson = await editRes.json();
    assert.equal(editRes.status, 200);
    rev = editJson.database.revision;

    const delRes = await fetch(`${baseUrl}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientOpId: 'op-6',
        baseRevision: rev,
        operation: { type: 'DELETE_ITEM', itemId: otherDeptItem.id },
      }),
    });
    const delJson = await delRes.json();
    assert.equal(delRes.status, 200);

    const completedSessionAfter = delJson.database.auditSessions.find(
      (s: AuditSession) => s.id === sessionId
    );
    const frozenReportAfter = buildAuditSessionReportData({
      session: completedSessionAfter,
      items: delJson.database.items,
      departments: delJson.database.departments,
      rooms: delJson.database.rooms,
      users: delJson.database.users,
      organizationSettings: delJson.database.organizationSettings,
      generatedDate: '2027-05-02',
    });

    assert.equal(
      frozenReportAfter.organization.name,
      DEFAULT_ORGANIZATION_SETTINGS.name,
      'Completed audit session keeps frozen organization name'
    );
    assert.equal(frozenReportAfter.usesFallbackCurrentOrg, false);
    assert.equal(frozenReportAfter.expectedTotalValue, frozenReportBefore.expectedTotalValue);
    assert.equal(frozenReportAfter.additionalTotalValue, frozenReportBefore.additionalTotalValue);
    assert.ok(
      !frozenReportAfter.expectedRows.some((r) => r.name === 'VISIŠKAI PAKEISTAS PAVADINIMAS')
    );

    if (actIdToVerify) {
      const approvedActAfter = delJson.database.writeOffActs.find(
        (a: WriteOffAct) => a.id === actIdToVerify
      );
      const actReportAfter = buildWriteOffActReportData({
        act: approvedActAfter,
        items: delJson.database.items,
        organizationSettings: delJson.database.organizationSettings,
      });
      assert.equal(actReportAfter.organization.name, DEFAULT_ORGANIZATION_SETTINGS.name);
      assert.equal(actReportAfter.usesFallbackCurrentOrg, false);
    }
  } finally {
    await cleanup();
  }
});

test('Stage 5: Legacy session and act mark incomplete history honestly without hardcoded fake names or 2026', () => {
  const db = buildFixtureDb();
  const legacySession: AuditSession = {
    id: 'legacy-2023',
    year: 2023,
    title: '2023 m. sena inventorizacija',
    status: 'completed',
    startDate: '2023-05-01',
    completedDate: '2023-05-10',
    committeeMembers: [],
    scannedItemIds: ['deleted-legacy-item-99'],
    missingItemIds: [],
    relocatedItemIds: [],
  };

  const sessionReport = buildAuditSessionReportData({
    session: legacySession,
    items: db.items,
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    organizationSettings: db.organizationSettings,
    generatedDate: '2027-01-15',
  });

  assert.equal(sessionReport.hasIncompleteHistory, true);
  assert.equal(sessionReport.usesFallbackCurrentOrg, true);
  assert.equal(sessionReport.committeeChairman, 'Nenurodyta');
  assert.deepEqual(sessionReport.committeeMembers, []);
  assert.equal(sessionReport.orderNumber, 'Nenurodyta');
  assert.ok(!sessionReport.documentNumber.includes('INV-2026/01'));
  const missingRow = sessionReport.expectedRows.find(
    (r) => r.itemId === 'deleted-legacy-item-99'
  );
  assert.ok(missingRow?.hasIncompleteHistory);

  const actReport = buildWriteOffActReportData({
    act: {
      id: 'act-no-extra-members',
      actNumber: 'NUR-2027-001',
      date: '2027-02-01',
      status: 'approved',
      committeeChair: 'Pirmininkė Irena',
      committeeMembers: [],
      reasonCategory: 'Gedimas',
      items: [
        {
          itemId: 'x1',
          name: 'Sugedęs monitorius',
          inventoryNumber: 'TM-001',
          price: 150,
          residualPrice: 0,
          reason: 'Sudegė maitinimas',
        },
      ],
    },
    items: [],
    organizationSettings: db.organizationSettings,
  });

  assert.equal(actReport.committeeChair, 'Pirmininkė Irena');
  assert.deepEqual(actReport.committeeMembers, []);
  assert.equal(actReport.usesFallbackCurrentOrg, true);
});

test('Stage 5: Empty dataset disables exports cleanly and refuses DOCX generation', async () => {
  const db = buildFixtureDb();
  const emptyRegistry = buildRegistrySheetReportData({
    items: db.items,
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    filters: { departmentId: 'non-existent-dept' },
    organizationSettings: db.organizationSettings,
  });

  assert.equal(emptyRegistry.isEmpty, true);
  assert.ok(emptyRegistry.emptyReason);
  await assert.rejects(() => generateReportDocxBuffer(emptyRegistry));

  const emptyAct = buildWriteOffActReportData({
    act: null,
    items: db.items,
    organizationSettings: db.organizationSettings,
  });
  assert.equal(emptyAct.isEmpty, true);
  await assert.rejects(() => generateReportDocxBuffer(emptyAct));
});

test('Stage 5: Unified IMT/TMT, Dashboard-Reports consistency, integer-cents math, and transparent residual summary', () => {
  // Explicit assetClass overrides 750 EUR threshold; fallback threshold applies only when assetClass is unset
  assert.equal(resolveAssetClass({ purchasePrice: 1500, assetClass: 'short_term' }), 'short_term');
  assert.equal(resolveAssetClass({ purchasePrice: 200, assetClass: 'long_term' }), 'long_term');
  assert.equal(resolveAssetClass({ purchasePrice: 750 }), 'long_term');
  assert.equal(resolveAssetClass({ purchasePrice: 749.99 }), 'short_term');

  // Floating-point cents accuracy (0.1 + 0.2 === 0.30, 19.99 * 3)
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(formatMoneyFixed(sumMoney([19.99, 19.99, 19.99])), '59.97');

  // Missing residualValue is NOT counted as confirmed 0.00 EUR
  const residualSummary = summarizeResidualValues([
    { residualValue: 100.5 },
    { residualValue: undefined },
    { residualValue: 0 },
  ]);
  assert.equal(residualSummary.knownTotal, 100.5);
  assert.equal(residualSummary.knownCount, 2);
  assert.equal(residualSummary.missingCount, 1);
  assert.equal(residualSummary.allSpecified, false);
  assert.ok(buildResidualSummaryText(residualSummary).includes('Nenurodyta: 1 vnt.'));

  const db = buildFixtureDb();
  const sampleItems: InventoryItem[] = [
    {
      ...db.items[0],
      id: 'i-1',
      status: 'active',
      purchasePrice: 0.1,
      residualValue: undefined,
      assetClass: 'short_term',
    },
    {
      ...db.items[0],
      id: 'i-2',
      status: 'in_repair',
      purchasePrice: 0.2,
      residualValue: 0.1,
      assetClass: 'long_term',
    },
    {
      ...db.items[0],
      id: 'i-3',
      status: 'to_writeoff',
      purchasePrice: 800,
      residualValue: 120,
      assetClass: 'short_term', // explicit override even >= 750 €
    },
    {
      ...db.items[0],
      id: 'i-4',
      status: 'written_off',
      purchasePrice: 5000,
      residualValue: 0,
      assetClass: 'long_term',
    },
  ];

  const dashSummary = computeInventorySummary(sampleItems, db.departments);
  const reportSummary = buildRegistrySheetReportData({
    items: sampleItems,
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    filters: { lifecycleScope: 'non_written_off' },
    organizationSettings: db.organizationSettings,
  });

  assert.equal(dashSummary.nonWrittenOffTotalCount, reportSummary.rows.length);
  assert.equal(dashSummary.nonWrittenOffTotalCount, 3);
  assert.equal(dashSummary.writtenOffTotalCount, 1);
  assert.equal(dashSummary.totalPurchaseValue, reportSummary.totalPurchaseValue);
  assert.equal(dashSummary.totalPurchaseValue, 800.3);
  assert.equal(dashSummary.longTerm.count, 1);
  assert.equal(dashSummary.shortTerm.count, 2);
});

test('Stage 5: Shared CSV escaping handles semicolons, quotes, newlines, Lithuanian chars, and ExportToCSV matches', () => {
  const db = buildFixtureDb();
  const trickyItem: InventoryItem = {
    ...db.items[0],
    id: 'tricky-csv-1',
    inventoryNumber: 'TM-2027-777',
    name: 'Ąžuolinis "Pro" stalas; <special> & test\nantra eilutė',
    condition: 'poor',
    purchasePrice: 123.45,
    residualValue: undefined,
    status: 'active',
  };

  const registryReport = buildRegistrySheetReportData({
    items: [trickyItem],
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    filters: {},
    organizationSettings: db.organizationSettings,
    generatedDate: '2027-04-12',
  });
  const { content } = buildReportCsv(registryReport);
  assert.ok(content.startsWith('\uFEFF'));
  assert.ok(content.includes('\r\n'));
  assert.ok(content.includes('"Ąžuolinis ""Pro"" stalas; <special> & test\nantra eilutė"'));
  assert.ok(content.includes('123,45'));

  const userReport = buildUserSheetReportData({
    targetUser: db.users[0],
    items: [{ ...trickyItem, responsibleUserId: db.users[0].id }],
    rooms: db.rooms,
    organizationSettings: db.organizationSettings,
    generatedDate: '2027-04-12',
  });
  const userCsv = buildReportCsv(userReport);
  assert.ok(userCsv.content.includes(';Prasta;'));

  const fullCsv = StorageService.exportToCSV([trickyItem], db.departments, db.rooms, db.users);
  assert.ok(fullCsv.startsWith('\uFEFF'));
  assert.ok(fullCsv.includes('"Ąžuolinis ""Pro"" stalas; <special> & test\nantra eilutė"'));
  assert.ok(fullCsv.includes(';Prasta;'));
});

test('Stage 5: Real OOXML DOCX export builds valid zipped word/document.xml without HTML wrappers and safely escapes XML chars', async () => {
  const db = buildFixtureDb();
  const specialItem: InventoryItem = {
    ...db.items[0],
    id: 'docx-special-1',
    inventoryNumber: 'TM-DOCX-01',
    name: 'Kompiuteris <Lenovo> & "ThinkPad" ąčęėįšųūž',
    purchasePrice: 999.99,
    status: 'active',
  };

  const session: AuditSession = {
    id: 'audit-docx-1',
    year: 2027,
    title: '2027 m. A4 & DOCX patikra',
    status: 'completed',
    startDate: '2027-05-10',
    completedDate: '2027-05-12',
    committeeChairman: 'Pirmininkė Eglė',
    committeeMembers: ['Narys Jonas <IT>', 'Narė Rasa & Co'],
    orderNumber: 'V-77',
    orderDate: '2027-05-01',
    scannedItemIds: [specialItem.id],
    missingItemIds: [],
    relocatedItemIds: [],
    organizationSnapshot: {
      name: 'Tryškių Gimnazija <Test> & Co',
      code: '190558117',
      address: 'Lazdynų Pelėdos g. 20',
      directorTitle: 'Direktorė',
      directorName: 'Vardė Pavardė',
    },
    snapshotItems: [
      {
        itemId: specialItem.id,
        inventoryNumber: specialItem.inventoryNumber,
        name: specialItem.name,
        category: specialItem.category,
        expectedDepartmentId: specialItem.departmentId,
        expectedDepartmentName: 'Pagrindinis korpusas',
        expectedRoomId: specialItem.roomId,
        expectedRoomName: '101 kab.',
        responsibleUserId: specialItem.responsibleUserId,
        responsibleUserName: 'Atsakingas Mokytojas',
        purchasePrice: specialItem.purchasePrice,
        statusAtStart: 'active',
      },
    ],
    checkRecords: {
      [specialItem.id]: {
        itemId: specialItem.id,
        outcome: 'found',
        method: 'qr',
        checkedAt: '2027-05-10T11:00:00.000Z',
        checkedByUserName: 'Pirmininkė Eglė',
        expectedDepartmentId: specialItem.departmentId,
        expectedRoomId: specialItem.roomId,
        actualDepartmentId: specialItem.departmentId,
        actualRoomId: specialItem.roomId,
        actualRoomName: '101 kab.',
      },
    },
  };

  const auditReport = buildAuditSessionReportData({
    session,
    items: [specialItem],
    departments: db.departments,
    rooms: db.rooms,
    users: db.users,
    generatedDate: '2027-05-12',
  });

  const buffer = await generateReportDocxBuffer(auditReport);
  assert.equal(buffer.subarray(0, 2).toString('utf-8'), 'PK', 'Output must be a valid ZIP container');

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('[Content_Types].xml'));
  const docXmlFile = zip.file('word/document.xml');
  assert.ok(docXmlFile);
  const xml = await docXmlFile.async('string');

  assert.ok(!xml.toLowerCase().includes('<html'));
  assert.ok(xml.includes('ąčęėįšųūž'));
  assert.ok(xml.includes('&lt;Lenovo&gt; &amp;'));
  assert.ok(xml.includes('Pirmininkė Eglė'));
  assert.ok(xml.includes('Rastas vietoje'));
  assert.ok(xml.includes('999.99'));
  assert.ok(!xml.includes('Kęstutis Labanauskas'));
});

test('Stage 5: Calendar YYYY-MM-DD and Europe/Vilnius timestamps avoid off-by-one date/year shifts', () => {
  assert.equal(getCalendarYearFromDate('2026-01-01'), 2026);
  assert.equal(getCalendarYearFromDate('2025-12-31'), 2025);
  assert.equal(getCalendarDatePart('2026-01-01'), '2026-01-01');
  // 2026-03-14T23:30:00Z is 2026-03-15 01:30 in Europe/Vilnius (UTC+2)
  assert.equal(getCalendarDatePart('2026-03-14T23:30:00.000Z'), '2026-03-15');
  assert.equal(formatDateTimeVilnius('2026-03-14T23:30:00.000Z'), '2026-03-15 01:30');
  assert.equal(
    getWriteOffActYear({
      id: 'a-yr',
      actNumber: 'NUR-2026-001',
      date: '2026-01-01',
      status: 'approved',
      committeeChair: 'Pirmininkas',
      committeeMembers: [],
      reasonCategory: 'Gedimas',
      items: [],
    }),
    2026
  );
  assert.ok(calculateCalendarAgeYears('2020-01-01', '2025-01-01') >= 4.99);
});

test('Stage 5: Legacy JSON backup without organizationSettings validates and migrates cleanly without faking defaults', () => {
  const legacyPayload = buildFixtureDb(1) as unknown as Record<string, unknown>;
  delete legacyPayload.organizationSettings;
  legacyPayload.version = '1.0.0';

  const result = validateAndMigrateDatabase(legacyPayload);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.migrated, true);
    assert.equal(result.data.organizationSettings, undefined);
    assert.ok(result.warnings.some((w) => w.includes('organizationSettings')));
  }
});
