import React, { useState } from 'react';
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
  Printer
} from 'lucide-react';
import { InventoryItem, Department, Room, AuditSession, User } from '../types/inventory';

interface AuditViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  auditSession: AuditSession;
  currentUser: User;
  onUpdateAuditSession: (session: AuditSession) => void;
  onRelocateItem: (itemId: string, newRoomId: string) => void;
}

export const AuditView: React.FC<AuditViewProps> = ({
  items,
  departments,
  rooms,
  auditSession,
  currentUser,
  onUpdateAuditSession,
  onRelocateItem,
}) => {
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id || '');
  const [inputCode, setInputCode] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'relocated' | 'not_found' | 'already_scanned';
    message: string;
    item?: InventoryItem;
  } | null>(null);

  const activeRoom = rooms.find(r => r.id === selectedRoomId);
  const activeDept = departments.find(d => d.id === activeRoom?.departmentId);

  // Items expected in this room
  const expectedItems = items.filter(i => i.roomId === selectedRoomId);
  
  // Audited state in this session
  const scannedSet = new Set(auditSession.scannedItemIds);
  const scannedInRoom = expectedItems.filter(i => scannedSet.has(i.id));
  const missingInRoom = expectedItems.filter(i => !scannedSet.has(i.id));

  const progressPercent = expectedItems.length > 0 
    ? Math.round((scannedInRoom.length / expectedItems.length) * 100) 
    : 100;

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        message: `Turtas [${found.inventoryNumber}] "${found.name}" jau buvo nuskenuotas anksčiau!`,
        item: found,
      });
      setInputCode('');
      return;
    }

    // Check if found in the expected room
    if (found.roomId === selectedRoomId) {
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
      setScanFeedback({
        type: 'relocated',
        message: `DĖMESIO: Turtas [${found.inventoryNumber}] pagal registrą priklauso ${oldRoom?.number || ''} kab., bet rastas čia!`,
        item: found,
      });
    }

    setInputCode('');
  };

  const handleConfirmRelocation = (item: InventoryItem) => {
    onRelocateItem(item.id, selectedRoomId);
    const updatedScanned = [...auditSession.scannedItemIds, item.id];
    onUpdateAuditSession({
      ...auditSession,
      scannedItemIds: updatedScanned,
    });
    setScanFeedback({
      type: 'success',
      message: `Turto vieta atnaujinta į ${activeRoom?.number} kab. ir patvirtinta inventorizacijoje!`,
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

  return (
    <div className="space-y-6">
      {/* Session Title Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="text-base font-semibold text-slate-900">
                {auditSession.title}
              </h2>
            </div>
            <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
              <span>Pradėta: <strong className="font-mono text-slate-700">{auditSession.startDate}</strong></span>
              <span>·</span>
              <span>Komisijos pirmininkas: {auditSession.committeeMembers[0]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-500">Bendra mokyklos pažanga</div>
              <div className="text-sm font-bold font-mono text-slate-900">
                {auditSession.scannedItemIds.length} / {items.length} vnt. (
                {Math.round((auditSession.scannedItemIds.length / items.length) * 100)}%)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Audit Workspace: Scanner + Room Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Room selection & Live Scanner (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Room Selector Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
              1. Pasirinkite tikrinamą kabinetą
            </label>
            <select
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setScanFeedback(null);
              }}
              className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              {rooms.map(r => {
                const dept = departments.find(d => d.id === r.departmentId);
                const count = items.filter(i => i.roomId === r.id).length;
                return (
                  <option key={r.id} value={r.id}>
                    {r.number} kab. {r.name} ({dept?.code}) — {count} vnt.
                  </option>
                );
              })}
            </select>

            {activeRoom && (
              <div className="p-3 bg-slate-50 rounded-md border border-slate-100 text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Skyrius:</span>
                  <span className="font-medium text-slate-900">{activeDept?.name}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Patalpos būklė:</span>
                  <span className="font-mono tabular-nums text-slate-900 font-medium">
                    {scannedInRoom.length} iš {expectedItems.length} patikrinta ({progressPercent}%)
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Scanner Input Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Scan className="w-4 h-4 text-blue-600" />
                2. QR / Barkodo nuskaitymas
              </span>
              <span className="text-[11px] text-slate-400 font-mono">Parengta skenavimui</span>
            </div>

            <form onSubmit={handleScanSubmit} className="space-y-3">
              <div>
                <input
                  type="text"
                  autoFocus
                  placeholder="Nuskenuokite QR arba įveskite pvz., TM-2023-0001"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  className="w-full text-center font-mono text-sm uppercase px-3 py-2.5 bg-slate-50 border-2 border-dashed border-blue-400 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-xs cursor-pointer"
                >
                  Fiksuoti patikrą
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
              <div className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                scanFeedback.type === 'success' 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : scanFeedback.type === 'relocated'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : scanFeedback.type === 'already_scanned'
                  ? 'bg-blue-50 border-blue-300 text-blue-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}>
                <div className="font-semibold flex items-center gap-1.5">
                  {scanFeedback.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  {scanFeedback.type === 'relocated' && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                  {scanFeedback.type === 'not_found' && <HelpCircle className="w-4 h-4 text-rose-600" />}
                  <span>{scanFeedback.message}</span>
                </div>

                {scanFeedback.type === 'relocated' && scanFeedback.item && (
                  <div className="pt-2 border-t border-amber-200 flex justify-end">
                    <button
                      onClick={() => handleConfirmRelocation(scanFeedback.item!)}
                      className="px-3 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded font-medium cursor-pointer"
                    >
                      Perkelti į šį ({activeRoom?.number}) kabinetą ir patvirtinti
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Room Inventory Checklist (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {activeRoom?.number} kab. inventorizacijos sąrašas
              </h3>
              <p className="text-xs text-slate-500">
                Patikrinta: {scannedInRoom.length} · Liko patikrinti: {missingInRoom.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                Viso: {expectedItems.length} vnt.
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto pr-1">
            {expectedItems.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                Šiame kabinete pagal registrą nėra priskirto turto.
              </div>
            ) : (
              expectedItems.map((item) => {
                const isScanned = scannedSet.has(item.id);

                return (
                  <div
                    key={item.id}
                    className={`py-3 px-2 flex items-center justify-between gap-3 rounded-md transition-colors ${
                      isScanned ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5">
                        {isScanned ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-slate-300"></div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-xs font-semibold text-slate-900">
                            {item.inventoryNumber}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {item.category}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-800 truncate mt-0.5">
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
                        <div className={`text-xs font-semibold ${isScanned ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {isScanned ? 'Patikrinta' : 'Laukiama'}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {item.purchasePrice.toFixed(2)} €
                        </div>
                      </div>

                      {!isScanned && (
                        <button
                          onClick={() => handleQuickMark(item.id)}
                          title="Pažymėti kaip rastą rankiniu būdu"
                          className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer transition-colors"
                        >
                          Pažymėti
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
    </div>
  );
};
