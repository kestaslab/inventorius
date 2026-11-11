import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  QrCode, 
  ArrowLeftRight, 
  Trash2, 
  Edit3, 
  Eye, 
  CheckSquare, 
  Square,
  FileSpreadsheet,
  Camera,
  Clock,
  Sparkles,
  Download,
  Laptop,
  Monitor,
  Server,
  Tablet,
  Cpu,
  HardDrive,
  Archive,
  CheckCircle,
  RotateCcw,
  AlertTriangle,
  FileText,
  Calendar,
  Printer,
  Check
} from 'lucide-react';
import { directPrintBrotherLabels } from '../utils/brotherPrinter';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  ItemCategory, 
  ItemStatus,
  AssetClass,
  FundingSource,
  ComputerType,
  ComputerSpecs,
  COMPUTER_TYPE_LABELS,
  COMPUTER_TYPE_SHORT_LABELS,
  ASSET_CLASS_SHORT_LABELS,
  FUNDING_SOURCE_SHORT_LABELS,
  LONG_TERM_THRESHOLD,
  formatRoomName
} from '../types/inventory';
import { StorageService } from '../utils/storage';

export function calculateAgeInYears(acquisitionDate: string): number {
  if (!acquisitionDate) return 0;
  const acq = new Date(acquisitionDate).getTime();
  const now = new Date().getTime();
  const diffDays = (now - acq) / (1000 * 60 * 60 * 24);
  return Math.max(0, diffDays / 365.25);
}

export function formatAgeDisplay(acquisitionDate: string): { label: string; years: number; isOld: boolean } {
  const years = calculateAgeInYears(acquisitionDate);
  const rounded = Math.round(years * 10) / 10;
  let label = '';
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    label = `${months} mėn.`;
  } else {
    const full = Math.floor(years);
    const lastDigit = full % 10;
    const lastTwo = full % 100;
    let word = 'metų';
    if (lastTwo >= 11 && lastTwo <= 19) word = 'metų';
    else if (lastDigit === 1) word = 'metai';
    else if (lastDigit >= 2 && lastDigit <= 9) word = 'metai';
    label = `${rounded} ${word}`;
  }
  return { label, years, isOld: years >= 5 };
}

interface InventoryListViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  currentUser: User;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onTransferItem: (item: InventoryItem) => void;
  onInitiateWriteOff: (item: InventoryItem) => void;
  onViewItemDetail: (item: InventoryItem) => void;
  onPrintSpecificLabels: (itemIds: string[]) => void;
  onApproveWriteOff?: (item: InventoryItem, approvalYear: number, customActNumber?: string) => void;
  onRejectWriteOff?: (itemId: string) => void;
  onRestoreFromArchive?: (itemId: string) => void;
  onPermanentDelete?: (itemId: string) => void;
}

