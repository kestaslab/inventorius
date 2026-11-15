import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar, NavigationTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { InventoryListView } from './components/InventoryListView';
import { MyInventoryView } from './components/MyInventoryView';
import { DepartmentsRoomsView } from './components/DepartmentsRoomsView';
import { MovementsView } from './components/MovementsView';
import { AuditView } from './components/AuditView';
import { ReportsView } from './components/ReportsView';
import { LabelsQRView } from './components/LabelsQRView';
import { UsersManagementView } from './components/UsersManagementView';
import { SelfHostView } from './components/SelfHostView';
import { ItemModal } from './components/ItemModal';
import { ItemDetailModal } from './components/ItemDetailModal';
import { TransferModal } from './components/TransferModal';
import { WriteOffModal } from './components/WriteOffModal';
import { UserModal } from './components/UserModal';
import { LoginModal } from './components/LoginModal';
import { LoginPortalView } from './components/LoginPortalView';
import { AccessDeniedView } from './components/AccessDeniedView';
import { ReportFaultModal } from './components/ReportFaultModal';

import { AlertTriangle, CloudOff, RefreshCw, Eye, X } from 'lucide-react';
import { 
  Department, 
  Room, 
  User, 
  InventoryItem, 
  MovementRecord, 
  WriteOffAct, 
  AuditSession,
  AuditCheckMethod,
  AuthSettings,
  DefectReport,
  ItemCondition,
  OrganizationSettings
} from './types/inventory';
import { StorageService, SyncState, DbMutation } from './utils/storage';
import { getCurrentYearVilnius, getTodayVilniusDate } from './utils/dateUtils';
import { getMyInventorySummary } from './utils/defectUtils';

function describePendingMutation(op: DbMutation): string {
  switch (op.type) {
    case 'SAVE_ITEM':
      return `Turto įrašas „${op.item.name}“ (${op.item.inventoryNumber || op.item.id})`;
    case 'DELETE_ITEM':
      return `Turto šalinimas (${op.itemId})`;
    case 'TRANSFER_ITEM':
      return `Turto perkėlimas „${op.record.itemName}“`;
    case 'CONFIRM_WRITEOFF':
      return `Nurašymo pateikimas (${op.itemId})`;
    case 'APPROVE_WRITEOFF_ACT':
      return `Nurašymo akto tvirtinimas (${op.actId})`;
    case 'REJECT_WRITEOFF':
      return `Nurašymo atmetimas (${op.itemId})`;
    case 'RESTORE_FROM_ARCHIVE':
      return `Turto atkūrimas iš archyvo (${op.itemId})`;
    case 'SAVE_FAULT_REPORT':
      return `Gedimo pranešimas (${op.itemId})`;
    case 'START_DEFECT_REPAIR':
      return `Remonto pradžia (${op.itemId})`;
    case 'RESOLVE_DEFECT':
      return `Gedimo užbaigimas (${op.itemId})`;
    case 'SAVE_DEPARTMENT':
      return `Skyrius „${op.department.name}“`;
    case 'SAVE_ROOM':
      return `Kabinetas „${op.room.name}“`;
    case 'SAVE_USER':
      return `Naudotojas „${op.user.fullName}“`;
    case 'BATCH_IMPORT_USERS':
      return `Darbuotojų masinis importas (${op.users.length} įr.)`;
    case 'CREATE_AUDIT_SESSION':
      return `Nauja inventorizacija „${op.session.title}“`;
    case 'UPDATE_AUDIT_SESSION_SETTINGS':
      return `Inventorizacijos nustatymai (${op.sessionId})`;
    case 'RECORD_AUDIT_CHECK':
      return `Inventorizacijos patikra (${op.itemId})`;
    case 'MARK_AUDIT_ITEM_MISSING':
      return `Trūkumo fiksavimas (${op.itemId})`;
    case 'COMPLETE_AUDIT_SESSION':
      return `Inventorizacijos užbaigimas (${op.sessionId})`;
    case 'RELOCATE_AUDIT_ITEM':
      return `Turto perkėlimas inventorizacijoje (${op.itemId})`;
    case 'UPDATE_ORGANIZATION_SETTINGS':
      return 'Įstaigos rekvizitų atnaujinimas';
    default:
      return `Operacija ${op.type}`;
  }
}

