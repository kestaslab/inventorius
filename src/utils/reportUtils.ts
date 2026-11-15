import {
  ASSET_CLASS_SHORT_LABELS,
  AssetClass,
  AuditCheckMethod,
  AuditSession,
  Department,
  FUNDING_SOURCE_LABELS,
  FUNDING_SOURCE_SHORT_LABELS,
  FundingSource,
  InventoryItem,
  ItemCondition,
  ItemStatus,
  OrganizationSettings,
  Room,
  User,
  WriteOffAct,
  WriteOffRejectedItemRecord,
  formatRoomName,
} from '../types/inventory';
import {
  AuditProgressStats,
  EffectiveAuditItemState,
  EffectiveAuditRow,
  computeAuditStats,
  getEffectiveSessionRows,
} from './auditUtils';
import {
  ResidualValueSummary,
  formatMoneyFixed,
  resolveAssetClass,
  resolveFundingSource,
  sumMoney,
  summarizeResidualValues,
} from './accountingUtils';
import { buildCsvContent, CsvCellValue, formatCsvMoney, formatCsvOptionalMoney } from './csvUtils';
import { getCalendarDatePart, getTodayVilniusDate } from './dateUtils';
import { cloneOrganizationSettings, resolveOrganizationForDocument } from './organization';
import { getWriteOffActYear } from './writeOffUtils';

export type ReportKind =
  | 'audit_session_sheet'
  | 'inventory_sheet'
  | 'writeoff_act'
  | 'user_sheet';

export type RegistryLifecycleScope =
  | 'non_written_off'
  | 'active'
  | 'in_repair'
  | 'to_writeoff'
  | 'written_off'
  | 'all';

export const AUDIT_STATE_LABELS: Record<EffectiveAuditItemState, string> = {
  found: 'Rastas vietoje',
  found_elsewhere: 'Rastas kitur',
  missing: 'Trūksta',
  unchecked: 'Dar nepatikrinta',
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  active: 'Aktyvus',
  in_repair: 'Remontuojamas',
  to_writeoff: 'Teikiamas nurašyti',
  written_off: 'Nurašytas',
};

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'Nauja',
  good: 'Gera',
  fair: 'Patenkinama',
  poor: 'Prasta',
};

export const AUDIT_METHOD_LABELS: Record<AuditCheckMethod, string> = {
  qr: 'QR kodas',
  barcode: 'Brūkšninis kodas',
  manual_code: 'Įvestas kodas',
  manual_list: 'Iš sąrašo',
};

export function formatAuditStateLabel(row: EffectiveAuditRow): string {
  if (row.auditState === 'found_elsewhere') {
    const actualRoom = row.checkRecord?.actualRoomName;
    return actualRoom ? `Rastas kitur (${actualRoom})` : 'Rastas kitur';
  }
  return AUDIT_STATE_LABELS[row.auditState];
}

export function formatAuditCheckMeta(row: EffectiveAuditRow): string {
  const rec = row.checkRecord;
  if (!rec) return row.notes || '—';
  const datePart = getCalendarDatePart(rec.checkedAt);
  const methodLabel = AUDIT_METHOD_LABELS[rec.method] || rec.method;
  const base = `${rec.checkedByUserName}, ${methodLabel}${datePart ? ` (${datePart})` : ''}`;
  return row.notes ? `${base} · ${row.notes}` : base;
}

export interface AuditSessionReportRow extends EffectiveAuditRow {
  auditStateLabel: string;
  checkMetaLabel: string;
}

export interface AuditSessionReportData {
  kind: 'audit_session_sheet';
  session: AuditSession | null;
  organization: OrganizationSettings;
  usesFallbackCurrentOrg: boolean;
  generatedDate: string;
  documentNumber: string;
  documentTitle: string;
  scopeDepartmentName: string;
  statusFilter: 'all' | EffectiveAuditItemState;
  committeeChairman: string;
  committeeMembers: string[];
  orderNumber: string;
  orderDate: string;
  expectedRows: AuditSessionReportRow[];
  additionalRows: AuditSessionReportRow[];
  expectedTotalValue: number;
  additionalTotalValue: number;
  stats: AuditProgressStats;
  hasIncompleteHistory: boolean;
  isEmpty: boolean;
  emptyReason?: string;
}

