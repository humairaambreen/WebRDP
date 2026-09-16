#!/bin/bash
# Setup script. Installs Node.js dependencies.
# The WASM engine is already pre-compiled in pkg/ so Rust is not required.
set -e
cd "$(dirname "$0")/.."   # repo root

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required. You have $(node -v 2>/dev/null || echo 'no node found')."
  echo "Install a newer Node (e.g. via nvm/fnm/your OS package manager) and re-run this script."
  exit 1
fi

echo "Installing proxy/server dependencies..."
npm install --omit=dev

echo ""
echo "Setup complete! Run ./scripts/start.sh (or npm start) to launch."
