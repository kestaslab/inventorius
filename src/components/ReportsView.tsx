import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle,
  FileSpreadsheet,
  FileText,
  Printer,
  Settings,
} from 'lucide-react';
import {
  AssetClass,
  AuditSession,
  Department,
  FUNDING_SOURCE_LABELS,
  FundingSource,
  InventoryItem,
  OrganizationSettings,
  Room,
  User,
  WriteOffAct,
  formatRoomName,
} from '../types/inventory';
import { formatMoneyFixed } from '../utils/accountingUtils';
import { EffectiveAuditItemState } from '../utils/auditUtils';
import { getCalendarDatePart, getCurrentYearVilnius, getTodayVilniusDate } from '../utils/dateUtils';
import { generateReportDocxBlob, getReportDocxFilename } from '../utils/docxExport';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  cloneOrganizationSettings,
  hasConfirmedOrganizationSettings,
} from '../utils/organization';
import {
  AUDIT_STATE_LABELS,
  RegistryLifecycleScope,
  buildAuditSessionReportData,
  buildRegistrySheetReportData,
  buildReportCsv,
  buildResidualSummaryText,
  buildUserSheetReportData,
  buildWriteOffActReportData,
} from '../utils/reportUtils';
import {
  analyzeWriteOffIntegrity,
  filterWriteOffActsByYear,
  getWriteOffActYear,
  resolveActiveWriteOffAct,
} from '../utils/writeOffUtils';

