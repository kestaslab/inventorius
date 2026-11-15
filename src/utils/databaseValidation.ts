import {
  Department,
  Room,
  User,
  UserRole,
  InventoryItem,
  ItemCategory,
  ItemStatus,
  ItemCondition,
  AssetClass,
  FundingSource,
  MovementRecord,
  WriteOffAct,
  WriteOffActItem,
  WriteOffRejectedItemRecord,
  WriteOffHistoryEntry,
  WriteOffRejectionEntry,
  AuditSession,
  AuthSettings,
  OrganizationSettings,
  DefectReport,
  ComputerSpecs,
} from '../types/inventory';
import { analyzeWriteOffIntegrity } from './writeOffUtils';
import { DEFAULT_ORGANIZATION_SETTINGS, cloneOrganizationSettings } from './organization';

export const CURRENT_DB_VERSION = '1.1.0';
export const SUPPORTED_DB_VERSIONS = ['1.0.0', '1.1.0'] as const;

export interface AppDatabase {
  version: string;
  revision?: number;
  exportedAt: string;
  departments: Department[];
  rooms: Room[];
  users: User[];
  items: InventoryItem[];
  movements: MovementRecord[];
  writeOffActs: WriteOffAct[];
  auditSessions: AuditSession[];
  authSettings?: AuthSettings;
  organizationSettings?: OrganizationSettings;
  photos?: Record<string, string>;
}

export type ValidationResult =
  | {
      ok: true;
      data: AppDatabase;
      migrated: boolean;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

const VALID_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'manager', 'teacher', 'auditor']);
const VALID_STATUSES: ReadonlySet<ItemStatus> = new Set([
  'active',
  'in_repair',
  'to_writeoff',
  'written_off',
]);
const VALID_CONDITIONS: ReadonlySet<ItemCondition> = new Set(['new', 'good', 'fair', 'poor']);
const VALID_ASSET_CLASSES: ReadonlySet<AssetClass> = new Set(['long_term', 'short_term']);
const VALID_FUNDING_SOURCES: ReadonlySet<FundingSource> = new Set([
  'school',
  'municipality',
  'ministry',
  'project',
  'donation',
]);
const VALID_CATEGORIES: ReadonlySet<ItemCategory> = new Set([
  'Kompiuteriai',
  'Kita IT įranga',
  'Baldai',
  'Mokymo priemonės',
  'Sporto inventorius',
  'Buitinė ir virtuvės technika',
  'Muzikos instrumentai',
  'Laboratorinė įranga',
  'Kita',
]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const isOptionalString = (v: unknown): v is string | undefined =>
  v === undefined || typeof v === 'string';

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

const isOptionalBoolean = (v: unknown): v is boolean | undefined =>
  v === undefined || typeof v === 'boolean';

export function isValidIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yStr, mStr, dStr] = value.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1950 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function migrateLegacyCategory(item: Record<string, unknown>): {
  category: ItemCategory;
  migrated: boolean;
} {
  const rawCat = item.category;
  if (typeof rawCat === 'string' && VALID_CATEGORIES.has(rawCat as ItemCategory)) {
    return { category: rawCat as ItemCategory, migrated: false };
  }
  if (rawCat === 'IT įranga') {
    const specs = isPlainObject(item.specs) ? item.specs : undefined;
    const name = typeof item.name === 'string' ? item.name.toLowerCase() : '';
    const isComputer =
      Boolean(specs?.computerType) ||
      Boolean(specs?.cpu) ||
      name.includes('kompiuter') ||
      name.includes('thinkpad') ||
      name.includes('serveris') ||
      name.includes('ipad') ||
      name.includes('planšet');
    return {
      category: isComputer ? 'Kompiuteriai' : 'Kita IT įranga',
      migrated: true,
    };
  }
  return { category: rawCat as ItemCategory, migrated: false };
}

function validateAndMigrateSpecs(
  rawSpecs: unknown,
  context: string
): { ok: true; specs?: ComputerSpecs; migrated: boolean } | { ok: false; error: string } {
  if (rawSpecs === undefined) return { ok: true, specs: undefined, migrated: false };
  if (!isPlainObject(rawSpecs)) {
    return { ok: false, error: `${context}: „specs“ laukas turi būti objektas.` };
  }

  let migrated = false;
  const specs: ComputerSpecs = {};

  if (rawSpecs.computerType !== undefined) {
    if (rawSpecs.computerType === 'all_in_one') {
      specs.computerType = 'desktop';
      migrated = true;
    } else if (
      rawSpecs.computerType === 'laptop' ||
      rawSpecs.computerType === 'desktop' ||
      rawSpecs.computerType === 'server' ||
      rawSpecs.computerType === 'tablet'
    ) {
      specs.computerType = rawSpecs.computerType;
    } else {
      return {
        ok: false,
        error: `${context}: neteisingas „specs.computerType“ tipas („${String(rawSpecs.computerType)}“).`,
      };
    }
  }

  const optionalStrFields: (keyof Pick<
    ComputerSpecs,
    'cpu' | 'storage' | 'os' | 'screenSize' | 'gpu' | 'macAddress'
  >)[] = ['cpu', 'storage', 'os', 'screenSize', 'gpu', 'macAddress'];

  for (const field of optionalStrFields) {
    if (rawSpecs[field] !== undefined) {
      if (typeof rawSpecs[field] !== 'string') {
        return { ok: false, error: `${context}: „specs.${field}“ turi būti tekstas.` };
      }
      specs[field] = rawSpecs[field] as string;
    }
  }

  if (rawSpecs.ramGb !== undefined) {
    if (!isFiniteNumber(rawSpecs.ramGb) || rawSpecs.ramGb < 0) {
      return { ok: false, error: `${context}: „specs.ramGb“ turi būti neneigiamas skaičius.` };
    }
    specs.ramGb = rawSpecs.ramGb;
  }

  return { ok: true, specs, migrated };
}

