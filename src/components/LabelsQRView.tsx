import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import {
  Download,
  FileText,
  FileSpreadsheet,
  Tag,
  QrCode,
  Printer,
  Info,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Check,
  ChevronRight,
  ChevronLeft,
  Search,
  AlertTriangle,
  Barcode as BarcodeIcon,
  XCircle,
} from 'lucide-react';
import {
  InventoryItem,
  Department,
  Room,
  OrganizationSettings,
  formatRoomName,
} from '../types/inventory';
import { directPrintBrotherLabels } from '../utils/brotherPrinter';
import { buildItemQrPayload } from '../utils/qrUtils';
import { DEFAULT_ORGANIZATION_SETTINGS } from '../utils/organization';
import { buildCsvContent } from '../utils/csvUtils';
import {
  CODE_TYPE_LABELS,
  CodeType,
  LabelLength,
  LabelPrintState,
  TapeWidth,
  applyPrintDialogOutcome,
  confirmLabelApplied,
  filterLabelItems,
  getBarcodeValue,
  getLabelCacheKey,
  unmarkLabelApplied,
} from '../utils/labelUtils';
import { generateLabelsDocxBlob, getLabelsDocxFilename } from '../utils/docxExport';

interface LabelsQRViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  preSelectedIds?: string[];
  organizationSettings?: OrganizationSettings;
  onClearPreselection?: () => void;
}

export type { TapeWidth, LabelLength, CodeType };

