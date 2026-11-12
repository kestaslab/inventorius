import React, { useState, useRef } from 'react';
import { 
  X, 
  AlertTriangle, 
  Camera, 
  Image as ImageIcon, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  Send 
} from 'lucide-react';
import { InventoryItem, DefectReport, formatRoomName, Room, Department } from '../types/inventory';
import { compressPhoto } from '../utils/imageCompressor';

interface ReportFaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  room?: Room | null;
  dept?: Department | null;
  currentUserName: string;
  currentUserId: string;
  onSubmitFault: (item: InventoryItem, defectReport: DefectReport) => void;
}

export const ReportFaultModal: React.FC<ReportFaultModalProps> = ({
  isOpen,
  onClose,
  item,
  room,
  dept,
  currentUserName,
  currentUserId,
  onSubmitFault,
}) => {
  const [description, setDescription] = useState('');
  const [quickFaultType, setQuickFaultType] = useState('Neįsijungia / Nereaguoja');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen || !item) return null;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsCompressing(true);
      const compressed = await compressPhoto(file, 800, 0.75);
      setPhotoUrl(compressed);
    } catch (err) {
      setError('Nepavyko apdoroti nuotraukos. Bandykite dar kartą.');
      console.error(err);
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Prašome trumpai aprašyti, kas nutiko daiktui.');
      return;
    }

    const fullDesc = `[${quickFaultType}] ${description.trim()}`;
    const report: DefectReport = {
      id: `defect-${Date.now()}`,
      reportedAt: new Date().toISOString(),
      reportedByUserId: currentUserId,
      reportedByUserName: currentUserName,
      description: fullDesc,
      severity,
      status: 'reported',
      photoUrl: photoUrl || undefined,
    };

    onSubmitFault(item, report);
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      setDescription('');
      setPhotoUrl('');
      setError('');
      onClose();
    }, 1200);
  };

  const quickTypes = [
    'Neįsijungia / Nereaguoja',
    'Sulaužyta detalė / Korpuso defektas',
    'Ekrano / Vaizdo gedimas',
    'Programinis gedimas / OS klaida',
    'Trūksta laido / kroviklio',
    'Kita problema',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-2xs animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-300 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-amber-500 text-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-600/30 flex items-center justify-center font-bold">
              <AlertTriangle className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h3 className="text-sm font-bold leading-tight">Pranešti apie gedimą / defektą</h3>
              <p className="text-[11px] text-slate-900/80">Informacija bus perduota IT ir ūkio dalies vedėjui</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-900 hover:text-black p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSubmitted ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-bold text-slate-900">Gedimas sėkmingai užregistruotas!</h4>
            <p className="text-xs text-slate-600 max-w-xs mx-auto">
              Ačiū, informacija perduota administratoriui. Daikto būsena pakeista į „Remontuojamas“.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Item Info Box */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                    {item.inventoryNumber}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatRoomName(room, true)} {dept ? `(${dept.name})` : ''}
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-900 mt-1">
                  {item.name}
                </div>
                {item.serialNumber && (
                  <div className="text-[11px] text-slate-500 font-mono">
                    Serijos Nr.: {item.serialNumber}
                  </div>
                )}
              </div>

              {error && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-md font-medium text-xs">
                  {error}
                </div>
              )}

              {/* Quick Defect Type */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5">Gedimo pobūdis</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {quickTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setQuickFaultType(type)}
                      className={`text-left px-2.5 py-1.5 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                        quickFaultType === type
                          ? 'bg-amber-50 border-amber-500 text-amber-900 font-bold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Problemos aprašymas <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Aprašykite požymius: kas neveikia, kokiomis aplinkybėmis įvyko, ar trukdo pamokai..."
                  className="w-full bg-white border border-slate-300 rounded px-2.5 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Severity */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Skubumas / įtaka darbui</label>
                <div className="flex items-center gap-2">
                  {[
                    { id: 'low', label: 'Nedidelis (gali palaukti)', color: 'bg-slate-100 text-slate-700' },
                    { id: 'medium', label: 'Vidutinis (reikia remonto)', color: 'bg-amber-100 text-amber-800' },
                    { id: 'high', label: 'Skubus (trukdo pamokoms)', color: 'bg-rose-100 text-rose-800' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSeverity(s.id as any)}
                      className={`flex-1 py-1.5 px-2 rounded border text-center text-[11px] font-medium transition-all cursor-pointer ${
                        severity === s.id
                          ? 'border-blue-600 ring-2 ring-blue-500/20 font-bold ' + s.color
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo of defect */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-700 font-bold">Defekto nuotrauka (neprivaloma)</label>
                  {isCompressing && (
                    <div className="flex items-center gap-1 text-[11px] text-blue-600">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Optimizuojama...</span>
                    </div>
                  )}
                </div>

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />

                {photoUrl ? (
                  <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200">
                    <img src={photoUrl} alt="Defektas" className="w-12 h-12 object-cover rounded border" />
                    <span className="text-[11px] text-slate-600 flex-1">Nuotrauka prisegta</span>
                    <button
                      type="button"
                      onClick={() => setPhotoUrl('')}
                      className="p-1 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded font-medium cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Nufotografuoti</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded font-medium cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Pasirinkti failą</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Siųsti pranešimą</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