export function buildAuditSessionReportData(params: {
  session?: AuditSession | null;
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  departmentFilterId?: string;
  statusFilter?: 'all' | EffectiveAuditItemState;
  organizationSettings?: OrganizationSettings;
  generatedDate?: string;
}): AuditSessionReportData {
  const generatedDate = params.generatedDate || getTodayVilniusDate();
  const statusFilter = params.statusFilter || 'all';
  const deptFilter = params.departmentFilterId || 'all';

  if (!params.session) {
    return {
      kind: 'audit_session_sheet',
      session: null,
      organization: cloneOrganizationSettings(params.organizationSettings),
      usesFallbackCurrentOrg: false,
      generatedDate,
      documentNumber: '—',
      documentTitle: 'MATERIALIOJO TURTO FIZINĖS INVENTORIZACIJOS APYRAŠAS',
      scopeDepartmentName: 'Visi skyriai',
      statusFilter,
      committeeChairman: 'Nenurodyta',
      committeeMembers: [],
      orderNumber: 'Nenurodyta',
      orderDate: 'Nenurodyta',
      expectedRows: [],
      additionalRows: [],
      expectedTotalValue: 0,
      additionalTotalValue: 0,
      stats: {
        total: 0,
        checkedCount: 0,
        foundInPlaceCount: 0,
        foundElsewhereCount: 0,
        missingCount: 0,
        uncheckedCount: 0,
        additionalFindingsCount: 0,
        progressPercent: 0,
      },
      hasIncompleteHistory: false,
      isEmpty: true,
      emptyReason: 'Nepasirinkta inventorizacijos sesija arba sistemoje dar nėra sukurtų sesijų.',
    };
  }

  const session = params.session;
  const { organization, usesFallbackCurrentOrg } = resolveOrganizationForDocument(
    session.organizationSnapshot,
    params.organizationSettings,
    session.status === 'completed'
  );

  const effectiveDeptFilter =
    deptFilter !== 'all' ? deptFilter : session.departmentId || 'all';

  const allDeptRows = getEffectiveSessionRows(
    session,
    params.items,
    params.departments,
    params.rooms,
    params.users,
    effectiveDeptFilter
  );

  const stats = computeAuditStats(allDeptRows);
  const matchesFilter = (r: EffectiveAuditRow) =>
    statusFilter === 'all' ? true : r.auditState === statusFilter;

  const toReportRow = (r: EffectiveAuditRow): AuditSessionReportRow => ({
    ...r,
    auditStateLabel: formatAuditStateLabel(r),
    checkMetaLabel: formatAuditCheckMeta(r),
  });

  const expectedRows = allDeptRows
    .filter((r) => !r.isOutsideOriginalScope && !r.isAdditionalFinding)
    .filter(matchesFilter)
    .map(toReportRow);

  const additionalRows = allDeptRows
    .filter((r) => r.isOutsideOriginalScope || r.isAdditionalFinding)
    .filter(matchesFilter)
    .map(toReportRow);

  const scopeDept =
    effectiveDeptFilter !== 'all'
      ? params.departments.find((d) => d.id === effectiveDeptFilter)?.name ||
        session.scopeDepartmentName ||
        'Pasirinktas skyrius'
      : session.scopeDepartmentName || 'Visi gimnazijos skyriai';

  const cleanChair = session.committeeChairman?.trim() || 'Nenurodyta';
  const cleanMembers = Array.isArray(session.committeeMembers)
    ? session.committeeMembers.map((m) => m.trim()).filter(Boolean)
    : [];

  const cleanOrderNumber = session.orderNumber?.trim() || 'Nenurodyta';
  const cleanOrderDate = session.orderDate?.trim() || 'Nenurodyta';
  const docNumber = session.orderNumber?.trim()
    ? `INV-${session.year}-${session.orderNumber.trim()}`
    : `INV-${session.year}-${session.id}`;

  const hasIncompleteHistory =
    !Array.isArray(session.snapshotItems) ||
    allDeptRows.some((r) => Boolean(r.hasIncompleteHistory));

  const isEmpty = expectedRows.length === 0 && additionalRows.length === 0;

  return {
    kind: 'audit_session_sheet',
    session,
    organization,
    usesFallbackCurrentOrg,
    generatedDate,
    documentNumber: docNumber,
    documentTitle: 'MATERIALIOJO TURTO FIZINĖS INVENTORIZACIJOS APYRAŠAS',
    scopeDepartmentName: scopeDept,
    statusFilter,
    committeeChairman: cleanChair,
    committeeMembers: cleanMembers,
    orderNumber: cleanOrderNumber,
    orderDate: cleanOrderDate,
    expectedRows,
    additionalRows,
    expectedTotalValue: sumMoney(expectedRows.map((r) => r.purchasePrice)),
    additionalTotalValue: sumMoney(additionalRows.map((r) => r.purchasePrice)),
    stats,
    hasIncompleteHistory,
    isEmpty,
    ...(isEmpty
      ? {
          emptyReason:
            statusFilter !== 'all'
              ? `Pagal būseną „${AUDIT_STATE_LABELS[statusFilter]}“ pasirinktoje sesijoje įrašų nerasta.`
              : 'Pasirinktoje inventorizacijos sesijoje ir skyriuje įrašų nėra.',
        }
      : {}),
  };
}

