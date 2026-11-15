import React, { useState, useEffect } from 'react';
import { X, Trash2, AlertTriangle, FileText } from 'lucide-react';
import { InventoryItem, WriteOffAct, ASSET_CLASS_SHORT_LABELS } from '../types/inventory';
import { resolveAssetClass } from '../utils/accountingUtils';

interface WriteOffModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  writeOffActs?: WriteOffAct[];
  onConfirmWriteOff: (
    item: InventoryItem,
    reasonCategory: string,
    notes: string,
    targetActId?: string
  ) => void;
}

export const WriteOffModal: React.FC<WriteOffModalProps> = ({
  isOpen,
  onClose,
  item,
  writeOffActs = [],
  onConfirmWriteOff,
}) => {
  const [reasonCategory, setReasonCategory] = useState<string>(
    'Fizinis susidėvėjimas (sugedęs ir neremontuotinas)'
  );
  const [defectNotes, setDefectNotes] = useState<string>('');
  const [selectedDraftActId, setSelectedDraftActId] = useState<string>('');

  const draftActs = writeOffActs.filter((a) => a.status === 'draft');

  useEffect(() => {
    if (isOpen) {
      setDefectNotes('');
      setSelectedDraftActId('');
    }
  }, [isOpen, item?.id]);

  if (!isOpen || !item) return null;

  const existingActiveDraft = draftActs.find((a) =>
    a.items.some((ai) => ai.itemId === item.id)
  );
  const isAlreadyBlocked =
    item.status === 'to_writeoff' ||
    item.status === 'written_off' ||
    Boolean(existingActiveDraft);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAlreadyBlocked || !defectNotes.trim()) return;
    onConfirmWriteOff(item, reasonCategory, defectNotes.trim(), selectedDraftActId || undefined);
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
            {isAlreadyBlocked ? (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-xs text-rose-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="font-medium">
                  {existingActiveDraft
                    ? `Šis turtas jau yra įtrauktas į aktyvų nurašymo projektą „${existingActiveDraft.actNumber}“. Negalima pateikti į kelis projektus vienu metu.`
                    : item.status === 'to_writeoff'
                    ? 'Šis turtas jau pateiktas nurašymui.'
                    : 'Šis turtas jau nurašytas archyve. Prieš pakartotinį nurašymą jį reikia atkurti iš archyvo.'}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="font-medium">
                  Turtas bus perkeltas į būseną <strong>„Teikiamas nurašyti“</strong> ir įtrauktas į nurašymo akto projektą. Visi vieno akto daiktai vėliau tvirtinami kartu.
                </div>
              </div>
            )}

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-300 space-y-1">
              <div className="font-bold text-slate-900">
                [{item.inventoryNumber}] {item.name}
              </div>
              <div className="text-slate-600 flex justify-between font-medium">
                <span>Įsigijimo vertė: <strong>{item.purchasePrice.toFixed(2)} €</strong></span>
                <span className="text-blue-700 font-semibold">
                  {ASSET_CLASS_SHORT_LABELS[resolveAssetClass(item)]}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Nurašymo akto projektas *</span>
              </label>
              <select
                value={selectedDraftActId}
                onChange={(e) => setSelectedDraftActId(e.target.value)}
                disabled={isAlreadyBlocked}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 font-medium text-slate-900 focus:ring-1 focus:ring-blue-500 shadow-2xs"
              >
                <option value="">
                  + Sukurti naują nurašymo aktą (unikalus Nr. bus priskirtas serveryje)
                </option>
                {draftActs.map((act) => (
                  <option key={act.id} value={act.id}>
                    Pridėti prie esamo projekto: {act.actNumber} ({act.date} · {act.items.length} vnt.)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">
                Nurašymo priežasties kategorija *
              </label>
              <select
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
                disabled={isAlreadyBlocked}
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
                disabled={isAlreadyBlocked}
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
              disabled={isAlreadyBlocked}
              className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-md shadow-xs cursor-pointer transition-colors"
            >
              Teikti nurašymui
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
