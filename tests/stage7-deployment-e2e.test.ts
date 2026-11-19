import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { createDatabaseApiRouter } from '../src/server/databaseApi.ts';
import { AppDatabase, CURRENT_DB_VERSION } from '../src/utils/databaseValidation.ts';
import { StorageService } from '../src/utils/storage.ts';
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
import { DEFAULT_ORGANIZATION_SETTINGS, resolveOrganizationForDocument } from '../src/utils/organization.ts';
import {
  buildAuditSessionReportData,
  buildRegistrySheetReportData,
  buildWriteOffActReportData,
} from '../src/utils/reportUtils.ts';
import { buildCsvContent } from '../src/utils/csvUtils.ts';
import { buildLabelsDocxDocument, generateReportDocxBuffer } from '../src/utils/docxExport.ts';
import { buildItemQrPayload, resolveScannedInventoryItem } from '../src/utils/qrUtils.ts';
import { analyzeUsersCsvImport, buildFinalBatchUsersFromPreview } from '../src/utils/userCsvImport.ts';
import { InventoryItem } from '../src/types/inventory.ts';

const execFileAsync = promisify(execFile);

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr !== 'object') {
        srv.close(() => reject(new Error('Failed to get free port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServerHealth(baseUrl: string, timeoutMs = 15000): Promise<Response> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`Server did not respond at ${baseUrl}/api/health: ${String(lastError)}`);
}

async function spawnProdServer(dataDir: string, port: number) {
  const tsxBin = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    logs += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServerHealth(baseUrl);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`Subprocess server startup failed: ${String(err)}\nLogs:\n${logs}`);
  }

  return {
    baseUrl,
    getLogs: () => logs,
    stop: async () => {
      if (child.exitCode !== null || child.killed) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 4000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    },
  };
}

function buildFixtureDb(overrides: Partial<AppDatabase> = {}): AppDatabase {
  return {
    version: CURRENT_DB_VERSION,
    revision: 1,
    exportedAt: '2026-05-10T10:00:00.000Z',
    departments: structuredClone(INITIAL_DEPARTMENTS),
    rooms: structuredClone(INITIAL_ROOMS),
    users: structuredClone(INITIAL_USERS),
    items: structuredClone(INITIAL_ITEMS),
    movements: structuredClone(INITIAL_MOVEMENTS),
    writeOffActs: structuredClone(INITIAL_WRITEOFF_ACTS),
    auditSessions: [structuredClone(INITIAL_AUDIT_SESSION)],
    authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
    organizationSettings: structuredClone(DEFAULT_ORGANIZATION_SETTINGS),
    ...overrides,
  };
}

function installBrowserMocks(
  fetchImpl: typeof fetch,
  storageOpts: { throwOnKeys?: string[]; quotaError?: boolean } = {}
) {
  const prevFetch = globalThis.fetch;
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const map = new Map<string, string>();
  const throwKeys = new Set(storageOpts.throwOnKeys ?? []);

  const mockStorage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(i: number) {
      return Array.from(map.keys())[i] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      if (throwKeys.has(key) || throwKeys.has('*')) {
        const err = new Error(storageOpts.quotaError ? 'QuotaExceededError' : 'Storage write error');
        if (storageOpts.quotaError) err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  globalThis.fetch = fetchImpl;

  return {
    storageMap: map,
    restore: () => {
      globalThis.fetch = prevFetch;
      if (prevDesc) {
        Object.defineProperty(globalThis, 'localStorage', prevDesc);
      } else {
        // @ts-expect-error cleanup test property
        delete globalThis.localStorage;
      }
      StorageService.resetForTests();
    },
  };
}

async function withExpressRouterServer(run: (baseUrl: string, dataDir: string) => Promise<void>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage7-srv-'));
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(createDatabaseApiRouter({ dataDir: tempDir }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await run(baseUrl, tempDir);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Stage 7.1: Production server.ts boots in empty dir, rejects unknown /api/* with JSON 404, serves SPA HTML, and persists DB + photos across restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage7-prod-'));
  const port1 = await getFreePort();
  let proc = await spawnProdServer(dataDir, port1);

  try {
    // 1. Empty start: /api/health -> initialized:false, dbExists:false, /api/database -> null (never auto-seeds demo data)
    const healthEmptyRes = await fetch(`${proc.baseUrl}/api/health`);
    assert.equal(healthEmptyRes.status, 200);
    const healthEmpty = (await healthEmptyRes.json()) as any;
    assert.equal(healthEmpty.status, 'ok');
    assert.equal(healthEmpty.initialized, false);
    assert.equal(healthEmpty.dbExists, false);
    assert.equal(healthEmpty.singleProcessMode, true);

    const dbEmptyRes = await fetch(`${proc.baseUrl}/api/database`);
    assert.equal(dbEmptyRes.status, 200);
    assert.equal(await dbEmptyRes.json(), null);

    // 2. Unknown API route must return JSON 404 (not SPA HTML)
    const unknownApiRes = await fetch(`${proc.baseUrl}/api/does-not-exist`);
    assert.equal(unknownApiRes.status, 404);
    assert.match(unknownApiRes.headers.get('content-type') || '', /application\/json/i);
    const unknownJson = (await unknownApiRes.json()) as any;
    assert.equal(unknownJson.success, false);

    // 3. Root HTML route serves built dist/index.html
    const rootRes = await fetch(`${proc.baseUrl}/`);
    assert.equal(rootRes.status, 200);
    assert.match(rootRes.headers.get('content-type') || '', /text\/html/i);
    const htmlBody = await rootRes.text();
    assert.match(htmlBody, /<!doctype html>|<div id="root"/i);

    // 4. Import DB, upload photo, mutate item with photoUrl
    const uploadRes = await fetch(`${proc.baseUrl}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
    });
    assert.equal(uploadRes.status, 200);
    const uploadJson = (await uploadRes.json()) as { success: boolean; url: string };
    assert.equal(uploadJson.success, true);
    assert.match(uploadJson.url, /^\/api\/photos\/photo_.*\.png$/);

    const fixture = buildFixtureDb();
    const importRes = await fetch(`${proc.baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: fixture, source: 'backup_import' }),
    });
    assert.equal(importRes.status, 200);
    const imported = (await importRes.json()) as any;
    assert.equal(imported.success, true);

    const baseRev = imported.revision;
    const itemToUpdate: InventoryItem = {
      ...fixture.items[0],
      name: 'Atsparus restartui nešiojamas kompiuteris',
      photoUrl: uploadJson.url,
    };
    const mutRes = await fetch(`${proc.baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: baseRev,
        clientOpId: 'stage7-op-restart-save',
        operation: { type: 'SAVE_ITEM', item: itemToUpdate },
      }),
    });
    assert.equal(mutRes.status, 200);
    const mutJson = (await mutRes.json()) as any;
    assert.equal(mutJson.success, true);
    const revAfterMut = mutJson.revision;

    // 5. Stop & restart server pointing to the same DATA_DIR
    await proc.stop();
    const port2 = await getFreePort();
    proc = await spawnProdServer(dataDir, port2);

    const healthAfterRes = await fetch(`${proc.baseUrl}/api/health`);
    assert.equal(healthAfterRes.status, 200);
    const healthAfter = (await healthAfterRes.json()) as any;
    assert.equal(healthAfter.initialized, true);
    assert.equal(healthAfter.dbExists, true);
    assert.equal(healthAfter.revision, revAfterMut);
    assert.equal(healthAfter.photoCount, 1);

    const dbAfterRes = await fetch(`${proc.baseUrl}/api/database`);
    assert.equal(dbAfterRes.status, 200);
    const dbAfter = (await dbAfterRes.json()) as AppDatabase;
    assert.equal(dbAfter.items[0].name, 'Atsparus restartui nešiojamas kompiuteris');
    assert.equal(dbAfter.items[0].photoUrl, uploadJson.url);

    const photoRes = await fetch(`${proc.baseUrl}${uploadJson.url}`);
    assert.equal(photoRes.status, 200);
    const photoBuf = Buffer.from(await photoRes.arrayBuffer());
    assert.deepEqual(photoBuf, TINY_PNG_BYTES);
  } finally {
    await proc.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Stage 7.2: Corrupted JSON and newer unknown schema version return HTTP 503 on /api/health and are never silently overwritten', async () => {
  await withExpressRouterServer(async (baseUrl, dataDir) => {
    const dbPath = path.join(dataDir, 'school_database.json');

    // A: Corrupted JSON
    fs.writeFileSync(dbPath, '{ "version": "1.1.0", CORRUPTED_JSON', 'utf-8');
    const healthCorrupt = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthCorrupt.status, 503);
    const hcJson = (await healthCorrupt.json()) as any;
    assert.equal(hcJson.status, 'error');

    const dbCorrupt = await fetch(`${baseUrl}/api/database`);
    assert.equal(dbCorrupt.status, 500);

    // B: Newer unsupported schema version (rollback protection)
    const newerRaw = JSON.stringify({ ...buildFixtureDb(), version: '9.9.0' }, null, 2);
    fs.writeFileSync(dbPath, newerRaw, 'utf-8');

    const healthNewer = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthNewer.status, 503);
    const hnJson = (await healthNewer.json()) as any;
    assert.equal(hnJson.status, 'error');
    assert.equal(hnJson.schemaVersion, '9.9.0');
    assert.match(hnJson.error, /Nepalaikoma duomenų bazės versija/i);

    const mutNewer = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 1,
        clientOpId: 'should-fail-newer-schema',
        operation: { type: 'UPDATE_ORGANIZATION_SETTINGS', settings: DEFAULT_ORGANIZATION_SETTINGS },
      }),
    });
    assert.equal(mutNewer.status, 500);

    // Original newer schema file must remain intact on disk
    assert.equal(fs.readFileSync(dbPath, 'utf-8'), newerRaw);
  });
});

test('Stage 7.3: Isolated backup/restore scripts & API preserve all data + photos byte-for-byte and reject invalid backups without data loss', async () => {
  const rootWork = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage7-bkp-'));
  const dataDirA = path.join(rootWork, 'serverA_data');
  const dataDirB = path.join(rootWork, 'serverB_data');
  const dataDirC = path.join(rootWork, 'serverC_data');
  const backupOutDir = path.join(rootWork, 'backups_out');
  fs.mkdirSync(dataDirA, { recursive: true });
  fs.mkdirSync(dataDirB, { recursive: true });
  fs.mkdirSync(dataDirC, { recursive: true });
  fs.mkdirSync(backupOutDir, { recursive: true });

  const portA = await getFreePort();
  const procA = await spawnProdServer(dataDirA, portA);

  try {
    // Seed server A with photo + DB
    const uploadRes = await fetch(`${procA.baseUrl}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
    });
    const { url: photoUrl } = (await uploadRes.json()) as { url: string };
    const seedDb = buildFixtureDb({
      organizationSettings: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        name: 'Telšių r. Tryškių Lazdynų Pelėdos gimnazija (Patikrinta)',
      },
      items: INITIAL_ITEMS.map((it, idx) =>
        idx === 0 ? { ...it, photoUrl, notes: 'Patikros nuotrauka ir pastaba' } : it
      ),
    });

    const impRes = await fetch(`${procA.baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: seedDb, source: 'initial_seed' }),
    });
    assert.equal(impRes.status, 200);

    // 1. Run scripts/backup-data.sh in isolated dirs against running Server A
    const { stdout: bkpOut } = await execFileAsync(
      'bash',
      ['scripts/backup-data.sh', dataDirA, backupOutDir, procA.baseUrl],
      { cwd: process.cwd() }
    );
    assert.match(bkpOut, /Sukurta nešiojama JSON kopija su nuotraukomis/);
    assert.match(bkpOut, /Sukurtas pilnas duomenų archyvas/);

    const files = fs.readdirSync(backupOutDir);
    const portableJsonFile = files.find((f) => f.endsWith('.json'));
    const fullTarGzFile = files.find((f) => f.endsWith('.tar.gz'));
    assert.ok(portableJsonFile, 'Portable JSON backup should be created');
    assert.ok(fullTarGzFile, 'Full tar.gz archive should be created');

    const portablePath = path.join(backupOutDir, portableJsonFile!);
    const tarGzPath = path.join(backupOutDir, fullTarGzFile!);

    // 2. Portable JSON restores cleanly into blank Server B via API
    const portB = await getFreePort();
    const procB = await spawnProdServer(dataDirB, portB);
    try {
      const jsonText = fs.readFileSync(portablePath, 'utf-8');
      const importBRes = await fetch(`${procB.baseUrl}/api/database/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonContent: jsonText, source: 'backup_import' }),
      });
      assert.equal(importBRes.status, 200);
      const importBJson = (await importBRes.json()) as any;
      assert.equal(importBJson.success, true);

      // Compare DB & photo bytes on Server B
      const dbB = (await (await fetch(`${procB.baseUrl}/api/database`)).json()) as AppDatabase;
      assert.equal(dbB.items.length, seedDb.items.length);
      assert.equal(dbB.rooms.length, seedDb.rooms.length);
      assert.equal(dbB.users.length, seedDb.users.length);
      assert.equal(dbB.writeOffActs.length, seedDb.writeOffActs.length);
      assert.equal(dbB.auditSessions.length, seedDb.auditSessions.length);
      assert.equal(dbB.organizationSettings?.name, seedDb.organizationSettings?.name);

      const photoBRes = await fetch(`${procB.baseUrl}${photoUrl}`);
      assert.equal(photoBRes.status, 200);
      assert.deepEqual(Buffer.from(await photoBRes.arrayBuffer()), TINY_PNG_BYTES);

      // Invalid restore payload rejected (400) leaving Server B untouched
      const badRestoreRes = await fetch(`${procB.baseUrl}/api/database/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonContent: '{broken json', source: 'backup_import' }),
      });
      assert.equal(badRestoreRes.status, 400);
      const dbBAfterBad = (await (await fetch(`${procB.baseUrl}/api/database`)).json()) as AppDatabase;
      assert.equal(dbBAfterBad.items[0].notes, 'Patikros nuotrauka ir pastaba');
    } finally {
      await procB.stop();
    }

    // 3. Seed old file in dataDirC, test invalid CLI restore rejection, then real .tar.gz CLI restore
    fs.writeFileSync(
      path.join(dataDirC, 'school_database.json'),
      JSON.stringify(buildFixtureDb({ revision: 99 })),
      'utf-8'
    );
    const badFile = path.join(rootWork, 'invalid_backup.json');
    fs.writeFileSync(badFile, '{"bad":true}', 'utf-8');

    await assert.rejects(
      () => execFileAsync('bash', ['scripts/restore-data.sh', badFile, dataDirC], { cwd: process.cwd() }),
      /Importas atmestas|Nepavyko|KLAIDA/i
    );
    // Original revision 99 must remain intact
    const intactC = JSON.parse(fs.readFileSync(path.join(dataDirC, 'school_database.json'), 'utf-8'));
    assert.equal(intactC.revision, 99);

    // Valid tar.gz CLI restore creates safety snapshot & restores DB + photos
    const { stdout: rstOut } = await execFileAsync(
      'bash',
      ['scripts/restore-data.sh', tarGzPath, dataDirC],
      { cwd: process.cwd() }
    );
    assert.match(rstOut, /Atkūrimas sėkmingai baigtas/);

    const safetyBackups = fs
      .readdirSync(path.join(dataDirC, 'backups'))
      .filter((f) => f.startsWith('pre_restore_') && f.endsWith('.tar.gz'));
    assert.equal(safetyBackups.length, 1);

    const restoredC = JSON.parse(fs.readFileSync(path.join(dataDirC, 'school_database.json'), 'utf-8'));
    assert.equal(restoredC.items[0].photoUrl, photoUrl);
    const restoredPhotoPath = path.join(dataDirC, 'photos', path.basename(photoUrl));
    assert.equal(fs.existsSync(restoredPhotoPath), true);
    assert.deepEqual(fs.readFileSync(restoredPhotoPath), TINY_PNG_BYTES);
  } finally {
    await procA.stop();
    fs.rmSync(rootWork, { recursive: true, force: true });
  }
});

test('Stage 7.4: Legacy JSON backup without organizationSettings stays unconfirmed, blocks official DOCX export, and preserves old snapshots', async () => {
  await withExpressRouterServer(async (baseUrl) => {
    const legacyRaw = {
      version: '1.0.0',
      exportedAt: '2025-12-01T08:00:00.000Z',
      departments: structuredClone(INITIAL_DEPARTMENTS),
      rooms: structuredClone(INITIAL_ROOMS),
      users: structuredClone(INITIAL_USERS),
      items: structuredClone(INITIAL_ITEMS),
      movements: structuredClone(INITIAL_MOVEMENTS),
      writeOffActs: structuredClone(INITIAL_WRITEOFF_ACTS),
      auditSessions: [
        {
          ...structuredClone(INITIAL_AUDIT_SESSION),
          status: 'completed' as const,
          completedAt: '2025-12-10T12:00:00.000Z',
        },
      ],
      authSettings: structuredClone(INITIAL_AUTH_SETTINGS),
    };

    const importRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: legacyRaw, source: 'backup_import' }),
    });
    assert.equal(importRes.status, 200);
    const impJson = (await importRes.json()) as {
      success: boolean;
      revision: number;
      database: AppDatabase;
      warnings: string[];
    };
    assert.equal(impJson.success, true);
    assert.equal(impJson.database.organizationSettings, undefined);
    assert.ok(
      impJson.warnings.some((w) => /įstaigos rekvizit/i.test(w)),
      'Expected warning for unconfirmed organizationSettings'
    );

    const orgResolved = resolveOrganizationForDocument(
      undefined,
      impJson.database.organizationSettings,
      false
    );
    assert.equal(orgResolved.hasConfirmedOrganization, false);

    // Report, write-off act report, and labels refuse DOCX until confirmed
    const registryReport = buildRegistrySheetReportData({
      items: impJson.database.items,
      rooms: impJson.database.rooms,
      departments: impJson.database.departments,
      users: impJson.database.users,
      filters: {},
      organizationSettings: impJson.database.organizationSettings,
    });
    assert.equal(registryReport.hasConfirmedOrganization, false);

    if (impJson.database.writeOffActs.length > 0) {
      const actReport = buildWriteOffActReportData({
        act: impJson.database.writeOffActs[0],
        items: impJson.database.items,
        organizationSettings: impJson.database.organizationSettings,
      });
      assert.equal(
        actReport.hasConfirmedOrganization,
        Boolean(impJson.database.writeOffActs[0].organizationSnapshot)
      );
    }

    const sessionReport = buildAuditSessionReportData({
      session: impJson.database.auditSessions[0],
      items: impJson.database.items,
      rooms: impJson.database.rooms,
      departments: impJson.database.departments,
      users: impJson.database.users,
      organizationSettings: impJson.database.organizationSettings,
    });
    assert.equal(sessionReport.hasConfirmedOrganization, false);
    assert.equal(sessionReport.hasIncompleteHistory, true);

    await assert.rejects(
      () => generateReportDocxBuffer(registryReport),
      /patvirtinti įstaigos rekvizitus/i
    );
    await assert.rejects(
      () =>
        buildLabelsDocxDocument({
          items: [impJson.database.items[0]],
          rooms: impJson.database.rooms,
          departments: impJson.database.departments,
          tapeWidthMm: 24,
          labelLengthMm: 68,
          codeType: 'qr_code',
          organization: impJson.database.organizationSettings,
        }),
      /patvirtinti įstaigos rekvizitus/i
    );

    // Admin confirms org settings explicitly
    const confirmRes = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: impJson.revision,
        clientOpId: 'confirm-org-settings',
        operation: {
          type: 'UPDATE_ORGANIZATION_SETTINGS',
          organizationSettings: {
            ...DEFAULT_ORGANIZATION_SETTINGS,
            name: 'Patvirtinta gimnazija',
          },
        },
      }),
    });
    assert.equal(confirmRes.status, 200);
    const confirmJson = (await confirmRes.json()) as { database: AppDatabase };
    assert.equal(confirmJson.database.organizationSettings?.name, 'Patvirtinta gimnazija');

    // Confirmed DOCX now succeeds, while legacy audit session still keeps no fabricated snapshot
    const confirmedReport = buildRegistrySheetReportData({
      items: confirmJson.database.items,
      rooms: confirmJson.database.rooms,
      departments: confirmJson.database.departments,
      users: confirmJson.database.users,
      filters: {},
      organizationSettings: confirmJson.database.organizationSettings,
    });
    assert.equal(confirmedReport.hasConfirmedOrganization, true);
    const docxBuf = await generateReportDocxBuffer(confirmedReport);
    assert.ok(docxBuf.length > 500);
    assert.equal(confirmJson.database.auditSessions[0].organizationSnapshot, undefined);
  });
});

test('Stage 7.5: End-to-end Stages 1-6 workflow regression, multi-user 409 conflict, reload persistence, and localStorage quota resilience', async () => {
  await withExpressRouterServer(async (baseUrl) => {
    const seeded = buildFixtureDb();
    const imp = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: seeded, source: 'initial_seed' }),
    });
    assert.equal(imp.status, 200);

    const realFetch = globalThis.fetch;
    const apiFetch: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/')) {
        return realFetch(`${baseUrl}${url}`, init);
      }
      return realFetch(input, init);
    };

    const mocks = installBrowserMocks(apiFetch);
    try {
      StorageService.resetForTests();
      const loadedOk = await StorageService.loadFromServer(true);
      assert.equal(loadedOk, true);

      const admin = StorageService.getUsers().find((u) => u.role === 'admin')!;
      const dept = StorageService.getDepartments()[0];
      const room = StorageService.getRooms().find((r) => r.departmentId === dept.id)!;

      // 1. Create & edit item (Stage 2)
      const createdItem: InventoryItem = {
        id: 'item-e2e-stage7',
        inventoryNumber: 'E2E-7001',
        name: 'Pradinis projektorius',
        category: 'Kompiuteriai',
        departmentId: dept.id,
        roomId: room.id,
        responsibleUserId: admin.id,
        acquisitionDate: '2026-02-15',
        purchasePrice: 900,
        residualValue: 750,
        condition: 'good',
        status: 'active',
        assetClass: 'long_term',
        fundingSource: 'school',
      };
      const saveRes = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: createdItem });
      assert.equal(saveRes.ok, true, saveRes.error);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.name, 'Pradinis projektorius');

      // 2. Defect lifecycle: report -> start repair -> resolve (Stage 6)
      const faultReport = {
        id: 'def-e2e-1',
        reportedAt: '2026-03-01T09:00:00.000Z',
        reportedByUserId: admin.id,
        reportedByUserName: admin.fullName,
        description: 'Mirga lempa',
        severity: 'medium' as const,
        status: 'reported' as const,
      };
      const reportRes = await StorageService.executeMutation({
        type: 'SAVE_FAULT_REPORT',
        itemId: createdItem.id,
        defectReport: faultReport,
      });
      assert.equal(reportRes.ok, true, reportRes.error);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.status, 'active');

      const startRepairRes = await StorageService.executeMutation({
        type: 'START_DEFECT_REPAIR',
        itemId: createdItem.id,
        defectId: faultReport.id,
        startedByUserId: admin.id,
        startedByUserName: admin.fullName,
        startedAt: '2026-03-02T10:00:00.000Z',
        repairNotes: 'Užsakyta lempa',
      });
      assert.equal(startRepairRes.ok, true);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.status, 'in_repair');

      const resolveRes = await StorageService.executeMutation({
        type: 'RESOLVE_DEFECT',
        itemId: createdItem.id,
        defectId: faultReport.id,
        resolvedByUserId: admin.id,
        resolvedByUserName: admin.fullName,
        resolvedAt: '2026-03-03T12:00:00.000Z',
        resolutionNotes: 'Pakeista lempa',
      });
      assert.equal(resolveRes.ok, true);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.status, 'active');

      // 3. Write-off submit -> approve whole act -> restore from archive -> reject priority check (Stage 3)
      const draftAct = {
        id: 'act-e2e-7',
        actNumber: 'NUR-2026-777',
        date: '2026-04-01',
        actYear: 2026,
        status: 'draft' as const,
        committeeChair: admin.fullName,
        committeeMembers: ['Narys A', 'Narys B'],
        reasonCategory: 'Sugedo matrica',
        items: [
          {
            itemId: createdItem.id,
            name: createdItem.name,
            inventoryNumber: createdItem.inventoryNumber,
            price: createdItem.purchasePrice,
            residualPrice: createdItem.residualValue ?? 0,
            reason: 'E2E nurašymas',
          },
        ],
        notes: 'E2E nurašymas',
      };
      const woSubmit = await StorageService.executeMutation({
        type: 'CONFIRM_WRITEOFF',
        itemId: createdItem.id,
        reasonCategory: 'Sugedo matrica',
        notes: 'E2E nurašymas',
        act: draftAct,
      });
      assert.equal(woSubmit.ok, true, woSubmit.error);
      const act = StorageService.getWriteOffActs().find((a) =>
        a.items.some((ai) => ai.itemId === createdItem.id)
      )!;
      assert.equal(act.status, 'draft');

      // Cannot start defect repair while pending write-off (Stage 6 priority rule)
      const blockedRepair = await StorageService.executeMutation({
        type: 'START_DEFECT_REPAIR',
        itemId: createdItem.id,
        defectId: 'any',
        startedByUserId: admin.id,
        startedByUserName: admin.fullName,
        startedAt: '2026-04-02T09:00:00.000Z',
      });
      assert.equal(blockedRepair.ok, false);

      const approveActRes = await StorageService.executeMutation({
        type: 'APPROVE_WRITEOFF_ACT',
        actId: act.id,
        approvalYear: 2026,
        approvedDate: '2026-04-05',
        approvedByUserId: admin.id,
        approvedByUserName: admin.fullName,
      });
      assert.equal(approveActRes.ok, true, approveActRes.error);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.status, 'written_off');

      const restoreRes = await StorageService.executeMutation({
        type: 'RESTORE_FROM_ARCHIVE',
        itemId: createdItem.id,
        condition: 'fair',
        reason: 'Klaidingai nurašytas, tinkamas mokymui',
        restoredByUserId: admin.id,
        restoredByUserName: admin.fullName,
        restoredAt: '2026-04-06T09:00:00.000Z',
      });
      assert.equal(restoreRes.ok, true);
      assert.equal(StorageService.getItems().find((i) => i.id === createdItem.id)?.status, 'active');

      // 4. Audit session + QR resolve + immutability after subsequent rename (Stage 4 & Stage 5)
      const createAuditRes = await StorageService.executeMutation({
        type: 'CREATE_AUDIT_SESSION',
        session: {
          id: 'audit-e2e-7',
          year: 2026,
          title: '2026 kontrolinė apžiūra',
          startDate: '2026-05-01',
          departmentId: dept.id,
          includeInRepair: false,
          includeToWriteOff: false,
          committeeChairman: admin.fullName,
          committeeChairmanId: admin.id,
          committeeMembers: ['Narys 1'],
          orderNumber: 'V-77',
          orderDate: '2026-04-30',
        },
      });
      assert.equal(createAuditRes.ok, true);

      const qrText = buildItemQrPayload(
        StorageService.getItems().find((i) => i.id === createdItem.id)!
      );
      const scanned = resolveScannedInventoryItem(qrText, StorageService.getItems());
      assert.equal(scanned.ok, true);
      if (scanned.ok) assert.equal(scanned.item.id, createdItem.id);

      const checkRes = await StorageService.executeMutation({
        type: 'RECORD_AUDIT_CHECK',
        sessionId: 'audit-e2e-7',
        itemId: createdItem.id,
        actualRoomId: room.id,
        method: 'qr',
        checkedByUserId: admin.id,
        checkedByUserName: admin.fullName,
        checkedAt: '2026-05-01T09:15:00.000Z',
      });
      assert.equal(checkRes.ok, true);

      const completeAuditRes = await StorageService.executeMutation({
        type: 'COMPLETE_AUDIT_SESSION',
        sessionId: 'audit-e2e-7',
        completedDate: '2026-05-01',
        completedByUserId: admin.id,
        completedByUserName: admin.fullName,
      });
      assert.equal(completeAuditRes.ok, true);

      // Rename item AFTER audit completion -> completed report stays unchanged!
      const revBeforeRename = StorageService.getSyncState().revision;
      const renamedItem: InventoryItem = {
        ...StorageService.getItems().find((i) => i.id === createdItem.id)!,
        name: 'Pakeistas pavadinimas po inventorizacijos',
      };
      const renameRes = await StorageService.executeMutation({ type: 'SAVE_ITEM', item: renamedItem });
      assert.equal(renameRes.ok, true);

      const completedSession = StorageService.getAuditSessions().find((s) => s.id === 'audit-e2e-7')!;
      const auditReport = buildAuditSessionReportData({
        session: completedSession,
        items: StorageService.getItems(),
        rooms: StorageService.getRooms(),
        departments: StorageService.getDepartments(),
        users: StorageService.getUsers(),
        organizationSettings: StorageService.getOrganizationSettings(),
      });
      const checkedRow = auditReport.expectedRows.find((r) => r.itemId === createdItem.id)!;
      assert.ok(checkedRow);
      assert.equal(checkedRow.name, 'Pradinis projektorius');
      assert.equal(checkedRow.auditStateLabel, 'Rastas vietoje');

      const auditDocx = await generateReportDocxBuffer(auditReport);
      assert.ok(auditDocx.length > 500);
      const auditCsv = buildCsvContent(['Inv', 'Pavadinimas'], [[checkedRow.inventoryNumber, checkedRow.name]]);
      assert.match(auditCsv, /Pradinis projektorius/);

      // 5. CSV user import preview & atomic commit (Stage 6)
      const csvText = `Vardas ir pavardė;El. paštas;Skyrius;Kabinetas\nRasa Mokytoja;rasa.e2e@tryskiugimnazija.lt;${dept.name};${room.number}`;
      const preview = analyzeUsersCsvImport({
        csvText,
        existingUsers: StorageService.getUsers(),
        departments: StorageService.getDepartments(),
        rooms: StorageService.getRooms(),
      });
      if (!preview.ok) {
        assert.fail(preview.error);
      }
      assert.equal(preview.createRows.length, 1);
      const batchBuilt = buildFinalBatchUsersFromPreview(
        preview,
        { roomChoices: {}, skipRowNumbers: [] },
        StorageService.getRooms(),
        StorageService.getDepartments()
      );
      if (!batchBuilt.ok) {
        assert.fail(batchBuilt.error);
      }
      const batchImportRes = await StorageService.executeMutation({
        type: 'BATCH_IMPORT_USERS',
        users: batchBuilt.users,
      });
      assert.equal(batchImportRes.ok, true, batchImportRes.error);
      assert.ok(StorageService.getUsers().some((u) => u.email === 'rasa.e2e@tryskiugimnazija.lt'));

      // 6. Multi-user 409 conflict protection on the exact same item
      const conflictHttp = await apiFetch('/api/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: revBeforeRename,
          clientOpId: 'other-user-stale-conflict',
          operation: {
            type: 'SAVE_ITEM',
            item: { ...renamedItem, name: 'Senas kito naudotojo perrašymas' },
          },
        }),
      });
      assert.equal(conflictHttp.status, 409);

      // 7. Browser reload preserves pending queue in localStorage and flushes cleanly when network returns
      mocks.restore();
      let offline = true;
      const flakyFetch: typeof fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (offline && url.includes('/api/mutate')) {
          return Promise.reject(new Error('Network offline'));
        }
        return url.startsWith('/') ? realFetch(`${baseUrl}${url}`, init) : realFetch(input, init);
      };

      const mocks2 = installBrowserMocks(flakyFetch);
      try {
        StorageService.resetForTests();
        await StorageService.loadFromServer(true);
        const target = StorageService.getItems().find((i) => i.id === createdItem.id)!;
        const offlineRes = await StorageService.executeMutation({
          type: 'SAVE_ITEM',
          item: { ...target, notes: 'Išsaugota po tinklo atsigavimo' },
        });
        assert.equal(offlineRes.ok, false);
        assert.equal(StorageService.getSyncState().pendingCount, 1);

        // Simulate reload before network returns (same localStorage!)
        StorageService.resetForTests();
        offline = false;
        await StorageService.loadFromServer(false);
        await StorageService.retryPendingMutations();
        assert.equal(StorageService.getSyncState().pendingCount, 0);
        assert.equal(
          StorageService.getItems().find((i) => i.id === createdItem.id)?.notes,
          'Išsaugota po tinklo atsigavimo'
        );
      } finally {
        mocks2.restore();
      }

      // 8. localStorage QuotaExceededError sets memoryOnlyQueue=true and does not report false saved success while offline
      offline = true;
      const quotaMocks = installBrowserMocks(flakyFetch, {
        throwOnKeys: ['school_inv_pending_ops_v1'],
        quotaError: true,
      });
      try {
        StorageService.resetForTests();
        await StorageService.loadFromServer(true);
        const target2 = StorageService.getItems().find((i) => i.id === createdItem.id)!;
        const quotaRes = await StorageService.executeMutation({
          type: 'SAVE_ITEM',
          item: { ...target2, notes: 'Tik atmintyje esantis keitimas' },
        });
        assert.equal(quotaRes.ok, false);
        assert.equal(StorageService.getSyncState().memoryOnlyQueue, true);
        assert.equal(StorageService.getSyncState().status, 'error');
      } finally {
        quotaMocks.restore();
      }
    } finally {
      mocks.restore();
    }
  });
});

test('Stage 7.6: Legacy DB with deleted user on department.managerId / room.defaultResponsiblePersonId migrates cleanly with pre_migration backup and warning', async () => {
  await withExpressRouterServer(async (baseUrl, dataDir) => {
    const legacyDb = buildFixtureDb({
      version: '1.0.0',
      departments: INITIAL_DEPARTMENTS.map((d, idx) =>
        idx === 1 ? { ...d, managerId: 'usr-5' } : d
      ),
      rooms: INITIAL_ROOMS.map((r, idx) =>
        idx === 0 ? { ...r, defaultResponsiblePersonId: 'usr-deleted-99' } : r
      ),
    });

    const dbFile = path.join(dataDir, 'school_database.json');
    fs.writeFileSync(dbFile, JSON.stringify(legacyDb, null, 2), 'utf-8');

    // 1. /api/health returns 200 OK (not 503!) and /api/database cleans dangling optional refs after saving pre_migration backup
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as any;
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.dbExists, true);

    const dbRes = await fetch(`${baseUrl}/api/database`);
    assert.equal(dbRes.status, 200);
    const cleanedDb = (await dbRes.json()) as AppDatabase;
    assert.equal(cleanedDb.departments[1].managerId, undefined);
    assert.equal(cleanedDb.rooms[0].defaultResponsiblePersonId, undefined);
    assert.equal(cleanedDb.departments.length, legacyDb.departments.length);
    assert.equal(cleanedDb.items.length, legacyDb.items.length);

    // pre_migration backup was created on disk
    const backups = fs.readdirSync(path.join(dataDir, 'backups'));
    assert.ok(backups.some((f) => f.includes('pre_migration')));

    // 2. scripts/backup-data.sh also succeeds cleanly even before manual server startup
    const backupOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-stage7-dangling-bkp-'));
    try {
      fs.writeFileSync(dbFile, JSON.stringify(legacyDb, null, 2), 'utf-8');
      const { stdout } = await execFileAsync(
        'bash',
        ['scripts/backup-data.sh', dataDir, backupOutDir, 'http://127.0.0.1:1'],
        { cwd: process.cwd() }
      );
      assert.match(stdout, /Sukurtas pilnas duomenų archyvas/);
      assert.ok(fs.readdirSync(backupOutDir).some((f) => f.endsWith('.tar.gz')));
    } finally {
      fs.rmSync(backupOutDir, { recursive: true, force: true });
    }

    // 3. Explicit SAVE_DEPARTMENT with non-existent managerId is still rejected (400)
    const badDeptSave = await fetch(`${baseUrl}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: cleanedDb.revision || 1,
        clientOpId: 'op-bad-dept-mgr',
        operation: {
          type: 'SAVE_DEPARTMENT',
          department: { ...cleanedDb.departments[1], managerId: 'usr-nonexistent' },
        },
      }),
    });
    assert.equal(badDeptSave.status, 400);
  });
});

