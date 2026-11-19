import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AppDatabase,
  CURRENT_DB_VERSION,
  SUPPORTED_DB_VERSIONS,
  validateAndMigrateDatabase,
} from '../utils/databaseValidation.ts';
import {
  DbMutation,
  applyDbMutation,
  getTouchedEntityKeys,
} from '../utils/dbOperations.ts';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB maksimalus vienos nuotraukos dydis
const MAX_BACKUPS_TO_KEEP = 30;
const MAX_PROCESSED_OPS = 200;

const MIME_TO_EXT: Record<string, string> = {
  jpeg: 'jpg',
  jpg: 'jpg',
  pjpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  'svg+xml': 'svg',
  svg: 'svg',
  avif: 'avif',
  bmp: 'bmp',
  'x-ms-bmp': 'bmp',
  'x-icon': 'ico',
  'vnd.microsoft.icon': 'ico',
  heic: 'heic',
  heif: 'heif',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
};

export interface DatabaseApiOptions {
  dataDir: string;
}

export function createDatabaseApiRouter(options: DatabaseApiOptions) {
  const router = express.Router();
  const DATA_DIR = options.dataDir;
  const DB_FILE = path.join(DATA_DIR, 'school_database.json');
  const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
  const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

  for (const dir of [DATA_DIR, PHOTOS_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Nuosekli užrašymo eilė (mutex), kad kelios užklausos niekada nesusikirstų
  let lockChain: Promise<void> = Promise.resolve();
  function withDbLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = lockChain.then(() => fn());
    lockChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // Atomiškas failo įrašymas per laikiną failą tame pačiame kataloge + rename
  function writeFileAtomic(targetPath: string, content: string | Buffer) {
    const tmpPath = `${targetPath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let fd: number | null = null;
    try {
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
      fd = fs.openSync(tmpPath, 'w');
      fs.writeSync(fd, buf, 0, buf.length);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmpPath, targetPath);
    } catch (err) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  // Atsarginės serverio kopijos išsaugojimas prieš migraciją ar pilną atkūrimą
  function createServerBackup(reason: string): string | null {
    if (!fs.existsSync(DB_FILE)) return null;
    const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `school_database_${reason}_${safeTime}.json`;
    const backupPath = path.join(BACKUPS_DIR, backupName);
    const existing = fs.readFileSync(DB_FILE);
    writeFileAtomic(backupPath, existing);

    // Apribojame seniausių automatinių kopijų skaičių
    try {
      const files = fs
        .readdirSync(BACKUPS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const old of files.slice(MAX_BACKUPS_TO_KEEP)) {
        fs.unlinkSync(path.join(BACKUPS_DIR, old.name));
      }
    } catch {
      // ignore pruning failures
    }

    return backupName;
  }

  function saveDataUrlToDisk(
    dataUrl: string,
    preferredFilename?: string
  ): { ok: true; url: string } | { ok: false; statusCode: number; error: string } {
    const trimmedUrl = dataUrl.trim();
    const b64Match = /^data:image\/([a-z0-9.+-]+)(?:;[^,;]*)*;base64,([A-Za-z0-9+/=_\-\s]+)$/i.exec(
      trimmedUrl
    );
    const svgRawMatch = !b64Match
      ? /^data:image\/svg\+xml(?:;[^,]*)*,([\s\S]+)$/i.exec(trimmedUrl)
      : null;

    let mimeSubtype: string;
    let buffer: Buffer;

    if (b64Match) {
      mimeSubtype = b64Match[1].toLowerCase();
      if (!MIME_TO_EXT[mimeSubtype]) {
        return {
          ok: false,
          statusCode: 400,
          error: `Netinkamas nuotraukos formatas (image/${mimeSubtype}). Leidžiami JPEG, PNG, WEBP, GIF, SVG, AVIF arba BMP failai.`,
        };
      }
      const base64Clean = b64Match[2]
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      buffer = Buffer.from(base64Clean, 'base64');
    } else if (svgRawMatch) {
      mimeSubtype = 'svg+xml';
      const rawBody = svgRawMatch[1];
      let decodedSvg = rawBody;
      if (/%[0-9A-Fa-f]{2}/.test(rawBody)) {
        try {
          decodedSvg = decodeURIComponent(rawBody);
        } catch {
          decodedSvg = rawBody;
        }
      }
      buffer = Buffer.from(decodedSvg, 'utf-8');
    } else {
      return {
        ok: false,
        statusCode: 400,
        error: 'Netinkamas nuotraukos formatas. Leidžiami JPEG, PNG, WEBP, GIF arba SVG failai.',
      };
    }

    const ext = MIME_TO_EXT[mimeSubtype] || 'jpg';

    if (buffer.length === 0) {
      return { ok: false, statusCode: 400, error: 'Nuotraukos failas tuščias.' };
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      return {
        ok: false,
        statusCode: 413,
        error: `Nuotrauka per didelė (${(buffer.length / (1024 * 1024)).toFixed(2)} MB). Maksimalus leidžiamas dydis – 5 MB.`,
      };
    }

    let filename: string;
    if (preferredFilename) {
      const base = path.basename(preferredFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
      filename = base.includes('.') ? base : `${base}.${ext}`;
    } else {
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      filename = `photo_${hash}.${ext}`;
    }

    const target = path.join(PHOTOS_DIR, filename);
    if (!fs.existsSync(target)) {
      writeFileAtomic(target, buffer);
    }

    return { ok: true, url: `/api/photos/${filename}` };
  }

  // Iškelia visas inline base64 nuotraukas iš duomenų bazės į data/photos/
  function extractInlinePhotosFromDb(
    db: AppDatabase,
    opts: { lenientLegacy?: boolean } = {}
  ): {
    ok: true;
    database: AppDatabase;
    extractedCount: number;
  } | { ok: false; statusCode: number; error: string } {
    let extractedCount = 0;

    // 1. Jei importuojama kopija turi photos žodyną, atkuriame visas nuotraukas į diską
    if (db.photos) {
      for (const [key, dataUrl] of Object.entries(db.photos)) {
        const preferred = key.startsWith('/api/photos/') ? path.basename(key) : key;
        const saved = saveDataUrlToDisk(dataUrl, preferred);
        if (!saved.ok) {
          if (opts.lenientLegacy) {
            console.warn(`[Nuotraukų migracija] Praleista sugadinta nuotrauka „${key}“: ${saved.error}`);
            continue;
          }
          return saved;
        }
        extractedCount++;
      }
    }

    // 2. Patikriname daiktų ir gedimų nuotraukas (palaikome senus base64 duomenis)
    const nextItems = db.items.map((item) => {
      let updatedItem = item;

      if (item.photoUrl && item.photoUrl.startsWith('data:image/')) {
        const saved = saveDataUrlToDisk(item.photoUrl);
        if (!saved.ok) {
          if (opts.lenientLegacy) {
            console.warn(
              `[Nuotraukų migracija] Nepavyko iškelti daikto [${item.inventoryNumber}] nuotraukos: ${saved.error}`
            );
          } else {
            throw Object.assign(new Error(saved.error), { statusCode: saved.statusCode });
          }
        } else {
          updatedItem = { ...updatedItem, photoUrl: saved.url };
          extractedCount++;
        }
      }

      if (updatedItem.defectReports && updatedItem.defectReports.length > 0) {
        let reportsChanged = false;
        const nextReports = updatedItem.defectReports.map((rep) => {
          if (rep.photoUrl && rep.photoUrl.startsWith('data:image/')) {
            const saved = saveDataUrlToDisk(rep.photoUrl);
            if (!saved.ok) {
              if (opts.lenientLegacy) {
                console.warn(
                  `[Nuotraukų migracija] Nepavyko iškelti gedimo (${rep.id}) nuotraukos: ${saved.error}`
                );
                return rep;
              }
              throw Object.assign(new Error(saved.error), { statusCode: saved.statusCode });
            }
            reportsChanged = true;
            extractedCount++;
            return { ...rep, photoUrl: saved.url };
          }
          return rep;
        });
        if (reportsChanged) {
          updatedItem = { ...updatedItem, defectReports: nextReports };
        }
      }

      return updatedItem;
    });

    const { photos: _stripped, ...rest } = db;
    return {
      ok: true,
      extractedCount,
      database: {
        ...rest,
        items: nextItems,
      },
    };
  }

  function extractInlinePhotosFromMutation(op: DbMutation): DbMutation {
    if (op.type === 'SAVE_ITEM') {
      let nextItem = op.item;
      if (nextItem.photoUrl && nextItem.photoUrl.startsWith('data:image/')) {
        const saved = saveDataUrlToDisk(nextItem.photoUrl);
        if (!saved.ok) {
          throw Object.assign(new Error(saved.error), { statusCode: saved.statusCode });
        }
        nextItem = { ...nextItem, photoUrl: saved.url };
      }
      if (nextItem.defectReports && nextItem.defectReports.length > 0) {
        nextItem = {
          ...nextItem,
          defectReports: nextItem.defectReports.map((rep) => {
            if (rep.photoUrl && rep.photoUrl.startsWith('data:image/')) {
              const saved = saveDataUrlToDisk(rep.photoUrl);
              if (!saved.ok) {
                throw Object.assign(new Error(saved.error), { statusCode: saved.statusCode });
              }
              return { ...rep, photoUrl: saved.url };
            }
            return rep;
          }),
        };
      }
      return { ...op, item: nextItem };
    }

    if (op.type === 'SAVE_FAULT_REPORT') {
      if (op.defectReport.photoUrl && op.defectReport.photoUrl.startsWith('data:image/')) {
        const saved = saveDataUrlToDisk(op.defectReport.photoUrl);
        if (!saved.ok) {
          throw Object.assign(new Error(saved.error), { statusCode: saved.statusCode });
        }
        return {
          ...op,
          defectReport: { ...op.defectReport, photoUrl: saved.url },
        };
      }
    }

    return op;
  }

  // Prijungia nuotraukas prie eksportuojamos atsarginės kopijos
  function attachPhotosForBackup(db: AppDatabase): AppDatabase {
    const photos: Record<string, string> = {};
    const collectUrl = (url?: string) => {
      if (!url || !url.startsWith('/api/photos/')) return;
      if (photos[url]) return;
      const safeName = path.basename(url);
      const filePath = path.join(PHOTOS_DIR, safeName);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(safeName).replace('.', '').toLowerCase();
        const mime = EXT_TO_MIME[ext] || 'image/jpeg';
        const b64 = fs.readFileSync(filePath).toString('base64');
        photos[url] = `data:${mime};base64,${b64}`;
      }
    };

    for (const item of db.items) {
      collectUrl(item.photoUrl);
      if (item.defectReports) {
        for (const rep of item.defectReports) {
          collectUrl(rep.photoUrl);
        }
      }
    }

    return Object.keys(photos).length > 0 ? { ...db, photos } : db;
  }

  // Konfliktų ir idempotencijos būsena serverio atmintyje
  let serverBootRevision = 0;
  const entityHistory = new Map<string, Array<{ revision: number; clientOpId?: string }>>();
  const processedClientOps = new Map<
    string,
    { revision: number; database: AppDatabase; merged: boolean }
  >();

  function rememberClientOp(
    opId: string,
    result: { revision: number; database: AppDatabase; merged: boolean }
  ) {
    processedClientOps.set(opId, result);
    if (processedClientOps.size > MAX_PROCESSED_OPS) {
      const firstKey = processedClientOps.keys().next().value;
      if (firstKey) processedClientOps.delete(firstKey);
    }
  }

  // Nuskaito ir (jei reikia) saugiai migruoja duomenų bazę iš disko
  function readAndNormalizeServerDb(): AppDatabase | null {
    if (!fs.existsSync(DB_FILE)) return null;
    const rawText = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(rawText);
    const validation = validateAndMigrateDatabase(parsed);
    if (!validation.ok) {
      throw new Error(`Serverio duomenų bazės pažeidimas: ${validation.error}`);
    }

    let db = validation.data;
    const extracted = extractInlinePhotosFromDb(db, { lenientLegacy: true });
    if (!extracted.ok) {
      throw new Error(extracted.error);
    }
    db = extracted.database;

    if (validation.migrated || extracted.extractedCount > 0) {
      createServerBackup('pre_migration');
      writeFileAtomic(DB_FILE, JSON.stringify(db, null, 2));
    }

    if (serverBootRevision === 0) {
      serverBootRevision = db.revision || 1;
    }

    return db;
  }

  // Pradinis tikrinimas paleidimo metu
  try {
    readAndNormalizeServerDb();
  } catch (err) {
    console.error('Pradinio duomenų bazės patikrinimo klaida:', err);
  }

  // Health Check (tikrina duomenų katalogo pasiekiamumą, JSON struktūrą ir schemos versiją)
  router.get('/api/health', (_req, res) => {
    try {
      fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
      const dbExists = fs.existsSync(DB_FILE);
      const photoCount = fs.existsSync(PHOTOS_DIR) ? fs.readdirSync(PHOTOS_DIR).length : 0;

      if (!dbExists) {
        return res.json({
          status: 'ok',
          initialized: false,
          serverTime: new Date().toISOString(),
          dbExists: false,
          revision: 0,
          schemaVersion: CURRENT_DB_VERSION,
          supportedVersions: [...SUPPORTED_DB_VERSIONS],
          photoCount,
          singleProcessMode: true,
        });
      }

      const rawText = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const rawVersion = typeof parsed?.version === 'string' ? parsed.version : 'unknown';
      const validation = validateAndMigrateDatabase(parsed);
      if (!validation.ok) {
        return res.status(503).json({
          status: 'error',
          initialized: true,
          dbExists: true,
          schemaVersion: rawVersion,
          supportedVersions: [...SUPPORTED_DB_VERSIONS],
          error: validation.error,
        });
      }

      const revision =
        typeof validation.data.revision === 'number' ? validation.data.revision : 1;

      return res.json({
        status: 'ok',
        initialized: true,
        serverTime: new Date().toISOString(),
        dbExists: true,
        revision,
        schemaVersion: rawVersion,
        migratedPending: validation.migrated,
        supportedVersions: [...SUPPORTED_DB_VERSIONS],
        photoCount,
        singleProcessMode: true,
      });
    } catch (err: any) {
      return res.status(503).json({
        status: 'error',
        error: err?.message || String(err),
      });
    }
  });

  // Gauti centrinę duomenų bazę (be didelių nuotraukų failų turinio)
  router.get('/api/database', async (_req, res) => {
    try {
      const db = await withDbLock(() => readAndNormalizeServerDb());
      if (!db) {
        res.setHeader('X-DB-Revision', '0');
        return res.json(null);
      }
      res.setHeader('X-DB-Revision', String(db.revision || 1));
      return res.json(db);
    } catch (err) {
      console.error('Klaida skaitant duomenų bazę:', err);
      return res.status(500).json({ error: 'Nepavyko perskaityti serverio duomenų bazės' });
    }
  });

  // Pilna nešiojama JSON atsarginė kopija (kartu su visomis nuotraukomis)
  router.get('/api/database/backup', async (_req, res) => {
    try {
      const backup = await withDbLock(() => {
        const db = readAndNormalizeServerDb();
        if (!db) return null;
        return attachPhotosForBackup(db);
      });
      if (!backup) {
        return res.status(404).json({ error: 'Serverio duomenų bazė dar nesukurta' });
      }
      return res.json(backup);
    } catch (err) {
      console.error('Klaida eksportuojant atsarginę kopiją:', err);
      return res.status(500).json({ error: 'Nepavyko suformuoti atsarginės kopijos' });
    }
  });

  // Vientisas konkrečios operacijos pritaikymas su konfliktų tikrinimu ir sujungimu
  router.post('/api/mutate', async (req, res) => {
    try {
      const { baseRevision, clientOpId, operation, precedingClientOpIds } = req.body as {
        baseRevision?: number;
        clientOpId?: string;
        operation?: DbMutation;
        precedingClientOpIds?: string[];
      };

      if (!operation || typeof operation.type !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Trūksta operacijos duomenų („operation“).',
        });
      }

      const result = await withDbLock(() => {
        // Idempotentumo tikrinimas pakartotinai siunčiant tą pačią operaciją
        if (clientOpId && processedClientOps.has(clientOpId)) {
          const cached = processedClientOps.get(clientOpId)!;
          return {
            status: 200,
            body: {
              success: true,
              revision: cached.revision,
              database: cached.database,
              merged: cached.merged,
              deduplicated: true,
            },
          };
        }

        const currentDb = readAndNormalizeServerDb();
        if (!currentDb) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'DB_NOT_INITIALIZED',
              currentRevision: 0,
              error:
                'Serverio duomenų bazė dar neinicijuota. Pirmiausia importuokite atsarginę kopiją arba inicijuokite bazę.',
            },
          };
        }

        const currentRevision = currentDb.revision || 1;
        if (typeof baseRevision !== 'number' || baseRevision < 1) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'STALE_CLIENT',
              currentRevision,
              database: currentDb,
              error:
                'Naršyklė neturėjo galiojančios serverio versijos. Duomenys neperrašyti – atnaujinkite vaizdą iš serverio.',
            },
          };
        }

        // Jei naršyklė dirba su senesne nei serverio starto versija -> galimo konflikto apsauga
        if (baseRevision < serverBootRevision) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'CONFLICT',
              currentRevision,
              database: currentDb,
              error:
                'Jūsų naršyklės duomenys pasenę (serveris buvo atnaujintas ar kiti vartotojai atliko pakeitimų). Atnaujinkite duomenis iš serverio.',
            },
          };
        }

        if (baseRevision > currentRevision) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'CONFLICT',
              currentRevision,
              database: currentDb,
              error: 'Neteisingas versijos numeris. Atnaujinkite duomenis iš serverio.',
            },
          };
        }

        // Tikriname ar tas pats objektas nebuvo pakeistas kito naudotojo tarp baseRevision ir currentRevision
        const touchedKeys = getTouchedEntityKeys(currentDb, operation);
        const precedingSet = new Set(
          Array.isArray(precedingClientOpIds) ? precedingClientOpIds : []
        );
        if (baseRevision < currentRevision) {
          for (const key of touchedKeys) {
            const historyEntries = entityHistory.get(key) || [];
            const newerForeignChange = historyEntries.some(
              (entry) =>
                entry.revision > baseRevision &&
                (!entry.clientOpId || !precedingSet.has(entry.clientOpId))
            );
            if (newerForeignChange) {
              return {
                status: 409,
                body: {
                  success: false,
                  code: 'CONFLICT',
                  currentRevision,
                  database: currentDb,
                  conflictingKey: key,
                  error:
                    'Šį įrašą ką tik pakeitė kitas naudotojas. Kad neprarastumėte jo pakeitimų, atnaujinkite duomenis iš serverio ir pakartokite veiksmą.',
                },
              };
            }
          }
        }

        // Išsaugome inline nuotraukas į diską prieš įrašant į JSON
        const normalizedOp = extractInlinePhotosFromMutation(operation);

        const applied = applyDbMutation(currentDb, normalizedOp);
        if (!applied.ok) {
          return {
            status: applied.statusCode || 400,
            body: {
              success: false,
              error: applied.error,
              currentRevision,
            },
          };
        }

        const nextRevision = currentRevision + 1;
        const nextDb: AppDatabase = {
          ...applied.database,
          version: CURRENT_DB_VERSION,
          revision: nextRevision,
        };

        // Galutinė vientisumo kontrolė prieš įrašant į diską
        const postValidation = validateAndMigrateDatabase(nextDb);
        if (!postValidation.ok) {
          return {
            status: 400,
            body: {
              success: false,
              error: `Duomenų vientisumo klaida: ${postValidation.error}`,
              currentRevision,
            },
          };
        }

        writeFileAtomic(DB_FILE, JSON.stringify(postValidation.data, null, 2));

        for (const key of touchedKeys) {
          const list = entityHistory.get(key) || [];
          list.push({ revision: nextRevision, clientOpId });
          if (list.length > 50) list.shift();
          entityHistory.set(key, list);
        }

        const merged = baseRevision < currentRevision;
        if (clientOpId) {
          rememberClientOp(clientOpId, {
            revision: nextRevision,
            database: postValidation.data,
            merged,
          });
        }

        return {
          status: 200,
          body: {
            success: true,
            revision: nextRevision,
            database: postValidation.data,
            merged,
          },
        };
      });

      return res.status(result.status).json(result.body);
    } catch (err: any) {
      const statusCode = err?.statusCode || 500;
      console.error('Klaida vykdant /api/mutate:', err);
      return res.status(statusCode).json({
        success: false,
        error: err?.message || 'Nepavyko išsaugoti pakeitimo serveryje.',
      });
    }
  });

  // Vientisas pilnos duomenų bazės importas arba atkūrimas
  router.post('/api/database/import', async (req, res) => {
    try {
      const { expectedRevision, database, jsonContent, source } = req.body as {
        expectedRevision?: number;
        database?: unknown;
        jsonContent?: string;
        source?: 'backup_import' | 'demo_reset' | 'initial_seed';
      };

      let parsedRaw: unknown = database;
      if (!parsedRaw && typeof jsonContent === 'string') {
        try {
          parsedRaw = JSON.parse(jsonContent);
        } catch {
          return res.status(400).json({
            success: false,
            error: 'Failas nėra galiojantis JSON dokumentas (sintaksės klaida). Ankstesni duomenys nepakeisti.',
          });
        }
      }

      if (!parsedRaw) {
        return res.status(400).json({
          success: false,
          error: 'Trūksta importuojamų duomenų. Ankstesni duomenys nepakeisti.',
        });
      }

      // 1. Prieš bet kokį keitimą griežtai patikriname visą struktūrą, tipus, unikalius ID/Nr. ir ryšius
      const validation = validateAndMigrateDatabase(parsedRaw);
      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          error: `${validation.error} Ankstesni duomenys liko nepakeisti.`,
        });
      }

      const result = await withDbLock(() => {
        const currentDb = readAndNormalizeServerDb();
        const currentRevision = currentDb ? currentDb.revision || 1 : 0;

        if (
          currentDb &&
          typeof expectedRevision === 'number' &&
          expectedRevision !== currentRevision
        ) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'CONFLICT',
              currentRevision,
              database: currentDb,
              error:
                'Serverio duomenų bazė tuo tarpu pasikeitė. Atnaujinkite duomenis iš serverio ir bandykite importuoti dar kartą.',
            },
          };
        }

        // 2. Prieš perrašymą būtinai sukuriame ankstesnės serverio bazės atsarginę kopiją
        const reason = source === 'demo_reset' ? 'pre_demo_reset' : 'pre_import';
        const backupFile = createServerBackup(reason);

        // 3. Išsaugome nuotraukas į diską ir išvalome base64 iš JSON
        const extracted = extractInlinePhotosFromDb(validation.data);
        if (!extracted.ok) {
          return {
            status: extracted.statusCode,
            body: { success: false, error: extracted.error },
          };
        }

        const nextRevision = currentRevision + 1;
        const nextDb: AppDatabase = {
          ...extracted.database,
          version: CURRENT_DB_VERSION,
          revision: nextRevision,
          exportedAt: new Date().toISOString(),
        };

        writeFileAtomic(DB_FILE, JSON.stringify(nextDb, null, 2));

        // Po pilno bazės pakeitimo atnaujiname konfliktų sekimo ribą
        serverBootRevision = nextRevision;
        entityHistory.clear();
        processedClientOps.clear();

        return {
          status: 200,
          body: {
            success: true,
            revision: nextRevision,
            database: nextDb,
            migrated: validation.migrated,
            warnings: validation.warnings,
            backupFile,
          },
        };
      });

      return res.status(result.status).json(result.body);
    } catch (err: any) {
      console.error('Klaida importuojant duomenų bazę:', err);
      return res.status(err?.statusCode || 500).json({
        success: false,
        error: err?.message || 'Nepavyko importuoti duomenų bazės. Ankstesni duomenys nepakeisti.',
      });
    }
  });

  // Suderinamumo tikslais paliktas /api/database POST – dabar griežtai tikrina versiją ir konfliktus!
  router.post('/api/database', async (req, res) => {
    try {
      const payload = req.body as Record<string, unknown>;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ success: false, error: 'Trūksta duomenų paketo.' });
      }

      const expectedRevision =
        typeof payload.expectedRevision === 'number'
          ? payload.expectedRevision
          : typeof payload.revision === 'number'
          ? payload.revision
          : undefined;

      const validation = validateAndMigrateDatabase(payload);
      if (!validation.ok) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      const result = await withDbLock(() => {
        const currentDb = readAndNormalizeServerDb();
        const currentRevision = currentDb ? currentDb.revision || 1 : 0;

        if (currentDb && expectedRevision !== currentRevision) {
          return {
            status: 409,
            body: {
              success: false,
              code: 'CONFLICT',
              currentRevision,
              database: currentDb,
              error:
                'Konfliktas: pasenusi naršyklės kopija negali perrašyti naujesnių serverio duomenų.',
            },
          };
        }

        createServerBackup('pre_replace');
        const extracted = extractInlinePhotosFromDb(validation.data);
        if (!extracted.ok) {
          return {
            status: extracted.statusCode,
            body: { success: false, error: extracted.error },
          };
        }

        const nextRevision = currentRevision + 1;
        const nextDb: AppDatabase = {
          ...extracted.database,
          version: CURRENT_DB_VERSION,
          revision: nextRevision,
          exportedAt: new Date().toISOString(),
        };

        writeFileAtomic(DB_FILE, JSON.stringify(nextDb, null, 2));
        serverBootRevision = nextRevision;
        entityHistory.clear();
        processedClientOps.clear();

        return {
          status: 200,
          body: {
            success: true,
            revision: nextRevision,
            database: nextDb,
            savedAt: nextDb.exportedAt,
          },
        };
      });

      return res.status(result.status).json(result.body);
    } catch (err: any) {
      console.error('Klaida įrašant /api/database:', err);
      return res.status(err?.statusCode || 500).json({
        success: false,
        error: err?.message || 'Nepavyko įrašyti serverio duomenų bazės.',
      });
    }
  });

  // Atskiras nuotraukos įkėlimo maršrutas (kad nereikėtų siųsti nuotraukų su kiekvienu mažu pakeitimu)
  router.post('/api/photos', async (req, res) => {
    try {
      const { dataUrl } = req.body as { dataUrl?: string };
      if (!dataUrl || typeof dataUrl !== 'string') {
        return res.status(400).json({ success: false, error: 'Trūksta nuotraukos duomenų.' });
      }
      const saved = await withDbLock(() => saveDataUrlToDisk(dataUrl));
      if (!saved.ok) {
        return res.status(saved.statusCode).json({ success: false, error: saved.error });
      }
      return res.json({ success: true, url: saved.url });
    } catch (err) {
      console.error('Klaida įkeliant nuotrauką:', err);
      return res.status(500).json({ success: false, error: 'Nepavyko išsaugoti nuotraukos serveryje.' });
    }
  });

  // Saugus nuotraukos pateikimas iš data/photos katalogo
  router.get('/api/photos/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename || '');
    if (!safeName || safeName.startsWith('.')) {
      return res.status(400).json({ error: 'Neteisingas failo pavadinimas' });
    }
    const resolved = path.resolve(PHOTOS_DIR, safeName);
    if (!resolved.startsWith(path.resolve(PHOTOS_DIR) + path.sep)) {
      return res.status(403).json({ error: 'Prieiga uždrausta' });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Nuotrauka nerasta' });
    }
    const ext = path.extname(safeName).replace('.', '').toLowerCase();
    const mime = EXT_TO_MIME[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (ext === 'svg') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(resolved);
  });

  // JSON ir užklausos dydžio (413) klaidų gaudymas
  router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        error:
          'Siunčiamas failas arba užklausa viršija serverio dydžio limitą. Sumažinkite nuotraukos ar failo dydį.',
      });
    }
    if (err && err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Neteisingas JSON užklausos formatas.',
      });
    }
    return next(err);
  });

  return router;
}
