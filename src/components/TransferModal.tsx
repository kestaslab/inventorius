import React, { useState } from 'react';
import { X, ArrowLeftRight, AlertCircle, Building2, User as UserIcon } from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  MovementRecord 
} from '../types/inventory';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  preSelectedItem?: InventoryItem | null;
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  onExecuteTransfer: (record: MovementRecord) => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  preSelectedItem,
  items,
  departments,
  rooms,
  users,
  onExecuteTransfer,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string>(preSelectedItem?.id || items[0]?.id || '');
  const [toDeptId, setToDeptId] = useState<string>(departments[0]?.id || '');
  const [toRoomId, setToRoomId] = useState<string>(rooms[0]?.id || '');
  const [toUserId, setToUserId] = useState<string>(users[0]?.id || '');
  const [reason, setReason] = useState<string>('Planinis materialiųjų vertybių perskirstymas naujiems mokslo metams');
  const [error, setError] = useState<string>('');

  if (!isOpen) return null;

  const currentItem = items.find(i => i.id === (preSelectedItem?.id || selectedItemId));
  const fromDept = departments.find(d => d.id === currentItem?.departmentId);
  const fromRoom = rooms.find(r => r.id === currentItem?.roomId);
  const fromUser = users.find(u => u.id === currentItem?.responsibleUserId);

  const availableRooms = rooms.filter(r => !toDeptId || r.departmentId === toDeptId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentItem) {
      setError('Pasirinkite perkeliamą turtą');
      return;
    }
    if (currentItem.roomId === toRoomId && currentItem.responsibleUserId === toUserId) {
      setError('Nauja patalpa ir atsakingas asmuo sutampa su esama! Pasirinkite kitą kabinetą ar asmenį.');
      return;
    }
    if (!reason.trim()) {
      setError('Nurodykite perkėlimo priežastį / pagrindą');
      return;
    }

    const currentYear = new Date().getFullYear();
    const actNumber = `PER-${currentYear}-${Math.floor(100 + Math.random() * 900)}`;

    const record: MovementRecord = {
      id: `mov-${Date.now()}`,
      itemId: currentItem.id,
      itemName: currentItem.name,
      inventoryNumber: currentItem.inventoryNumber,
      fromDepartmentId: currentItem.departmentId,
      fromRoomId: currentItem.roomId,
      toDepartmentId: toDeptId || departments[0]?.id || '',
      toRoomId: toRoomId,
      fromUserId: currentItem.responsibleUserId,
      toUserId: toUserId,
      date: new Date().toISOString().replace('T', ' ').slice(0, 16),
      reason: reason.trim(),
      actNumber,
    };

    onExecuteTransfer(record);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Turto perkėlimo ir perdavimo procedūra
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1 overscroll-contain text-xs">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}
          {/* Item selector if not preselected */}
          {!preSelectedItem && (
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Pasirinkite perkeliamą daiktą *
              </label>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono"
              >
                {items.filter(i => i.status !== 'written_off').map(i => (
                  <option key={i.id} value={i.id}>
                    [{i.inventoryNumber}] {i.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Current Location (Source) */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Dabartinė vieta ir atsakomybė:
            </span>
            <div className="text-slate-900 font-medium">
              [{currentItem?.inventoryNumber}] {currentItem?.name}
            </div>
            <div className="text-slate-600 text-[11px]">
              {fromRoom ? `${fromRoom.number} kab. ${fromRoom.name}` : 'Patalpa nenurodyta'} ({fromDept?.name})
            </div>
            <div className="text-slate-600 text-[11px]">
              Atsakingas: <strong>{fromUser?.fullName || 'Nenurodyta'}</strong>
            </div>
          </div>

          {/* Target Location (Destination) */}
          <div className="space-y-3 pt-2">
            <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider block">
              Nauja paskirties vieta:
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Naujas skyrius *</label>
                <select
                  value={toDeptId}
                  onChange={(e) => {
                    const newDept = e.target.value;
                    setToDeptId(newDept);
                    const firstRoom = rooms.find(r => r.departmentId === newDept);
                    if (firstRoom) setToRoomId(firstRoom.id);
                  }}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Naujas kabinetas *</label>
                <select
                  value={toRoomId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setToRoomId(rId);
                    const roomObj = rooms.find(r => r.id === rId);
                    if (roomObj?.defaultResponsiblePersonId) {
                      setToUserId(roomObj.defaultResponsiblePersonId);
                    }
                  }}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                >
                  {availableRooms.map(r => (
                    <option key={r.id} value={r.id}>{r.number} {r.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Naujas materialiai atsakingas asmuo *</label>
              <select
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-medium"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.fullName} ({u.roleTitle})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Perkėlimo pagrindas / priežastis *</label>
              <textarea
                rows={2}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nurodykite direktoriaus įsakymą, kabinetų reorganizaciją ar mokytojo prašymą..."
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-200/70 rounded-md cursor-pointer transition-colors"
            >
              Atšaukti
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs cursor-pointer transition-colors"
            >
              Patvirtinti perkėlimą ir sugeneruoti aktą
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
