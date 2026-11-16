#!/usr/bin/env bash
set -euo pipefail

# Naudojimas:
#   ./scripts/restore-data.sh <backup.json|backup.tar.gz> [TARGET_DATA_DIR]
#
# Patikrina kopiją prieš bet kokius pakeitimus, išsaugo ankstesnių duomenų saugos kopiją
# ir atkuria school_database.json + photos/ į nurodytą DATA_DIR.

if [ $# -lt 1 ]; then
  echo "Naudojimas: $0 <kopijos-failas.json|kopijos-failas.tar.gz> [TARGET_DATA_DIR]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_FILE="$1"
TARGET_DATA_DIR="${2:-${DATA_DIR:-$ROOT_DIR/data}}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[KLAIDA] Kopijos failas nerastas: ${BACKUP_FILE}" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

case "$BACKUP_FILE" in
  *.tar.gz|*.tgz)
    echo "[1/4] Išpakuojamas archyvas ir tikrinamas vientisumas..."
    tar -xzf "$BACKUP_FILE" -C "$STAGING_DIR"
    if [ ! -f "${STAGING_DIR}/school_database.json" ]; then
      echo "[KLAIDA] Archyve nerastas school_database.json. Esami duomenys nepakeisti." >&2
      exit 1
    fi
    npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/db-cli.ts" verify-dir "$STAGING_DIR" >/dev/null
    mkdir -p "${STAGING_DIR}/photos" "${STAGING_DIR}/backups"
    ;;
  *.json)
    echo "[1/4] Validuojama JSON kopija ir iškeliamos nuotraukos..."
    npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/db-cli.ts" prepare-restore "$BACKUP_FILE" "$STAGING_DIR" >/dev/null
    ;;
  *)
    echo "[KLAIDA] Palaikomi tik .json arba .tar.gz (.tgz) kopijos failai." >&2
    exit 1
    ;;
esac

echo "[2/4] Paruošiamas tikslinis katalogas (${TARGET_DATA_DIR})..."
mkdir -p "${TARGET_DATA_DIR}/photos" "${TARGET_DATA_DIR}/backups"

# Jei tiksliniame kataloge jau yra duomenų bazė – prieš pakeitimą padarome saugos kopiją
if [ -f "${TARGET_DATA_DIR}/school_database.json" ]; then
  TS="$(date -u +%Y%m%d_%H%M%S)"
  SAFETY_ARCHIVE="${TARGET_DATA_DIR}/backups/pre_restore_${TS}.tar.gz"
  SAFETY_ITEMS=("school_database.json")
  if [ -d "${TARGET_DATA_DIR}/photos" ]; then
    SAFETY_ITEMS+=("photos")
  fi
  tar -czf "$SAFETY_ARCHIVE" -C "$TARGET_DATA_DIR" "${SAFETY_ITEMS[@]}"
  echo "[OK] Esamų duomenų saugos kopija prieš atkūrimą išsaugota: ${SAFETY_ARCHIVE}"
fi

echo "[3/4] Atomiškai atnaujinama duomenų bazė ir nuotraukos..."
cp "${STAGING_DIR}/school_database.json" "${TARGET_DATA_DIR}/school_database.json.tmp"
mv "${TARGET_DATA_DIR}/school_database.json.tmp" "${TARGET_DATA_DIR}/school_database.json"

if [ -d "${STAGING_DIR}/photos" ]; then
  rm -rf "${TARGET_DATA_DIR}/photos.next"
  cp -a "${STAGING_DIR}/photos" "${TARGET_DATA_DIR}/photos.next"
  rm -rf "${TARGET_DATA_DIR}/photos.prev"
  if [ -d "${TARGET_DATA_DIR}/photos" ]; then
    mv "${TARGET_DATA_DIR}/photos" "${TARGET_DATA_DIR}/photos.prev"
  fi
  mv "${TARGET_DATA_DIR}/photos.next" "${TARGET_DATA_DIR}/photos"
  rm -rf "${TARGET_DATA_DIR}/photos.prev"
fi

echo "[4/4] Galutinė atkurtų duomenų patikra..."
VERIFY_JSON="$(npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/db-cli.ts" verify-dir "$TARGET_DATA_DIR")"
echo "[OK] Atkūrimas sėkmingai baigtas: ${VERIFY_JSON}"
echo "Pastaba: jei serveris šiuo metu veikia, perkraukite jį (pvz., pm2 restart inventorius arba docker compose restart), kad nauji duomenys būtų įkelti iš disko."
