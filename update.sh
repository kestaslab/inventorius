#!/bin/bash
set -e
echo "=== Atnaujinama Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistema ==="
cd /opt/inventorius || cd "$(dirname "$0")"
git pull
npm install --legacy-peer-deps
npm run build
pm2 delete inventorius >/dev/null 2>&1 || true
pm2 start "npx tsx server.ts" --name "inventorius"
pm2 save
echo "=== Sistema sėkmingai atnaujinta! ==="
