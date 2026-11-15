import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Scan,
  Camera,
  Building,
  Check,
  Printer,
  Settings,
  Users,
  FileText,
  X,
  Plus,
  Shield,
  MapPin,
  Lock,
  CheckCheck,
  ArrowRightLeft,
  History,
  XCircle,
} from 'lucide-react';
import {
  InventoryItem,
  Department,
  Room,
  AuditSession,
  AuditCheckMethod,
  OrganizationSettings,
  User,
  formatRoomName,
} from '../types/inventory';
import { AuditCameraScanner } from './AuditCameraScanner';
import { resolveScannedInventoryItem } from '../utils/qrUtils';
import {
  buildAuditSnapshotItems,
  computeAuditStats,
  EffectiveAuditRow,
  evaluateItemAuditScope,
  getEffectiveSessionRows,
} from '../utils/auditUtils';
import { formatMoneyFixed } from '../utils/accountingUtils';
import { getCalendarDatePart, getCurrentYearVilnius, getTodayVilniusDate } from '../utils/dateUtils';
import { resolveOrganizationForDocument } from '../utils/organization';

export interface AuditActionResult {
  ok: boolean;
  error?: string;
}

interface AuditViewProps {
  items: InventoryItem[];
  departments: Department[];
  rooms: Room[];
  users: User[];
  auditSessions: AuditSession[];
  organizationSettings?: OrganizationSettings;
  currentUser: User;
  onCreateAuditSession: (session: {
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
  }) => Promise<AuditActionResult>;
  onUpdateAuditSessionSettings: (payload: {
    sessionId: string;
    title: string;
    year: number;
    committeeChairman?: string;
    committeeChairmanId?: string;
    committeeMembers: string[];
    orderNumber?: string;
    orderDate?: string;
    notes?: string;
  }) => Promise<AuditActionResult>;
  onRecordAuditCheck: (payload: {
    sessionId: string;
    itemId: string;
    actualRoomId: string;
    method: AuditCheckMethod;
    notes?: string;
    confirmExcludedStatus?: boolean;
  }) => Promise<AuditActionResult>;
  onMarkAuditItemMissing: (payload: {
    sessionId: string;
    itemId: string;
    notes?: string;
  }) => Promise<AuditActionResult>;
  onCompleteAuditSession: (payload: {
    sessionId: string;
    completedDate: string;
    notes?: string;
  }) => Promise<AuditActionResult>;
  onRelocateItem: (
    itemId: string,
    newRoomId: string,
    sessionId?: string,
    confirmExcludedStatus?: boolean
  ) => Promise<AuditActionResult>;
}

const METHOD_LABELS: Record<AuditCheckMethod, string> = {
  qr: 'QR kodas',
  barcode: 'Brūkšninis kodas',
  manual_code: 'Įvestas kodas',
  manual_list: 'Iš sąrašo',
};

