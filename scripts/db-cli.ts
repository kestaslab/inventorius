import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AppDatabase, validateAndMigrateDatabase } from '../src/utils/databaseValidation.ts';

const MIME_TO_EXT: Record<string, string> = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
};

function saveDataUrl(
  photosDir: string,
  dataUrl: string,
  preferredFilename?: string
): string {
  const match = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Netinkamas nuotraukos base64 formatas atsarginėje kopijoje.');
  }
  const ext = MIME_TO_EXT[match[1].toLowerCase()] || 'jpg';
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) {
    throw new Error('Tuščias nuotraukos failas atsarginėje kopijoje.');
  }
  let filename: string;
  if (preferredFilename) {
    const base = path.basename(preferredFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
    filename = base.includes('.') ? base : `${base}.${ext}`;
  } else {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    filename = `photo_${hash}.${ext}`;
  }
  fs.mkdirSync(photosDir, { recursive: true });
  fs.writeFileSync(path.join(photosDir, filename), buffer);
  return `/api/photos/${filename}`;
}

function validateJsonFile(filePath: string): {
  db: AppDatabase;
  migrated: boolean;
  warnings: string[];
} {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Failas nerastas: ${filePath}`);
  }
  const rawText = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(rawText);
  const res = validateAndMigrateDatabase(parsed);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return {
    db: res.data,
    migrated: res.migrated,
    warnings: res.warnings,
  };
}

function summarizeDb(db: AppDatabase, photosDir?: string) {
  const photoFiles =
    photosDir && fs.existsSync(photosDir) ? fs.readdirSync(photosDir).length : 0;
  return {
    version: db.version,
    revision: db.revision ?? 1,
    departments: db.departments.length,
    rooms: db.rooms.length,
    users: db.users.length,
    items: db.items.length,
    movements: db.movements.length,
    writeOffActs: db.writeOffActs.length,
    auditSessions: db.auditSessions.length,
    hasOrganizationSettings: Boolean(db.organizationSettings),
    photoFiles,
  };
}

const [, , cmd, arg1, arg2] = process.argv;

try {
  if (cmd === 'validate-json') {
    if (!arg1) throw new Error('Nurodykite JSON failo kelią.');
    const { db, migrated, warnings } = validateJsonFile(arg1);
    console.log(JSON.stringify({ ok: true, migrated, warnings, summary: summarizeDb(db) }));
    process.exit(0);
  }

  if (cmd === 'prepare-restore') {
    if (!arg1 || !arg2) {
      throw new Error('Naudojimas: prepare-restore <backup.json> <staging-data-dir>');
    }
    const { db, migrated, warnings } = validateJsonFile(arg1);
    const stagingDir = path.resolve(arg2);
    const photosDir = path.join(stagingDir, 'photos');
    fs.mkdirSync(photosDir, { recursive: true });
    fs.mkdirSync(path.join(stagingDir, 'backups'), { recursive: true });

    if (db.photos) {
      for (const [key, dataUrl] of Object.entries(db.photos)) {
        const preferred = key.startsWith('/api/photos/') ? path.basename(key) : key;
        saveDataUrl(photosDir, dataUrl, preferred);
      }
    }

    const nextItems = db.items.map((item) => {
      let nextItem = item;
      if (item.photoUrl && item.photoUrl.startsWith('data:image/')) {
        nextItem = { ...nextItem, photoUrl: saveDataUrl(photosDir, item.photoUrl) };
      }
      if (nextItem.defectReports && nextItem.defectReports.length > 0) {
        nextItem = {
          ...nextItem,
          defectReports: nextItem.defectReports.map((rep) =>
            rep.photoUrl && rep.photoUrl.startsWith('data:image/')
              ? { ...rep, photoUrl: saveDataUrl(photosDir, rep.photoUrl) }
              : rep
          ),
        };
      }
      return nextItem;
    });

    const { photos: _removed, ...rest } = db;
    const normalizedDb: AppDatabase = { ...rest, items: nextItems };
    fs.writeFileSync(
      path.join(stagingDir, 'school_database.json'),
      JSON.stringify(normalizedDb, null, 2),
      'utf-8'
    );

    console.log(
      JSON.stringify({
        ok: true,
        migrated,
        warnings,
        summary: summarizeDb(normalizedDb, photosDir),
      })
    );
    process.exit(0);
  }

  if (cmd === 'verify-dir') {
    if (!arg1) throw new Error('Nurodykite DATA_DIR kelią.');
    const dataDir = path.resolve(arg1);
    const dbFile = path.join(dataDir, 'school_database.json');
    const photosDir = path.join(dataDir, 'photos');
    const { db, migrated, warnings } = validateJsonFile(dbFile);

    // Patikriname, ar visos /api/photos/* nuorodos egzistuoja diske
    const missingPhotos: string[] = [];
    const checkPhotoRef = (url?: string) => {
      if (!url || !url.startsWith('/api/photos/')) return;
      const p = path.join(photosDir, path.basename(url));
      if (!fs.existsSync(p)) missingPhotos.push(url);
    };
    for (const item of db.items) {
      checkPhotoRef(item.photoUrl);
      for (const rep of item.defectReports || []) {
        checkPhotoRef(rep.photoUrl);
      }
    }

    console.log(
      JSON.stringify({
        ok: missingPhotos.length === 0,
        migrated,
        warnings,
        missingPhotos,
        summary: summarizeDb(db, photosDir),
      })
    );
    if (missingPhotos.length > 0) {
      process.exit(2);
    }
    process.exit(0);
  }

  throw new Error(`Nežinoma komanda: ${cmd || '(tuščia)'}`);
} catch (err: any) {
  console.error(err?.message || String(err));
  process.exit(1);
}
