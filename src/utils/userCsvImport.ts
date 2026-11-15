import {
  Department,
  Room,
  User,
  formatRoomName,
  getUserAssignedRoomIds,
} from '../types/inventory';

export interface CsvParseResult {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

export interface RoomResolutionIssue {
  tokenIndex: number;
  rawToken: string;
  reason: string;
  candidates: Room[];
}

export interface CsvFieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

export type CsvRowCategory = 'create' | 'update' | 'needs_resolution' | 'skip';

export interface AnalyzedCsvUserRow {
  rowNumber: number; // 1-based line/record number (including header = 1, first data row = 2)
  category: CsvRowCategory;
  raw: {
    fullName: string;
    email: string;
    allowedGmail: string;
    roleTitle: string;
    department: string;
    rooms: string;
    phone: string;
  };
  existingUser?: User;
  proposedUser?: User;
  resolvedDepartmentId?: string;
  resolvedRoomIds: string[];
  unresolvedRooms: RoomResolutionIssue[];
  departmentError?: string;
  skipReason?: string;
  changedFields: CsvFieldDiff[];
  preservesArchivedStatus: boolean;
}

export interface CsvImportAnalysis {
  ok: boolean;
  error?: string;
  delimiter: string;
  ignoredAccessColumns: string[];
  presentColumns: string[];
  createRows: AnalyzedCsvUserRow[];
  updateRows: AnalyzedCsvUserRow[];
  resolutionRows: AnalyzedCsvUserRow[];
  skipRows: AnalyzedCsvUserRow[];
  allRows: AnalyzedCsvUserRow[];
}

export interface UserImportResolutionSelection {
  /** Key: `${rowNumber}:${tokenIndex}` -> chosen roomId or '__NONE__' or '__SKIP_ROW__' */
  roomChoices?: Record<string, string>;
  /** Key: rowNumber -> chosen departmentId */
  departmentChoices?: Record<number, string>;
  /** Key: rowNumber -> true to skip entire ambiguous row */
  skipRowNumbers?: Set<number> | number[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[:*]+$/g, '')
    .replace(/\s+/g, ' ');
}

function detectDelimiterFromFirstLine(text: string): string {
  let inQuotes = false;
  let semicolons = 0;
  let commas = 0;
  let tabs = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      break;
    }
    if (!inQuotes) {
      if (ch === ';') semicolons++;
      else if (ch === ',') commas++;
      else if (ch === '\t') tabs++;
    }
  }

  if (semicolons >= commas && semicolons >= tabs && semicolons > 0) return ';';
  if (tabs > commas && tabs > semicolons) return '\t';
  if (commas > 0) return ',';
  return ';';
}

/**
 * Pilnas RFC-4180 CSV analizatorius: palaiko UTF-8 BOM, lietuviškas raides,
 * kabučių ekranavimą (""), skirtukus bei naujas eilutes kabutėse.
 */
