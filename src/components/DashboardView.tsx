import React from 'react';
import { 
  Boxes, 
  Euro, 
  Wrench, 
  Trash2, 
  CheckCircle2, 
  ArrowRight, 
  Building2, 
  QrCode, 
  FileText,
  Clock,
  Landmark,
  Scale
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  MovementRecord, 
  AuditSession,
  User 
} from '../types/inventory';
import { NavigationTab } from './Sidebar';
import { computeAuditStats, getEffectiveSessionRows } from '../utils/auditUtils';
import { computeInventorySummary, formatMoneyLt } from '../utils/accountingUtils';

interface DashboardViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  movements: MovementRecord[];
  auditSession?: AuditSession;
  users?: User[];
  currentUser: User;
  onNavigate: (tab: NavigationTab) => void;
  onOpenAddItem: () => void;
  onOpenTransferModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  items,
  departments,
  rooms,
  movements,
  auditSession,
  users = [],
  currentUser,
  onNavigate,
  onOpenAddItem,
  onOpenTransferModal,
}) => {
  // Unified accounting summary (excludes archived written-off assets from active school balance)
  const summary = computeInventorySummary(items, departments, { includeWrittenOff: false });
  const totalNonWrittenOffItems = summary.nonWrittenOffTotalCount;
  const activeItems = summary.statusCounts.active;
  const inRepairItems = summary.statusCounts.in_repair;
  const toWriteOffItems = summary.statusCounts.to_writeoff;
  const writtenOffItems = summary.statusCounts.written_off;

  const totalPurchaseValue = summary.totalPurchaseValue;
  const longTermValue = summary.longTerm.purchaseValue;
  const shortTermValue = summary.shortTerm.purchaseValue;

  const auditRows = auditSession
    ? getEffectiveSessionRows(auditSession, items, departments, rooms, users, 'all')
    : [];
  const auditStats = computeAuditStats(auditRows);
  const scannedCount = auditStats.checkedCount;
  const auditExpectedTotal = auditStats.total;
  const auditProgressPct = auditStats.progressPercent;

  // Department distribution (non-written-off)
  const deptStats = summary.departments.map((entry) => ({
    department: entry.department,
    itemsCount: entry.itemsCount,
    roomsCount: rooms.filter((r) => r.departmentId === entry.department.id).length,
    totalValue: entry.totalPurchaseValue,
  }));

  const projectCombinedCount = summary.funding.project.count + summary.funding.donation.count;
  const projectCombinedValue =
    Math.round((summary.funding.project.purchaseValue + summary.funding.donation.purchaseValue) * 100) /
    100;

  return (
    <div className="space-y-6">
      {/* Role greeting banner */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Sveiki, {currentUser.fullName}
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-600 mt-1 font-medium">
            <span className="font-semibold text-blue-700">{currentUser.roleTitle}</span>
            <span aria-hidden="true">·</span>
            <span>Prisijungta prie Telšių raj. Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistemos</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {(currentUser.role === 'admin' || currentUser.role === 'manager') && (
            <>
              <button
                onClick={onOpenAddItem}
                className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-xs whitespace-nowrap cursor-pointer"
              >
                + Registruoti turtą
              </button>
              <button
                onClick={onOpenTransferModal}
                className="px-3.5 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 rounded-lg transition-all shadow-2xs whitespace-nowrap cursor-pointer"
              >
                Perkelti turtą
              </button>
            </>
          )}
          <button
            onClick={() => onNavigate('audit')}
            className="px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-all whitespace-nowrap cursor-pointer"
          >
            Inventorizacijos skeneris
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Non-Written-Off Items */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Materialusis turtas</span>
            <Boxes className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
              {totalNonWrittenOffItems}
            </span>
            <span className="text-xs font-semibold text-slate-600">vnt. (nenurašyto)</span>
          </div>
          <div className="mt-1 text-xs text-slate-600 font-medium">
            <span className="text-emerald-700 font-semibold">{activeItems} aktyvūs</span>
            <span className="mx-1">·</span>
            <span>{rooms.length} kab.</span>
            {writtenOffItems > 0 && (
              <>
                <span className="mx-1">·</span>
                <span className="text-purple-700">{writtenOffItems} archyve</span>
              </>
            )}
          </div>
        </div>

        {/* Total Valuation */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Bendra įsigijimo vertė</span>
            <Euro className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
              {formatMoneyLt(totalPurchaseValue, false)}
            </span>
            <span className="text-xs font-bold text-slate-600">€</span>
          </div>
          <div className="mt-1 text-xs text-slate-600 font-medium">
            IMT: <span className="font-mono tabular-nums font-bold text-slate-900">{formatMoneyLt(longTermValue)}</span>
            {summary.residualSummary.knownCount > 0 && (
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Likutinė ({summary.residualSummary.knownCount}/{summary.residualSummary.totalCount} vnt.):{' '}
                <strong className="font-mono">{formatMoneyLt(summary.residualSummary.knownTotal)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Audit Progress */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">
              {auditSession ? `${auditSession.year} m. inventorizacija` : 'Inventorizacija'}
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
              {auditProgressPct}%
            </span>
            <span className="text-xs font-semibold text-slate-600">
              {auditSession ? `(${scannedCount} iš ${auditExpectedTotal})` : '(sesija nepradėta)'}
            </span>
          </div>
          <div className="mt-2 w-full bg-slate-200 rounded-full h-2 overflow-hidden border border-slate-300/40">
            <div 
              className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${auditProgressPct}%` }}
            />
          </div>
        </div>

        {/* Maintenance / Write-off Attention */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Dėmesio reikalaujantis</span>
            <div className="flex items-center gap-1">
              <Wrench className="w-3.5 h-3.5 text-amber-600" />
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div>
              <span className="text-xl font-bold font-mono tabular-nums text-amber-700">
                {inRepairItems}
              </span>
              <span className="text-xs font-semibold text-slate-600 ml-1">remontuojami</span>
            </div>
            <div>
              <span className="text-xl font-bold font-mono tabular-nums text-rose-700">
                {toWriteOffItems}
              </span>
              <span className="text-xs font-semibold text-slate-600 ml-1">nurašomi</span>
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-600 font-medium">
            {writtenOffItems > 0 ? `Archyve nurašyta: ${writtenOffItems} vnt.` : 'Nurašymų archyvas tuščias'}
          </div>
        </div>
      </div>

      {/* Accounting Classification & Funding Origin (VSAKIS & Panauda) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: IMT vs TMT */}
        <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-4 h-4 text-blue-600" />
                <span>Apskaitos klasifikacija (VSAKIS)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Ilgalaikis turtas (IMT) ir trumpalaikis / mažavertis inventorius (TMT)
              </p>
            </div>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-xs text-blue-700 hover:text-blue-900 font-bold cursor-pointer"
            >
              Filtruoti registre →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-3">
              <span className="text-[11px] font-semibold text-blue-900 block">
                Ilgalaikis turtas (IMT)
              </span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-mono text-blue-950">
                  {summary.longTerm.count}
                </span>
                <span className="text-xs text-blue-800">vnt.</span>
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-blue-900">
                {formatMoneyLt(longTermValue)}
              </div>
              <p className="text-[10px] text-blue-700 mt-1">
                Priskirtas IMT arba ≥ 750 € be klasės
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <span className="text-[11px] font-semibold text-slate-800 block">
                Trumpalaikis / Mažavertis (TMT)
              </span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-mono text-slate-900">
                  {summary.shortTerm.count}
                </span>
                <span className="text-xs text-slate-600">vnt.</span>
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-slate-800">
                {formatMoneyLt(shortTermValue)}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Priskirtas TMT arba &lt; 750 € be klasės
              </p>
            </div>
          </div>
        </div>

        {/* Card 2: Funding Origin & Panauda */}
        <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Landmark className="w-4 h-4 text-amber-600" />
                <span>Turto kilmė ir Panaudos sutartys</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Mokyklos lėšos, Savivaldybės ir ŠMSM centralizuotas tiekimas
              </p>
            </div>
          </div>

          <div className="space-y-2.5 mt-3">
            <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-amber-50/80 border border-amber-300/80 shadow-2xs">
              <div>
                <span className="font-bold text-amber-950">Savivaldybės panauda</span>
                <span className="text-[10px] text-amber-800 block">Telšių rajono savivaldybės perduotas turtas</span>
              </div>
              <div className="text-right font-mono">
                <div className="font-extrabold text-amber-950">{summary.funding.municipality.count} vnt.</div>
                <div className="text-[11px] font-bold text-amber-900">{formatMoneyLt(summary.funding.municipality.purchaseValue)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-purple-50/80 border border-purple-300/80 shadow-2xs">
              <div>
                <span className="font-bold text-purple-950">ŠMSM panauda</span>
                <span className="text-[10px] text-purple-800 block">Ministerijos centralizuotas aprūpinimas</span>
              </div>
              <div className="text-right font-mono">
                <div className="font-extrabold text-purple-950">{summary.funding.ministry.count} vnt.</div>
                <div className="text-[11px] font-bold text-purple-900">{formatMoneyLt(summary.funding.ministry.purchaseValue)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-slate-50 border border-slate-300 shadow-2xs">
              <div>
                <span className="font-bold text-slate-800">Gimnazijos biudžeto lėšos</span>
                <span className="text-[10px] text-slate-600 block">Mokyklos tiesiogiai įsigytas inventorius</span>
              </div>
              <div className="text-right font-mono">
                <div className="font-extrabold text-slate-900">{summary.funding.school.count} vnt.</div>
                <div className="text-[11px] font-bold text-slate-700">{formatMoneyLt(summary.funding.school.purchaseValue)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-emerald-50/80 border border-emerald-300/80 shadow-2xs">
              <div>
                <span className="font-bold text-emerald-950">ES projektai &amp; Kita</span>
                <span className="text-[10px] text-emerald-800 block">STEAM, TŪM projektai ir kita kilmė</span>
              </div>
              <div className="text-right font-mono">
                <div className="font-extrabold text-emerald-950">{projectCombinedCount} vnt.</div>
                <div className="text-[11px] font-bold text-emerald-900">{formatMoneyLt(projectCombinedValue)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Section: Departments Breakdown & Recent Movements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Department Overview */}
        <div className="lg:col-span-2 bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Struktūriniai mokyklos skyriai
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Turto pasiskirstymas pagal korpusus ir patalpas
              </p>
            </div>
            <button
              onClick={() => onNavigate('departments')}
              className="text-xs text-blue-700 hover:text-blue-900 font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>Visi kabinetai</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {deptStats.map(({ department, itemsCount, roomsCount, totalValue }) => (
              <div key={department.id} className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50/80 px-2 rounded-lg transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {department.name}
                    </span>
                    <span className="text-xs text-slate-500 font-mono font-semibold">[{department.code}]</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 ml-6 truncate font-medium">
                    {department.building}
                  </p>
                </div>

                <div className="flex items-center gap-6 text-right shrink-0">
                  <div className="text-xs">
                    <span className="font-mono tabular-nums font-bold text-slate-900">{itemsCount}</span>
                    <span className="text-slate-600 ml-1 font-medium">vnt.</span>
                    <span className="text-slate-300 mx-1.5">/</span>
                    <span className="text-slate-600 font-medium">{roomsCount} kab.</span>
                  </div>
                  <div className="text-xs font-mono tabular-nums font-bold text-slate-900 min-w-20 text-right">
                    {formatMoneyLt(totalValue)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column (1/3): Quick Tools & Audit Action */}
        <div className="space-y-4">
          {/* Quick Actions Card */}
          <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Greitieji veiksmai
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => onNavigate('labels')}
                className="w-full flex items-center justify-between p-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200/80 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <QrCode className="w-4 h-4 text-blue-600" />
                  <div>
                    <div className="font-medium">QR etikečių lapas</div>
                    <div className="text-[11px] text-slate-400">A4 lipdukai spausdintuvui</div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onNavigate('reports')}
                className="w-full flex items-center justify-between p-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200/80 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <div>
                    <div className="font-medium">Inventorizacijos apyrašas</div>
                    <div className="text-[11px] text-slate-400">Oficiali forma pagal skyrius</div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onNavigate('selfhost')}
                className="w-full flex items-center justify-between p-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200/80 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-purple-600" />
                  <div>
                    <div className="font-medium">Atsarginė kopija (Backup)</div>
                    <div className="text-[11px] text-slate-400">Proxmox / JSON eksportas</div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Recent movements snippet */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Paskutiniai perkėlimai
              </h3>
              <button
                onClick={() => onNavigate('movements')}
                className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"
              >
                Visi
              </button>
            </div>
            <div className="space-y-3">
              {movements.slice(0, 3).map((mov) => (
                <div key={mov.id} className="text-xs border-b border-slate-100 pb-2.5 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span className="font-mono text-slate-700 font-medium">{mov.actNumber}</span>
                    <span className="font-mono">{mov.date}</span>
                  </div>
                  <p className="font-medium text-slate-800 mt-0.5 truncate">
                    {mov.itemName}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    Priežastis: {mov.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
