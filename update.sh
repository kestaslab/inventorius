#!/bin/bash
set -e
echo "=== Atnaujinama Tryškių Lazdynų Pelėdos gimnazijos inventoriaus sistema ==="
cd /opt/inventorius || cd "$(dirname "$0")"
git pull
npm install --legacy-peer-deps
npm run build
pm2 restart inventorius || pm2 start "npx serve -s dist -l 3000" --name "inventorius"
echo "=== Sistema sėkmingai atnaujinta! ==="
