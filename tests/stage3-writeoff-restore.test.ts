import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { validateAndMigrateDatabase, AppDatabase, CURRENT_DB_VERSION } from '../src/utils/databaseValidation.ts';
import { applyDbMutation } from '../src/utils/dbOperations.ts';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
import {
  filterWriteOffActsByYear,
  resolveActiveWriteOffAct,
  analyzeWriteOffIntegrity,
} from '../src/utils/writeOffUtils.ts';
import {
  INITIAL_DEPARTMENTS,
  INITIAL_ROOMS,
  INITIAL_USERS,
  INITIAL_ITEMS,
  INITIAL_MOVEMENTS,
  INITIAL_AUDIT_SESSION,
  INITIAL_AUTH_SETTINGS,
} from '../src/data/initialData.ts';
import { InventoryItem, WriteOffAct } from '../src/types/inventory.ts';

function buildCleanFixtureDb(overrides: Partial<AppDatabase> = {}): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
    exportedAt: '2026-04-10T10:00:00.000Z',
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS).map((i) => ({
      ...i,
      status: 'active' as const,
      writtenOffDate: undefined,
      writtenOffYear: undefined,
      writeOffActNumber: undefined,
      writeOffReason: undefined,
      writeOffActId: undefined,
    })),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: [],
    auditSessions: [structuredClone(INITIAL_AUDIT_SESSION)],
    authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
    ...overrides,
  };
}

function makeDraftActShell(id: string, item: { id: string; name: string; inventoryNumber: string; purchasePrice: number }, actNumber = ''): WriteOffAct {
  return {
    id,
    actNumber,
    date: '2026-04-10',
    actYear: 2026,
    status: 'draft',
    committeeChair: 'Pirmininkas',
    committeeMembers: ['Narys 1'],
    reasonCategory: 'Fizinis susidėvėjimas',
    notes: 'Sugedęs',
    items: [
      {
        itemId: item.id,
        name: item.name,
        inventoryNumber: item.inventoryNumber,
        price: item.purchasePrice,
        residualPrice: 0,
        reason: 'Sugedęs',
      },
    ],
  };
}