interface ReportsViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  writeOffActs: WriteOffAct[];
  auditSessions?: AuditSession[];
  organizationSettings?: OrganizationSettings;
  currentUser: User;
  onExportCSV?: () => void;
  onSaveWriteOffAct?: (act: WriteOffAct) => void;
  onApproveWriteOffAct?: (actId: string, approvalYear: number, customActNumber?: string) => void;
  onUpdateOrganizationSettings?: (settings: OrganizationSettings) => void;
  onReconcileWriteOffIssue?: (
    action: 'return_to_active' | 'remove_stale_draft_item' | 'link_by_existing_act_number',
    itemId?: string,
    actId?: string
  ) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  items,
  departments,
  rooms,
  users,
  writeOffActs,
  auditSessions = [],
  organizationSettings,
  currentUser,
  onApproveWriteOffAct,
  onUpdateOrganizationSettings,
  onReconcileWriteOffIssue,
}) => {
  const [reportType, setReportType] = useState<
    'audit_session_sheet' | 'inventory_sheet' | 'writeoff_act' | 'user_sheet'
  >(auditSessions.length > 0 ? 'audit_session_sheet' : 'inventory_sheet');

  // Organization settings panel
  const hasCurrentConfirmedOrg = hasConfirmedOrganizationSettings(organizationSettings);
  const [isOrgPanelOpen, setIsOrgPanelOpen] = useState(() => !hasCurrentConfirmedOrg);
  const [orgForm, setOrgForm] = useState<OrganizationSettings>(() =>
    hasCurrentConfirmedOrg
      ? cloneOrganizationSettings(organizationSettings)
      : { name: '', code: '', address: '', directorTitle: '', directorName: '' }
  );
  const [orgSaveNotice, setOrgSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (hasConfirmedOrganizationSettings(organizationSettings)) {
      setOrgForm(cloneOrganizationSettings(organizationSettings));
    } else {
      setOrgForm({ name: '', code: '', address: '', directorTitle: '', directorName: '' });
      setIsOrgPanelOpen(true);
    }
  }, [organizationSettings]);

  const canEditOrgSettings = currentUser.role === 'admin' || currentUser.role === 'manager';

  // Audit session sheet filters
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => {
    const completedOrActive =
      auditSessions.find((s) => s.status === 'in_progress') || auditSessions[0];
    return completedOrActive?.id || '';
  });
  const [auditFilterDeptId, setAuditFilterDeptId] = useState<string>('all');
  const [auditFilterStatus, setAuditFilterStatus] = useState<'all' | EffectiveAuditItemState>('all');

  useEffect(() => {
    if (auditSessions.length === 0) {
      if (selectedSessionId !== '') setSelectedSessionId('');
    } else if (!auditSessions.some((s) => s.id === selectedSessionId)) {
      const preferred =
        auditSessions.find((s) => s.status === 'in_progress') || auditSessions[0];
      setSelectedSessionId(preferred?.id || '');
    }
  }, [auditSessions, selectedSessionId]);

  const activeAuditSession = useMemo(
    () => auditSessions.find((s) => s.id === selectedSessionId) || null,
    [auditSessions, selectedSessionId]
  );

  // Registry sheet filters
  const [filterDeptId, setFilterDeptId] = useState<string>('all');
  const [filterRoomId, setFilterRoomId] = useState<string>('all');
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [filterAssetClass, setFilterAssetClass] = useState<'all' | AssetClass>('all');
  const [filterFundingSource, setFilterFundingSource] = useState<'all' | FundingSource>('all');
  const [filterLifecycleScope, setFilterLifecycleScope] =
    useState<RegistryLifecycleScope>('non_written_off');

  // Write-off act and year filters
  const [selectedWriteOffActId, setSelectedWriteOffActId] = useState<string>(
    writeOffActs[0]?.id || ''
  );
  const [filterActYear, setFilterActYear] = useState<'all' | number>('all');
  const [selectedApprovalYear, setSelectedApprovalYear] = useState<number>(getCurrentYearVilnius());
  const [approvalActNumber, setApprovalActNumber] = useState<string>('');

  // Export feedback
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const actYears = useMemo(() => {
    const years = new Set<number>();
    writeOffActs.forEach((a) => {
      years.add(getWriteOffActYear(a));
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [writeOffActs]);

  const approvalYearOptions = useMemo(() => {
    const maxYear = getCurrentYearVilnius() + 1;
    const minYear = Math.min(2020, ...(actYears.length > 0 ? actYears : [2020]));
    const arr: number[] = [];
    for (let y = maxYear; y >= minYear; y--) arr.push(y);
    return arr;
  }, [actYears]);

  const displayedActs = useMemo(
    () => filterWriteOffActsByYear(writeOffActs, filterActYear),
    [writeOffActs, filterActYear]
  );

  const activeWriteOff = useMemo(
    () => resolveActiveWriteOffAct(displayedActs, selectedWriteOffActId),
    [displayedActs, selectedWriteOffActId]
  );

  useEffect(() => {
    if (displayedActs.length === 0) {
      if (selectedWriteOffActId !== '') setSelectedWriteOffActId('');
    } else if (!displayedActs.some((a) => a.id === selectedWriteOffActId)) {
      setSelectedWriteOffActId(displayedActs[0].id);
    }
  }, [displayedActs, selectedWriteOffActId]);

  useEffect(() => {
    if (activeWriteOff) {
      setApprovalActNumber(activeWriteOff.actNumber);
      setSelectedApprovalYear(getWriteOffActYear(activeWriteOff));
    } else {
      setApprovalActNumber('');
    }
  }, [activeWriteOff?.id, activeWriteOff?.actNumber]);

  const writeOffIntegrityIssues = useMemo(
    () => analyzeWriteOffIntegrity(items, writeOffActs),
    [items, writeOffActs]
  );

  const todayVilnius = getTodayVilniusDate();

  const resolvedUserTarget = useMemo(() => {
    if (filterUserId !== 'all') {
      return users.find((u) => u.id === filterUserId) || null;
    }
    return users[0] || null;
  }, [filterUserId, users]);

  // Unified Report View-Model shared identically by Preview, Print, CSV, and DOCX
  const resolvedReport = useMemo(() => {
    if (reportType === 'audit_session_sheet') {
      return buildAuditSessionReportData({
        session: activeAuditSession,
        items,
        departments,
        rooms,
        users,
        departmentFilterId: auditFilterDeptId,
        statusFilter: auditFilterStatus,
        organizationSettings,
        generatedDate: todayVilnius,
      });
    }
    if (reportType === 'inventory_sheet') {
      return buildRegistrySheetReportData({
        items,
        departments,
        rooms,
        users,
        filters: {
          departmentId: filterDeptId,
          roomId: filterRoomId,
          userId: filterUserId,
          assetClass: filterAssetClass,
          fundingSource: filterFundingSource,
          lifecycleScope: filterLifecycleScope,
        },
        organizationSettings,
        generatedDate: todayVilnius,
      });
    }
    if (reportType === 'writeoff_act') {
      return buildWriteOffActReportData({
        act: activeWriteOff,
        items,
        organizationSettings,
        generatedDate: todayVilnius,
      });
    }
    return buildUserSheetReportData({
      targetUser: resolvedUserTarget,
      items,
      rooms,
      assetClassFilter: filterAssetClass,
      organizationSettings,
      generatedDate: todayVilnius,
    });
  }, [
    reportType,
    activeAuditSession,
    items,
    departments,
    rooms,
    users,
    auditFilterDeptId,
    auditFilterStatus,
    organizationSettings,
    todayVilnius,
    filterDeptId,
    filterRoomId,
    filterUserId,
    filterAssetClass,
    filterFundingSource,
    filterLifecycleScope,
    activeWriteOff,
    resolvedUserTarget,
  ]);

  const isOrgConfirmationRequired = !resolvedReport.hasConfirmedOrganization;
  const isExportDisabled =
    resolvedReport.isEmpty || isOrgConfirmationRequired || isExportingDocx;

  const handleSaveOrgSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditOrgSettings || !onUpdateOrganizationSettings) return;
    if (
      !orgForm.name.trim() ||
      !orgForm.code.trim() ||
      !orgForm.address.trim() ||
      !orgForm.directorTitle.trim()
    ) {
      return;
    }
    const cleaned = cloneOrganizationSettings(orgForm);
    onUpdateOrganizationSettings(cleaned);
    setOrgSaveNotice(
      'Įstaigos rekvizitai patvirtinti ir išsaugoti. Užbaigti apyrašai ir patvirtinti aktai išsaugo savo istorinius rekvizitus.'
    );
    setTimeout(() => setOrgSaveNotice(null), 5000);
  };

  const handleDownloadWordDoc = async () => {
    if (resolvedReport.isEmpty || isOrgConfirmationRequired) return;
    setExportError(null);
    setIsExportingDocx(true);
    try {
      const blob = await generateReportDocxBlob(resolvedReport);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getReportDocxFilename(resolvedReport);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Nepavyko sugeneruoti Word (DOCX) dokumento.'
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleDownloadCsv = () => {
    if (resolvedReport.isEmpty || isOrgConfirmationRequired) return;
    setExportError(null);
    const { filename, content } = buildReportCsv(resolvedReport);
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintA4 = () => {
    if (resolvedReport.isEmpty || isOrgConfirmationRequired) return;
    window.print();
  };

  const renderCommissionSignaturesGrid = (
    chairName: string,
    members: string[],
    extraEntries: Array<{ roleLabel: string; name: string }> = []
  ) => {
    const entries: Array<{ roleLabel: string; name: string }> = [
      { roleLabel: 'Komisijos pirmininkas', name: chairName || 'Nenurodyta' },
      ...members.map((m) => ({ roleLabel: 'Komisijos narys', name: m })),
      ...extraEntries,
    ];
    if (entries.length === 1) {
      entries.push({ roleLabel: 'Komisijos narys', name: 'Nenurodyta' });
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 print:grid-cols-2">
        {entries.map((entry, idx) => (
          <div key={`${entry.roleLabel}-${idx}`} className="print-avoid-break">
            <div className="text-slate-600 text-[11px]">{entry.roleLabel}:</div>
            <div className="border-b border-slate-500 h-6"></div>
            <div className="flex justify-between text-[10px] text-slate-600 mt-0.5 gap-2">
              <span>(Parašas)</span>
              <span className="font-medium text-right">{entry.name}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar (hidden when printing) */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 space-y-4 shadow-xs no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Oficialių ataskaitų ir aktų generatorius
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Fizinės inventorizacijos apyrašai, registro suvestinės ir aktai spausdinimui (A4), Word (DOCX) bei Excel (CSV)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEditOrgSettings && onUpdateOrganizationSettings && (
              <button
                type="button"
                onClick={() => setIsOrgPanelOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  isOrgPanelOpen
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Įstaigos rekvizitai</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePrintA4}
              disabled={resolvedReport.isEmpty || isOrgConfirmationRequired}
              title={
                isOrgConfirmationRequired
                  ? 'Pirmiausia patvirtinkite įstaigos rekvizitus'
                  : 'Spausdinti šiuo metu matomą A4 dokumentą'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 disabled:pointer-events-none transition-colors cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5 text-slate-700" />
              <span>Spausdinti (A4)</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={isExportDisabled}
              title={
                isOrgConfirmationRequired
                  ? 'Pirmiausia patvirtinkite įstaigos rekvizitus'
                  : 'Atsisiųsti tikslią šios ataskaitos lentelę CSV (Excel) formatu'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 disabled:pointer-events-none transition-colors cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Atsisiųsti Excel (CSV)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadWordDoc()}
              disabled={isExportDisabled}
              title={
                isOrgConfirmationRequired
                  ? 'Pirmiausia patvirtinkite įstaigos rekvizitus'
                  : 'Atsisiųsti tikrą Microsoft Word (OOXML .docx) dokumentą'
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:pointer-events-none rounded-md transition-colors shadow-xs cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isExportingDocx ? 'Generuojama...' : 'Atsisiųsti Word (DOCX)'}</span>
            </button>
          </div>
        </div>

        {isOrgConfirmationRequired && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong>Reikalingas įstaigos rekvizitų patvirtinimas:</strong> šioje duomenų bazėje (ar senojoje kopijoje) nėra patvirtintų įstaigos rekvizitų. Kad neuždėtume klaidingos mokyklos duomenų, oficialių dokumentų spausdinimas ir eksportas išjungti, kol rekvizitai nebus patvirtinti.
              </div>
            </div>
            {canEditOrgSettings && onUpdateOrganizationSettings && !isOrgPanelOpen && (
              <button
                type="button"
                onClick={() => setIsOrgPanelOpen(true)}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded cursor-pointer shrink-0"
              >
                Įvesti ir patvirtinti rekvizitus
              </button>
            )}
          </div>
        )}

        {exportError && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
            {exportError}
          </div>
        )}

        {/* Organization Settings Panel */}
        {isOrgPanelOpen && canEditOrgSettings && onUpdateOrganizationSettings && (
          <form
            onSubmit={handleSaveOrgSettings}
            className="p-4 rounded-lg bg-slate-50 border border-slate-300 space-y-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span>Įstaigos rekvizitai naujiems dokumentams</span>
              </div>
              <span className="text-[11px] text-slate-500">
                Užbaigtiems apyrašams ir patvirtintiems aktams taikomi jų išsaugoti rekvizitai.
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-700 mb-1">Įstaigos pavadinimas *</label>
                <input
                  type="text"
                  required
                  value={orgForm.name}
                  onChange={(e) => setOrgForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-700 mb-1">Juridinio asmens kodas *</label>
                <input
                  type="text"
                  required
                  value={orgForm.code}
                  onChange={(e) => setOrgForm((p) => ({ ...p, code: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 border border-slate-300 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-700 mb-1">Adresas *</label>
                <input
                  type="text"
                  required
                  value={orgForm.address}
                  onChange={(e) => setOrgForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-700 mb-1">Vadovo pareigos *</label>
                <input
                  type="text"
                  required
                  value={orgForm.directorTitle}
                  onChange={(e) => setOrgForm((p) => ({ ...p, directorTitle: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-700 mb-1">
                  Vadovo vardas, pavardė (neprivaloma)
                </label>
                <input
                  type="text"
                  value={orgForm.directorName || ''}
                  placeholder="Palikus tuščią – parašo eilutė"
                  onChange={(e) => setOrgForm((p) => ({ ...p, directorName: e.target.value }))}
                  className="w-full rounded px-2.5 py-1.5 border border-slate-300 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {!hasCurrentConfirmedOrg && (
                  <button
                    type="button"
                    onClick={() => setOrgForm(cloneOrganizationSettings(DEFAULT_ORGANIZATION_SETTINGS))}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-md cursor-pointer"
                  >
                    Užpildyti gimnazijos šabloną
                  </button>
                )}
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md cursor-pointer"
                >
                  Patvirtinti ir išsaugoti rekvizitus
                </button>
              </div>
            </div>
            {orgSaveNotice && (
              <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5 font-medium">
                {orgSaveNotice}
              </div>
            )}
          </form>
        )}

        {/* Report Type Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setReportType('audit_session_sheet')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'audit_session_sheet'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            1. Fizinės inventorizacijos apyrašas
          </button>
          <button
            type="button"
            onClick={() => setReportType('inventory_sheet')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'inventory_sheet'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            2. Turto registro sąrašas
          </button>
          <button
            type="button"
            onClick={() => setReportType('writeoff_act')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'writeoff_act'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            3. Nurašymo ir likvidavimo aktas
          </button>
          <button
            type="button"
            onClick={() => setReportType('user_sheet')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'user_sheet'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            4. Materialiai atsakingo kortelė
          </button>
        </div>

        {/* Filters for Tab 1: Physical Audit Session Report */}
        {reportType === 'audit_session_sheet' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-200 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Inventorizacijos sesija
              </label>
              <select
                value={selectedSessionId}
                disabled={auditSessions.length === 0}
                onChange={(e) => {
                  setSelectedSessionId(e.target.value);
                  setAuditFilterDeptId('all');
                }}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium"
              >
                {auditSessions.length === 0 ? (
                  <option value="">Inventorizacijos sesijų nėra</option>
                ) : (
                  auditSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.year} m. · {s.title} [{s.status === 'completed' ? 'Užbaigta' : 'Vykdoma'}]
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Skyrius apyraše
              </label>
              <select
                value={
                  activeAuditSession?.departmentId
                    ? activeAuditSession.departmentId
                    : auditFilterDeptId
                }
                disabled={!activeAuditSession || Boolean(activeAuditSession.departmentId)}
                onChange={(e) => setAuditFilterDeptId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium disabled:bg-slate-100"
              >
                {!activeAuditSession?.departmentId && (
                  <option value="all">Visi sesijos skyriai</option>
                )}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Patikros rezultato filtras
              </label>
              <select
                value={auditFilterStatus}
                onChange={(e) =>
                  setAuditFilterStatus(e.target.value as 'all' | EffectiveAuditItemState)
                }
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium"
              >
                <option value="all">Visos būsenos (pilnas apyrašas)</option>
                <option value="found">{AUDIT_STATE_LABELS.found}</option>
                <option value="found_elsewhere">{AUDIT_STATE_LABELS.found_elsewhere}</option>
                <option value="missing">{AUDIT_STATE_LABELS.missing}</option>
                <option value="unchecked">{AUDIT_STATE_LABELS.unchecked}</option>
              </select>
            </div>
          </div>
        )}

        {/* Filters for Tab 2: Asset Registry Sheet */}
        {reportType === 'inventory_sheet' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-200 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Skyrius</label>
              <select
                value={filterDeptId}
                onChange={(e) => {
                  setFilterDeptId(e.target.value);
                  setFilterRoomId('all');
                }}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-medium shadow-2xs"
              >
                <option value="all">Visi skyriai</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Kabinetas</label>
              <select
                value={filterRoomId}
                onChange={(e) => setFilterRoomId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
              >
                <option value="all">Visi kabinetai</option>
                {rooms
                  .filter((r) => filterDeptId === 'all' || r.departmentId === filterDeptId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatRoomName(r)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Atsakingas asmuo
              </label>
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
              >
                <option value="all">Visi asmenys</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900 mb-1">
                Turto grupė
              </label>
              <select
                value={filterAssetClass}
                onChange={(e) => setFilterAssetClass(e.target.value as 'all' | AssetClass)}
                className={`w-full bg-white border rounded px-2.5 py-1.5 font-medium ${
                  filterAssetClass !== 'all'
                    ? 'border-blue-500 text-blue-800 bg-blue-50/40'
                    : 'border-slate-300'
                }`}
              >
                <option value="all">Visas turtas (IMT + TMT)</option>
                <option value="long_term">Tik ilgalaikis (IMT)</option>
                <option value="short_term">Tik trumpalaikis (TMT)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                Turto kilmė / Panauda
              </label>
              <select
                value={filterFundingSource}
                onChange={(e) => setFilterFundingSource(e.target.value as 'all' | FundingSource)}
                className={`w-full bg-white border rounded px-2.5 py-1.5 font-medium ${
                  filterFundingSource !== 'all'
                    ? 'border-amber-500 text-amber-800 bg-amber-50/40'
                    : 'border-slate-300'
                }`}
              >
                <option value="all">Visi šaltiniai / Panauda</option>
                <option value="municipality">Savivaldybės panauda</option>
                <option value="ministry">ŠMSM panauda</option>
                <option value="school">Gimnazijos biudžetas</option>
                <option value="project">ES / STEAM projektai</option>
                <option value="donation">Kita</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Būsena registre
              </label>
              <select
                value={filterLifecycleScope}
                onChange={(e) =>
                  setFilterLifecycleScope(e.target.value as RegistryLifecycleScope)
                }
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium"
              >
                <option value="non_written_off">Nenurašytas turtas (suvestinės apimtis)</option>
                <option value="active">Tik aktyvus</option>
                <option value="in_repair">Tik remontuojamas</option>
                <option value="to_writeoff">Tik teikiamas nurašyti</option>
                <option value="written_off">Tik nurašytas (archyvas)</option>
                <option value="all">Visos būsenos kartu</option>
              </select>
            </div>
          </div>
        )}

        {/* Filters for Tab 3: Write-Off Act */}
        {reportType === 'writeoff_act' && (
          <div className="pt-2 border-t border-slate-100 text-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-slate-600 font-medium">Metų filtras:</label>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setFilterActYear('all')}
                      className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                        filterActYear === 'all'
                          ? 'bg-purple-600 text-white font-semibold'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Visi metai
                    </button>
                    {actYears.map((year) => (
                      <button
                        type="button"
                        key={year}
                        onClick={() => setFilterActYear(year)}
                        className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                          filterActYear === year
                            ? 'bg-purple-600 text-white font-semibold'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {year} m.
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-slate-600 font-medium">Pasirinkite aktą:</label>
                  <select
                    value={activeWriteOff?.id || ''}
                    disabled={displayedActs.length === 0}
                    onChange={(e) => setSelectedWriteOffActId(e.target.value)}
                    className="bg-white border border-slate-300 rounded px-3 py-1.5 font-mono disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {displayedActs.length === 0 ? (
                      <option value="">Šiais metais nurašymo aktų nėra</option>
                    ) : (
                      displayedActs.map((act) => (
                        <option key={act.id} value={act.id}>
                          {act.actNumber} ({act.date}) — {act.items.length} vnt. [
                          {act.status === 'approved'
                            ? `Patvirtintas (${getWriteOffActYear(act)} m.)`
                            : act.status === 'cancelled'
                            ? 'Atšauktas / atmesta'
                            : 'Projektas'}
                          ]
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {activeWriteOff && activeWriteOff.status === 'draft' && (
                <div className="flex flex-wrap items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-md">
                  <span className="font-semibold text-rose-900">Aktas nepatvirtintas:</span>
                  <input
                    type="text"
                    value={approvalActNumber}
                    onChange={(e) => setApprovalActNumber(e.target.value)}
                    title="Nurašymo akto numeris"
                    className="w-32 bg-white border border-rose-300 text-xs rounded px-2 py-1 font-mono font-semibold text-slate-800"
                  />
                  <select
                    value={selectedApprovalYear}
                    onChange={(e) => setSelectedApprovalYear(Number(e.target.value))}
                    className="bg-white border border-rose-300 text-xs rounded px-2 py-1 font-semibold text-slate-800"
                  >
                    {approvalYearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y} metai
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={activeWriteOff.items.length === 0}
                    onClick={() =>
                      onApproveWriteOffAct &&
                      onApproveWriteOffAct(
                        activeWriteOff.id,
                        selectedApprovalYear,
                        approvalActNumber.trim() || activeWriteOff.actNumber
                      )
                    }
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded shadow-2xs cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>
                      Patvirtinti aktą ir archyvuoti turtą ({activeWriteOff.items.length} vnt.)
                    </span>
                  </button>
                </div>
              )}

              {activeWriteOff && activeWriteOff.status === 'cancelled' && (
                <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1.5 rounded-md font-medium text-xs">
                  <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Nurašymo projektas atšauktas atmetus visus pateiktus daiktus.</span>
                </div>
              )}

              {activeWriteOff && activeWriteOff.status === 'approved' && (
                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-md font-medium text-xs">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Aktas patvirtintas {activeWriteOff.approvedDate || activeWriteOff.date} · Archyvo
                    metai: <strong>{getWriteOffActYear(activeWriteOff)} m.</strong>
                  </span>
                </div>
              )}
            </div>

            {writeOffIntegrityIssues.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Aptikti nurašymo aktų ir turto duomenų neatitikimai ({writeOffIntegrityIssues.length}):
                  </span>
                </div>
                <ul className="space-y-1.5 text-[11px]">
                  {writeOffIntegrityIssues.map((issue) => (
                    <li
                      key={issue.id}
                      className="flex flex-wrap items-center justify-between gap-2 bg-white/70 px-2.5 py-1.5 rounded border border-amber-200"
                    >
                      <span>{issue.message}</span>
                      {onReconcileWriteOffIssue && issue.canReturnToActive && issue.itemId && (
                        <button
                          type="button"
                          onClick={() => onReconcileWriteOffIssue('return_to_active', issue.itemId)}
                          className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded cursor-pointer"
                        >
                          Grąžinti į aktyvų sąrašą
                        </button>
                      )}
                      {onReconcileWriteOffIssue &&
                        issue.canRemoveFromDraftAct &&
                        issue.actId &&
                        issue.itemId && (
                          <button
                            type="button"
                            onClick={() =>
                              onReconcileWriteOffIssue(
                                'remove_stale_draft_item',
                                issue.itemId,
                                issue.actId
                              )
                            }
                            className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded cursor-pointer"
                          >
                            Pašalinti iš projekto
                          </button>
                        )}
                      {onReconcileWriteOffIssue &&
                        issue.canLinkExistingAct &&
                        issue.itemId &&
                        issue.matchingActId && (
                          <button
                            type="button"
                            onClick={() =>
                              onReconcileWriteOffIssue(
                                'link_by_existing_act_number',
                                issue.itemId,
                                issue.matchingActId
                              )
                            }
                            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded cursor-pointer"
                          >
                            Susieti su esamu aktu
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Filters for Tab 4: User Sheet */}
        {reportType === 'user_sheet' && (
          <div className="pt-2 border-t border-slate-100 text-xs flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-slate-600 font-medium">Mokytojas / Darbuotojas:</label>
              <select
                value={resolvedUserTarget?.id || ''}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="bg-white border border-slate-300 rounded px-3 py-1.5 font-medium"
              >
                {users.length === 0 ? (
                  <option value="">Darbuotojų sąrašas tuščias</option>
                ) : (
                  users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.roleTitle})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-slate-600 font-medium">Turto grupė:</label>
              <select
                value={filterAssetClass}
                onChange={(e) => setFilterAssetClass(e.target.value as 'all' | AssetClass)}
                className="bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium"
              >
                <option value="all">Visas turtas (IMT + TMT)</option>
                <option value="long_term">Tik ilgalaikis (IMT)</option>
                <option value="short_term">Tik trumpalaikis (TMT)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Sheet Preview Display */}
      <div className="bg-slate-200/80 p-4 md:p-8 rounded-xl flex justify-center border border-slate-300 print-sheet-scroller">
        <div className="bg-white border border-slate-300 shadow-xl p-8 md:p-12 rounded-xl w-full max-w-[210mm] min-h-[297mm] text-slate-900 leading-normal print-sheet">
          {/* Institutional Header */}
          <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
            <div className="w-16 h-16 shrink-0 flex items-center justify-center p-0.5">
              <img
                src="/assets/aistudio/__05425c32.jpg"
                alt="Įstaigos herbas"
                className="max-h-16 max-w-16 object-contain"
              />
            </div>
            <div className="space-y-1 text-center flex-1 px-4">
              <div className="text-sm font-bold uppercase tracking-wider text-slate-900">
                {resolvedReport.organization.name}
              </div>
              <div className="text-[11px] text-slate-600">
                Juridinio asmens kodas: {resolvedReport.organization.code} ·{' '}
                {resolvedReport.organization.address}
              </div>
            </div>
            <div className="w-16 shrink-0 hidden sm:block"></div>
          </div>

          {/* EMPTY STATE GUARD */}
          {resolvedReport.isEmpty && (
            <div className="py-16 px-6 text-center space-y-3 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/70">
              <Archive className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="text-sm font-bold text-slate-800">
                {resolvedReport.emptyReason || 'Pagal pasirinktus parametrus duomenų nerasta'}
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Tuščio arba neegzistuojančio dokumento eksportuoti ar spausdinti negalima. Pakeiskite filtrus arba pasirinkite kitą įrašą.
              </p>
              {reportType === 'writeoff_act' &&
                filterActYear !== 'all' &&
                writeOffActs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterActYear('all')}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-md cursor-pointer no-print"
                  >
                    Rodyti visų metų aktus ({writeOffActs.length})
                  </button>
                )}
            </div>
          )}

          {/* REPORT 1: PHYSICAL AUDIT SESSION REPORT */}
          {resolvedReport.kind === 'audit_session_sheet' && !resolvedReport.isEmpty && resolvedReport.session && (
            <div>
              <div className="flex justify-end mb-6 text-xs text-slate-800 print-avoid-break">
                <div className="w-72 border border-slate-400 p-3 text-left">
                  <div className="font-bold text-[11px] uppercase">TVIRTINU:</div>
                  <div className="mt-1 text-[11px]">
                    {resolvedReport.organization.directorTitle}
                  </div>
                  <div className="mt-4 border-b border-slate-400"></div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>(Parašas)</span>
                    <span>
                      {resolvedReport.organization.directorName || '(Vardas, pavardė)'}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px]">
                    Data: ____ m. ______________ mėn. ____ d.
                  </div>
                </div>
              </div>

              <div className="text-center space-y-1 mb-5">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {resolvedReport.documentTitle}
                </h3>
                <div className="text-xs font-semibold text-slate-800">
                  {resolvedReport.session.title}
                </div>
                <div className="text-xs font-mono text-slate-600">
                  Nr. {resolvedReport.documentNumber} · Sudarymo data: {resolvedReport.generatedDate}
                </div>
                <div className="text-[11px] text-slate-700">
                  Sesijos pradžia: <strong>{resolvedReport.session.startDate}</strong>
                  {resolvedReport.session.completedDate && (
                    <>
                      {' '}
                      · Užbaigta: <strong>{resolvedReport.session.completedDate}</strong>
                    </>
                  )}{' '}
                  · Įsakymas Nr. <strong>{resolvedReport.orderNumber}</strong> (
                  {resolvedReport.orderDate}) · Apimtis:{' '}
                  <strong>{resolvedReport.scopeDepartmentName}</strong>
                </div>
              </div>

              {(resolvedReport.hasIncompleteHistory || resolvedReport.usesFallbackCurrentOrg) && (
                <div className="mb-4 p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1">
                  {resolvedReport.hasIncompleteHistory && (
                    <div>
                      • Pastaba: ši sesija sukurta be pilno momentinio turto sąrašo, todėl trūkstami istoriniai laukai nėra dirbtinai atkuriami.
                    </div>
                  )}
                  {resolvedReport.usesFallbackCurrentOrg && (
                    <div>
                      • Pastaba: užbaigtoje sesijoje nebuvo užfiksuotų įstaigos rekvizitų momento, todėl rodomi dabartiniai įstaigos rekvizitai.
                    </div>
                  )}
                </div>
              )}

              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-800">
                1. Pradinės sesijos apimties materialusis turtas ({resolvedReport.expectedRows.length}{' '}
                vnt.)
              </div>
              <table className="w-full text-left border border-slate-900 text-[10px] border-collapse mb-6">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold text-slate-900">
                    <th className="p-1.5 border-r border-slate-900 text-center w-7">Eil.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inv. Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Turto pavadinimas</th>
                    <th className="p-1.5 border-r border-slate-900 w-28">Tikėtina patalpa</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Atsakingas</th>
                    <th className="p-1.5 border-r border-slate-900 text-right w-16">Vertė, €</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-24">Rezultatas</th>
                    <th className="p-1.5 w-28">Patikra / Pastabos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {resolvedReport.expectedRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-3 text-center text-slate-500">
                        Pradinėje apimtyje pagal pasirinktus filtrus eilučių nėra.
                      </td>
                    </tr>
                  ) : (
                    resolvedReport.expectedRows.map((row, idx) => (
                      <tr key={row.itemId}>
                        <td className="p-1.5 border-r border-slate-900 text-center font-mono">
                          {idx + 1}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 font-mono font-semibold whitespace-nowrap">
                          {row.inventoryNumber}
                        </td>
                        <td className="p-1.5 border-r border-slate-900">
                          <div className="font-medium text-slate-900">{row.name}</div>
                          {row.serialNumber && (
                            <div className="text-[9px] font-mono text-slate-500">
                              SN: {row.serialNumber}
                            </div>
                          )}
                          {row.hasIncompleteHistory && (
                            <div className="text-[9px] text-amber-800">
                              (Senos sesijos įrašas be momentinio sąrašo)
                            </div>
                          )}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-slate-700">
                          {row.expectedRoomName}
                          {row.expectedDepartmentCode ? ` (${row.expectedDepartmentCode})` : ''}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-slate-700">
                          {row.responsibleUserName}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">
                          {formatMoneyFixed(row.purchasePrice)}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-center font-semibold">
                          <span
                            className={
                              row.auditState === 'found'
                                ? 'text-emerald-800'
                                : row.auditState === 'found_elsewhere'
                                ? 'text-amber-800'
                                : row.auditState === 'missing'
                                ? 'text-rose-800'
                                : 'text-slate-600'
                            }
                          >
                            {row.auditStateLabel}
                          </span>
                        </td>
                        <td className="p-1.5 text-[9.5px] text-slate-600">{row.checkMetaLabel}</td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-900">
                    <td colSpan={5} className="p-2 text-right border-r border-slate-900 uppercase">
                      Pradinės apimties suma:
                    </td>
                    <td className="p-2 text-right border-r border-slate-900 font-mono tabular-nums">
                      {formatMoneyFixed(resolvedReport.expectedTotalValue)} €
                    </td>
                    <td colSpan={2} className="p-2 text-center font-mono">
                      {resolvedReport.expectedRows.length} vnt.
                    </td>
                  </tr>
                </tbody>
              </table>

              {resolvedReport.additionalRows.length > 0 && (
                <div className="mb-6">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-900">
                    2. Papildomi radiniai (nebuvę pradiniame sesijos sąraše,{' '}
                    {resolvedReport.additionalRows.length} vnt.)
                  </div>
                  <table className="w-full text-left border border-slate-900 text-[10px] border-collapse">
                    <thead>
                      <tr className="bg-indigo-50 border-b border-slate-900 font-bold text-slate-900">
                        <th className="p-1.5 border-r border-slate-900 text-center w-7">Eil.</th>
                        <th className="p-1.5 border-r border-slate-900 w-24">Inv. Nr.</th>
                        <th className="p-1.5 border-r border-slate-900">Turto pavadinimas</th>
                        <th className="p-1.5 border-r border-slate-900 w-32">Priskirta → Rasta</th>
                        <th className="p-1.5 border-r border-slate-900 w-24">Atsakingas</th>
                        <th className="p-1.5 border-r border-slate-900 text-right w-16">
                          Vertė, €
                        </th>
                        <th className="p-1.5 w-28">Patikra / Pastabos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-400">
                      {resolvedReport.additionalRows.map((row, idx) => (
                        <tr key={row.itemId}>
                          <td className="p-1.5 border-r border-slate-900 text-center font-mono">
                            {idx + 1}
                          </td>
                          <td className="p-1.5 border-r border-slate-900 font-mono font-semibold whitespace-nowrap">
                            {row.inventoryNumber}
                          </td>
                          <td className="p-1.5 border-r border-slate-900">
                            <div className="font-medium text-slate-900">{row.name}</div>
                            {row.excludedStatusException && (
                              <div className="text-[9px] text-rose-700 font-semibold">
                                Išimtis: statusas buvo neįtrauktas į apimtį
                              </div>
                            )}
                            {row.hasIncompleteHistory && (
                              <div className="text-[9px] text-amber-800">
                                Riboti senos sesijos duomenys
                              </div>
                            )}
                          </td>
                          <td className="p-1.5 border-r border-slate-900 text-slate-700">
                            <div>
                              {row.expectedDepartmentName} ({row.expectedRoomName})
                            </div>
                            <div className="font-semibold text-amber-800">
                              → {row.checkRecord?.actualRoomName || '—'}
                            </div>
                          </td>
                          <td className="p-1.5 border-r border-slate-900 text-slate-700">
                            {row.responsibleUserName}
                          </td>
                          <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">
                            {formatMoneyFixed(row.purchasePrice)}
                          </td>
                          <td className="p-1.5 text-[9.5px] text-slate-600">{row.checkMetaLabel}</td>
                        </tr>
                      ))}
                      <tr className="bg-indigo-50/70 font-bold border-t-2 border-slate-900">
                        <td
                          colSpan={5}
                          className="p-2 text-right border-r border-slate-900 uppercase"
                        >
                          Papildomų radinių suma:
                        </td>
                        <td className="p-2 text-right border-r border-slate-900 font-mono tabular-nums">
                          {formatMoneyFixed(resolvedReport.additionalTotalValue)} €
                        </td>
                        <td className="p-2 text-center font-mono">
                          {resolvedReport.additionalRows.length} vnt.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mb-5 p-2.5 border border-slate-300 rounded bg-slate-50 text-[11px] flex flex-wrap justify-between gap-2 print-avoid-break">
                <span>
                  Pradinė apimtis: <strong>{resolvedReport.stats.total} vnt.</strong>
                </span>
                <span>
                  Rasta vietoje:{' '}
                  <strong className="text-emerald-800">
                    {resolvedReport.stats.foundInPlaceCount} vnt.
                  </strong>
                </span>
                <span>
                  Rasta kitur:{' '}
                  <strong className="text-amber-800">
                    {resolvedReport.stats.foundElsewhereCount} vnt.
                  </strong>
                </span>
                <span>
                  Trūksta:{' '}
                  <strong className="text-rose-800">
                    {resolvedReport.stats.missingCount} vnt.
                  </strong>
                </span>
                <span>
                  Dar nepatikrinta:{' '}
                  <strong className="text-slate-700">
                    {resolvedReport.stats.uncheckedCount} vnt.
                  </strong>
                </span>
                {resolvedReport.additionalRows.length > 0 && (
                  <span>
                    Papildomi radiniai:{' '}
                    <strong className="text-indigo-900">
                      {resolvedReport.additionalRows.length} vnt.
                    </strong>
                  </span>
                )}
              </div>

              <div className="space-y-4 pt-2 text-xs print-avoid-break">
                <div className="font-bold">Inventorizacijos komisija:</div>
                {renderCommissionSignaturesGrid(
                  resolvedReport.committeeChairman,
                  resolvedReport.committeeMembers
                )}
              </div>
            </div>
          )}

          {/* REPORT 2: REGISTRY LIST (SEPARATED FROM PHYSICAL AUDIT) */}
          {resolvedReport.kind === 'inventory_sheet' && !resolvedReport.isEmpty && (
            <div>
              <div className="flex justify-end mb-6 text-xs text-slate-800 print-avoid-break">
                <div className="w-72 border border-slate-400 p-3 text-left">
                  <div className="font-bold text-[11px] uppercase">TVIRTINU:</div>
                  <div className="mt-1 text-[11px]">
                    {resolvedReport.organization.directorTitle}
                  </div>
                  <div className="mt-4 border-b border-slate-400"></div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>(Parašas)</span>
                    <span>
                      {resolvedReport.organization.directorName || '(Vardas, pavardė)'}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px]">
                    Data: ____ m. ______________ mėn. ____ d.
                  </div>
                </div>
              </div>

              <div className="text-center space-y-1 mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {resolvedReport.documentTitle}
                </h3>
                <div className="text-xs font-mono text-slate-600">
                  Nr. {resolvedReport.documentNumber} · Sudarymo data: {resolvedReport.generatedDate}
                </div>
                <div className="text-xs text-slate-700 pt-1">
                  Objektas: <strong>{resolvedReport.departmentLabel}</strong>
                  {resolvedReport.roomLabel && (
                    <>
                      {' '}
                      · Patalpa: <strong>{resolvedReport.roomLabel}</strong>
                    </>
                  )}
                  {resolvedReport.responsibleUserLabel && (
                    <>
                      {' '}
                      · Atsakingas asmuo: <strong>{resolvedReport.responsibleUserLabel}</strong>
                    </>
                  )}
                  {resolvedReport.fundingSourceLabel && (
                    <>
                      {' '}
                      · Šaltinis:{' '}
                      <strong className="text-blue-900">{resolvedReport.fundingSourceLabel}</strong>
                    </>
                  )}
                </div>
              </div>

              <table className="w-full text-left border border-slate-900 text-[10px] border-collapse mb-4">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold text-slate-900">
                    <th className="p-1.5 border-r border-slate-900 text-center w-7">Eil.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inventorinis Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Turto pavadinimas, modelis</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-20">Grupė</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-24">Kilmė</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Patalpa</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-20">
                      Būsena registre
                    </th>
                    <th className="p-1.5 text-right w-20">Įsigijimo, €</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {resolvedReport.rows.map((row, idx) => (
                    <tr key={row.item.id}>
                      <td className="p-1.5 border-r border-slate-900 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 font-mono font-semibold whitespace-nowrap">
                        {row.item.inventoryNumber}
                      </td>
                      <td className="p-1.5 border-r border-slate-900">
                        <div className="font-medium text-slate-900">{row.item.name}</div>
                        {row.item.serialNumber && (
                          <div className="text-[9px] font-mono text-slate-500">
                            S/N: {row.item.serialNumber}
                          </div>
                        )}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-center whitespace-nowrap font-medium">
                        <span
                          className={
                            row.assetClass === 'long_term'
                              ? 'font-semibold text-blue-900'
                              : 'text-slate-600'
                          }
                        >
                          {row.assetClassShortLabel}
                        </span>
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-center whitespace-nowrap text-slate-700">
                        {row.fundingShortLabel}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-slate-700">
                        {row.roomName}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-center font-medium text-slate-800">
                        {row.statusLabel}
                      </td>
                      <td className="p-1.5 text-right font-mono tabular-nums">
                        {formatMoneyFixed(row.purchasePrice)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-900">
                    <td colSpan={6} className="p-2 text-right border-r border-slate-900 uppercase">
                      IŠ VISO:
                    </td>
                    <td className="p-2 text-center border-r border-slate-900 font-mono">
                      {resolvedReport.rows.length} vnt.
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">
                      {formatMoneyFixed(resolvedReport.totalPurchaseValue)} €
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mb-6 text-[11px] text-slate-600 print-avoid-break">
                {buildResidualSummaryText(resolvedReport.residualSummary)}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2 text-xs print:grid-cols-2 print-avoid-break">
                <div>
                  <div className="text-slate-600 text-[11px]">
                    {resolvedReport.organization.directorTitle}:
                  </div>
                  <div className="border-b border-slate-500 h-6"></div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>(Parašas)</span>
                    <span>{resolvedReport.organization.directorName || '________________'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-slate-600 text-[11px]">Materialiai atsakingas asmuo:</div>
                  <div className="border-b border-slate-500 h-6"></div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>(Parašas)</span>
                    <span>{resolvedReport.responsibleUserLabel || '________________'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* REPORT 3: WRITE-OFF ACT */}
          {resolvedReport.kind === 'writeoff_act' && !resolvedReport.isEmpty && resolvedReport.act && (
            <div>
              <div className="text-center space-y-1 mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {resolvedReport.documentTitle}
                </h3>
                <div className="text-xs font-mono text-slate-700">
                  Nr. {resolvedReport.act.actNumber} · Data: {resolvedReport.act.date}
                  {resolvedReport.actYear && (
                    <span>
                      {' '}
                      · Archyvo metai: <strong>{resolvedReport.actYear} m.</strong>
                    </span>
                  )}
                  {resolvedReport.act.status === 'approved' ? (
                    <span className="ml-2 font-sans font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[10px]">
                      Patvirtintas aktas
                    </span>
                  ) : resolvedReport.act.status === 'cancelled' ? (
                    <span className="ml-2 font-sans font-semibold text-slate-700 bg-slate-200 px-2 py-0.5 rounded text-[10px]">
                      Atšauktas projektas
                    </span>
                  ) : (
                    <span className="ml-2 font-sans font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded text-[10px]">
                      Projekto būsena
                    </span>
                  )}
                </div>
              </div>

              {resolvedReport.usesFallbackCurrentOrg && (
                <div className="mb-4 p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                  Pastaba: šiame akte nebuvo išsaugoto įstaigos rekvizitų momento, todėl rodomi dabartiniai įstaigos rekvizitai.
                </div>
              )}

              <div className="text-xs text-slate-800 space-y-3 mb-6">
                <p>
                  Komisija, sudaryta įstaigos vadovo įsakymu, apžiūrėjo ir įvertino žemiau nurodytą
                  turtą:
                </p>
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="font-semibold">Nurašymo priežastis / pagrindas:</div>
                  <div>{resolvedReport.act.reasonCategory}</div>
                  {resolvedReport.act.notes && (
                    <div className="text-slate-600 italic mt-1">{resolvedReport.act.notes}</div>
                  )}
                </div>
              </div>

              <table className="w-full text-left border border-slate-900 text-[11px] border-collapse mb-6">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold text-slate-900">
                    <th className="p-1.5 border-r border-slate-900 text-center w-8">Eil.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inventorinis Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Turto pavadinimas</th>
                    <th className="p-1.5 border-r border-slate-900 text-right w-24">
                      Pradinė vertė, €
                    </th>
                    <th className="p-1.5">Nurašymo priežastis / defektas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {resolvedReport.rows.map((row, idx) => (
                    <tr key={row.itemId}>
                      <td className="p-1.5 border-r border-slate-900 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 font-mono font-semibold">
                        {row.inventoryNumber}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 font-medium">
                        <div>{row.name}</div>
                        {row.restoredNote && (
                          <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mt-1">
                            {row.restoredNote}
                          </div>
                        )}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">
                        {formatMoneyFixed(row.price)}
                      </td>
                      <td className="p-1.5 text-slate-700">{row.reason}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold border-t border-slate-900">
                    <td colSpan={3} className="p-1.5 text-right border-r border-slate-900 uppercase">
                      BENDRA SUMA:
                    </td>
                    <td className="p-1.5 text-right border-r border-slate-900 font-mono tabular-nums">
                      {formatMoneyFixed(resolvedReport.totalPrice)} €
                    </td>
                    <td className="p-1.5">Viso: {resolvedReport.rows.length} vnt.</td>
                  </tr>
                </tbody>
              </table>

              {resolvedReport.rejectedItems.length > 0 && (
                <div className="mb-6 p-3 bg-slate-50 border border-slate-300 rounded text-[11px] space-y-1 print-avoid-break">
                  <div className="font-bold text-slate-800">
                    Atmesti nurašymo teikimai iš šio projekto (
                    {resolvedReport.rejectedItems.length}):
                  </div>
                  {resolvedReport.rejectedItems.map((rej) => (
                    <div key={`${rej.itemId}-${rej.rejectedAt}`} className="text-slate-600">
                      • <strong>[{rej.inventoryNumber}] {rej.name}</strong> — atmesta{' '}
                      {getCalendarDatePart(rej.rejectedAt)}
                      {rej.rejectedByUserName ? ` (${rej.rejectedByUserName})` : ''}:{' '}
                      {rej.rejectionReason}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4 pt-4 text-xs print-avoid-break">
                <div className="font-bold">Komisijos narių parašai:</div>
                {renderCommissionSignaturesGrid(
                  resolvedReport.committeeChair,
                  resolvedReport.committeeMembers
                )}
              </div>
            </div>
          )}

          {/* REPORT 4: USER SUMMARY */}
          {resolvedReport.kind === 'user_sheet' && !resolvedReport.isEmpty && (
            <div>
              <div className="text-center space-y-1 mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {resolvedReport.documentTitle}
                </h3>
                <div className="text-xs text-slate-700">
                  Atsakingas asmuo: <strong>{resolvedReport.targetUser?.fullName}</strong> (
                  {resolvedReport.targetUser?.roleTitle})
                </div>
                <div className="text-xs text-slate-500">
                  Sudarymo data: {resolvedReport.generatedDate}
                </div>
              </div>

              <table className="w-full text-left border border-slate-900 text-[11px] border-collapse mb-4">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold">
                    <th className="p-1.5 border-r border-slate-900 text-center w-8">Nr.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inventorinis Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Pavadinimas</th>
                    <th className="p-1.5 border-r border-slate-900">Patalpa</th>
                    <th className="p-1.5 border-r border-slate-900 text-right w-20">Vertė, €</th>
                    <th className="p-1.5 text-center w-20">Būklė</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {resolvedReport.rows.map((row, idx) => (
                    <tr key={row.item.id}>
                      <td className="p-1.5 border-r border-slate-900 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-1.5 border-r border-slate-900 font-mono font-semibold">
                        {row.item.inventoryNumber}
                      </td>
                      <td className="p-1.5 border-r border-slate-900">
                        <div>{row.item.name}</div>
                        <div className="text-[9.5px] text-slate-500">{row.assetClassShortLabel}</div>
                      </td>
                      <td className="p-1.5 border-r border-slate-900">{row.roomName}</td>
                      <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">
                        {formatMoneyFixed(row.purchasePrice)}
                      </td>
                      <td className="p-1.5 text-center text-slate-700">{row.conditionLabel}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold border-t border-slate-900">
                    <td colSpan={4} className="p-1.5 text-right border-r border-slate-900 uppercase">
                      BENDRA VERTĖ:
                    </td>
                    <td className="p-1.5 text-right border-r border-slate-900 font-mono tabular-nums">
                      {formatMoneyFixed(resolvedReport.totalPurchaseValue)} €
                    </td>
                    <td className="p-1.5 text-center font-mono">
                      {resolvedReport.rows.length} vnt.
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mb-6 text-[11px] text-slate-600 print-avoid-break">
                {buildResidualSummaryText(resolvedReport.residualSummary)}
              </div>

              <div className="pt-4 text-xs text-slate-800 space-y-4 print-avoid-break">
                <p>
                  Visą šiame apyraše nurodytą turtą patikrinau, priėmiau savo žinion ir prisiimu
                  pilną materialinę atsakomybę už jo saugumą:
                </p>
                <div className="flex justify-between items-end pt-4">
                  <div className="w-64 border-b border-slate-500 h-6"></div>
                  <div className="text-right">
                    <strong>{resolvedReport.targetUser?.fullName}</strong>
                    <div className="text-[10px] text-slate-500">
                      Data: {resolvedReport.generatedDate}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
