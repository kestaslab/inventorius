import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeftRight, AlertCircle } from 'lucide-react';
import {
  InventoryItem,
  Department,
  Room,
  User,
  MovementRecord,
  formatRoomName,
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
  const activeDepartments = useMemo(() => departments.filter((d) => !d.isArchived), [departments]);
  const activeRooms = useMemo(() => rooms.filter((r) => !r.isArchived), [rooms]);
  const activeUsers = useMemo(
    () => users.filter((u) => !u.isArchived && u.isActive !== false),
    [users]
  );
  const transferableItems = useMemo(
    () => items.filter((i) => i.status !== 'written_off'),
    [items]
  );

  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [toDeptId, setToDeptId] = useState<string>('');
  const [toRoomId, setToRoomId] = useState<string>('');
  const [toUserId, setToUserId] = useState<string>('');
  const [reason, setReason] = useState<string>(
    'Planinis materialiųjų vertybių perskirstymas naujiems mokslo metams'
  );
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const initialItem = preSelectedItem || transferableItems[0] || null;
    const initialDept =
      activeDepartments.find((d) => d.id === initialItem?.departmentId) || activeDepartments[0];
    const initialDeptId = initialDept?.id || '';
    const deptRooms = activeRooms.filter((r) => r.departmentId === initialDeptId);
    const alternativeRoom =
      deptRooms.find((r) => r.id !== initialItem?.roomId) || deptRooms[0] || null;
    const initialUser =
      (alternativeRoom?.defaultResponsiblePersonId &&
        activeUsers.find((u) => u.id === alternativeRoom.defaultResponsiblePersonId)) ||
      activeUsers.find((u) => u.id === initialItem?.responsibleUserId) ||
      activeUsers[0];

    setSelectedItemId(initialItem?.id || '');
    setToDeptId(initialDeptId);
    setToRoomId(alternativeRoom?.id || '');
    setToUserId(initialUser?.id || '');
    setReason('Planinis materialiųjų vertybių perskirstymas naujiems mokslo metams');
    setError('');
  }, [isOpen, preSelectedItem]);

  if (!isOpen) return null;

  const currentItem = items.find((i) => i.id === (preSelectedItem?.id || selectedItemId));
  const fromDept = departments.find((d) => d.id === currentItem?.departmentId);
  const fromRoom = rooms.find((r) => r.id === currentItem?.roomId);
  const fromUser = users.find((u) => u.id === currentItem?.responsibleUserId);

  const availableRooms = activeRooms.filter((r) => r.departmentId === toDeptId);
  const targetDept = activeDepartments.find((d) => d.id === toDeptId);
  const targetRoom = availableRooms.find((r) => r.id === toRoomId);
  const targetUser = activeUsers.find((u) => u.id === toUserId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentItem) {
      setError('Pasirinkite perkeliamą turtą.');
      return;
    }
    if (currentItem.status === 'written_off') {
      setError('Negalima perkelti jau nurašyto turto.');
      return;
    }
    if (!targetDept) {
      setError('Pasirinkite galiojantį paskirties skyrių.');
      return;
    }
    if (availableRooms.length === 0 || !toRoomId) {
      setError(
        `Skyriuje „${targetDept.name}“ nėra aktyvių kabinetų. Sukurkite kabinetą arba pasirinkite kitą skyrių.`
      );
      return;
    }
    if (!targetRoom || targetRoom.departmentId !== toDeptId) {
      setError(
        `Pasirinktas kabinetas nepriklauso skyriui „${targetDept.name}“. Pasirinkite teisingą kabinetą.`
      );
      return;
    }
    if (!targetUser) {
      setError('Pasirinkite naują materialiai atsakingą asmenį.');
      return;
    }
    if (
      currentItem.departmentId === toDeptId &&
      currentItem.roomId === toRoomId &&
      currentItem.responsibleUserId === toUserId
    ) {
      setError('Nauja patalpa ir atsakingas asmuo sutampa su esama! Pasirinkite kitą kabinetą ar asmenį.');
      return;
    }
    if (!reason.trim()) {
      setError('Nurodykite perkėlimo priežastį / pagrindą.');
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
      toDepartmentId: toDeptId,
      toRoomId: toRoomId,
      fromUserId: currentItem.responsibleUserId,
      toUserId: toUserId,
      fromDepartmentName: fromDept?.name,
      fromRoomName: fromRoom ? formatRoomName(fromRoom, true) : undefined,
      fromUserName: fromUser?.fullName,
      toDepartmentName: targetDept.name,
      toRoomName: formatRoomName(targetRoom, true),
      toUserName: targetUser.fullName,
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
                  {transferableItems.map((i) => (
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
                {fromRoom ? formatRoomName(fromRoom, true) : 'Patalpa nenurodyta'} (
                {fromDept?.name || 'Skyrius nenurodytas'})
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
                      setError('');
                      const firstRoom = activeRooms.find((r) => r.departmentId === newDept);
                      if (firstRoom) {
                        setToRoomId(firstRoom.id);
                        if (
                          firstRoom.defaultResponsiblePersonId &&
                          activeUsers.some((u) => u.id === firstRoom.defaultResponsiblePersonId)
                        ) {
                          setToUserId(firstRoom.defaultResponsiblePersonId);
                        }
                      } else {
                        setToRoomId('');
                      }
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                  >
                    {activeDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Naujas kabinetas *</label>
                  <select
                    value={toRoomId}
                    disabled={availableRooms.length === 0}
                    onChange={(e) => {
                      const rId = e.target.value;
                      setToRoomId(rId);
                      setError('');
                      const roomObj = activeRooms.find((r) => r.id === rId);
                      if (
                        roomObj?.defaultResponsiblePersonId &&
                        activeUsers.some((u) => u.id === roomObj.defaultResponsiblePersonId)
                      ) {
                        setToUserId(roomObj.defaultResponsiblePersonId);
                      }
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {availableRooms.length === 0 ? (
                      <option value="">Šiame skyriuje nėra kabinetų</option>
                    ) : (
                      availableRooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatRoomName(r)}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {availableRooms.length === 0 && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-900">
                  Pasirinktame skyriuje nėra aktyvių kabinetų. Pirmiausia sukurkite kabinetą skyriuje arba pasirinkite kitą skyrių.
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Naujas materialiai atsakingas asmuo *
                </label>
                <select
                  value={toUserId}
                  onChange={(e) => setToUserId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.roleTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Perkėlimo pagrindas / priežastis *
                </label>
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
              disabled={availableRooms.length === 0 || !toRoomId}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md shadow-xs cursor-pointer transition-colors"
            >
              Patvirtinti perkėlimą ir sugeneruoti aktą
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