export interface RegistrySheetRow {
  item: InventoryItem;
  assetClass: AssetClass;
  assetClassShortLabel: string;
  fundingSource: FundingSource;
  fundingShortLabel: string;
  statusLabel: string;
  departmentName: string;
  roomName: string;
  responsibleUserName: string;
  purchasePrice: number;
  residualValue?: number;
}

export interface RegistrySheetReportData {
  kind: 'inventory_sheet';
  organization: OrganizationSettings;
  generatedDate: string;
  documentNumber: string;
  documentTitle: string;
  lifecycleScope: RegistryLifecycleScope;
  departmentLabel: string;
  roomLabel?: string;
  responsibleUserLabel?: string;
  fundingSourceLabel?: string;
  rows: RegistrySheetRow[];
  totalPurchaseValue: number;
  residualSummary: ResidualValueSummary;
  isEmpty: boolean;
  emptyReason?: string;
}

export function buildRegistrySheetReportData(params: {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  filters: {
    departmentId?: string;
    roomId?: string;
    userId?: string;
    assetClass?: 'all' | AssetClass;
    fundingSource?: 'all' | FundingSource;
    lifecycleScope?: RegistryLifecycleScope;
  };
  organizationSettings?: OrganizationSettings;
  generatedDate?: string;
}): RegistrySheetReportData {
  const generatedDate = params.generatedDate || getTodayVilniusDate();
  const organization = cloneOrganizationSettings(params.organizationSettings);
  const {
    departmentId = 'all',
    roomId = 'all',
    userId = 'all',
    assetClass = 'all',
    fundingSource = 'all',
    lifecycleScope = 'non_written_off',
  } = params.filters;

  const deptMap = new Map(params.departments.map((d) => [d.id, d]));
  const roomMap = new Map(params.rooms.map((r) => [r.id, r]));
  const userMap = new Map(params.users.map((u) => [u.id, u]));

  const filtered = params.items.filter((item) => {
    if (lifecycleScope === 'non_written_off') {
      if (item.status === 'written_off') return false;
    } else if (lifecycleScope !== 'all') {
      if (item.status !== lifecycleScope) return false;
    }

    if (departmentId !== 'all' && item.departmentId !== departmentId) return false;
    if (roomId !== 'all' && item.roomId !== roomId) return false;
    if (userId !== 'all' && item.responsibleUserId !== userId) return false;

    const resolvedClass = resolveAssetClass(item);
    if (assetClass !== 'all' && resolvedClass !== assetClass) return false;

    const resolvedFunding = resolveFundingSource(item);
    if (fundingSource !== 'all' && resolvedFunding !== fundingSource) return false;

    return true;
  });

  const rows: RegistrySheetRow[] = filtered.map((item) => {
    const resolvedClass = resolveAssetClass(item);
    const resolvedFunding = resolveFundingSource(item);
    const dept = deptMap.get(item.departmentId);
    const room = roomMap.get(item.roomId);
    const user = userMap.get(item.responsibleUserId);

    return {
      item,
      assetClass: resolvedClass,
      assetClassShortLabel: ASSET_CLASS_SHORT_LABELS[resolvedClass],
      fundingSource: resolvedFunding,
      fundingShortLabel: FUNDING_SOURCE_SHORT_LABELS[resolvedFunding],
      statusLabel: ITEM_STATUS_LABELS[item.status] || item.status,
      departmentName: dept?.name || 'Nenurodyta',
      roomName: room ? formatRoomName(room, true) : 'Nenurodyta',
      responsibleUserName: user?.fullName || 'Nenurodyta',
      purchasePrice: Number(item.purchasePrice) || 0,
      ...(typeof item.residualValue === 'number' ? { residualValue: item.residualValue } : {}),
    };
  });

  const documentTitle =
    assetClass === 'long_term'
      ? 'ILGALAIKIO MATERIALIOJO TURTO (IMT) REGISTRO SĄRAŠAS'
      : assetClass === 'short_term'
      ? 'TRUMPALAIKIO IR MAŽAVERČIO TURTO (TMT) REGISTRO SĄRAŠAS'
      : 'MATERIALIOJO TURTO REGISTRO SĄRAŠAS';

  const selectedDept = departmentId !== 'all' ? deptMap.get(departmentId) : undefined;
  const selectedRoom = roomId !== 'all' ? roomMap.get(roomId) : undefined;
  const selectedUser = userId !== 'all' ? userMap.get(userId) : undefined;

  return {
    kind: 'inventory_sheet',
    organization,
    generatedDate,
    documentNumber: `REG-${generatedDate}`,
    documentTitle,
    lifecycleScope,
    departmentLabel: selectedDept ? selectedDept.name : 'Visi mokyklos skyriai',
    ...(selectedRoom ? { roomLabel: formatRoomName(selectedRoom, true) } : {}),
    ...(selectedUser ? { responsibleUserLabel: selectedUser.fullName } : {}),
    ...(fundingSource !== 'all'
      ? { fundingSourceLabel: FUNDING_SOURCE_LABELS[fundingSource] }
      : {}),
    rows,
    totalPurchaseValue: sumMoney(rows.map((r) => r.purchasePrice)),
    residualSummary: summarizeResidualValues(rows),
    isEmpty: rows.length === 0,
    ...(rows.length === 0
      ? { emptyReason: 'Pagal pasirinktus registro filtrus turto įrašų nerasta.' }
      : {}),
  };
}