function validateDefectReports(
  rawReports: unknown,
  context: string
): { ok: true; reports?: DefectReport[] } | { ok: false; error: string } {
  if (rawReports === undefined) return { ok: true, reports: undefined };
  if (!Array.isArray(rawReports)) {
    return { ok: false, error: `${context}: „defectReports“ turi būti masyvas.` };
  }
  const reports: DefectReport[] = [];
  for (let i = 0; i < rawReports.length; i++) {
    const r = rawReports[i];
    if (!isPlainObject(r)) {
      return { ok: false, error: `${context} -> defectReports[${i}]: įrašas turi būti objektas.` };
    }
    if (
      !isNonEmptyString(r.id) ||
      !isNonEmptyString(r.reportedAt) ||
      typeof r.reportedByUserId !== 'string' ||
      !isNonEmptyString(r.reportedByUserName) ||
      !isNonEmptyString(r.description)
    ) {
      return {
        ok: false,
        error: `${context} -> defectReports[${i}]: trūksta privalomų laukų (id, reportedAt, reportedByUserName, description).`,
      };
    }
    if (r.severity !== 'low' && r.severity !== 'medium' && r.severity !== 'high') {
      return { ok: false, error: `${context} -> defectReports[${i}]: neteisingas „severity“ tipas.` };
    }
    if (r.status !== 'reported' && r.status !== 'in_repair' && r.status !== 'resolved') {
      return { ok: false, error: `${context} -> defectReports[${i}]: neteisingas „status“ tipas.` };
    }
    if (
      !isOptionalString(r.photoUrl) ||
      !isOptionalString(r.repairStartedAt) ||
      !isOptionalString(r.repairStartedByUserId) ||
      !isOptionalString(r.repairStartedByUserName) ||
      !isOptionalString(r.repairNotes) ||
      !isOptionalString(r.resolvedAt) ||
      !isOptionalString(r.resolvedByUserId) ||
      !isOptionalString(r.resolvedByUserName) ||
      !isOptionalString(r.resolutionNotes)
    ) {
      return { ok: false, error: `${context} -> defectReports[${i}]: neteisingas papildomų laukų tipas.` };
    }
    reports.push(r as unknown as DefectReport);
  }
  return { ok: true, reports };
}

function validateWriteOffHistory(
  rawHistory: unknown,
  context: string
): { ok: true; history?: WriteOffHistoryEntry[] } | { ok: false; error: string } {
  if (rawHistory === undefined) return { ok: true, history: undefined };
  if (!Array.isArray(rawHistory)) {
    return { ok: false, error: `${context}: „writeOffHistory“ turi būti masyvas.` };
  }
  const history: WriteOffHistoryEntry[] = [];
  for (let i = 0; i < rawHistory.length; i++) {
    const h = rawHistory[i];
    if (!isPlainObject(h) || !isNonEmptyString(h.id)) {
      return { ok: false, error: `${context} -> writeOffHistory[${i}]: netinkamas įrašas.` };
    }
    if (
      !isOptionalString(h.actId) ||
      !isOptionalString(h.actNumber) ||
      !isOptionalString(h.writtenOffDate) ||
      (h.writtenOffYear !== undefined && !isFiniteNumber(h.writtenOffYear)) ||
      !isOptionalString(h.writeOffReason) ||
      !isOptionalString(h.restoredAt) ||
      !isOptionalString(h.restoredByUserId) ||
      !isOptionalString(h.restoredByUserName) ||
      !isOptionalString(h.restorationReason) ||
      (h.conditionOnRestore !== undefined &&
        !VALID_CONDITIONS.has(h.conditionOnRestore as ItemCondition))
    ) {
      return {
        ok: false,
        error: `${context} -> writeOffHistory[${i}]: neteisingas laukų tipas.`,
      };
    }
    history.push(h as unknown as WriteOffHistoryEntry);
  }
  return { ok: true, history };
}

function validateWriteOffRejectionHistory(
  rawRejections: unknown,
  context: string
): { ok: true; rejections?: WriteOffRejectionEntry[] } | { ok: false; error: string } {
  if (rawRejections === undefined) return { ok: true, rejections: undefined };
  if (!Array.isArray(rawRejections)) {
    return { ok: false, error: `${context}: „writeOffRejectionHistory“ turi būti masyvas.` };
  }
  const rejections: WriteOffRejectionEntry[] = [];
  for (let i = 0; i < rawRejections.length; i++) {
    const r = rawRejections[i];
    if (
      !isPlainObject(r) ||
      !isNonEmptyString(r.id) ||
      !isNonEmptyString(r.actId) ||
      !isNonEmptyString(r.actNumber) ||
      !isNonEmptyString(r.rejectedAt) ||
      typeof r.reason !== 'string'
    ) {
      return {
        ok: false,
        error: `${context} -> writeOffRejectionHistory[${i}]: trūksta privalomų laukų.`,
      };
    }
    if (!isOptionalString(r.rejectedByUserId) || !isOptionalString(r.rejectedByUserName)) {
      return {
        ok: false,
        error: `${context} -> writeOffRejectionHistory[${i}]: neteisingas papildomų laukų tipas.`,
      };
    }
    rejections.push(r as unknown as WriteOffRejectionEntry);
  }
  return { ok: true, rejections };
}