export const AuditView: React.FC<AuditViewProps> = ({
  items,
  departments,
  rooms,
  users,
  auditSessions,
  organizationSettings,
  currentUser,
  onCreateAuditSession,
  onUpdateAuditSessionSettings,
  onRecordAuditCheck,
  onMarkAuditItemMissing,
  onCompleteAuditSession,
  onRelocateItem,
}) => {
  // Aktyvi arba pasirinkta inventorizacijos sesija
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => {
    const active = auditSessions.find((s) => s.status === 'in_progress');
    return active?.id || auditSessions[0]?.id || '';
  });

  const selectedSession = useMemo(() => {
    if (auditSessions.length === 0) return null;
    return (
      auditSessions.find((s) => s.id === selectedSessionId) ||
      auditSessions.find((s) => s.status === 'in_progress') ||
      auditSessions[0]
    );
  }, [auditSessions, selectedSessionId]);

  const isCompleted = selectedSession?.status === 'completed';

  // Skyrių ir kabinetų filtrai
  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>(() => rooms[0]?.id || '');
  const [checklistFilter, setChecklistFilter] = useState<
    'all' | 'unchecked' | 'checked' | 'missing'
  >('all');

  // Skenavimo būsena ir apsauga nuo lygiagrečių užklausų
  const [inputCode, setInputCode] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanBusy, setIsScanBusy] = useState(false);
  const scanInFlightRef = useRef(false);

  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'relocated' | 'excluded_status' | 'not_found' | 'already_scanned' | 'error';
    message: string;
    item?: InventoryItem;
    detectedMethod?: AuditCheckMethod;
    isAdditionalFinding?: boolean;
    alreadyCheckedRoomName?: string;
    canUpdateLocation?: boolean;
  } | null>(null);

  // Modalai
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  // Nustatymų / naujos sesijos formos būsena
  const [formTitle, setFormTitle] = useState('');
  const [formYear, setFormYear] = useState<number>(getCurrentYearVilnius());
  const [formScopeDeptId, setFormScopeDeptId] = useState<string>('all');
  const [formIncludeInRepair, setFormIncludeInRepair] = useState<boolean>(true);
  const [formIncludeToWriteOff, setFormIncludeToWriteOff] = useState<boolean>(true);
  const [formChairmanId, setFormChairmanId] = useState<string>(users[0]?.id || '');
  const [formCustomChairman, setFormCustomChairman] = useState<string>('');
  const [formMemberNames, setFormMemberNames] = useState<string[]>([]);
  const [newMemberInput, setNewMemberInput] = useState('');
  const [formOrderNumber, setFormOrderNumber] = useState('V-14');
  const [formOrderDate, setFormOrderDate] = useState(getTodayVilniusDate());
  const [formNotes, setFormNotes] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');

  // Pasikeitus sesijai išjungiame kamerą ir pritaikome sesijos skyriaus apimtį
  useEffect(() => {
    setIsCameraOpen(false);
    setScanFeedback(null);
    if (selectedSession?.departmentId) {
      setSelectedDeptId(selectedSession.departmentId);
      const deptRooms = rooms.filter(
        (r) => r.departmentId === selectedSession.departmentId && !r.isArchived
      );
      if (deptRooms.length > 0) {
        setSelectedRoomId(deptRooms[0].id);
      }
    } else {
      setSelectedDeptId('all');
    }
  }, [selectedSession?.id, selectedSession?.departmentId, rooms]);

  useEffect(() => {
    if (isCompleted && isCameraOpen) {
      setIsCameraOpen(false);
    }
  }, [isCompleted, isCameraOpen]);

  // Matomi kabinetai ir skyriai
  const visibleDepartments = useMemo(() => {
    const scopeId = selectedSession?.departmentId;
    return departments.filter((d) => {
      if (scopeId && d.id !== scopeId) return false;
      return !d.isArchived || d.id === selectedDeptId || items.some((i) => i.departmentId === d.id);
    });
  }, [departments, items, selectedDeptId, selectedSession?.departmentId]);

  const visibleRooms = useMemo(() => {
    const scopeId = selectedSession?.departmentId;
    return rooms.filter((r) => {
      if (scopeId && r.departmentId !== scopeId) return false;
      return !r.isArchived || r.id === selectedRoomId || items.some((i) => i.roomId === r.id);
    });
  }, [rooms, items, selectedRoomId, selectedSession?.departmentId]);

  const availableRooms = useMemo(() => {
    if (selectedDeptId === 'all') return visibleRooms;
    return visibleRooms.filter((r) => r.departmentId === selectedDeptId);
  }, [visibleRooms, selectedDeptId]);

  const activeRoom = useMemo(() => {
    const found = availableRooms.find((r) => r.id === selectedRoomId);
    if (found) return found;
    return availableRooms[0] || null;
  }, [availableRooms, selectedRoomId]);

  const activeDept = departments.find((d) => d.id === activeRoom?.departmentId);

  // Visos sesijos eilutės pagal užfiksuotą momentinį sąrašą (snapshotItems) ir istorinius įrašus
  const allSessionRows = useMemo(
    () => getEffectiveSessionRows(selectedSession, items, departments, rooms, users, 'all'),
    [selectedSession, items, departments, rooms, users]
  );

  const deptFilteredRows = useMemo(() => {
    if (selectedDeptId === 'all') return allSessionRows;
    return allSessionRows.filter(
      (r) =>
        r.expectedDepartmentId === selectedDeptId ||
        r.checkRecord?.actualDepartmentId === selectedDeptId
    );
  }, [allSessionRows, selectedDeptId]);

  const scopedDeptRows = useMemo(
    () => deptFilteredRows.filter((r) => !r.isOutsideOriginalScope && !r.isAdditionalFinding),
    [deptFilteredRows]
  );

  const additionalDeptRows = useMemo(
    () => deptFilteredRows.filter((r) => r.isOutsideOriginalScope || r.isAdditionalFinding),
    [deptFilteredRows]
  );

  const overallStats = useMemo(() => computeAuditStats(allSessionRows), [allSessionRows]);

  // Kabineto tikėtinos pradinės apimties eilutės ir čia rasti papildomi / perkelti objektai
  const expectedInRoomRows = useMemo(() => {
    if (!activeRoom) return [];
    return allSessionRows.filter(
      (r) => !r.isOutsideOriginalScope && !r.isAdditionalFinding && r.expectedRoomId === activeRoom.id
    );
  }, [allSessionRows, activeRoom]);

  const foundElsewhereInActiveRoomRows = useMemo(() => {
    if (!activeRoom) return [];
    return allSessionRows.filter(
      (r) =>
        r.checkRecord?.actualRoomId === activeRoom.id &&
        (r.expectedRoomId !== activeRoom.id || r.isAdditionalFinding || r.isOutsideOriginalScope)
    );
  }, [allSessionRows, activeRoom]);

  const roomStats = useMemo(() => computeAuditStats(expectedInRoomRows), [expectedInRoomRows]);

  const filteredExpectedRows = useMemo(() => {
    if (checklistFilter === 'all') return expectedInRoomRows;
    if (checklistFilter === 'unchecked') {
      return expectedInRoomRows.filter((r) => r.auditState === 'unchecked');
    }
    if (checklistFilter === 'missing') {
      return expectedInRoomRows.filter((r) => r.auditState === 'missing');
    }
    return expectedInRoomRows.filter(
      (r) => r.auditState === 'found' || r.auditState === 'found_elsewhere'
    );
  }, [expectedInRoomRows, checklistFilter]);

  // Naujos sesijos būsimo sąrašo peržiūra
  const createPreviewCount = useMemo(() => {
    return buildAuditSnapshotItems(
      { items, departments, rooms, users },
      {
        departmentId: formScopeDeptId === 'all' ? undefined : formScopeDeptId,
        includeInRepair: formIncludeInRepair,
        includeToWriteOff: formIncludeToWriteOff,
      }
    ).length;
  }, [items, departments, rooms, users, formScopeDeptId, formIncludeInRepair, formIncludeToWriteOff]);

  const handleSelectDepartment = (deptId: string) => {
    setSelectedDeptId(deptId);
    setScanFeedback(null);
    if (deptId === 'all') {
      if (!selectedRoomId && visibleRooms.length > 0) {
        setSelectedRoomId(visibleRooms[0].id);
      }
    } else {
      const deptRooms = visibleRooms.filter((r) => r.departmentId === deptId);
      if (deptRooms.length > 0) {
        setSelectedRoomId(deptRooms[0].id);
      }
    }
  };

  // Bendras QR / brūkšninio / rankinio kodo apdorojimas su apsauga nuo lygiagrečių užklausų
  const processScannedCode = async (rawInput: string, source: 'camera' | 'manual') => {
    if (!selectedSession || isCompleted || !activeRoom) return;
    if (scanInFlightRef.current) return;

    const resolution = resolveScannedInventoryItem(rawInput, items);
    if (!resolution.ok) {
      setScanFeedback({
        type: 'not_found',
        message: resolution.message,
      });
      if (source === 'manual') setInputCode('');
      return;
    }

    const found = resolution.item;
    const detectedMethod: AuditCheckMethod =
      source === 'camera' || resolution.format === 'json_qr'
        ? 'qr'
        : resolution.matchedBy === 'barcode'
        ? 'barcode'
        : 'manual_code';

    // Nuosekli apimties ir statuso patikra (identiška serverio taisyklėms)
    const scopeCheck = evaluateItemAuditScope(selectedSession, found, activeRoom, {
      action: 'check',
    });

    if (!scopeCheck.allowed) {
      if (scopeCheck.code === 'EXCLUDED_BY_STATUS') {
        setScanFeedback({
          type: 'excluded_status',
          message: `${scopeCheck.message} Jei vis tiek norite užfiksuoti jį kaip išimtį (papildomą radinį), turite aiškiai tai patvirtinti.`,
          item: found,
          detectedMethod,
        });
      } else {
        setScanFeedback({
          type: 'error',
          message: scopeCheck.message,
          item: found,
        });
      }
      if (source === 'manual') setInputCode('');
      return;
    }

    const snapRow = allSessionRows.find((r) => r.itemId === found.id);
    const expectedDeptId = snapRow?.expectedDepartmentId || found.departmentId;
    const expectedRoomId = snapRow?.expectedRoomId || found.roomId;

    // Ar jau patikrintas šioje sesijoje?
    const existingCheck = selectedSession.checkRecords?.[found.id];
    const alreadyScannedLegacy =
      !existingCheck && selectedSession.scannedItemIds.includes(found.id);

    if (existingCheck || alreadyScannedLegacy) {
      const checkedRoomName =
        existingCheck?.actualRoomName ||
        formatRoomName(rooms.find((r) => r.id === expectedRoomId), true);
      const checkedBy = existingCheck?.checkedByUserName || 'Komisija';
      const checkedDate = existingCheck?.checkedAt
        ? new Date(existingCheck.checkedAt).toLocaleString('lt-LT')
        : '';

      const sameRoom = existingCheck ? existingCheck.actualRoomId === activeRoom.id : true;
      setScanFeedback({
        type: 'already_scanned',
        message: `Turtas [${found.inventoryNumber}] „${found.name}“ jau patikrintas (${checkedRoomName}${
          checkedBy ? `, patikrino: ${checkedBy}` : ''
        }${checkedDate ? `, ${checkedDate}` : ''}).`,
        item: found,
        alreadyCheckedRoomName: checkedRoomName,
        canUpdateLocation: !sameRoom,
      });
      if (source === 'manual') setInputCode('');
      return;
    }

    // Tikėtina vieta sutampa su aktyviu kabinetu -> fiksuojame iš karto atomine mutacija
    if (expectedRoomId === activeRoom.id) {
      scanInFlightRef.current = true;
      setIsScanBusy(true);
      try {
        const res = await onRecordAuditCheck({
          sessionId: selectedSession.id,
          itemId: found.id,
          actualRoomId: activeRoom.id,
          method: detectedMethod,
        });
        if (res.ok) {
          setScanFeedback({
            type: 'success',
            message: `Rasta vietoje (${METHOD_LABELS[detectedMethod]}): [${found.inventoryNumber}] ${found.name}. Atnaujinta paskutinės patikros data.`,
            item: found,
          });
        } else {
          setScanFeedback({
            type: 'error',
            message: res.error || 'Nepavyko išsaugoti patikros įrašo.',
            item: found,
          });
        }
      } finally {
        scanInFlightRef.current = false;
        setIsScanBusy(false);
        if (source === 'manual') setInputCode('');
      }
      return;
    }

    // Rastas KITAME kabinete arba kaip papildomas kito skyriaus radinys!
    const expectedRoom = rooms.find((r) => r.id === expectedRoomId);
    const expectedDept = departments.find((d) => d.id === expectedDeptId);
    setScanFeedback({
      type: 'relocated',
      message: `${
        scopeCheck.isAdditionalFinding
          ? 'Papildomas radinys (nebuvo šios sesijos pradiniame sąraše): '
          : ''
      }Turtas [${found.inventoryNumber}] „${found.name}“ pagal dokumentus priklauso ${
        expectedDept?.code ? `[${expectedDept.code}] ` : ''
      }${snapRow?.expectedRoomName || formatRoomName(expectedRoom, true)}, bet rastas čia (${formatRoomName(
        activeRoom,
        true
      )}). Pasirinkite veiksmą:`,
      item: found,
      detectedMethod,
      isAdditionalFinding: scopeCheck.isAdditionalFinding,
    });
    if (source === 'manual') setInputCode('');
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void processScannedCode(inputCode, 'manual');
  };

  const handleRecordFoundElsewhereOnly = async (
    item: InventoryItem,
    confirmExcludedStatus = false,
    methodOverride?: AuditCheckMethod
  ) => {
    if (!selectedSession || isCompleted || !activeRoom || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setIsScanBusy(true);
    try {
      const res = await onRecordAuditCheck({
        sessionId: selectedSession.id,
        itemId: item.id,
        actualRoomId: activeRoom.id,
        method: methodOverride || (isCameraOpen ? 'qr' : 'manual_code'),
        confirmExcludedStatus,
      });
      if (res.ok) {
        setScanFeedback({
          type: 'success',
          message: confirmExcludedStatus
            ? `Išimties tvarka užfiksuotas papildomas radinys patalpoje ${formatRoomName(
                activeRoom,
                true
              )}. Oficiali turto vieta registre liko nepakeista.`
            : `Užfiksuota faktinė vieta (${formatRoomName(
                activeRoom,
                true
              )}). Oficiali turto vieta registre liko nepakeista.`,
          item,
        });
      } else {
        setScanFeedback({
          type: 'error',
          message: res.error || 'Nepavyko užfiksuoti faktinės vietos.',
          item,
        });
      }
    } finally {
      scanInFlightRef.current = false;
      setIsScanBusy(false);
    }
  };

  const handleConfirmOfficialRelocation = async (
    item: InventoryItem,
    confirmExcludedStatus = false
  ) => {
    if (!selectedSession || isCompleted || !activeRoom || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setIsScanBusy(true);
    try {
      const res = await onRelocateItem(
        item.id,
        activeRoom.id,
        selectedSession.id,
        confirmExcludedStatus
      );
      if (res.ok) {
        setScanFeedback({
          type: 'success',
          message: `Turtas [${item.inventoryNumber}] oficialiai perkeltas į ${formatRoomName(
            activeRoom,
            true
          )} (sukurtas judėjimo aktas ir pažymėta inventorizacijoje).`,
          item,
        });
      } else {
        setScanFeedback({
          type: 'error',
          message: res.error || 'Nepavyko atlikti oficialaus perkėlimo.',
          item,
        });
      }
    } finally {
      scanInFlightRef.current = false;
      setIsScanBusy(false);
    }
  };

  const handleQuickMark = async (itemId: string) => {
    if (!selectedSession || isCompleted || !activeRoom || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setIsScanBusy(true);
    try {
      const res = await onRecordAuditCheck({
        sessionId: selectedSession.id,
        itemId,
        actualRoomId: activeRoom.id,
        method: 'manual_list',
      });
      if (!res.ok) {
        setScanFeedback({
          type: 'error',
          message: res.error || 'Nepavyko pažymėti daikto kaip rasto.',
        });
      }
    } finally {
      scanInFlightRef.current = false;
      setIsScanBusy(false);
    }
  };

  const handleMarkMissing = async (itemId: string) => {
    if (!selectedSession || isCompleted || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setIsScanBusy(true);
    try {
      const res = await onMarkAuditItemMissing({
        sessionId: selectedSession.id,
        itemId,
      });
      if (!res.ok) {
        setScanFeedback({
          type: 'error',
          message: res.error || 'Nepavyko pažymėti daikto kaip trūkstamo.',
        });
      }
    } finally {
      scanInFlightRef.current = false;
      setIsScanBusy(false);
    }
  };

  // Atidaryti naujos sesijos kūrimo modalą
  const openCreateSessionModal = () => {
    const year = getCurrentYearVilnius();
    const defaultChair =
      users.find((u) => !u.isArchived && u.isActive !== false && u.role === 'admin') ||
      users.find((u) => !u.isArchived && u.isActive !== false) ||
      currentUser;
    setModalError(null);
    setFormYear(year);
    setFormTitle(`${year} m. metinė turto inventorizacija`);
    setFormScopeDeptId('all');
    setFormIncludeInRepair(true);
    setFormIncludeToWriteOff(true);
    setFormChairmanId(defaultChair.id || '');
    setFormCustomChairman(
      `${defaultChair.fullName} (${defaultChair.roleTitle || 'Komisijos pirmininkas'})`
    );
    setFormMemberNames(
      selectedSession?.committeeMembers?.length
        ? selectedSession.committeeMembers
        : []
    );
    setFormOrderNumber(selectedSession?.orderNumber || '');
    setFormOrderDate(getTodayVilniusDate());
    setFormNotes('');
    setNewMemberInput('');
    setIsCreateModalOpen(true);
  };

  const openSettingsModal = () => {
    if (!selectedSession || isCompleted) return;
    setModalError(null);
    setFormTitle(selectedSession.title);
    setFormYear(selectedSession.year);
    setFormOrderNumber(selectedSession.orderNumber || '');
    setFormOrderDate(selectedSession.orderDate || getTodayVilniusDate());
    const currentChair =
      selectedSession.committeeChairman || `${currentUser.fullName} (Komisijos pirmininkas)`;
    setFormCustomChairman(currentChair);
    const foundUser =
      (selectedSession.committeeChairmanId &&
        users.find((u) => u.id === selectedSession.committeeChairmanId)) ||
      users.find((u) => currentChair.includes(u.fullName));
    setFormChairmanId(foundUser?.id || '');
    setFormMemberNames(selectedSession.committeeMembers || []);
    setFormNotes(selectedSession.notes || '');
    setNewMemberInput('');
    setIsSettingsOpen(true);
  };

  const handleSubmitCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setModalError('Įveskite inventorizacijos sesijos pavadinimą.');
      return;
    }
    setIsSubmittingModal(true);
    setModalError(null);
    try {
      const chUser = users.find((u) => u.id === formChairmanId);
      const finalChairmanName = chUser
        ? formCustomChairman.trim() ||
          `${chUser.fullName} (${chUser.roleTitle || 'Komisijos pirmininkas'})`
        : formCustomChairman.trim();
      const newSessionId = `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const res = await onCreateAuditSession({
        id: newSessionId,
        year: formYear,
        title: formTitle.trim(),
        startDate: getTodayVilniusDate(),
        ...(formScopeDeptId !== 'all' ? { departmentId: formScopeDeptId } : {}),
        includeInRepair: formIncludeInRepair,
        includeToWriteOff: formIncludeToWriteOff,
        committeeChairman: finalChairmanName,
        committeeChairmanId: chUser?.id,
        committeeMembers: formMemberNames,
        orderNumber: formOrderNumber.trim(),
        orderDate: formOrderDate,
        notes: formNotes.trim(),
      });
      if (res.ok) {
        setSelectedSessionId(newSessionId);
        setIsCreateModalOpen(false);
      } else {
        setModalError(res.error || 'Nepavyko sukurti naujos inventorizacijos sesijos.');
      }
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleSubmitSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession) return;
    setIsSubmittingModal(true);
    setModalError(null);
    try {
      const chUser = users.find((u) => u.id === formChairmanId);
      const finalChairmanName = chUser
        ? formCustomChairman.trim() ||
          `${chUser.fullName} (${chUser.roleTitle || 'Komisijos pirmininkas'})`
        : formCustomChairman.trim();
      const res = await onUpdateAuditSessionSettings({
        sessionId: selectedSession.id,
        title: formTitle.trim() || 'Materialiojo turto inventorizacija',
        year: formYear,
        committeeChairman: finalChairmanName,
        committeeChairmanId: chUser?.id,
        committeeMembers: formMemberNames,
        orderNumber: formOrderNumber.trim(),
        orderDate: formOrderDate,
        notes: formNotes.trim(),
      });
      if (res.ok) {
        setIsSettingsOpen(false);
      } else {
        setModalError(res.error || 'Nepavyko išsaugoti sesijos nustatymų.');
      }
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleConfirmCompleteSession = async () => {
    if (!selectedSession) return;
    setIsSubmittingModal(true);
    setModalError(null);
    try {
      const res = await onCompleteAuditSession({
        sessionId: selectedSession.id,
        completedDate: getTodayVilniusDate(),
        notes: completionNotes.trim() || selectedSession.notes,
      });
      if (res.ok) {
        setIsCompleteModalOpen(false);
      } else {
        setModalError(res.error || 'Nepavyko užbaigti inventorizacijos sesijos.');
      }
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const renderRowAuditBadge = (row: EffectiveAuditRow) => {
    switch (row.auditState) {
      case 'found':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            Rasta vietoje
          </span>
        );
      case 'found_elsewhere':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-bold">
            <ArrowRightLeft className="w-3 h-3" />
            Rasta kitur
          </span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[11px] font-bold">
            <XCircle className="w-3 h-3" />
            Trūksta
          </span>
        );
      case 'unchecked':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold">
            Dar nepatikrinta
          </span>
        );
    }
  };

  const activeChairmanDisplay =
    selectedSession?.committeeChairman ||
    selectedSession?.committeeMembers?.[0] ||
    'Nenurodytas';

  // Jei sistemoje nėra nė vienos inventorizacijos sesijos
  if (!selectedSession) {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4 shadow-2xs">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Scan className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-bold text-slate-900">
              Nėra pradėtų inventorizacijos sesijų
            </h2>
            <p className="text-xs text-slate-600">
              Sukurkite naują inventorizacijos sesiją, pasirinkite tikrinamą skyrių, komisiją ir
              užfiksuokite pradinį turto sąrašą. Nurašytas turtas neįtraukiamas.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateSessionModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Pradėti naują inventorizaciją</span>
          </button>
        </div>

        {/* Create modal reusable */}
        {isCreateModalOpen && renderCreateModal()}
      </div>
    );
  }

  function renderCommissionFields() {
    return (
      <>
        <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-700" />
            <label className="block text-xs font-bold text-blue-950">
              Inventorizacijos komisijos pirmininkas <span className="text-rose-500">*</span>
            </label>
          </div>
          <select
            value={formChairmanId}
            onChange={(e) => {
              setFormChairmanId(e.target.value);
              const selected = users.find((u) => u.id === e.target.value);
              if (selected) {
                setFormCustomChairman(
                  `${selected.fullName} (${selected.roleTitle || 'Komisijos pirmininkas'})`
                );
              }
            }}
            className="w-full bg-white border border-blue-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 cursor-pointer shadow-2xs"
          >
            <option value="">-- Įvesti ranka --</option>
            {users
              .filter((u) => (!u.isArchived && u.isActive !== false) || u.id === formChairmanId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} — {u.roleTitle || (u.role === 'admin' ? 'Ūkio vedėjas / IT' : 'Darbuotojas')}
                  {u.isArchived ? ' [Archyvuotas]' : ''}
                </option>
              ))}
          </select>

          <div>
            <label className="block text-[11px] text-slate-600 mb-1">
              Pilnas vardas ir pareigos dokumentuose:
            </label>
            <input
              type="text"
              value={formCustomChairman}
              onChange={(e) => setFormCustomChairman(e.target.value)}
              className="w-full bg-white px-3 py-1.5 border border-slate-300 rounded-md text-xs font-medium"
              placeholder="Vardas Pavardė (pareigos)"
            />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-600" />
              <label className="block text-xs font-bold text-slate-800">
                Komisijos nariai ({formMemberNames.length})
              </label>
            </div>
            {formMemberNames.length > 0 && (
              <button
                type="button"
                onClick={() => setFormMemberNames([])}
                className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
              >
                Išvalyti visus narius
              </button>
            )}
          </div>

          {formMemberNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg max-h-32 overflow-y-auto">
              {formMemberNames.map((name, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-blue-300 rounded-md text-xs font-semibold text-slate-800 shadow-2xs"
                >
                  <Users className="w-3 h-3 text-blue-600 shrink-0" />
                  <span className="truncate max-w-[210px]" title={name}>
                    {name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormMemberNames((prev) => prev.filter((_, i) => i !== idx))}
                    className="hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded p-0.5 cursor-pointer"
                    title="Pašalinti narį"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="p-2.5 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 text-center">
              Nėra priskirtų narių.
            </div>
          )}

          <div className="border border-slate-300 rounded-lg p-2.5 max-h-32 overflow-y-auto bg-slate-50 space-y-1">
            {users
              .filter((u) => !u.isArchived && u.isActive !== false)
              .map((u) => {
                const isSelected = formMemberNames.some((m) =>
                  m.toLowerCase().includes(u.fullName.toLowerCase())
                );
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer ${
                      isSelected ? 'bg-blue-100/70 font-bold text-blue-950' : 'hover:bg-white text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        if (isSelected) {
                          setFormMemberNames((prev) =>
                            prev.filter((m) => !m.toLowerCase().includes(u.fullName.toLowerCase()))
                          );
                        } else {
                          const roleSuffix = u.roleTitle ? ` (${u.roleTitle})` : '';
                          setFormMemberNames((prev) => [...prev, `${u.fullName}${roleSuffix}`]);
                        }
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="truncate">
                      {u.fullName} ({u.roleTitle || 'Darbuotojas'})
                    </span>
                  </label>
                );
              })}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newMemberInput}
              onChange={(e) => setNewMemberInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newMemberInput.trim() && !formMemberNames.includes(newMemberInput.trim())) {
                    setFormMemberNames((prev) => [...prev, newMemberInput.trim()]);
                    setNewMemberInput('');
                  }
                }
              }}
              placeholder="Įrašyti papildomą narį ranka..."
              className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
            />
            <button
              type="button"
              onClick={() => {
                if (newMemberInput.trim() && !formMemberNames.includes(newMemberInput.trim())) {
                  setFormMemberNames((prev) => [...prev, newMemberInput.trim()]);
                  setNewMemberInput('');
                }
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Pridėti
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Direktoriaus įsakymo Nr.
            </label>
            <input
              type="text"
              value={formOrderNumber}
              onChange={(e) => setFormOrderNumber(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Įsakymo data</label>
            <input
              type="date"
              value={formOrderDate}
              onChange={(e) => setFormOrderDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Pastabos / Inventorizacijos pagrindas
          </label>
          <textarea
            rows={2}
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
      </>
    );
  }

  function renderCreateModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs">
        <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
          <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                <Plus className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Nauja inventorizacijos sesija</h2>
                <p className="text-[11px] text-slate-300">
                  Pradedama be senų žymėjimų, užfiksuojant šiuo metu tikrintino turto sąrašą
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmitCreateSession} className="p-6 space-y-4 overflow-y-auto flex-1">
            {modalError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
                {modalError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sesijos pavadinimas <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Metai</label>
                <input
                  type="number"
                  value={formYear}
                  onChange={(e) => setFormYear(parseInt(e.target.value, 10) || getCurrentYearVilnius())}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            {/* Apimties pasirinkimas */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <label className="block text-xs font-bold text-slate-800">
                Tikrinamo turto apimtis
              </label>
              <select
                value={formScopeDeptId}
                onChange={(e) => setFormScopeDeptId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium text-slate-900"
              >
                <option value="all">Visi skyriai (visa gimnazija)</option>
                {departments
                  .filter((d) => !d.isArchived)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} [{d.code}]
                    </option>
                  ))}
              </select>

              <div className="space-y-1.5 pt-1 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIncludeInRepair}
                    onChange={(e) => setFormIncludeInRepair(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Įtraukti remontuojamą turtą</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIncludeToWriteOff}
                    onChange={(e) => setFormIncludeToWriteOff(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Įtraukti parengtą nurašymui turtą</span>
                </label>
                <p className="text-[11px] text-slate-500">
                  Nurašytas turtas į aktyvaus turto inventorizaciją neįtraukiamas. Šioje sesijoje
                  bus užfiksuota: <strong className="text-slate-900">{createPreviewCount} vnt.</strong>
                </p>
              </div>
            </div>

            {renderCommissionFields()}

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Atšaukti
              </button>
              <button
                type="submit"
                disabled={isSubmittingModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
              >
                {isSubmittingModal ? 'Kuriama...' : 'Sukurti naują sesiją'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const resolvedPrintOrg = resolveOrganizationForDocument(
    selectedSession.organizationSnapshot,
    organizationSettings,
    selectedSession.status === 'completed'
  );

  return (
    <div className="space-y-6">
      <div className={isPrintModalOpen ? 'space-y-6 no-print' : 'space-y-6'}>
      {/* Sesijų perjungiklis ir kūrimas */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <History className="w-4 h-4 text-blue-600" />
            <span>Inventorizacijos sesija:</span>
          </div>
          <select
            value={selectedSession.id}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            aria-label="Pasirinkti inventorizacijos sesiją"
            className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 cursor-pointer"
          >
            {auditSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.year} m. · {s.title} [{s.status === 'completed' ? 'Užbaigta' : 'Vykdoma'}]
              </option>
            ))}
          </select>
          {selectedSession.departmentId && (
            <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold">
              Apimtis: {selectedSession.scopeDepartmentName || departments.find((d) => d.id === selectedSession.departmentId)?.name}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={openCreateSessionModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nauja inventorizacija</span>
        </button>
      </div>

      {/* Užbaigtos sesijos pranešimas */}
      {isCompleted && (
        <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 border border-slate-700">
          <div className="flex items-center gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Sesija užbaigta ir užrakinta ({selectedSession.completedDate || '—'}).</strong>{' '}
              Užfiksavo: {selectedSession.completedByUserName || 'Komisija'}. Istoriniai duomenys ir
              apyrašas nekeičiami net atnaujinus inventoriaus registrą.
            </span>
          </div>
        </div>
      )}

      {/* Sesijos antraštė, komisija ir valdymo mygtukai */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`w-3 h-3 rounded-full ${
                  isCompleted ? 'bg-slate-500' : 'bg-emerald-500 animate-pulse'
                }`}
              />
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                {selectedSession.title}
              </h2>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${
                  isCompleted
                    ? 'bg-slate-200 text-slate-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {isCompleted ? 'Užbaigta' : 'Vykdoma'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Komisijos pirmininkas:</span>
                <strong className="text-slate-900 font-semibold">{activeChairmanDisplay}</strong>
              </div>

              {selectedSession.committeeMembers && selectedSession.committeeMembers.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Nariai:</span>
                  <span className="text-slate-700">
                    {selectedSession.committeeMembers
                      .filter(
                        (m) =>
                          !m
                            .toLowerCase()
                            .includes((activeChairmanDisplay.split(' ')[0] || '').toLowerCase())
                      )
                      .join(', ') || selectedSession.committeeMembers.join(', ')}
                  </span>
                </div>
              )}

              {selectedSession.orderNumber && (
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Įsakymas:</span>
                  <span className="font-mono font-medium text-slate-800">
                    Nr. {selectedSession.orderNumber} ({selectedSession.orderDate || ''})
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!isCompleted && (
              <>
                <button
                  type="button"
                  onClick={openSettingsModal}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-600" />
                  <span>Nustatymai ir komisija</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setCompletionNotes(selectedSession.notes || '');
                    setIsCompleteModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Užbaigti inventorizaciją</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-blue-600" />
              <span>Spausdinti apyrašą (A4)</span>
            </button>

            <div className="hidden sm:block pl-2 border-l border-slate-200 text-right">
              <div className="text-[11px] text-slate-400 uppercase font-medium">Sesijos pažanga</div>
              <div className="text-xs font-bold font-mono text-slate-900">
                {overallStats.checkedCount} / {overallStats.total} vnt. ({overallStats.progressPercent}%)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Skyrių filtras */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Skyriaus pasirinkimas (nuvažiavus į vietą)
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Rasta vietoje: <strong>{overallStats.foundInPlaceCount}</strong> · Rasta kitur:{' '}
            <strong>{overallStats.foundElsewhereCount}</strong> · Trūksta:{' '}
            <strong>{overallStats.missingCount}</strong> · Dar nepatikrinta:{' '}
            <strong>{overallStats.uncheckedCount}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
          {!selectedSession.departmentId && (
            <button
              type="button"
              onClick={() => handleSelectDepartment('all')}
              className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                selectedDeptId === 'all'
                  ? 'bg-blue-50/80 border-blue-500 text-blue-950 ring-1 ring-blue-500 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold truncate">Visi skyriai</span>
                {selectedDeptId === 'all' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{visibleRooms.length} kabinetai</span>
                <span className="font-mono font-medium">
                  {overallStats.checkedCount} / {overallStats.total} vnt.
                </span>
              </div>
            </button>
          )}

          {visibleDepartments.map((dept) => {
            const isSelected = selectedDeptId === dept.id;
            const deptRooms = visibleRooms.filter((r) => r.departmentId === dept.id);
            const dRows = allSessionRows.filter((r) => r.expectedDepartmentId === dept.id);
            const dStats = computeAuditStats(dRows);

            return (
              <button
                type="button"
                key={dept.id}
                onClick={() => handleSelectDepartment(dept.id)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/80 border-blue-500 text-blue-950 ring-1 ring-blue-500 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-xs font-bold truncate">{dept.name}</span>
                    <span className="text-[10px] font-mono px-1 rounded bg-slate-200/80 text-slate-600 font-semibold">
                      {dept.code}
                    </span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{deptRooms.length} kab.</span>
                  <span
                    className={`font-mono font-medium ${
                      dStats.progressPercent === 100 && dStats.total > 0
                        ? 'text-emerald-700'
                        : 'text-slate-700'
                    }`}
                  >
                    {dStats.checkedCount}/{dStats.total} ({dStats.progressPercent}%)
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pagrindinė darbo zona */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Kairė pusė: Kabinetas + QR/Kameros/Rankinis skaitytuvas */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                1. Pasirinkite tikrinamą kabinetą
              </label>
              <span className="text-[11px] font-mono text-slate-500">
                Rodomi: {availableRooms.length} kab.
              </span>
            </div>

            {availableRooms.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                Šiame skyriuje nėra kabinetų.
              </div>
            ) : (
              <select
                value={activeRoom?.id || ''}
                onChange={(e) => {
                  setSelectedRoomId(e.target.value);
                  setScanFeedback(null);
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
              >
                {availableRooms.map((r) => {
                  const dept = departments.find((d) => d.id === r.departmentId);
                  const rRows = allSessionRows.filter(
                    (row) =>
                      !row.isOutsideOriginalScope &&
                      !row.isAdditionalFinding &&
                      row.expectedRoomId === r.id
                  );
                  const rStats = computeAuditStats(rRows);
                  return (
                    <option key={r.id} value={r.id}>
                      {formatRoomName(r, true)} {selectedDeptId === 'all' && dept ? `[${dept.code}]` : ''} —{' '}
                      {rStats.checkedCount}/{rStats.total} vnt.
                    </option>
                  );
                })}
              </select>
            )}

            {activeRoom && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>Skyrius:</span>
                  <span className="font-semibold text-slate-900">
                    {activeDept?.name} ({activeDept?.code})
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Patalpa:</span>
                  <span className="font-medium text-slate-900">{formatRoomName(activeRoom)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Pažanga kabinete:</span>
                  <span className="font-mono tabular-nums text-slate-900 font-bold">
                    {roomStats.checkedCount} iš {roomStats.total} vnt. ({roomStats.progressPercent}%)
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 mt-1 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      roomStats.progressPercent === 100 && roomStats.total > 0
                        ? 'bg-emerald-500'
                        : 'bg-blue-600'
                    }`}
                    style={{ width: `${roomStats.progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Skaitytuvo kortelė */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Scan className="w-4 h-4 text-blue-600" />
                2. QR / Barkodo nuskaitymas
              </span>

              {!isCompleted && activeRoom && (
                <button
                  type="button"
                  onClick={() => setIsCameraOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                    isCameraOpen
                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isCameraOpen ? 'Išjungti kamerą' : 'Telefono kamera'}</span>
                </button>
              )}
            </div>

            {isCameraOpen && !isCompleted && (
              <AuditCameraScanner
                isOpen={isCameraOpen}
                disabled={isScanBusy}
                onDecodedCode={(raw) => {
                  void processScannedCode(raw, 'camera');
                }}
                onClose={() => setIsCameraOpen(false)}
              />
            )}

            <form onSubmit={handleScanSubmit} className="space-y-3">
              <input
                type="text"
                disabled={isCompleted || !activeRoom || isScanBusy}
                placeholder={
                  isCompleted
                    ? 'Sesija užbaigta – skaitytuvas išjungtas'
                    : 'Nuskenuokite QR / USB barkodą arba įveskite Inv. Nr. / SN'
                }
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                className="w-full text-center font-mono text-sm px-3 py-3 bg-slate-50 border-2 border-dashed border-blue-400 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isCompleted || !activeRoom || !inputCode.trim() || isScanBusy}
                className="w-full py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                {isScanBusy ? 'Tikrinama ir saugoma...' : 'Fiksuoti patikrą (Enter)'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Palaikomi: programos JSON QR, Inv. Nr., S/N, brūkšninis kodas</span>
              <span>USB Enter veikia</span>
            </div>

            {scanFeedback && (
              <div
                className={`p-4 rounded-lg border text-xs space-y-3 ${
                  scanFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : scanFeedback.type === 'relocated' || scanFeedback.type === 'excluded_status'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : scanFeedback.type === 'already_scanned'
                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                    : 'bg-rose-50 border-rose-300 text-rose-900'
                }`}
              >
                <div className="font-bold flex items-start gap-2">
                  {scanFeedback.type === 'success' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  {(scanFeedback.type === 'relocated' ||
                    scanFeedback.type === 'excluded_status' ||
                    scanFeedback.type === 'already_scanned') && (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  {(scanFeedback.type === 'not_found' || scanFeedback.type === 'error') && (
                    <HelpCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{scanFeedback.message}</span>
                </div>

                {scanFeedback.type === 'excluded_status' &&
                  scanFeedback.item &&
                  activeRoom &&
                  !isCompleted && (
                    <div className="pt-2 border-t border-amber-200 flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={isScanBusy}
                        onClick={() =>
                          void handleRecordFoundElsewhereOnly(
                            scanFeedback.item!,
                            true,
                            scanFeedback.detectedMethod
                          )
                        }
                        className="w-full px-3 py-2 bg-white hover:bg-amber-100 text-amber-950 border border-amber-400 rounded-md text-xs font-bold cursor-pointer text-left"
                      >
                        Išimtis: užfiksuoti čia kaip papildomą radinį (nekeičiant registro vietos)
                      </button>
                      {scanFeedback.item.roomId !== activeRoom.id && (
                        <button
                          type="button"
                          disabled={isScanBusy}
                          onClick={() =>
                            void handleConfirmOfficialRelocation(scanFeedback.item!, true)
                          }
                          className="w-full px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-md text-xs font-bold cursor-pointer text-left"
                        >
                          Išimtis: oficialiai perkelti į {formatRoomName(activeRoom)} ir užfiksuoti radiniu
                        </button>
                      )}
                    </div>
                  )}

                {scanFeedback.type === 'relocated' &&
                  scanFeedback.item &&
                  activeRoom &&
                  !isCompleted && (
                    <div className="pt-2 border-t border-amber-200 flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={isScanBusy}
                        onClick={() =>
                          void handleRecordFoundElsewhereOnly(
                            scanFeedback.item!,
                            false,
                            scanFeedback.detectedMethod
                          )
                        }
                        className="w-full px-3 py-2 bg-white hover:bg-amber-100 text-amber-950 border border-amber-400 rounded-md text-xs font-bold cursor-pointer text-left"
                      >
                        1. Užfiksuoti faktinę vietą čia (nekeičiant registro vietos)
                      </button>
                      <button
                        type="button"
                        disabled={isScanBusy}
                        onClick={() => void handleConfirmOfficialRelocation(scanFeedback.item!)}
                        className="w-full px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-md text-xs font-bold cursor-pointer text-left"
                      >
                        2. Oficialiai perkelti į {formatRoomName(activeRoom)} (su judėjimo aktu)
                      </button>
                    </div>
                  )}

                {scanFeedback.type === 'already_scanned' &&
                  scanFeedback.canUpdateLocation &&
                  scanFeedback.item &&
                  activeRoom &&
                  !isCompleted && (
                    <div className="pt-2 border-t border-blue-200 flex justify-end">
                      <button
                        type="button"
                        disabled={isScanBusy}
                        onClick={() => void handleRecordFoundElsewhereOnly(scanFeedback.item!)}
                        className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-md text-[11px] font-bold cursor-pointer"
                      >
                        Atnaujinti faktinę vietą į {formatRoomName(activeRoom)}
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>

        {/* Dešinė pusė: Kabineto patikros sąrašas */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {activeRoom ? formatRoomName(activeRoom) : 'Pasirinkite kabinetą'} – patikros sąrašas
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rasta vietoje: <strong className="text-emerald-700">{roomStats.foundInPlaceCount}</strong> ·
                  Kitur: <strong className="text-amber-700">{roomStats.foundElsewhereCount}</strong> ·
                  Trūksta: <strong className="text-rose-700">{roomStats.missingCount}</strong> ·
                  Dar nepatikrinta: <strong className="text-slate-800">{roomStats.uncheckedCount}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'unchecked', 'checked', 'missing'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setChecklistFilter(tab)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer border ${
                      checklistFilter === tab
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {tab === 'all'
                      ? `Visi (${expectedInRoomRows.length})`
                      : tab === 'unchecked'
                      ? `Nepatikrinta (${roomStats.uncheckedCount})`
                      : tab === 'checked'
                      ? `Patikrinta (${roomStats.checkedCount})`
                      : `Trūksta (${roomStats.missingCount})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto pr-1">
              {filteredExpectedRows.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 space-y-1">
                  <MapPin className="w-8 h-8 text-slate-300 mx-auto" />
                  <p>Pagal pasirinktą filtrą šiame kabinete įrašų nėra.</p>
                </div>
              ) : (
                filteredExpectedRows.map((row) => {
                  const rec = row.checkRecord;
                  return (
                    <div
                      key={row.itemId}
                      className={`py-3 px-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg ${
                        row.auditState === 'found'
                          ? 'bg-emerald-50/50'
                          : row.auditState === 'found_elsewhere'
                          ? 'bg-amber-50/50'
                          : row.auditState === 'missing'
                          ? 'bg-rose-50/50'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono tabular-nums text-xs font-bold text-slate-900">
                            {row.inventoryNumber}
                          </span>
                          <span className="text-[11px] text-slate-500">{row.category}</span>
                          {renderRowAuditBadge(row)}
                        </div>
                        <p className="text-xs font-semibold text-slate-800 truncate">{row.name}</p>
                        {rec && (
                          <p className="text-[11px] text-slate-600">
                            Patikrino: <strong>{rec.checkedByUserName}</strong> ·{' '}
                            {METHOD_LABELS[rec.method]} ·{' '}
                            {new Date(rec.checkedAt).toLocaleString('lt-LT')}
                            {row.auditState === 'found_elsewhere' && (
                              <span className="text-amber-800 font-semibold">
                                {' '}
                                · Faktinė vieta: {rec.actualRoomName}
                                {rec.officialTransferDone ? ' (oficialiai perkeltas)' : ' (registras nepakeistas)'}
                              </span>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono tabular-nums text-slate-500">
                          {row.purchasePrice.toFixed(2)} €
                        </span>
                        {!isCompleted && row.auditState === 'unchecked' && (
                          <>
                            <button
                              type="button"
                              disabled={isScanBusy}
                              onClick={() => void handleQuickMark(row.itemId)}
                              className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                            >
                              Rasta
                            </button>
                            <button
                              type="button"
                              disabled={isScanBusy}
                              onClick={() => void handleMarkMissing(row.itemId)}
                              className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer"
                            >
                              Trūksta
                            </button>
                          </>
                        )}
                        {!isCompleted && row.auditState === 'missing' && (
                          <button
                            type="button"
                            disabled={isScanBusy}
                            onClick={() => void handleQuickMark(row.itemId)}
                            className="px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
                          >
                            Rasta dabar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Čia faktiškai rastas kito kabineto turtas arba papildomi radiniai */}
          {foundElsewhereInActiveRoomRows.length > 0 && activeRoom && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-amber-700" />
                <span>
                  Čia ({formatRoomName(activeRoom)}) faktiškai rasti papildomi radiniai / kito kabineto turtas (
                  {foundElsewhereInActiveRoomRows.length})
                </span>
              </h4>
              <div className="space-y-2">
                {foundElsewhereInActiveRoomRows.map((row) => (
                  <div
                    key={row.itemId}
                    className="bg-white border border-amber-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900">
                          {row.inventoryNumber}
                        </span>
                        <span className="font-semibold text-slate-800">{row.name}</span>
                        {row.isAdditionalFinding && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-bold">
                            Papildomas radinys
                          </span>
                        )}
                        {row.excludedStatusException && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-bold">
                            Išimtis (neįtrauktas statusas)
                          </span>
                        )}
                        {row.hasIncompleteHistory && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 text-[10px] font-semibold">
                            Riboti senos sesijos duomenys
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Pagal registrą / pradžią: <strong>{row.expectedDepartmentName} · {row.expectedRoomName}</strong> ·{' '}
                        {row.checkRecord?.officialTransferDone
                          ? 'Oficialiai perkeltas su judėjimo aktu'
                          : 'Užfiksuota tik faktinė vieta'}
                      </div>
                    </div>
                    {!isCompleted &&
                      !row.checkRecord?.officialTransferDone &&
                      row.expectedRoomId !== activeRoom.id && (
                        <button
                          type="button"
                          disabled={isScanBusy}
                          onClick={() => {
                            const regItem = items.find((i) => i.id === row.itemId);
                            if (regItem) {
                              void handleConfirmOfficialRelocation(
                                regItem,
                                Boolean(row.excludedStatusException)
                              );
                            }
                          }}
                          className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[11px] font-bold cursor-pointer"
                        >
                          Oficialiai perkelti čia
                        </button>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Naujos sesijos modalas */}
      {isCreateModalOpen && renderCreateModal()}

      {/* Sesijos nustatymų modalas */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Inventorizacijos nustatymai ir komisija</h2>
                  <p className="text-[11px] text-slate-300">
                    Komisijos pirmininkas, nariai ir įsakymo rekvizitai
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitSettings} className="p-6 space-y-4 overflow-y-auto flex-1">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Inventorizacijos pavadinimas <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Metai</label>
                  <input
                    type="number"
                    value={formYear}
                    onChange={(e) => setFormYear(parseInt(e.target.value, 10) || getCurrentYearVilnius())}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              {renderCommissionFields()}

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Atšaukti
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                >
                  {isSubmittingModal ? 'Saugoma...' : 'Išsaugoti nustatymus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Užbaigimo patvirtinimo modalas */}
      {isCompleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-2xs">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Užbaigti inventorizacijos sesiją?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Užbaigus sesiją jos rezultatų keisti nebegalėsite. Visi dar nepatikrinti daiktai bus
                  užfiksuoti kaip galutinis trūkumas („Trūksta“).
                </p>
              </div>
            </div>

            {modalError && (
              <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {modalError}
              </div>
            )}

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">Iš viso pradinės apimties sąraše:</span>
                <strong className="font-mono text-slate-900">{overallStats.total} vnt.</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-700">Rasta vietoje:</span>
                <strong className="font-mono text-emerald-800">{overallStats.foundInPlaceCount} vnt.</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-700">Rasta kitame kabinete:</span>
                <strong className="font-mono text-amber-800">{overallStats.foundElsewhereCount} vnt.</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-rose-700">Jau pažymėta kaip trūkstama:</span>
                <strong className="font-mono text-rose-800">{overallStats.missingCount} vnt.</strong>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 font-semibold">
                <span className="text-slate-800">Dar nepatikrinta (taps „Trūksta“):</span>
                <strong className="font-mono text-rose-700">{overallStats.uncheckedCount} vnt.</strong>
              </div>
              {overallStats.additionalFindingsCount > 0 && (
                <div className="flex justify-between pt-1 border-t border-slate-200 text-indigo-800 font-semibold">
                  <span>Papildomi radiniai (atskirai nuo pradinės apimties):</span>
                  <strong className="font-mono">{overallStats.additionalFindingsCount} vnt.</strong>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Užbaigimo pastabos (neprivaloma)
              </label>
              <textarea
                rows={2}
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCompleteModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Grįžti prie tikrinimo
              </button>
              <button
                type="button"
                disabled={isSubmittingModal}
                onClick={() => void handleConfirmCompleteSession()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                {isSubmittingModal ? 'Užbaigiama...' : 'Patvirtinti ir užbaigti'}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* A4 Oficialus apyrašo spausdinimo modalas */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-2 sm:p-4 backdrop-blur-2xs overflow-y-auto print-modal-backdrop">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden border border-slate-300 print-modal-container">
            <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0 no-print print:hidden">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold">Oficialus inventorizacijos apyrašas (A4)</span>
                {selectedDeptId !== 'all' && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white font-mono">
                    {departments.find((d) => d.id === selectedDeptId)?.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Spausdinti / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-8 sm:p-10 overflow-y-auto flex-1 font-serif text-slate-900 text-xs bg-white print:p-0 print-sheet-scroller">
              <div className="print-sheet">
              <div className="text-center space-y-1 mb-6 border-b pb-4 border-slate-300">
                <p className="font-bold text-sm tracking-wide uppercase">
                  {resolvedPrintOrg.organization.name}
                </p>
                <p className="text-[11px] text-slate-600">
                  Juridinio asmens kodas: {resolvedPrintOrg.organization.code} · {resolvedPrintOrg.organization.address}
                </p>
                <h1 className="text-base font-bold uppercase mt-4 tracking-wider">
                  MATERIALIOJO TURTO INVENTORIZACIJOS APYRAŠAS
                </h1>
                <p className="text-xs font-sans font-semibold text-slate-800">{selectedSession.title}</p>
                <p className="text-xs font-sans mt-1">
                  Sesijos pradžia: {selectedSession.startDate}
                  {selectedSession.completedDate ? ` · Užbaigta: ${selectedSession.completedDate}` : ''} ·
                  Pagal įsakymą Nr. {selectedSession.orderNumber || 'Nenurodyta'} ({selectedSession.orderDate || 'Nenurodyta'})
                </p>
                <p className="text-xs font-sans font-semibold text-slate-700">
                  Padalinys / skyrius:{' '}
                  {selectedDeptId === 'all'
                    ? selectedSession.scopeDepartmentName || 'Visa gimnazija ir skyriai'
                    : departments.find((d) => d.id === selectedDeptId)?.name}
                </p>
              </div>

              <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded font-sans text-xs space-y-1">
                <div>
                  <strong>Komisijos pirmininkas:</strong> {activeChairmanDisplay}
                </div>
                <div>
                  <strong>Komisijos nariai:</strong>{' '}
                  {selectedSession.committeeMembers?.join(', ') || 'Nenurodyta'}
                </div>
              </div>

              <div className="mb-2 font-sans text-xs font-bold text-slate-800 uppercase tracking-wide">
                1. Pradinės sesijos apimties materialusis turtas ({scopedDeptRows.length} vnt.)
              </div>
              <table className="w-full border-collapse border border-slate-300 text-[11px] font-sans">
                <thead>
                  <tr className="bg-slate-100 text-slate-800">
                    <th className="border border-slate-300 p-1.5 text-center w-8">Nr.</th>
                    <th className="border border-slate-300 p-1.5 text-left w-24">Inv. Nr.</th>
                    <th className="border border-slate-300 p-1.5 text-left">Turto pavadinimas</th>
                    <th className="border border-slate-300 p-1.5 text-left w-32">Tikėtina patalpa</th>
                    <th className="border border-slate-300 p-1.5 text-left w-28">Atsakingas asmuo</th>
                    <th className="border border-slate-300 p-1.5 text-right w-16">Vertė, €</th>
                    <th className="border border-slate-300 p-1.5 text-center w-28">Rezultatas</th>
                    <th className="border border-slate-300 p-1.5 text-left w-36">Patikra / Pastabos</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedDeptRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="border border-slate-300 p-4 text-center text-slate-500">
                        Šiame skyriuje / sesijoje nėra pradinės apimties turto objektų.
                      </td>
                    </tr>
                  ) : (
                    scopedDeptRows.map((row, idx) => {
                      const rec = row.checkRecord;
                      return (
                        <tr key={row.itemId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                          <td className="border border-slate-300 p-1.5 text-center font-mono">{idx + 1}</td>
                          <td className="border border-slate-300 p-1.5 font-mono font-semibold">
                            {row.inventoryNumber}
                          </td>
                          <td className="border border-slate-300 p-1.5">
                            <span className="font-medium">{row.name}</span>
                            {row.serialNumber && (
                              <span className="text-[10px] text-slate-500 block font-mono">
                                SN: {row.serialNumber}
                              </span>
                            )}
                            {row.hasIncompleteHistory && (
                              <span className="text-[10px] text-amber-700 block">
                                (Senos sesijos įrašas be fiksuoto momentinio sąrašo)
                              </span>
                            )}
                          </td>
                          <td className="border border-slate-300 p-1.5 text-slate-700">
                            {row.expectedRoomName}
                            {row.expectedDepartmentCode ? ` (${row.expectedDepartmentCode})` : ''}
                          </td>
                          <td className="border border-slate-300 p-1.5 text-slate-700">
                            {row.responsibleUserName}
                          </td>
                          <td className="border border-slate-300 p-1.5 text-right font-mono tabular-nums">
                            {formatMoneyFixed(row.purchasePrice)}
                          </td>
                          <td className="border border-slate-300 p-1.5 text-center font-semibold">
                            {row.auditState === 'found' ? (
                              <span className="text-emerald-700">Rastas vietoje</span>
                            ) : row.auditState === 'found_elsewhere' ? (
                              <span className="text-amber-800">
                                Rastas kitur ({rec?.actualRoomName || 'kita patalpa'})
                              </span>
                            ) : row.auditState === 'missing' ? (
                              <span className="text-rose-700">Trūksta</span>
                            ) : (
                              <span className="text-slate-500">Dar nepatikrinta</span>
                            )}
                          </td>
                          <td className="border border-slate-300 p-1.5 text-[10px] text-slate-600">
                            {rec
                              ? `${rec.checkedByUserName}, ${METHOD_LABELS[rec.method]} (${getCalendarDatePart(rec.checkedAt)})`
                              : row.notes || '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {additionalDeptRows.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2 font-sans text-xs font-bold text-indigo-900 uppercase tracking-wide">
                    2. Papildomi radiniai (nebuvę pradiniame sesijos sąraše, {additionalDeptRows.length} vnt.)
                  </div>
                  <table className="w-full border-collapse border border-slate-300 text-[11px] font-sans">
                    <thead>
                      <tr className="bg-indigo-50 text-slate-800">
                        <th className="border border-slate-300 p-1.5 text-center w-8">Nr.</th>
                        <th className="border border-slate-300 p-1.5 text-left w-24">Inv. Nr.</th>
                        <th className="border border-slate-300 p-1.5 text-left">Turto pavadinimas</th>
                        <th className="border border-slate-300 p-1.5 text-left w-32">Priskirta vieta → Rasta</th>
                        <th className="border border-slate-300 p-1.5 text-left w-28">Atsakingas asmuo</th>
                        <th className="border border-slate-300 p-1.5 text-right w-16">Vertė, €</th>
                        <th className="border border-slate-300 p-1.5 text-left w-40">Patikra / Pastabos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {additionalDeptRows.map((row, idx) => {
                        const rec = row.checkRecord;
                        return (
                          <tr key={row.itemId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <td className="border border-slate-300 p-1.5 text-center font-mono">{idx + 1}</td>
                            <td className="border border-slate-300 p-1.5 font-mono font-semibold">
                              {row.inventoryNumber}
                            </td>
                            <td className="border border-slate-300 p-1.5">
                              <span className="font-medium">{row.name}</span>
                              {row.serialNumber && (
                                <span className="text-[10px] text-slate-500 block font-mono">
                                  SN: {row.serialNumber}
                                </span>
                              )}
                              {row.excludedStatusException && (
                                <span className="text-[10px] text-rose-700 block font-semibold">
                                  Išimtis: statusas buvo neįtrauktas į sesijos apimtį
                                </span>
                              )}
                              {row.hasIncompleteHistory && (
                                <span className="text-[10px] text-amber-700 block">
                                  Riboti senos sesijos duomenys (trūksta momentinės informacijos)
                                </span>
                              )}
                            </td>
                            <td className="border border-slate-300 p-1.5 text-slate-700">
                              <div>
                                {row.expectedDepartmentName} ({row.expectedRoomName})
                              </div>
                              <div className="font-semibold text-amber-800">
                                → {rec?.actualRoomName || '—'}
                              </div>
                            </td>
                            <td className="border border-slate-300 p-1.5 text-slate-700">
                              {row.responsibleUserName}
                            </td>
                            <td className="border border-slate-300 p-1.5 text-right font-mono tabular-nums">
                              {formatMoneyFixed(row.purchasePrice)}
                            </td>
                            <td className="border border-slate-300 p-1.5 text-[10px] text-slate-600">
                              {rec
                                ? `${rec.checkedByUserName}, ${METHOD_LABELS[rec.method]} (${getCalendarDatePart(rec.checkedAt)})`
                                : row.notes || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {(() => {
                const printStats = computeAuditStats(scopedDeptRows);
                const hasAnyIncompleteHistory = deptFilteredRows.some((r) => r.hasIncompleteHistory);
                return (
                  <div className="mt-4 space-y-2 border-t pt-2 border-slate-300 font-sans text-xs">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        Pradinėje apimtyje: <strong>{printStats.total} vnt.</strong>
                      </span>
                      <span>
                        Rasta vietoje: <strong className="text-emerald-800">{printStats.foundInPlaceCount} vnt.</strong>
                      </span>
                      <span>
                        Rasta kitur: <strong className="text-amber-800">{printStats.foundElsewhereCount} vnt.</strong>
                      </span>
                      <span>
                        Trūksta: <strong className="text-rose-800">{printStats.missingCount} vnt.</strong>
                      </span>
                      <span>
                        Dar nepatikrinta: <strong className="text-slate-700">{printStats.uncheckedCount} vnt.</strong>
                      </span>
                      {additionalDeptRows.length > 0 && (
                        <span>
                          Papildomi radiniai:{' '}
                          <strong className="text-indigo-900">{additionalDeptRows.length} vnt.</strong>
                        </span>
                      )}
                    </div>
                    {hasAnyIncompleteHistory && (
                      <p className="text-[11px] text-amber-800">
                        Pastaba: dalyje senesnių sesijų įrašų nėra išsaugotų momentinių duomenų – trūkstama istorija nėra dirbtinai atkuriama.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="mt-10 pt-6 border-t border-slate-300 space-y-6 font-sans print-avoid-break">
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-slate-600 block text-[11px]">Komisijos pirmininkas:</span>
                    <strong className="text-xs">{activeChairmanDisplay}</strong>
                  </div>
                  <div className="w-48 border-b border-slate-800 text-center text-[10px] text-slate-400 pb-0.5">
                    (parašas)
                  </div>
                </div>

                {selectedSession.committeeMembers?.map((member, i) => (
                  <div key={i} className="flex justify-between items-end">
                    <div>
                      <span className="text-slate-600 block text-[11px]">Komisijos narys:</span>
                      <strong className="text-xs">{member}</strong>
                    </div>
                    <div className="w-48 border-b border-slate-800 text-center text-[10px] text-slate-400 pb-0.5">
                      (parašas)
                    </div>
                  </div>
                ))}
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