export interface WriteOffActReportRow {
  itemId: string;
  inventoryNumber: string;
  name: string;
  price: number;
  residualPrice?: number;
  reason: string;
  restoredNote?: string;
}

export interface WriteOffActReportData {
  kind: 'writeoff_act';
  act: WriteOffAct | null;
  organization: OrganizationSettings;
  usesFallbackCurrentOrg: boolean;
  generatedDate: string;
  actYear: number | null;
  documentTitle: string;
  committeeChair: string;
  committeeMembers: string[];
  rows: WriteOffActReportRow[];
  rejectedItems: WriteOffRejectedItemRecord[];
  totalPrice: number;
  residualSummary: ResidualValueSummary;
  isEmpty: boolean;
  emptyReason?: string;
}

export function buildWriteOffActReportData(params: {
  act?: WriteOffAct | null;
  items: InventoryItem[];
  organizationSettings?: OrganizationSettings;
  generatedDate?: string;
}): WriteOffActReportData {
  const generatedDate = params.generatedDate || getTodayVilniusDate();
  if (!params.act) {
    return {
      kind: 'writeoff_act',
      act: null,
      organization: cloneOrganizationSettings(params.organizationSettings),
      usesFallbackCurrentOrg: false,
      generatedDate,
      actYear: null,
      documentTitle: 'NEBETINKAMO EKSPLOATUOTI MATERIALIOJO TURTO NURAŠYMO IR LIKVIDAVIMO AKTAS',
      committeeChair: 'Nenurodyta',
      committeeMembers: [],
      rows: [],
      rejectedItems: [],
      totalPrice: 0,
      residualSummary: summarizeResidualValues([]),
      isEmpty: true,
      emptyReason: 'Pasirinktam filtrui nėra suformuotų nurašymo aktų.',
    };
  }

  const act = params.act;
  const { organization, usesFallbackCurrentOrg } = resolveOrganizationForDocument(
    act.organizationSnapshot,
    params.organizationSettings,
    act.status === 'approved'
  );

  const itemMap = new Map(params.items.map((i) => [i.id, i]));
  const rows: WriteOffActReportRow[] = act.items.map((actItem) => {
    const liveItem = itemMap.get(actItem.itemId);
    const restoredFromThisAct = liveItem?.writeOffHistory?.find(
      (h) =>
        h.restoredAt &&
        ((h.actId && h.actId === act.id) ||
          (h.actNumber &&
            h.actNumber.trim().toUpperCase() === act.actNumber.trim().toUpperCase()))
    );
    const restoredNote = restoredFromThisAct
      ? `Atšauktas nurašymas: atkurta į apskaitą ${getCalendarDatePart(restoredFromThisAct.restoredAt)}${
          restoredFromThisAct.restoredByUserName
            ? ` (${restoredFromThisAct.restoredByUserName})`
            : ''
        }${restoredFromThisAct.restorationReason ? ` — ${restoredFromThisAct.restorationReason}` : ''}`
      : undefined;

    return {
      itemId: actItem.itemId,
      inventoryNumber: actItem.inventoryNumber,
      name: actItem.name,
      price: Number(actItem.price) || 0,
      ...(typeof actItem.residualPrice === 'number' && Number.isFinite(actItem.residualPrice)
        ? { residualPrice: actItem.residualPrice }
        : {}),
      reason: actItem.reason,
      ...(restoredNote ? { restoredNote } : {}),
    };
  });

  const cleanChair = act.committeeChair?.trim() || 'Nenurodyta';
  const cleanMembers = Array.isArray(act.committeeMembers)
    ? act.committeeMembers.map((m) => m.trim()).filter(Boolean)
    : [];

  const residualSummary = summarizeResidualValues(
    rows.map((r) => ({ residualValue: r.residualPrice }))
  );

  const isEmpty = rows.length === 0;

  return {
    kind: 'writeoff_act',
    act,
    organization,
    usesFallbackCurrentOrg,
    generatedDate,
    actYear: getWriteOffActYear(act),
    documentTitle: 'NEBETINKAMO EKSPLOATUOTI MATERIALIOJO TURTO NURAŠYMO IR LIKVIDAVIMO AKTAS',
    committeeChair: cleanChair,
    committeeMembers: cleanMembers,
    rows,
    rejectedItems: act.rejectedItems || [],
    totalPrice: sumMoney(rows.map((r) => r.price)),
    residualSummary,
    isEmpty,
    ...(isEmpty
      ? {
          emptyReason:
            act.status === 'cancelled'
              ? 'Nurašymo aktas atšauktas – jame neliko nurašomo turto.'
              : 'Šiame nurašymo akte nėra nė vieno daikto.',
        }
      : {}),
  };
}

