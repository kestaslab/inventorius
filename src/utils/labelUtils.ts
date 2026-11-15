import { InventoryItem } from '../types/inventory';
import { buildItemQrPayload } from './qrUtils';

export type TapeWidth = 36 | 24 | 18;
export type LabelLength = 68 | 80 | 50;
export type CodeType = 'qr_code' | 'barcode_1d' | 'both';

export const CODE_TYPE_LABELS: Record<CodeType, string> = {
  qr_code: 'Tik QR kodas',
  barcode_1d: 'Tik 1D brūkšninis kodas',
  both: 'QR + 1D brūkšninis kodas',
};

export interface LabelFilterOptions {
  preSelectedIds?: string[];
  usePreselection?: boolean;
  departmentId?: string;
  roomId?: string;
  searchTerm?: string;
}

export type LabelPrintStatus = 'idle' | 'preparing' | 'awaiting_confirmation' | 'error';

export interface LabelPrintState {
  status: LabelPrintStatus;
  targetItemId?: string;
  errorMessage?: string;
}

/**
 * Grąžina vienmačio brūkšninio kodo reikšmę (palaikomą inventorizacijos skaitytuve).
 */
export function getBarcodeValue(item: Pick<InventoryItem, 'inventoryNumber' | 'barcode'>): string {
  return item.barcode?.trim() || item.inventoryNumber;
}

/**
 * Podėlio raktas, kuris automatiškai pasikeičia pasikeitus bet kuriems ant etiketės rodomiems ar koduojamiems duomenims.
 */
export function getLabelCacheKey(
  item: Pick<
    InventoryItem,
    'id' | 'inventoryNumber' | 'name' | 'barcode' | 'serialNumber' | 'roomId' | 'departmentId'
  >
): string {
  return [
    item.id,
    item.inventoryNumber,
    item.name,
    item.barcode || '',
    item.serialNumber || '',
    item.roomId || '',
    item.departmentId || '',
  ].join('|');
}

/**
 * Filtruoja daiktus etikečių spausdinimui. Kai aktyvi pre-selekcija iš registro,
 * įtraukiami TIK nurodyti pasirinkti daiktai (be tylaus kitų įrašų prijungimo).
 */
export function filterLabelItems(
  items: InventoryItem[],
  options: LabelFilterOptions = {}
): InventoryItem[] {
  const {
    preSelectedIds = [],
    usePreselection = preSelectedIds.length > 0,
    departmentId = 'all',
    roomId = 'all',
    searchTerm = '',
  } = options;

  const preSet = usePreselection ? new Set(preSelectedIds) : null;
  const q = searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    if (item.status === 'written_off') return false;
    if (preSet && !preSet.has(item.id)) return false;
    if (departmentId !== 'all' && item.departmentId !== departmentId) return false;
    if (roomId !== 'all' && item.roomId !== roomId) return false;
    if (q) {
      const matchInv = item.inventoryNumber.toLowerCase().includes(q);
      const matchName = item.name.toLowerCase().includes(q);
      const matchSn = item.serialNumber?.toLowerCase().includes(q) ?? false;
      const matchBc = item.barcode?.toLowerCase().includes(q) ?? false;
      if (!matchInv && !matchName && !matchSn && !matchBc) return false;
    }
    return true;
  });
}

/**
 * Apdoroja spausdinimo dialogo rezultatą: dialogo atidarymas/uždarymas ar klaida
 * NIEKADA automatiškai nepažymi daikto kaip paženklinto.
 */
export function applyPrintDialogOutcome(
  outcome: { status: 'dialog_closed' | 'error'; error?: string },
  itemId: string
): LabelPrintState {
  if (outcome.status === 'error') {
    return {
      status: 'error',
      targetItemId: itemId,
      errorMessage: outcome.error || 'Nepavyko paruošti arba atidaryti spausdinimo lango.',
    };
  }
  return {
    status: 'awaiting_confirmation',
    targetItemId: itemId,
  };
}

export function confirmLabelApplied(labeledIds: Set<string>, itemId: string): Set<string> {
  const next = new Set(labeledIds);
  next.add(itemId);
  return next;
}