function validateActRejectedItems(
  rawRejected: unknown,
  context: string
): { ok: true; rejectedItems?: WriteOffRejectedItemRecord[] } | { ok: false; error: string } {
  if (rawRejected === undefined) return { ok: true, rejectedItems: undefined };
  if (!Array.isArray(rawRejected)) {
    return { ok: false, error: `${context}: „rejectedItems“ turi būti masyvas.` };
  }
  const list: WriteOffRejectedItemRecord[] = [];
  for (let i = 0; i < rawRejected.length; i++) {
    const ri = rawRejected[i];
    if (
      !isPlainObject(ri) ||
      !isNonEmptyString(ri.itemId) ||
      !isNonEmptyString(ri.name) ||
      !isNonEmptyString(ri.inventoryNumber) ||
      !isFiniteNumber(ri.price) ||
      !isNonEmptyString(ri.rejectedAt) ||
      typeof ri.rejectionReason !== 'string'
    ) {
      return {
        ok: false,
        error: `${context} -> rejectedItems[${i}]: neteisingi atmesto įrašo laukai.`,
      };
    }
    if (
      (ri.residualPrice !== undefined && !isFiniteNumber(ri.residualPrice)) ||
      !isOptionalString(ri.submissionReason) ||
      !isOptionalString(ri.rejectedByUserId) ||
      !isOptionalString(ri.rejectedByUserName)
    ) {
      return {
        ok: false,
        error: `${context} -> rejectedItems[${i}]: neteisingas papildomų laukų tipas.`,
      };
    }
    list.push(ri as unknown as WriteOffRejectedItemRecord);
  }
  return { ok: true, rejectedItems: list };
}

function validateOrganizationSettingsValue(
  rawOrg: unknown,
  context: string
): { ok: true; value?: OrganizationSettings } | { ok: false; error: string } {
  if (rawOrg === undefined) return { ok: true, value: undefined };
  if (!isPlainObject(rawOrg)) {
    return { ok: false, error: `${context}: įstaigos rekvizitai turi būti objektas.` };
  }
  if (
    !isNonEmptyString(rawOrg.name) ||
    !isNonEmptyString(rawOrg.code) ||
    !isNonEmptyString(rawOrg.address) ||
    !isNonEmptyString(rawOrg.directorTitle) ||
    !isOptionalString(rawOrg.directorName)
  ) {
    return {
      ok: false,
      error: `${context}: trūksta privalomų įstaigos rekvizitų laukų (name, code, address, directorTitle).`,
    };
  }
  const directorName = typeof rawOrg.directorName === 'string' ? rawOrg.directorName.trim() : '';
  return {
    ok: true,
    value: {
      name: rawOrg.name.trim(),
      code: rawOrg.code.trim(),
      address: rawOrg.address.trim(),
      directorTitle: rawOrg.directorTitle.trim(),
      ...(directorName ? { directorName } : {}),
    },
  };
}

/**
 * Pilnai patikrina ir (jei tai 1.0.0 versija) saugiai migruoja duomenų bazės objektą į 1.1.0.
 * Atmeta pažeistas struktūras, nepalaikomas versijas, dubliuotus ID/inventorinius numerius
 * ir sulaužytus tarpusavio ryšius su suprantamu lietuvišku paaiškinimu.
 */