async function withTempServer(
  initialDb: AppDatabase | null,
  run: (baseUrl: string, tempDir: string) => Promise<void>
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage3-'));
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    if (initialDb) {
      const imp = await fetch(`${baseUrl}/api/database/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: initialDb, source: 'test_seed' }),
      });
      assert.equal(imp.status, 200);
    }
    await run(baseUrl, tempDir);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Rejection cancels single-item act and prevents old act approval while preserving history; multi-item act continues for remaining items', () => {
  const db = buildCleanFixtureDb();
  const itemA = db.items[0];
  const itemB = db.items[1];

  // 1. Single-item submit -> reject -> try approving cancelled old act
  const sub1 = applyDbMutation(db, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemA.id,
    reasonCategory: 'Gedimas',
    notes: 'Neįsijungia',
    act: makeDraftActShell('act-single', itemA),
  });
  assert.equal(sub1.ok, true);
  if (!sub1.ok) return;

  const rej1 = applyDbMutation(sub1.database, {
    type: 'REJECT_WRITEOFF',
    itemId: itemA.id,
    reason: 'Pataisoma pakeitus kabelį',
    rejectedByUserId: db.users[0].id,
    rejectedByUserName: db.users[0].fullName,
  });
  assert.equal(rej1.ok, true);
  if (!rej1.ok) return;

  const rejectedAct = rej1.database.writeOffActs.find((a) => a.id === 'act-single')!;
  assert.equal(rejectedAct.status, 'cancelled');
  assert.equal(rejectedAct.items.length, 0);
  assert.equal(rejectedAct.rejectedItems?.length, 1);
  assert.equal(rejectedAct.rejectedItems?.[0].itemId, itemA.id);
  assert.equal(rejectedAct.rejectedItems?.[0].rejectionReason, 'Pataisoma pakeitus kabelį');

  const updatedItemA = rej1.database.items.find((i) => i.id === itemA.id)!;
  assert.equal(updatedItemA.status, 'active');
  assert.equal(updatedItemA.writeOffActId, undefined);
  assert.equal(updatedItemA.writeOffRejectionHistory?.length, 1);

  const approveCancelled = applyDbMutation(rej1.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-single',
    approvalYear: 2026,
    approvedDate: '2026-04-12',
  });
  assert.equal(approveCancelled.ok, false);

  // 2. Multi-item draft act: reject itemA, keep itemB, then approve remaining act -> only itemB written off!
  const subMultiA = applyDbMutation(rej1.database, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemA.id,
    reasonCategory: 'Gedimas',
    notes: 'Pakartotinis bandymas',
    act: makeDraftActShell('act-multi', itemA),
  });
  assert.equal(subMultiA.ok, true);
  if (!subMultiA.ok) return;

  const subMultiB = applyDbMutation(subMultiA.database, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemB.id,
    reasonCategory: 'Susidėvėjimas',
    notes: 'Sulūžęs korpusas',
    act: makeDraftActShell('act-multi', itemB),
    targetActId: 'act-multi',
  });
  assert.equal(subMultiB.ok, true);
  if (!subMultiB.ok) return;

  // Negalima to paties daikto pateikti į antrą aktyvų projektą
  const dupSubmit = applyDbMutation(subMultiB.database, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemA.id,
    reasonCategory: 'Gedimas',
    notes: 'Kitas aktas',
    act: makeDraftActShell('act-other', itemA),
  });
  assert.equal(dupSubmit.ok, false);
  if (!dupSubmit.ok) assert.equal(dupSubmit.statusCode, 409);

  // Reject itemA from act-multi
  const rejMultiA = applyDbMutation(subMultiB.database, {
    type: 'REJECT_WRITEOFF',
    itemId: itemA.id,
    reason: 'Dar tinkamas',
    rejectedByUserId: db.users[0].id,
    rejectedByUserName: db.users[0].fullName,
  });
  assert.equal(rejMultiA.ok, true);
  if (!rejMultiA.ok) return;

  const actAfterPartialRej = rejMultiA.database.writeOffActs.find((a) => a.id === 'act-multi')!;
  assert.equal(actAfterPartialRej.status, 'draft');
  assert.equal(actAfterPartialRej.items.length, 1);
  assert.equal(actAfterPartialRej.items[0].itemId, itemB.id);
  assert.equal(actAfterPartialRej.rejectedItems?.length, 1);

  const appMulti = applyDbMutation(rejMultiA.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-multi',
    approvalYear: 2026,
    approvedDate: '2026-04-15',
    approvedByUserId: db.users[0].id,
    approvedByUserName: db.users[0].fullName,
  });
  assert.equal(appMulti.ok, true, appMulti.ok ? '' : appMulti.error);
  if (!appMulti.ok) return;

  assert.equal(appMulti.database.items.find((i) => i.id === itemA.id)?.status, 'active');
  assert.equal(appMulti.database.items.find((i) => i.id === itemB.id)?.status, 'written_off');
  assert.equal(appMulti.database.items.find((i) => i.id === itemB.id)?.writeOffActId, 'act-multi');
});

test('Multi-item act approval blocks partial item-only approval and rolls back completely if any item fails validation; prevents re-approval', () => {
  const db = buildCleanFixtureDb();
  const itemA = db.items[0];
  const itemB = db.items[1];

  const sub1 = applyDbMutation(db, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemA.id,
    reasonCategory: 'Susidėvėjimas',
    notes: 'Defektas A',
    act: makeDraftActShell('act-2items', itemA),
  });
  assert.equal(sub1.ok, true);
  if (!sub1.ok) return;

  const sub2 = applyDbMutation(sub1.database, {
    type: 'CONFIRM_WRITEOFF',
    itemId: itemB.id,
    reasonCategory: 'Susidėvėjimas',
    notes: 'Defektas B',
    act: makeDraftActShell('act-2items', itemB),
    targetActId: 'act-2items',
  });
  assert.equal(sub2.ok, true);
  if (!sub2.ok) return;

  // Partial approval via APPROVE_ITEM_WRITEOFF is forbidden on multi-item act
  const partialApprove = applyDbMutation(sub2.database, {
    type: 'APPROVE_ITEM_WRITEOFF',
    itemId: itemA.id,
    approvalYear: 2026,
    actNumber: '',
    approvedDate: '2026-04-15',
  });
  assert.equal(partialApprove.ok, false);

  // Corrupt itemB status inside a cloned db -> approving act-2items must fail with ZERO partial writes to itemA or act
  const corrupted = structuredClone(sub2.database);
  corrupted.items = corrupted.items.map((i) =>
    i.id === itemB.id ? { ...i, status: 'active' as const } : i
  );
  const failedWhole = applyDbMutation(corrupted, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-2items',
    approvalYear: 2026,
    approvedDate: '2026-04-15',
  });
  assert.equal(failedWhole.ok, false);
  // Original corrupted state remains untouched (no partial commit returned)
  assert.equal(corrupted.writeOffActs.find((a) => a.id === 'act-2items')?.status, 'draft');
  assert.equal(corrupted.items.find((i) => i.id === itemA.id)?.status, 'to_writeoff');

  // Whole-act valid approval updates BOTH items atomically and matches all act fields
  const wholeOk = applyDbMutation(sub2.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-2items',
    approvalYear: 2025,
    approvedDate: '2025-12-20',
    approvedByUserId: db.users[0].id,
    approvedByUserName: db.users[0].fullName,
  });
  assert.equal(wholeOk.ok, true, wholeOk.ok ? '' : wholeOk.error);
  if (!wholeOk.ok) return;

  const approvedAct = wholeOk.database.writeOffActs.find((a) => a.id === 'act-2items')!;
  assert.equal(approvedAct.status, 'approved');
  assert.equal(approvedAct.actYear, 2025);

  for (const targetId of [itemA.id, itemB.id]) {
    const savedItem: InventoryItem | undefined = wholeOk.database.items.find((x) => x.id === targetId);
    assert.ok(savedItem);
    assert.equal(savedItem.status, 'written_off');
    assert.equal(savedItem.writeOffActId, approvedAct.id);
    assert.equal(savedItem.writeOffActNumber, approvedAct.actNumber);
    assert.equal(savedItem.writtenOffDate, '2025-12-20');
    assert.equal(savedItem.writtenOffYear, 2025);
    assert.equal(savedItem.writeOffReason, approvedAct.reasonCategory);
  }

  // Re-approving an already approved act is blocked
  const reApprove = applyDbMutation(wholeOk.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-2items',
    approvalYear: 2026,
    approvedDate: '2026-04-16',
  });
  assert.equal(reApprove.ok, false);
});

test('Restore from archive requires explicit condition & reason, keeps historical act untouched, records cancellation history, and allows clean subsequent write-off', () => {
  const db = buildCleanFixtureDb();
  const item = db.items[0];

  const sub1 = applyDbMutation(db, {
    type: 'CONFIRM_WRITEOFF',
    itemId: item.id,
    reasonCategory: 'Techninis gedimas',
    notes: 'Neveikia maitinimas',
    act: makeDraftActShell('act-hist-1', item),
  });
  assert.equal(sub1.ok, true);
  if (!sub1.ok) return;

  const app1 = applyDbMutation(sub1.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-hist-1',
    approvalYear: 2025,
    approvedDate: '2025-11-10',
  });
  assert.equal(app1.ok, true);
  if (!app1.ok) return;

  const act1Number = app1.database.writeOffActs.find((a) => a.id === 'act-hist-1')!.actNumber;

  // Missing condition or missing reason must fail (no silent auto-'good')
  assert.equal(
    applyDbMutation(app1.database, {
      type: 'RESTORE_FROM_ARCHIVE',
      itemId: item.id,
      reason: 'Pataisytas',
    }).ok,
    false
  );
  assert.equal(
    applyDbMutation(app1.database, {
      type: 'RESTORE_FROM_ARCHIVE',
      itemId: item.id,
      condition: 'fair',
      reason: '   ',
    }).ok,
    false
  );

  // Explicit restoration
  const restored = applyDbMutation(app1.database, {
    type: 'RESTORE_FROM_ARCHIVE',
    itemId: item.id,
    condition: 'fair',
    reason: 'Pakeistas maitinimo blokas, veikia stabiliai',
    restoredByUserId: db.users[0].id,
    restoredByUserName: db.users[0].fullName,
    restoredAt: '2026-02-01T10:30:00.000Z',
  });
  assert.equal(restored.ok, true, restored.ok ? '' : restored.error);
  if (!restored.ok) return;

  // Historical approved act remains intact!
  const histAct1 = restored.database.writeOffActs.find((a) => a.id === 'act-hist-1')!;
  assert.equal(histAct1.status, 'approved');
  assert.equal(histAct1.items.length, 1);

  const restoredItem = restored.database.items.find((i) => i.id === item.id)!;
  assert.equal(restoredItem.status, 'active');
  assert.equal(restoredItem.condition, 'fair');
  assert.equal(restoredItem.writeOffActId, undefined);
  assert.equal(restoredItem.writeOffActNumber, undefined);
  assert.equal(restoredItem.writeOffHistory?.length, 1);
  assert.equal(restoredItem.writeOffHistory?.[0].actId, 'act-hist-1');
  assert.equal(restoredItem.writeOffHistory?.[0].actNumber, act1Number);
  assert.equal(restoredItem.writeOffHistory?.[0].restoredByUserName, db.users[0].fullName);
  assert.equal(restoredItem.writeOffHistory?.[0].conditionOnRestore, 'fair');

  // Re-submitting restored item later for a brand-new write-off act succeeds without confusing Act #1 and Act #2
  const sub2 = applyDbMutation(restored.database, {
    type: 'CONFIRM_WRITEOFF',
    itemId: item.id,
    reasonCategory: 'Visiškas susidėvėjimas',
    notes: 'Galutinai sugedo motininė plokštė',
    act: makeDraftActShell('act-hist-2', restoredItem),
  });
  assert.equal(sub2.ok, true, sub2.ok ? '' : sub2.error);
  if (!sub2.ok) return;

  const app2 = applyDbMutation(sub2.database, {
    type: 'APPROVE_WRITEOFF_ACT',
    actId: 'act-hist-2',
    approvalYear: 2026,
    approvedDate: '2026-04-18',
  });
  assert.equal(app2.ok, true, app2.ok ? '' : app2.error);
  if (!app2.ok) return;

  const finalItem = app2.database.items.find((i) => i.id === item.id)!;
  const act2 = app2.database.writeOffActs.find((a) => a.id === 'act-hist-2')!;
  assert.notEqual(act2.actNumber, act1Number);
  assert.equal(finalItem.status, 'written_off');
  assert.equal(finalItem.writeOffActId, 'act-hist-2');
  assert.equal(finalItem.writeOffActNumber, act2.actNumber);
  // Prior cancellation history is still preserved cleanly!
  assert.equal(finalItem.writeOffHistory?.length, 1);
  assert.equal(finalItem.writeOffHistory?.[0].actId, 'act-hist-1');
});

test('ReportsView year filter helpers always resolve active act inside filtered list or return null when empty', () => {
  const acts: WriteOffAct[] = [
    { ...makeDraftActShell('act-2026', INITIAL_ITEMS[0], 'NUR-2026-001'), actYear: 2026, date: '2026-03-01' },
    { ...makeDraftActShell('act-2024', INITIAL_ITEMS[1], 'NUR-2024-001'), actYear: 2024, date: '2024-11-10' },
  ];

  // Filter to 2024 while previously selected act was 'act-2026' -> switches to 'act-2024'
  const filtered2024 = filterWriteOffActsByYear(acts, 2024);
  assert.equal(filtered2024.length, 1);
  const resolved2024 = resolveActiveWriteOffAct(filtered2024, 'act-2026');
  assert.equal(resolved2024?.id, 'act-2024');

  // Filter to 2021 (empty) -> resolves strictly to null, NEVER leaks 'act-2026'
  const filtered2021 = filterWriteOffActsByYear(acts, 2021);
  assert.equal(filtered2021.length, 0);
  const resolved2021 = resolveActiveWriteOffAct(filtered2021, 'act-2026');
  assert.equal(resolved2021, null);
});

test('Server enforces unique sequential act numbers under concurrency and blocks concurrent double-approval', async () => {
  const db = buildCleanFixtureDb();
  await withTempServer(db, async (baseUrl) => {
    const itemA = db.items[0];
    const itemB = db.items[1];

    // Concurrent CONFIRM_WRITEOFF for 2 different items at same baseRevision=1 -> both succeed with unique NUR-2026-001 & NUR-2026-002!
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 1,
          clientOpId: 'concurrent-sub-a',
          operation: {
            type: 'CONFIRM_WRITEOFF',
            itemId: itemA.id,
            reasonCategory: 'Gedimas',
            notes: 'A sugedo',
            act: makeDraftActShell('act-conc-a', itemA, ''),
          },
        }),
      }),
      fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 1,
          clientOpId: 'concurrent-sub-b',
          operation: {
            type: 'CONFIRM_WRITEOFF',
            itemId: itemB.id,
            reasonCategory: 'Gedimas',
            notes: 'B sugedo',
            act: makeDraftActShell('act-conc-b', itemB, ''),
          },
        }),
      }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const dbAfterSubRes = await fetch(`${baseUrl}/api/database`);
    const latestRev = Number(dbAfterSubRes.headers.get('x-db-revision'));
    const latestDb = (await dbAfterSubRes.json()) as AppDatabase;
    const actA = latestDb.writeOffActs.find((a) => a.id === 'act-conc-a')!;
    const actB = latestDb.writeOffActs.find((a) => a.id === 'act-conc-b')!;
    assert.notEqual(actA.actNumber, actB.actNumber);
    assert.deepEqual(
      [actA.actNumber, actB.actNumber].sort(),
      ['NUR-2026-001', 'NUR-2026-002']
    );

    // Duplicate custom act number check via API
    const dupActNumRes = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: latestRev,
        clientOpId: 'dup-act-num',
        operation: {
          type: 'APPROVE_WRITEOFF_ACT',
          actId: 'act-conc-a',
          approvalYear: 2026,
          approvedDate: '2026-04-20',
          actNumber: actB.actNumber,
        },
      }),
    });
    assert.equal(dupActNumRes.status, 409);

    // Concurrent approval attempts on act-conc-a -> exactly one succeeds (200), the second fails (409 or 400)!
    const [appTry1, appTry2] = await Promise.all([
      fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: latestRev,
          clientOpId: 'conc-app-1',
          operation: {
            type: 'APPROVE_WRITEOFF_ACT',
            actId: 'act-conc-a',
            approvalYear: 2026,
            approvedDate: '2026-04-20',
          },
        }),
      }),
      fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: latestRev,
          clientOpId: 'conc-app-2',
          operation: {
            type: 'APPROVE_WRITEOFF_ACT',
            actId: 'act-conc-a',
            approvalYear: 2026,
            approvedDate: '2026-04-20',
          },
        }),
      }),
    ]);

    const statuses = [appTry1.status, appTry2.status].sort((a, b) => a - b);
    assert.equal(statuses[0], 200);
    assert.ok(statuses[1] === 409 || statuses[1] === 400);
  });
});

test('Legacy JSON backup with write-off mismatches warns without inventing historical facts and reconciles safely', async () => {
  const legacyDb = buildCleanFixtureDb();
  const orphanPending = legacyDb.items[0];
  const missingLinkItem = legacyDb.items[1];
  const unlinkedArchiveItem = legacyDb.items[2];

  // Legacy data issues:
  // 1) orphan to_writeoff with no draft act
  orphanPending.status = 'to_writeoff';
  // 2) written_off item referencing existing approved act by actNumber, but missing writeOffActId
  missingLinkItem.status = 'written_off';
  missingLinkItem.writeOffActNumber = 'NUR-2023-05';
  missingLinkItem.writtenOffYear = 2023;
  missingLinkItem.writtenOffDate = '2023-10-12';
  missingLinkItem.writeOffActId = undefined;
  // 3) written_off item with no matching act at all
  unlinkedArchiveItem.status = 'written_off';
  unlinkedArchiveItem.writeOffActNumber = 'NUR-2019-99';
  unlinkedArchiveItem.writtenOffYear = 2019;
  unlinkedArchiveItem.writeOffActId = undefined;

  legacyDb.writeOffActs = [
    {
      id: 'legacy-act-2023-5',
      actNumber: 'NUR-2023-05',
      date: '2023-10-12',
      actYear: 2023,
      approvedDate: '2023-10-12',
      status: 'approved',
      committeeChair: 'Pirmininkas',
      committeeMembers: ['Narys'],
      reasonCategory: 'Susidėvėjimas',
      notes: 'Senas aktas',
      items: [
        {
          itemId: missingLinkItem.id,
          name: missingLinkItem.name,
          inventoryNumber: missingLinkItem.inventoryNumber,
          price: missingLinkItem.purchasePrice,
          residualPrice: 0,
          reason: 'Susidėvėjimas',
        },
      ],
    },
  ];

  // 1. Validate migration preserves exact records and emits explicit warnings (no invented acts!)
  const valRes = validateAndMigrateDatabase({ ...legacyDb, version: '1.0.0' });
  assert.equal(valRes.ok, true);
  if (!valRes.ok) return;
  assert.ok(valRes.warnings.length >= 3);
  assert.equal(valRes.data.writeOffActs.length, 1);

  // 2. Import onto server with existing DB saves backup & returns warnings
  const seedDb = buildCleanFixtureDb();
  await withTempServer(seedDb, async (baseUrl, tempDir) => {
    const importRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 1,
        database: { ...legacyDb, version: '1.0.0' },
        source: 'legacy_backup_test',
      }),
    });
    assert.equal(importRes.status, 200);
    const body = (await importRes.json()) as any;
    assert.ok(body.backupFile, 'Migration import must save backup of previous DB');
    assert.ok(fs.existsSync(path.join(tempDir, 'backups', body.backupFile)));
    assert.ok(Array.isArray(body.warnings) && body.warnings.length >= 3);

    // 3. Reconcile known safe issues cleanly
    const issues = analyzeWriteOffIntegrity(body.database.items, body.database.writeOffActs);
    assert.ok(issues.some((i) => i.kind === 'orphan_to_writeoff'));
    assert.ok(issues.some((i) => i.kind === 'written_off_missing_act_link'));
    assert.ok(issues.some((i) => i.kind === 'written_off_without_act'));

    const rec1 = applyDbMutation(body.database, {
      type: 'RECONCILE_WRITEOFF_ISSUE',
      action: 'return_to_active',
      itemId: orphanPending.id,
    });
    assert.equal(rec1.ok, true);
    if (!rec1.ok) return;
    assert.equal(rec1.database.items.find((i) => i.id === orphanPending.id)?.status, 'active');

    const rec2 = applyDbMutation(rec1.database, {
      type: 'RECONCILE_WRITEOFF_ISSUE',
      action: 'link_by_existing_act_number',
      itemId: missingLinkItem.id,
      actId: 'legacy-act-2023-5',
    });
    assert.equal(rec2.ok, true);
    if (!rec2.ok) return;
    assert.equal(
      rec2.database.items.find((i) => i.id === missingLinkItem.id)?.writeOffActId,
      'legacy-act-2023-5'
    );
  });
});
