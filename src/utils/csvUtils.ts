import { roundMoney } from './accountingUtils';

export type CsvCellValue = string | number | boolean | null | undefined;

export function encodeCsvField(value: CsvCellValue, delimiter: string = ';'): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  const mustQuote =
    raw.includes(delimiter) ||
    raw.includes('"') ||
    raw.includes('\n') ||
    raw.includes('\r') ||
    raw.startsWith(' ') ||
    raw.endsWith(' ');

  if (!mustQuote) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

export function formatCsvMoney(amount?: number | null): string {
  return roundMoney(amount).toFixed(2).replace('.', ',');
}

export function formatCsvOptionalMoney(amount?: number | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  return formatCsvMoney(amount);
}

export function buildCsvContent(
  headers: string[],
  rows: CsvCellValue[][],
  delimiter: string = ';'
): string {
  const headerLine = headers.map((h) => encodeCsvField(h, delimiter)).join(delimiter);
  const bodyLines = rows.map((row) =>
    row.map((cell) => encodeCsvField(cell, delimiter)).join(delimiter)
  );
  return '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
}
