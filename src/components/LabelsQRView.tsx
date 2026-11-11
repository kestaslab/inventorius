import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { 
  Filter, 
  CheckSquare, 
  Square, 
  Download, 
  FileText, 
  FileSpreadsheet, 
  Tag, 
  QrCode, 
  Printer, 
  Sparkles, 
  Info, 
  HelpCircle, 
  Bluetooth, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  Search, 
  Layers, 
  CheckCircle2, 
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { InventoryItem, Department, Room, formatRoomName } from '../types/inventory';
import { directPrintBrotherLabels } from '../utils/brotherPrinter';

interface LabelsQRViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  preSelectedIds?: string[];
}

export type TapeWidth = 36 | 24 | 18;
export type LabelLength = 68 | 80 | 50;
export type CodeType = 'qr_code' | 'barcode_1d' | 'both';

// Helper component for 1D barcode
const BarcodeItem: React.FC<{ value: string; height?: number; width?: number }> = ({ 
  value, 
  height = 24, 
  width = 1.1 
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width,
          height,
          displayValue: false,
          margin: 0,
        });
      } catch (e) {
        console.error('Barcode error', e);
      }
    }
  }, [value, height, width]);

  return <svg ref={svgRef} className="max-w-full h-auto inline-block" />;
};

export const LabelsQRView: React.FC<LabelsQRViewProps> = ({
  items,
  departments,
  rooms,
  preSelectedIds,
}) => {
  // Main view mode: 'single_station' (1-by-1 print & stick workflow) or 'batch_export' (DOCX / Excel list)
  const [viewMode, setViewMode] = useState<'single_station' | 'batch_export'>('single_station');

  // Filters
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Brother PT-E920BT settings: 36 mm tape is default!
  const [tapeWidth, setTapeWidth] = useState<TapeWidth>(36);
  const [labelLength, setLabelLength] = useState<LabelLength>(68);
  const [codeType, setCodeType] = useState<CodeType>('qr_code');

  // UI helpers
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printToast, setPrintToast] = useState<{ id: string; message: string } | null>(null);

  // Set of items labeled / printed during this session
  const [labeledItemIds, setLabeledItemIds] = useState<Set<string>>(new Set());

  // Auto-advance to next item after printing
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);

  // Filter items (only active / not written off)
  const activeItems = useMemo(() => {
    return items.filter(item => {
      if (item.status === 'written_off') return false;
      if (selectedDeptId !== 'all' && item.departmentId !== selectedDeptId) return false;
      if (selectedRoomId !== 'all' && item.roomId !== selectedRoomId) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchInv = item.inventoryNumber.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchSn = item.serialNumber?.toLowerCase().includes(q);
        if (!matchInv && !matchName && !matchSn) return false;
      }
      return true;
    });
  }, [items, selectedDeptId, selectedRoomId, searchTerm]);

  // Current focused item in 1-by-1 station
  const [focusedItemId, setFocusedItemId] = useState<string>(() => {
    if (preSelectedIds && preSelectedIds.length > 0) return preSelectedIds[0];
    return activeItems[0]?.id || '';
  });

  // Sync focused item if filter changed and current focused item is no longer in list
  useEffect(() => {
    if (activeItems.length > 0 && !activeItems.some(i => i.id === focusedItemId)) {
      setFocusedItemId(activeItems[0].id);
    }
  }, [activeItems, focusedItemId]);

  const focusedItem = useMemo(() => {
    return activeItems.find(i => i.id === focusedItemId) || activeItems[0] || null;
  }, [activeItems, focusedItemId]);

  const focusedItemIndex = useMemo(() => {
    if (!focusedItem) return -1;
    return activeItems.findIndex(i => i.id === focusedItem.id);
  }, [activeItems, focusedItem]);

  // Cached QR code data URLs (Base64)
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Generate QR for focused item and visible items
  useEffect(() => {
    let isMounted = true;
    async function generateQRs() {
      const itemsToGen = focusedItem ? [focusedItem, ...activeItems.slice(0, 15)] : activeItems.slice(0, 15);
      const newMap: Record<string, string> = {};

      for (const item of itemsToGen) {
        if (!qrMap[item.id]) {
          try {
            const payload = JSON.stringify({
              inv: item.inventoryNumber,
              name: item.name,
              school: 'Tryškių Lazdynų Pelėdos gimn.'
            });
            newMap[item.id] = await QRCode.toDataURL(payload, {
              margin: 0,
              width: 180,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' },
            });
          } catch (e) {
            console.error('QR generation error', e);
          }
        }
      }

      if (isMounted && Object.keys(newMap).length > 0) {
        setQrMap(prev => ({ ...prev, ...newMap }));
      }
    }

    generateQRs();
    return () => { isMounted = false; };
  }, [focusedItem, activeItems]);

  // Single Print handler: Prints ONLY 1 label directly to Brother PT-E920BT
  const handlePrintSingle = async (itemToPrint?: InventoryItem) => {
    const target = itemToPrint || focusedItem;
    if (!target) return;

    setIsPrinting(true);
    setPrintToast({
      id: target.id,
      message: `Spausdinama: ${target.inventoryNumber} (${target.name})...`
    });

    try {
      await directPrintBrotherLabels({
        items: [target],
        rooms,
        departments,
        tapeWidthMm: tapeWidth,
        labelLengthMm: labelLength,
        codeType,
        qrMap,
        schoolName: 'TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.'
      });

      // Mark as labeled
      setLabeledItemIds(prev => new Set(prev).add(target.id));

      setTimeout(() => {
        setPrintToast({
          id: target.id,
          message: `Atspausdinta! Užklijuokite ant ${target.name}.`
        });
        setTimeout(() => setPrintToast(null), 4000);

        // Auto-advance to next item if enabled
        if (autoAdvance) {
          const currentIndex = activeItems.findIndex(i => i.id === target.id);
          if (currentIndex !== -1 && currentIndex + 1 < activeItems.length) {
            setFocusedItemId(activeItems[currentIndex + 1].id);
          }
        }
      }, 1000);
    } catch (e) {
      console.error('Print single error', e);
      setPrintToast(null);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleNextItem = () => {
    if (focusedItemIndex !== -1 && focusedItemIndex + 1 < activeItems.length) {
      setFocusedItemId(activeItems[focusedItemIndex + 1].id);
    }
  };

  const handlePrevItem = () => {
    if (focusedItemIndex > 0) {
      setFocusedItemId(activeItems[focusedItemIndex - 1].id);
    }
  };

  // Batch Selection state for export mode
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());

  const handleDownloadWordLabels = () => {
    const listToExport = selectedBatchIds.size > 0 
      ? activeItems.filter(i => selectedBatchIds.has(i.id))
      : activeItems;

    if (listToExport.length === 0) return;

    const labelRows = listToExport.map(item => {
      const qrUrl = qrMap[item.id] || '';
      const room = rooms.find(r => r.id === item.roomId);
      const roomName = formatRoomName(room, true);

      return `
        <div style="page-break-inside: avoid; border: 1.5pt solid #000; width: ${labelLength}mm; height: ${tapeWidth}mm; margin-bottom: 6mm; padding: 2mm 3mm; box-sizing: border-box; font-family: Arial, sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" style="width: 100%; height: 100%; border: none;">
            <tr>
              <td style="width: 30mm; vertical-align: middle; text-align: center; border: none; padding-right: 2mm;">
                ${qrUrl ? `<img src="${qrUrl}" width="105" height="105" style="display:block; margin:auto;" />` : `<div style="font-size:8pt;">[QR]</div>`}
              </td>
              <td style="vertical-align: middle; border: none;">
                <div style="font-size: 7pt; font-weight: bold; text-transform: uppercase; color: #333; line-height: 1.1;">TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.</div>
                <div style="font-size: 13pt; font-weight: bold; font-family: 'Courier New', monospace; margin: 2pt 0 1pt 0; color: #000; letter-spacing: -0.5pt;">${item.inventoryNumber}</div>
                <div style="font-size: 8.5pt; font-weight: 600; color: #111; line-height: 1.1; max-height: 22pt; overflow: hidden;">${item.name}</div>
                <div style="font-size: 7.5pt; color: #555; margin-top: 2pt;">${roomName}</div>
              </td>
            </tr>
          </table>
        </div>
      `;
    }).join('');

    const html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Tryskiu_Mokyklos_Etiketes_${tapeWidth}mm</title>
  <style>
    @page { size: A4; margin: 15mm 15mm; }
    body { font-family: Arial, sans-serif; }
  </style>
</head>
<body>
  <div style="text-align: center; margin-bottom: 15pt; font-size: 10pt; color: #666;">
    <b>Tryškių Lazdynų Pelėdos gimnazija</b> · Brother PT-E920BT ${tapeWidth}mm etiketės (${listToExport.length} vnt.)
  </div>
  <table border="0" style="border:none; width: 100%;">
    <tr>
      <td style="border:none; vertical-align: top;">
        ${labelRows}
      </td>
    </tr>
  </table>
</body>
</html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiai-etiketes-brother-${tapeWidth}mm-${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcelLabels = () => {
    const listToExport = selectedBatchIds.size > 0 
      ? activeItems.filter(i => selectedBatchIds.has(i.id))
      : activeItems;

    if (listToExport.length === 0) return;

    const header = ['Inventorinis numeris', 'Turto pavadinimas', 'Kabinetas', 'Skyrius', 'Juostos plotis', 'QR kodo turinys'].join(';');
    const rows = listToExport.map(item => {
      const room = rooms.find(r => r.id === item.roomId);
      const dept = departments.find(d => d.id === item.departmentId);
      const roomStr = formatRoomName(room);
      const payload = `${item.inventoryNumber} | ${item.name} | Tryškių L. Pelėdos gimn.`;
      return [
        `"${item.inventoryNumber}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${roomStr}"`,
        `"${dept?.name || ''}"`,
        `"${tapeWidth} mm"`,
        `"${payload.replace(/"/g, '""')}"`
      ].join(';');
    });

    const csv = '\uFEFF' + [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiai-etiketes-sarasas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Progress count
  const labeledInActiveCount = activeItems.filter(i => labeledItemIds.has(i.id)).length;
  const progressPercent = activeItems.length > 0 ? Math.round((labeledInActiveCount / activeItems.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {printToast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl text-xs flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
            <Printer className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="font-semibold text-white flex items-center gap-1.5">
              <span>Brother PT-E920BT (36 mm)</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/30 text-blue-300 rounded font-mono">1 vnt.</span>
            </div>
            <div className="text-slate-300 text-[11px] mt-0.5">{printToast.message}</div>
          </div>
        </div>
      )}

      {/* Top Workflow Mode Switcher */}
      <div className="bg-white border border-slate-300 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg text-xs">
          <button
            onClick={() => setViewMode('single_station')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
              viewMode === 'single_station'
                ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <Printer className="w-4 h-4 text-blue-600" />
            <span>Etikečių klijavimo stotis (1 po 1)</span>
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">Rekomenduojama</span>
          </button>
          <button
            onClick={() => setViewMode('batch_export')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
              viewMode === 'batch_export'
                ? 'bg-white text-slate-900 font-bold shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-slate-600" />
            <span>Failų eksportas (Word / Excel sąrašas)</span>
          </button>
        </div>

        <button
          onClick={() => setShowGuide(!showGuide)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 cursor-pointer px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs"
        >
          <HelpCircle className="w-4 h-4 text-slate-500" />
          <span>Brother PT-E920BT tvarkyklės nustatymai</span>
          {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Collapsible Driver Guide */}
      {showGuide && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 space-y-3 animate-in fade-in duration-200">
          <div className="font-semibold text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400" />
              Brother PT-E920BT tiesioginio spausdinimo nustatymai:
            </span>
            <span className="text-[11px] text-blue-300 font-mono">TZe 36 mm juosta</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-300">
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">1. Ryšys ir spausdintuvas</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Prijunkite per Bluetooth arba USB kabelį. Spausdinimo lange pasirinkite <strong>Brother PT-E920BT</strong> (arba P-touch).
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">2. Popieriaus dydis</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Nustatykite juostos plotį į <strong>36 mm</strong> (etiketės ilgis 68 mm).
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">3. Paraštės (Margins: None)</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Pasirinkite <strong>„None“</strong> (be paraščių), atžymėkite „Headers and footers“. Automatinis giljotinis peiliukas nukirps etiketę.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 1: SINGLE ITEM PRINT & STICK STATION (1 po 1) */}
      {viewMode === 'single_station' && (
        <div className="space-y-5">
          {/* Filters Bar: Room & Search */}
          <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Department */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Skyrius / Korpusas</label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => {
                    setSelectedDeptId(e.target.value);
                    setSelectedRoomId('all');
                  }}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-medium focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value="all">Visi skyriai</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Room */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Kabinetas / Patalpa</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-bold focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value="all">Visi kabinetai ({activeItems.length} vnt.)</option>
                  {rooms.map(r => {
                    const countInRoom = items.filter(i => i.roomId === r.id && i.status !== 'written_off').length;
                    return (
                      <option key={r.id} value={r.id}>
                        {formatRoomName(r)} ({countInRoom} vnt.)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Quick Search */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Greita paieška (Nr., Pavadinimas, S/N)</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="pvz., TM-2023 arba Lenovo..."
                    className="w-full bg-white border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-900 font-medium shadow-2xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Progress bar across selected cabinet / filtered view */}
            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Šioje atrankoje paženklinta:</span>
                <span className="font-semibold text-slate-900">{labeledInActiveCount} iš {activeItems.length}</span>
                <span className="text-[11px] font-mono text-blue-600 font-bold">({progressPercent}%)</span>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Automatiškai pereiti prie kito daikto atspausdinus</span>
                </label>

                {labeledItemIds.size > 0 && (
                  <button
                    onClick={() => setLabeledItemIds(new Set())}
                    className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Atstatyti žymėjimus
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Current Focused Item Printing Hero Card */}
          {focusedItem ? (
            <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-xl">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                {/* Left Col (5 cols): Exact 36 mm Label Preview */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="text-[11px] font-mono tracking-wider text-blue-300 mb-2 uppercase flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    <span>Tikslus 36 mm juostelės maketas</span>
                  </div>

                  {/* 36mm Label Canvas Mockup */}
                  <div 
                    className="w-full max-w-[340px] bg-white text-black p-2.5 rounded-sm border-2 border-slate-400 shadow-2xl flex items-center gap-3 relative select-none"
                    style={{ minHeight: '110px' }}
                  >
                    {/* Left: Crisp QR Code */}
                    <div className="w-22 h-22 shrink-0 bg-white flex items-center justify-center p-1 border border-slate-200 rounded">
                      {qrMap[focusedItem.id] ? (
                        <img 
                          src={qrMap[focusedItem.id]} 
                          alt={focusedItem.inventoryNumber} 
                          className="w-full h-full object-contain" 
                        />
                      ) : (
                        <QrCode className="w-10 h-10 text-slate-300" />
                      )}
                    </div>

                    {/* Right: Text layout */}
                    <div className="min-w-0 flex-1 flex flex-col justify-between h-full py-0.5">
                      <div>
                        <div className="text-[8px] font-bold uppercase tracking-wider text-slate-600 truncate">
                          TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.
                        </div>
                        <div className="font-mono text-base font-extrabold text-black tracking-tight leading-tight mt-0.5">
                          {focusedItem.inventoryNumber}
                        </div>
                        <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mt-0.5">
                          {focusedItem.name}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono pt-1.5 border-t border-slate-100">
                        <span>
                          {rooms.find(r => r.id === focusedItem.roomId)?.number || '101'} kab.
                        </span>
                        {focusedItem.serialNumber && (
                          <span className="truncate max-w-[90px]">SN: {focusedItem.serialNumber}</span>
                        )}
                      </div>
                    </div>

                    {/* Status Badge overlay on the label */}
                    {labeledItemIds.has(focusedItem.id) && (
                      <div className="absolute -top-2.5 -right-2.5 bg-emerald-600 text-white rounded-full p-1 shadow-md">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-400 font-mono mt-2">
                    Formatas: 68 mm × 36 mm · Brother TZe juostelė
                  </div>
                </div>

                {/* Right Col (7 cols): Large Direct Print Action & Sequential Controls */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Step indicator */}
                  <div className="flex items-center justify-between text-xs text-blue-200">
                    <span className="font-semibold text-blue-300">
                      Daiktas {focusedItemIndex + 1} iš {activeItems.length}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {rooms.find(r => r.id === focusedItem.roomId)?.name || 'Gimnazija'}
                    </span>
                  </div>

                  {/* Item Title & Specs */}
                  <div>
                    <h3 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                      <span>{focusedItem.name}</span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-300">
                      <span className="font-mono text-blue-400 font-bold bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/60">
                        {focusedItem.inventoryNumber}
                      </span>
                      <span>·</span>
                      <span>{focusedItem.category}</span>
                      {focusedItem.serialNumber && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-slate-400">SN: {focusedItem.serialNumber}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* BIG ACTION BUTTON: PRINT THIS 1 LABEL NOW */}
                  <div className="pt-2">
                    <button
                      onClick={() => handlePrintSingle(focusedItem)}
                      disabled={isPrinting}
                      className="w-full py-4 px-6 rounded-xl font-extrabold text-base transition-all transform active:scale-98 shadow-lg flex items-center justify-center gap-3 cursor-pointer bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white"
                    >
                      <Printer className="w-6 h-6 animate-pulse" />
                      <span>
                        {isPrinting 
                          ? 'Siunčiama į Brother PT-E920BT...' 
                          : 'Spausdinti šią etiketę (Brother PT-E920BT)'}
                      </span>
                    </button>
                    <p className="text-[11px] text-center text-blue-200/80 mt-1.5">
                      Paspaudus etiketė iškart išlenda iš spausdintuvo ir nusikerpa. Užklijuokite ant daikto!
                    </p>
                  </div>

                  {/* Next / Previous sequential buttons */}
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                    <button
                      onClick={handlePrevItem}
                      disabled={focusedItemIndex <= 0}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Ankstesnis</span>
                    </button>

                    <div className="text-center text-[11px] text-slate-400">
                      {labeledItemIds.has(focusedItem.id) ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1 justify-center">
                          <Check className="w-3.5 h-3.5" /> Užklijuota! Galite eiti prie kito.
                        </span>
                      ) : (
                        <span>Laukia atspausdinimo ir užklijavimo</span>
                      )}
                    </div>

                    <button
                      onClick={handleNextItem}
                      disabled={focusedItemIndex >= activeItems.length - 1}
                      className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-blue-600/60 hover:bg-blue-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-sm"
                    >
                      <span>Kitas daiktas</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
              Pagal pasirinktus filtrus nerasta aktyvių daiktų. Pasirinkite kitą kabinetą arba išvalykite paiešką.
            </div>
          )}

          {/* Sequential List of Items in the Room / Filter */}
          <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-100/80">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900">
                  Kabineto inventoriaus sąrašas spausdinimui po vieną ({activeItems.length} vnt.)
                </span>
              </div>
              <span className="text-[11px] text-slate-600 font-medium">
                Paspauskite ant bet kurio daikto arba tiesiai ant spausdintuvo mygtuko eilutėje
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {activeItems.map((item, idx) => {
                const isSelected = focusedItem?.id === item.id;
                const isLabeled = labeledItemIds.has(item.id);
                const room = rooms.find(r => r.id === item.roomId);

                return (
                  <div
                    key={item.id}
                    onClick={() => setFocusedItemId(item.id)}
                    className={`p-3.5 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                      isSelected 
                        ? 'bg-blue-50/80 ring-1 ring-blue-300' 
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Checkbox indicator */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLabeledItemIds(prev => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        title={isLabeled ? 'Pažymėta kaip užklijuota' : 'Pažymėti kaip užklijuotą'}
                        className="cursor-pointer"
                      >
                        {isLabeled ? (
                          <div className="w-5 h-5 rounded bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded border-2 border-slate-300 hover:border-slate-400" />
                        )}
                      </button>

                      {/* Number and Name */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {item.inventoryNumber}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-800 truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{formatRoomName(room)}</span>
                          {item.serialNumber && (
                            <>
                              <span>·</span>
                              <span className="font-mono text-slate-400">SN: {item.serialNumber}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Action: 1-click Print to Brother */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isLabeled && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <Check className="w-3 h-3" /> Užklijuota
                        </span>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedItemId(item.id);
                          handlePrintSingle(item);
                        }}
                        disabled={isPrinting}
                        title={`Spausdinti 36 mm etiketę į Brother (${item.inventoryNumber})`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                          isSelected
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        <Printer className="w-3.5 h-3.5 text-blue-500" />
                        <span>Spausdinti</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 2: BATCH EXPORT (WORD / EXCEL) */}
      {viewMode === 'batch_export' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Etikečių sąrašo eksportas dokumentams
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Jei pageidaujate turėti suformuotą Word ar Excel failą archyvui ar spausdinimui per kompiuterį
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadExcelLabels}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Atsisiųsti Excel sąrašą</span>
                </button>
                <button
                  onClick={handleDownloadWordLabels}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <FileText className="w-4 h-4" />
                  <span>Atsisiųsti Word (DOCX) etiketes</span>
                </button>
              </div>
            </div>

            {/* Batch Options */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Juostos plotis</label>
                <select
                  value={tapeWidth}
                  onChange={(e) => setTapeWidth(Number(e.target.value) as TapeWidth)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
                >
                  <option value={36}>36 mm (PT-E920BT)</option>
                  <option value={24}>24 mm juostelė</option>
                  <option value={18}>18 mm juostelė</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Etiketės ilgis</label>
                <select
                  value={labelLength}
                  onChange={(e) => setLabelLength(Number(e.target.value) as LabelLength)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
                >
                  <option value={68}>68 mm (Standartinis)</option>
                  <option value={80}>80 mm (Prailgintas)</option>
                  <option value={50}>50 mm (Kompaktiškas)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Skyrius</label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
                >
                  <option value="all">Visi skyriai</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Kabinetas</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
                >
                  <option value="all">Visi kabinetai</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>{formatRoomName(r)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
