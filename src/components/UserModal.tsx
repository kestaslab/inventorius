import React, { useState, useEffect } from 'react';
import { X, UserPlus, Shield, Mail, Phone, Lock, Building2, CheckCircle2, AlertCircle } from 'lucide-react';
import { User, UserRole, Department, Room } from '../types/inventory';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  editingUser?: User | null;
  departments: Department[];
  rooms?: Room[];
  schoolDomain: string;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingUser,
  departments,
  rooms = [],
  schoolDomain,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [allowedGmail, setAllowedGmail] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [roleTitle, setRoleTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [assignedRoomId, setAssignedRoomId] = useState('');
  const [phone, setPhone] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingUser) {
      setFullName(editingUser.fullName);
      setEmail(editingUser.email);
      setAllowedGmail(editingUser.allowedGmail || '');
      setRole(editingUser.role);
      setRoleTitle(editingUser.roleTitle);
      setDepartmentId(editingUser.departmentId || (departments[0]?.id || ''));
      setAssignedRoomId(editingUser.assignedRoomId || '');
      setPhone(editingUser.phone || '');
      setPinCode(editingUser.pinCode || '');
      setIsActive(editingUser.isActive !== false);
    } else {
      setFullName('');
      setEmail('');
      setAllowedGmail('');
      setRole('teacher');
      setRoleTitle('');
      setDepartmentId(departments[0]?.id || '');
      setAssignedRoomId('');
      setPhone('');
      setPinCode(Math.floor(1000 + Math.random() * 9000).toString()); // auto random 4-digit PIN
      setIsActive(true);
    }
    setError(null);
  }, [editingUser, isOpen, departments]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Įveskite naudotojo vardą ir pavardę');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Nurodykite teisingą el. pašto adresą');
      return;
    }
    if (allowedGmail.trim() && !allowedGmail.includes('@')) {
      setError('Papildomas Gmail adresas turi būti teisingas');
      return;
    }
    if (!roleTitle.trim()) {
      setError('Nurodykite pareigų pavadinimą (pvz. IT mokytojas)');
      return;
    }

    const savedUser: User = {
      id: editingUser ? editingUser.id : `usr-${Date.now().toString(36)}`,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      allowedGmail: allowedGmail.trim() ? allowedGmail.trim().toLowerCase() : undefined,
      role,
      roleTitle: roleTitle.trim(),
      departmentId: departmentId || undefined,
      assignedRoomId: assignedRoomId || undefined,
      phone: phone.trim() || undefined,
      pinCode: pinCode.trim() || undefined,
      isActive,
      lastLoginAt: editingUser?.lastLoginAt,
    };

    onSave(savedUser);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 overflow-hidden animate-fade-in backdrop-blur-2xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">
                {editingUser ? 'Redaguoti naudotojo paskyrą' : 'Naujo naudotojo kūrimas'}
              </h2>
              <p className="text-[11px] text-slate-300">
                Prieigos teisės ir Gmail / domeno prisijungimo leidimai
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form with Flex Column & Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="overflow-y-auto p-6 space-y-4 flex-1 overscroll-contain">
            {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Full Name */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Vardas ir Pavardė <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Pvz. Petras Jonaitis"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* School Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Darbinis el. paštas <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`vardas@${schoolDomain}`}
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Naudojamas oficialiuose aktuose ir ataskaitose
              </span>
            </div>

            {/* Allowed Gmail for Google Login */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Leidžiamas Gmail (Google)
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-blue-500 absolute left-2.5 top-2.5" />
                <input
                  type="email"
                  value={allowedGmail}
                  onChange={(e) => setAllowedGmail(e.target.value)}
                  placeholder="pvz. jonas@gmail.com"
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Jei naudotojas nori jungtis su asmeniniu Gmail
              </span>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sistemos vaidmuo (Rolė) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Shield className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium cursor-pointer"
                >
                  <option value="teacher">Mokytojas / Atsakingas asmuo</option>
                  <option value="manager">Ūkio vedėjas / IT administratorius</option>
                  <option value="admin">Sistemos Administratorius</option>
                  <option value="auditor">Auditorius / Buhalteris</option>
                </select>
              </div>
            </div>

            {/* Role Title in School */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pareigų pavadinimas <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Pvz. IT ir robotikos mokytojas"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Department */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pagrindinis skyrius / Korpusas
              </label>
              <div className="relative">
                <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <select
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    setAssignedRoomId('');
                  }}
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
                >
                  <option value="">Nenurodyta</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Assigned Room */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Priskirtas kabinetas / Patalpa
              </label>
              <select
                value={assignedRoomId}
                onChange={(e) => setAssignedRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer font-medium"
              >
                <option value="">Nėra konkretaus kabineto (Bendra atsakomybė)</option>
                {rooms
                  .filter((r) => !departmentId || r.departmentId === departmentId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.number} {r.name}
                    </option>
                  ))}
              </select>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Mokytojas šį kabinetą matys kaip savo pagrindinę darbo vietą
              </span>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefono numeris
              </label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+370 600 00000"
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>

            {/* Quick PIN Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                PIN kodas (4 skaitmenys)
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  placeholder="1234"
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Greitam prisijungimui planšetėse ar telefonu
              </span>
            </div>

            {/* Active Status Toggle */}
            <div className="flex items-center pt-5">
              <label className="relative flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Paskyra aktyvi
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Leisti jungtis prie inventoriaus
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Role permissions summary info box */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-blue-600" />
              <span>Rolės teisės sistemoje:</span>
            </div>
            {role === 'admin' && (
              <p>Pilnos teisės: vartotojų kūrimas, Gmail baltojo sąrašo valdymas, duomenų bazės atkūrimas, turto redagavimas ir trynimas.</p>
            )}
            {role === 'manager' && (
              <p>Ūkio vedėjas / IT: turto registravimas, perkėlimai, nurašymo aktai, etikečių ir QR spausdinimas.</p>
            )}
            {role === 'teacher' && (
              <p>Mokytojas: mato tik sau priskirtą turtą ir kabinetus, gali prašyti perkėlimo ar pranešti apie gedimą.</p>
            )}
            {role === 'auditor' && (
              <p>Auditorius: mato visas ataskaitas ir inventorizacijos eigą, patvirtina metinius apyrašus, negali trinti turto.</p>
            )}
          </div>
        </div>

        {/* Form Actions (Pinned Footer) */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-slate-100 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Atšaukti
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{editingUser ? 'Išsaugoti pakeitimus' : 'Sukurti naudotoją'}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
  );
};