export interface UserSheetRow {
  item: InventoryItem;
  assetClass: AssetClass;
  assetClassShortLabel: string;
  roomName: string;
  statusLabel: string;
  conditionLabel: string;
  purchasePrice: number;
  residualValue?: number;
}

export interface UserSheetReportData {
  kind: 'user_sheet';
  targetUser: User | null;
  organization: OrganizationSettings;
  generatedDate: string;
  documentNumber: string;
  documentTitle: string;
  rows: UserSheetRow[];
  totalPurchaseValue: number;
  residualSummary: ResidualValueSummary;
  isEmpty: boolean;
  emptyReason?: string;
}

export function buildUserSheetReportData(params: {
  targetUser?: User | null;
  items: InventoryItem[];
  rooms: Room[];
  assetClassFilter?: 'all' | AssetClass;
  organizationSettings?: OrganizationSettings;
  generatedDate?: string;
}): UserSheetReportData {
  const generatedDate = params.generatedDate || getTodayVilniusDate();
  const organization = cloneOrganizationSettings(params.organizationSettings);
  const assetClassFilter = params.assetClassFilter || 'all';

  if (!params.targetUser) {
    return {
      kind: 'user_sheet',
      targetUser: null,
      organization,
      generatedDate,
      documentNumber: `KORT-${generatedDate}`,
      documentTitle: 'MATERIALIAI ATSAKINGO ASMENS TURTO KORTELĖ',
      rows: [],
      totalPurchaseValue: 0,
      residualSummary: summarizeResidualValues([]),
      isEmpty: true,
      emptyReason: 'Nepasirinktas materialiai atsakingas asmuo.',
    };
  }

  const roomMap = new Map(params.rooms.map((r) => [r.id, r]));
  const targetUser = params.targetUser;

  const filtered = params.items.filter((item) => {
    if (item.status === 'written_off') return false;
    if (item.responsibleUserId !== targetUser.id) return false;
    if (assetClassFilter !== 'all' && resolveAssetClass(item) !== assetClassFilter) return false;
    return true;
  });

  const rows: UserSheetRow[] = filtered.map((item) => {
    const cls = resolveAssetClass(item);
    const room = roomMap.get(item.roomId);
    return {
      item,
      assetClass: cls,
      assetClassShortLabel: ASSET_CLASS_SHORT_LABELS[cls],
      roomName: room ? formatRoomName(room, true) : 'Nenurodyta',
      statusLabel: ITEM_STATUS_LABELS[item.status] || item.status,
      conditionLabel: ITEM_CONDITION_LABELS[item.condition] || 'Nenurodyta',
      purchasePrice: Number(item.purchasePrice) || 0,
      ...(typeof item.residualValue === 'number' ? { residualValue: item.residualValue } : {}),
    };
  });

  return {
    kind: 'user_sheet',
    targetUser,
    organization,
    generatedDate,
    documentNumber: `KORT-${generatedDate}`,
    documentTitle: 'MATERIALIAI ATSAKINGO ASMENS TURTO KORTELĖ',
    rows,
    totalPurchaseValue: sumMoney(rows.map((r) => r.purchasePrice)),
    residualSummary: summarizeResidualValues(rows),
    isEmpty: rows.length === 0,
    ...(rows.length === 0
      ? {
          emptyReason: `Atsakingam asmeniui „${targetUser.fullName}“ pagal pasirinktus filtrus aktyvaus turto nepriskirta.`,
        }
      : {}),
  };
}

