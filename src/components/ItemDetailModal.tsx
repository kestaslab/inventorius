import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { 
  X, 
  QrCode, 
  ArrowLeftRight, 
  Edit3, 
  Trash2, 
  Calendar, 
  MapPin, 
  User as UserIcon, 
  Euro, 
  History,
  Download,
  Camera,
  Image as ImageIcon,
  Loader2,
  Barcode as BarcodeIcon,
  Printer,
  Laptop,
  Monitor,
  Server,
  Tablet,
  Cpu,
  HardDrive
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  MovementRecord,
  ASSET_CLASS_LABELS,
  FUNDING_SOURCE_LABELS,
  LONG_TERM_THRESHOLD,
  COMPUTER_TYPE_LABELS,
  formatRoomName
} from '../types/inventory';
import { compressPhoto } from '../utils/imageCompressor';
import { formatAgeDisplay } from './InventoryListView';
import { directPrintBrotherLabels } from '../utils/brotherPrinter';

interface ItemDetailModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  departments: Department[];
  rooms: Room[];
  users: User[];
  movements: MovementRecord[];
  currentUser: User;
  onEdit: (item: InventoryItem) => void;
  onTransfer: (item: InventoryItem) => void;
  onWriteOff: (item: InventoryItem) => void;
}

export const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  item,
  onClose,
  departments,
  rooms,
  users,
  movements,
  currentUser,
  onEdit,
  onTransfer,
  onWriteOff,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [activeMediaTab, setActiveMediaTab] = useState<'photo' | 'qr' | 'barcode'>('photo');

  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!item) return;
    const payload = JSON.stringify({
      inv: item.inventoryNumber,
      name: item.name,
      sn: item.serialNumber || '',
      school: 'Telšių r. Tryškių Lazdynų Pelėdos gimnazija'
    });
    QRCode.toDataURL(payload, {
      margin: 1,
      width: 200,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(setQrDataUrl);

    // Auto default to 'qr' if no photo exists
    if (!item.photoUrl) {
      setActiveMediaTab('photo');
    }
  }, [item]);

  useEffect(() => {
    if (barcodeRef.current && item?.inventoryNumber) {
      try {
        JsBarcode(barcodeRef.current, item.inventoryNumber, {
          format: 'CODE128',
          width: 1.4,
          height: 38,
          displayValue: false,
          margin: 0,
        });
      } catch (e) {
        console.error('Barcode error', e);
      }
    }
  }, [item?.inventoryNumber, activeMediaTab]);

  if (!item) return null;

  const dept = departments.find(d => d.id === item.departmentId);
  const room = rooms.find(r => r.id === item.roomId);
  const user = users.find(u => u.id === item.responsibleUserId);

  const itemMovements = movements.filter(m => m.itemId === item.id);
  const canManage = currentUser.role === 'admin' || currentUser.role === 'manager';

  const downloadQR = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `QR-${item.inventoryNumber}.png`;
    a.click();
  };

  const handleDirectPrintBrother = async () => {
    if (!item) return;
    await directPrintBrotherLabels({
      items: [item],
      rooms,
      departments,
      tapeWidthMm: 36,
      labelLengthMm: 68,
      codeType: 'qr_code',
      schoolName: 'TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.'
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      const compressedBase64 = await compressPhoto(file, 800, 0.75);
      onEdit({ ...item, photoUrl: compressedBase64 });
      setActiveMediaTab('photo');
    } catch (err) {
      console.error('Photo error', err);
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = () => {
    if (confirm('Ar tikrai norite pašalinti šio daikto nuotrauką?')) {
      onEdit({ ...item, photoUrl: undefined });
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Sticky Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-blue-600">
                {item.inventoryNumber}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs font-medium text-slate-600">
                {item.category}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                (item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD)
                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}>
                {(item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD) ? 'Ilgalaikis (IMT ≥ 750 €)' : 'Trumpalaikis / Mažavertis (< 750 €)'}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-900 border border-amber-200">
                {FUNDING_SOURCE_LABELS[item.fundingSource] || 'Gimnazijos lėšos'}
              </span>
            </div>
            <h3 className="text-base font-semibold text-slate-900 mt-1">
              {item.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1 overscroll-contain">

        {/* Hidden camera file inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoUpload}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoUpload}
          className="hidden"
        />

        {/* 2-Column Info & Visual Media (Photo / QR / Barcode) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Column: Visual Media Card */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex flex-col items-center justify-between text-center space-y-3">
            {/* Media Selector Tabs */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 rounded w-full text-[10px]">
              <button
                onClick={() => setActiveMediaTab('photo')}
                className={`flex-1 py-1 rounded font-medium transition-colors cursor-pointer ${
                  activeMediaTab === 'photo' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                }`}
              >
                Nuotrauka
              </button>
              <button
                onClick={() => setActiveMediaTab('qr')}
                className={`flex-1 py-1 rounded font-medium transition-colors cursor-pointer ${
                  activeMediaTab === 'qr' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                }`}
              >
                QR kodas
              </button>
              <button
                onClick={() => setActiveMediaTab('barcode')}
                className={`flex-1 py-1 rounded font-medium transition-colors cursor-pointer ${
                  activeMediaTab === 'barcode' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                }`}
              >
                Brūkšninis
              </button>
            </div>

            {/* Media Display Area */}
            <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[160px]">
              {activeMediaTab === 'photo' && (
                item.photoUrl ? (
                  <div className="space-y-2 w-full">
                    <div className="w-full h-36 rounded overflow-hidden border border-slate-200 bg-white shadow-2xs">
                      <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    {canManage && (
                      <div className="flex items-center justify-center gap-2 text-[11px]">
                        <button
                          onClick={() => cameraInputRef.current?.click()}
                          className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                        >
                          Perfografuoti
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          onClick={handleRemovePhoto}
                          className="text-rose-600 hover:text-rose-800 font-medium cursor-pointer"
                        >
                          Pašalinti
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full py-6 px-2 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-md bg-white">
                    <Camera className="w-8 h-8 text-slate-300" />
                    <span className="text-[11px] text-slate-500">Nuotrauka neprisegta</span>
                    {canManage && (
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isCompressing}
                        className="mt-1 px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold cursor-pointer transition-colors"
                      >
                        {isCompressing ? 'Kraunama...' : '+ Nufotografuoti'}
                      </button>
                    )}
                  </div>
                )
              )}

              {activeMediaTab === 'qr' && (
                <div className="space-y-2">
                  <div className="w-32 h-32 bg-white p-2 rounded border border-slate-200 shadow-2xs mx-auto">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt={item.inventoryNumber} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">Kraunama...</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 items-center">
                    <button
                      onClick={handleDirectPrintBrother}
                      title="Tiesiogiai spausdinti į Brother PT-E920BT 36 mm juostele"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs cursor-pointer w-full transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Spausdinti (Brother 36 mm)</span>
                    </button>
                    <button
                      onClick={downloadQR}
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer w-full"
                    >
                      <Download className="w-3 h-3 text-slate-500" />
                      <span>Atsisiųsti QR failą</span>
                    </button>
                  </div>
                </div>
              )}

              {activeMediaTab === 'barcode' && (
                <div className="space-y-2 w-full p-2 bg-white rounded border border-slate-200">
                  <svg ref={barcodeRef} className="max-w-full h-auto mx-auto" />
                  <div className="font-mono text-xs font-bold text-slate-900 tracking-wider">
                    *{item.inventoryNumber}*
                  </div>
                  <button
                    onClick={handleDirectPrintBrother}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs cursor-pointer w-full"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Spausdinti (Brother 36 mm)</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Key Details (2 cols) */}
          <div className="md:col-span-2 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Serijos numeris (S/N)</span>
                <span className="font-mono text-slate-900 font-medium">{item.serialNumber || 'Nenurodyta'}</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Įsigijimo data</span>
                <span className="font-mono text-slate-900 font-medium">{item.acquisitionDate}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Įsigijimo kaina</span>
                <span className="font-mono text-slate-900 font-bold text-sm">
                  {item.purchasePrice.toFixed(2)} €
                </span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Eksploatacijos amžius</span>
                <span className="font-mono text-slate-900 font-medium">
                  {formatAgeDisplay(item.acquisitionDate).label}
                </span>
              </div>
            </div>

            {/* Asset Classification & Funding Source */}
            <div className="bg-blue-50/60 p-2.5 rounded border border-blue-200/80 space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-medium">Apskaitos grupė:</span>
                <span className="font-semibold text-blue-900">
                  {(item.assetClass === 'long_term' || item.purchasePrice >= LONG_TERM_THRESHOLD) ? 'Ilgalaikis materialusis turtas (IMT)' : 'Trumpalaikis / Mažavertis turtas'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-medium">Turto kilmė / Panauda:</span>
                <span className="font-semibold text-slate-800">
                  {FUNDING_SOURCE_LABELS[item.fundingSource] || 'Gimnazijos lėšos'}
                </span>
              </div>
            </div>

            {/* Computer Hardware Specifications */}
            {item.specs && (item.specs.computerType || item.specs.cpu || item.specs.ramGb || item.specs.storage || item.specs.os) && (
              <div className="bg-slate-900 text-slate-100 p-3 rounded-lg border border-slate-800 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                    {item.specs.computerType === 'laptop' && <Laptop className="w-4 h-4 text-sky-400" />}
                    {item.specs.computerType === 'desktop' && <Monitor className="w-4 h-4 text-sky-400" />}
                    {item.specs.computerType === 'server' && <Server className="w-4 h-4 text-amber-400" />}
                    {item.specs.computerType === 'tablet' && <Tablet className="w-4 h-4 text-emerald-400" />}
                    {!item.specs.computerType && <Cpu className="w-4 h-4 text-sky-400" />}
                    <span>
                      {item.specs.computerType ? COMPUTER_TYPE_LABELS[item.specs.computerType] : 'Techninė kompiuterio specifikacija'}
                    </span>
                  </div>
                  {item.specs.os && (
                    <span className="text-[10px] bg-slate-800 text-sky-300 px-2 py-0.5 rounded font-mono font-medium border border-slate-700">
                      {item.specs.os}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  {item.specs.cpu && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">Procesorius (CPU)</span>
                      <span className="font-semibold text-slate-100 font-mono">{item.specs.cpu}</span>
                    </div>
                  )}
                  {item.specs.ramGb && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">Atmintis (RAM)</span>
                      <span className="font-bold text-sky-300 font-mono">{item.specs.ramGb} GB</span>
                    </div>
                  )}
                  {item.specs.storage && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">Diskas (Storage)</span>
                      <span className="font-semibold text-slate-100 font-mono">{item.specs.storage}</span>
                    </div>
                  )}
                  {item.specs.screenSize && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">Ekranas</span>
                      <span className="font-medium text-slate-200">{item.specs.screenSize}</span>
                    </div>
                  )}
                  {item.specs.gpu && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">Vaizdo plokštė</span>
                      <span className="font-medium text-slate-200">{item.specs.gpu}</span>
                    </div>
                  )}
                  {item.specs.macAddress && (
                    <div className="bg-slate-800/90 p-2 rounded border border-slate-700/70">
                      <span className="text-slate-400 block text-[10px]">MAC adresas</span>
                      <span className="font-mono text-slate-300 text-[10px]">{item.specs.macAddress}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-slate-50 p-2.5 rounded border border-slate-100 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Patalpa:</span>
                <span className="font-medium text-slate-900">
                  {formatRoomName(room, true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Skyrius:</span>
                <span className="text-slate-800">{dept?.name || 'Nenurodyta'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Atsakingas asmuo:</span>
                <span className="font-medium text-slate-900">{user?.fullName || 'Nepriskirta'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Būsena</span>
                <span className="font-medium text-slate-900 capitalize">
                  {item.status === 'active' ? 'Aktyvus / Naudojamas' : item.status === 'in_repair' ? 'Remontuojamas' : 'Nurašytas'}
                </span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                <span className="text-slate-500 block text-[11px]">Būklė</span>
                <span className="font-medium text-slate-900 capitalize">
                  {item.condition === 'new' ? 'Nauja' : item.condition === 'good' ? 'Gera' : item.condition === 'fair' ? 'Patenkinama' : 'Prasta'}
                </span>
              </div>
            </div>

            {item.notes && (
              <div className="p-2.5 bg-blue-50/50 border border-blue-100 rounded text-slate-700">
                <span className="font-semibold block text-[11px] text-blue-900">Pastabos:</span>
                {item.notes}
              </div>
            )}
          </div>
        </div>

        {/* History of transfers */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 mb-2">
            <History className="w-4 h-4 text-slate-500" />
            <span>Judėjimo ir perdavimo istorija</span>
          </div>

          {itemMovements.length === 0 ? (
            <div className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded">
              Šis turtas nuo registracijos momento nebuvo perkeltas.
            </div>
          ) : (
            <div className="space-y-1.5 text-xs">
              {itemMovements.map(m => (
                <div key={m.id} className="p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-slate-500">{m.date}</span>
                    <span className="mx-2 font-mono font-medium text-blue-600">[{m.actNumber}]</span>
                    <span className="text-slate-800">{m.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Actions (Pinned Footer) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-100 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            {canManage && item.status !== 'written_off' && (
              <>
                <button
                  onClick={() => {
                    onClose();
                    onTransfer(item);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer transition-colors"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Perkelti į kitą kabinetą</span>
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onWriteOff(item);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Teikti nurašymui</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={() => {
                  onClose();
                  onEdit(item);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                <span>Redaguoti</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
            >
              Uždaryti
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
