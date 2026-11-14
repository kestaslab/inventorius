import { InventoryItem, WriteOffAct } from '../types/inventory';

export function getWriteOffActYear(act: WriteOffAct): number {
  if (typeof act.actYear === 'number' && Number.isFinite(act.actYear)) {
    return act.actYear;
  }
  if (act.approvedDate && /^\d{4}/.test(act.approvedDate)) {
    return Number(act.approvedDate.slice(0, 4));
  }
  if (act.date && /^\d{4}/.test(act.date)) {
    return Number(act.date.slice(0, 4));
  }
  return new Date().getFullYear();
}

export function filterWriteOffActsByYear(
  acts: WriteOffAct[],
  filterActYear: 'all' | number
): WriteOffAct[] {
  if (filterActYear === 'all') return acts;
  return acts.filter((a) => getWriteOffActYear(a) === filterActYear);
}

export function resolveActiveWriteOffAct(
  displayedActs: WriteOffAct[],
  selectedWriteOffActId: string
): WriteOffAct | null {
  if (!displayedActs || displayedActs.length === 0) return null;
  return displayedActs.find((a) => a.id === selectedWriteOffActId) || displayedActs[0] || null;
}

export function isWriteOffActNumberUnique(
  acts: WriteOffAct[],
  actNumber: string,
  excludeActId?: string
): boolean {
  const normalized = actNumber.trim().toUpperCase();
  if (!normalized) return false;
  return !acts.some(
    (a) => a.id !== excludeActId && a.actNumber.trim().toUpperCase() === normalized
  );
}

