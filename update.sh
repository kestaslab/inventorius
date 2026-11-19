#!/usr/bin/env bash
set -euo pipefail

echo "=== Saugus Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistemos atnaujinimas ==="
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
cd "$APP_DIR"

DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups_archive}"
PORT="${PORT:-3000}"

if ! command -v bun >/dev/null 2>&1; then
  echo "[KLAIDA] Nerastas „bun“ įrankis. Atnaujinimas naudoja bun pagal saugyklos bun.lock." >&2
  exit 1
fi

# 1. Neleidžiame destruktyvaus git reset --hard / git clean -fd
if [ -n "$(git status --porcelain)" ]; then
  echo "[KLAIDA] Darbinėje direktorijoje yra neišsaugotų pakeitimų arba neįtrauktų failų:" >&2
  git status --short >&2
  echo "Sustabdyta siekiant nieko neištrinti. Pirmiausia sutvarkykite pakeitimus (git stash / git commit)." >&2
  exit 1
fi

PREV_COMMIT="$(git rev-parse HEAD)"
echo "Dabartinė versija (rollback taškas): ${PREV_COMMIT}"

# 2. Prieš atnaujinimą sukuriame ir patikriname pilną atsarginę kopiją (jei DB egzistuoja)
echo "[1/5] Sukuriama atsarginė duomenų bazės kopija prieš atnaujinimą..."
if [ -f "${DATA_DIR}/school_database.json" ]; then
  DATA_DIR="$DATA_DIR" BACKUP_DIR="$BACKUP_DIR" PORT="$PORT" bash "$APP_DIR/scripts/backup-data.sh" "$DATA_DIR" "$BACKUP_DIR" "http://127.0.0.1:${PORT}"
else
  echo "[INFO] Esamos duomenų bazės ${DATA_DIR}/school_database.json dar nėra – praleidžiama pradinio paleidimo metu."
fi

# 3. Atnaujinamas kodas be perrašymo
echo "[2/5] Atsiunčiamas naujausias kodas iš Git..."
if ! git pull --ff-only; then
  echo "[KLAIDA] Nepavyko atlikti „git pull --ff-only“. Duomenys nepakeisti, atstatyti nereikia." >&2
  exit 1
fi

# 4. Priklausomybės ir build tiksliai pagal bun.lock
echo "[3/5] Diegiamos priklausomybės (bun install --frozen-lockfile)..."
if ! bun install --frozen-lockfile; then
  echo "[KLAIDA] Nepavyko įdiegti priklausomybių. Ankstesnė versija: ${PREV_COMMIT}" >&2
  echo "Grąžinimui atgal: git checkout ${PREV_COMMIT} && bun install --frozen-lockfile" >&2
  exit 1
fi

echo "[4/5] Kompiliuojama produkcinė versija (bun run build)..."
if ! bun run build; then
  echo "[KLAIDA] Projekto kompiliacija nepavyko. Servisas neperkrautas." >&2
  echo "Grąžinimui atgal: git checkout ${PREV_COMMIT} && bun install --frozen-lockfile && bun run build" >&2
  exit 1
fi

# 5. Paleidžiamas vienintelis procesas per PM2 (server.ts su Express API ir dist/)
echo "[5/5] Paleidžiamas serveris fone (PM2, vienas procesas)..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[KLAIDA] Nerastas PM2. Paleiskite rankiniu būdu: NODE_ENV=production PORT=${PORT} DATA_DIR=${DATA_DIR} bun run start" >&2
  exit 1
fi

BUN_BIN="$(command -v bun)"
pm2 delete inventorius >/dev/null 2>&1 || true
NODE_ENV=production PORT="$PORT" DATA_DIR="$DATA_DIR" pm2 start "$BUN_BIN" --interpreter none --name "inventorius" -i 1 -- run start
pm2 save

echo "Tikrinamas serverio veikimas (/api/health)..."
HEALTH_OK=0
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "[KLAIDA] Serveris po atnaujinimo neatsakė į /api/health!" >&2
  pm2 logs inventorius --lines 40 --nostream >&2 || true
  echo "Rankiniam grąžinimui į ankstesnę būseną:" >&2
  echo "  git checkout ${PREV_COMMIT} && bun install --frozen-lockfile && bun run build" >&2
  echo "  ./scripts/restore-data.sh <atsarginės-kopijos-failas-iš-${BACKUP_DIR}> ${DATA_DIR}" >&2
  echo "  NODE_ENV=production PORT=${PORT} DATA_DIR=${DATA_DIR} pm2 restart inventorius" >&2
  exit 1
fi

echo ""
echo "=== Atnaujinimas sėkmingai baigtas ir /api/health patvirtintas! ==="
curl -fsS "http://127.0.0.1:${PORT}/api/health"
echo ""
