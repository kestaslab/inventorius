import React, { useState, useMemo } from 'react';
import { 
  QrCode, 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  Scan, 
  Camera, 
  Search,
  Building,
  Check,
  RefreshCw,
  Printer,
  Settings,
  Users,
  Calendar,
  FileText,
  X,
  Plus,
  Shield,
  Layers,
  MapPin,
  CheckSquare,
  Square,
  Download
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  AuditSession, 
  User, 
  formatRoomName 
} from '../types/inventory';

interface AuditViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  auditSession: AuditSession;
  currentUser: User;
  onUpdateAuditSession: (session: AuditSession) => void;
  onRelocateItem: (itemId: string, newRoomId: string) => void;
}

export const AuditView: React.FC<AuditViewProps> = ({
  items,
  departments,
  rooms,
  users,
  auditSession,
  currentUser,
  onUpdateAuditSession,
  onRelocateItem,
}) => {
  // Department filter state (allows focusing on a single branch like 'Tryškių darželis')
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>(() => rooms[0]?.id || '');
  const [inputCode, setInputCode] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'relocated' | 'not_found' | 'already_scanned';
    message: string;
    item?: InventoryItem;
  } | null>(null);

  // Settings Modal State (Chairman, Committee, Order details)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Temporary state for Settings Modal Form
  const [sessionTitle, setSessionTitle] = useState(auditSession.title || '');
  const [sessionYear, setSessionYear] = useState<number>(auditSession.year || new Date().getFullYear());
  const [chairmanId, setChairmanId] = useState<string>(() => {
    if (auditSession.committeeChairmanId) return auditSession.committeeChairmanId;
    const foundUser = users.find(u => u.fullName === auditSession.committeeChairman);
    if (foundUser) return foundUser.id;
    return users[0]?.id || '';
  });
  const [customChairmanName, setCustomChairmanName] = useState<string>(
    auditSession.committeeChairman || auditSession.committeeMembers?.[0] || 'Kęstutis Labanauskas'
  );
  const [selectedMemberNames, setSelectedMemberNames] = useState<string[]>(
    auditSession.committeeMembers || ['Sigita Navickienė']
  );
  const [newMemberInput, setNewMemberInput] = useState('');
  const [orderNumber, setOrderNumber] = useState(auditSession.orderNumber || 'V-14');
  const [orderDate, setOrderDate] = useState(auditSession.orderDate || new Date().toISOString().split('T')[0]);
  const [sessionNotes, setSessionNotes] = useState(auditSession.notes || '');

  // Filtered rooms depending on selected department
  const availableRooms = useMemo(() => {
    if (selectedDeptId === 'all') return rooms;
    return rooms.filter(r => r.departmentId === selectedDeptId);
  }, [rooms, selectedDeptId]);

  // Ensure selectedRoomId belongs to available rooms
  const activeRoom = useMemo(() => {
    const found = availableRooms.find(r => r.id === selectedRoomId);
    if (found) return found;
    return availableRooms[0] || null;
  }, [availableRooms, selectedRoomId]);

  // When selectedDeptId changes, if active room is not in that department, switch to first room
  const handleSelectDepartment = (deptId: string) => {
    setSelectedDeptId(deptId);
    setScanFeedback(null);
    if (deptId === 'all') {
      if (!selectedRoomId && rooms.length > 0) {
        setSelectedRoomId(rooms[0].id);
      }
    } else {
      const deptRooms = rooms.filter(r => r.departmentId === deptId);
      if (deptRooms.length > 0) {
        setSelectedRoomId(deptRooms[0].id);
      }
    }
  };

  const activeDept = departments.find(d => d.id === activeRoom?.departmentId);

  // Items expected in this room
  const expectedItems = useMemo(() => {
    if (!activeRoom) return [];
    return items.filter(i => i.roomId === activeRoom.id);
  }, [items, activeRoom]);
  
  // Audited state in this session
  const scannedSet = useMemo(() => new Set(auditSession.scannedItemIds || []), [auditSession.scannedItemIds]);
  const scannedInRoom = expectedItems.filter(i => scannedSet.has(i.id));
  const missingInRoom = expectedItems.filter(i => !scannedSet.has(i.id));

  const progressPercent = expectedItems.length > 0 
    ? Math.round((scannedInRoom.length / expectedItems.length) * 100) 
    : 100;

  // Department-specific items and statistics
  const deptItems = useMemo(() => {
    if (selectedDeptId === 'all') return items;
    return items.filter(i => i.departmentId === selectedDeptId);
  }, [items, selectedDeptId]);

  const deptScannedCount = deptItems.filter(i => scannedSet.has(i.id)).length;
  const deptProgressPct = deptItems.length > 0
    ? Math.round((deptScannedCount / deptItems.length) * 100)
    : 0;

  // Scan or manual entry submit
  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    const query = inputCode.trim().toUpperCase();
    if (!query) return;

    // Search item by inventory number or serial or id
    const found = items.find(
      i => i.inventoryNumber.toUpperCase() === query || 
           i.serialNumber?.toUpperCase() === query ||
           i.id === query
    );

    if (!found) {
      setScanFeedback({
        type: 'not_found',
        message: `Turtas su kodu "${query}" sistemoje nerastas!`,
      });
      setInputCode('');
      return;
    }

    // Check if already scanned in this session
    if (scannedSet.has(found.id)) {
      setScanFeedback({
        type: 'already_scanned',
        message: `Turtas [${found.inventoryNumber}] "${found.name}" jau buvo nuskenuotas šioje sesijoje!`,
        item: found,
      });
      setInputCode('');
      return;
    }

    // Check if found in the expected room
    if (found.roomId === activeRoom.id) {
      // Correct room!
      const updatedScanned = [...auditSession.scannedItemIds, found.id];
      onUpdateAuditSession({
        ...auditSession,
        scannedItemIds: updatedScanned,
      });
      setScanFeedback({
        type: 'success',
        message: `Rasta vietoje: [${found.inventoryNumber}] ${found.name}`,
        item: found,
      });
    } else {
      // Belongs to another room!
      const oldRoom = rooms.find(r => r.id === found.roomId);
      const oldDept = departments.find(d => d.id === oldRoom?.departmentId);
      setScanFeedback({
        type: 'relocated',
        message: `DĖMESIO: Turtas [${found.inventoryNumber}] pagal registrą priklauso ${oldDept?.code || ''} ${formatRoomName(oldRoom)}, bet rastas čia!`,
        item: found,
      });
    }

    setInputCode('');
  };

  const handleConfirmRelocation = (item: InventoryItem) => {
    if (!activeRoom) return;
    onRelocateItem(item.id, activeRoom.id);
    const updatedScanned = [...auditSession.scannedItemIds, item.id];
    onUpdateAuditSession({
      ...auditSession,
      scannedItemIds: updatedScanned,
    });
    setScanFeedback({
      type: 'success',
      message: `Turto vieta atnaujinta į ${formatRoomName(activeRoom)} ir patvirtinta inventorizacijoje!`,
      item,
    });
  };

  const handleQuickMark = (itemId: string) => {
    if (scannedSet.has(itemId)) return;
    const updatedScanned = [...auditSession.scannedItemIds, itemId];
    onUpdateAuditSession({
      ...auditSession,
      scannedItemIds: updatedScanned,
    });
  };

  // Save Settings Modal
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const chUser = users.find(u => u.id === chairmanId);
    const finalChairmanName = chUser ? `${chUser.fullName} (${chUser.roleTitle || 'Komisijos pirmininkas'})` : customChairmanName;

    const updatedSession: AuditSession = {
      ...auditSession,
      title: sessionTitle.trim() || 'Materialiojo turto inventorizacija',
      year: sessionYear,
      committeeChairman: finalChairmanName,
      committeeChairmanId: chUser ? chUser.id : undefined,
      committeeMembers: selectedMemberNames,
      orderNumber: orderNumber.trim(),
      orderDate: orderDate,
      notes: sessionNotes.trim(),
    };

    onUpdateAuditSession(updatedSession);
    setIsSettingsOpen(false);
  };

  const activeChairmanDisplay = auditSession.committeeChairman || 
    (auditSession.committeeMembers && auditSession.committeeMembers[0]) || 
    'Kęstutis Labanauskas';

  return (
    <div className="space-y-6">
      {/* Session Title & Settings Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                {auditSession.title}
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-full">
                {auditSession.status === 'completed' ? 'Užbaigta' : 'Vykdoma'}
              </span>
            </div>
            
            {/* Meta details: Chairman, Committee, Order */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Komisijos pirmininkas:</span>
                <strong className="text-slate-900 font-semibold">{activeChairmanDisplay}</strong>
              </div>

              {auditSession.committeeMembers && auditSession.committeeMembers.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Komisijos nariai:</span>
                  <span className="text-slate-700">
                    {auditSession.committeeMembers
                      .filter(m => !m.toLowerCase().includes((activeChairmanDisplay.split(' ')[0] || '').toLowerCase()))
                      .join(', ') || 'Nėra kitų narių'}
                  </span>
                </div>
              )}

              {auditSession.orderNumber && (
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Direktoriaus įsakymas:</span>
                  <span className="font-mono font-medium text-slate-800">
                    Nr. {auditSession.orderNumber} ({auditSession.orderDate || ''})
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons: Settings & Print A4 */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => {
                setSessionTitle(auditSession.title);
                setSessionYear(auditSession.year);
                setOrderNumber(auditSession.orderNumber || 'V-14');
                setOrderDate(auditSession.orderDate || new Date().toISOString().split('T')[0]);
                const currentChair = auditSession.committeeChairman || 'Kęstutis Labanauskas (IT Administratorius)';
                setCustomChairmanName(currentChair);
                const foundUser = users.find(u => currentChair.includes(u.fullName));
                if (foundUser) setChairmanId(foundUser.id);
                setSelectedMemberNames(auditSession.committeeMembers || []);
                setIsSettingsOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-slate-600" />
              <span>Nustatymai ir komisija</span>
            </button>

            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-blue-600" />
              <span>Spausdinti apyrašą (A4)</span>
            </button>

            <div className="hidden sm:block pl-2 border-l border-slate-200 text-right">
              <div className="text-[11px] text-slate-400 uppercase font-medium">Bendra pažanga</div>
              <div className="text-xs font-bold font-mono text-slate-900">
                {auditSession.scannedItemIds.length} / {items.length} vnt. (
                {Math.round((auditSession.scannedItemIds.length / items.length) * 100)}%)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Department Filter Tabs (CRITICAL for remote branches like Tryškių darželis) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Skyriaus pasirinkimas (nuvažiavus į vietą)
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Pasirinkite skyrių, kad kabinetų sąraše nesimaišytų kitų skyrių patalpos
          </span>
        </div>

        {/* Department Switcher Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
          <button
            onClick={() => handleSelectDepartment('all')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              selectedDeptId === 'all'
                ? 'bg-blue-50/80 border-blue-500 text-blue-950 ring-1 ring-blue-500 shadow-xs'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold truncate">Visi skyriai (visa gimnazija)</span>
              {selectedDeptId === 'all' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{rooms.length} kabinetai</span>
              <span className="font-mono font-medium">{auditSession.scannedItemIds.length} / {items.length} vnt.</span>
            </div>
          </button>

          {departments.map(dept => {
            const isSelected = selectedDeptId === dept.id;
            const deptRooms = rooms.filter(r => r.departmentId === dept.id);
            const deptItemCount = items.filter(i => i.departmentId === dept.id).length;
            const deptScanned = items.filter(i => i.departmentId === dept.id && scannedSet.has(i.id)).length;
            const pct = deptItemCount > 0 ? Math.round((deptScanned / deptItemCount) * 100) : 0;

            return (
              <button
                key={dept.id}
                onClick={() => handleSelectDepartment(dept.id)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/80 border-blue-500 text-blue-950 ring-1 ring-blue-500 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-xs font-bold truncate">{dept.name}</span>
                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-200/80 text-slate-600 font-semibold">
                      {dept.code}
                    </span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{deptRooms.length} kab.</span>
                  <span className={`font-mono font-medium ${pct === 100 ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {deptScanned}/{deptItemCount} ({pct}%)
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Audit Workspace: Scanner + Room Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Room selection & Live Scanner (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Room Selector Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                1. Pasirinkite tikrinamą kabinetą
              </label>
              <span className="text-[11px] font-mono text-slate-500">
                Rodomi: {availableRooms.length} kab.
              </span>
            </div>

            {availableRooms.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                Šiame skyriuje nėra sukurtų kabinetų. Pasirinkite kitą skyrių arba sukurkite kabinetus skiltyje „Skyriai ir kabinetai“.
              </div>
            ) : (
              <select
                value={activeRoom?.id || ''}
                onChange={(e) => {
                  setSelectedRoomId(e.target.value);
                  setScanFeedback(null);
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
              >
                {availableRooms.map(r => {
                  const dept = departments.find(d => d.id === r.departmentId);
                  const count = items.filter(i => i.roomId === r.id).length;
                  const scanned = items.filter(i => i.roomId === r.id && scannedSet.has(i.id)).length;
                  return (
                    <option key={r.id} value={r.id}>
                      {formatRoomName(r, true)} {selectedDeptId === 'all' && dept ? `[${dept.code}]` : ''} — {scanned}/{count} vnt.
                    </option>
                  );
                })}
              </select>
            )}

            {activeRoom && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>Skyrius:</span>
                  <span className="font-semibold text-slate-900">{activeDept?.name} ({activeDept?.code})</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Patalpos pavadinimas:</span>
                  <span className="font-medium text-slate-900">{formatRoomName(activeRoom)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Patikrinta kabinete:</span>
                  <span className="font-mono tabular-nums text-slate-900 font-bold">
                    {scannedInRoom.length} iš {expectedItems.length} vnt. ({progressPercent}%)
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 mt-1 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Scanner Input Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Scan className="w-4 h-4 text-blue-600" />
                2. QR / Barkodo nuskaitymas
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Parengta skenavimui
              </span>
            </div>

            <form onSubmit={handleScanSubmit} className="space-y-3">
              <div>
                <input
                  type="text"
                  autoFocus
                  placeholder="Nuskenuokite QR arba įveskite pvz., TM-2023-0001"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  className="w-full text-center font-mono text-sm uppercase px-3 py-3 bg-slate-50 border-2 border-dashed border-blue-400 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600 shadow-2xs placeholder:text-slate-400"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!inputCode.trim()}
                  className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-xs cursor-pointer"
                >
                  Fiksuoti patikrą (Enter)
                </button>
              </div>
            </form>

            {/* Simulated QR Camera helper */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Camera className="w-3.5 h-3.5 text-slate-400" />
                USB brūkšninis skaitytuvas arba telefonas
              </span>
              <span className="text-slate-400">Automatinis 'Enter' palaikomas</span>
            </div>

            {/* Scan Feedback Banner */}
            {scanFeedback && (
              <div className={`p-4 rounded-lg border text-xs space-y-2.5 animate-fade-in ${
                scanFeedback.type === 'success' 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : scanFeedback.type === 'relocated'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : scanFeedback.type === 'already_scanned'
                  ? 'bg-blue-50 border-blue-300 text-blue-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}>
                <div className="font-bold flex items-center gap-2">
                  {scanFeedback.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  {scanFeedback.type === 'relocated' && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
                  {scanFeedback.type === 'not_found' && <HelpCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                  <span>{scanFeedback.message}</span>
                </div>

                {scanFeedback.type === 'relocated' && scanFeedback.item && activeRoom && (
                  <div className="pt-2 border-t border-amber-200 flex justify-end">
                    <button
                      onClick={() => handleConfirmRelocation(scanFeedback.item!)}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-md text-xs font-semibold cursor-pointer shadow-2xs"
                    >
                      Perkelti į šią patalpą ({formatRoomName(activeRoom)}) ir patvirtinti
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Room Inventory Checklist (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>{activeRoom ? formatRoomName(activeRoom) : 'Pasirinkite kabinetą'} patikros sąrašas</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Patikrinta: <strong className="text-emerald-700">{scannedInRoom.length}</strong> · Liko patikrinti: <strong className="text-slate-700">{missingInRoom.length}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                Viso: {expectedItems.length} vnt.
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto pr-1">
            {expectedItems.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-400 space-y-1">
                <MapPin className="w-8 h-8 text-slate-300 mx-auto" />
                <p>Šiame kabinete pagal registrą nėra priskirto turto.</p>
                <p className="text-[11px] text-slate-400">Nuskenavus čia rastą kito kabineto turtą, sistema pasiūlys jį perkelti.</p>
              </div>
            ) : (
              expectedItems.map((item) => {
                const isScanned = scannedSet.has(item.id);

                return (
                  <div
                    key={item.id}
                    className={`py-3 px-2.5 flex items-center justify-between gap-3 rounded-lg transition-colors ${
                      isScanned ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5 shrink-0">
                        {isScanned ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-2xs">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-slate-300"></div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-xs font-bold text-slate-900">
                            {item.inventoryNumber}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {item.category}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 truncate mt-0.5">
                          {item.name}
                        </p>
                        {item.serialNumber && (
                          <p className="text-[10px] font-mono text-slate-400">
                            SN: {item.serialNumber}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className={`text-xs font-bold ${isScanned ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {isScanned ? 'Patikrinta ✓' : 'Laukiama'}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {item.purchasePrice.toFixed(2)} €
                        </div>
                      </div>

                      {!isScanned && (
                        <button
                          onClick={() => handleQuickMark(item.id)}
                          title="Pažymėti kaip rastą rankiniu būdu (be skenerio)"
                          className="px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer transition-colors shadow-2xs"
                        >
                          Rasta
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Settings & Commission Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Inventorizacijos nustatymai ir komisija</h2>
                  <p className="text-[11px] text-slate-300">
                    Komisijos pirmininko parinkimas, nariai ir direktoriaus įsakymo rekvizitai
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveSettings} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Title & Year */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Inventorizacijos pavadinimas <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder="Pvz., 2026 m. gimnazijos materialiojo turto inventorizacija"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Metai
                  </label>
                  <input
                    type="number"
                    value={sessionYear}
                    onChange={(e) => setSessionYear(parseInt(e.target.value) || new Date().getFullYear())}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              {/* Commission Chairman Selection */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-700" />
                  <label className="block text-xs font-bold text-blue-950">
                    Inventorizacijos komisijos pirmininkas <span className="text-rose-500">*</span>
                  </label>
                </div>
                <p className="text-[11px] text-blue-800">
                  Pasirinkite pirmininką iš mokyklos darbuotojų sąrašo arba įveskite ranka:
                </p>

                <select
                  value={chairmanId}
                  onChange={(e) => {
                    setChairmanId(e.target.value);
                    const selected = users.find(u => u.id === e.target.value);
                    if (selected) {
                      setCustomChairmanName(`${selected.fullName} (${selected.roleTitle || 'Komisijos pirmininkas'})`);
                    }
                  }}
                  className="w-full bg-white border border-blue-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 cursor-pointer shadow-2xs"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} — {u.roleTitle || (u.role === 'admin' ? 'Ūkio vedėjas / IT' : 'Darbuotojas')}
                    </option>
                  ))}
                </select>

                <div className="pt-1">
                  <label className="block text-[11px] text-slate-600 mb-1">
                    Pilnas vardas ir pareigos dokumentuose:
                  </label>
                  <input
                    type="text"
                    value={customChairmanName}
                    onChange={(e) => setCustomChairmanName(e.target.value)}
                    className="w-full bg-white px-3 py-1.5 border border-slate-300 rounded-md text-xs font-medium"
                    placeholder="Vardas Pavardė (pareigos)"
                  />
                </div>
              </div>

              {/* Commission Members Management */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-600" />
                    <label className="block text-xs font-bold text-slate-800">
                      Komisijos nariai ({selectedMemberNames.length})
                    </label>
                  </div>
                  {selectedMemberNames.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedMemberNames([])}
                      className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                    >
                      Išvalyti visus narius
                    </button>
                  )}
                </div>

                {/* Display all currently selected members with remove (X) buttons */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-600 block">
                    Priskirti komisijos nariai (spauskite [×] norėdami pašalinti):
                  </span>
                  {selectedMemberNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg max-h-36 overflow-y-auto">
                      {selectedMemberNames.map((name, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-blue-300 rounded-md text-xs font-semibold text-slate-800 shadow-2xs"
                        >
                          <Users className="w-3 h-3 text-blue-600 shrink-0" />
                          <span className="truncate max-w-[220px]" title={name}>{name}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedMemberNames(prev => prev.filter((_, i) => i !== idx))}
                            className="hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded p-0.5 transition-colors cursor-pointer ml-0.5"
                            title="Pašalinti šį narį iš komisijos"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 text-center">
                      Nėra priskirtų narių. Pasirinkite iš sąrašo žemiau arba įrašykite ranka.
                    </div>
                  )}
                </div>

                {/* Quick cleanup helper if old demo members exist */}
                {selectedMemberNames.some(m => 
                  m.includes('Dalia') || 
                  m.includes('Saulius') || 
                  m.includes('Komisijos pirmininkas')
                ) && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
                    <span className="text-[11px] font-medium">Rasti seni demonstraciniai nariai arba pirmininko dublikatas</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMemberNames(prev => prev.filter(m => 
                          !m.includes('Dalia') && 
                          !m.includes('Saulius') && 
                          !m.includes('Komisijos pirmininkas')
                        ));
                      }}
                      className="px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold rounded text-[11px] cursor-pointer"
                    >
                      Pašalinti senus narius
                    </button>
                  </div>
                )}

                {/* Checkbox selector from active users */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-600 block">
                    Pasirinkti iš gimnazijos darbuotojų sąrašo:
                  </span>
                  <div className="border border-slate-300 rounded-lg p-2.5 max-h-36 overflow-y-auto bg-slate-50 space-y-1">
                    {users.map(u => {
                      const isSelected = selectedMemberNames.some(m => 
                        m.toLowerCase().includes(u.fullName.toLowerCase())
                      );
                      return (
                        <label
                          key={u.id}
                          className={`flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer ${
                            isSelected ? 'bg-blue-100/70 font-bold text-blue-950' : 'hover:bg-white text-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setSelectedMemberNames(prev => prev.filter(m => 
                                  !m.toLowerCase().includes(u.fullName.toLowerCase())
                                ));
                              } else {
                                const roleSuffix = u.roleTitle ? ` (${u.roleTitle})` : '';
                                setSelectedMemberNames(prev => [...prev, `${u.fullName}${roleSuffix}`]);
                              }
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="truncate">{u.fullName} ({u.roleTitle || 'Mokytojas'})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Add custom member input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberInput}
                    onChange={(e) => setNewMemberInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newMemberInput.trim() && !selectedMemberNames.includes(newMemberInput.trim())) {
                          setSelectedMemberNames(prev => [...prev, newMemberInput.trim()]);
                          setNewMemberInput('');
                        }
                      }
                    }}
                    placeholder="Įrašyti papildomą narį ranka..."
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newMemberInput.trim() && !selectedMemberNames.includes(newMemberInput.trim())) {
                        setSelectedMemberNames(prev => [...prev, newMemberInput.trim()]);
                        setNewMemberInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Pridėti
                  </button>
                </div>
              </div>

              {/* Order Number & Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Direktoriaus įsakymo Nr.
                  </label>
                  <input
                    type="text"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    placeholder="pvz., V-14 arba V-2026-03"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Įsakymo data
                  </label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pastabos / Inventorizacijos pagrindas
                </label>
                <textarea
                  rows={2}
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  placeholder="Pvz., Planinė metinė / pavasario inventorizacija pagal gimnazijos direktoriaus įsakymą"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                >
                  Išsaugoti nustatymus
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Print-Ready A4 Inventory Sheet Modal */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-2 sm:p-4 backdrop-blur-2xs overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden border border-slate-300">
            {/* Top Bar for Print / Close */}
            <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0 print:hidden">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold">Oficialus inventorizacijos apyrašas (A4)</span>
                {selectedDeptId !== 'all' && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white font-mono">
                    {departments.find(d => d.id === selectedDeptId)?.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Spausdinti / PDF
                </button>
                <button
                  onClick={() => setIsPrintModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Print Content Area */}
            <div className="p-8 sm:p-10 overflow-y-auto flex-1 font-serif text-slate-900 text-xs bg-white print:p-0">
              {/* Official Document Header */}
              <div className="text-center space-y-1 mb-6 border-b pb-4 border-slate-300">
                <p className="font-bold text-sm tracking-wide uppercase">
                  Telšių raj. Tryškių Lazdynų Pelėdos gimnazija
                </p>
                <p className="text-[11px] text-slate-600">
                  Įmonės kodas: 190558117 · Lazdynų Pelėdos g. 20, Tryškiai, Telšių r.
                </p>
                <h1 className="text-base font-bold uppercase mt-4 tracking-wider">
                  MATERIALIOJO TURTO INVENTORIZACIJOS APYRAŠAS
                </h1>
                <p className="text-xs font-sans mt-1">
                  Sudarytas: {new Date().toLocaleDateString('lt-LT')} pagal direktoriaus įsakymą Nr. {auditSession.orderNumber || 'V-14'} ({auditSession.orderDate || ''})
                </p>
                <p className="text-xs font-sans font-semibold text-slate-700">
                  Tikrintas padalinys / skyrius: {selectedDeptId === 'all' ? 'Visa gimnazija ir skyriai' : departments.find(d => d.id === selectedDeptId)?.name}
                </p>
              </div>

              {/* Commission info box */}
              <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded font-sans text-xs space-y-1">
                <div>
                  <strong>Komisijos pirmininkas:</strong> {activeChairmanDisplay}
                </div>
                <div>
                  <strong>Komisijos nariai:</strong> {auditSession.committeeMembers?.join(', ') || 'Sigita Navickienė'}
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full border-collapse border border-slate-300 text-[11px] font-sans">
                <thead>
                  <tr className="bg-slate-100 text-slate-800">
                    <th className="border border-slate-300 p-1.5 text-center w-8">Nr.</th>
                    <th className="border border-slate-300 p-1.5 text-left w-24">Inv. Nr.</th>
                    <th className="border border-slate-300 p-1.5 text-left">Turto pavadinimas</th>
                    <th className="border border-slate-300 p-1.5 text-left w-28">Patalpa / Skyrius</th>
                    <th className="border border-slate-300 p-1.5 text-right w-16">Vertė, €</th>
                    <th className="border border-slate-300 p-1.5 text-center w-20">Rezultatas</th>
                    <th className="border border-slate-300 p-1.5 text-left w-24">Pastabos</th>
                  </tr>
                </thead>
                <tbody>
                  {deptItems.map((item, idx) => {
                    const isFound = scannedSet.has(item.id);
                    const iRoom = rooms.find(r => r.id === item.roomId);
                    const iDept = departments.find(d => d.id === item.departmentId);

                    return (
                      <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="border border-slate-300 p-1.5 text-center font-mono">{idx + 1}</td>
                        <td className="border border-slate-300 p-1.5 font-mono font-semibold">{item.inventoryNumber}</td>
                        <td className="border border-slate-300 p-1.5">
                          <span className="font-medium">{item.name}</span>
                          {item.serialNumber && <span className="text-[10px] text-slate-500 block font-mono">SN: {item.serialNumber}</span>}
                        </td>
                        <td className="border border-slate-300 p-1.5 text-slate-700">
                          {formatRoomName(iRoom)} {iDept ? `(${iDept.code})` : ''}
                        </td>
                        <td className="border border-slate-300 p-1.5 text-right font-mono tabular-nums">
                          {item.purchasePrice.toFixed(2)}
                        </td>
                        <td className="border border-slate-300 p-1.5 text-center font-semibold">
                          {isFound ? (
                            <span className="text-emerald-700">Rasta</span>
                          ) : (
                            <span className="text-rose-700">Trūksta</span>
                          )}
                        </td>
                        <td className="border border-slate-300 p-1.5 text-[10px] text-slate-500">
                          {item.notes || ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Summary Stats */}
              <div className="mt-4 font-sans text-xs flex justify-between border-t pt-2 border-slate-300">
                <span>Viso patikrinta objektų: <strong>{deptItems.length} vnt.</strong></span>
                <span>Faktiškai rasta: <strong className="text-emerald-800">{deptScannedCount} vnt.</strong></span>
                <span>Trūkstama / nerasta: <strong className="text-rose-800">{deptItems.length - deptScannedCount} vnt.</strong></span>
              </div>

              {/* Signatures */}
              <div className="mt-10 pt-6 border-t border-slate-300 space-y-6 font-sans">
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-slate-600 block text-[11px]">Komisijos pirmininkas:</span>
                    <strong className="text-xs">{activeChairmanDisplay}</strong>
                  </div>
                  <div className="w-48 border-b border-slate-800 text-center text-[10px] text-slate-400 pb-0.5">
                    (parašas)
                  </div>
                </div>

                {auditSession.committeeMembers?.map((member, i) => (
                  <div key={i} className="flex justify-between items-end">
                    <div>
                      <span className="text-slate-600 block text-[11px]">Komisijos narys:</span>
                      <strong className="text-xs">{member}</strong>
                    </div>
                    <div className="w-48 border-b border-slate-800 text-center text-[10px] text-slate-400 pb-0.5">
                      (parašas)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