export function parseCsvMatrix(rawText: string): CsvParseResult {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  if (!cleaned.trim()) {
    return { delimiter: ';', headers: [], rows: [] };
  }

  const delimiter = detectDelimiterFromFirstLine(cleaned);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && cleaned[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += ch;
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  return {
    delimiter,
    headers: rows[0],
    rows: rows.slice(1),
  };
}

type CanonicalColumnKey =
  | 'fullName'
  | 'email'
  | 'allowedGmail'
  | 'roleTitle'
  | 'department'
  | 'rooms'
  | 'phone'
  | 'ignoredRole'
  | 'ignoredPin';

const HEADER_ALIASES: Record<CanonicalColumnKey, string[]> = {
  fullName: [
    'vardas pavardė',
    'vardas ir pavardė',
    'vardas pavarde',
    'vardas, pavardė',
    'vardas',
    'darbuotojas',
    'darbuotojo vardas',
    'fullname',
    'full_name',
    'name',
  ],
  email: [
    'el. paštas',
    'el.pastas',
    'el pastas',
    'darbinis el. paštas',
    'darbinis el. pastas',
    'elektroninis paštas',
    'email',
    'e-mail',
  ],
  allowedGmail: [
    'leidžiamas gmail',
    'leidziamas gmail',
    'gmail',
    'asmeninis gmail',
    'allowedgmail',
    'allowed_gmail',
  ],
  roleTitle: [
    'pareigos',
    'pareigų pavadinimas',
    'pareigybe',
    'pareigybė',
    'roletitle',
    'role_title',
    'title',
  ],
  department: [
    'skyrius',
    'padalinys',
    'korpusas',
    'department',
    'department_name',
    'departmentid',
  ],
  rooms: [
    'kabinetas',
    'kabinetai',
    'kabineto numeris',
    'kabineto nr',
    'kabineto nr.',
    'patalpa',
    'patalpos',
    'room',
    'rooms',
  ],
  phone: ['telefonas', 'tel', 'tel.', 'telefono numeris', 'phone'],
  ignoredRole: ['rolė', 'role', 'vaidmuo'],
  ignoredPin: ['pin', 'pin kodas', 'pincode', 'pin_code'],
};

function mapCsvHeaders(headers: string[]): {
  colIndex: Partial<Record<CanonicalColumnKey, number>>;
  ignoredLabels: string[];
  presentLabels: string[];
} {
  const colIndex: Partial<Record<CanonicalColumnKey, number>> = {};
  const ignoredLabels: string[] = [];
  const presentLabels: string[] = [];

  headers.forEach((rawHeader, idx) => {
    const norm = normalizeHeader(rawHeader);
    for (const key of Object.keys(HEADER_ALIASES) as CanonicalColumnKey[]) {
      if (HEADER_ALIASES[key].includes(norm)) {
        if (colIndex[key] === undefined) {
          colIndex[key] = idx;
          if (key === 'ignoredRole' || key === 'ignoredPin') {
            ignoredLabels.push(rawHeader.trim());
          } else {
            presentLabels.push(rawHeader.trim());
          }
        }
        break;
      }
    }
  });

  return { colIndex, ignoredLabels, presentLabels };
}

function resolveDepartmentFromToken(
  token: string,
  departments: Department[]
): { department?: Department; error?: string } {
  const q = token.trim().toLowerCase();
  if (!q) return {};
  const activeDepts = departments.filter((d) => !d.isArchived);

  const exactActive = activeDepts.filter(
    (d) =>
      d.id.toLowerCase() === q ||
      d.code.toLowerCase() === q ||
      d.name.toLowerCase() === q
  );
  if (exactActive.length === 1) {
    return { department: exactActive[0] };
  }
  if (exactActive.length > 1) {
    return { error: `Skyrius „${token}“ atitinka kelis skyrius – pasirinkite tikslų skyrių.` };
  }

  const archivedMatch = departments.find(
    (d) =>
      d.isArchived &&
      (d.id.toLowerCase() === q || d.code.toLowerCase() === q || d.name.toLowerCase() === q)
  );
  if (archivedMatch) {
    return { error: `Skyrius „${archivedMatch.name}“ yra archyvuotas ir negali būti priskirtas.` };
  }

  return { error: `Skyrius „${token}“ nerastas.` };
}

function resolveSingleRoomToken(
  token: string,
  activeRooms: Room[],
  departmentIdFilter?: string
): { room?: Room; issue?: Omit<RoomResolutionIssue, 'tokenIndex'> } {
  const q = token.trim().toLowerCase();
  const pool = departmentIdFilter
    ? activeRooms.filter((r) => r.departmentId === departmentIdFilter)
    : activeRooms;

  const exactMatches = pool.filter((r) => {
    const num = (r.number || '').trim().toLowerCase();
    const name = r.name.trim().toLowerCase();
    const formatted = formatRoomName(r, false).trim().toLowerCase();
    const formattedKab = formatRoomName(r, true).trim().toLowerCase();
    return (
      (num && num === q) ||
      name === q ||
      formatted === q ||
      formattedKab === q ||
      r.id.toLowerCase() === q
    );
  });

  if (exactMatches.length === 1) {
    return { room: exactMatches[0] };
  }

  if (exactMatches.length > 1) {
    return {
      issue: {
        rawToken: token,
        reason: `Rasti ${exactMatches.length} kabinetai su numeriu/pavadinimu „${token}“ skirtinguose skyriuose. Pasirinkite konkretų kabinetą.`,
        candidates: exactMatches,
      },
    };
  }

  if (q.length >= 2) {
    const partialMatches = pool.filter((r) => r.name.toLowerCase().includes(q));
    if (partialMatches.length === 1) {
      return { room: partialMatches[0] };
    }
    if (partialMatches.length > 1) {
      return {
        issue: {
          rawToken: token,
          reason: `Kabineto paieška „${token}“ atitinka kelis kabinetus (${partialMatches.length}). Patikslinite pasirinkimą.`,
          candidates: partialMatches,
        },
      };
    }
  }

  return {
    issue: {
      rawToken: token,
      reason: departmentIdFilter
        ? `Kabinetas „${token}“ nerastas pasirinktame skyriuje.`
        : `Kabinetas „${token}“ sistemoje nerastas.`,
      candidates: pool.length > 0 ? pool : activeRooms,
    },
  };
}

function formatRoomsForDiff(roomIds: string[], rooms: Room[]): string {
  if (roomIds.length === 0) return '—';
  return roomIds
    .map((id) => {
      const r = rooms.find((rm) => rm.id === id);
      return r ? formatRoomName(r) : id;
    })
    .join(', ');
}

function formatDepartmentForDiff(deptId: string | undefined, departments: Department[]): string {
  if (!deptId) return '—';
  return departments.find((d) => d.id === deptId)?.name || deptId;
}

function sameRoomLists(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

export function analyzeUsersCsvImport(params: {
  csvText: string;
  existingUsers: User[];
  departments: Department[];
  rooms: Room[];
}): CsvImportAnalysis {
  const { csvText, existingUsers, departments, rooms } = params;
  const parsed = parseCsvMatrix(csvText);

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return {
      ok: false,
      error: 'CSV faile turi būti antraštės eilutė ir bent vienas darbuotojo įrašas.',
      delimiter: parsed.delimiter,
      ignoredAccessColumns: [],
      presentColumns: [],
      createRows: [],
      updateRows: [],
      resolutionRows: [],
      skipRows: [],
      allRows: [],
    };
  }

  const { colIndex, ignoredLabels, presentLabels } = mapCsvHeaders(parsed.headers);
  if (colIndex.fullName === undefined || colIndex.email === undefined) {
    return {
      ok: false,
      error:
        'CSV antraštėje privalo būti stulpeliai „Vardas Pavardė“ ir „El. paštas“ (pvz., Vardas Pavardė;El. paštas;Pareigos;Skyrius;Kabinetas).',
      delimiter: parsed.delimiter,
      ignoredAccessColumns: ignoredLabels,
      presentColumns: presentLabels,
      createRows: [],
      updateRows: [],
      resolutionRows: [],
      skipRows: [],
      allRows: [],
    };
  }

  const activeRooms = rooms.filter((r) => !r.isArchived);
  const seenEmailsInCsv = new Set<string>();
  const seenGmailsInCsv = new Set<string>();
  const allRows: AnalyzedCsvUserRow[] = [];

  parsed.rows.forEach((cells, idx) => {
    const rowNumber = idx + 2;
    const getCell = (key: CanonicalColumnKey): string => {
      const col = colIndex[key];
      return col !== undefined && col < cells.length ? (cells[col] || '').trim() : '';
    };

    const raw = {
      fullName: getCell('fullName'),
      email: getCell('email'),
      allowedGmail: getCell('allowedGmail'),
      roleTitle: getCell('roleTitle'),
      department: getCell('department'),
      rooms: getCell('rooms'),
      phone: getCell('phone'),
    };

    const normalizedEmail = raw.email.toLowerCase();
    const normalizedGmail = raw.allowedGmail.toLowerCase();

    const makeSkip = (reason: string): AnalyzedCsvUserRow => ({
      rowNumber,
      category: 'skip',
      raw,
      resolvedRoomIds: [],
      unresolvedRooms: [],
      skipReason: reason,
      changedFields: [],
      preservesArchivedStatus: false,
    });

    if (!raw.fullName) {
      allRows.push(makeSkip('Trūksta darbuotojo vardo ir pavardės.'));
      return;
    }

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      allRows.push(makeSkip(`Netinkamas arba tuščias el. pašto adresas („${raw.email || 'tuščia'}“).`));
      return;
    }

    if (seenEmailsInCsv.has(normalizedEmail)) {
      allRows.push(
        makeSkip(`Pasikartojantis el. paštas „${normalizedEmail}“ šiame CSV faile (dublikatas).`)
      );
      return;
    }
    seenEmailsInCsv.add(normalizedEmail);

    if (normalizedGmail && !EMAIL_REGEX.test(normalizedGmail)) {
      allRows.push(
        makeSkip(`Netinkamas papildomo Gmail adresas („${raw.allowedGmail}“).`)
      );
      return;
    }

    if (normalizedGmail) {
      if (seenGmailsInCsv.has(normalizedGmail)) {
        allRows.push(
          makeSkip(`Pasikartojantis leidžiamas Gmail „${normalizedGmail}“ šiame CSV faile.`)
        );
        return;
      }
      seenGmailsInCsv.add(normalizedGmail);
    }

    const existingUser = existingUsers.find(
      (u) => u.email.trim().toLowerCase() === normalizedEmail
    );

    const emailCollidesOtherGmail = existingUsers.find(
      (u) =>
        u.id !== existingUser?.id &&
        u.allowedGmail &&
        u.allowedGmail.trim().toLowerCase() === normalizedEmail
    );
    if (emailCollidesOtherGmail) {
      allRows.push(
        makeSkip(
          `El. paštas „${normalizedEmail}“ jau naudojamas kaip kito darbuotojo (${emailCollidesOtherGmail.fullName}) prisijungimo Gmail.`
        )
      );
      return;
    }

    if (normalizedGmail) {
      const gmailCollision = existingUsers.find(
        (u) =>
          u.id !== existingUser?.id &&
          (u.email.trim().toLowerCase() === normalizedGmail ||
            (u.allowedGmail && u.allowedGmail.trim().toLowerCase() === normalizedGmail))
      );
      if (gmailCollision) {
        allRows.push(
          makeSkip(
            `Gmail „${normalizedGmail}“ jau priskirtas kitam darbuotojui (${gmailCollision.fullName}).`
          )
        );
        return;
      }
    }

    // Skyrius: tuščias arba nenurodytas stulpelis niekada neištrina esamo skyriaus
    let resolvedDepartmentId: string | undefined = existingUser?.departmentId;
    let departmentError: string | undefined;

    if (raw.department) {
      const deptRes = resolveDepartmentFromToken(raw.department, departments);
      if (deptRes.department) {
        resolvedDepartmentId = deptRes.department.id;
      } else {
        departmentError = deptRes.error || `Skyrius „${raw.department}“ nerastas.`;
      }
    }

    // Kabinetai: palaikomi keli kabinetai ("101, 102" arba "101 | 102"); tuščias langelis išsaugo esamus!
    const existingRoomIds = getUserAssignedRoomIds(existingUser);
    let resolvedRoomIds: string[] = [...existingRoomIds];
    const unresolvedRooms: RoomResolutionIssue[] = [];

    if (raw.rooms) {
      const roomTokens = raw.rooms
        .split(/[,|]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const nextIds: string[] = [];

      roomTokens.forEach((token, tokenIndex) => {
        const deptFilterForRoom = raw.department ? resolvedDepartmentId : undefined;
        const matchRes = resolveSingleRoomToken(token, activeRooms, deptFilterForRoom);
        if (matchRes.room) {
          if (!nextIds.includes(matchRes.room.id)) {
            nextIds.push(matchRes.room.id);
          }
        } else if (matchRes.issue) {
          unresolvedRooms.push({
            tokenIndex,
            ...matchRes.issue,
          });
        }
      });

      resolvedRoomIds = nextIds;
      // Jei skyrius nebuvo nurodytas CSV faile ir naujam ar esamam be skyriaus buvo vienareikšmiškai rastas kabinetas
      if (!raw.department && !resolvedDepartmentId && resolvedRoomIds.length > 0 && unresolvedRooms.length === 0) {
        const firstRoom = rooms.find((r) => r.id === resolvedRoomIds[0]);
        if (firstRoom) {
          resolvedDepartmentId = firstRoom.departmentId;
        }
      }
    }

    if (departmentError || unresolvedRooms.length > 0) {
      allRows.push({
        rowNumber,
        category: 'needs_resolution',
        raw,
        existingUser,
        resolvedDepartmentId,
        resolvedRoomIds,
        unresolvedRooms,
        departmentError,
        changedFields: [],
        preservesArchivedStatus: Boolean(existingUser?.isArchived),
      });
      return;
    }

    if (existingUser) {
      const nextFullName = raw.fullName || existingUser.fullName;
      const nextRoleTitle = raw.roleTitle || existingUser.roleTitle || 'Mokytojas';
      const nextPhone = raw.phone || existingUser.phone;
      const nextAllowedGmail = normalizedGmail || existingUser.allowedGmail;
      const nextDeptId = resolvedDepartmentId || existingUser.departmentId;
      const nextRoomIds = raw.rooms ? resolvedRoomIds : existingRoomIds;

      const proposedUser: User = {
        ...existingUser,
        fullName: nextFullName,
        email: existingUser.email.trim().toLowerCase(),
        roleTitle: nextRoleTitle,
        // Saugumas ir archyvo apsauga: rolė, PIN, aktyvumas ir archyvo būsena NIEKADA nekeičiami per CSV
        role: existingUser.role,
        pinCode: existingUser.pinCode,
        isActive: existingUser.isArchived ? false : existingUser.isActive,
        isArchived: existingUser.isArchived,
        ...(nextPhone ? { phone: nextPhone } : {}),
        ...(nextAllowedGmail ? { allowedGmail: nextAllowedGmail } : {}),
        ...(nextDeptId ? { departmentId: nextDeptId } : {}),
        assignedRoomId: nextRoomIds[0] || undefined,
        assignedRoomIds: nextRoomIds.length > 0 ? nextRoomIds : undefined,
      };

      const diffs: CsvFieldDiff[] = [];
      if (proposedUser.fullName !== existingUser.fullName) {
        diffs.push({
          field: 'fullName',
          label: 'Vardas Pavardė',
          before: existingUser.fullName,
          after: proposedUser.fullName,
        });
      }
      if (proposedUser.roleTitle !== existingUser.roleTitle) {
        diffs.push({
          field: 'roleTitle',
          label: 'Pareigos',
          before: existingUser.roleTitle || '—',
          after: proposedUser.roleTitle,
        });
      }
      if ((proposedUser.phone || '') !== (existingUser.phone || '')) {
        diffs.push({
          field: 'phone',
          label: 'Telefonas',
          before: existingUser.phone || '—',
          after: proposedUser.phone || '—',
        });
      }
      if ((proposedUser.allowedGmail || '') !== (existingUser.allowedGmail || '')) {
        diffs.push({
          field: 'allowedGmail',
          label: 'Leidžiamas Gmail',
          before: existingUser.allowedGmail || '—',
          after: proposedUser.allowedGmail || '—',
        });
      }
      if ((proposedUser.departmentId || '') !== (existingUser.departmentId || '')) {
        diffs.push({
          field: 'departmentId',
          label: 'Skyrius',
          before: formatDepartmentForDiff(existingUser.departmentId, departments),
          after: formatDepartmentForDiff(proposedUser.departmentId, departments),
        });
      }
      if (!sameRoomLists(nextRoomIds, existingRoomIds)) {
        diffs.push({
          field: 'assignedRoomIds',
          label: 'Kabinetai',
          before: formatRoomsForDiff(existingRoomIds, rooms),
          after: formatRoomsForDiff(nextRoomIds, rooms),
        });
      }

      allRows.push({
        rowNumber,
        category: 'update',
        raw,
        existingUser,
        proposedUser,
        resolvedDepartmentId: nextDeptId,
        resolvedRoomIds: nextRoomIds,
        unresolvedRooms: [],
        changedFields: diffs,
        preservesArchivedStatus: Boolean(existingUser.isArchived),
      });
    } else {
      const proposedUser: User = {
        id: `usr-${Date.now().toString(36)}-${rowNumber}`,
        fullName: raw.fullName,
        email: normalizedEmail,
        role: 'teacher',
        roleTitle: raw.roleTitle || 'Mokytojas',
        ...(resolvedDepartmentId ? { departmentId: resolvedDepartmentId } : {}),
        ...(resolvedRoomIds[0] ? { assignedRoomId: resolvedRoomIds[0] } : {}),
        ...(resolvedRoomIds.length > 0 ? { assignedRoomIds: resolvedRoomIds } : {}),
        ...(raw.phone ? { phone: raw.phone } : {}),
        ...(normalizedGmail ? { allowedGmail: normalizedGmail } : {}),
        isActive: true,
        isArchived: false,
      };

      allRows.push({
        rowNumber,
        category: 'create',
        raw,
        proposedUser,
        resolvedDepartmentId,
        resolvedRoomIds,
        unresolvedRooms: [],
        changedFields: [],
        preservesArchivedStatus: false,
      });
    }
  });

  return {
    ok: true,
    delimiter: parsed.delimiter,
    ignoredAccessColumns: ignoredLabels,
    presentColumns: presentLabels,
    createRows: allRows.filter((r) => r.category === 'create'),
    updateRows: allRows.filter((r) => r.category === 'update'),
    resolutionRows: allRows.filter((r) => r.category === 'needs_resolution'),
    skipRows: allRows.filter((r) => r.category === 'skip'),
    allRows,
  };
}

export function buildFinalBatchUsersFromPreview(
  analysis: CsvImportAnalysis,
  resolutions: UserImportResolutionSelection,
  rooms: Room[],
  departments: Department[]
): { ok: true; users: User[] } | { ok: false; error: string } {
  if (!analysis.ok) {
    return { ok: false, error: analysis.error || 'Netinkami CSV duomenys.' };
  }

  const skippedSet = new Set<number>(
    Array.isArray(resolutions.skipRowNumbers)
      ? resolutions.skipRowNumbers
      : Array.from(resolutions.skipRowNumbers || [])
  );

  const finalUsers: User[] = [];

  for (const row of analysis.allRows) {
    if (row.category === 'skip' || skippedSet.has(row.rowNumber)) {
      continue;
    }

    if (row.category === 'create' || row.category === 'update') {
      if (row.proposedUser) {
        finalUsers.push(row.proposedUser);
      }
      continue;
    }

    // row.category === 'needs_resolution'
    let deptId = row.resolvedDepartmentId;
    if (row.departmentError) {
      const chosenDept = resolutions.departmentChoices?.[row.rowNumber];
      if (!chosenDept) {
        return {
          ok: false,
          error: `Eilutė #${row.rowNumber} (${row.raw.fullName}): nepatikslintas skyrius „${row.raw.department}“.`,
        };
      }
      if (chosenDept !== '__NONE__') {
        const foundDept = departments.find((d) => d.id === chosenDept && !d.isArchived);
        if (!foundDept) {
          return {
            ok: false,
            error: `Eilutė #${row.rowNumber}: pasirinktas skyrius nerastas arba archyvuotas.`,
          };
        }
        deptId = foundDept.id;
      } else {
        deptId = row.existingUser?.departmentId;
      }
    }

    const roomIds = [...row.resolvedRoomIds];
    for (const issue of row.unresolvedRooms) {
      const key = `${row.rowNumber}:${issue.tokenIndex}`;
      const choice = resolutions.roomChoices?.[key];
      if (!choice) {
        return {
          ok: false,
          error: `Eilutė #${row.rowNumber} (${row.raw.fullName}): nepatikslintas kabinetas „${issue.rawToken}“.`,
        };
      }
      if (choice !== '__NONE__') {
        const foundRoom = rooms.find((r) => r.id === choice && !r.isArchived);
        if (!foundRoom) {
          return {
            ok: false,
            error: `Eilutė #${row.rowNumber}: pasirinktas kabinetas nerastas arba archyvuotas.`,
          };
        }
        if (!roomIds.includes(foundRoom.id)) {
          roomIds.push(foundRoom.id);
        }
        if (!deptId) {
          deptId = foundRoom.departmentId;
        }
      }
    }

    const normalizedEmail = row.raw.email.toLowerCase();
    const normalizedGmail = row.raw.allowedGmail.toLowerCase();

    if (row.existingUser) {
      const existing = row.existingUser;
      const finalRoomIds =
        roomIds.length > 0 ? roomIds : getUserAssignedRoomIds(existing);
      const nextPhone = row.raw.phone || existing.phone;
      const nextGmail = normalizedGmail || existing.allowedGmail;
      finalUsers.push({
        ...existing,
        fullName: row.raw.fullName || existing.fullName,
        email: existing.email.trim().toLowerCase(),
        roleTitle: row.raw.roleTitle || existing.roleTitle || 'Mokytojas',
        role: existing.role,
        pinCode: existing.pinCode,
        isActive: existing.isArchived ? false : existing.isActive,
        isArchived: existing.isArchived,
        ...(nextPhone ? { phone: nextPhone } : {}),
        ...(nextGmail ? { allowedGmail: nextGmail } : {}),
        ...(deptId ? { departmentId: deptId } : {}),
        assignedRoomId: finalRoomIds[0] || undefined,
        assignedRoomIds: finalRoomIds.length > 0 ? finalRoomIds : undefined,
      });
    } else {
      finalUsers.push({
        id: `usr-${Date.now().toString(36)}-${row.rowNumber}`,
        fullName: row.raw.fullName,
        email: normalizedEmail,
        role: 'teacher',
        roleTitle: row.raw.roleTitle || 'Mokytojas',
        ...(deptId ? { departmentId: deptId } : {}),
        ...(roomIds[0] ? { assignedRoomId: roomIds[0] } : {}),
        ...(roomIds.length > 0 ? { assignedRoomIds: roomIds } : {}),
        ...(row.raw.phone ? { phone: row.raw.phone } : {}),
        ...(normalizedGmail ? { allowedGmail: normalizedGmail } : {}),
        isActive: true,
        isArchived: false,
      });
    }
  }

  if (finalUsers.length === 0) {
    return {
      ok: false,
      error: 'Neliko nė vieno importuotino darbuotojo (visos eilutės praleistos arba netinkamos).',
    };
  }

  return { ok: true, users: finalUsers };
}
