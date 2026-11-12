import React, { useState, useRef } from 'react';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  ShieldAlert, 
  Mail, 
  Lock, 
  KeyRound, 
  Search, 
  Check, 
  Plus, 
  Trash2, 
  Edit3, 
  LogIn, 
  CheckCircle2, 
  AlertTriangle,
  Building2,
  Smartphone,
  Save,
  Info,
  Upload,
  FileSpreadsheet,
  Play,
  X,
  Download,
  DoorClosed
} from 'lucide-react';
import { User, UserRole, Department, Room, AuthSettings, formatRoomName, getUserAssignedRoomIds } from '../types/inventory';

interface UsersManagementViewProps {
  users: User[];
  departments: Department[];
  rooms: Room[];
  currentUser: User;
  authSettings: AuthSettings;
  onSaveUser: (user: User) => void;
  onDeleteUser: (userId: string) => void;
  onUpdateAuthSettings: (settings: AuthSettings) => void;
  onSwitchUser: (userId: string) => void;
  onOpenCreateUser: () => void;
  onOpenEditUser: (user: User) => void;
  onBatchImportUsers?: (users: User[]) => void;
}

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({
  users,
  departments,
  rooms,
  currentUser,
  authSettings,
  onSaveUser,
  onDeleteUser,
  onUpdateAuthSettings,
  onSwitchUser,
  onOpenCreateUser,
  onOpenEditUser,
  onBatchImportUsers,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  // CSV Import Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In-app Delete Confirmation Modal state (prevents iframe alert/confirm issues)
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [actionFeedbackMsg, setActionFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtered users
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchName = u.fullName.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      const matchGmail = u.allowedGmail?.toLowerCase().includes(q) ?? false;
      const matchTitle = u.roleTitle.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchGmail && !matchTitle) return false;
    }
    return true;
  });

  const handleToggleUserActive = (user: User) => {
    if (user.id === currentUser.id) {
      setActionFeedbackMsg({
        type: 'error',
        text: 'Negalite deaktyvuoti šiuo metu prisijungusios administratoriaus paskyros.',
      });
      setTimeout(() => setActionFeedbackMsg(null), 3500);
      return;
    }
    onSaveUser({
      ...user,
      isActive: !user.isActive,
    });
    setActionFeedbackMsg({
      type: 'success',
      text: user.isActive 
        ? `Naudotojo „${user.fullName}“ prieiga sėkmingai apribota (užblokuota).` 
        : `Naudotojo „${user.fullName}“ paskyra aktyvuota.`,
    });
    setTimeout(() => setActionFeedbackMsg(null), 3000);
  };

  // CSV Sample Template Download
  const handleDownloadSampleCsv = () => {
    const sample = `Vardas Pavardė;El. paštas;Pareigos;Rolė;Kabineto numeris
Rasa Jonaitienė;rasa.j@tryskiumokykla.lt;Lietuvių k. vyresnioji mokytoja;teacher;101
Petras Kazlauskas;petras.k@tryskiumokykla.lt;Fizikos mokytojas;teacher;105
Jurgita Meškytė;jurgita.m@tryskiumokykla.lt;Biologijos mokytoja;teacher;102
Tomas Daukantas;tomas.d@tryskiumokykla.lt;Fizinio ugdymo mokytojas;teacher;S-01`;
    const blob = new Blob(['\uFEFF' + sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mokytoju_importo_pavyzdys.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // CSV File Upload Reader
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Parse & Batch Import CSV
  const handleParseAndImportCsv = () => {
    setImportError(null);
    if (!csvText.trim()) {
      setImportError('Įveskite arba įkelkite CSV duomenis.');
      return;
    }

    const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setImportError('Faile turi būti bent antraštė ir bent vienas darbuotojas.');
      return;
    }

    const delimiter = lines[0].includes(';') ? ';' : ',';
    const importedUsers: User[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length < 2) continue;

      const [rawName, rawEmail, rawTitle, rawRole, rawRoom] = cols;
      if (!rawName || !rawEmail || !rawEmail.includes('@')) continue;

      const email = rawEmail.toLowerCase();
      const role: UserRole =
        rawRole === 'admin' || rawRole === 'manager' || rawRole === 'auditor' ? rawRole : 'teacher';

      // Find room by number
      let roomId: string | undefined;
      let deptId: string | undefined = departments[0]?.id;
      if (rawRoom) {
        const found = rooms.find(
          (r) =>
            (r.number && r.number.toLowerCase() === rawRoom.toLowerCase()) ||
            r.name.toLowerCase().includes(rawRoom.toLowerCase())
        );
        if (found) {
          roomId = found.id;
          deptId = found.departmentId;
        }
      }

      // Check if user with email already exists to preserve ID or create new
      const existing = users.find((u) => u.email.toLowerCase() === email);

      const userObj: User = {
        id: existing ? existing.id : `usr-${Date.now().toString(36)}-${i}`,
        fullName: rawName,
        email,
        role,
        roleTitle: rawTitle || 'Mokytojas',
        departmentId: deptId,
        assignedRoomId: roomId,
        isActive: true,
        pinCode: existing?.pinCode || Math.floor(1000 + Math.random() * 9000).toString(),
      };
      importedUsers.push(userObj);
    }

    if (importedUsers.length === 0) {
      setImportError(
        'Nepavyko atpažinti nė vieno darbuotojo. Patikrinkite stulpelius: Vardas; El. paštas; Pareigos; Rolė; Kabinetas'
      );
      return;
    }

    if (onBatchImportUsers) {
      onBatchImportUsers(importedUsers);
    } else {
      importedUsers.forEach((u) => onSaveUser(u));
    }

    setImportSuccessMsg(`Sėkmingai importuota ${importedUsers.length} darbuotojų!`);
    setTimeout(() => {
      setIsImportModalOpen(false);
      setImportSuccessMsg(null);
      setCsvText('');
    }, 1200);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Administratorius</span>;
      case 'manager':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Ūkio vedėjas / IT</span>;
      case 'teacher':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">Mokytojas / Atsakingas</span>;
      case 'auditor':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">Auditorius / Buhalteris</span>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {actionFeedbackMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 shadow-xs animate-fade-in ${
            actionFeedbackMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          {actionFeedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{actionFeedbackMsg.text}</span>
        </div>
      )}

      {/* Top Banner & Stats */}
      <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Naudotojų valdymas ir prisijungimo teisės</h1>
              <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">
                {users.length} naudotojai
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Telšių raj. Tryškių Lazdynų Pelėdos gimnazijos darbuotojų paskyros, vaidmenys ir Google / Gmail prieigos kontrolė.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Importuoti mokytojus (CSV)</span>
            </button>
            <button
              onClick={onOpenCreateUser}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Naujas naudotojas</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Administratoriai</span>
            <span className="text-lg font-bold text-slate-900 font-mono mt-0.5 block">
              {users.filter(u => u.role === 'admin').length}
            </span>
            <span className="text-[10px] text-slate-400">Pilna prieiga prie nustatymų</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Ūkio vedėjai / IT</span>
            <span className="text-lg font-bold text-emerald-700 font-mono mt-0.5 block">
              {users.filter(u => u.role === 'manager').length}
            </span>
            <span className="text-[10px] text-slate-400">Turto registracija ir etiketės</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Mokytojai / Skyriai</span>
            <span className="text-lg font-bold text-sky-700 font-mono mt-0.5 block">
              {users.filter(u => u.role === 'teacher').length}
            </span>
            <span className="text-[10px] text-slate-400">Atsakingi asmenys kabinetuose</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Aktyvios paskyros</span>
            <span className="text-lg font-bold text-indigo-700 font-mono mt-0.5 block">
              {users.filter(u => u.isActive !== false).length}
            </span>
            <span className="text-[10px] text-slate-400">Iš viso registruota: {users.length}</span>
          </div>
        </div>
      </div>

      {/* Users Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        {/* Table Controls */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ieškoti pagal vardą, pareigas ar el. paštą..."
                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as any)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium"
            >
              <option value="all">Visi vaidmenys</option>
              <option value="admin">Administratoriai</option>
              <option value="manager">Ūkio vedėjai / IT</option>
              <option value="teacher">Mokytojai / Atsakingi</option>
              <option value="auditor">Auditoriai</option>
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Rodoma <strong>{filteredUsers.length}</strong> iš {users.length} naudotojų
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium select-none">
                <th className="py-2.5 px-3">Darbuotojas / Vardas</th>
                <th className="py-2.5 px-3">Vaidmuo (Rolė)</th>
                <th className="py-2.5 px-3">Darbinis el. paštas</th>
                <th className="py-2.5 px-3">Leidžiamas Gmail</th>
                <th className="py-2.5 px-3">Skyrius / Kabinetas</th>
                <th className="py-2.5 px-3">PIN</th>
                <th className="py-2.5 px-3">Būsena</th>
                <th className="py-2.5 px-3 text-right">Veiksmai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => {
                const isCurrent = u.id === currentUser.id;
                const dept = departments.find((d) => d.id === u.departmentId);
                const isActive = u.isActive !== false;

                return (
                  <tr
                    key={u.id}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      isCurrent ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    {/* User info */}
                    <td 
                      onClick={() => onOpenEditUser(u)}
                      className="py-2.5 px-3 whitespace-nowrap cursor-pointer group"
                      title="Spustelėkite, norėdami redaguoti šį darbuotoją"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs uppercase shrink-0 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                          {u.fullName.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 group-hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                            <span>{u.fullName}</span>
                            {isCurrent && (
                              <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.2 rounded font-semibold">
                                Jūs
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{u.roleTitle}</div>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {getRoleBadge(u.role)}
                    </td>

                    {/* School Email */}
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-700">
                      {u.email}
                    </td>

                    {/* Allowed Gmail */}
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                      {u.allowedGmail ? (
                        <span className="text-indigo-700 font-medium">{u.allowedGmail}</span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Pagal darbinį paštą</span>
                      )}
                    </td>

                    {/* Department & Rooms */}
                    <td className="py-2.5 px-3">
                      {(() => {
                        const userRoomIds = getUserAssignedRoomIds(u);
                        const assignedRooms = rooms.filter(r => userRoomIds.includes(r.id));

                        if (assignedRooms.length === 0) {
                          return (
                            <div className="text-slate-600 font-medium text-xs">
                              {dept ? dept.name : '—'}
                              <div className="text-[10px] text-slate-400">Bendra atsakomybė</div>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1">
                              {assignedRooms.map(r => (
                                <span 
                                  key={r.id}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-900 border border-blue-200"
                                >
                                  <DoorClosed className="w-3 h-3 text-blue-600 shrink-0" />
                                  <span>{formatRoomName(r)}</span>
                                </span>
                              ))}
                            </div>
                            {dept && (
                              <div className="text-[10px] text-slate-400">{dept.name}</div>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* PIN */}
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-600 font-semibold">
                      {u.pinCode || '—'}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Aktyvus
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          Blokuotas
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {!isCurrent && (
                          <button
                            onClick={() => onSwitchUser(u.id)}
                            title="Išbandyti sistemą šio mokytojo akimis"
                            className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 border border-slate-200 rounded cursor-pointer transition-colors shadow-2xs"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => onOpenEditUser(u)}
                          title="Redaguoti darbuotojo duomenis, kabinetą ir teises"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-slate-800 bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-300 rounded-md transition-colors shadow-2xs cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                          <span>Redaguoti</span>
                        </button>

                        {!isCurrent && (
                          <>
                            <button
                              onClick={() => handleToggleUserActive(u)}
                              title={isActive ? 'Deaktyvuoti prieigą (užblokuoti)' : 'Aktyvuoti prieigą'}
                              className={`p-1.5 border rounded cursor-pointer transition-colors shadow-2xs ${
                                isActive 
                                  ? 'text-slate-500 hover:text-rose-600 border-slate-200 hover:bg-rose-50' 
                                  : 'text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                              }`}
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setUserToDelete(u)}
                              title="Pašalinti darbuotoją iš sistemos"
                              className="p-1.5 text-slate-500 hover:text-rose-600 border border-slate-300 hover:bg-rose-50 hover:border-rose-300 rounded cursor-pointer transition-colors shadow-2xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch CSV Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-slate-300 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">Masinis darbuotojų importas iš CSV</h3>
                  <p className="text-[11px] text-slate-400">
                    Greitas mokytojų ir kabinetų sąrašo suvedimas vienu failu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto text-xs flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 p-3.5 rounded-lg">
                <div>
                  <span className="font-bold text-slate-800 block">Neturite paruošto CSV failo?</span>
                  <span className="text-[11px] text-slate-500 block">
                    Atsisiųskite pavyzdį, užpildykite Excel programoje ir išsaugokite kaip CSV.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSampleCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded font-semibold text-xs shadow-2xs cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Atsisiųsti CSV pavyzdį</span>
                </button>
              </div>

              {/* Upload file or paste text */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800">
                    Įklijuokite CSV tekstą arba pasirinkite failą:
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Pasirinkti .csv failą iš kompiuterio</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                </div>

                <textarea
                  rows={8}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={`Vardas Pavardė;El. paštas;Pareigos;Rolė;Kabineto numeris\nRasa Jonaitienė;rasa.j@tryskiumokykla.lt;Lietuvių k. vyresnioji mokytoja;teacher;101\nPetras Kazlauskas;petras.k@tryskiumokykla.lt;Fizikos mokytojas;teacher;105`}
                  className="w-full bg-slate-50 font-mono text-xs border border-slate-300 rounded-lg p-3 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {importError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-medium">
                  {importError}
                </div>
              )}

              {importSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{importSuccessMsg}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="button"
                onClick={handleParseAndImportCsv}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                Importuoti darbuotojus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User In-App Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-300 overflow-hidden flex flex-col">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Pašalinti naudotoją iš sistemos</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Veiksmas negrįžtamas</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-900">{userToDelete.fullName}</div>
                <div className="text-slate-600 font-mono">{userToDelete.email}</div>
                <div className="text-slate-500">{userToDelete.roleTitle}</div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                Ar tikrai norite pašalinti darbuotoją <strong>„{userToDelete.fullName}“</strong> iš gimnazijos darbuotojų sąrašo?
              </p>
            </div>

            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
              >
                Atšaukti
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteUser(userToDelete.id);
                  const deletedName = userToDelete.fullName;
                  setUserToDelete(null);
                  setActionFeedbackMsg({
                    type: 'success',
                    text: `Naudotojas „${deletedName}“ sėkmingai pašalintas iš sistemos.`,
                  });
                  setTimeout(() => setActionFeedbackMsg(null), 3000);
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shadow-xs cursor-pointer transition-colors"
              >
                Taip, pašalinti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
