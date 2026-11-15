import {
  AssetClass,
  Department,
  FundingSource,
  InventoryItem,
  LONG_TERM_THRESHOLD,
} from '../types/inventory';

export function toCents(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function roundMoney(value?: number | null): number {
  return fromCents(toCents(value));
}

export function sumMoney(values: Array<number | undefined | null>): number {
  let totalCents = 0;
  for (const val of values) {
    totalCents += toCents(val);
  }
  return fromCents(totalCents);
}

export function formatMoneyLt(value?: number | null, withSymbol: boolean = true): string {
  const rounded = roundMoney(value);
  const formatted = rounded.toLocaleString('lt-LT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `${formatted} €` : formatted;
}

export function formatMoneyFixed(value?: number | null): string {
  return roundMoney(value).toFixed(2);
}

/**
 * Vieninga IMT / TMT klasifikacija visai sistemai:
 * - Jei įraše aiškiai nurodyta `assetClass` ('long_term' arba 'short_term'), visada gerbiamas tiesioginis priskyrimas.
 * - Tik tada, kai `assetClass` nenurodytas, taikoma 750 € įsigijimo kainos riba.
 */
export function resolveAssetClass(
  item: Pick<InventoryItem, 'purchasePrice'> & { assetClass?: AssetClass | string }
): AssetClass {
  if (item.assetClass === 'long_term' || item.assetClass === 'short_term') {
    return item.assetClass;
  }
  return Number(item.purchasePrice) >= LONG_TERM_THRESHOLD ? 'long_term' : 'short_term';
}

export function resolveFundingSource(
  item: { fundingSource?: FundingSource | string }
): FundingSource {
  const src = item.fundingSource;
  if (
    src === 'school' ||
    src === 'municipality' ||
    src === 'ministry' ||
    src === 'project' ||
    src === 'donation'
  ) {
    return src;
  }
  return 'school';
}

export interface ResidualValueSummary {
  knownTotal: number;
  knownCount: number;
  missingCount: number;
  totalCount: number;
  allSpecified: boolean;
}

export function summarizeResidualValues(
  entries: Array<{ residualValue?: number | null }>
): ResidualValueSummary {
  let knownCents = 0;
  let knownCount = 0;
  let missingCount = 0;

  for (const entry of entries) {
    if (typeof entry.residualValue === 'number' && Number.isFinite(entry.residualValue)) {
      knownCents += toCents(entry.residualValue);
      knownCount++;
    } else {
      missingCount++;
    }
  }

  return {
    knownTotal: fromCents(knownCents),
    knownCount,
    missingCount,
    totalCount: entries.length,
    allSpecified: missingCount === 0,
  };
}

export interface DepartmentSummaryEntry {
  department: Department;
  itemsCount: number;
  totalPurchaseValue: number;
  residualSummary: ResidualValueSummary;
}

export interface InventorySummary {
  scopeItemsCount: number;
  statusCounts: {
    active: number;
    in_repair: number;
    to_writeoff: number;
    written_off: number;
  };
  nonWrittenOffTotalCount: number;
  writtenOffTotalCount: number;
  writtenOffPurchaseValue: number;
  totalPurchaseValue: number;
  residualSummary: ResidualValueSummary;
  longTerm: {
    count: number;
    purchaseValue: number;
  };
  shortTerm: {
    count: number;
    purchaseValue: number;
  };
  funding: Record<FundingSource, { count: number; purchaseValue: number }>;
  departments: DepartmentSummaryEntry[];
}

export function computeInventorySummary(
  allItems: InventoryItem[],
  departments: Department[],
  options: { includeWrittenOff?: boolean } = {}
): InventorySummary {
  const statusCounts = {
    active: 0,
    in_repair: 0,
    to_writeoff: 0,
    written_off: 0,
  };

  let writtenOffCents = 0;
  for (const item of allItems) {
    if (item.status === 'active') statusCounts.active++;
    else if (item.status === 'in_repair') statusCounts.in_repair++;
    else if (item.status === 'to_writeoff') statusCounts.to_writeoff++;
    else if (item.status === 'written_off') {
      statusCounts.written_off++;
      writtenOffCents += toCents(item.purchasePrice);
    }
  }

  const scopedItems = options.includeWrittenOff
    ? allItems
    : allItems.filter((item) => item.status !== 'written_off');

  let totalPurchaseCents = 0;
  let longTermCount = 0;
  let longTermCents = 0;
  let shortTermCount = 0;
  let shortTermCents = 0;

  const fundingCents: Record<FundingSource, { count: number; cents: number }> = {
    school: { count: 0, cents: 0 },
    municipality: { count: 0, cents: 0 },
    ministry: { count: 0, cents: 0 },
    project: { count: 0, cents: 0 },
    donation: { count: 0, cents: 0 },
  };

  for (const item of scopedItems) {
    const priceCents = toCents(item.purchasePrice);
    totalPurchaseCents += priceCents;

    if (resolveAssetClass(item) === 'long_term') {
      longTermCount++;
      longTermCents += priceCents;
    } else {
      shortTermCount++;
      shortTermCents += priceCents;
    }

    const src = resolveFundingSource(item);
    fundingCents[src].count++;
    fundingCents[src].cents += priceCents;
  }

  const deptBreakdown: DepartmentSummaryEntry[] = departments.map((dept) => {
    const deptItems = scopedItems.filter((i) => i.departmentId === dept.id);
    return {
      department: dept,
      itemsCount: deptItems.length,
      totalPurchaseValue: sumMoney(deptItems.map((i) => i.purchasePrice)),
      residualSummary: summarizeResidualValues(deptItems),
    };
  });

  return {
    scopeItemsCount: scopedItems.length,
    statusCounts,
    nonWrittenOffTotalCount: statusCounts.active + statusCounts.in_repair + statusCounts.to_writeoff,
    writtenOffTotalCount: statusCounts.written_off,
    writtenOffPurchaseValue: fromCents(writtenOffCents),
    totalPurchaseValue: fromCents(totalPurchaseCents),
    residualSummary: summarizeResidualValues(scopedItems),
    longTerm: {
      count: longTermCount,
      purchaseValue: fromCents(longTermCents),
    },
    shortTerm: {
      count: shortTermCount,
      purchaseValue: fromCents(shortTermCents),
    },
    funding: {
      school: { count: fundingCents.school.count, purchaseValue: fromCents(fundingCents.school.cents) },
      municipality: {
        count: fundingCents.municipality.count,
        purchaseValue: fromCents(fundingCents.municipality.cents),
      },
      ministry: {
        count: fundingCents.ministry.count,
        purchaseValue: fromCents(fundingCents.ministry.cents),
      },
      project: { count: fundingCents.project.count, purchaseValue: fromCents(fundingCents.project.cents) },
      donation: {
        count: fundingCents.donation.count,
        purchaseValue: fromCents(fundingCents.donation.cents),
      },
    },
    departments: deptBreakdown,
  };
}