export function validateAndMigrateDatabase(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: 'Netinkamas JSON formatas: duomenų bazės šaknis turi būti JSON objektas.',
    };
  }

  // 1. Versijos tikrinimas
  if (typeof raw.version !== 'string') {
    return {
      ok: false,
      error: 'Trūksta duomenų bazės versijos („version“ lauko). Importas atmestas.',
    };
  }
  if (!SUPPORTED_DB_VERSIONS.includes(raw.version as (typeof SUPPORTED_DB_VERSIONS)[number])) {
    return {
      ok: false,
      error: `Nepalaikoma duomenų bazės versija „${raw.version}“. Palaikomos versijos: ${SUPPORTED_DB_VERSIONS.join(', ')}.`,
    };
  }

  let migrated = raw.version !== CURRENT_DB_VERSION;
  const warnings: string[] = [];

  if (raw.exportedAt !== undefined && typeof raw.exportedAt !== 'string') {
    return { ok: false, error: 'Laukas „exportedAt“ turi būti datos tekstas.' };
  }
  const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString();

  let revision = 1;
  if (raw.revision !== undefined) {
    if (!isFiniteNumber(raw.revision) || !Number.isInteger(raw.revision) || raw.revision < 0) {
      return {
        ok: false,
        error: 'Laukas „revision“ turi būti neneigiamas sveikasis skaičius.',
      };
    }
    revision = raw.revision === 0 ? 1 : raw.revision;
  } else {
    migrated = true;
  }

  // 2. Privalomos kolekcijos
  const requiredArrays = [
    ['departments', 'skyrių sąrašas'],
    ['rooms', 'kabinetų sąrašas'],
    ['users', 'naudotojų sąrašas'],
    ['items', 'inventoriaus sąrašas'],
    ['movements', 'perkėlimų žurnalas'],
    ['writeOffActs', 'nurašymo aktai'],
    ['auditSessions', 'inventorizacijos sesijos'],
  ] as const;

  for (const [key, ltLabel] of requiredArrays) {
    if (!Array.isArray(raw[key])) {
      return {
        ok: false,
        error: `Trūksta arba netinkamo formato „${key}“ (${ltLabel}) – tikimasi JSON masyvo.`,
      };
    }
  }

  // 3. Skyrių tikrinimas
  const rawDepartments = raw.departments as unknown[];
  const departments: Department[] = [];
  const departmentIds = new Set<string>();

  for (let i = 0; i < rawDepartments.length; i++) {
    const d = rawDepartments[i];
    const ctx = `Skyrius #${i + 1}`;
    if (!isPlainObject(d)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (!isNonEmptyString(d.id) || !isNonEmptyString(d.name) || !isNonEmptyString(d.code)) {
      return { ok: false, error: `${ctx}: trūksta privalomų laukų (id, name, code).` };
    }
    if (departmentIds.has(d.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis skyriaus ID „${d.id}“.` };
    }
    if (
      !isOptionalString(d.building) ||
      !isOptionalString(d.description) ||
      !isOptionalString(d.managerId) ||
      !isOptionalBoolean(d.isArchived)
    ) {
      return { ok: false, error: `${ctx} („${d.name}“): neteisingas papildomų laukų tipas.` };
    }
    departmentIds.add(d.id);
    departments.push({
      id: d.id,
      name: d.name.trim(),
      code: d.code.trim(),
      building: typeof d.building === 'string' ? d.building : '',
      description: typeof d.description === 'string' ? d.description : '',
      ...(d.managerId ? { managerId: d.managerId } : {}),
      ...(d.isArchived !== undefined ? { isArchived: d.isArchived } : {}),
    });
  }

  // 4. Kabinetų tikrinimas ir ryšys su skyriais
  const rawRooms = raw.rooms as unknown[];
  const rooms: Room[] = [];
  const roomIds = new Set<string>();
  const roomDeptMap = new Map<string, string>();

  for (let i = 0; i < rawRooms.length; i++) {
    const r = rawRooms[i];
    const ctx = `Kabinetas #${i + 1}`;
    if (!isPlainObject(r)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (!isNonEmptyString(r.id) || !isNonEmptyString(r.departmentId) || !isNonEmptyString(r.name)) {
      return { ok: false, error: `${ctx}: trūksta privalomų laukų (id, departmentId, name).` };
    }
    if (roomIds.has(r.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis kabineto ID „${r.id}“.` };
    }
    if (!departmentIds.has(r.departmentId)) {
      return {
        ok: false,
        error: `${ctx} („${r.name}“): nurodytas neegzistuojantis skyrius „${r.departmentId}“.`,
      };
    }
    if (!isFiniteNumber(r.floor)) {
      return { ok: false, error: `${ctx} („${r.name}“): aukštas („floor“) turi būti skaičius.` };
    }
    if (
      !isOptionalString(r.number) ||
      !isOptionalString(r.defaultResponsiblePersonId) ||
      !isOptionalString(r.notes) ||
      !isOptionalBoolean(r.isArchived)
    ) {
      return { ok: false, error: `${ctx} („${r.name}“): neteisingas laukų tipas.` };
    }
    roomIds.add(r.id);
    roomDeptMap.set(r.id, r.departmentId);
    rooms.push({
      id: r.id,
      departmentId: r.departmentId,
      name: r.name.trim(),
      floor: r.floor,
      ...(r.number !== undefined ? { number: r.number } : {}),
      ...(r.defaultResponsiblePersonId ? { defaultResponsiblePersonId: r.defaultResponsiblePersonId } : {}),
      ...(r.notes !== undefined ? { notes: r.notes } : {}),
      ...(r.isArchived !== undefined ? { isArchived: r.isArchived } : {}),
    });
  }

  // 5. Naudotojų tikrinimas ir ryšiai
  const rawUsers = raw.users as unknown[];
  const users: User[] = [];
  const userIds = new Set<string>();

  for (let i = 0; i < rawUsers.length; i++) {
    const u = rawUsers[i];
    const ctx = `Naudotojas #${i + 1}`;
    if (!isPlainObject(u)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (!isNonEmptyString(u.id) || !isNonEmptyString(u.fullName) || !isNonEmptyString(u.email)) {
      return { ok: false, error: `${ctx}: trūksta privalomų laukų (id, fullName, email).` };
    }
    if (userIds.has(u.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis naudotojo ID „${u.id}“.` };
    }
    if (typeof u.role !== 'string' || !VALID_ROLES.has(u.role as UserRole)) {
      return {
        ok: false,
        error: `${ctx} („${u.fullName}“): neteisinga rolė „${String(u.role)}“.`,
      };
    }
    if (!isOptionalString(u.roleTitle)) {
      return { ok: false, error: `${ctx} („${u.fullName}“): „roleTitle“ turi būti tekstas.` };
    }
    if (u.departmentId !== undefined && u.departmentId !== '') {
      if (typeof u.departmentId !== 'string' || !departmentIds.has(u.departmentId)) {
        return {
          ok: false,
          error: `${ctx} („${u.fullName}“): nurodytas neegzistuojantis skyrius „${String(u.departmentId)}“.`,
        };
      }
    }
    if (u.assignedRoomId !== undefined && u.assignedRoomId !== '') {
      if (typeof u.assignedRoomId !== 'string' || !roomIds.has(u.assignedRoomId)) {
        return {
          ok: false,
          error: `${ctx} („${u.fullName}“): nurodytas neegzistuojantis kabinetas „${String(u.assignedRoomId)}“.`,
        };
      }
    }
    if (u.assignedRoomIds !== undefined) {
      if (!isStringArray(u.assignedRoomIds)) {
        return { ok: false, error: `${ctx} („${u.fullName}“): „assignedRoomIds“ turi būti tekstų masyvas.` };
      }
      for (const rId of u.assignedRoomIds) {
        if (rId && !roomIds.has(rId)) {
          return {
            ok: false,
            error: `${ctx} („${u.fullName}“): priskirtas neegzistuojantis kabinetas „${rId}“.`,
          };
        }
      }
    }
    if (
      !isOptionalString(u.phone) ||
      !isOptionalString(u.avatarUrl) ||
      !isOptionalString(u.pinCode) ||
      !isOptionalString(u.allowedGmail) ||
      !isOptionalString(u.lastLoginAt) ||
      !isOptionalBoolean(u.isActive) ||
      !isOptionalBoolean(u.isArchived)
    ) {
      return { ok: false, error: `${ctx} („${u.fullName}“): neteisingas papildomų laukų tipas.` };
    }

    userIds.add(u.id);
    users.push({
      ...(u as unknown as User),
      roleTitle: typeof u.roleTitle === 'string' ? u.roleTitle : '',
    });
  }

  // Tikriname skyrių ir kabinetų nuorodas į naudotojus
  for (const dept of departments) {
    if (dept.managerId && !userIds.has(dept.managerId)) {
      return {
        ok: false,
        error: `Skyrius „${dept.name}“ nurodo neegzistuojantį vadovą „${dept.managerId}“.`,
      };
    }
  }
  for (const room of rooms) {
    if (room.defaultResponsiblePersonId && !userIds.has(room.defaultResponsiblePersonId)) {
      return {
        ok: false,
        error: `Kabinetas „${room.name}“ nurodo neegzistuojantį atsakingą asmenį „${room.defaultResponsiblePersonId}“.`,
      };
    }
  }

  // 6. Inventoriaus vienetų tikrinimas, unikalumas ir ryšiai
  const rawItems = raw.items as unknown[];
  const items: InventoryItem[] = [];
  const itemIds = new Set<string>();
  const inventoryNumbers = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    const ctx = `Turtas #${i + 1}`;
    if (!isPlainObject(it)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (
      !isNonEmptyString(it.id) ||
      !isNonEmptyString(it.inventoryNumber) ||
      !isNonEmptyString(it.name) ||
      !isNonEmptyString(it.departmentId) ||
      !isNonEmptyString(it.roomId) ||
      !isNonEmptyString(it.responsibleUserId) ||
      !isNonEmptyString(it.acquisitionDate)
    ) {
      return {
        ok: false,
        error: `${ctx}: trūksta privalomų laukų (id, inventoryNumber, name, departmentId, roomId, responsibleUserId, acquisitionDate).`,
      };
    }
    if (itemIds.has(it.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis turto ID „${it.id}“.` };
    }
    const normalizedInv = it.inventoryNumber.trim().toUpperCase();
    if (inventoryNumbers.has(normalizedInv)) {
      return {
        ok: false,
        error: `${ctx}: pasikartojantis inventorinis numeris „${it.inventoryNumber}“.`,
      };
    }

    if (!isValidIsoDateString(it.acquisitionDate.trim())) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): netinkama įsigijimo data „${it.acquisitionDate}“ (tikimasi YYYY-MM-DD).`,
      };
    }

    if (!isFiniteNumber(it.purchasePrice) || it.purchasePrice < 0) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): „purchasePrice“ turi būti neneigiamas skaičius.`,
      };
    }
    if (it.residualValue !== undefined) {
      if (!isFiniteNumber(it.residualValue) || it.residualValue < 0) {
        return {
          ok: false,
          error: `${ctx} ([${it.inventoryNumber}]): „residualValue“ turi būti neneigiamas skaičius.`,
        };
      }
      if (it.residualValue > it.purchasePrice) {
        return {
          ok: false,
          error: `${ctx} ([${it.inventoryNumber}]): likutinė vertė (${it.residualValue} €) negali viršyti įsigijimo kainos (${it.purchasePrice} €).`,
        };
      }
    }

    if (typeof it.status !== 'string' || !VALID_STATUSES.has(it.status as ItemStatus)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): neteisinga būsena „${String(it.status)}“.`,
      };
    }
    if (typeof it.condition !== 'string' || !VALID_CONDITIONS.has(it.condition as ItemCondition)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): neteisinga būklė „${String(it.condition)}“.`,
      };
    }

    const { category, migrated: catMigrated } = migrateLegacyCategory(it);
    if (!VALID_CATEGORIES.has(category)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): neteisinga kategorija „${String(it.category)}“.`,
      };
    }
    if (catMigrated) migrated = true;

    let assetClass: AssetClass;
    if (it.assetClass !== undefined) {
      if (typeof it.assetClass !== 'string' || !VALID_ASSET_CLASSES.has(it.assetClass as AssetClass)) {
        return {
          ok: false,
          error: `${ctx} ([${it.inventoryNumber}]): neteisinga turto klasė „${String(it.assetClass)}“.`,
        };
      }
      assetClass = it.assetClass as AssetClass;
    } else {
      assetClass = it.purchasePrice >= 750 ? 'long_term' : 'short_term';
      migrated = true;
    }

    let fundingSource: FundingSource;
    if (it.fundingSource !== undefined) {
      if (
        typeof it.fundingSource !== 'string' ||
        !VALID_FUNDING_SOURCES.has(it.fundingSource as FundingSource)
      ) {
        return {
          ok: false,
          error: `${ctx} ([${it.inventoryNumber}]): neteisingas finansavimo šaltinis „${String(it.fundingSource)}“.`,
        };
      }
      fundingSource = it.fundingSource as FundingSource;
    } else {
      fundingSource = 'school';
      migrated = true;
    }

    // Ryšiai
    if (!departmentIds.has(it.departmentId)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): nurodytas neegzistuojantis skyrius „${it.departmentId}“.`,
      };
    }
    if (!roomIds.has(it.roomId)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): nurodytas neegzistuojantis kabinetas „${it.roomId}“.`,
      };
    }
    if (roomDeptMap.get(it.roomId) !== it.departmentId) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): kabinetas „${it.roomId}“ nepriklauso skyriui „${it.departmentId}“.`,
      };
    }
    if (!userIds.has(it.responsibleUserId)) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): nurodytas neegzistuojantis atsakingas asmuo „${it.responsibleUserId}“.`,
      };
    }

    if (
      !isOptionalString(it.serialNumber) ||
      !isOptionalString(it.notes) ||
      !isOptionalString(it.lastAuditDate) ||
      !isOptionalString(it.barcode) ||
      !isOptionalString(it.photoUrl) ||
      !isOptionalString(it.writtenOffDate) ||
      !isOptionalString(it.writeOffActNumber) ||
      !isOptionalString(it.writeOffReason) ||
      !isOptionalString(it.writeOffActId) ||
      !isOptionalString(it.activeDefectNote) ||
      (it.writtenOffYear !== undefined && !isFiniteNumber(it.writtenOffYear))
    ) {
      return {
        ok: false,
        error: `${ctx} ([${it.inventoryNumber}]): neteisingas vieno iš papildomų laukų tipas.`,
      };
    }

    const specsCheck = validateAndMigrateSpecs(it.specs, `${ctx} ([${it.inventoryNumber}])`);
    if (!specsCheck.ok) return specsCheck;
    if (specsCheck.migrated) migrated = true;

    const defectCheck = validateDefectReports(it.defectReports, `${ctx} ([${it.inventoryNumber}])`);
    if (!defectCheck.ok) return defectCheck;

    const historyCheck = validateWriteOffHistory(
      it.writeOffHistory,
      `${ctx} ([${it.inventoryNumber}])`
    );
    if (!historyCheck.ok) return historyCheck;

    const rejCheck = validateWriteOffRejectionHistory(
      it.writeOffRejectionHistory,
      `${ctx} ([${it.inventoryNumber}])`
    );
    if (!rejCheck.ok) return rejCheck;

    itemIds.add(it.id);
    inventoryNumbers.add(normalizedInv);

    items.push({
      ...(it as unknown as InventoryItem),
      inventoryNumber: it.inventoryNumber.trim(),
      name: it.name.trim(),
      category,
      assetClass,
      fundingSource,
      ...(specsCheck.specs ? { specs: specsCheck.specs } : {}),
      ...(defectCheck.reports ? { defectReports: defectCheck.reports } : {}),
      ...(historyCheck.history ? { writeOffHistory: historyCheck.history } : {}),
      ...(rejCheck.rejections ? { writeOffRejectionHistory: rejCheck.rejections } : {}),
    });
  }

  // 7. Perkėlimo įrašų tikrinimas
  const rawMovements = raw.movements as unknown[];
  const movements: MovementRecord[] = [];
  const movementIds = new Set<string>();

  for (let i = 0; i < rawMovements.length; i++) {
    const m = rawMovements[i];
    const ctx = `Perkėlimas #${i + 1}`;
    if (!isPlainObject(m)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    const reqFields = [
      'id',
      'itemId',
      'itemName',
      'inventoryNumber',
      'fromDepartmentId',
      'fromRoomId',
      'toDepartmentId',
      'toRoomId',
      'fromUserId',
      'toUserId',
      'date',
      'reason',
      'actNumber',
    ];
    for (const f of reqFields) {
      if (typeof m[f] !== 'string') {
        return { ok: false, error: `${ctx}: laukas „${f}“ turi būti tekstas.` };
      }
    }
    if (!isNonEmptyString(m.id)) {
      return { ok: false, error: `${ctx}: trūksta įrašo ID.` };
    }
    if (movementIds.has(m.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis perkėlimo ID „${m.id}“.` };
    }
    const optSnapshotFields = [
      'fromDepartmentName',
      'fromRoomName',
      'fromUserName',
      'toDepartmentName',
      'toRoomName',
      'toUserName',
    ] as const;
    for (const sf of optSnapshotFields) {
      if (!isOptionalString(m[sf])) {
        return { ok: false, error: `${ctx}: laukas „${sf}“ turi būti tekstas.` };
      }
    }
    movementIds.add(m.id);
    movements.push(m as unknown as MovementRecord);
  }

  // 8. Nurašymo aktų tikrinimas
  const rawActs = raw.writeOffActs as unknown[];
  const writeOffActs: WriteOffAct[] = [];
  const actIds = new Set<string>();

  for (let i = 0; i < rawActs.length; i++) {
    const a = rawActs[i];
    const ctx = `Nurašymo aktas #${i + 1}`;
    if (!isPlainObject(a)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (
      !isNonEmptyString(a.id) ||
      !isNonEmptyString(a.actNumber) ||
      !isNonEmptyString(a.date) ||
      !isNonEmptyString(a.committeeChair) ||
      !isNonEmptyString(a.reasonCategory)
    ) {
      return {
        ok: false,
        error: `${ctx}: trūksta privalomų laukų (id, actNumber, date, committeeChair, reasonCategory).`,
      };
    }
    if (actIds.has(a.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis akto ID „${a.id}“.` };
    }
    if (a.status !== 'draft' && a.status !== 'approved' && a.status !== 'cancelled') {
      return { ok: false, error: `${ctx}: neteisinga būsena „${String(a.status)}“.` };
    }
    if (!isStringArray(a.committeeMembers)) {
      return { ok: false, error: `${ctx}: „committeeMembers“ turi būti tekstų masyvas.` };
    }
    if (!Array.isArray(a.items)) {
      return { ok: false, error: `${ctx}: „items“ turi būti masyvas.` };
    }
    const actItems: WriteOffActItem[] = [];
    for (let j = 0; j < a.items.length; j++) {
      const ai = a.items[j];
      if (!isPlainObject(ai)) {
        return { ok: false, error: `${ctx} -> items[${j}]: įrašas turi būti objektas.` };
      }
      if (
        !isNonEmptyString(ai.itemId) ||
        !isNonEmptyString(ai.name) ||
        !isNonEmptyString(ai.inventoryNumber) ||
        !isFiniteNumber(ai.price) ||
        !isFiniteNumber(ai.residualPrice) ||
        typeof ai.reason !== 'string'
      ) {
        return {
          ok: false,
          error: `${ctx} -> items[${j}]: neteisingi nurašomo daikto laukai.`,
        };
      }
      actItems.push(ai as unknown as WriteOffActItem);
    }
    const rejectedCheck = validateActRejectedItems(a.rejectedItems, ctx);
    if (!rejectedCheck.ok) return rejectedCheck;

    if (
      (a.actYear !== undefined && !isFiniteNumber(a.actYear)) ||
      !isOptionalString(a.notes) ||
      !isOptionalString(a.approvedDate) ||
      !isOptionalString(a.approvedByUserId) ||
      !isOptionalString(a.approvedByUserName)
    ) {
      return { ok: false, error: `${ctx}: neteisingas papildomų laukų tipas.` };
    }

    const orgSnapCheck = validateOrganizationSettingsValue(
      a.organizationSnapshot,
      `${ctx} -> organizationSnapshot`
    );
    if (!orgSnapCheck.ok) return orgSnapCheck;

    actIds.add(a.id);
    writeOffActs.push({
      ...(a as unknown as WriteOffAct),
      items: actItems,
      ...(rejectedCheck.rejectedItems ? { rejectedItems: rejectedCheck.rejectedItems } : {}),
      ...(orgSnapCheck.value ? { organizationSnapshot: orgSnapCheck.value } : {}),
    });
  }

  // 9. Inventorizacijos sesijų tikrinimas
  const rawSessions = raw.auditSessions as unknown[];
  const auditSessions: AuditSession[] = [];
  const sessionIds = new Set<string>();

  for (let i = 0; i < rawSessions.length; i++) {
    const s = rawSessions[i];
    const ctx = `Inventorizacijos sesija #${i + 1}`;
    if (!isPlainObject(s)) {
      return { ok: false, error: `${ctx}: įrašas turi būti objektas.` };
    }
    if (
      !isNonEmptyString(s.id) ||
      !isFiniteNumber(s.year) ||
      !isNonEmptyString(s.title) ||
      !isNonEmptyString(s.startDate)
    ) {
      return { ok: false, error: `${ctx}: trūksta privalomų laukų (id, year, title, startDate).` };
    }
    if (sessionIds.has(s.id)) {
      return { ok: false, error: `${ctx}: pasikartojantis sesijos ID „${s.id}“.` };
    }
    if (s.status !== 'in_progress' && s.status !== 'completed') {
      return { ok: false, error: `${ctx}: neteisinga būsena „${String(s.status)}“.` };
    }
    if (
      !isStringArray(s.scannedItemIds) ||
      !isStringArray(s.missingItemIds) ||
      !isStringArray(s.relocatedItemIds) ||
      !isStringArray(s.committeeMembers)
    ) {
      return {
        ok: false,
        error: `${ctx}: sąrašai (scannedItemIds, missingItemIds, relocatedItemIds, committeeMembers) turi būti tekstų masyvai.`,
      };
    }
    if (s.departmentId !== undefined && s.departmentId !== null && s.departmentId !== '') {
      if (typeof s.departmentId !== 'string') {
        return {
          ok: false,
          error: `${ctx}: neteisingas „departmentId“ formatas.`,
        };
      }
      // Užbaigtų istorinių sesijų skyrius galėjo būti vėliau perkeltas/ištrintas; vykdomoms sesijoms skyrius privalo egzistuoti
      if (s.status !== 'completed' && !departmentIds.has(s.departmentId)) {
        return {
          ok: false,
          error: `${ctx}: nurodytas neegzistuojantis skyrius „${String(s.departmentId)}“.`,
        };
      }
    }

    if (s.snapshotItems !== undefined) {
      if (!Array.isArray(s.snapshotItems)) {
        return { ok: false, error: `${ctx}: „snapshotItems“ turi būti masyvas.` };
      }
      for (let j = 0; j < s.snapshotItems.length; j++) {
        const snap = s.snapshotItems[j];
        if (
          !isPlainObject(snap) ||
          !isNonEmptyString(snap.itemId) ||
          !isNonEmptyString(snap.inventoryNumber) ||
          !isNonEmptyString(snap.name)
        ) {
          return {
            ok: false,
            error: `${ctx} -> snapshotItems[${j}]: trūksta privalomų fiksuoto turto laukų.`,
          };
        }
      }
    }

    if (s.checkRecords !== undefined) {
      if (!isPlainObject(s.checkRecords)) {
        return { ok: false, error: `${ctx}: „checkRecords“ turi būti objektas.` };
      }
      for (const [key, rec] of Object.entries(s.checkRecords)) {
        if (
          !isPlainObject(rec) ||
          !isNonEmptyString(rec.itemId) ||
          (rec.outcome !== 'found' && rec.outcome !== 'found_elsewhere') ||
          !isNonEmptyString(rec.checkedAt) ||
          !isNonEmptyString(rec.actualRoomId)
        ) {
          return {
            ok: false,
            error: `${ctx} -> checkRecords[${key}]: neteisinga patikrinimo įrašo struktūra.`,
          };
        }
        if (rec.isAdditionalFinding !== undefined && typeof rec.isAdditionalFinding !== 'boolean') {
          return {
            ok: false,
            error: `${ctx} -> checkRecords[${key}]: „isAdditionalFinding“ turi būti loginė reikšmė.`,
          };
        }
        if (
          rec.excludedStatusException !== undefined &&
          typeof rec.excludedStatusException !== 'boolean'
        ) {
          return {
            ok: false,
            error: `${ctx} -> checkRecords[${key}]: „excludedStatusException“ turi būti loginė reikšmė.`,
          };
        }
        if (rec.itemSnapshot !== undefined) {
          const snap = rec.itemSnapshot;
          if (
            !isPlainObject(snap) ||
            !isNonEmptyString(snap.inventoryNumber) ||
            !isNonEmptyString(snap.name) ||
            !isNonEmptyString(snap.expectedDepartmentName) ||
            !isNonEmptyString(snap.responsibleUserName) ||
            typeof snap.purchasePrice !== 'number' ||
            !Number.isFinite(snap.purchasePrice)
          ) {
            return {
              ok: false,
              error: `${ctx} -> checkRecords[${key}].itemSnapshot: neteisingi momentinių duomenų laukai.`,
            };
          }
        }
      }
    }

    if (s.completionSummary !== undefined) {
      if (
        !isPlainObject(s.completionSummary) ||
        typeof s.completionSummary.totalExpected !== 'number' ||
        typeof s.completionSummary.foundInPlaceCount !== 'number' ||
        typeof s.completionSummary.foundElsewhereCount !== 'number' ||
        typeof s.completionSummary.missingCount !== 'number'
      ) {
        return {
          ok: false,
          error: `${ctx}: neteisinga „completionSummary“ struktūra.`,
        };
      }
    }

    const sessionOrgCheck = validateOrganizationSettingsValue(
      s.organizationSnapshot,
      `${ctx} -> organizationSnapshot`
    );
    if (!sessionOrgCheck.ok) return sessionOrgCheck;

    sessionIds.add(s.id);
    auditSessions.push({
      ...(s as unknown as AuditSession),
      ...(sessionOrgCheck.value ? { organizationSnapshot: sessionOrgCheck.value } : {}),
    });
  }

  // 10. AuthSettings tikrinimas (jei yra)
  let authSettings: AuthSettings | undefined;
  if (raw.authSettings !== undefined) {
    if (!isPlainObject(raw.authSettings)) {
      return { ok: false, error: 'Laukas „authSettings“ turi būti objektas.' };
    }
    const as = raw.authSettings;
    if (
      typeof as.allowOnlyWhitelistedEmails !== 'boolean' ||
      typeof as.allowedSchoolDomain !== 'string' ||
      !isStringArray(as.whitelistedEmails) ||
      typeof as.requirePinForAdmin !== 'boolean' ||
      typeof as.adminPin !== 'string'
    ) {
      return { ok: false, error: 'Netinkama „authSettings“ laukų struktūra arba tipai.' };
    }
    authSettings = as as unknown as AuthSettings;
  }

  // 10b. Įstaigos rekvizitai (jei trūksta senoje kopijoje – priskiriami numatytieji)
  const orgCheck = validateOrganizationSettingsValue(raw.organizationSettings, 'organizationSettings');
  if (!orgCheck.ok) {
    return orgCheck;
  }
  const organizationSettings =
    orgCheck.value ?? cloneOrganizationSettings(DEFAULT_ORGANIZATION_SETTINGS);

  // 11. Nuotraukų paketas atsarginėje kopijoje (jei yra)
  let photos: Record<string, string> | undefined;
  if (raw.photos !== undefined) {
    if (!isPlainObject(raw.photos)) {
      return { ok: false, error: 'Laukas „photos“ turi būti nuotraukų žodynas.' };
    }
    photos = {};
    for (const [key, val] of Object.entries(raw.photos)) {
      if (typeof val !== 'string' || !val.startsWith('data:image/')) {
        return { ok: false, error: `Nuotrauka „${key}“ turi būti tinkamo base64 paveikslėlio formato.` };
      }
      photos[key] = val;
    }
  }

  // 12. Nurašymo aktų ir daiktų tarpusavio suderinamumo patikra (įspėjimai be dirbtinių istorinių duomenų išgalvojimo)
  const integrityIssues = analyzeWriteOffIntegrity(items, writeOffActs);
  for (const issue of integrityIssues) {
    warnings.push(issue.message);
  }

  return {
    ok: true,
    migrated,
    warnings,
    data: {
      version: CURRENT_DB_VERSION,
      revision,
      exportedAt,
      departments,
      rooms,
      users,
      items,
      movements,
      writeOffActs,
      auditSessions,
      ...(authSettings ? { authSettings } : {}),
      ...(organizationSettings ? { organizationSettings } : {}),
      ...(photos ? { photos } : {}),
    },
  };
}
