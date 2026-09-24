#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "FEHLER: Node.js ist nicht installiert."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "FEHLER: npm ist nicht installiert."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installiere Node-Abhaengigkeiten ..."
  npm install
fi

npm start
