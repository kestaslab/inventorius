import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Sparkles, 
  AlertCircle, 
  Camera, 
  Image as ImageIcon, 
  Trash2, 
  Loader2,
  Laptop,
  Monitor,
  Server,
  Tablet,
  Cpu,
  HardDrive,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  InventoryItem, 
  Department, 
  Room, 
  User, 
  ItemCategory, 
  ItemStatus, 
  ItemCondition,
  AssetClass,
  FundingSource,
  ComputerSpecs,
  ComputerType,
  COMPUTER_TYPE_LABELS,
  ASSET_CLASS_LABELS,
  FUNDING_SOURCE_LABELS,
  LONG_TERM_THRESHOLD,
  formatRoomName 
} from '../types/inventory';
import { StorageService } from '../utils/storage';
import { compressPhoto } from '../utils/imageCompressor';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: InventoryItem) => void;
  editingItem?: InventoryItem | null;
  allItems: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
}

export const ItemModal: React.FC<ItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingItem,
  allItems,
  departments,
  rooms,
  users,
}) => {
  const [formData, setFormData] = useState<Partial<InventoryItem>>({
    inventoryNumber: '',
    serialNumber: '',
    name: '',
    category: 'Kompiuteriai',
    departmentId: departments[0]?.id || '',
    roomId: rooms[0]?.id || '',
    responsibleUserId: users[0]?.id || '',
    acquisitionDate: new Date().toISOString().slice(0, 10),
    purchasePrice: 100,
    residualValue: 100,
    assetClass: 'short_term',
    fundingSource: 'school',
    status: 'active',
    condition: 'good',
    notes: '',
    photoUrl: '',
  });

  const [residualInput, setResidualInput] = useState<string>('');
  const [specs, setSpecs] = useState<ComputerSpecs>({});
  const [showSpecsSection, setShowSpecsSection] = useState<boolean>(true);

  const [validationError, setValidationError] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const prevInitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      prevInitKeyRef.current = null;
      return;
    }
    const initKey = editingItem ? `edit:${editingItem.id}` : 'create';
    if (prevInitKeyRef.current === initKey) return;
    prevInitKeyRef.current = initKey;

    setValidationError('');
    if (editingItem) {
      setFormData({
        ...editingItem,
        assetClass:
          editingItem.assetClass ||
          (Number(editingItem.purchasePrice) >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term'),
        fundingSource: editingItem.fundingSource || 'school',
      });
      setResidualInput(
        editingItem.residualValue !== undefined ? String(editingItem.residualValue) : ''
      );
      setSpecs(editingItem.specs || {});
      setShowSpecsSection(editingItem.category === 'Kompiuteriai' || !!editingItem.specs);
    } else {
      const autoInv = StorageService.generateNextInventoryNumber(allItems);
      const defaultPrice = 250;
      const firstActiveDept = departments.find((d) => !d.isArchived) || departments[0];
      const firstActiveRoom =
        rooms.find((r) => !r.isArchived && r.departmentId === firstActiveDept?.id) ||
        rooms.find((r) => !r.isArchived) ||
        rooms[0];
      const firstActiveUser =
        users.find((u) => !u.isArchived && u.isActive !== false) || users[0];

      setFormData({
        inventoryNumber: autoInv,
        serialNumber: '',
        name: '',
        category: 'Kompiuteriai',
        departmentId: firstActiveDept?.id || '',
        roomId: firstActiveRoom?.id || '',
        responsibleUserId: firstActiveUser?.id || '',
        acquisitionDate: new Date().toISOString().slice(0, 10),
        purchasePrice: defaultPrice,
        residualValue: defaultPrice,
        assetClass: defaultPrice >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term',
        fundingSource: 'school',
        status: 'active',
        condition: 'good',
        notes: '',
        photoUrl: '',
      });
      setResidualInput(String(defaultPrice));
      setSpecs({});
      setShowSpecsSection(true);
    }

    setTimeout(() => {
      scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, 0);
  }, [editingItem, allItems, departments, rooms, users, isOpen]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setValidationError('');
    try {
      setIsCompressing(true);
      const compressedBase64 = await compressPhoto(file, 800, 0.75);
      const uploaded = await StorageService.uploadPhoto(compressedBase64);
      if (!uploaded.ok) {
        setValidationError(uploaded.error);
        return;
      }
      setFormData(prev => ({ ...prev, photoUrl: uploaded.url }));
    } catch (err) {
      setValidationError('Nepavyko apdoroti nuotraukos. Pabandykite kitą failą.');
      console.error(err);
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setFormData(prev => ({ ...prev, photoUrl: '' }));
  };

  if (!isOpen) return null;

  const categories: ItemCategory[] = [
    'Kompiuteriai',
    'Kita IT įranga',
    'Baldai',
    'Mokymo priemonės',
    'Sporto inventorius',
    'Buitinė ir virtuvės technika',
    'Muzikos instrumentai',
    'Laboratorinė įranga',
    'Kita',
  ];

  const selectableDepartments = departments.filter(
    (d) => !d.isArchived || d.id === formData.departmentId
  );
  const availableRooms = rooms.filter(
    (r) =>
      r.departmentId === formData.departmentId &&
      (!r.isArchived || r.id === formData.roomId)
  );
  const selectableUsers = users.filter(
    (u) => (!u.isArchived && u.isActive !== false) || u.id === formData.responsibleUserId
  );

  const isStatusLockedByWorkflow =
    editingItem?.status === 'to_writeoff' || editingItem?.status === 'written_off';

  const locationOrOwnerChanged = Boolean(
    editingItem &&
      (editingItem.departmentId !== formData.departmentId ||
        editingItem.roomId !== formData.roomId ||
        editingItem.responsibleUserId !== formData.responsibleUserId)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    if (!formData.name?.trim()) {
      setValidationError('Įveskite turto pavadinimą');
      return;
    }
    if (!formData.inventoryNumber?.trim()) {
      setValidationError('Įveskite inventorinį numerį');
      return;
    }

    // Check duplicate inventory number if new or changed
    const isDuplicate = allItems.some(
      (i) =>
        i.inventoryNumber.trim().toUpperCase() === formData.inventoryNumber?.trim().toUpperCase() &&
        (!editingItem || i.id !== editingItem.id)
    );
    if (isDuplicate) {
      setValidationError(
        `Inventorinis numeris "${formData.inventoryNumber}" jau priskirtas kitam daiktui!`
      );
      return;
    }

    // Check location integrity
    const selectedDept = departments.find((d) => d.id === formData.departmentId);
    if (!selectedDept) {
      setValidationError('Pasirinkite galiojantį skyrių.');
      return;
    }
    if (!formData.roomId) {
      setValidationError(
        'Pasirinktame skyriuje nėra kabinetų arba kabinetas nepasirinktas. Pirmiausia sukurkite kabinetą.'
      );
      return;
    }
    const selectedRoom = rooms.find((r) => r.id === formData.roomId);
    if (!selectedRoom || selectedRoom.departmentId !== selectedDept.id) {
      setValidationError(
        `Pasirinktas kabinetas nepriklauso skyriui „${selectedDept.name}“. Pasirinkite teisingą kabinetą.`
      );
      return;
    }
    if (!formData.responsibleUserId || !users.some((u) => u.id === formData.responsibleUserId)) {
      setValidationError('Pasirinkite materialiai atsakingą asmenį.');
      return;
    }

    // Validate date
    const acqDate = (formData.acquisitionDate || '').trim();
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) {
      setValidationError('Įveskite teisingą įsigijimo datą (YYYY-MM-DD).');
      return;
    }
    const [y, m, d] = acqDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      y < 1950 ||
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      setValidationError('Įsigijimo data yra neteisinga.');
      return;
    }
    if (acqDate > todayStr) {
      setValidationError('Įsigijimo data negali būti ateityje.');
      return;
    }

    // Validate purchasePrice and residualValue
    const rawPrice = Number(formData.purchasePrice);
    if (!Number.isFinite(rawPrice) || rawPrice < 0) {
      setValidationError('Įsigijimo kaina negali būti neigiama.');
      return;
    }
    let parsedResidual: number | undefined;
    if (residualInput.trim() !== '') {
      const rVal = Number(residualInput);
      if (!Number.isFinite(rVal) || rVal < 0) {
        setValidationError('Likutinė vertė negali būti neigiama.');
        return;
      }
      if (rVal > rawPrice) {
        setValidationError(
          `Likutinė vertė (${rVal.toFixed(2)} €) negali viršyti įsigijimo kainos (${rawPrice.toFixed(2)} €).`
        );
        return;
      }
      parsedResidual = rVal;
    }

    // Validate status does not bypass write-off / restore procedures
    const targetStatus: ItemStatus = isStatusLockedByWorkflow
      ? editingItem!.status
      : ((formData.status as ItemStatus) || 'active');
    if (!isStatusLockedByWorkflow && (targetStatus === 'to_writeoff' || targetStatus === 'written_off')) {
      setValidationError(
        'Būsenos „Teikiamas nurašyti“ ir „Nurašytas“ nustatomos tik per oficialią nurašymo procedūrą.'
      );
      return;
    }

    const computedClass: AssetClass =
      formData.assetClass || (rawPrice >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term');

    const hasSpecs = Boolean(
      specs.computerType ||
        specs.cpu?.trim() ||
        specs.ramGb ||
        specs.storage?.trim() ||
        specs.os?.trim() ||
        specs.screenSize?.trim() ||
        specs.gpu?.trim() ||
        specs.macAddress?.trim()
    );

    const itemToSave: InventoryItem = {
      ...(editingItem || {}),
      id: editingItem?.id || `item-${Date.now()}`,
      inventoryNumber: formData.inventoryNumber.trim().toUpperCase(),
      serialNumber: formData.serialNumber?.trim() || undefined,
      name: formData.name.trim(),
      category: (formData.category as ItemCategory) || 'Kita',
      departmentId: selectedDept.id,
      roomId: selectedRoom.id,
      responsibleUserId: formData.responsibleUserId,
      acquisitionDate: acqDate,
      purchasePrice: rawPrice,
      residualValue: parsedResidual,
      assetClass: computedClass,
      fundingSource: (formData.fundingSource as FundingSource) || 'school',
      status: targetStatus,
      condition: (formData.condition as ItemCondition) || 'good',
      notes: formData.notes?.trim() || undefined,
      photoUrl: formData.photoUrl || undefined,
      lastAuditDate: editingItem?.lastAuditDate,
      specs: hasSpecs
        ? {
            computerType: specs.computerType,
            cpu: specs.cpu?.trim() || undefined,
            ramGb: specs.ramGb ? Number(specs.ramGb) : undefined,
            storage: specs.storage?.trim() || undefined,
            os: specs.os?.trim() || undefined,
            screenSize: specs.screenSize?.trim() || undefined,
            gpu: specs.gpu?.trim() || undefined,
            macAddress: specs.macAddress?.trim() || undefined,
          }
        : undefined,
    };

    onSave(itemToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-hidden">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-300">
        {/* Sticky/Pinned Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0 bg-slate-50/60">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {editingItem ? 'Redaguoti materialųjį turtą' : 'Registruoti naują materialųjį turtą'}
            </h3>
            <p className="text-[11px] text-slate-600 font-medium">
              Telšių raj. Tryškių Lazdynų Pelėdos gimnazija
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer transition-colors"
            title="Uždaryti"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Container with Flex Column & Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Scrollable Form Body */}
          <div
            ref={scrollBodyRef}
            className="overflow-y-auto px-6 py-4 space-y-4 text-xs flex-1 overscroll-contain"
          >
            {validationError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Inventory Number & Serial */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Inventorinis numeris *
              </label>
              <input
                type="text"
                required
                value={formData.inventoryNumber}
                onChange={(e) => setFormData({ ...formData, inventoryNumber: e.target.value })}
                className="w-full font-mono uppercase bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-blue-500 font-semibold"
                placeholder="pvz., TM-2026-0045"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Gamintojo serijos numeris (S/N)
              </label>
              <input
                type="text"
                value={formData.serialNumber || ''}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                className="w-full font-mono bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
                placeholder="pvz., SN-8849204"
              />
            </div>
          </div>

          {/* Name & Category */}
          <div className="space-y-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Turto pavadinimas, markė ir modelis *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-medium"
                placeholder="pvz., Interaktyvus ekranas Promethean ActivPanel 75"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Kategorija *
              </label>
              <select
                value={formData.category}
                onChange={(e) => {
                  const newCat = e.target.value as ItemCategory;
                  setFormData({ ...formData, category: newCat });
                  if (newCat === 'Kompiuteriai') {
                    setShowSpecsSection(true);
                  }
                }}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Computer Hardware Specifications Block (Only for Kompiuteriai or existing specs) */}
          {(formData.category === 'Kompiuteriai' || Object.values(specs).some(v => v !== undefined && v !== '')) && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
              <div 
                onClick={() => setShowSpecsSection(!showSpecsSection)}
                className="flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-slate-800">
                    Kompiuterinės įrangos specifikacija
                  </span>
                  {specs.computerType && (
                    <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded">
                      {COMPUTER_TYPE_LABELS[specs.computerType]}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <span>{showSpecsSection ? 'Suskleisti' : 'Išskleisti'}</span>
                  {showSpecsSection ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </div>

              {showSpecsSection && (
                <div className="space-y-3 pt-1 border-t border-slate-200">
                  {/* Computer Type Selector */}
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Įrenginio tipas
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {[
                        { id: 'laptop', label: 'Nešiojamas', icon: Laptop },
                        { id: 'desktop', label: 'Stacionarus', icon: Monitor },
                        { id: 'server', label: 'Serveris', icon: Server },
                        { id: 'tablet', label: 'Planšetė', icon: Tablet },
                      ].map((type) => {
                        const Icon = type.icon;
                        const isSelected = specs.computerType === type.id;
                        return (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => setSpecs(prev => ({ 
                              ...prev, 
                              computerType: prev.computerType === type.id ? undefined : (type.id as ComputerType) 
                            }))}
                            className={`flex flex-col items-center justify-center p-2 rounded border text-center transition-all cursor-pointer ${
                              isSelected 
                                ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold shadow-2xs' 
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Icon className={`w-4 h-4 mb-1 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                            <span className="text-[11px] leading-tight">{type.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* CPU & RAM */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Procesorius (CPU)
                      </label>
                      <input
                        type="text"
                        value={specs.cpu || ''}
                        onChange={(e) => setSpecs({ ...specs, cpu: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                        placeholder="pvz., Intel Core i5-1135G7"
                      />
                      <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                        {['Intel Core i5', 'Intel Core i7', 'AMD Ryzen 5', 'Apple A13/M2', 'Xeon'].map(quickCpu => (
                          <button
                            key={quickCpu}
                            type="button"
                            onClick={() => setSpecs(prev => ({ ...prev, cpu: quickCpu }))}
                            className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded cursor-pointer transition-colors"
                          >
                            {quickCpu}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Operatyvioji atmintis (RAM, GB)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="512"
                        value={specs.ramGb || ''}
                        onChange={(e) => setSpecs({ ...specs, ramGb: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                        placeholder="pvz., 16"
                      />
                      <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                        {[4, 8, 16, 32, 64].map(gb => (
                          <button
                            key={gb}
                            type="button"
                            onClick={() => setSpecs(prev => ({ ...prev, ramGb: gb }))}
                            className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                              specs.ramGb === gb 
                                ? 'bg-blue-600 text-white font-bold' 
                                : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                            }`}
                          >
                            {gb} GB
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Storage & OS */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Disko vieta / Talpa (Storage)
                      </label>
                      <input
                        type="text"
                        value={specs.storage || ''}
                        onChange={(e) => setSpecs({ ...specs, storage: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                        placeholder="pvz., 512 GB NVMe SSD"
                      />
                      <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                        {['256 GB SSD', '512 GB SSD', '1 TB SSD', '1 TB HDD'].map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setSpecs(prev => ({ ...prev, storage: opt }))}
                            className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded cursor-pointer transition-colors"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Operacinė sistema (OS)
                      </label>
                      <input
                        type="text"
                        value={specs.os || ''}
                        onChange={(e) => setSpecs({ ...specs, os: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 text-xs"
                        placeholder="pvz., Windows 11 Pro"
                      />
                      <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                        {['Windows 11 Pro', 'Windows 10 Pro', 'ChromeOS', 'Ubuntu Linux', 'iPadOS', 'Android'].map(osOption => (
                          <button
                            key={osOption}
                            type="button"
                            onClick={() => setSpecs(prev => ({ ...prev, os: osOption }))}
                            className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                              specs.os === osOption 
                                ? 'bg-blue-600 text-white font-bold' 
                                : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                            }`}
                          >
                            {osOption}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Screen Size & GPU & MAC */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Ekrano įstrižainė
                      </label>
                      <input
                        type="text"
                        value={specs.screenSize || ''}
                        onChange={(e) => setSpecs({ ...specs, screenSize: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 text-xs"
                        placeholder="pvz., 14.0&quot; / 15.6&quot;"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        Vaizdo plokštė (GPU)
                      </label>
                      <input
                        type="text"
                        value={specs.gpu || ''}
                        onChange={(e) => setSpecs({ ...specs, gpu: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 text-xs"
                        placeholder="pvz., Intel Iris Xe"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        MAC adresas
                      </label>
                      <input
                        type="text"
                        value={specs.macAddress || ''}
                        onChange={(e) => setSpecs({ ...specs, macAddress: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                        placeholder="00:1A:2B:3C:4D:5E"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Location: Department & Room */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Skyrius *
              </label>
              <select
                value={formData.departmentId}
                onChange={(e) => {
                  const newDeptId = e.target.value;
                  const firstRoomInDept = rooms.find(
                    (r) => !r.isArchived && r.departmentId === newDeptId
                  );
                  setFormData({
                    ...formData,
                    departmentId: newDeptId,
                    roomId: firstRoomInDept?.id || '',
                  });
                }}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
              >
                {selectableDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.isArchived ? ' (Archyvuotas)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Kabinetas / Patalpa *
              </label>
              <select
                value={formData.roomId}
                disabled={availableRooms.length === 0}
                onChange={(e) => {
                  const rId = e.target.value;
                  const foundRoom = rooms.find((r) => r.id === rId);
                  setFormData({
                    ...formData,
                    roomId: rId,
                    responsibleUserId:
                      !editingItem && foundRoom?.defaultResponsiblePersonId
                        ? foundRoom.defaultResponsiblePersonId
                        : formData.responsibleUserId,
                  });
                }}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              >
                {availableRooms.length === 0 ? (
                  <option value="">Šiame skyriuje nėra kabinetų</option>
                ) : (
                  availableRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatRoomName(r)}{r.isArchived ? ' (Archyvuotas)' : ''}
                    </option>
                  ))
                )}
              </select>
              {availableRooms.length === 0 && (
                <p className="text-[10px] text-amber-700 mt-1">
                  Pasirinktame skyriuje nėra aktyvių kabinetų. Sukurkite kabinetą skyrių valdyme.
                </p>
              )}
            </div>
          </div>

          {/* Responsible Person */}
          <div>
            <label className="block text-slate-700 font-medium mb-1">
              Materialiai atsakingas asmuo *
            </label>
            <select
              value={formData.responsibleUserId}
              onChange={(e) => setFormData({ ...formData, responsibleUserId: e.target.value })}
              className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              {selectableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.roleTitle}){u.isArchived ? ' [Archyvuotas]' : ''}
                </option>
              ))}
            </select>
            {locationOrOwnerChanged && (
              <p className="text-[10px] text-blue-700 mt-1 font-medium">
                Pakeitus skyrių, kabinetą arba atsakingą asmenį, sistemoje bus automatiškai sukurtas įrašas judėjimo istorijoje.
              </p>
            )}
          </div>

          {/* Dates & Prices */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Įsigijimo data *
              </label>
              <input
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                value={formData.acquisitionDate}
                onChange={(e) => setFormData({ ...formData, acquisitionDate: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Įsigijimo kaina (€) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={formData.purchasePrice ?? ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  if (!editingItem) {
                    const autoClass: AssetClass =
                      val >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term';
                    setFormData({
                      ...formData,
                      purchasePrice: val,
                      assetClass: autoClass,
                    });
                  } else {
                    setFormData({
                      ...formData,
                      purchasePrice: val,
                    });
                  }
                }}
                className="w-full font-mono bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 text-right font-medium"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Likutinė vertė (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={Number(formData.purchasePrice) >= 0 ? Number(formData.purchasePrice) : undefined}
                value={residualInput}
                onChange={(e) => setResidualInput(e.target.value)}
                placeholder="Neprivaloma"
                className="w-full font-mono bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 text-right font-medium"
              />
            </div>
          </div>

          {/* Asset Classification & Origin (Public Sector / VSAKIS standards) */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-lg p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Asset Class (IMT vs TMT) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-800 font-semibold text-xs">
                    Turto grupė (Apskaita) *
                  </label>
                  <span className="text-[10px] text-blue-700 font-medium">
                    Riba: 750,00 €
                  </span>
                </div>
                <select
                  value={formData.assetClass || ((Number(formData.purchasePrice) >= LONG_TERM_THRESHOLD) ? 'long_term' : 'short_term')}
                  onChange={(e) => setFormData({ ...formData, assetClass: e.target.value as AssetClass })}
                  className="w-full bg-white border border-blue-300 rounded px-2.5 py-1.5 font-medium text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="long_term">Ilgalaikis turtas (IMT, ≥ 750 €)</option>
                  <option value="short_term">Trumpalaikis / Mažavertis (&lt; 750 €)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {(Number(formData.purchasePrice) >= LONG_TERM_THRESHOLD) 
                    ? 'Automatiškai priskirta prie Ilgalaikio materialiojo turto (kaina ≥ 750 €)'
                    : 'Automatiškai priskirta prie Trumpalaikio / mažaverčio inventoriaus (kaina < 750 €)'}
                </p>
              </div>

              {/* Funding Origin (School, Municipality, Ministry, Projects) */}
              <div>
                <label className="block text-slate-800 font-semibold mb-1 text-xs">
                  Turto kilmė / Panauda *
                </label>
                <select
                  value={formData.fundingSource || 'school'}
                  onChange={(e) => setFormData({ ...formData, fundingSource: e.target.value as FundingSource })}
                  className="w-full bg-white border border-blue-300 rounded px-2.5 py-1.5 font-medium text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="school">Gimnazijos lėšos (Mokyklos biudžetas)</option>
                  <option value="municipality">Savivaldybės panauda (Telšių r. sav.)</option>
                  <option value="ministry">ŠMSM panauda (Ministerijos tiekimas)</option>
                  <option value="project">ES / Valstybiniai projektai (STEAM, TŪM)</option>
                  <option value="donation">Kita (dovana, rėmėjai ir kt.)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Nurodo, ar turtas įsigytas mokyklos, ar perduotas pagal panaudos sutartį
                </p>
              </div>
            </div>
          </div>

          {/* Status and Condition */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Būsena</label>
              <select
                value={formData.status}
                disabled={isStatusLockedByWorkflow}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as ItemStatus })}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-600"
              >
                <option value="active">Veikiantis / Naudojamas</option>
                <option value="in_repair">Remontuojamas</option>
                {editingItem?.status === 'to_writeoff' && (
                  <option value="to_writeoff">Teikiamas nurašyti (komisijos procedūra)</option>
                )}
                {editingItem?.status === 'written_off' && (
                  <option value="written_off">Nurašytas (archyve)</option>
                )}
              </select>
              {isStatusLockedByWorkflow && (
                <p className="text-[10px] text-amber-700 mt-1">
                  {editingItem?.status === 'written_off'
                    ? 'Nurašytas turtas atkuriamas tik per „Atkurti iš archyvo“ veiksmą.'
                    : 'Ši būsena keičiama tik patvirtinus arba atmetus nurašymą.'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Būklė</label>
              <select
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value as ItemCondition })}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
              >
                <option value="new">Nauja</option>
                <option value="good">Gera</option>
                <option value="fair">Patenkinama</option>
                <option value="poor">Prasta / Defektuota</option>
              </select>
            </div>
          </div>

          {/* Photo Capture Section (Smartphone camera & upload) */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-slate-800 font-semibold flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-blue-600" />
                <span>Inventoriaus nuotrauka (telefonu arba iš kompiuterio)</span>
              </label>
              {isCompressing && (
                <div className="flex items-center gap-1 text-[11px] text-blue-600 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Optimizuojama...</span>
                </div>
              )}
            </div>

            {/* Hidden file inputs */}
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

            {formData.photoUrl ? (
              <div className="flex items-center gap-3 bg-white p-2.5 rounded border border-slate-200">
                <div className="w-16 h-16 rounded overflow-hidden border border-slate-200 shrink-0 bg-slate-100">
                  <img
                    src={formData.photoUrl}
                    alt="Inventoriaus nuotrauka"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-slate-800 font-medium truncate">
                    Nuotrauka prisegta
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Suglaudinta į lengvą formatą greitam užkrovimui
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    title="Perfografuoti"
                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    title="Pašalinti nuotrauką"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded font-medium cursor-pointer transition-colors"
                >
                  <Camera className="w-3.5 h-3.5 text-blue-600" />
                  <span>Nufotografuoti telefonu</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded font-medium cursor-pointer transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>Pasirinkti iš galerijos</span>
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-700 font-medium mb-1">Papildomos pastabos</label>
            <textarea
              rows={2}
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500"
              placeholder="Komplektacija, garantijos sąlygos, gedimų požymiai..."
            />
          </div>
        </div>

        {/* Sticky/Pinned Footer Actions */}
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-slate-100/80 shrink-0">
            <span className="text-[11px] text-slate-600 font-semibold">
              * Privalomi laukai
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                {editingItem ? 'Išsaugoti pakeitimus' : 'Užregistruoti turtą'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