export default function App() {
  // Application Data States
  const [departments, setDepartments] = useState<Department[]>(() => StorageService.getDepartments());
  const [rooms, setRooms] = useState<Room[]>(() => StorageService.getRooms());
  const [users, setUsers] = useState<User[]>(() => StorageService.getUsers());
  const [items, setItems] = useState<InventoryItem[]>(() => StorageService.getItems());
  const [movements, setMovements] = useState<MovementRecord[]>(() => StorageService.getMovements());
  const [writeOffActs, setWriteOffActs] = useState<WriteOffAct[]>(() => StorageService.getWriteOffActs());
  const [auditSessions, setAuditSessions] = useState<AuditSession[]>(() => StorageService.getAuditSessions());
  const [activeUserId, setActiveUserId] = useState<string | null>(() => StorageService.getActiveUserId());
  const [authSettings, setAuthSettings] = useState<AuthSettings>(() => StorageService.getAuthSettings());
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings>(() =>
    StorageService.getOrganizationSettings()
  );
  const [syncState, setSyncState] = useState<SyncState>(() => StorageService.getSyncState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Cloudflare Access Gatekeeper State (Access Denied for students / unlisted users)
  const [deniedAccessEmail, setDeniedAccessEmail] = useState<string | null>(null);

  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');

  // Modals
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferTargetItem, setTransferTargetItem] = useState<InventoryItem | null>(null);

  const [isWriteOffModalOpen, setIsWriteOffModalOpen] = useState(false);
  const [writeOffTargetItem, setWriteOffTargetItem] = useState<InventoryItem | null>(null);

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const [isFaultModalOpen, setIsFaultModalOpen] = useState(false);
  const [faultTargetItem, setFaultTargetItem] = useState<InventoryItem | null>(null);

  const [labelsPreselectedIds, setLabelsPreselectedIds] = useState<string[]>([]);

  // Reload everything from authoritative snapshot/cache
  const refreshFromStorage = useCallback(() => {
    setDepartments(StorageService.getDepartments());
    setRooms(StorageService.getRooms());
    setUsers(StorageService.getUsers());
    setItems(StorageService.getItems());
    setMovements(StorageService.getMovements());
    setWriteOffActs(StorageService.getWriteOffActs());
    setAuditSessions(StorageService.getAuditSessions());
    setActiveUserId(StorageService.getActiveUserId());
    setAuthSettings(StorageService.getAuthSettings());
    setOrganizationSettings(StorageService.getOrganizationSettings());
  }, []);

  // Subscribe to server sync status and authoritative/merged DB updates + read-only initial load
  useEffect(() => {
    const unsubSync = StorageService.subscribeSyncState(setSyncState);
    const unsubDb = StorageService.subscribeDatabaseUpdated((db) => {
      setDepartments(db.departments);
      setRooms(db.rooms);
      setUsers(db.users);
      setItems(db.items);
      setMovements(db.movements);
      setWriteOffActs(db.writeOffActs);
      setAuditSessions(db.auditSessions);
      if (db.authSettings) {
        setAuthSettings(db.authSettings);
      }
      if (db.organizationSettings) {
        setOrganizationSettings(db.organizationSettings);
      }
    });

    StorageService.loadFromServer().then((hasServerData) => {
      if (hasServerData) {
        refreshFromStorage();
      }
    });

    return () => {
      unsubSync();
      unsubDb();
    };
  }, [refreshFromStorage]);

  useEffect(() => {
    if (!syncState.memoryOnlyQueue) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [syncState.memoryOnlyQueue]);

  const runMutation = useCallback(async (op: DbMutation) => {
    setActionError(null);
    const res = await StorageService.executeMutation(op);
    if (!res.ok) {
      setActionError(res.error || 'Nepavyko išsaugoti pakeitimo serveryje.');
    }
    return res;
  }, []);

  const currentUser = users.find(u => u.id === activeUserId) || null;
  const activeAuditSession = auditSessions.find(s => s.status === 'in_progress') || auditSessions[0];

  // Number of active (non-written-off) items assigned to current user (matches MyInventoryView)
  const myItemsCount = useMemo(() => {
    return getMyInventorySummary(items, currentUser, rooms).assignedItems.length;
  }, [items, currentUser, rooms]);

  // Teachers are strictly focused on "Mano inventorius" tab
  useEffect(() => {
    if (currentUser?.role === 'teacher' && currentTab !== 'my_inventory') {
      setCurrentTab('my_inventory');
    }
  }, [currentUser?.role, currentTab]);

  // Active user switcher
  const handleChangeUser = (userId: string) => {
    setActiveUserId(userId);
    StorageService.setActiveUserId(userId);
    const selected = users.find(u => u.id === userId);
    if (selected?.role === 'teacher') {
      setCurrentTab('my_inventory');
    }
  };

  const handleLogout = () => {
    setActiveUserId(null);
    StorageService.clearActiveUserId();
    sessionStorage.removeItem('cf_simulated_email');
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // User Management Handlers
  const handleSaveUser = (userToSave: User) => {
    void runMutation({ type: 'SAVE_USER', user: userToSave });
  };

  const handleDeleteUser = (userId: string) => {
    void runMutation({ type: 'DELETE_USER', userId });
  };

  const handleTransferAndDeleteUser = (userId: string, targetUserId: string) => {
    void runMutation({ type: 'TRANSFER_AND_DELETE_USER', userId, targetUserId });
  };

  const handleArchiveUser = (userId: string, isArchived: boolean) => {
    void runMutation({ type: 'ARCHIVE_USER', userId, isArchived });
  };

  const handleUpdateAuthSettings = (newSettings: AuthSettings) => {
    void runMutation({ type: 'UPDATE_AUTH_SETTINGS', authSettings: newSettings });
  };

  const handleUpdateOrganizationSettings = (newOrgSettings: OrganizationSettings) => {
    void runMutation({
      type: 'UPDATE_ORGANIZATION_SETTINGS',
      organizationSettings: newOrgSettings,
    });
  };

  const handleLoginSuccess = (user: User) => {
    setActiveUserId(user.id);
    StorageService.setActiveUserId(user.id);
    const snapSync = StorageService.getSyncState();
    if (snapSync.serverHasDb || snapSync.localPreviewMode) {
      const updatedUser = { ...user, lastLoginAt: new Date().toISOString() };
      void runMutation({ type: 'SAVE_USER', user: updatedUser });
    }
  };

  // Cloudflare Access Email Detection & Whitelist Verification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCfEmail = params.get('cf_email') || params.get('email');
    const storedSimEmail = sessionStorage.getItem('cf_simulated_email');
    const targetEmail = urlCfEmail || storedSimEmail;

    if (targetEmail) {
      const q = targetEmail.trim().toLowerCase();
      const matched = users.find(u => 
        u.email.toLowerCase() === q || 
        (u.allowedGmail && u.allowedGmail.toLowerCase() === q)
      );

      if (matched && matched.isActive !== false) {
        setActiveUserId(matched.id);
        StorageService.setActiveUserId(matched.id);
        setDeniedAccessEmail(null);
      } else {
        // Access Denied: not in staff registry (e.g. student!) or inactive
        setDeniedAccessEmail(targetEmail);
      }
    }
  }, [users]);

  // Batch Import Users (CSV) - atomic server confirmation
  const handleBatchImportUsers = async (newUsersList: User[]) => {
    const res = await runMutation({ type: 'BATCH_IMPORT_USERS', users: newUsersList });
    return { ok: res.ok, error: res.error };
  };

  // Simulate Cloudflare Access Login / Test Screen
  const handleSimulateCloudflareLogin = (email: string) => {
    sessionStorage.setItem('cf_simulated_email', email);
    const q = email.trim().toLowerCase();
    const matched = users.find(
      (u) =>
        u.email.toLowerCase() === q ||
        (u.allowedGmail && u.allowedGmail.toLowerCase() === q)
    );

    if (matched && matched.isActive !== false) {
      setActiveUserId(matched.id);
      StorageService.setActiveUserId(matched.id);
      setDeniedAccessEmail(null);
    } else {
      setDeniedAccessEmail(email);
    }
  };

  // Add / Edit Item Handler
  const handleSaveItem = (itemToSave: InventoryItem) => {
    void runMutation({ type: 'SAVE_ITEM', item: itemToSave });
  };

  // Delete Item Handler
  const handleDeleteItem = (itemId: string) => {
    setPendingConfirmAction({
      title: 'Pašalinti turto įrašą?',
      message: 'Ar tikrai norite pašalinti šį įrašą iš inventoriaus registro?',
      confirmLabel: 'Taip, pašalinti',
      danger: true,
      onConfirm: () => {
        setPendingConfirmAction(null);
        void runMutation({ type: 'DELETE_ITEM', itemId });
      },
    });
  };

  // Transfer Asset Handler (atomically updates movements and item location)
  const handleExecuteTransfer = (record: MovementRecord) => {
    void runMutation({ type: 'TRANSFER_ITEM', record });
  };

  // Write-off Handler (atomically updates item and creates/appends draft act; server assigns unique NUR-YYYY-NNN)
  const handleConfirmWriteOff = (
    item: InventoryItem,
    reasonCategory: string,
    notes: string,
    targetActId?: string
  ) => {
    const currentYear = getCurrentYearVilnius();
    const fallbackChair =
      activeAuditSession?.committeeChairman?.trim() ||
      (currentUser
        ? `${currentUser.fullName} (${currentUser.roleTitle})`
        : 'Komisijos pirmininkas (nenurodyta)');
    const fallbackMembers =
      activeAuditSession?.committeeMembers && activeAuditSession.committeeMembers.length > 0
        ? activeAuditSession.committeeMembers
        : [];
    const newAct: WriteOffAct = {
      id: targetActId || `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actNumber: '',
      date: getTodayVilniusDate(),
      actYear: currentYear,
      status: 'draft',
      committeeChair: fallbackChair,
      committeeMembers: fallbackMembers,
      reasonCategory,
      notes,
      items: [
        {
          itemId: item.id,
          name: item.name,
          inventoryNumber: item.inventoryNumber,
          price: item.purchasePrice,
          residualPrice: item.residualValue ?? 0,
          reason: notes || reasonCategory,
        },
      ],
    };

    void runMutation({
      type: 'CONFIRM_WRITEOFF',
      itemId: item.id,
      reasonCategory,
      notes,
      act: newAct,
      ...(targetActId ? { targetActId } : {}),
    });
  };

  // Audit Session Lifecycle & Check Handlers
  const handleCreateAuditSession = async (session: {
    id: string;
    year: number;
    title: string;
    startDate: string;
    departmentId?: string;
    includeInRepair?: boolean;
    includeToWriteOff?: boolean;
    committeeChairman?: string;
    committeeChairmanId?: string;
    committeeMembers: string[];
    orderNumber?: string;
    orderDate?: string;
    notes?: string;
  }) => {
    const res = await runMutation({ type: 'CREATE_AUDIT_SESSION', session });
    return { ok: res.ok, error: res.error };
  };

  const handleUpdateAuditSessionSettings = async (payload: {
    sessionId: string;
    title: string;
    year: number;
    committeeChairman?: string;
    committeeChairmanId?: string;
    committeeMembers: string[];
    orderNumber?: string;
    orderDate?: string;
    notes?: string;
  }) => {
    const res = await runMutation({ type: 'UPDATE_AUDIT_SESSION_SETTINGS', ...payload });
    return { ok: res.ok, error: res.error };
  };

  const handleRecordAuditCheck = async (payload: {
    sessionId: string;
    itemId: string;
    actualRoomId: string;
    method: AuditCheckMethod;
    notes?: string;
    confirmExcludedStatus?: boolean;
  }) => {
    const res = await runMutation({
      type: 'RECORD_AUDIT_CHECK',
      sessionId: payload.sessionId,
      itemId: payload.itemId,
      actualRoomId: payload.actualRoomId,
      method: payload.method,
      checkedByUserId: currentUser?.id,
      checkedByUserName: currentUser?.fullName || 'Komisijos narys',
      checkedAt: new Date().toISOString(),
      ...(payload.notes ? { notes: payload.notes } : {}),
      ...(payload.confirmExcludedStatus ? { confirmExcludedStatus: true } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  const handleMarkAuditItemMissing = async (payload: {
    sessionId: string;
    itemId: string;
    notes?: string;
  }) => {
    const res = await runMutation({
      type: 'MARK_AUDIT_ITEM_MISSING',
      sessionId: payload.sessionId,
      itemId: payload.itemId,
      ...(payload.notes ? { notes: payload.notes } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  const handleCompleteAuditSession = async (payload: {
    sessionId: string;
    completedDate: string;
    notes?: string;
  }) => {
    const res = await runMutation({
      type: 'COMPLETE_AUDIT_SESSION',
      sessionId: payload.sessionId,
      completedDate: payload.completedDate,
      completedByUserId: currentUser?.id,
      completedByUserName: currentUser?.fullName || 'Komisijos pirmininkas',
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  // Official Relocate Item during physical audit
  const handleRelocateItem = async (
    itemId: string,
    newRoomId: string,
    sessionId?: string,
    confirmExcludedStatus?: boolean
  ) => {
    if (!rooms.some(r => r.id === newRoomId)) {
      return { ok: false, error: 'Tikslinis kabinetas nerastas.' };
    }
    const res = await runMutation({
      type: 'RELOCATE_AUDIT_ITEM',
      itemId,
      newRoomId,
      auditDate: getTodayVilniusDate(),
      ...(sessionId ? { sessionId } : {}),
      transferredByUserId: currentUser?.id,
      transferredByUserName: currentUser?.fullName || 'Komisijos narys',
      ...(confirmExcludedStatus ? { confirmExcludedStatus: true } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  // Defect / Fault Report Handler (registers 'reported' without starting repair or degrading condition)
  const handleSaveFaultReport = (itemToSave: InventoryItem, defectReport: DefectReport) => {
    void runMutation({
      type: 'SAVE_FAULT_REPORT',
      itemId: itemToSave.id,
      defectReport,
    });
  };

  const handleStartDefectRepair = async (
    itemId: string,
    defectId: string,
    repairNotes?: string
  ) => {
    const res = await runMutation({
      type: 'START_DEFECT_REPAIR',
      itemId,
      defectId,
      startedByUserId: currentUser?.id,
      startedByUserName: currentUser?.fullName || 'Administratorius',
      startedAt: new Date().toISOString(),
      ...(repairNotes ? { repairNotes } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  const handleResolveDefect = async (payload: {
    itemId: string;
    defectId: string;
    resolutionNotes: string;
    returnToActive?: boolean;
    newCondition?: ItemCondition;
  }) => {
    const res = await runMutation({
      type: 'RESOLVE_DEFECT',
      itemId: payload.itemId,
      defectId: payload.defectId,
      resolvedByUserId: currentUser?.id,
      resolvedByUserName: currentUser?.fullName || 'Administratorius',
      resolvedAt: new Date().toISOString(),
      resolutionNotes: payload.resolutionNotes,
      returnToActive: payload.returnToActive,
      ...(payload.newCondition ? { newCondition: payload.newCondition } : {}),
    });
    return { ok: res.ok, error: res.error };
  };

  // Save / Delete Department
  const handleSaveDepartment = (dept: Department) => {
    void runMutation({ type: 'SAVE_DEPARTMENT', department: dept });
  };

  const handleDeleteDepartment = (deptId: string) => {
    void runMutation({ type: 'DELETE_DEPARTMENT', departmentId: deptId });
  };

  const handleTransferAndDeleteDepartment = (departmentId: string, targetDepartmentId: string) => {
    void runMutation({ type: 'TRANSFER_AND_DELETE_DEPARTMENT', departmentId, targetDepartmentId });
  };

  const handleArchiveDepartment = (departmentId: string, isArchived: boolean) => {
    void runMutation({ type: 'ARCHIVE_DEPARTMENT', departmentId, isArchived });
  };

  // Save / Delete Room
  const handleSaveRoom = (room: Room) => {
    void runMutation({ type: 'SAVE_ROOM', room });
  };

  const handleDeleteRoom = (roomId: string) => {
    void runMutation({ type: 'DELETE_ROOM', roomId });
  };

  const handleTransferAndDeleteRoom = (roomId: string, targetRoomId: string) => {
    void runMutation({ type: 'TRANSFER_AND_DELETE_ROOM', roomId, targetRoomId });
  };

  const handleArchiveRoom = (roomId: string, isArchived: boolean) => {
    void runMutation({ type: 'ARCHIVE_ROOM', roomId, isArchived });
  };

  // Approve single item write-off (server delegates to whole-act approval and blocks partial approval)
  const handleApproveItemWriteOff = (
    item: InventoryItem,
    approvalYear: number = getCurrentYearVilnius(),
    customActNumber?: string
  ) => {
    const actNum = customActNumber?.trim() || item.writeOffActNumber || '';
    const today = getTodayVilniusDate();
    void runMutation({
      type: 'APPROVE_ITEM_WRITEOFF',
      itemId: item.id,
      approvalYear,
      actNumber: actNum,
      approvedDate: today,
      fallbackNotes: item.notes,
    });
  };

  // Reject / Revert item pending write-off back to active and preserve rejection history
  const handleRejectWriteOff = (itemId: string, reason?: string) => {
    void runMutation({
      type: 'REJECT_WRITEOFF',
      itemId,
      ...(reason ? { reason } : {}),
      rejectedByUserId: currentUser?.id,
      rejectedByUserName: currentUser?.fullName,
    });
  };

  // Restore archived written-off item back to active inventory with explicit condition & reason
  const handleRestoreFromArchive = (itemId: string, condition: ItemCondition, reason: string) => {
    void runMutation({
      type: 'RESTORE_FROM_ARCHIVE',
      itemId,
      condition,
      reason,
      restoredByUserId: currentUser?.id,
      restoredByUserName: currentUser?.fullName,
    });
  };

  // Permanently delete item
  const handlePermanentDelete = (itemId: string) => {
    setPendingConfirmAction({
      title: 'Galutinai ištrinti materialiąją vertybę?',
      message: 'DĖMESIO: Šis veiksmas visiškai pašalins materialiąją vertybę iš sistemos be galimybės atkurti. Ar tęsti?',
      confirmLabel: 'Visiškai ištrinti',
      danger: true,
      onConfirm: () => {
        setPendingConfirmAction(null);
        void runMutation({ type: 'DELETE_ITEM', itemId });
      },
    });
  };

  // Approve entire write-off act atomically
  const handleApproveWriteOffAct = (
    actId: string,
    approvalYear: number = getCurrentYearVilnius(),
    customActNumber?: string
  ) => {
    const today = getTodayVilniusDate();
    void runMutation({
      type: 'APPROVE_WRITEOFF_ACT',
      actId,
      approvalYear,
      approvedDate: today,
      ...(customActNumber?.trim() ? { actNumber: customActNumber.trim() } : {}),
      approvedByUserId: currentUser?.id,
      approvedByUserName: currentUser?.fullName,
    });
  };

  // Reconcile write-off integrity mismatches cleanly without inventing historical data
  const handleReconcileWriteOffIssue = (
    action: 'return_to_active' | 'remove_stale_draft_item' | 'link_by_existing_act_number',
    itemId?: string,
    actId?: string
  ) => {
    void runMutation({
      type: 'RECONCILE_WRITEOFF_ISSUE',
      action,
      ...(itemId ? { itemId } : {}),
      ...(actId ? { actId } : {}),
    });
  };

  // Save Write-off Act
  const handleSaveWriteOffAct = (act: WriteOffAct) => {
    void runMutation({ type: 'SAVE_WRITEOFF_ACT', act });
  };

  // Quick Print Specific Labels from Inventory List
  const handlePrintSpecificLabels = (itemIds: string[]) => {
    setLabelsPreselectedIds(itemIds);
    setCurrentTab('labels');
  };

  // Export to Excel / CSV
  const handleExportCSV = () => {
    const csv = StorageService.exportToCSV(items, departments, rooms, users);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiu-mokykla-inventorius-${getTodayVilniusDate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Access Denied Screen (for unauthorized students or external domain emails)
  if (deniedAccessEmail) {
    const adminUser = users.find((u) => u.role === 'admin') || users[0];
    return (
      <AccessDeniedView
        attemptedEmail={deniedAccessEmail}
        adminUser={adminUser}
        authSettings={authSettings}
        onAdminPinSuccess={() => {
          sessionStorage.removeItem('cf_simulated_email');
          setDeniedAccessEmail(null);
          if (adminUser) {
            handleLoginSuccess(adminUser);
          }
        }}
        onRetryDifferentEmail={() => {
          sessionStorage.removeItem('cf_simulated_email');
          if (window.location.search) {
            window.history.replaceState({}, '', window.location.pathname);
          }
          setDeniedAccessEmail(null);
        }}
      />
    );
  }

  // Mandatory Login Screen for unauthenticated visitors / initial visit
  if (!currentUser) {
    return (
      <LoginPortalView
        users={users}
        authSettings={authSettings}
        onLoginSuccess={(user) => {
          handleLoginSuccess(user);
        }}
        onAccessDenied={(email) => {
          setDeniedAccessEmail(email);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 font-sans app-print-shell">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentUser={currentUser}
        allUsers={users}
        onChangeUser={handleChangeUser}
        itemsCount={items.length}
        myItemsCount={myItemsCount}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-100 app-print-main-col">
        {/* Top Header */}
        <Header
          currentTab={currentTab}
          currentUser={currentUser}
          onOpenAddItem={() => {
            setEditingItem(null);
            setIsItemModalOpen(true);
          }}
          onExportCSV={handleExportCSV}
          onOpenLoginModal={() => setIsLoginModalOpen(true)}
          onLogout={handleLogout}
          syncState={syncState}
          onRetrySync={() => {
            setActionError(null);
            void StorageService.retryPendingMutations();
          }}
          onReloadFromServer={() => {
            setActionError(null);
            void StorageService.resolveConflictByReloadingServer().then(refreshFromStorage);
          }}
          onExitLocalPreview={() => {
            setActionError(null);
            void StorageService.exitLocalDemoPreview().then(refreshFromStorage);
          }}
        />

        {/* View Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-100/90 app-print-viewport">
          <div className="max-w-7xl mx-auto">
            {/* Sync / Conflict / Error / Local Preview / Blocked Ops Alert Banners */}
            {(actionError ||
              syncState.status === 'error' ||
              syncState.status === 'conflict' ||
              syncState.localPreviewMode ||
              syncState.storageWarning ||
              syncState.memoryOnlyQueue ||
              syncState.blockedCount > 0 ||
              (syncState.rejectedOps && syncState.rejectedOps.length > 0) ||
              syncState.status === 'uninitialized') && (
              <div className="mb-4 space-y-2 no-print">
                {syncState.localPreviewMode && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>
                        <strong>Vietinė demonstracinė peržiūra:</strong> rodomi tik demonstraciniai duomenys šiame naršyklės lange. Centrinė serverio bazė nėra pakeista.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void StorageService.exitLocalDemoPreview().then(refreshFromStorage)}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                    >
                      Grįžti prie serverio duomenų
                    </button>
                  </div>
                )}

                {syncState.status === 'conflict' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        <strong>Konfliktas:</strong> {syncState.errorMessage || 'Šį įrašą ką tik pakeitė kitas naudotojas.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        void StorageService.resolveConflictByReloadingServer().then(refreshFromStorage);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Atnaujinti iš serverio</span>
                    </button>
                  </div>
                )}

                {(syncState.status === 'error' || actionError) && syncState.status !== 'conflict' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-rose-900">
                    <div className="flex items-center gap-2">
                      <CloudOff className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>
                        <strong>Nepavyko išsaugoti:</strong> {actionError || syncState.errorMessage}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {syncState.pendingCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            void StorageService.retryPendingMutations();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Bandyti dar kartą ({syncState.pendingCount})</span>
                        </button>
                      )}
                      {actionError && syncState.status !== 'error' && (
                        <button
                          type="button"
                          onClick={() => setActionError(null)}
                          className="p-1 text-rose-600 hover:text-rose-800 cursor-pointer"
                          title="Uždaryti pranešimą"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {syncState.rejectedOps && syncState.rejectedOps.length > 0 && (
                  <div className="px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-950 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Atmesti pakeitimai ({syncState.rejectedOps.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => StorageService.clearRejectedOps()}
                        className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-900 font-semibold cursor-pointer"
                      >
                        Išvalyti pranešimą
                      </button>
                    </div>
                    <ul className="space-y-1 pl-5 list-disc text-[11px]">
                      {syncState.rejectedOps.map((rej) => (
                        <li key={rej.clientOpId}>
                          <strong>{describePendingMutation(rej.operation)}:</strong> {rej.errorMessage} (HTTP {rej.statusCode})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {syncState.blockedOps && syncState.blockedOps.length > 0 && (
                  <div className="px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        Pakeitimai, reikalaujantys sprendimo ({syncState.blockedOps.length}):
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {syncState.blockedOps.map((blocked) => (
                        <div
                          key={blocked.clientOpId}
                          className="flex flex-wrap items-center justify-between gap-2 bg-white/80 border border-amber-200 rounded-md px-3 py-2 text-[11px]"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">
                              {describePendingMutation(blocked.operation)}
                            </div>
                            <div className="text-amber-800">
                              {blocked.blockedReason || 'Priklauso nuo anksčiau atmestos operacijos.'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                void StorageService.retryBlockedOperation(blocked.clientOpId);
                              }}
                              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                            >
                              Bandyti dar kartą
                            </button>
                            <button
                              type="button"
                              onClick={() => StorageService.dismissBlockedOperation(blocked.clientOpId)}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold cursor-pointer"
                            >
                              Atsisakyti
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {syncState.status === 'uninitialized' && !syncState.localPreviewMode && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>{syncState.errorMessage}</span>
                    </div>
                  </div>
                )}

                {(syncState.memoryOnlyQueue || syncState.storageWarning) && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {syncState.storageWarning ||
                        'Pakeitimai laikomi tik darbinėje atmintyje – uždarius arba perkrovus puslapį prieš išsaugant serveryje, jie bus prarasti.'}
                    </span>
                  </div>
                )}
              </div>
            )}
            {currentTab === 'my_inventory' && currentUser && (
              <MyInventoryView
                currentUser={currentUser}
                items={items}
                departments={departments}
                rooms={rooms}
                onViewItemDetail={(item) => {
                  setDetailItem(item);
                  setIsDetailModalOpen(true);
                }}
                onSaveFaultReport={handleSaveFaultReport}
              />
            )}

            {currentTab === 'dashboard' && (
              <DashboardView
                items={items}
                departments={departments}
                rooms={rooms}
                movements={movements}
                auditSession={activeAuditSession}
                users={users}
                currentUser={currentUser}
                onNavigate={setCurrentTab}
                onOpenAddItem={() => {
                  setEditingItem(null);
                  setIsItemModalOpen(true);
                }}
                onOpenTransferModal={() => {
                  setTransferTargetItem(null);
                  setIsTransferModalOpen(true);
                }}
              />
            )}

            {currentTab === 'inventory' && (
              <InventoryListView
                items={items}
                departments={departments}
                rooms={rooms}
                users={users}
                writeOffActs={writeOffActs}
                organizationSettings={organizationSettings}
                currentUser={currentUser}
                onEditItem={(item) => {
                  setEditingItem(item);
                  setIsItemModalOpen(true);
                }}
                onDeleteItem={handleDeleteItem}
                onTransferItem={(item) => {
                  setTransferTargetItem(item);
                  setIsTransferModalOpen(true);
                }}
                onInitiateWriteOff={(item) => {
                  setWriteOffTargetItem(item);
                  setIsWriteOffModalOpen(true);
                }}
                onViewItemDetail={(item) => {
                  setDetailItem(item);
                  setIsDetailModalOpen(true);
                }}
                onPrintSpecificLabels={handlePrintSpecificLabels}
                onApproveWriteOff={handleApproveItemWriteOff}
                onApproveWriteOffAct={handleApproveWriteOffAct}
                onRejectWriteOff={handleRejectWriteOff}
                onRestoreFromArchive={handleRestoreFromArchive}
                onPermanentDelete={handlePermanentDelete}
                onReconcileWriteOffIssue={handleReconcileWriteOffIssue}
              />
            )}

            {currentTab === 'departments' && (
              <DepartmentsRoomsView
                departments={departments}
                rooms={rooms}
                items={items}
                users={users}
                currentUser={currentUser}
                onSaveDepartment={handleSaveDepartment}
                onDeleteDepartment={handleDeleteDepartment}
                onTransferAndDeleteDepartment={handleTransferAndDeleteDepartment}
                onArchiveDepartment={handleArchiveDepartment}
                onSaveRoom={handleSaveRoom}
                onDeleteRoom={handleDeleteRoom}
                onTransferAndDeleteRoom={handleTransferAndDeleteRoom}
                onArchiveRoom={handleArchiveRoom}
                onViewItemDetail={(item) => {
                  setDetailItem(item);
                  setIsDetailModalOpen(true);
                }}
              />
            )}

            {currentTab === 'movements' && (
              <MovementsView
                movements={movements}
                departments={departments}
                rooms={rooms}
                users={users}
                currentUser={currentUser}
                organizationSettings={organizationSettings}
                onOpenTransferModal={() => {
                  setTransferTargetItem(null);
                  setIsTransferModalOpen(true);
                }}
              />
            )}

            {currentTab === 'audit' && (
              <AuditView
                items={items}
                departments={departments}
                rooms={rooms}
                users={users}
                auditSessions={auditSessions}
                organizationSettings={organizationSettings}
                currentUser={currentUser}
                onCreateAuditSession={handleCreateAuditSession}
                onUpdateAuditSessionSettings={handleUpdateAuditSessionSettings}
                onRecordAuditCheck={handleRecordAuditCheck}
                onMarkAuditItemMissing={handleMarkAuditItemMissing}
                onCompleteAuditSession={handleCompleteAuditSession}
                onRelocateItem={handleRelocateItem}
              />
            )}

            {currentTab === 'labels' && (
              <LabelsQRView
                items={items}
                departments={departments}
                rooms={rooms}
                preSelectedIds={labelsPreselectedIds}
                organizationSettings={organizationSettings}
                onClearPreselection={() => setLabelsPreselectedIds([])}
              />
            )}

            {currentTab === 'reports' && (
              <ReportsView
                items={items}
                departments={departments}
                rooms={rooms}
                users={users}
                writeOffActs={writeOffActs}
                auditSessions={auditSessions}
                organizationSettings={organizationSettings}
                currentUser={currentUser}
                onExportCSV={handleExportCSV}
                onSaveWriteOffAct={handleSaveWriteOffAct}
                onApproveWriteOffAct={handleApproveWriteOffAct}
                onUpdateOrganizationSettings={handleUpdateOrganizationSettings}
                onReconcileWriteOffIssue={handleReconcileWriteOffIssue}
              />
            )}

            {currentTab === 'users' && (
              <UsersManagementView
                users={users}
                departments={departments}
                rooms={rooms}
                items={items}
                auditSessions={auditSessions}
                currentUser={currentUser}
                authSettings={authSettings}
                onSaveUser={handleSaveUser}
                onDeleteUser={handleDeleteUser}
                onTransferAndDeleteUser={handleTransferAndDeleteUser}
                onArchiveUser={handleArchiveUser}
                onUpdateAuthSettings={handleUpdateAuthSettings}
                onSwitchUser={handleChangeUser}
                onOpenCreateUser={() => {
                  setEditingUser(null);
                  setIsUserModalOpen(true);
                }}
                onOpenEditUser={(user) => {
                  setEditingUser(user);
                  setIsUserModalOpen(true);
                }}
                onBatchImportUsers={handleBatchImportUsers}
              />
            )}

            {currentTab === 'selfhost' && (
              <SelfHostView 
                currentUser={currentUser}
                onRefreshData={refreshFromStorage}
                items={items}
                rooms={rooms}
                movements={movements}
                writeOffActs={writeOffActs}
                syncState={syncState}
              />
            )}
          </div>
        </main>
      </div>

      {/* Interactive Modal Windows */}
      {isItemModalOpen && (
        <ItemModal
          isOpen={isItemModalOpen}
          onClose={() => setIsItemModalOpen(false)}
          onSave={handleSaveItem}
          editingItem={editingItem}
          allItems={items}
          departments={departments}
          rooms={rooms}
          users={users}
        />
      )}

      {isDetailModalOpen && detailItem && (
        <ItemDetailModal
          item={items.find(i => i.id === detailItem.id) || detailItem}
          onClose={() => setIsDetailModalOpen(false)}
          departments={departments}
          rooms={rooms}
          users={users}
          movements={movements}
          currentUser={currentUser}
          organizationSettings={organizationSettings}
          onEdit={(item) => {
            setEditingItem(item);
            setIsItemModalOpen(true);
          }}
          onTransfer={(item) => {
            setTransferTargetItem(item);
            setIsTransferModalOpen(true);
          }}
          onWriteOff={(item) => {
            setWriteOffTargetItem(item);
            setIsWriteOffModalOpen(true);
          }}
          onReportFault={(item) => {
            setFaultTargetItem(item);
            setIsFaultModalOpen(true);
          }}
          onStartDefectRepair={handleStartDefectRepair}
          onResolveDefect={handleResolveDefect}
        />
      )}

      {isFaultModalOpen && faultTargetItem && (
        <ReportFaultModal
          isOpen={isFaultModalOpen}
          onClose={() => {
            setIsFaultModalOpen(false);
            setFaultTargetItem(null);
          }}
          item={faultTargetItem}
          room={rooms.find(r => r.id === faultTargetItem.roomId)}
          dept={departments.find(d => d.id === faultTargetItem.departmentId)}
          currentUserName={currentUser?.fullName || 'Naudotojas'}
          currentUserId={currentUser?.id || ''}
          onSubmitFault={(item: InventoryItem, report: DefectReport) => {
            handleSaveFaultReport(item, report);
            setIsFaultModalOpen(false);
            setFaultTargetItem(null);
          }}
        />
      )}

      {isTransferModalOpen && (
        <TransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          preSelectedItem={transferTargetItem}
          items={items}
          departments={departments}
          rooms={rooms}
          users={users}
          onExecuteTransfer={handleExecuteTransfer}
        />
      )}

      {isWriteOffModalOpen && writeOffTargetItem && (
        <WriteOffModal
          isOpen={isWriteOffModalOpen}
          onClose={() => setIsWriteOffModalOpen(false)}
          item={writeOffTargetItem}
          writeOffActs={writeOffActs}
          onConfirmWriteOff={handleConfirmWriteOff}
        />
      )}

      {isUserModalOpen && (
        <UserModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSave={handleSaveUser}
          editingUser={editingUser}
          departments={departments}
          rooms={rooms}
          schoolDomain={authSettings.allowedSchoolDomain}
        />
      )}

      {isLoginModalOpen && (
        <LoginModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          users={users}
          authSettings={authSettings}
          currentUser={currentUser}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {pendingConfirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                pendingConfirmAction.danger ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{pendingConfirmAction.title}</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{pendingConfirmAction.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPendingConfirmAction(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Atšaukti
              </button>
              <button
                type="button"
                onClick={pendingConfirmAction.onConfirm}
                className={`px-3.5 py-1.5 text-xs font-bold text-white rounded-lg transition-colors cursor-pointer ${
                  pendingConfirmAction.danger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {pendingConfirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