export const InventoryListView: React.FC<InventoryListViewProps> = ({
  items,
  departments,
  rooms,
  users,
  currentUser,
  onEditItem,
  onDeleteItem,
  onTransferItem,
  onInitiateWriteOff,
  onViewItemDetail,
  onPrintSpecificLabels,
  onApproveWriteOff,
  onRejectWriteOff,
  onRestoreFromArchive,
  onPermanentDelete,
}) => {
  // Navigation Lifecycle Tabs: Aktyvus turtas | Teikiami nurašyti | Nurašyto turto archyvas
  const [inventoryViewTab, setInventoryViewTab] = useState<'active' | 'to_writeoff' | 'archive'>('active');
  const [selectedArchiveYear, setSelectedArchiveYear] = useState<'all' | number>('all');

  // Modal for approving write-off
  const [approvalModalItem, setApprovalModalItem] = useState<InventoryItem | null>(null);
  const [approvalYear, setApprovalYear] = useState<number>(new Date().getFullYear());
  const [approvalActNumber, setApprovalActNumber] = useState<string>('');

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedAssetClass, setSelectedAssetClass] = useState<'all' | AssetClass>('all');
  const [selectedFundingSource, setSelectedFundingSource] = useState<'all' | FundingSource>('all');
  const [selectedUserId, setSelectedUserId] = useState<string>(
    currentUser.role === 'teacher' ? currentUser.id : 'all'
  );

  // Age Filter states
  const [ageFilterType, setAgeFilterType] = useState<
    'all' | 'older_5' | 'older_3' | 'older_8' | 'newer_1' | 'newer_3' | 'newer_5' | 'custom'
  >('all');
  const [customAgeDirection, setCustomAgeDirection] = useState<'older' | 'newer'>('older');
  const [customAgeYears, setCustomAgeYears] = useState<number>(5);

  // Selected items for bulk actions
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Computer Hardware Filter states
  const [selectedComputerType, setSelectedComputerType] = useState<'all' | ComputerType>('all');
  const [selectedRamFilter, setSelectedRamFilter] = useState<'all' | 'under_8' | '8' | '16' | 'over_16'>('all');
  const [selectedOsFilter, setSelectedOsFilter] = useState<'all' | 'windows' | 'linux' | 'apple' | 'android' | 'chrome'>('all');
  const [filterOnlyComputers, setFilterOnlyComputers] = useState<boolean>(false);

  // Counts for main lifecycle tabs
  const activeItemsCount = useMemo(() => {
    return items.filter(i => i.status !== 'written_off' && i.status !== 'to_writeoff').length;
  }, [items]);

  const pendingWriteOffCount = useMemo(() => {
    return items.filter(i => i.status === 'to_writeoff').length;
  }, [items]);

  const archivedCount = useMemo(() => {
    return items.filter(i => i.status === 'written_off').length;
  }, [items]);

  // Distinct archived years
  const archiveYears = useMemo(() => {
    const years = new Set<number>();
    items.forEach(i => {
      if (i.status === 'written_off' && i.writtenOffYear) {
        years.add(i.writtenOffYear);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [items]);

  // Filtered rooms based on selected department
  const availableRooms = useMemo(() => {
    if (selectedDeptId === 'all') return rooms;
    return rooms.filter(r => r.departmentId === selectedDeptId);
  }, [rooms, selectedDeptId]);

  // Brother PT-E920BT 1-by-1 printing state
  const [lastPrintedId, setLastPrintedId] = useState<string | null>(null);
  const [printToast, setPrintToast] = useState<{ id: string; message: string } | null>(null);

  const handlePrintSingleItem = async (item: InventoryItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setLastPrintedId(item.id);
    setPrintToast({
      id: item.id,
      message: `Spausdinama: ${item.inventoryNumber} (${item.name}). Užklijuokite ant daikto!`
    });

    try {
      await directPrintBrotherLabels({
        items: [item],
        rooms,
        departments,
        tapeWidthMm: 36,
        labelLengthMm: 68,
        codeType: 'qr_code',
        schoolName: 'TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.'
      });
      setTimeout(() => {
        setPrintToast({
          id: item.id,
          message: `Atspausdinta: ${item.inventoryNumber}! Užklijuota? Galite pasirinkti kitą.`
        });
        setTimeout(() => setPrintToast(null), 4500);
      }, 1000);
    } catch (err) {
      console.error('Single print failed', err);
      setPrintToast(null);
    }
  };

  // Filtered items list
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // 1. Lifecycle tab filtering
      if (inventoryViewTab === 'active') {
        if (item.status === 'written_off' || item.status === 'to_writeoff') return false;
      } else if (inventoryViewTab === 'to_writeoff') {
        if (item.status !== 'to_writeoff') return false;
      } else if (inventoryViewTab === 'archive') {
        if (item.status !== 'written_off') return false;
        if (selectedArchiveYear !== 'all' && item.writtenOffYear !== selectedArchiveYear) return false;
      }

      // Search
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesInv = item.inventoryNumber.toLowerCase().includes(query);
        const matchesSerial = item.serialNumber?.toLowerCase().includes(query) ?? false;
        const matchesAct = item.writeOffActNumber?.toLowerCase().includes(query) ?? false;
        const matchesReason = item.writeOffReason?.toLowerCase().includes(query) ?? false;
        const matchesCpu = item.specs?.cpu?.toLowerCase().includes(query) ?? false;
        const matchesOs = item.specs?.os?.toLowerCase().includes(query) ?? false;
        const matchesStorage = item.specs?.storage?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesInv && !matchesSerial && !matchesAct && !matchesReason && !matchesCpu && !matchesOs && !matchesStorage) return false;
      }

      // In archive tab, skip department/room filters if not set, or let them filter as usual
      if (selectedDeptId !== 'all' && item.departmentId !== selectedDeptId) return false;
      if (selectedRoomId !== 'all' && item.roomId !== selectedRoomId) return false;

      // Category
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;

      // Asset Class (IMT vs TMT)
      if (selectedAssetClass !== 'all') {
        const itemClass = item.assetClass || (item.purchasePrice >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term');
        if (itemClass !== selectedAssetClass) return false;
      }

      // Funding Origin (School, Municipality, Ministry, Projects, Donation)
      if (selectedFundingSource !== 'all') {
        const itemOrigin = item.fundingSource || 'school';
        if (itemOrigin !== selectedFundingSource) return false;
      }

      // Status (only in active tab)
      if (inventoryViewTab === 'active' && selectedStatus !== 'all' && item.status !== selectedStatus) return false;

      // User
      if (selectedUserId !== 'all' && item.responsibleUserId !== selectedUserId) return false;

      // Age filter
      if (ageFilterType !== 'all') {
        const age = calculateAgeInYears(item.acquisitionDate);
        if (ageFilterType === 'older_5' && age < 5) return false;
        if (ageFilterType === 'older_3' && age < 3) return false;
        if (ageFilterType === 'older_8' && age < 8) return false;
        if (ageFilterType === 'newer_1' && age > 1) return false;
        if (ageFilterType === 'newer_3' && age > 3) return false;
        if (ageFilterType === 'newer_5' && age > 5) return false;
        if (ageFilterType === 'custom') {
          if (customAgeDirection === 'older' && age < customAgeYears) return false;
          if (customAgeDirection === 'newer' && age > customAgeYears) return false;
        }
      }

      // Only computers toggle
      if (filterOnlyComputers) {
        if (!item.specs?.computerType && item.category !== 'Kompiuteriai') return false;
      }

      // Computer Type filter
      if (selectedComputerType !== 'all') {
        if (item.specs?.computerType !== selectedComputerType) return false;
      }

      // RAM filter
      if (selectedRamFilter !== 'all') {
        const ram = item.specs?.ramGb;
        if (ram === undefined) return false;
        if (selectedRamFilter === 'under_8' && ram >= 8) return false;
        if (selectedRamFilter === '8' && ram !== 8) return false;
        if (selectedRamFilter === '16' && ram !== 16) return false;
        if (selectedRamFilter === 'over_16' && ram <= 16) return false;
      }

      // OS filter
      if (selectedOsFilter !== 'all') {
        const os = (item.specs?.os || '').toLowerCase();
        if (selectedOsFilter === 'windows' && !os.includes('win')) return false;
        if (selectedOsFilter === 'linux' && !os.includes('linux') && !os.includes('ubuntu') && !os.includes('debian')) return false;
        if (selectedOsFilter === 'apple' && !os.includes('ipados') && !os.includes('macos') && !os.includes('apple') && !os.includes('ios')) return false;
        if (selectedOsFilter === 'android' && !os.includes('android')) return false;
        if (selectedOsFilter === 'chrome' && !os.includes('chrome')) return false;
      }

      return true;
    });
  }, [
    items, 
    inventoryViewTab,
    selectedArchiveYear,
    searchTerm, 
    selectedDeptId, 
    selectedRoomId, 
    selectedCategory, 
    selectedStatus, 
    selectedAssetClass, 
    selectedFundingSource, 
    selectedUserId, 
    ageFilterType, 
    customAgeDirection, 
    customAgeYears,
    selectedComputerType,
    selectedRamFilter,
    selectedOsFilter,
    filterOnlyComputers
  ]);

  const categories: ItemCategory[] = [
    'Kompiuteriai',
    'Kita IT įranga',
    'Baldai',
    'Mokymo priemonės',
    'Sporto inventorius',
    'Buitinė ir virtuvės technika',
    'Muzikos instrumentai',
    'Laboratorinė įranga',
    'Kita',
  ];

  const handleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedItemIds(next);
  };

  const openApproveModal = (item: InventoryItem) => {
    setApprovalModalItem(item);
    setApprovalYear(item.writtenOffYear || new Date().getFullYear());
    setApprovalActNumber(item.writeOffActNumber || `NUR-${new Date().getFullYear()}-01`);
  };

  const handleConfirmApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalModalItem || !onApproveWriteOff) return;
    onApproveWriteOff(approvalModalItem, Number(approvalYear), approvalActNumber.trim());
    setApprovalModalItem(null);
  };

  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  return (
    <div className="space-y-4">
      {/* Toast Notification for Brother 1-by-1 Printing */}
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

      {/* 1. Main View Lifecycle Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-300 rounded-xl p-3.5 shadow-xs">
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-lg border border-slate-300/60 text-xs">
          <button
            onClick={() => {
              setInventoryViewTab('active');
              setSelectedItemIds(new Set());
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 font-bold rounded-md transition-all cursor-pointer ${
              inventoryViewTab === 'active'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <span>📦 Aktyvus turtas</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
              inventoryViewTab === 'active' ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-slate-300 text-slate-700 font-semibold'
            }`}>
              {activeItemsCount}
            </span>
          </button>

          <button
            onClick={() => {
              setInventoryViewTab('to_writeoff');
              setSelectedItemIds(new Set());
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 font-bold rounded-md transition-all cursor-pointer ${
              inventoryViewTab === 'to_writeoff'
                ? 'bg-white text-rose-700 shadow-xs border border-slate-200'
                : 'text-slate-700 hover:text-rose-700'
            }`}
          >
            <span>⏳ Teikiami nurašyti</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
              pendingWriteOffCount > 0 ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-slate-300 text-slate-700 font-semibold'
            }`}>
              {pendingWriteOffCount}
            </span>
          </button>

          <button
            onClick={() => {
              setInventoryViewTab('archive');
              setSelectedItemIds(new Set());
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-md transition-all cursor-pointer ${
              inventoryViewTab === 'archive'
                ? 'bg-white text-purple-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-purple-600" />
            <span>📁 Nurašyto turto archyvas</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
              inventoryViewTab === 'archive' ? 'bg-purple-100 text-purple-800 font-bold' : 'bg-slate-200 text-slate-600'
            }`}>
              {archivedCount}
            </span>
          </button>
        </div>

        {/* Year Filter Pills for Archive View */}
        {inventoryViewTab === 'archive' && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-medium text-slate-500 mr-1 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-purple-600" />
              Archyvo metai:
            </span>
            <button
              onClick={() => setSelectedArchiveYear('all')}
              className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                selectedArchiveYear === 'all'
                  ? 'bg-purple-600 text-white font-semibold shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Visi metai ({archivedCount})
            </button>
            {archiveYears.map(year => {
              const count = items.filter(i => i.status === 'written_off' && i.writtenOffYear === year).length;
              return (
                <button
                  key={year}
                  onClick={() => setSelectedArchiveYear(year)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                    selectedArchiveYear === year
                      ? 'bg-purple-600 text-white font-semibold shadow-xs'
                      : 'bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100'
                  }`}
                >
                  {year} m. nurašytas ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Info banner for "Teikiami nurašyti" */}
      {inventoryViewTab === 'to_writeoff' && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Nurašymui pateiktas turtas (laukia komisijos sprendimo)</p>
            <p className="text-rose-700">
              Ūkio darbuotojų arba mokytojų teikiamas nebetinkamas naudoti inventorius. Nurašymo komisijai patvirtinus aktą, turtas perkeliamas į archyvą pagal nurodytus metus (pvz. 2026 m., 2025 m., 2020 m.). Galite patvirtinti nurašymą arba atmesti teikimą.
            </p>
          </div>
        </div>
      )}

      {/* Info banner for "Nurašyto turto archyvas" */}
      {inventoryViewTab === 'archive' && (
        <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex items-start gap-2.5">
          <Archive className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Nurašyto materialiojo turto archyvas pagal metus</p>
            <p className="text-purple-700">
              Čia saugoma visa mokyklos nurašyto ir likviduoto turto istorija (pvz., 2020 m. nurašytas turtas, 2025 m., 2026 m.). Esant reikalui nurašytą daiktą galima atkurti į apskaitą arba galutinai ištrinti iš registro.
            </p>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-300 rounded-xl p-4.5 space-y-3.5 shadow-xs">
        {/* Top search line */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={
                inventoryViewTab === 'archive'
                  ? "Ieškoti archyve pagal pavadinimą, inventoriaus Nr., akto Nr. (pvz. NUR-2020-03) ar priežastį..."
                  : "Ieškoti pagal pavadinimą, inventorinį nr. (pvz., TM-2023-0001) arba serijos nr..."
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 placeholder:text-slate-500 font-medium shadow-2xs text-slate-900"
            />
          </div>

          {/* Bulk actions bar if items selected */}
          {selectedItemIds.size > 0 && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-300 px-3.5 py-2 rounded-lg text-xs text-blue-950 shadow-2xs">
              <span className="font-bold">Pasirinkta: {selectedItemIds.size} vnt.</span>
              <button
                onClick={() => onPrintSpecificLabels(Array.from(selectedItemIds))}
                className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-900 ml-2 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                Spausdinti QR lipdukus
              </button>
            </div>
          )}
        </div>

        {/* Filter dropdowns row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 pt-3 border-t border-slate-200 text-xs">
          {/* Department */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Skyrius</label>
            <select
              value={selectedDeptId}
              onChange={(e) => {
                setSelectedDeptId(e.target.value);
                setSelectedRoomId('all');
              }}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
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
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
            >
              <option value="all">Visi kabinetai ({availableRooms.length})</option>
              {availableRooms.map(r => (
                <option key={r.id} value={r.id}>{formatRoomName(r)}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Kategorija</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
            >
              <option value="all">Visos kategorijos</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Asset Class (IMT vs TMT) */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Turto grupė</label>
            <select
              value={selectedAssetClass}
              onChange={(e) => setSelectedAssetClass(e.target.value as any)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
            >
              <option value="all">Visos grupės</option>
              <option value="long_term">Ilgalaikis (≥ 750 €)</option>
              <option value="short_term">Trumpalaikis (&lt; 750 €)</option>
            </select>
          </div>

          {/* Funding Origin */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Turto kilmė / Panauda</label>
            <select
              value={selectedFundingSource}
              onChange={(e) => setSelectedFundingSource(e.target.value as any)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
            >
              <option value="all">Visi šaltiniai</option>
              <option value="school">Mokyklos biudžetas</option>
              <option value="municipality">Savivaldybės panauda</option>
              <option value="ministry">ŠMSM panauda</option>
              <option value="project">ES / STEAM projektai</option>
              <option value="donation">Kita</option>
            </select>
          </div>

          {/* Age filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Amžius / Eksploatacija</label>
            <select
              value={ageFilterType}
              onChange={(e) => setAgeFilterType(e.target.value as any)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer"
            >
              <option value="all">Bet koks amžius</option>
              <option value="older_5">&gt; 5 m. (Nusidėvėjęs)</option>
              <option value="older_3">&gt; 3 m.</option>
              <option value="older_8">&gt; 8 m. (Pasenęs)</option>
              <option value="newer_1">Nauji (iki 1 m.)</option>
              <option value="newer_3">Iki 3 m.</option>
              <option value="newer_5">Iki 5 m.</option>
            </select>
          </div>

          {/* Responsible Person */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Atsakingas asmuo</label>
            <select
              value={selectedUserId}
              disabled={currentUser.role === 'teacher'}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-600 shadow-2xs cursor-pointer disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="all">Visi darbuotojai</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Computer Hardware Filters bar */}
        {(selectedCategory === 'all' || selectedCategory === 'Kompiuteriai') && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase text-sky-800 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-600" />
                Kompiuterinės technikos filtrai (CPU / RAM / OS / Tipas)
              </span>
              <button
                type="button"
                onClick={() => setFilterOnlyComputers(!filterOnlyComputers)}
                className={`text-[11px] font-medium px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  filterOnlyComputers ? 'bg-sky-600 text-white font-semibold' : 'text-sky-700 bg-sky-50 hover:bg-sky-100'
                }`}
              >
                {filterOnlyComputers ? '✓ Rodomi tik kompiuteriai' : 'Filtruoti tik kompiuterius'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Įrenginio tipas</label>
                <select
                  value={selectedComputerType}
                  onChange={(e) => setSelectedComputerType(e.target.value as any)}
                  className={`w-full bg-white border rounded px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-sky-500 cursor-pointer ${
                    selectedComputerType !== 'all' ? 'border-sky-500 text-sky-800 bg-sky-50/40' : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <option value="all">Visi tipai</option>
                  <option value="laptop">Nešiojami kompiuteriai</option>
                  <option value="desktop">Stacionarūs kompiuteriai</option>
                  <option value="server">Serveriai</option>
                  <option value="tablet">Planšetiniai kompiuteriai</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Operatyvioji atmintis (RAM)</label>
                <select
                  value={selectedRamFilter}
                  onChange={(e) => setSelectedRamFilter(e.target.value as any)}
                  className={`w-full bg-white border rounded px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-sky-500 cursor-pointer ${
                    selectedRamFilter !== 'all' ? 'border-sky-500 text-sky-800 bg-sky-50/40' : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <option value="all">Bet kokia RAM atmintis</option>
                  <option value="under_8">&lt; 8 GB</option>
                  <option value="8">8 GB RAM</option>
                  <option value="16">16 GB RAM</option>
                  <option value="over_16">&gt; 16 GB RAM</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Operacinė sistema (OS)</label>
                <select
                  value={selectedOsFilter}
                  onChange={(e) => setSelectedOsFilter(e.target.value as any)}
                  className={`w-full bg-white border rounded px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-sky-500 cursor-pointer ${
                    selectedOsFilter !== 'all' ? 'border-sky-500 text-sky-800 bg-sky-50/40' : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <option value="all">Visos operacinės sistemos</option>
                  <option value="windows">Windows (10 / 11 Pro)</option>
                  <option value="linux">Linux (Ubuntu / Debian / Server)</option>
                  <option value="apple">Apple (iPadOS / macOS)</option>
                  <option value="android">Android</option>
                  <option value="chrome">ChromeOS</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Count & Quick Reset Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span>
            Rasta <strong className="font-mono tabular-nums text-slate-900">{filteredItems.length}</strong> vnt.
          </span>
          {inventoryViewTab === 'archive' && selectedArchiveYear !== 'all' && (
            <span className="bg-purple-100 text-purple-900 font-semibold px-2 py-0.5 rounded text-[11px]">
              Archyvas: {selectedArchiveYear} m.
            </span>
          )}
          {inventoryViewTab === 'to_writeoff' && (
            <span className="bg-rose-100 text-rose-900 font-semibold px-2 py-0.5 rounded text-[11px]">
              Laukia nurašymo patvirtinimo
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {filteredItems.length > 0 && (
            <button
              onClick={() => {
                const csv = StorageService.exportToCSV(filteredItems, departments, rooms, users);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `tryskiai-${inventoryViewTab}-${selectedArchiveYear}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Eksportuoti ({filteredItems.length} vnt.)</span>
            </button>
          )}

          {(searchTerm || selectedDeptId !== 'all' || selectedRoomId !== 'all' || selectedCategory !== 'all' || selectedAssetClass !== 'all' || selectedFundingSource !== 'all' || selectedArchiveYear !== 'all' || ageFilterType !== 'all' || selectedComputerType !== 'all' || selectedRamFilter !== 'all' || selectedOsFilter !== 'all' || filterOnlyComputers) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedDeptId('all');
                setSelectedRoomId('all');
                setSelectedCategory('all');
                setSelectedStatus('all');
                setSelectedAssetClass('all');
                setSelectedFundingSource('all');
                setSelectedArchiveYear('all');
                setAgeFilterType('all');
                setSelectedComputerType('all');
                setSelectedRamFilter('all');
                setSelectedOsFilter('all');
                setFilterOnlyComputers(false);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
            >
              Išvalyti filtrus
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-300 text-slate-800 font-bold select-none">
                <th className="py-3 px-3 w-10 text-center">
                  <button
                    onClick={handleSelectAll}
                    title="Pasirinkti visus"
                    className="cursor-pointer text-slate-500 hover:text-slate-800"
                  >
                    {selectedItemIds.size === filteredItems.length && filteredItems.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-3">Inventorinis Nr.</th>
                <th className="py-2.5 px-3">Pavadinimas ir aprašas</th>

                {inventoryViewTab === 'archive' ? (
                  <>
                    <th className="py-2.5 px-3 whitespace-nowrap">Nurašymo metai / data</th>
                    <th className="py-2.5 px-3">Nurašymo aktas ir priežastis</th>
                    <th className="py-2.5 px-3 text-right">Pradinė kaina</th>
                    <th className="py-2.5 px-3">Būsena</th>
                  </>
                ) : inventoryViewTab === 'to_writeoff' ? (
                  <>
                    <th className="py-2.5 px-3">Patalpa / Skyrius</th>
                    <th className="py-2.5 px-3">Atsakingas asmuo</th>
                    <th className="py-2.5 px-3 text-right">Kaina (€)</th>
                    <th className="py-2.5 px-3">Nurašymo priežastis / Defektas</th>
                  </>
                ) : (
                  <>
                    <th className="py-2.5 px-3">Patalpa / Skyrius</th>
                    <th className="py-2.5 px-3">Atsakingas asmuo</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Įsigijimas / Amžius</th>
                    <th className="py-2.5 px-3 text-right">Kaina (€)</th>
                    <th className="py-2.5 px-3">Būsena / Būklė</th>
                  </>
                )}

                <th className="py-2.5 px-3 text-right whitespace-nowrap">Veiksmai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Filter className="w-8 h-8 text-slate-300" />
                      <p className="text-sm font-medium text-slate-600">
                        {inventoryViewTab === 'archive' 
                          ? 'Nurašyto turto archyve įrašų nerasta' 
                          : inventoryViewTab === 'to_writeoff'
                          ? 'Šiuo metu nėra nurašymui pateikto turto'
                          : 'Pagal nurodytus filtrus turto nerasta'}
                      </p>
                      <p className="text-xs text-slate-400">Pabandykite pakeisti paieškos žodį arba išvalyti filtrus</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const dept = departments.find(d => d.id === item.departmentId);
                  const room = rooms.find(r => r.id === item.roomId);
                  const user = users.find(u => u.id === item.responsibleUserId);
                  const isSelected = selectedItemIds.has(item.id);

                  const statusLabel = 
                    item.status === 'active' ? 'Aktyvus' :
                    item.status === 'in_repair' ? 'Remontuojamas' :
                    item.status === 'to_writeoff' ? 'Teikiamas nurašyti' : 'Nurašytas';

                  const statusColor = 
                    item.status === 'active' ? 'text-emerald-700' :
                    item.status === 'in_repair' ? 'text-amber-700' :
                    item.status === 'to_writeoff' ? 'text-rose-700 font-bold' : 'text-purple-700 font-semibold';

                  const ageInfo = formatAgeDisplay(item.acquisitionDate);

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/70 transition-colors ${isSelected ? 'bg-blue-50/40' : ''}`}
                    >
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => handleToggleSelect(item.id)}
                          className="cursor-pointer text-slate-400 hover:text-slate-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Inventory Number */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <button
                          onClick={() => onViewItemDetail(item)}
                          className="font-mono tabular-nums font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          {item.inventoryNumber}
                        </button>
                        {item.serialNumber && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            SN: {item.serialNumber}
                          </div>
                        )}
                      </td>

                      {/* Name & details */}
                      <td className="py-2.5 px-3 max-w-xs">
                        <div className="flex items-center gap-2.5">
                          {item.photoUrl ? (
                            <button
                              onClick={() => onViewItemDetail(item)}
                              title="Peržiūrėti nuotrauką"
                              className="w-9 h-9 rounded overflow-hidden shrink-0 border border-slate-200 hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer bg-slate-100"
                            >
                              <img
                                src={item.photoUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <button
                              onClick={() => onViewItemDetail(item)}
                              title="Prisegti nuotrauką"
                              className="w-9 h-9 rounded shrink-0 border border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 flex items-center justify-center text-slate-300 hover:text-blue-600 transition-colors cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="font-medium text-slate-900 truncate">
                              {item.name}
                            </div>
                            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-slate-600">{item.category}</span>
                              <span className="text-slate-300">·</span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                                (item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD)
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}>
                                {(item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD) ? 'IMT (≥750€)' : 'TMT (<750€)'}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                item.fundingSource === 'municipality' ? 'bg-amber-100 text-amber-900' :
                                item.fundingSource === 'ministry' ? 'bg-purple-100 text-purple-900' :
                                item.fundingSource === 'project' ? 'bg-emerald-100 text-emerald-900' :
                                item.fundingSource === 'donation' ? 'bg-pink-100 text-pink-900' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {FUNDING_SOURCE_SHORT_LABELS[item.fundingSource] || 'Gimnazijos lėšos'}
                              </span>
                              {item.notes && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="italic text-slate-400 truncate max-w-[140px]">{item.notes}</span>
                                </>
                              )}
                            </div>

                            {/* Computer Specs Badges */}
                            {item.specs && (item.specs.computerType || item.specs.cpu || item.specs.ramGb || item.specs.storage || item.specs.os) && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10px]">
                                {item.specs.computerType && (
                                  <span className="inline-flex items-center gap-1 font-semibold bg-sky-50 text-sky-800 border border-sky-200 px-1.5 py-0.2 rounded">
                                    {item.specs.computerType === 'laptop' && <Laptop className="w-2.5 h-2.5 text-sky-600" />}
                                    {item.specs.computerType === 'desktop' && <Monitor className="w-2.5 h-2.5 text-sky-600" />}
                                    {item.specs.computerType === 'server' && <Server className="w-2.5 h-2.5 text-amber-600" />}
                                    {item.specs.computerType === 'tablet' && <Tablet className="w-2.5 h-2.5 text-emerald-600" />}
                                    <span>{COMPUTER_TYPE_SHORT_LABELS[item.specs.computerType]}</span>
                                  </span>
                                )}
                                {item.specs.cpu && (
                                  <span className="font-mono bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                                    {item.specs.cpu}
                                  </span>
                                )}
                                {item.specs.ramGb && (
                                  <span className="font-mono font-bold bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.2 rounded">
                                    {item.specs.ramGb} GB RAM
                                  </span>
                                )}
                                {item.specs.storage && (
                                  <span className="font-mono bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
                                    {item.specs.storage}
                                  </span>
                                )}
                                {item.specs.os && (
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                                    {item.specs.os}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Dynamic Columns based on Tab */}
                      {inventoryViewTab === 'archive' ? (
                        <>
                          {/* Write-off Year & Date */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 font-semibold text-purple-900 bg-purple-100 px-2 py-0.5 rounded text-xs">
                              <Archive className="w-3 h-3 text-purple-700" />
                              {item.writtenOffYear ? `${item.writtenOffYear} m.` : 'Archyvuota'}
                            </span>
                            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                              {item.writtenOffDate || item.acquisitionDate}
                            </div>
                          </td>

                          {/* Write-off Act & Reason */}
                          <td className="py-2.5 px-3">
                            <div className="font-mono text-xs font-semibold text-slate-800">
                              {item.writeOffActNumber || 'Nenurodytas aktas'}
                            </div>
                            <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                              {item.writeOffReason || item.notes || 'Fizinis nusidėvėjimas'}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {item.purchasePrice.toFixed(2)} €
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              Nurašytas turtas
                            </span>
                          </td>
                        </>
                      ) : inventoryViewTab === 'to_writeoff' ? (
                        <>
                          {/* Room & Dept */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-slate-800 font-medium">
                              {formatRoomName(room, true)}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {dept?.name}
                            </div>
                          </td>

                          {/* Responsible User */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-slate-800 font-medium">
                              {user?.fullName || 'Nepriskirta'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {user?.roleTitle}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {item.purchasePrice.toFixed(2)} €
                            </div>
                          </td>

                          {/* Reason */}
                          <td className="py-2.5 px-3">
                            <div className="text-xs font-medium text-rose-800">
                              {item.writeOffReason || 'Defektas / Neveikia'}
                            </div>
                            <div className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-2">
                              {item.notes || 'Pateikta komisijos vertinimui'}
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Room & Dept */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-slate-800 font-medium">
                              {formatRoomName(room, true)}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {dept?.name}
                            </div>
                          </td>

                          {/* User */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="text-slate-800 font-medium">
                              {user?.fullName || 'Nepriskirta'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {user?.roleTitle}
                            </div>
                          </td>

                          {/* Acquisition Date & Age */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="font-mono text-slate-900 font-medium">
                              {item.acquisitionDate}
                            </div>
                            <div className="text-[11px] flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className={ageInfo.isOld ? 'font-semibold text-amber-700 font-mono' : 'text-slate-600 font-mono'}>
                                {ageInfo.label}
                              </span>
                              {ageInfo.isOld && (
                                <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded font-semibold ml-0.5">
                                  &gt; 5 m.
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {item.purchasePrice.toFixed(2)} €
                            </div>
                          </td>

                          {/* Status & Condition */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className={`font-medium ${statusColor}`}>
                              {statusLabel}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Būklė: {item.condition === 'new' ? 'Nauja' : item.condition === 'good' ? 'Gera' : item.condition === 'fair' ? 'Patenkinama' : 'Prasta'}
                            </div>
                          </td>
                        </>
                      )}

                      {/* Action buttons */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Direct 1-by-1 Brother Print Button */}
                          {inventoryViewTab === 'active' && (
                            <button
                              onClick={(e) => handlePrintSingleItem(item, e)}
                              title={`Spausdinti 36 mm etiketę į Brother PT-E920BT (${item.inventoryNumber})`}
                              className={`p-1 rounded cursor-pointer transition-all flex items-center gap-1 ${
                                lastPrintedId === item.id
                                  ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500 font-semibold px-1.5'
                                  : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                              }`}
                            >
                              {lastPrintedId === item.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span className="text-[10px] text-emerald-800">Atspausdinta</span>
                                </>
                              ) : (
                                <Printer className="w-4 h-4 text-blue-600" />
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => onViewItemDetail(item)}
                            title="Peržiūrėti kortelę ir QR"
                            className="p-1 text-slate-400 hover:text-blue-600 rounded cursor-pointer transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Archive Tab Actions */}
                          {inventoryViewTab === 'archive' && canManage && (
                            <>
                              <button
                                onClick={() => onRestoreFromArchive && onRestoreFromArchive(item.id)}
                                title="Atkurti į aktyvią apskaitą"
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Atkurti</span>
                              </button>
                              <button
                                onClick={() => onPermanentDelete && onPermanentDelete(item.id)}
                                title="Ištrinti visam laikui iš registro"
                                className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}

                          {/* Pending Write-off Tab Actions */}
                          {inventoryViewTab === 'to_writeoff' && canManage && (
                            <>
                              <button
                                onClick={() => openApproveModal(item)}
                                title="Patvirtinti nurašymą ir archyvuoti"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-2xs cursor-pointer transition-colors"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>Patvirtinti nurašymą</span>
                              </button>
                              <button
                                onClick={() => onRejectWriteOff && onRejectWriteOff(item.id)}
                                title="Atmesti teikimą ir grąžinti į aktyvius"
                                className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer transition-colors"
                              >
                                Atmesti
                              </button>
                            </>
                          )}

                          {/* Active Tab Actions */}
                          {inventoryViewTab === 'active' && canManage && (
                            <>
                              <button
                                onClick={() => onTransferItem(item)}
                                title="Perkelti į kitą kabinetą / asmeniui"
                                className="p-1 text-slate-400 hover:text-emerald-600 rounded cursor-pointer transition-colors"
                              >
                                <ArrowLeftRight className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => onEditItem(item)}
                                title="Redaguoti duomenis"
                                className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer transition-colors"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => onInitiateWriteOff(item)}
                                title="Teikti nurašymui"
                                className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Write-off Approval Modal */}
      {approvalModalItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-rose-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Patvirtinti nurašymą ir perkelti į archyvą
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => setApprovalModalItem(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded border border-slate-200 text-xs space-y-1">
              <div className="font-semibold text-slate-900">{approvalModalItem.name}</div>
              <div className="text-slate-500 flex justify-between">
                <span>Inv. Nr.: <strong className="font-mono text-blue-600">{approvalModalItem.inventoryNumber}</strong></span>
                <span>Kaina: <strong className="font-mono">{approvalModalItem.purchasePrice.toFixed(2)} €</strong></span>
              </div>
              {approvalModalItem.writeOffReason && (
                <div className="text-rose-700 pt-1 border-t border-slate-200 mt-1">
                  Priežastis: {approvalModalItem.writeOffReason}
                </div>
              )}
            </div>

            <form onSubmit={handleConfirmApproval} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Nurašymo ir archyvavimo metai * (pvz. 2026 m. arba 2020 m.)
                </label>
                <select
                  value={approvalYear}
                  onChange={(e) => setApprovalYear(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-rose-500 font-semibold text-slate-800"
                >
                  <option value={2026}>2026 metai (Dabartiniai)</option>
                  <option value={2025}>2025 metai</option>
                  <option value={2024}>2024 metai</option>
                  <option value={2023}>2023 metai</option>
                  <option value={2022}>2022 metai</option>
                  <option value={2021}>2021 metai</option>
                  <option value={2020}>2020 metai (Archyvinis)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Turtas bus perkeltas į nurašyto turto archyvą pagal pasirinktus metus.
                </p>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Nurašymo akto Nr. *
                </label>
                <input
                  type="text"
                  required
                  value={approvalActNumber}
                  onChange={(e) => setApprovalActNumber(e.target.value)}
                  placeholder={`NUR-${approvalYear}-01`}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-rose-500 font-mono font-medium"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setApprovalModalItem(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-xs cursor-pointer"
                >
                  Patvirtinti ir archyvuoti
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
