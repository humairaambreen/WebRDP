#!/bin/bash
# Runs the IronRDP engine + web UI, no Docker, no separate auth gate, and
# (as of this version) no separate connections-storage server either -
# saved connections live in your browser's own localStorage now, so
# there's only ever this one process. Run ./scripts/setup.sh once first
# if you haven't.
set -e
cd "$(dirname "$0")/.."   # repo root

if [ ! -d "ironrdp-wasm/example" ]; then
  echo "ironrdp-wasm isn't built yet. Run ./scripts/setup.sh first."
  exit 1
fi

if [ ! -s "ironrdp-wasm/pkg/rdp_client.js" ]; then
  echo "The WASM engine (ironrdp-wasm/pkg/rdp_client.js) is missing or empty."
  echo "This usually means ./scripts/setup.sh was interrupted before it"
  echo "finished (e.g. Ctrl+C during the Rust->WASM compile). In the browser"
  echo "this shows up as a confusing 'disallowed MIME type' error when the"
  echo "page tries to load the engine, instead of a clear build error here."
  echo "Fix: rm -rf ironrdp-wasm/pkg && ./scripts/setup.sh (let it finish)"
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
PORT="$PORT" node -r "$(pwd)/scripts/tls-ip-sni-fix.js" ironrdp-wasm/example/server.js