export function generateNextWriteOffActNumber(
  acts: WriteOffAct[],
  year: number = new Date().getFullYear()
): string {
  const prefix = `NUR-${year}-`;
  let maxSeq = 0;
  for (const act of acts) {
    const raw = (act.actNumber || '').trim().toUpperCase();
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      const parsed = parseInt(rest, 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }
  let nextSeq = maxSeq + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  while (!isWriteOffActNumberUnique(acts, candidate)) {
    nextSeq += 1;
    candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  }
  return candidate;
}

export function findActiveDraftActForItem(
  acts: WriteOffAct[],
  item: Pick<InventoryItem, 'id' | 'writeOffActId'>
): WriteOffAct | undefined {
  if (item.writeOffActId) {
    const direct = acts.find(
      (a) =>
        a.id === item.writeOffActId &&
        a.status === 'draft' &&
        a.items.some((ai) => ai.itemId === item.id)
    );
    if (direct) return direct;
  }
  return acts.find(
    (a) => a.status === 'draft' && a.items.some((ai) => ai.itemId === item.id)
  );
}

export type WriteOffIntegrityKind =
  | 'duplicate_act_number'
  | 'multi_draft_item'
  | 'orphan_to_writeoff'
  | 'stale_draft_item'
  | 'approved_act_item_mismatch'
  | 'written_off_missing_act_link'
  | 'written_off_without_act';

export interface WriteOffIntegrityIssue {
  id: string;
  kind: WriteOffIntegrityKind;
  message: string;
  itemId?: string;
  actId?: string;
  matchingActId?: string;
  canReturnToActive?: boolean;
  canRemoveFromDraftAct?: boolean;
  canLinkExistingAct?: boolean;
}

export function analyzeWriteOffIntegrity(
  items: InventoryItem[],
  writeOffActs: WriteOffAct[]
): WriteOffIntegrityIssue[] {
  const issues: WriteOffIntegrityIssue[] = [];
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const actMap = new Map(writeOffActs.map((a) => [a.id, a]));

  // 1. Dubliuoti aktų numeriai
  const seenActNumbers = new Map<string, WriteOffAct>();
  for (const act of writeOffActs) {
    const norm = act.actNumber.trim().toUpperCase();
    if (!norm) continue;
    const prev = seenActNumbers.get(norm);
    if (prev) {
      issues.push({
        id: `dup-act-${act.id}`,
        kind: 'duplicate_act_number',
        actId: act.id,
        message: `Pasikartojantis nurašymo akto numeris „${act.actNumber}“ (aktai ${prev.id} ir ${act.id}). Rekomenduojama patikrinti numeraciją.`,
      });
    } else {
      seenActNumbers.set(norm, act);
    }
  }

  // 2. Daiktai keliuose aktyviuose projektuose ir juodraščių neatitikimai
  const draftActsPerItem = new Map<string, WriteOffAct[]>();
  for (const act of writeOffActs) {
    if (act.status === 'draft') {
      for (const ai of act.items) {
        const list = draftActsPerItem.get(ai.itemId) || [];
        list.push(act);
        draftActsPerItem.set(ai.itemId, list);

        const target = itemMap.get(ai.itemId);
        if (!target) {
          issues.push({
            id: `stale-draft-missing-${act.id}-${ai.itemId}`,
            kind: 'stale_draft_item',
            actId: act.id,
            itemId: ai.itemId,
            canRemoveFromDraftAct: true,
            message: `Nurašymo projekto „${act.actNumber}“ įrašas [${ai.inventoryNumber}] „${ai.name}“ nebeegzistuoja inventoriaus sąraše.`,
          });
        } else if (target.status !== 'to_writeoff') {
          issues.push({
            id: `stale-draft-status-${act.id}-${ai.itemId}`,
            kind: 'stale_draft_item',
            actId: act.id,
            itemId: ai.itemId,
            canRemoveFromDraftAct: true,
            message: `Nurašymo projekte „${act.actNumber}“ įtrauktas daiktas [${target.inventoryNumber}] „${target.name}“, kurio dabartinė būsena yra „${target.status}“ (ne „to_writeoff“).`,
          });
        }
      }
    } else if (act.status === 'approved') {
      for (const ai of act.items) {
        const target = itemMap.get(ai.itemId);
        if (!target) {
          issues.push({
            id: `approved-missing-item-${act.id}-${ai.itemId}`,
            kind: 'approved_act_item_mismatch',
            actId: act.id,
            itemId: ai.itemId,
            message: `Patvirtintame akte „${act.actNumber}“ nurodytas daiktas [${ai.inventoryNumber}] „${ai.name}“ inventoriaus sąraše nerastas.`,
          });
          continue;
        }

        const wasRestoredFromThisAct = (target.writeOffHistory || []).some(
          (h) =>
            h.restoredAt &&
            ((h.actId && h.actId === act.id) ||
              (h.actNumber &&
                h.actNumber.trim().toUpperCase() === act.actNumber.trim().toUpperCase()))
        );

        if (target.status !== 'written_off' && !wasRestoredFromThisAct) {
          issues.push({
            id: `approved-status-mismatch-${act.id}-${target.id}`,
            kind: 'approved_act_item_mismatch',
            actId: act.id,
            itemId: target.id,
            message: `Patvirtintas aktas „${act.actNumber}“ nurodo daiktą [${target.inventoryNumber}] „${target.name}“, tačiau daiktas nėra nurašytas ir neturi atkūrimo iš archyvo įrašo.`,
          });
        }
      }
    }
  }

  for (const [itemId, draftList] of draftActsPerItem.entries()) {
    if (draftList.length > 1) {
      const target = itemMap.get(itemId);
      issues.push({
        id: `multi-draft-${itemId}`,
        kind: 'multi_draft_item',
        itemId,
        message: `Turtas [${target?.inventoryNumber || itemId}] yra įtrauktas į kelis aktyvius nurašymo projektus: ${draftList.map((a) => a.actNumber).join(', ')}.`,
      });
    }
  }

  // 3. Daiktai būsenoje 'to_writeoff' arba 'written_off' be susieto akto
  for (const item of items) {
    if (item.status === 'to_writeoff') {
      const draftList = draftActsPerItem.get(item.id) || [];
      if (draftList.length === 0) {
        issues.push({
          id: `orphan-to-writeoff-${item.id}`,
          kind: 'orphan_to_writeoff',
          itemId: item.id,
          canReturnToActive: true,
          message: `Turtas [${item.inventoryNumber}] „${item.name}“ pažymėtas kaip „Teikiamas nurašyti“, tačiau nėra įtrauktas nė į vieną aktyvų nurašymo projektą.`,
        });
      }
    } else if (item.status === 'written_off') {
      const linkedAct = item.writeOffActId ? actMap.get(item.writeOffActId) : undefined;
      const matchesById =
        linkedAct &&
        linkedAct.status === 'approved' &&
        linkedAct.items.some((ai) => ai.itemId === item.id);

      if (!matchesById) {
        const byNumber = item.writeOffActNumber
          ? writeOffActs.find(
              (a) =>
                a.status === 'approved' &&
                a.actNumber.trim().toUpperCase() === item.writeOffActNumber!.trim().toUpperCase() &&
                a.items.some((ai) => ai.itemId === item.id)
            )
          : undefined;

        if (byNumber) {
          issues.push({
            id: `missing-act-id-${item.id}`,
            kind: 'written_off_missing_act_link',
            itemId: item.id,
            matchingActId: byNumber.id,
            canLinkExistingAct: true,
            message: `Archyvinis daiktas [${item.inventoryNumber}] „${item.name}“ nurodo aktą „${item.writeOffActNumber}“, bet trūksta susieto akto ID (${byNumber.id}). Galima saugiai susieti su esamu aktu.`,
          });
        } else {
          issues.push({
            id: `writtenoff-no-act-${item.id}`,
            kind: 'written_off_without_act',
            itemId: item.id,
            message: `Archyvinis daiktas [${item.inventoryNumber}] „${item.name}“ pažymėtas kaip nurašytas${item.writeOffActNumber ? ` (${item.writeOffActNumber})` : ''}, tačiau nerastas atitinkamas patvirtintas nurašymo aktas.`,
          });
        }
      }
    }
  }

  return issues;
}
