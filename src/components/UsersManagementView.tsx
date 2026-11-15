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
  DoorClosed,
  Archive,
  RotateCcw,
  ArrowRightLeft
} from 'lucide-react';
import {
  User,
  UserRole,
  Department,
  Room,
  InventoryItem,
  AuditSession,
  AuthSettings,
  formatRoomName,
  getUserAssignedRoomIds
} from '../types/inventory';
import { buildCsvContent } from '../utils/csvUtils';
import {
  CsvImportAnalysis,
  UserImportResolutionSelection,
  analyzeUsersCsvImport,
  buildFinalBatchUsersFromPreview,
} from '../utils/userCsvImport';

interface UsersManagementViewProps {
  users: User[];
  departments: Department[];
  rooms: Room[];
  items: InventoryItem[];
  auditSessions: AuditSession[];
  currentUser: User;
  authSettings: AuthSettings;
  onSaveUser: (user: User) => void;
  onDeleteUser: (userId: string) => void;
  onTransferAndDeleteUser: (userId: string, targetUserId: string) => void;
  onArchiveUser: (userId: string, isArchived: boolean) => void;
  onUpdateAuthSettings: (settings: AuthSettings) => void;
  onSwitchUser: (userId: string) => void;
  onOpenCreateUser: () => void;
  onOpenEditUser: (user: User) => void;
  onBatchImportUsers?: (
    users: User[]
  ) => Promise<{ ok: boolean; error?: string }> | void;
}

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({
  users,
  departments,
  rooms,
  items,
  auditSessions,
  currentUser,
  authSettings,
  onSaveUser,
  onDeleteUser,
  onTransferAndDeleteUser,
  onArchiveUser,
  onUpdateAuthSettings,
  onSwitchUser,
  onOpenCreateUser,
  onOpenEditUser,
  onBatchImportUsers,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [showArchived, setShowArchived] = useState(false);

  // CSV Import Modal state (2-step: input -> interactive preview & resolution)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'input' | 'preview'>('input');
  const [csvText, setCsvText] = useState('');
  const [importAnalysis, setImportAnalysis] = useState<CsvImportAnalysis | null>(null);
  const [roomChoices, setRoomChoices] = useState<Record<string, string>>({});
  const [departmentChoices, setDepartmentChoices] = useState<Record<number, string>>({});
  const [skipRowNumbers, setSkipRowNumbers] = useState<Set<number>>(new Set());
  const [isImportingBatch, setIsImportingBatch] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In-app Delete Confirmation Modal state (prevents iframe alert/confirm issues)
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [transferTargetUserId, setTransferTargetUserId] = useState('');
  const [actionFeedbackMsg, setActionFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const archivedCount = users.filter((u) => u.isArchived).length;

  // Filtered users
  const filteredUsers = users.filter((u) => {
    if (!showArchived && u.isArchived) return false;
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

  const openDeleteModal = (u: User) => {
    const firstCandidate = users.find((cand) => cand.id !== u.id && !cand.isArchived && cand.isActive !== false)
      || users.find((cand) => cand.id !== u.id && !cand.isArchived);
    setTransferTargetUserId(firstCandidate?.id || '');
    setUserToDelete(u);
  };

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

  const resetImportModalState = () => {
    setImportStep('input');
    setImportAnalysis(null);
    setRoomChoices({});
    setDepartmentChoices({});
    setSkipRowNumbers(new Set());
    setImportError(null);
    setImportSuccessMsg(null);
    setIsImportingBatch(false);
  };

  // CSV Sample Template Download (strictly using buildCsvContent + BOM, without insecure role/PIN columns)
  const handleDownloadSampleCsv = () => {
    const headers = [
      'Vardas Pavardė',
      'El. paštas',
      'Pareigos',
      'Skyrius',
      'Kabinetas',
      'Telefonas',
      'Leidžiamas Gmail',
    ];
    const rows = [
      ['Rasa Jonaitienė', 'rasa.j@tryskiumokykla.lt', 'Lietuvių k. vyresnioji mokytoja', 'Vyr. korpusas', '101', '', ''],
      ['Petras Kazlauskas', 'petras.k@tryskiumokykla.lt', 'Fizikos mokytojas', 'Vyr. korpusas', '105, 106', '', ''],
      ['Jurgita Meškytė', 'jurgita.m@tryskiumokykla.lt', 'Biologijos mokytoja', 'Vyr. korpusas', '102', '', ''],
    ];
    const sample = buildCsvContent(headers, rows, ';');
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mokytoju_importo_pavyzdys.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // CSV File Upload Reader (UTF-8)
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      setCsvText(text);
      setImportError(null);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // Step 1 -> Step 2: Analyze & Preview Changes
  const handleAnalyzeCsvPreview = () => {
    setImportError(null);
    setImportSuccessMsg(null);
    if (!csvText.trim()) {
      setImportError('Įveskite arba įkelkite CSV duomenis.');
      return;
    }

    const analysis = analyzeUsersCsvImport({
      csvText,
      existingUsers: users,
      departments,
      rooms,
    });

    if (!analysis.ok) {
      setImportError(analysis.error || 'Nepavyko išanalizuoti CSV failo.');
      return;
    }

    setImportAnalysis(analysis);
    setRoomChoices({});
    setDepartmentChoices({});
    setSkipRowNumbers(new Set());
    setImportStep('preview');
  };

  // Check if every non-skipped resolutionRow has explicit user choice
  const unresolvedCountRemaining = (() => {
    if (!importAnalysis) return 0;
    let count = 0;
    for (const row of importAnalysis.resolutionRows) {
      if (skipRowNumbers.has(row.rowNumber)) continue;
      if (row.departmentError && !departmentChoices[row.rowNumber]) {
        count += 1;
        continue;
      }
      for (const issue of row.unresolvedRooms) {
        const key = `${row.rowNumber}:${issue.tokenIndex}`;
        if (!roomChoices[key]) {
          count += 1;
          break;
        }
      }
    }
    return count;
  })();

  // Step 2 Confirm: Build final payload and await atomic server response
  const handleConfirmBatchImport = async () => {
    if (!importAnalysis) return;
    setImportError(null);
    setImportSuccessMsg(null);

    const selection: UserImportResolutionSelection = {
      roomChoices,
      departmentChoices,
      skipRowNumbers,
    };

    const built = buildFinalBatchUsersFromPreview(
      importAnalysis,
      selection,
      rooms,
      departments
    );

    if (!built.ok) {
      setImportError(built.error);
      return;
    }

    setIsImportingBatch(true);
    try {
      if (onBatchImportUsers) {
        const res = await onBatchImportUsers(built.users);
        if (res && !res.ok) {
          setImportError(res.error || 'Serveris atmetė darbuotojų importą.');
          return;
        }
      } else {
        built.users.forEach((u) => onSaveUser(u));
      }

      setImportSuccessMsg(`Sėkmingai importuota arba atnaujinta: ${built.users.length} darbuotojų!`);
      setTimeout(() => {
        setIsImportModalOpen(false);
        resetImportModalState();
        setCsvText('');
      }, 1200);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Nepavyko išsaugoti importuotų darbuotojų.'
      );
    } finally {
      setIsImportingBatch(false);
    }
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
              onClick={() => {
                resetImportModalState();
                setIsImportModalOpen(true);
              }}
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

            {archivedCount > 0 && (
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-100">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span>Rodyti archyvuotus ({archivedCount})</span>
              </label>
            )}
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
                    } ${u.isArchived ? 'opacity-75 bg-slate-50/60' : ''}`}
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
                            {u.isArchived && (
                              <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                                Archyvuotas
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
                      {u.isArchived ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          <Archive className="w-3 h-3" />
                          Archyvuotas
                        </span>
                      ) : isActive ? (
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
                        {!isCurrent && !u.isArchived && (
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
                            {u.isArchived ? (
                              <button
                                onClick={() => {
                                  onArchiveUser(u.id, false);
                                  setActionFeedbackMsg({
                                    type: 'success',
                                    text: `Darbuotojas „${u.fullName}“ atkurtas iš archyvo.`,
                                  });
                                  setTimeout(() => setActionFeedbackMsg(null), 3000);
                                }}
                                title="Atkurti darbuotoją iš archyvo"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Atkurti</span>
                              </button>
                            ) : (
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
                            )}

                            <button
                              onClick={() => openDeleteModal(u)}
                              title="Pašalinti arba archyvuoti darbuotoją"
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

      {/* Batch CSV Import Modal (2-Step with Preview & Resolution) */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full border border-slate-300 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    Masinis darbuotojų importas iš CSV ({importStep === 'input' ? '1 / 2 · Failo įkėlimas' : '2 / 2 · Pakeitimų peržiūra'})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Palaiko UTF-8 lietuviškas raides, kelis kabinetus (pvz. „101, 102“) ir saugo esamas roles bei archyvo būseną
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  resetImportModalState();
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto text-xs flex-1">
              {importStep === 'input' ? (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 p-3.5 rounded-lg">
                    <div className="space-y-1">
                      <span className="font-bold text-slate-800 block">CSV importo taisyklės ir šablonas</span>
                      <span className="text-[11px] text-slate-600 block leading-relaxed">
                        Tušti arba nenurodyti stulpeliai neištrina esamų duomenų. Esamų darbuotojų <strong>rolė, PIN kodas, blokavimo ir archyvo būsena importo metu nekeičiami</strong>; nauji darbuotojai kuriami tik su mokytojo/darbuotojo teisėmis.
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
                        Įklijuokite CSV tekstą arba pasirinkite UTF-8 failą:
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
                      rows={9}
                      value={csvText}
                      onChange={(e) => {
                        setCsvText(e.target.value);
                        setImportError(null);
                      }}
                      placeholder={`Vardas Pavardė;El. paštas;Pareigos;Skyrius;Kabinetas;Telefonas;Leidžiamas Gmail\nRasa Jonaitienė;rasa.j@tryskiumokykla.lt;Lietuvių k. mokytoja;Vyr. korpusas;"101, 102";;`}
                      className="w-full bg-slate-50 font-mono text-xs border border-slate-300 rounded-lg p-3 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </>
              ) : (
                importAnalysis && (
                  <div className="space-y-4">
                    {/* Ignored access columns security notice */}
                    {importAnalysis.ignoredAccessColumns.length > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-950 text-[11px] flex items-start gap-2">
                        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                        <div>
                          <strong>Saugumo politika:</strong> CSV faile aptikti prieigos stulpeliai ({importAnalysis.ignoredAccessColumns.join(', ')}) bus ignoruojami. Esamų naudotojų rolės ir PIN kodai išliks nepakitę, o nauji naudotojai bus sukurti su pagrindine darbuotojo role.
                        </div>
                      </div>
                    )}

                    {/* Summary Counters */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                        <div className="text-[11px] text-emerald-800 font-semibold">Nauji</div>
                        <div className="text-lg font-bold font-mono text-emerald-950">
                          {importAnalysis.createRows.length}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                        <div className="text-[11px] text-blue-800 font-semibold">Atnaujinami</div>
                        <div className="text-lg font-bold font-mono text-blue-950">
                          {importAnalysis.updateRows.length}
                        </div>
                      </div>
                      <div className={`p-3 rounded-lg border ${
                        importAnalysis.resolutionRows.length > 0
                          ? 'bg-amber-50 border-amber-300'
                          : 'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="text-[11px] text-amber-900 font-semibold">Reikalauja patikslinimo</div>
                        <div className="text-lg font-bold font-mono text-amber-950">
                          {importAnalysis.resolutionRows.length}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[11px] text-slate-600 font-semibold">Praleistos eilutės</div>
                        <div className="text-lg font-bold font-mono text-slate-900">
                          {importAnalysis.skipRows.length}
                        </div>
                      </div>
                    </div>

                    {/* Needs Resolution Rows */}
                    {importAnalysis.resolutionRows.length > 0 && (
                      <div className="border border-amber-300 bg-amber-50/40 rounded-xl p-4 space-y-3">
                        <div className="font-bold text-amber-950 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span>
                            Reikalauja patikslinimo ({importAnalysis.resolutionRows.length}) – automatiškai pirmas atitikmuo neparenkamas
                          </span>
                        </div>
                        <div className="space-y-3">
                          {importAnalysis.resolutionRows.map((row) => {
                            const isRowSkipped = skipRowNumbers.has(row.rowNumber);
                            const deptFiltered = departmentChoices[row.rowNumber];
                            return (
                              <div
                                key={row.rowNumber}
                                className={`p-3 rounded-lg border space-y-2 ${
                                  isRowSkipped
                                    ? 'bg-slate-100 border-slate-300 opacity-70'
                                    : 'bg-white border-amber-200'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <span className="font-mono text-[11px] text-slate-500 mr-2">
                                      Eilutė #{row.rowNumber}
                                    </span>
                                    <strong className="text-slate-900">{row.raw.fullName}</strong>
                                    <span className="font-mono text-slate-500 ml-2">({row.raw.email})</span>
                                  </div>
                                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={isRowSkipped}
                                      onChange={(e) => {
                                        setSkipRowNumbers((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(row.rowNumber);
                                          else next.delete(row.rowNumber);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>Praleisti šią eilutę</span>
                                  </label>
                                </div>

                                {!isRowSkipped && (
                                  <div className="space-y-2 pt-1">
                                    {row.departmentError && (
                                      <div className="p-2 rounded bg-rose-50 border border-rose-200 space-y-1">
                                        <div className="text-[11px] font-semibold text-rose-900">
                                          {row.departmentError}
                                        </div>
                                        <select
                                          value={departmentChoices[row.rowNumber] || ''}
                                          onChange={(e) =>
                                            setDepartmentChoices((prev) => ({
                                              ...prev,
                                              [row.rowNumber]: e.target.value,
                                            }))
                                          }
                                          className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                                        >
                                          <option value="">-- Pasirinkite skyrių --</option>
                                          {departments
                                            .filter((d) => !d.isArchived)
                                            .map((d) => (
                                              <option key={d.id} value={d.id}>
                                                {d.name} ({d.code})
                                              </option>
                                            ))}
                                          <option value="__NONE__">Palikti esamą / be skyriaus</option>
                                        </select>
                                      </div>
                                    )}

                                    {row.unresolvedRooms.map((issue) => {
                                      const key = `${row.rowNumber}:${issue.tokenIndex}`;
                                      const candidates =
                                        deptFiltered && deptFiltered !== '__NONE__'
                                          ? issue.candidates.filter((c) => c.departmentId === deptFiltered)
                                          : issue.candidates;
                                      const displayCandidates =
                                        candidates.length > 0 ? candidates : issue.candidates;
                                      return (
                                        <div
                                          key={key}
                                          className="p-2 rounded bg-amber-50 border border-amber-200 space-y-1"
                                        >
                                          <div className="text-[11px] font-semibold text-amber-950">
                                            Kabinetas „{issue.rawToken}“: {issue.reason}
                                          </div>
                                          <select
                                            value={roomChoices[key] || ''}
                                            onChange={(e) =>
                                              setRoomChoices((prev) => ({
                                                ...prev,
                                                [key]: e.target.value,
                                              }))
                                            }
                                            className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                                          >
                                            <option value="">-- Pasirinkite tikslų kabinetą --</option>
                                            {displayCandidates.map((cand) => {
                                              const candDept = departments.find(
                                                (d) => d.id === cand.departmentId
                                              );
                                              return (
                                                <option key={cand.id} value={cand.id}>
                                                  {formatRoomName(cand, true)} — {candDept?.name || cand.departmentId} ({candDept?.code || ''})
                                                </option>
                                              );
                                            })}
                                            <option value="__NONE__">Palikti be šio kabineto</option>
                                          </select>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Create Rows Preview */}
                    {importAnalysis.createRows.length > 0 && (
                      <div className="border border-emerald-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 font-bold text-emerald-950">
                          Nauji darbuotojai ({importAnalysis.createRows.length})
                        </div>
                        <div className="divide-y divide-slate-100 max-h-44 overflow-y-auto">
                          {importAnalysis.createRows.map((row) => {
                            const deptName = row.resolvedDepartmentId
                              ? departments.find((d) => d.id === row.resolvedDepartmentId)?.name
                              : '—';
                            const roomLabels =
                              row.resolvedRoomIds.length > 0
                                ? row.resolvedRoomIds
                                    .map((id) => formatRoomName(rooms.find((r) => r.id === id)))
                                    .join(', ')
                                : '—';
                            return (
                              <div
                                key={row.rowNumber}
                                className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                              >
                                <div>
                                  <strong className="text-slate-900">{row.raw.fullName}</strong>{' '}
                                  <span className="font-mono text-slate-500">({row.raw.email})</span>
                                  <span className="text-slate-500 ml-2">
                                    · {row.proposedUser?.roleTitle || 'Mokytojas'}
                                  </span>
                                </div>
                                <div className="text-slate-600">
                                  Skyrius: <strong>{deptName}</strong> · Kab.: <strong>{roomLabels}</strong>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Update Rows Diff Preview */}
                    {importAnalysis.updateRows.length > 0 && (
                      <div className="border border-blue-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 font-bold text-blue-950">
                          Atnaujinami esami darbuotojai ({importAnalysis.updateRows.length})
                        </div>
                        <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                          {importAnalysis.updateRows.map((row) => (
                            <div key={row.rowNumber} className="px-4 py-2.5 space-y-1 text-[11px]">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <strong className="text-slate-900">{row.raw.fullName}</strong>{' '}
                                  <span className="font-mono text-slate-500">({row.raw.email})</span>
                                </div>
                                {row.preservesArchivedStatus && (
                                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-semibold text-[10px]">
                                    Archyvuotas (būsena išsaugota)
                                  </span>
                                )}
                              </div>
                              {row.changedFields.length === 0 ? (
                                <div className="text-slate-500 italic">
                                  Pakeitimų nėra (duomenys sutampa su esamu įrašu).
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2 pt-0.5">
                                  {row.changedFields.map((diff) => (
                                    <span
                                      key={diff.field}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800"
                                    >
                                      <strong>{diff.label}:</strong>{' '}
                                      <span className="line-through text-slate-500">{diff.before}</span> →{' '}
                                      <span className="text-blue-700 font-semibold">{diff.after}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skipped Rows with Reasons */}
                    {importAnalysis.skipRows.length > 0 && (
                      <div className="border border-slate-300 rounded-xl overflow-hidden">
                        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 font-bold text-slate-800">
                          Praleistos eilutės ({importAnalysis.skipRows.length})
                        </div>
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                          {importAnalysis.skipRows.map((row) => (
                            <div
                              key={row.rowNumber}
                              className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                            >
                              <div>
                                <span className="font-mono text-slate-500 mr-2">Eil. #{row.rowNumber}</span>
                                <strong>{row.raw.fullName || '—'}</strong>{' '}
                                <span className="font-mono text-slate-500">({row.raw.email || '—'})</span>
                              </div>
                              <span className="text-rose-700 font-medium">{row.skipReason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}

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
            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <div>
                {importStep === 'preview' && (
                  <button
                    type="button"
                    disabled={isImportingBatch}
                    onClick={() => {
                      setImportStep('input');
                      setImportError(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                  >
                    ← Grįžti į CSV įvedimą
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isImportingBatch}
                  onClick={() => {
                    setIsImportModalOpen(false);
                    resetImportModalState();
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
                >
                  Atšaukti
                </button>

                {importStep === 'input' ? (
                  <button
                    type="button"
                    onClick={handleAnalyzeCsvPreview}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs cursor-pointer transition-colors"
                  >
                    Peržiūrėti pakeitimus
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      isImportingBatch ||
                      unresolvedCountRemaining > 0 ||
                      !importAnalysis ||
                      (importAnalysis.createRows.length === 0 &&
                        importAnalysis.updateRows.length === 0 &&
                        importAnalysis.resolutionRows.length - skipRowNumbers.size <= 0)
                    }
                    onClick={() => void handleConfirmBatchImport()}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-md shadow-xs cursor-pointer transition-colors"
                  >
                    {isImportingBatch
                      ? 'Saugoma serveryje...'
                      : unresolvedCountRemaining > 0
                      ? `Patikslinite eilutes (${unresolvedCountRemaining})`
                      : 'Patvirtinti ir importuoti'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Transfer / Archive User Modal */}
      {userToDelete && (() => {
        const linkedItemsCount = items.filter((i) => i.responsibleUserId === userToDelete.id).length;
        const linkedRoomsCount = rooms.filter((r) => r.defaultResponsiblePersonId === userToDelete.id).length;
        const linkedDeptsCount = departments.filter((d) => d.managerId === userToDelete.id).length;
        const linkedAuditsCount = auditSessions.filter((s) => s.status !== 'completed' && s.committeeChairmanId === userToDelete.id).length;
        const isInUse = linkedItemsCount > 0 || linkedRoomsCount > 0 || linkedDeptsCount > 0 || linkedAuditsCount > 0;
        const transferCandidates = users.filter((u) => u.id !== userToDelete.id && !u.isArchived);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-300 overflow-hidden flex flex-col">
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isInUse ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-600'
                  }`}>
                    {isInUse ? <AlertTriangle className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {isInUse ? 'Darbuotojui priskirtas turtas arba atsakomybės' : 'Pašalinti naudotoją iš sistemos'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isInUse ? 'Tiesioginis šalinimas užblokuotas duomenų vientisumo apsaugai' : 'Veiksmas negrįžtamas'}
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                  <div className="font-bold text-slate-900">{userToDelete.fullName}</div>
                  <div className="text-slate-600 font-mono">{userToDelete.email}</div>
                  <div className="text-slate-500">{userToDelete.roleTitle}</div>
                </div>

                {isInUse ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1">
                      <p className="font-semibold">
                        Šiam darbuotojui vis dar priskirta:
                      </p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {linkedItemsCount > 0 && <li><strong>{linkedItemsCount}</strong> materialiojo turto vnt.</li>}
                        {linkedRoomsCount > 0 && <li><strong>{linkedRoomsCount}</strong> kabinetų vedėjo atsakomybės</li>}
                        {linkedDeptsCount > 0 && <li><strong>{linkedDeptsCount}</strong> skyrių vadovavimas</li>}
                        {linkedAuditsCount > 0 && <li><strong>{linkedAuditsCount}</strong> inventorizacijos komisijos pirmininko rolė</li>}
                      </ul>
                      <p className="pt-1 text-[11px] text-amber-900">
                        Pasirinkite naują atsakingą darbuotoją atsakomybių perleidimui arba archyvuokite šį darbuotoją, kad dokumentų istorija liktų nepakitusi.
                      </p>
                    </div>

                    {transferCandidates.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-700">
                          Perleisti visą turtą ir atsakomybes šiam darbuotojui:
                        </label>
                        <select
                          value={transferTargetUserId}
                          onChange={(e) => setTransferTargetUserId(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Pasirinkite darbuotoją --</option>
                          {transferCandidates.map((cand) => (
                            <option key={cand.id} value={cand.id}>
                              {cand.fullName} ({cand.roleTitle})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-700 leading-relaxed">
                    Ar tikrai norite pašalinti darbuotoją <strong>„{userToDelete.fullName}“</strong> iš gimnazijos darbuotojų sąrašo?
                  </p>
                )}
              </div>

              <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setUserToDelete(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer transition-colors shadow-2xs"
                >
                  Atšaukti
                </button>

                {!userToDelete.isArchived && (
                  <button
                    type="button"
                    onClick={() => {
                      onArchiveUser(userToDelete.id, true);
                      const archivedName = userToDelete.fullName;
                      setUserToDelete(null);
                      setActionFeedbackMsg({
                        type: 'success',
                        text: `Darbuotojas „${archivedName}“ archyvuotas.`,
                      });
                      setTimeout(() => setActionFeedbackMsg(null), 3000);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md cursor-pointer transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archyvuoti</span>
                  </button>
                )}

                {isInUse ? (
                  <button
                    type="button"
                    disabled={!transferTargetUserId}
                    onClick={() => {
                      if (!transferTargetUserId) return;
                      onTransferAndDeleteUser(userToDelete.id, transferTargetUserId);
                      const deletedName = userToDelete.fullName;
                      setUserToDelete(null);
                      setActionFeedbackMsg({
                        type: 'success',
                        text: `Darbuotojo „${deletedName}“ turtas ir atsakomybės sėkmingai perleisti, o paskyra pašalinta.`,
                      });
                      setTimeout(() => setActionFeedbackMsg(null), 3500);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-xs cursor-pointer transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>Perleisti ir pašalinti</span>
                  </button>
                ) : (
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
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
