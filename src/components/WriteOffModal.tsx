import React, { useState } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { InventoryItem, WriteOffAct } from '../types/inventory';

interface WriteOffModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  onConfirmWriteOff: (item: InventoryItem, reasonCategory: string, notes: string) => void;
}

export const WriteOffModal: React.FC<WriteOffModalProps> = ({
  isOpen,
  onClose,
  item,
  onConfirmWriteOff,
}) => {
  const [reasonCategory, setReasonCategory] = useState<string>('Fizinis susidėvėjimas (sugedęs ir neremontuotinas)');
  const [defectNotes, setDefectNotes] = useState<string>('');

  if (!isOpen || !item) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirmWriteOff(item, reasonCategory, defectNotes);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-300">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0 bg-slate-50/60">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Teikti turtą nurašymo procedūrai
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
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="font-medium">
                Turtas bus perkeltas į būseną <strong>„Teikiamas nurašyti“</strong> ir įtrauktas į oficialų nurašymo aktą komisijos patvirtinimui.
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-300 space-y-1">
              <div className="font-bold text-slate-900">
                [{item.inventoryNumber}] {item.name}
              </div>
              <div className="text-slate-600 flex justify-between font-medium">
                <span>Įsigijimo vertė: <strong>{item.purchasePrice.toFixed(2)} €</strong></span>
                <span className="text-blue-700 font-semibold">{item.purchasePrice >= 750 ? 'IMT (≥750€)' : 'TMT (<750€)'}</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">
                Nurašymo priežasties kategorija *
              </label>
              <select
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium text-slate-900 focus:ring-1 focus:ring-blue-500 shadow-2xs"
              >
                <option value="Fizinis susidėvėjimas (sugedęs ir neremontuotinas)">
                  Fizinis susidėvėjimas (sugedęs ir neremontuotinas)
                </option>
                <option value="Moralinis pasenimas (neatitinka šiuolaikinių reikalavimų)">
                  Moralinis pasenimas (neatitinka šiuolaikinių reikalavimų)
                </option>
                <option value="Ekonomiškai netikslingas remontas">
                  Ekonomiškai netikslingas remontas
                </option>
                <option value="Prarastas arba pažeistas stichijos metu">
                  Prarastas arba pažeistas stichijos metu
                </option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">
                Defekto aprašymas arba komisijos išvada *
              </label>
              <textarea
                rows={3}
                required
                value={defectNotes}
                onChange={(e) => setDefectNotes(e.target.value)}
                placeholder="pvz., Pagrindinės plokštės perdegimas, remontas viršija naujo įrenginio vertę..."
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium text-slate-900 focus:ring-1 focus:ring-blue-500 shadow-2xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 bg-slate-100/80 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
            >
              Atšaukti
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shadow-xs cursor-pointer transition-colors"
            >
              Teikti nurašymui
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
