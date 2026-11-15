import QRCode from 'qrcode';
import {
  Department,
  InventoryItem,
  OrganizationSettings,
  Room,
  formatRoomName,
} from '../types/inventory';
import { DEFAULT_ORGANIZATION_SETTINGS } from './organization';
import { buildItemQrPayload } from './qrUtils';
import {
  CodeType,
  LabelLength,
  TapeWidth,
  buildCode128SvgMarkup,
  getBarcodeValue,
  getLabelCacheKey,
} from './labelUtils';

export interface BrotherPrintOptions {
  items: InventoryItem[];
  rooms: Room[];
  departments: Department[];
  tapeWidthMm?: TapeWidth;
  labelLengthMm?: LabelLength;
  codeType?: CodeType;
  qrMap?: Record<string, string>;
  schoolName?: string;
  organization?: OrganizationSettings;
}

export interface BrotherPrintResult {
  status: 'dialog_closed' | 'error';
  error?: string;
}

/**
 * Sugeneruoja QR kodų DataURL žemėlapį (pagal daikto ID ir pagal keičiamų laukų podėlio raktą).
 */
export async function generateQrMapForItems(
  items: InventoryItem[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const item of items) {
    const payload = buildItemQrPayload(item);
    const dataUrl = await QRCode.toDataURL(payload, {
      margin: 0,
      width: 180,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    map[item.id] = dataUrl;
    map[getLabelCacheKey(item)] = dataUrl;
  }
  return map;
}

/**
 * Laukia, kol spausdinimo dokumente pilnai užsikraus šriftai, paveikslėliai ir bus atliktas maketo perskaičiavimas.
 */
export async function waitForPrintDocumentReady(doc: Document): Promise<void> {
  const fontSet = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fontSet?.ready) {
    try {
      await fontSet.ready;
    } catch {
      // ignore font loading errors
    }
  }

  const images = Array.from(doc.images || []);
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          const done = () => {
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
            resolve();
          };
          img.addEventListener('load', done);
          img.addEventListener('error', done);
        });
      }
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          // ignore decode errors on fallback SVG/empty sources
        }
      }
    })
  );

  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }
}