export function unmarkLabelApplied(labeledIds: Set<string>, itemId: string): Set<string> {
  const next = new Set(labeledIds);
  next.delete(itemId);
  return next;
}

/**
 * Sugeneruoja deterministinį Code128-B brūkšninio kodo modelį (juostų bitų seką) be DOM priklausomybių.
 */
const CODE128_PATTERNS: string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100',
  '10011001000', '10011000100', '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110',
  '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010',
  '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110',
  '11101011000', '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', '10010110000',
  '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010',
  '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110',
  '11110101110', '11010000100', '11010010000', '11010011100', '1100011101011',
];

export function encodeCode128B(value: string): string {
  const safeValue = (value || 'TM-0000')
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126 ? ch : '-';
    })
    .join('');

  const startCode = 104; // Code128 Start B
  let checksum = startCode;
  const parts: string[] = [CODE128_PATTERNS[startCode]];

  for (let i = 0; i < safeValue.length; i++) {
    const symbolIndex = safeValue.charCodeAt(i) - 32;
    checksum += symbolIndex * (i + 1);
    parts.push(CODE128_PATTERNS[symbolIndex]);
  }

  const checkSymbol = checksum % 103;
  parts.push(CODE128_PATTERNS[checkSymbol]);
  parts.push(CODE128_PATTERNS[106]); // Stop
  return `0000${parts.join('')}0000`;
}

export function buildCode128SvgMarkup(value: string, heightPx = 36): string {
  const bits = encodeCode128B(value);
  const rects: string[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const start = i;
      while (i < bits.length && bits[i] === '1') i++;
      rects.push(`<rect x="${start}" y="0" width="${i - start}" height="${heightPx}" fill="#000000"/>`);
    } else {
      i++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length} ${heightPx}" preserveAspectRatio="none" style="width:100%;height:${heightPx}px;display:block;shape-rendering:crispEdges">${rects.join('')}</svg>`;
}

// CRC32 ir Adler32 grynam PNG generatoriui be išorinių bibliotekų (veikia tiek naršyklėje, tiek Node.js)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

/**
 * Sugeneruoja tikrą juodai-baltą PNG paveikslėlį (Uint8Array) vienmačiam Code128 brūkšniniam kodui.
 * Veikia identiškai naršyklėje ir Node.js (naudojama tikrame OOXML DOCX eksporte).
 */
export function renderCode128PngBytes(
  value: string,
  scaleX = 2,
  heightPx = 44
): Uint8Array {
  const bits = encodeCode128B(value);
  const width = bits.length * scaleX;
  const height = heightPx;

  // Grayscale (color type 0, bit depth 8): 1 baitas per pikselį + 1 filtro baitas kiekvienai eilutei
  const rowSize = 1 + width;
  const raw = new Uint8Array(rowSize * height);
  const singleRow = new Uint8Array(rowSize);
  singleRow[0] = 0; // filter none
  for (let b = 0; b < bits.length; b++) {
    const pixelVal = bits[b] === '1' ? 0 : 255;
    for (let sx = 0; sx < scaleX; sx++) {
      singleRow[1 + b * scaleX + sx] = pixelVal;
    }
  }
  for (let y = 0; y < height; y++) {
    raw.set(singleRow, y * rowSize);
  }

  // Zlib stream su nesuspaustais DEFLATE store blokais (iki 65535 baitų blokui)
  const MAX_BLOCK = 65535;
  const numBlocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const zlibData = new Uint8Array(2 + numBlocks * 5 + raw.length + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  let pos = 2;
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = Math.min(MAX_BLOCK, raw.length - offset);
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    zlibData[pos++] = isFinal;
    zlibData[pos++] = len & 0xff;
    zlibData[pos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    zlibData[pos++] = nlen & 0xff;
    zlibData[pos++] = (nlen >>> 8) & 0xff;
    zlibData.set(raw.subarray(offset, offset + len), pos);
    pos += len;
    offset += len;
  }
  const adler = adler32(raw);
  new DataView(zlibData.buffer).setUint32(pos, adler, false);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlibData);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let p = 0;
  out.set(signature, p);
  p += signature.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}

export function buildLabelItemPayloadForQr(
  item: Pick<InventoryItem, 'inventoryNumber' | 'name'>
): string {
  return buildItemQrPayload(item);
}
