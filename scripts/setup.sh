#!/bin/bash
# One-time setup. Requires: git, Node.js 18+, and internet access.
# Also needs Rust + wasm-pack, which this script installs for you
# if they're missing (via rustup, the standard/official installer).
set -e

cd "$(dirname "$0")/.."   # repo root

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required. You have $(node -v 2>/dev/null || echo 'no node found')."
  echo "Install a newer Node (e.g. via nvm/fnm/your OS package manager) and re-run this script."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust not found - installing via rustup..."
  curl https://sh.rustup.rs -sSf | sh -s -- -y
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

if command -v rustup >/dev/null 2>&1; then
  echo "Updating Rust toolchain (cheap, safe to run every time)..."
  rustup update stable
  rustup default stable
else
  echo "Note: cargo was found but isn't managed by rustup (e.g. installed"
  echo "via Homebrew/apt). If the build below fails with a 'rustc ... is"
  echo "not supported' error, update it yourself (e.g. 'brew upgrade rust')"
  echo "and re-run this script."
fi

# Cargo-installed binaries land in ~/.cargo/bin - put it first on PATH so
# the wasm-pack we install/update below is actually the one that gets
# run a few lines down (and by npm run build after that), instead of an
# older wasm-pack sitting earlier on PATH (Homebrew, an npm global, an
# nvm shim, etc.) silently winning every time. Without this, the version
# check below can update the "wrong" copy and the outdated-version
# warning keeps coming back even though the update itself succeeded.
export PATH="$HOME/.cargo/bin:$PATH"

WASM_PACK_MIN_VERSION="0.15.0"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack not found - installing..."
  cargo install wasm-pack
else
  # Keep it current instead of quietly building with a stale copy - this
  # is what was showing up as "there's a newer version of wasm-pack
  # available" on every single run.
  CURRENT_WASM_PACK=$(wasm-pack --version 2>/dev/null | awk '{print $2}')
  if [ "$CURRENT_WASM_PACK" != "$WASM_PACK_MIN_VERSION" ]; then
    echo "Updating wasm-pack ($CURRENT_WASM_PACK -> $WASM_PACK_MIN_VERSION)..."
    cargo install wasm-pack --version "$WASM_PACK_MIN_VERSION" --force || \
      echo "Couldn't update wasm-pack automatically - continuing with $CURRENT_WASM_PACK."
  fi
fi

RESOLVED_WASM_PACK=$(command -v wasm-pack)
RESOLVED_WASM_PACK_VERSION=$(wasm-pack --version 2>/dev/null | awk '{print $2}')
if [ "$RESOLVED_WASM_PACK_VERSION" != "$WASM_PACK_MIN_VERSION" ]; then
  echo "Heads up: the wasm-pack that will actually be used for this build"
  echo "is $RESOLVED_WASM_PACK (v$RESOLVED_WASM_PACK_VERSION), not the one"
  echo "we just installed/updated in ~/.cargo/bin. Something earlier on"
  echo "your PATH (Homebrew, an npm global install, an nvm shim, etc.) is"
  echo "taking priority. Find and update/remove it, e.g.:"
  echo "  which -a wasm-pack"
  echo "so ~/.cargo/bin/wasm-pack (v$WASM_PACK_MIN_VERSION) is the one that wins."
fi

if [ ! -d "ironrdp-wasm" ]; then
  echo "Cloning ironrdp-wasm..."
  git clone https://github.com/electerm/ironrdp-wasm.git

  # Silences a single harmless "unused import: `ironrdp_web::*`" build
  # warning from the vendored crate's own src/lib.rs (a re-export it
  # doesn't currently use). Best-effort and non-fatal: if upstream moves
  # the file or the line, this just quietly does nothing rather than
  # breaking the build.
  if [ -f "ironrdp-wasm/src/lib.rs" ] && ! grep -q "allow(unused_imports)" ironrdp-wasm/src/lib.rs; then
    { echo "#![allow(unused_imports)]"; cat ironrdp-wasm/src/lib.rs; } > ironrdp-wasm/src/lib.rs.tmp \
      && mv ironrdp-wasm/src/lib.rs.tmp ironrdp-wasm/src/lib.rs || true
  fi
fi

echo "Building the IronRDP engine (this compiles Rust to WASM, takes a few minutes)..."
echo "Let this finish on its own - interrupting it partway (Ctrl+C) leaves"
echo "pkg/ missing or stale, which shows up later in the browser as a"
echo "confusing 'disallowed MIME type' error when it tries to load the engine."
cd ironrdp-wasm
npm install
echo ""
echo "--- Checking ironrdp-wasm's own dependencies for known vulnerabilities ---"
# Non-breaking fixes only (no --force) - keeps the vendored engine's own
# deps from sitting on known-vulnerable versions without risking a major
# bump that changes behaviour underneath us. The "X vulnerabilities"
# line from the npm install right above is what this line fixes - if you
# see that line immediately followed by this block ending in "found 0
# vulnerabilities", nothing is left unresolved; the messages are just
# two separate npm commands running back to back with no header between
# them, which reads like a leftover problem when it isn't one.
npm audit fix --audit-level=moderate || true
npm audit --audit-level=moderate || true
echo "--- end vulnerability check ---"
echo ""
npm run build

if [ ! -s "pkg/rdp_client.js" ]; then
  echo ""
  echo "ERROR: the WASM build didn't produce pkg/rdp_client.js."
  echo "This usually means the build above was interrupted or failed partway."
  echo "Fix: remove the partial build and re-run this script without"
  echo "interrupting it:"
  echo "  rm -rf ironrdp-wasm/pkg && ./scripts/setup.sh"
  exit 1
fi

echo "Installing the proxy/static server's own dependencies..."
cd example
npm install
echo ""
echo "--- Checking the proxy/static server's dependencies for known vulnerabilities ---"
npm audit fix --audit-level=moderate || true
npm audit --audit-level=moderate || true
echo "--- end vulnerability check ---"
echo ""
cd ../..

echo "Installing this project's own UI on top of the vendored example..."
rm -f ironrdp-wasm/example/lib/file-transfer.js
cp web/index.html   ironrdp-wasm/example/index.html
cp web/style.css    ironrdp-wasm/example/style.css
cp web/app.js       ironrdp-wasm/example/app.js
cp web/lib/logger.js    ironrdp-wasm/example/lib/logger.js
cp web/lib/session.js   ironrdp-wasm/example/lib/session.js
cp web/lib/input.js     ironrdp-wasm/example/lib/input.js
cp web/lib/clipboard.js ironrdp-wasm/example/lib/clipboard.js
cp web/lib/api.js       ironrdp-wasm/example/lib/api.js
cp web/lib/dashboard.js ironrdp-wasm/example/lib/dashboard.js
cp web/lib/modal.js     ironrdp-wasm/example/lib/modal.js
cp web/lib/reveal.js    ironrdp-wasm/example/lib/reveal.js

# The logo/favicons/watermark were never actually reaching the browser -
# only the individual html/css/js files above were copied, so every
# <img src="assets/..."> 404'd and the browser silently fell back to
# rendering the alt text in that tiny box (which is exactly the "Web" /
# "WebR" fragment you'd see instead of the logo). This is the actual fix
# for that, not just a CSS tweak.
rm -rf ironrdp-wasm/example/assets
cp -r web/assets ironrdp-wasm/example/assets

echo ""
echo "Setup complete. Run ./scripts/start.sh to launch."
