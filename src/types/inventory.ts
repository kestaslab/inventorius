export type UserRole = 'admin' | 'manager' | 'teacher' | 'auditor';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  roleTitle: string; // e.g. "Ūkio dalies vedėjas", "Mokytojas", "IT administratorius"
  departmentId?: string;
  assignedRoomId?: string; // Pirminis kabinetas (suderinamumui)
  assignedRoomIds?: string[]; // Priskirti keli kabinetai / patalpos (pvz. kabinetas, sandėliukas, aktų salė)
  phone?: string;
  avatarUrl?: string;
  pinCode?: string; // 4-6 skaitmenų PIN greitam prisijungimui
  isActive?: boolean; // ar vartotojas aktyvus, ar prieiga deaktyvuota
  allowedGmail?: string; // jei skiriasi nuo darbinio el. pašto
  lastLoginAt?: string;
}

export const getUserAssignedRoomIds = (user?: User | null): string[] => {
  if (!user) return [];
  const set = new Set<string>();
  if (Array.isArray(user.assignedRoomIds)) {
    user.assignedRoomIds.forEach(id => { if (id) set.add(id); });
  }
  if (user.assignedRoomId) {
    set.add(user.assignedRoomId);
  }
  return Array.from(set);
};


export interface AuthSettings {
  allowOnlyWhitelistedEmails: boolean; // ar leisti tik iš anksto patvirtintus el. paštus
  allowedSchoolDomain: string; // pvz. 'tryskiumokykla.lt'
  whitelistedEmails: string[]; // leidžiami konkretūs Gmail arba kiti adresai
  requirePinForAdmin: boolean; // reikalauti PIN kodo admin veiksmams
  adminPin: string; // numatytasis arba admin nustatytas PIN (pvz. '1234')
}

export interface Department {
  id: string;
  name: string;
  code: string;
  building: string;
  description: string;
  managerId?: string;
}

export interface Room {
  id: string;
  departmentId: string;
  number?: string; // Neprivalomas (jei mokykloje kabinetai vadinami tiesiog vardais, pvz., 'Lietuvių kalbos kabinetas nr. 1')
  name: string;
  floor: number;
  defaultResponsiblePersonId?: string;
  notes?: string;
}

export const formatRoomName = (room?: { number?: string; name: string } | null, withKabSuffix: boolean = false): string => {
  if (!room) return 'Nenurodyta';
  const num = room.number?.trim();
  if (num) {
    return withKabSuffix ? `${num} kab. ${room.name}` : `${num} ${room.name}`;
  }
  return room.name;
};


export type ItemCategory = 
  | 'Kompiuteriai'
  | 'Kita IT įranga'
  | 'Baldai'
  | 'Mokymo priemonės'
  | 'Sporto inventorius'
  | 'Buitinė ir virtuvės technika'
  | 'Muzikos instrumentai'
  | 'Laboratorinė įranga'
  | 'Kita';

export type ItemStatus = 'active' | 'in_repair' | 'to_writeoff' | 'written_off';
export type ItemCondition = 'new' | 'good' | 'fair' | 'poor';

export type AssetClass = 'long_term' | 'short_term'; // long_term: >= 750 EUR (IMT), short_term: < 750 EUR (TMT)
export type FundingSource = 'school' | 'municipality' | 'ministry' | 'project' | 'donation';

export const LONG_TERM_THRESHOLD = 750; // EUR

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  long_term: 'Ilgalaikis turtas (IMT, ≥ 750 €)',
  short_term: 'Trumpalaikis / Mažavertis (< 750 €)',
};

export const ASSET_CLASS_SHORT_LABELS: Record<AssetClass, string> = {
  long_term: 'Ilgalaikis (IMT)',
  short_term: 'Trumpalaikis (TMT)',
};

export const FUNDING_SOURCE_LABELS: Record<FundingSource, string> = {
  school: 'Gimnazijos lėšos (Mokyklos biudžetas)',
  municipality: 'Savivaldybės panauda (Telšių r. sav.)',
  ministry: 'ŠMSM panauda (Ministerijos centralizuotas tiekimas)',
  project: 'ES / Valstybiniai projektai (STEAM, TŪM)',
  donation: 'Kita (dovana, rėmėjai ir kt.)',
};

export const FUNDING_SOURCE_SHORT_LABELS: Record<FundingSource, string> = {
  school: 'Gimnazijos lėšos',
  municipality: 'Savivaldybės panauda',
  ministry: 'ŠMSM panauda',
  project: 'ES / Projektai',
  donation: 'Kita',
};

export type ComputerType = 'laptop' | 'desktop' | 'server' | 'tablet';

