#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "No se encontró Node.js. Instala Node.js 20 o superior."
  read -r
  exit 1
fi
(open http://localhost:3000 >/dev/null 2>&1 || true) &
node server.js
