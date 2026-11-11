import React, { useState } from 'react';
import { 
  Building2, 
  DoorClosed, 
  Plus, 
  User as UserIcon, 
  Boxes, 
  ChevronRight,
  FolderTree,
  MapPin,
  Edit3,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { Department, Room, InventoryItem, User, formatRoomName } from '../types/inventory';

interface DepartmentsRoomsViewProps {
  departments: Department[];
  rooms: Room[];
  items: InventoryItem[];
  users: User[];
  currentUser: User;
  onSaveDepartment: (dept: Department) => void;
  onDeleteDepartment: (deptId: string) => void;
  onSaveRoom: (room: Room) => void;
  onDeleteRoom: (roomId: string) => void;
  onViewItemDetail: (item: InventoryItem) => void;
}

export const DepartmentsRoomsView: React.FC<DepartmentsRoomsViewProps> = ({
  departments,
  rooms,
  items,
  users,
  currentUser,
  onSaveDepartment,
  onDeleteDepartment,
  onSaveRoom,
  onDeleteRoom,
  onViewItemDetail,
}) => {
  const [selectedDeptId, setSelectedDeptId] = useState<string>(departments[0]?.id || '');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  // Modals state
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({ 
    name: '', 
    code: '', 
    building: '', 
    description: '',
    managerId: '' 
  });

  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomForm, setRoomForm] = useState({ 
    departmentId: '',
    number: '', 
    name: '', 
    floor: 1, 
    defaultResponsiblePersonId: '' 
  });

  const activeDept = departments.find(d => d.id === selectedDeptId);
  const deptRooms = rooms.filter(r => r.departmentId === selectedDeptId);

  // Active room items
  const activeRoom = rooms.find(r => r.id === selectedRoomId);
  const roomItems = selectedRoomId ? items.filter(i => i.roomId === selectedRoomId) : [];

  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  // --- Department Handlers ---
  const handleOpenCreateDept = () => {
    setEditingDept(null);
    setDeptForm({
      name: '',
      code: '',
      building: '',
      description: '',
      managerId: users[0]?.id || '',
    });
    setIsDeptModalOpen(true);
  };

  const handleOpenEditDept = (dept: Department, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingDept(dept);
    setDeptForm({
      name: dept.name,
      code: dept.code,
      building: dept.building || '',
      description: dept.description || '',
      managerId: dept.managerId || '',
    });
    setIsDeptModalOpen(true);
  };

  const [deptToDelete, setDeptToDelete] = useState<Department | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);

  const handleDeleteDeptConfirm = (dept: Department, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeptToDelete(dept);
  };

  const executeDeleteDept = () => {
    if (!deptToDelete) return;
    onDeleteDepartment(deptToDelete.id);
    if (selectedDeptId === deptToDelete.id) {
      const remaining = departments.filter(d => d.id !== deptToDelete.id);
      setSelectedDeptId(remaining[0]?.id || '');
      setSelectedRoomId('');
    }
    setDeptToDelete(null);
  };

  const handleSaveDeptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name || !deptForm.code) return;

    if (editingDept) {
      const updatedDept: Department = {
        ...editingDept,
        name: deptForm.name.trim(),
        code: deptForm.code.trim().toUpperCase(),
        building: deptForm.building.trim() || 'Mokyklos pastatas',
        description: deptForm.description.trim(),
        managerId: deptForm.managerId || editingDept.managerId,
      };
      onSaveDepartment(updatedDept);
      setIsDeptModalOpen(false);
    } else {
      const newDept: Department = {
        id: `dept-${Date.now()}`,
        name: deptForm.name.trim(),
        code: deptForm.code.trim().toUpperCase(),
        building: deptForm.building.trim() || 'Mokyklos pastatas',
        description: deptForm.description.trim(),
        managerId: deptForm.managerId || users[0]?.id,
      };
      onSaveDepartment(newDept);
      setSelectedDeptId(newDept.id);
      setIsDeptModalOpen(false);
    }
  };

  // --- Room Handlers ---
  const handleOpenCreateRoom = () => {
    setEditingRoom(null);
    setRoomForm({
      departmentId: selectedDeptId || departments[0]?.id || '',
      number: '',
      name: '',
      floor: 1,
      defaultResponsiblePersonId: users[0]?.id || '',
    });
    setIsRoomModalOpen(true);
  };

  const handleOpenEditRoom = (room: Room, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingRoom(room);
    setRoomForm({
      departmentId: room.departmentId,
      number: room.number || '',
      name: room.name,
      floor: room.floor,
      defaultResponsiblePersonId: room.defaultResponsiblePersonId || '',
    });
    setIsRoomModalOpen(true);
  };

  const handleDeleteRoomConfirm = (room: Room, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRoomToDelete(room);
  };

  const executeDeleteRoom = () => {
    if (!roomToDelete) return;
    onDeleteRoom(roomToDelete.id);
    if (selectedRoomId === roomToDelete.id) {
      setSelectedRoomId('');
    }
    setRoomToDelete(null);
  };

  const handleSaveRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomForm.name.trim()) return;

    if (editingRoom) {
      const updatedRoom: Room = {
        ...editingRoom,
        departmentId: roomForm.departmentId || editingRoom.departmentId,
        number: roomForm.number.trim() || undefined,
        name: roomForm.name.trim(),
        floor: Number(roomForm.floor),
        defaultResponsiblePersonId: roomForm.defaultResponsiblePersonId || editingRoom.defaultResponsiblePersonId,
      };
      onSaveRoom(updatedRoom);
      setIsRoomModalOpen(false);
    } else {
      const targetDeptId = roomForm.departmentId || selectedDeptId || departments[0]?.id;
      const newRoom: Room = {
        id: `room-${Date.now()}`,
        departmentId: targetDeptId,
        number: roomForm.number.trim() || undefined,
        name: roomForm.name.trim(),
        floor: Number(roomForm.floor),
        defaultResponsiblePersonId: roomForm.defaultResponsiblePersonId || users[0]?.id,
      };
      onSaveRoom(newRoom);
      setSelectedDeptId(targetDeptId);
      setSelectedRoomId(newRoom.id);
      setIsRoomModalOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Struktūriniai padaliniai ir patalpos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Mokyklos skyriai, korpusai, kabinetai ir materialiojo turto paskirstymas patalpose
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleOpenCreateDept}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4 text-blue-600" />
              <span>+ Naujas skyrius</span>
            </button>
            <button
              onClick={handleOpenCreateRoom}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>+ Naujas kabinetas</span>
            </button>
          </div>
        )}
      </div>

      {/* 3-Column Explorer Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Col 1: Departments List (4 cols) */}
        <div className="md:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              Skyriai ({departments.length})
            </span>
          </div>

          <div className="space-y-2">
            {departments.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-400">
                Nėra sukurtų skyrių
              </div>
            ) : (
              departments.map((dept) => {
                const countRooms = rooms.filter(r => r.departmentId === dept.id).length;
                const countItems = items.filter(i => i.departmentId === dept.id).length;
                const isSelected = selectedDeptId === dept.id;

                return (
                  <div
                    key={dept.id}
                    onClick={() => {
                      setSelectedDeptId(dept.id);
                      setSelectedRoomId(''); // reset room
                    }}
                    className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-50/90 border-2 border-blue-600 shadow-sm ring-2 ring-blue-500/20'
                        : 'bg-white border border-slate-300 hover:border-slate-400 hover:shadow-sm shadow-xs'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-600' : 'text-slate-600'}`} />
                        <span className="text-xs font-bold text-slate-900 truncate">{dept.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          [{dept.code}]
                        </span>
                        {canManage && (
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              onClick={(e) => handleOpenEditDept(dept, e)}
                              title="Redaguoti skyrių"
                              className="p-1.5 text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded-md transition-colors cursor-pointer shadow-2xs"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteDeptConfirm(dept, e)}
                              title="Ištrinti skyrių"
                              className="p-1.5 text-slate-700 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 border border-slate-200 rounded-md transition-colors cursor-pointer shadow-2xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-600 font-medium mt-1.5 line-clamp-1">{dept.building}</p>

                    <div className="mt-3 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-600">
                      <span className="font-medium">{countRooms} kabinetai</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">{countItems} turto vnt.</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Col 2: Rooms in selected Department (4 cols) */}
        <div className="md:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider truncate">
              {activeDept ? `${activeDept.code} kabinetai (${deptRooms.length})` : `Kabinetai (${rooms.length})`}
            </span>
          </div>

          <div className="space-y-2">
            {deptRooms.length === 0 ? (
              <div className="bg-white border border-slate-300 rounded-xl p-6 text-center text-xs text-slate-500 space-y-2 shadow-xs">
                <DoorClosed className="w-8 h-8 text-slate-400 mx-auto" />
                <p>Šiame skyriuje dar nėra sukurtų kabinetų</p>
                {canManage && (
                  <button
                    onClick={handleOpenCreateRoom}
                    className="mt-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg cursor-pointer shadow-2xs"
                  >
                    + Sukurti pirmą kabinetą
                  </button>
                )}
              </div>
            ) : (
              deptRooms.map((room) => {
                const countItems = items.filter(i => i.roomId === room.id).length;
                const defaultUser = users.find(u => u.id === room.defaultResponsiblePersonId);
                const isSelected = selectedRoomId === room.id;

                return (
                  <div
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    className={`group relative p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-600 text-white border-2 border-blue-700 shadow-md ring-2 ring-blue-500/30'
                        : 'bg-white border border-slate-300 hover:border-slate-400 hover:shadow-sm shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <DoorClosed className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-100' : 'text-slate-600'}`} />
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                          {room.number?.trim() ? `${room.number} kab.` : room.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[11px] font-mono tabular-nums font-semibold ${isSelected ? 'text-blue-100' : 'text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200'}`}>
                          {countItems} vnt.
                        </span>
                        {canManage && (
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              onClick={(e) => handleOpenEditRoom(room, e)}
                              title="Redaguoti kabinetą"
                              className={`p-1.5 rounded-md transition-colors cursor-pointer shadow-2xs ${
                                isSelected 
                                  ? 'text-white bg-blue-700 hover:bg-blue-800 border border-blue-500' 
                                  : 'text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 border border-slate-200'
                              }`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteRoomConfirm(room, e)}
                              title="Ištrinti kabinetą"
                              className={`p-1.5 rounded-md transition-colors cursor-pointer shadow-2xs ${
                                isSelected 
                                  ? 'text-white bg-blue-700 hover:bg-rose-600 border border-blue-500' 
                                  : 'text-slate-700 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 border border-slate-200'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {room.number?.trim() && (
                      <div className={`text-xs mt-1 truncate font-medium ${isSelected ? 'text-blue-50' : 'text-slate-700'}`}>
                        {room.name}
                      </div>
                    )}

                    <div className={`mt-2.5 pt-2 flex items-center justify-between text-[11px] border-t ${
                      isSelected ? 'border-blue-500/60 text-blue-100' : 'border-slate-200 text-slate-500'
                    }`}>
                      <span>Aukštas: {room.floor}</span>
                      <span className="truncate max-w-32 font-medium">{defaultUser?.fullName || 'Nėra atsakingo'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Col 3: Items in selected Room (4 cols) */}
        <div className="md:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider truncate">
              {activeRoom ? `${formatRoomName(activeRoom, true)} inventorius (${roomItems.length})` : 'Patalpos inventorius'}
            </span>
          </div>

          <div className="bg-white border border-slate-300 rounded-xl p-4 min-h-[300px] shadow-xs">
            {!activeRoom ? (
              <div className="py-16 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
                <Boxes className="w-8 h-8 text-slate-400" />
                <p className="font-medium">Pasirinkite kabinetą iš sąrašo kairėje</p>
              </div>
            ) : roomItems.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">Šiame kabinete nėra priskirto turto</p>
                <p className="text-[11px] text-slate-500">Galite priskirti turtą redaguodami daiktą arba atlikdami perkėlimą</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[600px] overflow-y-auto pr-1">
                {roomItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onViewItemDetail(item)}
                    className="py-2.5 px-2.5 hover:bg-blue-50/70 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono tabular-nums text-xs font-semibold text-blue-600">
                        {item.inventoryNumber}
                      </span>
                      <span className="text-xs font-mono tabular-nums font-semibold text-slate-800">
                        {item.purchasePrice.toFixed(2)} €
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800 truncate mt-0.5">
                      {item.name}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                      <span>{item.category}</span>
                      <span className={`font-medium ${
                        item.status === 'active' ? 'text-emerald-600' :
                        item.status === 'to_writeoff' ? 'text-rose-600' : 'text-slate-500'
                      }`}>
                        {item.status === 'active' ? 'Aktyvus' : item.status === 'to_writeoff' ? 'Nurašomas' : item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: New / Edit Department */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingDept ? 'Redaguoti mokyklos skyrių' : 'Registruoti naują mokyklos skyrių'}
              </h3>
              <button 
                type="button" 
                onClick={() => setIsDeptModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDeptSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Skyriaus pavadinimas *</label>
                <input
                  type="text"
                  required
                  placeholder="pvz., Gamtos mokslų skyrius"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Kodas / Santrumpa *</label>
                  <input
                    type="text"
                    required
                    placeholder="pvz., GM"
                    value={deptForm.code}
                    onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Pastatas / Korpusas</label>
                  <input
                    type="text"
                    placeholder="pvz., B korpusas, 2 aukštas"
                    value={deptForm.building}
                    onChange={(e) => setDeptForm({ ...deptForm, building: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Skyriaus vedėjas / Vadovas</label>
                <select
                  value={deptForm.managerId}
                  onChange={(e) => setDeptForm({ ...deptForm, managerId: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Pasirinkti vadovą</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.roleTitle})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Aprašymas</label>
                <textarea
                  rows={2}
                  placeholder="Skyriaus paskirtis, veiklos sritis..."
                  value={deptForm.description}
                  onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs cursor-pointer"
                >
                  {editingDept ? 'Išsaugoti pakeitimus' : 'Sukurti skyrių'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New / Edit Room */}
      {isRoomModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingRoom ? 'Redaguoti kabinetą / patalpą' : 'Pridėti naują kabinetą / patalpą'}
              </h3>
              <button 
                type="button" 
                onClick={() => setIsRoomModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoomSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Struktūrinis skyrius *</label>
                <select
                  required
                  value={roomForm.departmentId}
                  onChange={(e) => setRoomForm({ ...roomForm, departmentId: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name} [{d.code}]</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Kabineto Nr. <span className="text-slate-400 font-normal text-[11px]">(neprivaloma)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="pvz., 1, 104 ar palikti tuščią"
                    value={roomForm.number}
                    onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Aukštas</label>
                  <input
                    type="number"
                    min={-1}
                    max={10}
                    value={roomForm.floor}
                    onChange={(e) => setRoomForm({ ...roomForm, floor: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Patalpos pavadinimas *</label>
                <input
                  type="text"
                  required
                  placeholder="pvz., Lietuvių kalbos kabinetas nr. 1, Fizikos kabinetas, Aktų salė"
                  value={roomForm.name}
                  onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Atsakingas asmuo (kabineto vedėjas)</label>
                <select
                  value={roomForm.defaultResponsiblePersonId}
                  onChange={(e) => setRoomForm({ ...roomForm, defaultResponsiblePersonId: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Pasirinkti mokytoją / darbuotoją</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.roleTitle})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRoomModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs cursor-pointer"
                >
                  {editingRoom ? 'Išsaugoti pakeitimus' : 'Sukurti kabinetą'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Delete Confirmation Modal */}
      {deptToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden flex flex-col">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Ištrinti skyrių / korpusą</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Veiksmas negrįžtamas</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-900">{deptToDelete.name} ({deptToDelete.code})</div>
                <div className="text-slate-600">{deptToDelete.building}</div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                Ar tikrai norite ištrinti skyrių <strong>„{deptToDelete.name}“ [{deptToDelete.code}]</strong>?
              </p>

              {(() => {
                const countRooms = rooms.filter(r => r.departmentId === deptToDelete.id).length;
                const countItems = items.filter(i => i.departmentId === deptToDelete.id).length;
                if (countRooms > 0 || countItems > 0) {
                  return (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                      <strong>Įspėjimas:</strong> Šiam skyriui priskirti {countRooms} kabinetai(-ų) ir {countItems} turto vienetai(-ų). Ištrynus skyrių, susietos patalpos liks be skyriaus.
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDeptToDelete(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="button"
                onClick={executeDeleteDept}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                Taip, ištrinti skyrių
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Delete Confirmation Modal */}
      {roomToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden flex flex-col">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Ištrinti kabinetą / patalpą</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Veiksmas negrįžtamas</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-900">{formatRoomName(roomToDelete, true)}</div>
                <div className="text-slate-600">{roomToDelete.floor} aukštas</div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                Ar tikrai norite ištrinti kabinetą <strong>„{formatRoomName(roomToDelete, true)}“</strong>?
              </p>

              {(() => {
                const countItems = items.filter(i => i.roomId === roomToDelete.id).length;
                if (countItems > 0) {
                  return (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                      <strong>Įspėjimas:</strong> Šiame kabinete šiuo metu yra {countItems} registruoti turto vienetai(-ų). Ištrynus kabinetą, šie daiktai liks be patalpos.
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="button"
                onClick={executeDeleteRoom}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                Taip, ištrinti kabinetą
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
