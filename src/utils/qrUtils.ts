import { InventoryItem } from '../types/inventory';

export const SCHOOL_QR_NAME = 'Tryškių Lazdynų Pelėdos gimn.';

export interface ItemQrPayload {
  inv: string;
  name: string;
  school: string;
}

/**
 * Sugeneruoja oficialų QR turinį etiketėms (suderintą su etikečių spausdinimu).
 */
export function buildItemQrPayload(item: Pick<InventoryItem, 'inventoryNumber' | 'name'>): string {
  const payload: ItemQrPayload = {
    inv: item.inventoryNumber,
    name: item.name,
    school: SCHOOL_QR_NAME,
  };
  return JSON.stringify(payload);
}

export type ParsedQrInput =
  | {
      ok: true;
      format: 'json_qr' | 'plain_code';
      inv?: string;
      id?: string;
      serialNumber?: string;
      name?: string;
      school?: string;
      plainCode?: string;
      displayCode: string;
    }
  | {
      ok: false;
      reason: 'empty' | 'invalid_json' | 'missing_identifier';
      error: string;
    };

/**
 * Saugiai išanalizuoja QR kodo JSON ({ inv, name, school }) arba paprastą kodą (inv. Nr., S/N, ID).
 * Niekada nemeta klaidos esant sugadintam tekstui.
 */
export function parseQrOrManualCode(rawInput: string): ParsedQrInput {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'empty',
      error: 'Įveskite inventorinį numerį, serijos numerį arba nuskenuokite QR kodą.',
    };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        reason: 'invalid_json',
        error: 'Netinkamas arba sugadintas QR kodo JSON formatas.',
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        reason: 'invalid_json',
        error: 'QR kode tikėtasi turto objekto su lauku „inv“.',
      };
    }

    const obj = parsed as Record<string, unknown>;
    const inv =
      typeof obj.inv === 'string' && obj.inv.trim()
        ? obj.inv.trim()
        : typeof obj.inventoryNumber === 'string' && obj.inventoryNumber.trim()
        ? obj.inventoryNumber.trim()
        : undefined;
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : undefined;
    const serialNumber =
      typeof obj.serialNumber === 'string' && obj.serialNumber.trim()
        ? obj.serialNumber.trim()
        : typeof obj.sn === 'string' && obj.sn.trim()
        ? obj.sn.trim()
        : undefined;
    const name = typeof obj.name === 'string' ? obj.name.trim() : undefined;
    const school = typeof obj.school === 'string' ? obj.school.trim() : undefined;

    if (!inv && !id && !serialNumber) {
      return {
        ok: false,
        reason: 'missing_identifier',
        error: 'QR kode nėra turto identifikatoriaus („inv“, „id“ arba „serialNumber“).',
      };
    }

    return {
      ok: true,
      format: 'json_qr',
      inv,
      id,
      serialNumber,
      name,
      school,
      displayCode: inv || serialNumber || id || '',
    };
  }

  // Palaikome ir „TM-2023-0001 | Pavadinimas | Mokykla“ formatą iš CSV etikečių eksporto
  const pipePart = trimmed.includes('|') ? trimmed.split('|')[0].trim() : trimmed;
  if (!pipePart) {
    return {
      ok: false,
      reason: 'missing_identifier',
      error: 'Nuskaitytas tuščias kodas.',
    };
  }

  return {
    ok: true,
    format: 'plain_code',
    plainCode: pipePart,
    displayCode: pipePart,
  };
}

export type ResolveScanResult =
  | {
      ok: true;
      item: InventoryItem;
      format: 'json_qr' | 'plain_code';
      matchedBy: 'inv' | 'serial' | 'id' | 'barcode';
      displayCode: string;
    }
  | {
      ok: false;
      reason: 'empty' | 'invalid_json' | 'missing_identifier' | 'not_found';
      message: string;
      displayCode?: string;
    };

/**
 * Suranda inventoriaus objektą pagal programos JSON QR kodą, inventorinį Nr., serijos Nr., brūkšninį kodą ar ID.
 */
export function resolveScannedInventoryItem(
  rawInput: string,
  items: InventoryItem[]
): ResolveScanResult {
  const parsed = parseQrOrManualCode(rawInput);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      message: parsed.error,
    };
  }

  if (parsed.format === 'json_qr') {
    const invUpper = parsed.inv?.toUpperCase();
    const snUpper = parsed.serialNumber?.toUpperCase();
    const idRaw = parsed.id;

    if (invUpper) {
      const byInv = items.find((i) => i.inventoryNumber.trim().toUpperCase() === invUpper);
      if (byInv) {
        return {
          ok: true,
          item: byInv,
          format: 'json_qr',
          matchedBy: 'inv',
          displayCode: parsed.displayCode,
        };
      }
    }

    if (idRaw) {
      const byId = items.find(
        (i) => i.id === idRaw || i.id.toUpperCase() === idRaw.toUpperCase()
      );
      if (byId) {
        return {
          ok: true,
          item: byId,
          format: 'json_qr',
          matchedBy: 'id',
          displayCode: parsed.displayCode,
        };
      }
    }

    if (snUpper) {
      const bySn = items.find((i) => i.serialNumber?.trim().toUpperCase() === snUpper);
      if (bySn) {
        return {
          ok: true,
          item: bySn,
          format: 'json_qr',
          matchedBy: 'serial',
          displayCode: parsed.displayCode,
        };
      }
    }

    return {
      ok: false,
      reason: 'not_found',
      displayCode: parsed.displayCode,
      message: `Turtas pagal QR kodą „${parsed.displayCode}“${
        parsed.name ? ` (${parsed.name})` : ''
      } sistemoje nerastas.`,
    };
  }

  const code = parsed.plainCode || parsed.displayCode;
  const codeUpper = code.toUpperCase();

  const byInv = items.find((i) => i.inventoryNumber.trim().toUpperCase() === codeUpper);
  if (byInv) {
    return {
      ok: true,
      item: byInv,
      format: 'plain_code',
      matchedBy: 'inv',
      displayCode: code,
    };
  }

  const bySerial = items.find(
    (i) => Boolean(i.serialNumber?.trim()) && i.serialNumber!.trim().toUpperCase() === codeUpper
  );
  if (bySerial) {
    return {
      ok: true,
      item: bySerial,
      format: 'plain_code',
      matchedBy: 'serial',
      displayCode: code,
    };
  }

  const byBarcode = items.find(
    (i) => Boolean(i.barcode?.trim()) && i.barcode!.trim().toUpperCase() === codeUpper
  );
  if (byBarcode) {
    return {
      ok: true,
      item: byBarcode,
      format: 'plain_code',
      matchedBy: 'barcode',
      displayCode: code,
    };
  }

  const byId = items.find(
    (i) => i.id === code || i.id.toUpperCase() === codeUpper
  );
  if (byId) {
    return {
      ok: true,
      item: byId,
      format: 'plain_code',
      matchedBy: 'id',
      displayCode: code,
    };
  }

  return {
    ok: false,
    reason: 'not_found',
    displayCode: code,
    message: `Turtas su kodu „${code}“ sistemoje nerastas!`,
  };
}