export type ResolvedReportData =
  | AuditSessionReportData
  | RegistrySheetReportData
  | WriteOffActReportData
  | UserSheetReportData;

export function buildReportCsv(report: ResolvedReportData): { filename: string; content: string } {
  if (report.kind === 'audit_session_sheet') {
    const safeSessionId = (report.session?.id || 'sesija').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const headers = [
      'Eil. Nr.',
      'Kategorija sąraše',
      'Inventorinis Nr.',
      'Serijos Nr.',
      'Pavadinimas',
      'Tikėtinas skyrius',
      'Tikėtina patalpa',
      'Atsakingas asmuo',
      'Įsigijimo kaina (€)',
      'Inventorizacijos rezultatas',
      'Faktinė patalpa',
      'Patikros duomenys / Pastabos',
    ];
    const rows: CsvCellValue[][] = [];
    report.expectedRows.forEach((row, idx) => {
      rows.push([
        idx + 1,
        'Pradinė apimtis',
        row.inventoryNumber,
        row.serialNumber || '',
        row.name,
        row.expectedDepartmentName,
        row.expectedRoomName,
        row.responsibleUserName,
        formatCsvMoney(row.purchasePrice),
        row.auditStateLabel,
        row.checkRecord?.actualRoomName || '',
        row.checkMetaLabel,
      ]);
    });
    report.additionalRows.forEach((row, idx) => {
      rows.push([
        idx + 1,
        'Papildomas radinys',
        row.inventoryNumber,
        row.serialNumber || '',
        row.name,
        row.expectedDepartmentName,
        row.expectedRoomName,
        row.responsibleUserName,
        formatCsvMoney(row.purchasePrice),
        row.auditStateLabel,
        row.checkRecord?.actualRoomName || '',
        row.checkMetaLabel,
      ]);
    });
    return {
      filename: `inventorizacijos-sesija-${report.session?.year || 'be-metu'}-${safeSessionId}.csv`,
      content: buildCsvContent(headers, rows),
    };
  }

  if (report.kind === 'inventory_sheet') {
    const headers = [
      'Eil. Nr.',
      'Inventorinis Nr.',
      'Serijos Nr.',
      'Pavadinimas',
      'Apskaitos grupė',
      'Turto kilmė',
      'Skyrius',
      'Patalpa',
      'Atsakingas asmuo',
      'Būsena registre',
      'Įsigijimo kaina (€)',
      'Likutinė vertė (€)',
    ];
    const rows: CsvCellValue[][] = report.rows.map((row, idx) => [
      idx + 1,
      row.item.inventoryNumber,
      row.item.serialNumber || '',
      row.item.name,
      row.assetClassShortLabel,
      row.fundingShortLabel,
      row.departmentName,
      row.roomName,
      row.responsibleUserName,
      row.statusLabel,
      formatCsvMoney(row.purchasePrice),
      formatCsvOptionalMoney(row.residualValue),
    ]);
    return {
      filename: `turto-registro-sarasas-${report.generatedDate}.csv`,
      content: buildCsvContent(headers, rows),
    };
  }

  if (report.kind === 'writeoff_act') {
    const actNum = (report.act?.actNumber || 'aktas').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const headers = [
      'Eil. Nr.',
      'Inventorinis Nr.',
      'Pavadinimas',
      'Pradinė vertė (€)',
      'Likutinė vertė (€)',
      'Nurašymo priežastis',
      'Pastabos',
    ];
    const rows: CsvCellValue[][] = report.rows.map((row, idx) => [
      idx + 1,
      row.inventoryNumber,
      row.name,
      formatCsvMoney(row.price),
      formatCsvOptionalMoney(row.residualPrice),
      row.reason,
      row.restoredNote || '',
    ]);
    return {
      filename: `nurashymo-aktas-${actNum}.csv`,
      content: buildCsvContent(headers, rows),
    };
  }

  // user_sheet
  const safeUserSlug = (report.targetUser?.fullName || 'asmuo')
    .toLowerCase()
    .replace(/[^a-z0-9ąčęėįšųūž_-]+/gi, '-');
  const headers = [
    'Eil. Nr.',
    'Inventorinis Nr.',
    'Pavadinimas',
    'Apskaitos grupė',
    'Patalpa',
    'Būsena registre',
    'Būklė',
    'Įsigijimo vertė (€)',
    'Likutinė vertė (€)',
  ];
  const rows: CsvCellValue[][] = report.rows.map((row, idx) => [
    idx + 1,
    row.item.inventoryNumber,
    row.item.name,
    row.assetClassShortLabel,
    row.roomName,
    row.statusLabel,
    row.conditionLabel,
    formatCsvMoney(row.purchasePrice),
    formatCsvOptionalMoney(row.residualValue),
  ]);
  return {
    filename: `atsakingo-asmens-kortele-${safeUserSlug}-${report.generatedDate}.csv`,
    content: buildCsvContent(headers, rows),
  };
}

export function buildResidualSummaryText(summary: ResidualValueSummary): string {
  if (summary.totalCount === 0) return 'Įrašų nėra';
  if (summary.knownCount === 0) {
    return `Likutinė vertė nenurodyta nė vienam iš ${summary.totalCount} vnt.`;
  }
  if (summary.allSpecified) {
    return `Patvirtinta visų ${summary.totalCount} vnt. likutinė vertė: ${formatMoneyFixed(summary.knownTotal)} €`;
  }
  return `Žinoma likutinė vertė (${summary.knownCount} iš ${summary.totalCount} vnt.): ${formatMoneyFixed(
    summary.knownTotal
  )} € · Nenurodyta: ${summary.missingCount} vnt.`;
}