const BarcodeItem: React.FC<{ value: string; height?: number; width?: number }> = ({
  value,
  height = 24,
  width = 1.1,
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
  organizationSettings,
  onClearPreselection,
}) => {
  const [viewMode, setViewMode] = useState<'single_station' | 'batch_export'>('single_station');

  // Preselection state: strictly honors items selected from InventoryListView until user clears
  const [usePreselection, setUsePreselection] = useState<boolean>(() =>
    Boolean(preSelectedIds && preSelectedIds.length > 0)
  );

  // Filters
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Brother PT-E920BT settings
  const [tapeWidth, setTapeWidth] = useState<TapeWidth>(36);
  const [labelLength, setLabelLength] = useState<LabelLength>(68);
  const [codeType, setCodeType] = useState<CodeType>('qr_code');

  // UI helpers
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [printState, setPrintState] = useState<LabelPrintState>({ status: 'idle' });
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);

  // Set of items confirmed as labeled during this session
  const [labeledItemIds, setLabeledItemIds] = useState<Set<string>>(new Set());
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);

  // Batch Selection state for export mode
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(() =>
    preSelectedIds && preSelectedIds.length > 0 ? new Set(preSelectedIds) : new Set()
  );

  // React to new preSelectedIds coming from InventoryListView
  useEffect(() => {
    if (preSelectedIds && preSelectedIds.length > 0) {
      setUsePreselection(true);
      setSelectedDeptId('all');
      setSelectedRoomId('all');
      setSearchTerm('');
      setFocusedItemId(preSelectedIds[0]);
      setSelectedBatchIds(new Set(preSelectedIds));
      setPrintState({ status: 'idle' });
    } else {
      setUsePreselection(false);
    }
  }, [preSelectedIds]);

  const schoolDisplayName =
    organizationSettings?.name?.trim() || DEFAULT_ORGANIZATION_SETTINGS.name;

  // Filtered active items (never includes written_off; honors preSelectedIds strictly)
  const activeItems = useMemo(() => {
    return filterLabelItems(items, {
      preSelectedIds,
      usePreselection,
      departmentId: selectedDeptId,
      roomId: selectedRoomId,
      searchTerm,
    });
  }, [items, preSelectedIds, usePreselection, selectedDeptId, selectedRoomId, searchTerm]);

  const [focusedItemId, setFocusedItemId] = useState<string>(() => {
    if (preSelectedIds && preSelectedIds.length > 0) return preSelectedIds[0];
    return activeItems[0]?.id || '';
  });

  // Sync focused item if filter changed and current focused item is no longer in list
  useEffect(() => {
    if (activeItems.length > 0 && !activeItems.some((i) => i.id === focusedItemId)) {
      setFocusedItemId(activeItems[0].id);
      setPrintState({ status: 'idle' });
    }
  }, [activeItems, focusedItemId]);

  const focusedItem = useMemo(() => {
    return activeItems.find((i) => i.id === focusedItemId) || activeItems[0] || null;
  }, [activeItems, focusedItemId]);

  const focusedItemIndex = useMemo(() => {
    if (!focusedItem) return -1;
    return activeItems.findIndex((i) => i.id === focusedItem.id);
  }, [activeItems, focusedItem]);

  // Cached QR DataURLs keyed by getLabelCacheKey(item) so inventoryNumber/name edits invalidate cache automatically
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;
    async function generateQRs() {
      if (codeType === 'barcode_1d') return;
      const itemsToGen = focusedItem
        ? [focusedItem, ...activeItems.slice(0, 20)]
        : activeItems.slice(0, 20);
      const newMap: Record<string, string> = {};

      for (const item of itemsToGen) {
        const cacheKey = getLabelCacheKey(item);
        if (!qrMap[cacheKey]) {
          try {
            const payload = buildItemQrPayload(item);
            const dataUrl = await QRCode.toDataURL(payload, {
              margin: 0,
              width: 180,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' },
            });
            newMap[cacheKey] = dataUrl;
          } catch (e) {
            console.error('QR generation error', e);
          }
        }
      }

      if (isMounted && Object.keys(newMap).length > 0) {
        setQrMap((prev) => ({ ...prev, ...newMap }));
      }
    }

    void generateQRs();
    return () => {
      isMounted = false;
    };
  }, [focusedItem, activeItems, codeType, qrMap]);

  const handlePrintSingle = async (itemToPrint?: InventoryItem) => {
    const target = itemToPrint || focusedItem;
    if (!target) return;

    setPrintState({ status: 'preparing', targetItemId: target.id });

    const result = await directPrintBrotherLabels({
      items: [target],
      rooms,
      departments,
      tapeWidthMm: tapeWidth,
      labelLengthMm: labelLength,
      codeType,
      qrMap,
      organization: organizationSettings,
      schoolName: schoolDisplayName,
    });

    setPrintState(applyPrintDialogOutcome(result, target.id));
  };

  const handleConfirmLabelApplied = (itemId: string) => {
    setLabeledItemIds((prev) => confirmLabelApplied(prev, itemId));
    setPrintState({ status: 'idle' });
    if (autoAdvance) {
      const currentIndex = activeItems.findIndex((i) => i.id === itemId);
      if (currentIndex !== -1 && currentIndex + 1 < activeItems.length) {
        setFocusedItemId(activeItems[currentIndex + 1].id);
      }
    }
  };

  const handleNextItem = () => {
    if (focusedItemIndex !== -1 && focusedItemIndex + 1 < activeItems.length) {
      setFocusedItemId(activeItems[focusedItemIndex + 1].id);
      setPrintState({ status: 'idle' });
    }
  };

  const handlePrevItem = () => {
    if (focusedItemIndex > 0) {
      setFocusedItemId(activeItems[focusedItemIndex - 1].id);
      setPrintState({ status: 'idle' });
    }
  };

  const handleResetPreselection = () => {
    setUsePreselection(false);
    setSelectedBatchIds(new Set());
    onClearPreselection?.();
  };

  const listToExport = useMemo(() => {
    const validBatch = selectedBatchIds.size > 0
      ? activeItems.filter((i) => selectedBatchIds.has(i.id))
      : [];
    return validBatch.length > 0 ? validBatch : activeItems;
  }, [activeItems, selectedBatchIds]);

  const handleDownloadWordLabels = async () => {
    if (listToExport.length === 0 || isExportingDocx) return;
    setExportError(null);
    setIsExportingDocx(true);
    try {
      const blob = await generateLabelsDocxBlob({
        items: listToExport,
        rooms,
        departments,
        tapeWidthMm: tapeWidth,
        labelLengthMm: labelLength,
        codeType,
        organization: organizationSettings,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getLabelsDocxFilename(tapeWidth, codeType);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : 'Nepavyko sugeneruoti tikro DOCX etikečių failo.'
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleDownloadExcelLabels = () => {
    if (listToExport.length === 0) return;
    setExportError(null);
    const headers = [
      'Inventorinis numeris',
      'Turto pavadinimas',
      'Kabinetas',
      'Skyrius',
      'Juostos plotis',
      'Etiketės ilgis',
      'Kodo tipas',
      '1D brūkšninio kodo reikšmė',
      'QR kodo turinys',
    ];
    const rows = listToExport.map((item) => {
      const room = rooms.find((r) => r.id === item.roomId);
      const dept = departments.find((d) => d.id === item.departmentId);
      return [
        item.inventoryNumber,
        item.name,
        formatRoomName(room),
        dept?.name || '',
        `${tapeWidth} mm`,
        `${labelLength} mm`,
        CODE_TYPE_LABELS[codeType],
        getBarcodeValue(item),
        buildItemQrPayload(item),
      ];
    });
    const csv = buildCsvContent(headers, rows, ';');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiai-etiketes-sarasas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const labeledInActiveCount = activeItems.filter((i) => labeledItemIds.has(i.id)).length;
  const progressPercent =
    activeItems.length > 0 ? Math.round((labeledInActiveCount / activeItems.length) * 100) : 0;

  const focusedQrSrc = focusedItem ? qrMap[getLabelCacheKey(focusedItem)] : undefined;
  const isPrinting = printState.status === 'preparing';

  return (
    <div className="space-y-5">
      {/* Top Workflow Mode Switcher */}
      <div className="bg-white border border-slate-300 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setViewMode('single_station')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
              viewMode === 'single_station'
                ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <Printer className="w-4 h-4 text-blue-600" />
            <span>Etikečių spausdinimo stotis (1 po 1)</span>
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">
              Rekomenduojama
            </span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('batch_export')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
              viewMode === 'batch_export'
                ? 'bg-white text-slate-900 font-bold shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-slate-600" />
            <span>Failų eksportas (DOCX / CSV)</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 cursor-pointer px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs"
        >
          <HelpCircle className="w-4 h-4 text-slate-500" />
          <span>Brother PT-E920BT spausdinimo rekomendacijos</span>
          {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Collapsible Driver Guide */}
      {showGuide && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 space-y-3 animate-in fade-in duration-200">
          <div className="font-semibold text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400" />
              Brother PT-E920BT naršyklės spausdinimo rekomendacijos:
            </span>
            <span className="text-[11px] text-blue-300 font-mono">
              TZe {tapeWidth} × {labelLength} mm
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-300">
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">1. Spausdintuvo pasirinkimas</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Naršyklės spausdinimo lange pasirinkite įdiegtą sisteminį spausdintuvą (pvz., Brother PT-E920BT per USB arba P-touch tvarkyklę).
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">2. Juostos dydis ir mastelis</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Parinkite juostos plotį ({tapeWidth} mm) ir etiketės ilgį ({labelLength} mm), mastelis 100 % (be pritaikymo lapui).
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-bold text-blue-300 block">3. Paraštės ir patvirtinimas</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Nustatykite „Margins: None“ ir išjunkite „Headers and footers“. Užklijavus etiketę, ranka patvirtinkite paženklinimą.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preselection Banner (when coming from InventoryListView selection) */}
      {usePreselection && preSelectedIds && preSelectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-blue-950">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-blue-700 shrink-0" />
            <span>
              <strong>Pasirinkta iš inventoriaus sąrašo:</strong> {activeItems.length} vnt. (rodomas tik šis rinkinys).
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetPreselection}
            className="px-3 py-1 rounded-md bg-white hover:bg-blue-100 border border-blue-300 text-blue-800 font-semibold cursor-pointer"
          >
            Rodyti visą inventorių
          </button>
        </div>
      )}

      {/* VIEW MODE 1: SINGLE ITEM PRINT & STICK STATION */}
      {viewMode === 'single_station' && (
        <div className="space-y-5">
          {/* Filters & Label Settings Bar */}
          <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Skyrius / Korpusas
                </label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => {
                    setSelectedDeptId(e.target.value);
                    setSelectedRoomId('all');
                  }}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-medium focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
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
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Kabinetas / Patalpa
                </label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-bold focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value="all">Visi kabinetai ({activeItems.length} vnt.)</option>
                  {rooms
                    .filter((r) => selectedDeptId === 'all' || r.departmentId === selectedDeptId)
                    .map((r) => {
                      const countInRoom = items.filter(
                        (i) => i.roomId === r.id && i.status !== 'written_off'
                      ).length;
                      return (
                        <option key={r.id} value={r.id}>
                          {formatRoomName(r)} ({countInRoom} vnt.)
                        </option>
                      );
                    })}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Greita paieška
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Nr., pavad., S/N..."
                    className="w-full bg-white border border-slate-300 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-slate-900 font-medium shadow-2xs focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Kodo tipas
                </label>
                <select
                  value={codeType}
                  onChange={(e) => setCodeType(e.target.value as CodeType)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value="qr_code">{CODE_TYPE_LABELS.qr_code}</option>
                  <option value="barcode_1d">{CODE_TYPE_LABELS.barcode_1d}</option>
                  <option value="both">{CODE_TYPE_LABELS.both}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Juostos plotis
                </label>
                <select
                  value={tapeWidth}
                  onChange={(e) => setTapeWidth(Number(e.target.value) as TapeWidth)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-medium focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value={36}>36 mm (PT-E920BT)</option>
                  <option value={24}>24 mm juostelė</option>
                  <option value={18}>18 mm juostelė</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Etiketės ilgis
                </label>
                <select
                  value={labelLength}
                  onChange={(e) => setLabelLength(Number(e.target.value) as LabelLength)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 font-medium focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                >
                  <option value={68}>68 mm (Standartinis)</option>
                  <option value={80}>80 mm (Prailgintas)</option>
                  <option value={50}>50 mm (Kompaktiškas)</option>
                </select>
              </div>
            </div>

            {/* Progress bar */}
            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Patvirtinta užklijuotų šioje atrankoje:</span>
                <span className="font-semibold text-slate-900 font-mono tabular-nums">
                  {labeledInActiveCount} iš {activeItems.length}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-blue-600 font-bold">
                  ({progressPercent}%)
                </span>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Patvirtinus pereiti prie kito daikto</span>
                </label>

                {labeledItemIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setLabeledItemIds(new Set())}
                    className="text-[11px] text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    Atstatyti žymėjimus
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Focused Item Hero Card */}
          {focusedItem ? (
            <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-xl">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                {/* Left Col: Accurate Label Preview */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="text-[11px] font-mono tracking-wider text-blue-300 mb-2 uppercase flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    <span>
                      {tapeWidth} mm juostelės maketas ({CODE_TYPE_LABELS[codeType]})
                    </span>
                  </div>

                  <div
                    className="w-full max-w-[350px] bg-white text-black p-2.5 rounded-sm border-2 border-slate-400 shadow-2xl flex items-center gap-3 relative select-none"
                    style={{ minHeight: codeType === 'both' ? '128px' : '110px' }}
                  >
                    {(codeType === 'qr_code' || codeType === 'both') && (
                      <div className="w-22 h-22 shrink-0 bg-white flex items-center justify-center p-1 border border-slate-200 rounded">
                        {focusedQrSrc ? (
                          <img
                            src={focusedQrSrc}
                            alt={focusedItem.inventoryNumber}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <QrCode className="w-10 h-10 text-slate-300" />
                        )}
                      </div>
                    )}

                    <div className="min-w-0 flex-1 flex flex-col justify-between h-full py-0.5">
                      <div>
                        <div className="text-[8px] font-bold uppercase tracking-wider text-slate-600 truncate">
                          {schoolDisplayName}
                        </div>
                        {codeType === 'barcode_1d' && (
                          <div className="my-1">
                            <BarcodeItem
                              value={getBarcodeValue(focusedItem)}
                              height={28}
                              width={1.2}
                            />
                          </div>
                        )}
                        <div className="font-mono text-base font-extrabold text-black tracking-tight leading-tight mt-0.5">
                          {focusedItem.inventoryNumber}
                        </div>
                        <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mt-0.5">
                          {focusedItem.name}
                        </div>
                        {codeType === 'both' && (
                          <div className="mt-1">
                            <BarcodeItem
                              value={getBarcodeValue(focusedItem)}
                              height={20}
                              width={1.0}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono pt-1 border-t border-slate-100 mt-1">
                        <span>
                          {formatRoomName(
                            rooms.find((r) => r.id === focusedItem.roomId),
                            true
                          )}
                        </span>
                        {focusedItem.serialNumber && (
                          <span className="truncate max-w-[95px]">
                            SN: {focusedItem.serialNumber}
                          </span>
                        )}
                      </div>
                    </div>

                    {labeledItemIds.has(focusedItem.id) && (
                      <div
                        className="absolute -top-2.5 -right-2.5 bg-emerald-600 text-white rounded-full p-1 shadow-md"
                        title="Patvirtinta kaip užklijuota"
                      >
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-400 font-mono mt-2">
                    Formatas: {labelLength} mm × {tapeWidth} mm · {CODE_TYPE_LABELS[codeType]}
                  </div>
                </div>

                {/* Right Col: Print Controls & Confirmation */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between text-xs text-blue-200">
                    <span className="font-semibold text-blue-300 font-mono tabular-nums">
                      Daiktas {focusedItemIndex + 1} iš {activeItems.length}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {rooms.find((r) => r.id === focusedItem.roomId)?.name || 'Gimnazija'}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-extrabold text-white tracking-tight">
                      {focusedItem.name}
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
                          <span className="font-mono text-slate-400">
                            SN: {focusedItem.serialNumber}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Print Action Button */}
                  <div className="pt-1 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => void handlePrintSingle(focusedItem)}
                      disabled={isPrinting}
                      className="w-full py-3.5 px-6 rounded-xl font-extrabold text-base transition-all shadow-lg flex items-center justify-center gap-3 cursor-pointer bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white disabled:opacity-60"
                    >
                      <Printer className="w-5 h-5" />
                      <span>
                        {isPrinting
                          ? 'Ruošiamas spausdinimo dokumentas...'
                          : 'Atidaryti spausdinimo dialogą (Brother PT-E920BT)'}
                      </span>
                    </button>

                    {/* Explicit Post-Print Confirmation Bar */}
                    {printState.status === 'awaiting_confirmation' &&
                      printState.targetItemId === focusedItem.id && (
                        <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-400/50 text-xs space-y-2">
                          <div className="font-semibold text-amber-200">
                            Spausdinimo dialogas uždarytas. Patvirtinkite tik įsitikinę, kad etiketė atsispausdino ir yra užklijuota ant turto:
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleConfirmLabelApplied(focusedItem.id)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                            >
                              <Check className="w-4 h-4" />
                              <span>Patvirtinti ir pažymėti užklijuota</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPrintState({ status: 'idle' })}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 font-medium cursor-pointer"
                            >
                              <XCircle className="w-4 h-4" />
                              <span>Atšaukta / Nepavyko</span>
                            </button>
                          </div>
                        </div>
                      )}

                    {printState.status === 'error' && (
                      <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/60 text-xs text-rose-200 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>{printState.errorMessage}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPrintState({ status: 'idle' })}
                          className="text-[11px] underline text-rose-200 cursor-pointer shrink-0"
                        >
                          Uždaryti
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Next / Previous sequential buttons */}
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                    <button
                      type="button"
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
                          <Check className="w-3.5 h-3.5" /> Patvirtinta: užklijuota
                        </span>
                      ) : (
                        <span>Dar nepatvirtinta kaip užklijuota</span>
                      )}
                    </div>

                    <button
                      type="button"
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

          {/* Sequential List of Items */}
          <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-100/80">
              <span className="font-bold text-xs text-slate-900">
                Inventoriaus sąrašas spausdinimui po vieną ({activeItems.length} vnt.)
              </span>
              <span className="text-[11px] text-slate-600 font-medium">
                Varnele žymimi tik patvirtinti užklijuoti daiktai
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {activeItems.map((item) => {
                const isSelected = focusedItem?.id === item.id;
                const isLabeled = labeledItemIds.has(item.id);
                const room = rooms.find((r) => r.id === item.roomId);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setFocusedItemId(item.id);
                      setPrintState({ status: 'idle' });
                    }}
                    className={`p-3.5 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/80 ring-1 ring-blue-300' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLabeledItemIds((prev) =>
                            prev.has(item.id)
                              ? unmarkLabelApplied(prev, item.id)
                              : confirmLabelApplied(prev, item.id)
                          );
                        }}
                        title={
                          isLabeled
                            ? 'Pažymėta kaip užklijuota (spustelėkite nuimti)'
                            : 'Ranka pažymėti kaip užklijuotą'
                        }
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
                              <span className="font-mono text-slate-400">
                                SN: {item.serialNumber}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isLabeled && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <Check className="w-3 h-3" /> Užklijuota
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedItemId(item.id);
                          void handlePrintSingle(item);
                        }}
                        disabled={isPrinting}
                        title={`Atidaryti spausdinimo dialogą (${item.inventoryNumber})`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                          isSelected
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        <Printer className="w-3.5 h-3.5" />
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

      {/* VIEW MODE 2: BATCH EXPORT (REAL OOXML DOCX / CSV) */}
      {viewMode === 'batch_export' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Etikečių rinkinio eksportas dokumentams ({listToExport.length} vnt.)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sugeneruojamas tikras Microsoft Word (.docx) su QR/1D PNG kodais arba UTF-8 CSV sąrašas archyvui.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={listToExport.length === 0}
                  onClick={handleDownloadExcelLabels}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-2xs"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Atsisiųsti CSV sąrašą</span>
                </button>
                <button
                  type="button"
                  disabled={listToExport.length === 0 || isExportingDocx}
                  onClick={() => void handleDownloadWordLabels()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <FileText className="w-4 h-4" />
                  <span>
                    {isExportingDocx
                      ? 'Generuojamas DOCX...'
                      : 'Atsisiųsti Word (DOCX) etiketes'}
                  </span>
                </button>
              </div>
            </div>

            {exportError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                {exportError}
              </div>
            )}

            {/* Batch Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Kodo tipas
                </label>
                <select
                  value={codeType}
                  onChange={(e) => setCodeType(e.target.value as CodeType)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium"
                >
                  <option value="qr_code">{CODE_TYPE_LABELS.qr_code}</option>
                  <option value="barcode_1d">{CODE_TYPE_LABELS.barcode_1d}</option>
                  <option value="both">{CODE_TYPE_LABELS.both}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Juostos plotis
                </label>
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
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Etiketės ilgis
                </label>
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
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Skyrius
                </label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => {
                    setSelectedDeptId(e.target.value);
                    setSelectedRoomId('all');
                  }}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
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
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Kabinetas
                </label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5"
                >
                  <option value="all">Visi kabinetai</option>
                  {rooms
                    .filter((r) => selectedDeptId === 'all' || r.departmentId === selectedDeptId)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatRoomName(r)}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {activeItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                Eksportui pagal pasirinktus filtrus aktyvių daiktų nėra.
              </div>
            ) : (
              <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>
                    Pasirinkite konkrečius daiktus (arba palikite nepažymėta, kad eksportuotų visus {activeItems.length} vnt.):
                  </span>
                  {selectedBatchIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedBatchIds(new Set())}
                      className="text-blue-600 hover:underline font-semibold cursor-pointer"
                    >
                      Išvalyti pasirinkimą ({selectedBatchIds.size})
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {activeItems.map((item) => {
                    const checked = selectedBatchIds.has(item.id);
                    const room = rooms.find((r) => r.id === item.roomId);
                    return (
                      <label
                        key={item.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedBatchIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              });
                            }}
                            className="rounded text-blue-600"
                          />
                          <span className="font-mono font-bold text-slate-900">
                            {item.inventoryNumber}
                          </span>
                          <span className="text-slate-700 truncate">{item.name}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 shrink-0">
                          {formatRoomName(room)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
