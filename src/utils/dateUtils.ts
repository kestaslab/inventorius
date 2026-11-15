export const TIMEZONE_VILNIUS = 'Europe/Vilnius';

const vilniusDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE_VILNIUS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const vilniusDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE_VILNIUS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getTodayVilniusDate(now: Date = new Date()): string {
  const parts = vilniusDateFormatter.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

export function getCurrentYearVilnius(now: Date = new Date()): number {
  return Number(getTodayVilniusDate(now).slice(0, 4));
}

export function parseCalendarDateParts(
  value?: string | null
): { year: number; month: number; day: number } | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function getCalendarYearFromDate(value?: string | null): number | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const parts = parseCalendarDateParts(trimmed);
  if (parts) return parts.year;
  // Jei perduotas ISO laikas su T ir zona, paverčiame į Europe/Vilnius kalendorinę datą
  const vilniusDate = getCalendarDatePart(trimmed);
  const dateParts = parseCalendarDateParts(vilniusDate);
  if (dateParts) return dateParts.year;
  const leading = /^(\d{4})/.exec(trimmed);
  if (leading) {
    const yr = Number(leading[1]);
    return Number.isInteger(yr) ? yr : undefined;
  }
  return undefined;
}

export function getCalendarDatePart(value?: string | null): string {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const hasTimeZone =
    /^\d{4}-\d{2}-\d{2}T/.test(trimmed) &&
    (trimmed.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed));
  if (hasTimeZone) {
    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) {
      return getTodayVilniusDate(dt);
    }
  }
  const leadingDate = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (leadingDate) return leadingDate[1];
  const dt = new Date(trimmed);
  if (!Number.isNaN(dt.getTime())) {
    return getTodayVilniusDate(dt);
  }
  return trimmed;
}

export function formatDateTimeVilnius(value?: string | null): string {
  if (!value || typeof value !== 'string') return '—';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 16);
  }
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) {
    return trimmed;
  }
  const parts = vilniusDateTimeFormatter.formatToParts(dt);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  const rawHour = parts.find((p) => p.type === 'hour')?.value || '00';
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${y}-${m}-${d} ${hour}:${minute}`;
}

export function calculateCalendarAgeYears(
  acquisitionDate: string,
  referenceDate: string = getTodayVilniusDate()
): number {
  const acq = parseCalendarDateParts(getCalendarDatePart(acquisitionDate));
  const ref = parseCalendarDateParts(getCalendarDatePart(referenceDate));
  if (!acq || !ref) return 0;
  const acqUtc = Date.UTC(acq.year, acq.month - 1, acq.day);
  const refUtc = Date.UTC(ref.year, ref.month - 1, ref.day);
  const diffDays = (refUtc - acqUtc) / (1000 * 60 * 60 * 24);
  return Math.max(0, diffDays / 365.25);
}