export function buildBrotherPrintHtml(
  options: BrotherPrintOptions,
  resolvedQrMap: Record<string, string> = {}
): string {
  const {
    items,
    rooms,
    tapeWidthMm = 36,
    labelLengthMm = 68,
    codeType = 'qr_code',
    schoolName,
    organization,
  } = options;

  const headerSchoolName =
    schoolName?.trim() ||
    organization?.name?.trim() ||
    DEFAULT_ORGANIZATION_SETTINGS.name;

  const qrBoxSizeMm =
    codeType === 'both'
      ? tapeWidthMm === 36
        ? 23
        : tapeWidthMm === 24
        ? 16
        : 12
      : tapeWidthMm === 36
      ? 29
      : tapeWidthMm === 24
      ? 20
      : 15;
  const qrImgPx =
    codeType === 'both'
      ? tapeWidthMm === 36
        ? 86
        : tapeWidthMm === 24
        ? 60
        : 45
      : tapeWidthMm === 36
      ? 110
      : tapeWidthMm === 24
      ? 76
      : 56;
  const barcodeHeightPx =
    codeType === 'both'
      ? tapeWidthMm === 36
        ? 22
        : tapeWidthMm === 24
        ? 16
        : 12
      : tapeWidthMm === 36
      ? 36
      : tapeWidthMm === 24
      ? 24
      : 18;
  const invFontSizePt = tapeWidthMm === 36 ? 12 : tapeWidthMm === 24 ? 10 : 8.5;
  const nameFontSizePt = tapeWidthMm === 36 ? 8 : tapeWidthMm === 24 ? 7 : 6;
  const schoolFontSizePt = tapeWidthMm === 36 ? 6 : tapeWidthMm === 24 ? 5.2 : 4.6;

  const labelPages = items
    .map((item) => {
      const cacheKey = getLabelCacheKey(item);
      const qrUrl = resolvedQrMap[cacheKey] || resolvedQrMap[item.id] || '';
      const barcodeVal = getBarcodeValue(item);
      const barcodeSvg =
        codeType === 'barcode_1d' || codeType === 'both'
          ? buildCode128SvgMarkup(barcodeVal, barcodeHeightPx)
          : '';
      const room = rooms.find((r) => r.id === item.roomId);
      const roomText = formatRoomName(room, true);
      const snText = item.serialNumber ? `SN: ${item.serialNumber}` : '';

      if (codeType === 'barcode_1d') {
        return `
          <div class="brother-label brother-label--barcode-only" data-code-type="barcode_1d">
            <div class="info-col">
              <div class="school-header">${escapeHtml(headerSchoolName)}</div>
              <div class="barcode-wrap">
                ${barcodeSvg}
              </div>
              <div class="barcode-caption">
                <span class="inv-number">${escapeHtml(item.inventoryNumber)}</span>
                ${
                  barcodeVal !== item.inventoryNumber
                    ? `<span class="barcode-raw">${escapeHtml(barcodeVal)}</span>`
                    : ''
                }
              </div>
              <div class="item-name">${escapeHtml(item.name)}</div>
              <div class="footer-meta">
                <span>${escapeHtml(roomText)}</span>
                ${snText ? `<span>${escapeHtml(snText)}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="brother-label" data-code-type="${codeType}">
          <div class="qr-col">
            ${
              qrUrl
                ? `<img src="${qrUrl}" width="${qrImgPx}" height="${qrImgPx}" alt="${escapeHtml(
                    item.inventoryNumber
                  )}" />`
                : ''
            }
          </div>
          <div class="info-col">
            <div class="school-header">${escapeHtml(headerSchoolName)}</div>
            <div class="inv-number">${escapeHtml(item.inventoryNumber)}</div>
            <div class="item-name">${escapeHtml(item.name)}</div>
            ${
              codeType === 'both'
                ? `<div class="barcode-inline">${barcodeSvg}</div>`
                : ''
            }
            <div class="footer-meta">
              <span>${escapeHtml(roomText)}</span>
              ${snText ? `<span>${escapeHtml(snText)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="lt">
<head>
  <meta charset="utf-8">
  <title>Brother_PTE920BT_Etiketes</title>
  <style>
    @page {
      size: ${labelLengthMm}mm ${tapeWidthMm}mm;
      margin: 0mm !important;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      width: ${labelLengthMm}mm;
      font-family: Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .brother-label {
      width: ${labelLengthMm}mm;
      height: ${tapeWidthMm}mm;
      page-break-after: always;
      page-break-inside: avoid;
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 1.5mm 2.2mm;
      box-sizing: border-box;
      overflow: hidden;
      background: #ffffff;
    }
    .brother-label--barcode-only {
      flex-direction: column;
      align-items: stretch;
    }
    .qr-col {
      width: ${qrBoxSizeMm}mm;
      height: ${qrBoxSizeMm}mm;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 2mm;
    }
    .qr-col img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .info-col {
      flex: 1;
      min-width: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.4mm 0;
      text-align: left;
    }
    .school-header {
      font-size: ${schoolFontSizePt}pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2pt;
      color: #333333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.1;
    }
    .inv-number {
      font-family: "Courier New", Courier, monospace;
      font-size: ${invFontSizePt}pt;
      font-weight: 900;
      color: #000000;
      letter-spacing: -0.3pt;
      line-height: 1.05;
      margin: 0.3mm 0;
      white-space: nowrap;
    }
    .item-name {
      font-size: ${nameFontSizePt}pt;
      font-weight: 600;
      color: #111111;
      line-height: 1.12;
      max-height: ${codeType === 'both' ? '4.5mm' : tapeWidthMm === 36 ? '7.5mm' : '4.5mm'};
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .barcode-wrap {
      width: 100%;
      margin: 0.5mm 0 0.3mm 0;
    }
    .barcode-inline {
      width: 100%;
      margin: 0.4mm 0;
    }
    .barcode-caption {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 2mm;
    }
    .barcode-raw {
      font-family: "Courier New", Courier, monospace;
      font-size: ${schoolFontSizePt}pt;
      color: #333333;
    }
    .footer-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: ${schoolFontSizePt}pt;
      font-family: "Courier New", Courier, monospace;
      color: #444444;
      line-height: 1.1;
      border-top: 0.2mm solid #cccccc;
      padding-top: 0.35mm;
      margin-top: 0.25mm;
    }
  </style>
</head>
<body>
  ${labelPages}
</body>
</html>`;
}

/**
 * Paruošia spausdinimo dokumentą ir atidaro naršyklės spausdinimo dialogą.
 * Grąžina { status: 'dialog_closed' } tik užbaigus spausdinimo lango iškvietimą
 * arba { status: 'error' } klaidos atveju – pati funkcija NIEKADA nepažymi etiketės kaip užklijuotos.
 */
export async function directPrintBrotherLabels(
  options: BrotherPrintOptions
): Promise<BrotherPrintResult> {
  const { items, codeType = 'qr_code' } = options;

  if (!items || items.length === 0) {
    return { status: 'error', error: 'Nepasirinkta nė vienos etiketės spausdinimui.' };
  }

  let qrMap: Record<string, string> = options.qrMap ? { ...options.qrMap } : {};
  if (codeType === 'qr_code' || codeType === 'both') {
    const missing = items.filter(
      (item) => !qrMap[getLabelCacheKey(item)] && !qrMap[item.id]
    );
    if (missing.length > 0) {
      try {
        const generated = await generateQrMapForItems(missing);
        qrMap = { ...qrMap, ...generated };
      } catch (err) {
        return {
          status: 'error',
          error:
            err instanceof Error
              ? `Nepavyko sugeneruoti QR kodo: ${err.message}`
              : 'Nepavyko sugeneruoti QR kodo.',
        };
      }
    }
  }

  const printDocumentHtml = buildBrotherPrintHtml(options, qrMap);

  if (typeof document === 'undefined') {
    return {
      status: 'error',
      error: 'Spausdinimo dialogas galimas tik naršyklės aplinkoje.',
    };
  }

  const iframeId = 'brother-print-frame';
  const existingIframe = document.getElementById(iframeId);
  if (existingIframe) {
    existingIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = iframeId;
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    return {
      status: 'error',
      error: 'Nepavyko atidaryti spausdinimo kadro (iframe).',
    };
  }

  try {
    doc.open();
    doc.write(printDocumentHtml);
    doc.close();

    await waitForPrintDocumentReady(doc);

    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    return { status: 'dialog_closed' };
  } catch (err) {
    return {
      status: 'error',
      error:
        err instanceof Error
          ? `Spausdinimo klaida: ${err.message}`
          : 'Nepavyko iškviesti naršyklės spausdinimo lango.',
    };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}
