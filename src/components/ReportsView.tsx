import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Download, 
  Calendar, 
  UserCheck, 
  CheckCircle, 
  Building2,
  FileSpreadsheet
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  WriteOffAct,
  AssetClass,
  FundingSource,
  LONG_TERM_THRESHOLD,
  FUNDING_SOURCE_LABELS,
  FUNDING_SOURCE_SHORT_LABELS,
  ASSET_CLASS_LABELS,
  formatRoomName
} from '../types/inventory';

interface ReportsViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  writeOffActs: WriteOffAct[];
  currentUser: User;
  onExportCSV: () => void;
  onSaveWriteOffAct: (act: WriteOffAct) => void;
  onApproveWriteOffAct?: (actId: string, approvalYear: number) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  items,
  departments,
  rooms,
  users,
  writeOffActs,
  currentUser,
  onExportCSV,
  onSaveWriteOffAct,
  onApproveWriteOffAct,
}) => {
  const [reportType, setReportType] = useState<'inventory_sheet' | 'writeoff_act' | 'user_sheet'>('inventory_sheet');

  // Filters for inventory sheet
  const [filterDeptId, setFilterDeptId] = useState<string>('all');
  const [filterRoomId, setFilterRoomId] = useState<string>('all');
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [filterAssetClass, setFilterAssetClass] = useState<'all' | AssetClass>('all');
  const [filterFundingSource, setFilterFundingSource] = useState<'all' | FundingSource>('all');

  // Active write-off act and year filter
  const [selectedWriteOffActId, setSelectedWriteOffActId] = useState<string>(writeOffActs[0]?.id || '');
  const [filterActYear, setFilterActYear] = useState<'all' | number>('all');
  const [selectedApprovalYear, setSelectedApprovalYear] = useState<number>(new Date().getFullYear());

  const actYears = useMemo(() => {
    const years = new Set<number>();
    writeOffActs.forEach(a => {
      const yr = a.actYear || (a.date ? new Date(a.date).getFullYear() : 2026);
      years.add(yr);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [writeOffActs]);

  const displayedActs = useMemo(() => {
    if (filterActYear === 'all') return writeOffActs;
    return writeOffActs.filter(a => {
      const yr = a.actYear || (a.date ? new Date(a.date).getFullYear() : 2026);
      return yr === filterActYear;
    });
  }, [writeOffActs, filterActYear]);

  // Filtered items for current report
  const reportItems = useMemo(() => {
    return items.filter(item => {
      if (reportType === 'inventory_sheet') {
        if (filterDeptId !== 'all' && item.departmentId !== filterDeptId) return false;
        if (filterRoomId !== 'all' && item.roomId !== filterRoomId) return false;
        if (filterUserId !== 'all' && item.responsibleUserId !== filterUserId) return false;
        
        if (filterAssetClass !== 'all') {
          const itemClass = item.assetClass || (item.purchasePrice >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term');
          if (itemClass !== filterAssetClass) return false;
        }

        if (filterFundingSource !== 'all') {
          const source = item.fundingSource || 'school';
          if (source !== filterFundingSource) return false;
        }

        return item.status !== 'written_off';
      } else if (reportType === 'user_sheet') {
        const targetUser = filterUserId === 'all' ? (users[0]?.id || '') : filterUserId;
        if (item.responsibleUserId !== targetUser) return false;

        if (filterAssetClass !== 'all') {
          const itemClass = item.assetClass || (item.purchasePrice >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term');
          if (itemClass !== filterAssetClass) return false;
        }

        return item.status !== 'written_off';
      }
      return true;
    });
  }, [items, reportType, filterDeptId, filterRoomId, filterUserId, filterAssetClass, filterFundingSource, users]);

  const totalPurchaseValue = reportItems.reduce((acc, i) => acc + (i.purchasePrice || 0), 0);

  const activeWriteOff = writeOffActs.find(a => a.id === selectedWriteOffActId) || displayedActs[0] || writeOffActs[0];

  const selectedDepartment = departments.find(d => d.id === filterDeptId);
  const selectedRoom = rooms.find(r => r.id === filterRoomId);
  const selectedUser = users.find(u => u.id === (reportType === 'user_sheet' ? (filterUserId === 'all' ? users[0]?.id : filterUserId) : filterUserId));

  // --- DOCX / Word File Download Generator ---
  const handleDownloadWordDoc = () => {
    let title = '';
    let bodyContent = '';
    const dateStr = new Date().toISOString().slice(0, 10);

    if (reportType === 'inventory_sheet') {
      title = `Inventorizacijos-apyrasas-${dateStr}`;
      const assetClassTitle = filterAssetClass === 'long_term'
        ? 'ILGALAIKIO MATERIALIOJO TURTO (NUO 750 €) INVENTORIZACIJOS APYRAŠAS'
        : filterAssetClass === 'short_term'
        ? 'TRUMPALAIKIO IR MAŽAVERČIO TURTO INVENTORIZACIJOS APYRAŠAS'
        : 'MATERIALIOJO TURTO INVENTORIZACIJOS APYRAŠAS';

      const tableRows = reportItems.map((item, idx) => {
        const isIMT = item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD;
        const funding = FUNDING_SOURCE_SHORT_LABELS[item.fundingSource] || 'Gimnazijos lėšos';
        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td><b>${item.inventoryNumber}</b></td>
          <td>${item.name} ${item.serialNumber ? `(SN: ${item.serialNumber})` : ''}</td>
          <td style="text-align:center;">${isIMT ? 'IMT (≥750€)' : 'TMT (<750€)'}</td>
          <td style="text-align:center;">${funding}</td>
          <td style="text-align:center;">vnt.</td>
          <td style="text-align:center;">1</td>
          <td style="text-align:right;">${item.purchasePrice.toFixed(2)}</td>
          <td style="text-align:center;">Yra</td>
        </tr>`;
      }).join('');

      bodyContent = `
        <div style="text-align:right; margin-bottom:15pt;">
          <div style="border:1pt solid #000; padding:8pt; display:inline-block; width:200pt; text-align:left;">
            <b>TVIRTINU:</b><br/>
            Gimnazijos direktorius<br/><br/>
            ____________________ (Parašas)<br/>
            Data: 2026 m. ____________ d.
          </div>
        </div>
        <div style="text-align:center; margin-bottom:15pt;">
          <h3 style="margin:0; font-size:12pt; text-transform:uppercase;">${assetClassTitle}</h3>
          <div style="font-size:10pt; color:#444;">Nr. INV-2026/01 · Sudarymo data: ${dateStr}</div>
          <div style="font-size:9.5pt; margin-top:4pt;">
            Objektas: <b>${selectedDepartment ? selectedDepartment.name : 'Visi mokyklos skyriai'}</b>
            ${selectedRoom ? ` · Patalpa: <b>${formatRoomName(selectedRoom)}</b>` : ''}
            ${selectedUser ? ` · Atsakingas asmuo: <b>${selectedUser.fullName}</b>` : ''}
          </div>
        </div>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:9.5pt;">
          <thead>
            <tr style="background-color:#f2f2f2;">
              <th style="width:25pt; text-align:center;">Eil.</th>
              <th style="width:80pt;">Inventorinis Nr.</th>
              <th>Pavadinimas, markė</th>
              <th style="text-align:center;">Grupė</th>
              <th style="text-align:center;">Kilmė</th>
              <th style="text-align:center;">Matas</th>
              <th style="text-align:center;">Kiekis</th>
              <th style="text-align:right; width:60pt;">Įsigijimo, €</th>
              <th style="text-align:center; width:45pt;">Būklė</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            <tr style="background-color:#f9f9f9; font-weight:bold;">
              <td colspan="6" style="text-align:right;">IŠ VISO:</td>
              <td style="text-align:center;">${reportItems.length} vnt.</td>
              <td style="text-align:right;">${totalPurchaseValue.toFixed(2)} €</td>
              <td style="text-align:center;">-</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:20pt; font-size:10pt;">
          <p><b>Inventorizacijos komisija:</b></p>
          <table border="0" style="width:100%; border:none;">
            <tr>
              <td style="border:none; width:50%;">Komisijos pirmininkas: ____________________ Kęstutis Labanauskas</td>
              <td style="border:none; width:50%;">Vyriausioji buhalterė: ____________________ Dalia Vaitkutė</td>
            </tr>
            <tr>
              <td style="border:none; width:50%; padding-top:10pt;">Komisijos narys: ____________________ Saulius Petrauskas</td>
              <td style="border:none; width:50%; padding-top:10pt;">Materialiai atsakingas: ____________________ ${selectedUser?.fullName || 'Rasa Jonaitienė'}</td>
            </tr>
          </table>
        </div>
      `;
    } else if (reportType === 'writeoff_act' && activeWriteOff) {
      title = `Nurashymo-aktas-${activeWriteOff.actNumber}`;
      const actYear = activeWriteOff.actYear || (activeWriteOff.date ? new Date(activeWriteOff.date).getFullYear() : 2026);
      const tableRows = activeWriteOff.items.map((item, idx) => `<tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td><b>${item.inventoryNumber}</b></td>
        <td>${item.name}</td>
        <td style="text-align:right;">${item.price.toFixed(2)}</td>
        <td>${item.reason}</td>
      </tr>`).join('');

      const totalActPrice = activeWriteOff.items.reduce((acc, i) => acc + i.price, 0);

      bodyContent = `
        <div style="text-align:center; margin-bottom:15pt;">
          <h3 style="margin:0; font-size:12pt; text-transform:uppercase;">
            NEBETINKAMO EKSPLOATUOTI MATERIALIOJO TURTO NURAŠYMO IR LIKVIDAVIMO AKTAS
          </h3>
          <div style="font-size:10pt; color:#333; margin-top:4pt;">
            Nr. <b>${activeWriteOff.actNumber}</b> · Data: ${activeWriteOff.date} · Archyvo metai: <b>${actYear} m.</b>
          </div>
        </div>
        <div style="font-size:10pt; margin-bottom:12pt;">
          <p>Komisija, sudaryta mokyklos direktoriaus įsakymu, apžiūrėjo ir įvertino žemiau nurodytą turtą:</p>
          <div style="background-color:#f9f9f9; padding:6pt; border:1pt solid #ccc;">
            <b>Nurašymo priežastis / pagrindas:</b> ${activeWriteOff.reasonCategory}<br/>
            ${activeWriteOff.notes ? `<i>${activeWriteOff.notes}</i>` : ''}
          </div>
        </div>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:9.5pt;">
          <thead>
            <tr style="background-color:#f2f2f2;">
              <th style="width:25pt; text-align:center;">Eil.</th>
              <th style="width:90pt;">Inventorinis Nr.</th>
              <th>Turto pavadinimas</th>
              <th style="text-align:right; width:70pt;">Pradinė vertė, €</th>
              <th>Nurašymo priežastis / defektas</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            <tr style="background-color:#f9f9f9; font-weight:bold;">
              <td colspan="3" style="text-align:right;">BENDRA SUMA:</td>
              <td style="text-align:right;">${totalActPrice.toFixed(2)} €</td>
              <td>Likviduojama (utilizuoti)</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:20pt; font-size:10pt;">
          <p><b>Komisijos narių parašai:</b></p>
          <table border="0" style="width:100%; border:none;">
            <tr>
              <td style="border:none; width:50%;">Komisijos pirmininkas: ____________________ ${activeWriteOff.committeeChair}</td>
              <td style="border:none; width:50%;">Vyriausioji buhalterė: ____________________ ${activeWriteOff.committeeMembers[0] || 'Dalia Vaitkutė'}</td>
            </tr>
            <tr>
              <td style="border:none; width:50%; padding-top:10pt;">Komisijos narys: ____________________ ${activeWriteOff.committeeMembers[1] || 'Saulius Petrauskas'}</td>
              <td style="border:none; width:50%; padding-top:10pt;">Mokytojų atstovė: ____________________ ${activeWriteOff.committeeMembers[2] || 'Rasa Jonaitienė'}</td>
            </tr>
          </table>
        </div>
      `;
    } else {
      title = `Materialiai-atsakingo-kortele-${dateStr}`;
      const targetUser = selectedUser || users[0];
      const tableRows = reportItems.map((item, idx) => `<tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td><b>${item.inventoryNumber}</b></td>
        <td>${item.name}</td>
        <td>${rooms.find(r => r.id === item.roomId)?.number || ''} kab.</td>
        <td style="text-align:right;">${item.purchasePrice.toFixed(2)}</td>
        <td style="text-align:center;">${item.condition === 'new' ? 'Nauja' : item.condition === 'good' ? 'Gera' : 'Patenkinama'}</td>
      </tr>`).join('');

      bodyContent = `
        <div style="text-align:center; margin-bottom:15pt;">
          <h3 style="margin:0; font-size:12pt; text-transform:uppercase;">MATERIALIAI ATSAKINGO ASMENS TURTO KORTELĖ</h3>
          <div style="font-size:10pt; color:#333; margin-top:4pt;">
            Atsakingas asmuo: <b>${targetUser?.fullName}</b> (${targetUser?.roleTitle}) · Data: ${dateStr}
          </div>
        </div>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:9.5pt;">
          <thead>
            <tr style="background-color:#f2f2f2;">
              <th style="width:25pt; text-align:center;">Eil.</th>
              <th style="width:90pt;">Inventorinis Nr.</th>
              <th>Turto pavadinimas</th>
              <th>Patalpa</th>
              <th style="text-align:right; width:70pt;">Vertė, €</th>
              <th style="text-align:center; width:50pt;">Būklė</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            <tr style="background-color:#f9f9f9; font-weight:bold;">
              <td colspan="4" style="text-align:right;">BENDRA VERTĖ:</td>
              <td style="text-align:right;">${totalPurchaseValue.toFixed(2)} €</td>
              <td style="text-align:center;">${reportItems.length} vnt.</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:20pt; font-size:10pt;">
          <p>Turtą pagal sąrašą priėmiau ir esu materialiai atsakingas(-a):</p>
          <div style="margin-top:15pt;">
            Parašas: ____________________ (${targetUser?.fullName}) &nbsp;&nbsp;&nbsp;&nbsp; Data: ${dateStr}
          </div>
        </div>
      `;
    }

    const html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>${title}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #000; line-height: 1.3; }
    h2, h3 { text-align: center; }
    table { border-collapse: collapse; width: 100%; margin-top: 10pt; }
    th, td { border: 1pt solid #000; padding: 4pt 6pt; }
    th { background-color: #f2f2f2; font-weight: bold; }
  </style>
</head>
<body>
  <div style="border-bottom: 2pt solid #000; padding-bottom: 8pt; margin-bottom: 12pt; text-align: center;">
    <div style="font-size: 13pt; font-weight: bold; text-transform: uppercase;">TELŠIŲ RAJ. TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMNAZIJA</div>
    <div style="font-size: 9pt; color: #444;">Juridinio asmens kodas: 190581452 · Lazdynų Pelėdos g. 20, LT-88172 Tryškiai, Telšių r. sav.</div>
  </div>
  ${bodyContent}
</body>
</html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Specific Excel Export for the Active Report ---
  const handleDownloadExcel = () => {
    let csv = '';
    const dateStr = new Date().toISOString().slice(0, 10);
    let filename = '';

    if (reportType === 'inventory_sheet') {
      filename = `inventorizacijos-apyrasas-${dateStr}.csv`;
      const header = ['Eil. Nr.', 'Inventorinis Nr.', 'Pavadinimas', 'Grupė', 'Kilmė', 'Matas', 'Kiekis', 'Įsigijimo kaina (€)', 'Būklė'].join(';');
      const rows = reportItems.map((item, idx) => {
        const isIMT = item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD;
        const funding = FUNDING_SOURCE_SHORT_LABELS[item.fundingSource] || 'Gimnazijos lėšos';
        return [
          idx + 1,
          `"${item.inventoryNumber}"`,
          `"${item.name.replace(/"/g, '""')}"`,
          `"${isIMT ? 'IMT (≥750€)' : 'TMT (<750€)'}"`,
          `"${funding}"`,
          'vnt.',
          1,
          item.purchasePrice.toFixed(2).replace('.', ','),
          'Yra'
        ].join(';');
      });
      csv = '\uFEFF' + [header, ...rows].join('\r\n');
    } else if (reportType === 'writeoff_act' && activeWriteOff) {
      filename = `nurashymo-aktas-${activeWriteOff.actNumber}.csv`;
      const header = ['Eil. Nr.', 'Inventorinis Nr.', 'Pavadinimas', 'Pradinė vertė (€)', 'Nurašymo priežastis'].join(';');
      const rows = activeWriteOff.items.map((item, idx) => [
        idx + 1,
        `"${item.inventoryNumber}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        item.price.toFixed(2).replace('.', ','),
        `"${item.reason.replace(/"/g, '""')}"`
      ].join(';'));
      csv = '\uFEFF' + [header, ...rows].join('\r\n');
    } else {
      filename = `atsakingo-asmens-kortele-${dateStr}.csv`;
      const header = ['Eil. Nr.', 'Inventorinis Nr.', 'Pavadinimas', 'Patalpa', 'Vertė (€)', 'Būklė'].join(';');
      const rows = reportItems.map((item, idx) => [
        idx + 1,
        `"${item.inventoryNumber}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${rooms.find(r => r.id === item.roomId)?.number || ''} kab."`,
        item.purchasePrice.toFixed(2).replace('.', ','),
        `"${item.condition === 'new' ? 'Nauja' : item.condition === 'good' ? 'Gera' : 'Patenkinama'}"`
      ].join(';'));
      csv = '\uFEFF' + [header, ...rows].join('\r\n');
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Oficialių ataskaitų ir aktų generatorius
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Valstybinio ir savivaldybių švietimo sektoriaus dokumentai atsisiuntimui Word (DOCX) ir Excel formatais
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadExcel}
              title="Atsisiųsti paruoštą ataskaitą Excel lentelės formatu"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Atsisiųsti Excel (XLSX/CSV)</span>
            </button>
            <button
              onClick={handleDownloadWordDoc}
              title="Atsisiųsti oficialų dokumentą Microsoft Word (DOCX) formatu"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-xs cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Atsisiųsti Word (DOCX)</span>
            </button>
          </div>
        </div>

        {/* Report Type Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg text-xs">
          <button
            onClick={() => setReportType('inventory_sheet')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'inventory_sheet'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            1. Metinės inventorizacijos apyrašas
          </button>
          <button
            onClick={() => setReportType('writeoff_act')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'writeoff_act'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            2. Turto nurašymo ir likvidavimo aktas
          </button>
          <button
            onClick={() => setReportType('user_sheet')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              reportType === 'user_sheet'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-slate-200'
                : 'text-slate-700 hover:text-slate-900 font-semibold'
            }`}
          >
            3. Materialiai atsakingo asmens suvestinė
          </button>
        </div>

        {/* Filter subrow */}
        {reportType === 'inventory_sheet' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-200 text-xs">
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
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
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
                  .filter(r => filterDeptId === 'all' || r.departmentId === filterDeptId)
                  .map(r => (
                    <option key={r.id} value={r.id}>{formatRoomName(r)}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Atsakingas asmuo</label>
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
              >
                <option value="all">Visi asmenys</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900 mb-1">Turto grupė</label>
              <select
                value={filterAssetClass}
                onChange={(e) => setFilterAssetClass(e.target.value as any)}
                className={`w-full bg-white border rounded px-2.5 py-1.5 font-medium ${
                  filterAssetClass !== 'all' ? 'border-blue-500 text-blue-800 bg-blue-50/40' : 'border-slate-300'
                }`}
              >
                <option value="all">Visas turtas (IMT + TMT)</option>
                <option value="long_term">Tik ilgalaikis (IMT ≥ 750 €)</option>
                <option value="short_term">Tik trumpalaikis / mažavertis (&lt; 750 €)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-amber-900 mb-1">Turto kilmė / Panauda</label>
              <select
                value={filterFundingSource}
                onChange={(e) => setFilterFundingSource(e.target.value as any)}
                className={`w-full bg-white border rounded px-2.5 py-1.5 font-medium ${
                  filterFundingSource !== 'all' ? 'border-amber-500 text-amber-800 bg-amber-50/40' : 'border-slate-300'
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
          </div>
        )}

        {reportType === 'writeoff_act' && (
          <div className="pt-2 border-t border-slate-100 text-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-slate-600 font-medium">Metų filtras:</label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setFilterActYear('all')}
                      className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                        filterActYear === 'all'
                          ? 'bg-purple-600 text-white font-semibold'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Visi metai
                    </button>
                    {actYears.map(year => (
                      <button
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
                    value={selectedWriteOffActId}
                    onChange={(e) => setSelectedWriteOffActId(e.target.value)}
                    className="bg-white border border-slate-300 rounded px-3 py-1.5 font-mono"
                  >
                    {displayedActs.map(act => (
                      <option key={act.id} value={act.id}>
                        {act.actNumber} ({act.date}) — {act.items.length} vnt. [{act.status === 'approved' ? `Patvirtintas (${act.actYear || 2025} m.)` : 'Projektas'}]
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Approval controls if draft */}
              {activeWriteOff && activeWriteOff.status === 'draft' && (
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-md">
                  <span className="font-semibold text-rose-900">Aktas nepatvirtintas:</span>
                  <select
                    value={selectedApprovalYear}
                    onChange={(e) => setSelectedApprovalYear(Number(e.target.value))}
                    className="bg-white border border-rose-300 text-xs rounded px-2 py-1 font-semibold text-slate-800"
                  >
                    <option value={2026}>2026 metai</option>
                    <option value={2025}>2025 metai</option>
                    <option value={2020}>2020 metai</option>
                  </select>
                  <button
                    onClick={() => onApproveWriteOffAct && onApproveWriteOffAct(activeWriteOff.id, selectedApprovalYear)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-2xs cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Patvirtinti aktą ir archyvuoti turtą</span>
                  </button>
                </div>
              )}

              {activeWriteOff && activeWriteOff.status === 'approved' && (
                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-md font-medium text-xs">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Aktas patvirtintas {activeWriteOff.approvedDate || activeWriteOff.date} · Archyvo metai: <strong>{activeWriteOff.actYear || 2025} m.</strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {reportType === 'user_sheet' && (
          <div className="pt-2 border-t border-slate-100 text-xs flex items-center gap-3">
            <label className="text-slate-600 font-medium">Mokytojas / Darbuotojas:</label>
            <select
              value={filterUserId === 'all' ? users[0]?.id : filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="bg-white border border-slate-300 rounded px-3 py-1.5 font-medium"
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.roleTitle})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Sheet Preview Display */}
      <div className="bg-slate-200/80 p-4 md:p-8 rounded-xl flex justify-center border border-slate-300">
        <div className="bg-white border border-slate-300 shadow-xl p-8 md:p-12 rounded-xl w-full max-w-[210mm] min-h-[297mm] text-slate-900 leading-normal">
          
          {/* Header of Lithuanian Institutional Form */}
          <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
            <div className="w-16 h-16 shrink-0 flex items-center justify-center p-0.5">
              <img 
                src="/assets/aistudio/__05425c32.jpg" 
                alt="Tryškių Lazdynų Pelėdos herbas" 
                className="max-h-16 max-w-16 object-contain"
              />
            </div>
            <div className="space-y-1 text-center flex-1 px-4">
              <div className="text-sm font-bold uppercase tracking-wider text-slate-900">
                TELŠIŲ RAJ. TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMNAZIJA
              </div>
              <div className="text-[11px] text-slate-600">
                Juridinio asmens kodas: 190581452 · Lazdynų Pelėdos g. 20, LT-88172 Tryškiai, Telšių r. sav.
              </div>
            </div>
            <div className="w-16 shrink-0 hidden sm:block"></div>
          </div>

          {/* REPORT 1: INVENTORY SHEET */}
          {reportType === 'inventory_sheet' && (
            <div>
              {/* Approval Box */}
              <div className="flex justify-end mb-6 text-xs text-slate-800">
                <div className="w-64 border border-slate-400 p-3 text-left">
                  <div className="font-bold text-[11px] uppercase">TVIRTINU:</div>
                  <div className="mt-1 text-[11px]">Gimnazijos direktorius</div>
                  <div className="mt-4 border-b border-slate-400"></div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>(Parašas)</span>
                    <span>(Vardas, pavardė)</span>
                  </div>
                  <div className="mt-2 text-[10px]">Data: 2026 m. ____________ d.</div>
                </div>
              </div>

              {/* Title */}
              <div className="text-center space-y-1 mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  {filterAssetClass === 'long_term' 
                    ? 'ILGALAIKIO MATERIALIOJO TURTO (NUO 750 €) INVENTORIZACIJOS APYRAŠAS'
                    : filterAssetClass === 'short_term'
                    ? 'TRUMPALAIKIO IR MAŽAVERČIO TURTO INVENTORIZACIJOS APYRAŠAS'
                    : 'MATERIALIOJO TURTO INVENTORIZACIJOS APYRAŠAS'}
                </h3>
                <div className="text-xs font-mono text-slate-600">
                  Nr. INV-2026/01 · Sudarymo data: {new Date().toISOString().slice(0, 10)}
                </div>
                <div className="text-xs text-slate-700 pt-1">
                  Objektas: <strong>{selectedDepartment ? selectedDepartment.name : 'Visi mokyklos skyriai'}</strong>
                  {selectedRoom && <> · Patalpa: <strong>{formatRoomName(selectedRoom)}</strong></>}
                  {selectedUser && <> · Atsakingas asmuo: <strong>{selectedUser.fullName}</strong></>}
                  {filterFundingSource !== 'all' && (
                    <> · Šaltinis: <strong className="text-blue-900">{FUNDING_SOURCE_LABELS[filterFundingSource]}</strong></>
                  )}
                </div>
              </div>

              {/* Items Table (Without Residual Value) */}
              <table className="w-full text-left border border-slate-900 text-[10px] border-collapse mb-6">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold text-slate-900">
                    <th className="p-1.5 border-r border-slate-900 text-center w-7">Eil.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inventorinis Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Turto pavadinimas, markė, modelis</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-20">Apskaitos grupė</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-24">Turto kilmė</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-9">Matas</th>
                    <th className="p-1.5 border-r border-slate-900 text-center w-9">Kiekis</th>
                    <th className="p-1.5 border-r border-slate-900 text-right w-20">Įsigijimo, €</th>
                    <th className="p-1.5 text-center w-14">Faktiškai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {reportItems.map((item, idx) => {
                    const isIMT = item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="p-1.5 border-r border-slate-900 text-center font-mono">{idx + 1}</td>
                        <td className="p-1.5 border-r border-slate-900 font-mono font-semibold whitespace-nowrap">{item.inventoryNumber}</td>
                        <td className="p-1.5 border-r border-slate-900">
                          <div className="font-medium text-slate-900">{item.name}</div>
                          {item.serialNumber && <div className="text-[9px] font-mono text-slate-500">S/N: {item.serialNumber}</div>}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-center whitespace-nowrap font-medium">
                          <span className={isIMT ? 'font-semibold text-blue-900' : 'text-slate-600'}>
                            {isIMT ? 'IMT (≥750€)' : 'TMT (<750€)'}
                          </span>
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-center whitespace-nowrap text-slate-700">
                          {FUNDING_SOURCE_SHORT_LABELS[item.fundingSource] || 'Gimnazijos lėšos'}
                        </td>
                        <td className="p-1.5 border-r border-slate-900 text-center">vnt.</td>
                        <td className="p-1.5 border-r border-slate-900 text-center font-mono">1</td>
                        <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">{item.purchasePrice.toFixed(2)}</td>
                        <td className="p-1.5 text-center font-medium text-emerald-800">Yra</td>
                      </tr>
                    );
                  })}
                  {/* Totals Row */}
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-900">
                    <td colSpan={6} className="p-2 text-right border-r border-slate-900 uppercase">IŠ VISO:</td>
                    <td className="p-2 text-center border-r border-slate-900 font-mono">{reportItems.length} vnt.</td>
                    <td className="p-2 text-right border-r border-slate-900 font-mono tabular-nums">{totalPurchaseValue.toFixed(2)} €</td>
                    <td className="p-2 text-center text-slate-600">-</td>
                  </tr>
                </tbody>
              </table>

              {/* Committee signatures */}
              <div className="space-y-4 pt-4 text-xs">
                <div className="font-bold">Inventorizacijos komisija:</div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <div className="text-slate-600 text-[11px]">Komisijos pirmininkas:</div>
                      <div className="border-b border-slate-500 h-6"></div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>(Parašas)</span>
                        <span>Kęstutis Labanauskas</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-600 text-[11px]">Komisijos narys:</div>
                      <div className="border-b border-slate-500 h-6"></div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>(Parašas)</span>
                        <span>Saulius Petrauskas</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="text-slate-600 text-[11px]">Vyriausioji buhalterė:</div>
                      <div className="border-b border-slate-500 h-6"></div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>(Parašas)</span>
                        <span>Dalia Vaitkutė</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-600 text-[11px]">Materialiai atsakingas asmuo:</div>
                      <div className="border-b border-slate-500 h-6"></div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>(Parašas)</span>
                        <span>{selectedUser?.fullName || 'Rasa Jonaitienė'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* REPORT 2: WRITE-OFF ACT (Without Residual Value) */}
          {reportType === 'writeoff_act' && activeWriteOff && (
            <div>
              <div className="text-center space-y-1 mb-8">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  NEBETINKAMO EKSPLOATUOTI MATERIALIOJO TURTO NURAŠYMO IR LIKVIDAVIMO AKTAS
                </h3>
                <div className="text-xs font-mono text-slate-700">
                  Nr. {activeWriteOff.actNumber} · Data: {activeWriteOff.date}
                  {activeWriteOff.actYear && <span> · Archyvo metai: <strong>{activeWriteOff.actYear} m.</strong></span>}
                  {activeWriteOff.status === 'approved' ? (
                    <span className="ml-2 font-sans font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[10px]">
                      Patvirtintas aktas
                    </span>
                  ) : (
                    <span className="ml-2 font-sans font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded text-[10px]">
                      Projekto būsena
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-800 space-y-3 mb-6">
                <p>
                  Komisija, sudaryta mokyklos direktoriaus įsakymu, apžiūrėjo ir įvertino žemiau nurodytą turtą:
                </p>
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="font-semibold">Nurašymo priežastis / pagrindas:</div>
                  <div>{activeWriteOff.reasonCategory}</div>
                  {activeWriteOff.notes && <div className="text-slate-600 italic mt-1">{activeWriteOff.notes}</div>}
                </div>
              </div>

              {/* Items in Act */}
              <table className="w-full text-left border border-slate-900 text-[11px] border-collapse mb-8">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-900 font-bold text-slate-900">
                    <th className="p-1.5 border-r border-slate-900 text-center w-8">Eil.</th>
                    <th className="p-1.5 border-r border-slate-900 w-24">Inventorinis Nr.</th>
                    <th className="p-1.5 border-r border-slate-900">Turto pavadinimas</th>
                    <th className="p-1.5 border-r border-slate-900 text-right w-24">Pradinė vertė, €</th>
                    <th className="p-1.5">Nurašymo priežastis / defektas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-400">
                  {activeWriteOff.items.map((item, idx) => (
                    <tr key={item.itemId}>
                      <td className="p-1.5 border-r border-slate-900 text-center font-mono">{idx + 1}</td>
                      <td className="p-1.5 border-r border-slate-900 font-mono font-semibold">{item.inventoryNumber}</td>
                      <td className="p-1.5 border-r border-slate-900 font-medium">{item.name}</td>
                      <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">{item.price.toFixed(2)}</td>
                      <td className="p-1.5 text-slate-700">{item.reason}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold border-t border-slate-900">
                    <td colSpan={3} className="p-1.5 text-right border-r border-slate-900 uppercase">BENDRA SUMA:</td>
                    <td className="p-1.5 text-right border-r border-slate-900 font-mono tabular-nums">
                      {activeWriteOff.items.reduce((acc, i) => acc + i.price, 0).toFixed(2)} €
                    </td>
                    <td className="p-1.5">Likviduojama (atiduodama utilizavimui)</td>
                  </tr>
                </tbody>
              </table>

              {/* Signatures */}
              <div className="space-y-4 pt-6 text-xs">
                <div className="font-bold">Komisijos narių parašai:</div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <div className="text-slate-600 text-[11px]">Komisijos pirmininkas:</div>
                    <div className="border-b border-slate-500 h-6"></div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{activeWriteOff.committeeChair}</div>
                  </div>
                  <div>
                    <div className="text-slate-600 text-[11px]">Vyriausioji buhalterė:</div>
                    <div className="border-b border-slate-500 h-6"></div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{activeWriteOff.committeeMembers[0]}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* REPORT 3: USER SUMMARY */}
          {reportType === 'user_sheet' && (
            <div>
              <div className="text-center space-y-1 mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  MATERIALIAI ATSAKINGO ASMENS TURTO KORTELĖ
                </h3>
                <div className="text-xs text-slate-700">
                  Atsakingas asmuo: <strong>{selectedUser?.fullName}</strong> ({selectedUser?.roleTitle})
                </div>
                <div className="text-xs text-slate-500">
                  Data: {new Date().toISOString().slice(0, 10)}
                </div>
              </div>

              <table className="w-full text-left border border-slate-900 text-[11px] border-collapse mb-6">
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
                  {reportItems.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="p-1.5 border-r border-slate-900 text-center font-mono">{idx + 1}</td>
                      <td className="p-1.5 border-r border-slate-900 font-mono font-semibold">{item.inventoryNumber}</td>
                      <td className="p-1.5 border-r border-slate-900">{item.name}</td>
                      <td className="p-1.5 border-r border-slate-900">
                        {rooms.find(r => r.id === item.roomId)?.number || ''} kab.
                      </td>
                      <td className="p-1.5 border-r border-slate-900 text-right font-mono tabular-nums">
                        {item.purchasePrice.toFixed(2)}
                      </td>
                      <td className="p-1.5 text-center text-slate-700">
                        {item.condition === 'new' ? 'Nauja' : item.condition === 'good' ? 'Gera' : 'Patenkinama'}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold border-t border-slate-900">
                    <td colSpan={4} className="p-1.5 text-right border-r border-slate-900 uppercase">BENDRA VERTĖ:</td>
                    <td className="p-1.5 text-right border-r border-slate-900 font-mono tabular-nums">
                      {totalPurchaseValue.toFixed(2)} €
                    </td>
                    <td className="p-1.5 text-center font-mono">{reportItems.length} vnt.</td>
                  </tr>
                </tbody>
              </table>

              <div className="pt-8 text-xs text-slate-800 space-y-4">
                <p>
                  Visą šiame apyraše nurodytą turtą patikrinau, priėmiau savo žinion ir prisiimu pilną materialinę atsakomybę už jo saugumą:
                </p>
                <div className="flex justify-between items-end pt-4">
                  <div className="w-64 border-b border-slate-500 h-6"></div>
                  <div className="text-right">
                    <strong>{selectedUser?.fullName}</strong>
                    <div className="text-[10px] text-slate-500">Data: {new Date().toISOString().slice(0, 10)}</div>
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
