#!/bin/bash
set -e

echo "=== Atnaujinama Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistema ==="
cd /opt/inventorius || cd "$(dirname "$0")"

echo "[1/5] Atstatomi vietiniai pakeitimai ir šalinami konfliktai..."
git reset --hard
git clean -fd

echo "[2/5] Parsiunčiamas naujausias kodas iš GitHub..."
git pull

echo "[3/5] Tikrinamos priklausomybės..."
npm install --legacy-peer-deps

echo "[4/5] Sukompiliuojamas projektas..."
npm run build

echo "[5/5] Paleidžiamas serveris fone (PM2)..."
pm2 delete inventorius >/dev/null 2>&1 || true
NODE_ENV=production pm2 start "npx tsx server.ts" --name "inventorius"
pm2 save

echo ""
echo "=== Sistema sėkmingai atnaujinta! ==="
echo "Adresas: https://inventorius.tryskiumokykla.lt"
echo "Prisijungimas: Kęstutis Labanauskas (PIN: 1953)"
echo "================================================="