export const COMPUTER_TYPE_LABELS: Record<ComputerType, string> = {
  laptop: 'Nešiojamas kompiuteris',
  desktop: 'Stacionarus kompiuteris',
  server: 'Serveris',
  tablet: 'Planšetinis kompiuteris',
};

export const COMPUTER_TYPE_SHORT_LABELS: Record<ComputerType, string> = {
  laptop: 'Nešiojamas',
  desktop: 'Stacionarus',
  server: 'Serveris',
  tablet: 'Planšetė',
};

export interface ComputerSpecs {
  computerType?: ComputerType;
  cpu?: string; // pvz.: 'Intel Core i5-1135G7', 'AMD Ryzen 5 5600G'
  ramGb?: number; // pvz.: 4, 8, 16, 32, 64
  storage?: string; // pvz.: '256 GB NVMe SSD', '512 GB SSD', '1 TB HDD'
  os?: string; // pvz.: 'Windows 11 Pro', 'Windows 10 Pro', 'ChromeOS', 'Ubuntu Linux', 'iPadOS', 'Android'
  screenSize?: string; // pvz.: '14"', '15.6"', '10.2"'
  gpu?: string; // pvz.: 'Intel Iris Xe', 'NVIDIA RTX 3050', 'Integruota'
  macAddress?: string; // tinklo plokštės MAC adresas
}

export interface DefectReport {
  id: string;
  reportedAt: string; // ISO format
  reportedByUserId: string;
  reportedByUserName: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'reported' | 'in_repair' | 'resolved';
  photoUrl?: string;
  resolutionNotes?: string;
}

export interface InventoryItem {
  id: string;
  inventoryNumber: string; // e.g. TM-2023-0042
  serialNumber?: string;
  name: string;
  category: ItemCategory;
  departmentId: string;
  roomId: string;
  responsibleUserId: string;
  acquisitionDate: string; // YYYY-MM-DD
  purchasePrice: number; // EUR
  residualValue?: number; // EUR
  assetClass: AssetClass; // Ilgalaikis (>= 750€) arba Trumpalaikis (< 750€)
  fundingSource: FundingSource; // Mokyklos lėšos, Savivaldybės panauda, ŠMSM ir pan.
  status: ItemStatus;
  condition: ItemCondition;
  notes?: string;
  lastAuditDate?: string;
  barcode?: string;
  photoUrl?: string; // Base64 data URL or photo path taken via phone/camera
  specs?: ComputerSpecs; // IT / kompiuterių techninė specifikacija
  writtenOffDate?: string; // YYYY-MM-DD
  writtenOffYear?: number; // pvz., 2020, 2025, 2026
  writeOffActNumber?: string; // pvz., NUR-2025-01
  writeOffReason?: string;
  writeOffActId?: string;
  defectReports?: DefectReport[]; // Gedimų pranešimų istorija
  activeDefectNote?: string; // Aktyvaus gedimo santrauka
}

export interface MovementRecord {
  id: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  fromDepartmentId: string;
  fromRoomId: string;
  toDepartmentId: string;
  toRoomId: string;
  fromUserId: string;
  toUserId: string;
  date: string; // YYYY-MM-DD HH:mm
  reason: string;
  actNumber: string;
}

export interface WriteOffActItem {
  itemId: string;
  name: string;
  inventoryNumber: string;
  price: number;
  residualPrice: number;
  reason: string;
}

export interface WriteOffAct {
  id: string;
  actNumber: string; // e.g. NUR-2026-04
  date: string;
  actYear?: number; // Metai archyvavimui (pvz. 2020, 2025, 2026)
  status: 'draft' | 'approved';
  committeeChair: string;
  committeeMembers: string[];
  reasonCategory: string; // 'Fizinis nusidėvėjimas' | 'Moralinis pasenimas' | 'Gedimas (neremontuotinas)'
  items: WriteOffActItem[];
  notes?: string;
  approvedDate?: string;
}

export interface TransferAct {
  id: string;
  actNumber: string;
  date: string;
  fromUser: string;
  toUser: string;
  fromRoom: string;
  toRoom: string;
  reason: string;
  items: {
    inventoryNumber: string;
    name: string;
    serialNumber?: string;
    price: number;
  }[];
}

export interface AuditSession {
  id: string;
  year: number;
  title: string;
  status: 'in_progress' | 'completed';
  startDate: string;
  completedDate?: string;
  departmentId?: string; // Optional: specific department or all
  scannedItemIds: string[];
  missingItemIds: string[];
  relocatedItemIds: string[];
  committeeMembers: string[];
  notes?: string;
}

export interface AuditScanLog {
  id: string;
  sessionId: string;
  itemId: string;
  inventoryNumber: string;
  name: string;
  scannedAt: string;
  scannedBy: string;
  expectedRoomId: string;
  actualRoomId: string;
  status: 'matched' | 'relocated' | 'unknown';
}
