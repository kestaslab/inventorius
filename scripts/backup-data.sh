#!/usr/bin/env bash
set -euo pipefail

# Naudojimas:
#   ./scripts/backup-data.sh [DATA_DIR] [BACKUP_DIR] [SERVER_URL]
#
# Sukuria:
# 1) Nešiojamą pilną JSON kopiją (kartu su visomis nuotraukomis iš /api/database/backup, jei serveris veikia),
# 2) Pilną duomenų katalogo tar.gz archyvą (school_database.json + photos/), kad kopija būtų pilna ir nepriklausoma.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${1:-${DATA_DIR:-$ROOT_DIR/data}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-$ROOT_DIR/backups_archive}}"
SERVER_URL="${3:-${APP_LOCAL_URL:-http://127.0.0.1:${PORT:-3000}}}"
TS="$(date -u +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

CREATED_COUNT=0

# 1. Jei serveris pasiekiamas ir DB inicijuota – paimame nuoseklią kopiją per serverio API užraktą (su nuotraukomis JSON viduje)
if command -v curl >/dev/null 2>&1; then
  HEALTH_JSON="$(curl -fsS --max-time 5 "${SERVER_URL}/api/health" 2>/dev/null || true)"
  if [ -n "$HEALTH_JSON" ] && echo "$HEALTH_JSON" | grep -q '"status":"ok"' && echo "$HEALTH_JSON" | grep -q '"dbExists":true'; then
    PORTABLE_JSON="${BACKUP_DIR}/inventorius_portable_${TS}.json"
    if curl -fsS --max-time 30 "${SERVER_URL}/api/database/backup" -o "${PORTABLE_JSON}.tmp" \
      && npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/db-cli.ts" validate-json "${PORTABLE_JSON}.tmp" >/dev/null 2>&1; then
      mv "${PORTABLE_JSON}.tmp" "${PORTABLE_JSON}"
      echo "[OK] Sukurta nešiojama JSON kopija su nuotraukomis: ${PORTABLE_JSON}"
      CREATED_COUNT=$((CREATED_COUNT + 1))
    else
      rm -f "${PORTABLE_JSON}.tmp"
      echo "[ĮSPĖJIMAS] Nepavyko gauti galiojančios /api/database/backup JSON kopijos – tęsiama su failų sistemos archyvu." >&2
    fi
  fi
fi

# 2. Sukuriame pilną katalogo archyvą (school_database.json + photos/)
if [ -f "${DATA_DIR}/school_database.json" ]; then
  npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/db-cli.ts" validate-json "${DATA_DIR}/school_database.json" >/dev/null
  ARCHIVE_FILE="${BACKUP_DIR}/inventorius_full_${TS}.tar.gz"
  STAGING_LIST=("school_database.json")
  if [ -d "${DATA_DIR}/photos" ]; then
    STAGING_LIST+=("photos")
  fi
  tar -czf "${ARCHIVE_FILE}.tmp" -C "${DATA_DIR}" "${STAGING_LIST[@]}"
  tar -tzf "${ARCHIVE_FILE}.tmp" >/dev/null
  mv "${ARCHIVE_FILE}.tmp" "${ARCHIVE_FILE}"
  echo "[OK] Sukurtas pilnas duomenų archyvas (DB + nuotraukos): ${ARCHIVE_FILE}"
  CREATED_COUNT=$((CREATED_COUNT + 1))
fi

if [ "$CREATED_COUNT" -eq 0 ]; then
  echo "[KLAIDA] Nepavyko sukurti atsarginės kopijos: nerasta inicijuota duomenų bazė (${DATA_DIR}/school_database.json)." >&2
  exit 1
fi

echo ""
echo "Svarbu dėl išorinės kopijos:"
echo "  Vietinės kopijos kataloge ${BACKUP_DIR} neapsaugo nuo serverio disko gedimo."
echo "  Nukopijuokite šį failą į atskirą saugyklą (Proxmox PBS, išorinį NAS arba tarnybinį kompiuterį)."
