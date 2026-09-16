#!/bin/bash
# Runs the WebRDP server (IronRDP engine + web UI + WebSocket proxy)
set -e
cd "$(dirname "$0")/.."   # repo root

if [ ! -s "pkg/rdp_client.js" ]; then
  echo "The WASM engine (pkg/rdp_client.js) is missing or empty."
  echo "Run ./scripts/setup.sh to set up dependencies."
  exit 1
fi

PORT="${PORT:-8080}"

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use - probably a leftover process from a"
  echo "previous run. Find and stop it first:"
  echo "  lsof -i :$PORT"
  echo "  kill -9 <PID>"
  echo "(Or run on a different port: PORT=8081 ./scripts/start.sh)"
  exit 1
fi

echo "Starting on http://localhost:$PORT ..."
PORT="$PORT" node -r "$(pwd)/scripts/tls-ip-sni-fix.js" server.js
