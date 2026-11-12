import React, { useState, useMemo } from 'react';
import { 
  Boxes, 
  Search, 
  Filter, 
  Building2, 
  DoorClosed, 
  AlertTriangle, 
  CheckCircle2, 
  Eye, 
  Wrench, 
  Laptop, 
  Monitor, 
  Server, 
  Tablet, 
  Camera, 
  Tag, 
  Info, 
  Check, 
  Clock 
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  DefectReport, 
  formatRoomName, 
  getUserAssignedRoomIds 
} from '../types/inventory';
import { ReportFaultModal } from './ReportFaultModal';

interface MyInventoryViewProps {
  currentUser: User;
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  onViewItemDetail: (item: InventoryItem) => void;
  onSaveFaultReport: (item: InventoryItem, defectReport: DefectReport) => void;
}

export const MyInventoryView: React.FC<MyInventoryViewProps> = ({
  currentUser,
  items,
  departments,
  rooms,
  onViewItemDetail,
  onSaveFaultReport,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  
  // Defect Modal State
  const [faultItem, setFaultItem] = useState<InventoryItem | null>(null);

  // Determine all room IDs assigned to this user
  const userRoomIds = useMemo(() => {
    return getUserAssignedRoomIds(currentUser);
  }, [currentUser]);

  // Find all rooms this user manages or is responsible for
  const userRooms = useMemo(() => {
    return rooms.filter(r => 
      userRoomIds.includes(r.id) || 
      r.defaultResponsiblePersonId === currentUser.id
    );
  }, [rooms, userRoomIds, currentUser.id]);

  // All items assigned to the user directly OR located in their managed rooms
  const myAllItems = useMemo(() => {
    return items.filter(item => {
      // 1. Personally responsible
      if (item.responsibleUserId === currentUser.id) return true;
      // 2. Located in one of user's managed rooms
      if (item.roomId && userRoomIds.includes(item.roomId)) return true;
      // 3. Or room's default responsible person is current user
      const itemRoom = rooms.find(r => r.id === item.roomId);
      if (itemRoom?.defaultResponsiblePersonId === currentUser.id) return true;
      return false;
    });
  }, [items, currentUser.id, userRoomIds, rooms]);

  // Filtered items based on user selection
  const filteredItems = useMemo(() => {
    return myAllItems.filter(item => {
      // Room filter
      if (selectedRoomFilter !== 'all' && item.roomId !== selectedRoomFilter) {
        return false;
      }
      // Category filter
      if (selectedCategoryFilter !== 'all' && item.category !== selectedCategoryFilter) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = item.name.toLowerCase().includes(q);
        const invMatch = item.inventoryNumber.toLowerCase().includes(q);
        const snMatch = item.serialNumber?.toLowerCase().includes(q);
        const notesMatch = item.notes?.toLowerCase().includes(q);
        if (!nameMatch && !invMatch && !snMatch && !notesMatch) return false;
      }
      return true;
    });
  }, [myAllItems, selectedRoomFilter, selectedCategoryFilter, searchQuery]);

  // Categories available in user's inventory
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    myAllItems.forEach(i => set.add(i.category));
    return Array.from(set);
  }, [myAllItems]);

  // Statistics
  const totalValue = useMemo(() => {
    return myAllItems.reduce((acc, i) => acc + (Number(i.purchasePrice) || 0), 0);
  }, [myAllItems]);

  const inRepairCount = useMemo(() => {
    return myAllItems.filter(i => i.status === 'in_repair' || (i.defectReports && i.defectReports.length > 0)).length;
  }, [myAllItems]);

  const activeCount = useMemo(() => {
    return myAllItems.filter(i => i.status === 'active').length;
  }, [myAllItems]);

  const faultItemRoom = rooms.find(r => r.id === faultItem?.roomId);
  const faultItemDept = departments.find(d => d.id === faultItem?.departmentId);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Teacher / Staff Welcome Banner */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="text-base font-bold text-slate-900">
                Sveiki, {currentUser.fullName}
              </h2>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {currentUser.roleTitle || 'Mokytojas / Darbuotojas'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Čia matomas Jūsų materialinei atsakomybei ir valdomoms patalpoms priskirtas gimnazijos turtas.
            </p>
          </div>

          {/* User's assigned rooms badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <DoorClosed className="w-3.5 h-3.5 text-slate-400" />
              Mano kabinetai ({userRooms.length}):
            </span>
            {userRooms.length === 0 ? (
              <span className="text-xs text-slate-400 italic">Kabinetai nepriskirti (Bendra atsakomybė)</span>
            ) : (
              userRooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRoomFilter(prev => prev === r.id ? 'all' : r.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    selectedRoomFilter === r.id
                      ? 'bg-blue-600 text-white border-blue-700 font-bold shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                  title="Filtruoti pagal šį kabinetą"
                >
                  {formatRoomName(r)}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-200">
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Priskirtas turtas
            </span>
            <div className="text-xl font-bold text-slate-900 mt-1">
              {myAllItems.length} <span className="text-xs font-normal text-slate-500">vnt.</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              Bendra vertė: {totalValue.toLocaleString('lt-LT', { minimumFractionDigits: 2 })} €
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Valdomos patalpos
            </span>
            <div className="text-xl font-bold text-slate-900 mt-1">
              {userRooms.length} <span className="text-xs font-normal text-slate-500">kabinetai(-ų)</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              {userRooms.length > 0 ? userRooms.map(r => r.name).slice(0, 2).join(', ') + (userRooms.length > 2 ? '...' : '') : 'Nepriskirta'}
            </div>
          </div>

          <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">
              Tvarkingas / Veikiantis
            </span>
            <div className="text-xl font-bold text-emerald-900 mt-1">
              {activeCount} <span className="text-xs font-normal text-emerald-600">vnt.</span>
            </div>
            <div className="text-[11px] text-emerald-700 mt-0.5">
              Paruošta ugdymo procesui
            </div>
          </div>

          <div className={`rounded-lg p-3 border transition-colors ${
            inRepairCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'
          }`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wider block ${
              inRepairCount > 0 ? 'text-amber-800' : 'text-slate-500'
            }`}>
              Gedimai / Remontas
            </span>
            <div className={`text-xl font-bold mt-1 ${
              inRepairCount > 0 ? 'text-amber-900' : 'text-slate-900'
            }`}>
              {inRepairCount} <span className="text-xs font-normal text-slate-500">vnt.</span>
            </div>
            <div className={`text-[11px] mt-0.5 ${
              inRepairCount > 0 ? 'text-amber-800 font-semibold' : 'text-slate-500'
            }`}>
              {inRepairCount > 0 ? 'Reikalingas IT / ūkvedžio dėmesys' : 'Gedimų neužfiksuota'}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ieškoti pagal pavadinimą, inventoriaus Nr. ar seriją..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Room Filter Dropdown */}
            <select
              value={selectedRoomFilter}
              onChange={(e) => setSelectedRoomFilter(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 cursor-pointer shadow-2xs"
            >
              <option value="all">Visi kabinetai ({myAllItems.length})</option>
              {userRooms.map(r => (
                <option key={r.id} value={r.id}>{formatRoomName(r)}</option>
              ))}
            </select>

            {/* Category Filter */}
            {availableCategories.length > 1 && (
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 cursor-pointer shadow-2xs"
              >
                <option value="all">Visos kategorijos</option>
                {availableCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}

            {(searchQuery || selectedRoomFilter !== 'all' || selectedCategoryFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedRoomFilter('all');
                  setSelectedCategoryFilter('all');
                }}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 cursor-pointer"
              >
                Išvalyti filtrus
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Priskirtas turtas ({filteredItems.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Pastebėję gedimą ar defektą, paspauskite mygtuką „Pranešti apie gedimą“
          </span>
        </div>

        {filteredItems.length === 0 ? (
          <div className="bg-white border border-slate-300 rounded-xl p-12 text-center space-y-3 shadow-xs">
            <Boxes className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">Turto įrašų nerasta</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {myAllItems.length === 0 
                ? 'Jums šiuo metu nėra priskirto materialiojo turto arba nesate priskirtas prie konkrečių kabinetų.' 
                : 'Pagal nurodytus paieškos ar filtrų kriterijus daiktų nerasta.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map(item => {
              const room = rooms.find(r => r.id === item.roomId);
              const dept = departments.find(d => d.id === item.departmentId);
              const hasDefect = item.status === 'in_repair' || (item.defectReports && item.defectReports.length > 0);
              const latestDefect = item.defectReports?.[item.defectReports.length - 1];

              return (
                <div 
                  key={item.id}
                  className={`bg-white border rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between ${
                    hasDefect 
                      ? 'border-amber-300 ring-1 ring-amber-400/40 bg-amber-50/20' 
                      : 'border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <div className="p-4 space-y-3">
                    {/* Top Row: Inventory number & Status badge */}
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        {item.inventoryNumber}
                      </span>
                      <div className="flex items-center gap-1">
                        {hasDefect ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            <span>Remontuojamas</span>
                          </span>
                        ) : item.status === 'to_writeoff' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <span>Nurašomas</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Veikiantis</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Item Name & Photo */}
                    <div className="flex items-start gap-3">
                      {item.photoUrl ? (
                        <img 
                          src={item.photoUrl} 
                          alt={item.name} 
                          className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-50"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400">
                          {item.category === 'Kompiuteriai' ? <Laptop className="w-6 h-6" /> : <Boxes className="w-6 h-6" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug">
                          {item.name}
                        </h4>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          Kategorija: <span className="font-medium text-slate-700">{item.category}</span>
                        </div>
                        {item.serialNumber && (
                          <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                            SN: {item.serialNumber}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Location Box */}
                    <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-[11px] space-y-0.5">
                      <div className="flex items-center gap-1 font-semibold text-slate-800">
                        <DoorClosed className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{formatRoomName(room, true)}</span>
                      </div>
                      {dept && (
                        <div className="text-[10px] text-slate-500 truncate pl-4.5">
                          {dept.name}
                        </div>
                      )}
                    </div>

                    {/* Technical Specs badge if computer */}
                    {item.specs && (item.specs.cpu || item.specs.ramGb || item.specs.os) && (
                      <div className="text-[10px] font-mono bg-blue-50/60 p-2 rounded border border-blue-200/80 text-blue-900 space-y-0.5">
                        {item.specs.cpu && <div>CPU: {item.specs.cpu}</div>}
                        {item.specs.ramGb && <div>RAM: {item.specs.ramGb} GB {item.specs.storage ? `· ${item.specs.storage}` : ''}</div>}
                        {item.specs.os && <div>OS: {item.specs.os}</div>}
                      </div>
                    )}

                    {/* Defect Alert Notice if reported */}
                    {hasDefect && latestDefect && (
                      <div className="p-2 bg-amber-100/70 border border-amber-300 rounded-lg text-[11px] text-amber-900 space-y-1">
                        <div className="font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                          <span>Užregistruotas gedimas</span>
                        </div>
                        <p className="line-clamp-2 italic text-amber-950">
                          {latestDefect.description}
                        </p>
                        <div className="text-[10px] text-amber-800 flex items-center justify-between pt-0.5">
                          <span>Pranešė: {latestDefect.reportedByUserName}</span>
                          <span>{new Date(latestDefect.reportedAt).toLocaleDateString('lt-LT')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Bottom Action Buttons */}
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onViewItemDetail(item)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-blue-700 py-1.5 px-2.5 rounded hover:bg-slate-200/70 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                      <span>Kortelė</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFaultItem(item)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 py-1.5 px-3 rounded-md transition-colors cursor-pointer shadow-2xs"
                    >
                      <Wrench className="w-3.5 h-3.5 text-amber-700" />
                      <span>Pranešti apie gedimą</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Defect Reporting Modal */}
      {faultItem && (
        <ReportFaultModal
          isOpen={!!faultItem}
          onClose={() => setFaultItem(null)}
          item={faultItem}
          room={faultItemRoom}
          dept={faultItemDept}
          currentUserName={currentUser.fullName}
          currentUserId={currentUser.id}
          onSubmitFault={onSaveFaultReport}
        />
      )}
    </div>
  );
};
