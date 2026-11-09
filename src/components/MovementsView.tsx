import React, { useState } from 'react';
import { 
  ArrowLeftRight, 
  Plus, 
  FileText, 
  Printer, 
  Calendar, 
  Search, 
  X,
  Building,
  UserCheck
} from 'lucide-react';
import { MovementRecord, Department, Room, User } from '../types/inventory';

interface MovementsViewProps {
  movements: MovementRecord[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  currentUser: User;
  onOpenTransferModal: () => void;
}

export const MovementsView: React.FC<MovementsViewProps> = ({
  movements,
  departments,
  rooms,
  users,
  currentUser,
  onOpenTransferModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAct, setSelectedAct] = useState<MovementRecord | null>(null);

  const filteredMovements = movements.filter(m => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      m.itemName.toLowerCase().includes(q) ||
      m.inventoryNumber.toLowerCase().includes(q) ||
      m.actNumber.toLowerCase().includes(q) ||
      m.reason.toLowerCase().includes(q)
    );
  });

  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  const handlePrintAct = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Materialiųjų vertybių judėjimo ir perdavimo žurnalas
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Fiksuojami visi turto perkėlimai tarp skyrių, kabinetų ir materialiai atsakingų asmenų
          </p>
        </div>

        {canManage && (
          <button
            onClick={onOpenTransferModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-xs cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Naujas turto perkėlimas</span>
          </button>
        )}
      </div>

      {/* Search Input */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Ieškoti pagal daiktą, inventorinį numerį, akto numerį arba priežastį..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">Akto Nr.</th>
                <th className="py-2.5 px-4">Data</th>
                <th className="py-2.5 px-4">Turtas</th>
                <th className="py-2.5 px-4">Iš kur (Patalpa / Asmuo)</th>
                <th className="py-2.5 px-4">Į kur (Patalpa / Asmuo)</th>
                <th className="py-2.5 px-4">Priežastis / Pagrindas</th>
                <th className="py-2.5 px-4 text-right">Dokumentas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Perkėlimo įrašų nerasta
                  </td>
                </tr>
              ) : (
                filteredMovements.map((mov) => {
                  const fromRoom = rooms.find(r => r.id === mov.fromRoomId);
                  const toRoom = rooms.find(r => r.id === mov.toRoomId);
                  const fromUser = users.find(u => u.id === mov.fromUserId);
                  const toUser = users.find(u => u.id === mov.toUserId);

                  return (
                    <tr key={mov.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600 whitespace-nowrap">
                        {mov.actNumber}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                        {mov.date}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{mov.itemName}</div>
                        <div className="text-[11px] font-mono text-slate-500">{mov.inventoryNumber}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-slate-800">{fromRoom?.number} kab.</div>
                        <div className="text-[11px] text-slate-500 truncate">{fromUser?.fullName}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-slate-800 font-medium text-blue-700">{toRoom?.number} kab.</div>
                        <div className="text-[11px] text-slate-600 truncate">{toUser?.fullName}</div>
                      </td>
                      <td className="py-2.5 px-4 max-w-xs text-slate-600 truncate">
                        {mov.reason}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => setSelectedAct(mov)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span>Akto peržiūra</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Official Transfer Act Modal (Printable) */}
      {selectedAct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-8 my-8 print-sheet relative">
            {/* Modal Controls (Hidden in print) */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6 no-print">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Oficialaus akto peržiūra
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintAct}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Spausdinti aktą (A4)</span>
                </button>
                <button
                  onClick={() => setSelectedAct(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Document Header */}
            <div className="text-center space-y-1 mb-8">
              <div className="text-sm font-bold uppercase tracking-wide text-slate-900">
                TELŠIŲ RAJ. TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMNAZIJA
              </div>
              <div className="text-xs text-slate-500">
                Įm. k. 190581452, Lazdynų Pelėdos g. 20, Tryškiai, Telšių r.
              </div>
              <div className="pt-4 text-base font-bold text-slate-900 tracking-tight">
                MATERIALIOJO TURTO PERDAVIMO – PRIĖMIMO AKTAS
              </div>
              <div className="text-xs font-mono text-slate-700">
                Nr. {selectedAct.actNumber}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {selectedAct.date}
              </div>
            </div>

            {/* Document Body */}
            <div className="space-y-4 text-xs text-slate-800 leading-relaxed">
              <p>
                Šiuo aktu patvirtinama, kad Telšių raj. Tryškių Lazdynų Pelėdos gimnazijoje atliktas materialiųjų vertybių perdavimas:
              </p>

              <div className="bg-slate-50 p-3.5 rounded border border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Perdavėjas (buvusi vieta):</span>
                    <strong className="text-slate-900">
                      {users.find(u => u.id === selectedAct.fromUserId)?.fullName || 'Nenurodyta'}
                    </strong>
                    <div className="text-slate-600 text-[11px]">
                      {rooms.find(r => r.id === selectedAct.fromRoomId)?.number} kab. (
                      {departments.find(d => d.id === selectedAct.fromDepartmentId)?.name})
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Priėmėjas (nauja vieta):</span>
                    <strong className="text-slate-900">
                      {users.find(u => u.id === selectedAct.toUserId)?.fullName || 'Nenurodyta'}
                    </strong>
                    <div className="text-slate-600 text-[11px]">
                      {rooms.find(r => r.id === selectedAct.toRoomId)?.number} kab. (
                      {departments.find(d => d.id === selectedAct.toDepartmentId)?.name})
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="pt-2">
                <table className="w-full text-left border border-slate-300 text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 font-semibold text-slate-800">
                      <th className="p-2 w-10 text-center">Eil. Nr.</th>
                      <th className="p-2">Inventorinis Nr.</th>
                      <th className="p-2">Turto pavadinimas</th>
                      <th className="p-2 w-20 text-center">Kiekis</th>
                      <th className="p-2">Būklė perdavimo metu</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-2 text-center font-mono">1</td>
                      <td className="p-2 font-mono font-semibold">{selectedAct.inventoryNumber}</td>
                      <td className="p-2 font-medium">{selectedAct.itemName}</td>
                      <td className="p-2 text-center font-mono">1 vnt.</td>
                      <td className="p-2 text-emerald-800">Tvarkinga / Veikianti</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="pt-2">
                <span className="font-semibold text-slate-900">Perdavimo pagrindas / priežastis: </span>
                <span>{selectedAct.reason}</span>
              </div>
            </div>

            {/* Document Signatures */}
            <div className="mt-12 pt-6 border-t border-slate-200 grid grid-cols-2 gap-8 text-xs">
              <div className="space-y-4">
                <div className="text-slate-600 font-medium">Turtą perdavė:</div>
                <div className="border-b border-slate-400 h-8"></div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>(Parašas)</span>
                  <span>{users.find(u => u.id === selectedAct.fromUserId)?.fullName}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-slate-600 font-medium">Turtą priėmė:</div>
                <div className="border-b border-slate-400 h-8"></div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>(Parašas)</span>
                  <span>{users.find(u => u.id === selectedAct.toUserId)?.fullName}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 text-center text-[10px] text-slate-400 print-only">
              Dokumentas sugeneruotas Telšių raj. Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistemoje
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
