import QRCode from 'qrcode';
import { InventoryItem, Room, Department } from '../types/inventory';

export interface BrotherPrintOptions {
  items: InventoryItem[];
  rooms: Room[];
  departments: Department[];
  tapeWidthMm?: 36 | 24 | 18;
  labelLengthMm?: 68 | 80 | 50;
  codeType?: 'qr_code' | 'barcode_1d' | 'both';
  qrMap?: Record<string, string>;
  schoolName?: string;
}

/**
 * Pre-generates QR codes for items to ensure zero delay when printing.
 */
export async function generateQrMapForItems(items: InventoryItem[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const item of items) {
    try {
      const payload = JSON.stringify({
        inv: item.inventoryNumber,
        name: item.name,
        school: 'Tryškių Lazdynų Pelėdos gimn.'
      });
      map[item.id] = await QRCode.toDataURL(payload, {
        margin: 0,
        width: 180,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      });
    } catch (e) {
      console.error('Failed to generate QR for item', item.inventoryNumber, e);
    }
  }
  return map;
}

/**
 * Triggers direct label printing tailored for Brother PT-E920BT (36mm tape)
 * Opens the native browser print dialog isolated to the exact label dimensions,
 * so the user can print directly to their Brother PT-E920BT without downloading files.
 */
export async function directPrintBrotherLabels(options: BrotherPrintOptions): Promise<boolean> {
  const {
    items,
    rooms,
    tapeWidthMm = 36,
    labelLengthMm = 68,
    codeType = 'qr_code',
    schoolName = 'TRYŠKIŲ LAZDYNYŲ PELĖDOS GIMN.'
  } = options;

  if (!items || items.length === 0) return false;

  // Ensure we have QR codes for all items
  const qrMap = options.qrMap || (await generateQrMapForItems(items));

  // Determine QR code display size based on tape width
  // For 36mm tape, a ~28-30mm QR code fits perfectly with padding
  const qrBoxSizeMm = tapeWidthMm === 36 ? 29 : tapeWidthMm === 24 ? 20 : 15;
  const qrImgPx = tapeWidthMm === 36 ? 110 : tapeWidthMm === 24 ? 76 : 56;
  const invFontSizePt = tapeWidthMm === 36 ? 13 : tapeWidthMm === 24 ? 11 : 9.5;
  const nameFontSizePt = tapeWidthMm === 36 ? 8.5 : tapeWidthMm === 24 ? 7.5 : 6.5;
  const schoolFontSizePt = tapeWidthMm === 36 ? 6.5 : tapeWidthMm === 24 ? 5.5 : 5;

  // Build the clean HTML for direct printing to Brother
  const labelPages = items.map((item) => {
    const qrUrl = qrMap[item.id] || '';
    const room = rooms.find(r => r.id === item.roomId);
    const roomText = room ? `${room.number} kab.` : '';
    const snText = item.serialNumber ? `SN: ${item.serialNumber}` : '';

    return `
      <div class="brother-label">
        <div class="qr-col">
          ${qrUrl ? `<img src="${qrUrl}" width="${qrImgPx}" height="${qrImgPx}" alt="${item.inventoryNumber}" />` : ''}
        </div>
        <div class="info-col">
          <div class="school-header">${schoolName}</div>
          <div class="inv-number">${item.inventoryNumber}</div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="footer-meta">
            <span>${escapeHtml(roomText)}</span>
            ${snText ? `<span>${escapeHtml(snText)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const printDocumentHtml = `<!DOCTYPE html>
<html>
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
      padding: 1.5mm 2.5mm;
      box-sizing: border-box;
      overflow: hidden;
      background: #ffffff;
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
      padding: 0.5mm 0;
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
      line-height: 1.1;
      margin: 0.5mm 0;
      white-space: nowrap;
    }
    .item-name {
      font-size: ${nameFontSizePt}pt;
      font-weight: 600;
      color: #111111;
      line-height: 1.15;
      max-height: ${tapeWidthMm === 36 ? '8mm' : '5mm'};
      overflow: hidden;
      text-overflow: ellipsis;
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
      padding-top: 0.4mm;
      margin-top: 0.3mm;
    }
  </style>
</head>
<body>
  ${labelPages}
</body>
</html>`;

  // Create isolated hidden iframe for printing
  const iframeId = 'brother-print-frame';
  let iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
  if (iframe) {
    iframe.remove();
  }

  iframe = document.createElement('iframe');
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
  if (!doc) {
    console.error('Failed to access print iframe document');
    return false;
  }

  doc.open();
  doc.write(printDocumentHtml);
  doc.close();

  // Wait for images to load inside iframe, then trigger print
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
        resolve(true);
      } catch (err) {
        console.error('Print trigger error', err);
        resolve(false);
      }
    }, 450);
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Checks if the user's browser supports Web Bluetooth API
 */
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}
