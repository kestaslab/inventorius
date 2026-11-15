import {
  DefectReport,
  InventoryItem,
  Room,
  User,
  getUserAssignedRoomIds,
} from '../types/inventory';
import { sumMoney } from './accountingUtils';

export function isDefectActive(report: DefectReport): boolean {
  return report.status === 'reported' || report.status === 'in_repair';
}

export function getActiveDefects(item: Pick<InventoryItem, 'defectReports'>): DefectReport[] {
  return (item.defectReports || []).filter(isDefectActive);
}

export function getReportedDefects(item: Pick<InventoryItem, 'defectReports'>): DefectReport[] {
  return (item.defectReports || []).filter((r) => r.status === 'reported');
}

export function getInRepairDefects(item: Pick<InventoryItem, 'defectReports'>): DefectReport[] {
  return (item.defectReports || []).filter((r) => r.status === 'in_repair');
}

export function getResolvedDefects(item: Pick<InventoryItem, 'defectReports'>): DefectReport[] {
  return (item.defectReports || []).filter((r) => r.status === 'resolved');
}

export function computeActiveDefectNote(reports?: DefectReport[]): string | undefined {
  if (!reports || reports.length === 0) return undefined;
  const active = reports.filter(isDefectActive);
  if (active.length === 0) return undefined;
  return active[active.length - 1].description;
}

export function canStartDefectRepair(
  item: InventoryItem,
  defect: DefectReport
): { allowed: boolean; reason?: string } {
  if (item.status === 'written_off') {
    return {
      allowed: false,
      reason:
        'Nurašyto (archyvuoto) turto negalima perkelti į remontą. Pirmiausia atkurkite turtą iš archyvo.',
    };
  }
  if (item.status === 'to_writeoff') {
    return {
      allowed: false,
      reason:
        'Turtas yra pateiktas nurašymui. Nurašymo procesas turi pirmenybę – pirmiausia atmeskite arba atšaukite nurašymo teikimą.',
    };
  }
  if (defect.status === 'resolved') {
    return {
      allowed: false,
      reason: 'Šis gedimas jau pažymėtas kaip išspręstas.',
    };
  }
  if (defect.status === 'in_repair') {
    return {
      allowed: false,
      reason: 'Šio gedimo remontas jau pradėtas.',
    };
  }
  return { allowed: true };
}

/**
 * Vieninga patikra, ar daiktas priklauso naudotojo asmeninei ar valdomų kabinetų sričiai.
 * Naudojama tiek šoninėje juostoje (`Sidebar`), tiek „Mano inventorius“ ekrane.
 */
export function isItemAssignedToUserScope(
  item: InventoryItem,
  user: User,
  rooms: Room[]
): boolean {
  const userRoomIds = getUserAssignedRoomIds(user);
  if (item.responsibleUserId === user.id) return true;
  if (item.roomId && userRoomIds.includes(item.roomId)) return true;
  const itemRoom = rooms.find((r) => r.id === item.roomId);
  if (itemRoom?.defaultResponsiblePersonId === user.id) return true;
  return false;
}

export interface MyInventorySummary {
  /** Priskirti kabinetai (pagal assignedRoomId / assignedRoomIds / defaultResponsiblePersonId) */
  userRooms: Room[];
  /** Visi priskirti daiktai (neįskaitant nurašytų – naudojama pagal nutylėjimą sąraše ir šoninės juostos skaitiklyje) */
  assignedItems: InventoryItem[];
  /** Nurašyti (archyvo) daiktai, priskirti šiam darbuotojui/kabinetui – atskirti nuo aktyvaus sąrašo */
  writtenOffItems: InventoryItem[];
  /** Veikiantys (active) daiktai iš assignedItems */
  operationalItemsCount: number;
  /** Daiktai, kuriems šiuo metu vyksta remontas (status === 'in_repair') */
  inRepairItemsCount: number;
  /** Daiktai su neužbaigtais gedimais ('reported' arba 'in_repair') arba status === 'in_repair' */
  activeDefectItemsCount: number;
  /** Bendras aktyvių (neištisai išspręstų) gedimų skaičius */
  activeDefectReportsCount: number;
  /** Istorinių išspręstų gedimų skaičius */
  resolvedDefectReportsCount: number;
  /** Bendra aktyvaus priskirto turto įsigijimo vertė (be nurašytų) */
  totalPurchaseValue: number;
}

/**
 * Bendra atrankos ir suvestinių taisyklė šoninės juostos skaitikliui ir „Mano inventoriaus“ ekranui.
 */
export function getMyInventorySummary(
  items: InventoryItem[],
  user: User | null | undefined,
  rooms: Room[]
): MyInventorySummary {
  if (!user) {
    return {
      userRooms: [],
      assignedItems: [],
      writtenOffItems: [],
      operationalItemsCount: 0,
      inRepairItemsCount: 0,
      activeDefectItemsCount: 0,
      activeDefectReportsCount: 0,
      resolvedDefectReportsCount: 0,
      totalPurchaseValue: 0,
    };
  }

  const userRoomIds = getUserAssignedRoomIds(user);
  const userRooms = rooms.filter(
    (r) => userRoomIds.includes(r.id) || r.defaultResponsiblePersonId === user.id
  );

  const scopedAll = items.filter((item) => isItemAssignedToUserScope(item, user, rooms));
  const assignedItems = scopedAll.filter((item) => item.status !== 'written_off');
  const writtenOffItems = scopedAll.filter((item) => item.status === 'written_off');

  let activeDefectItemsCount = 0;
  let activeDefectReportsCount = 0;
  let resolvedDefectReportsCount = 0;
  let inRepairItemsCount = 0;
  let operationalItemsCount = 0;

  for (const item of assignedItems) {
    const activeDefects = getActiveDefects(item);
    const resolvedDefects = getResolvedDefects(item);
    activeDefectReportsCount += activeDefects.length;
    resolvedDefectReportsCount += resolvedDefects.length;

    if (item.status === 'active') {
      operationalItemsCount += 1;
    }
    if (item.status === 'in_repair') {
      inRepairItemsCount += 1;
    }
    if (item.status === 'in_repair' || activeDefects.length > 0) {
      activeDefectItemsCount += 1;
    }
  }

  return {
    userRooms,
    assignedItems,
    writtenOffItems,
    operationalItemsCount,
    inRepairItemsCount,
    activeDefectItemsCount,
    activeDefectReportsCount,
    resolvedDefectReportsCount,
    totalPurchaseValue: sumMoney(assignedItems.map((i) => Number(i.purchasePrice) || 0)),
  };
}
