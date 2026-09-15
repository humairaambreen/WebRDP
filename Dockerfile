# syntax=docker/dockerfile:1
#
# Builds WebRDP for Back4app Containers (or any Docker host). This mirrors
# scripts/setup.sh + scripts/start.sh exactly, just non-interactively and
# split into two stages so the final image doesn't carry the Rust
# toolchain, the wasm-pack build cache, or git history - only Node plus
# the compiled WASM engine and the proxy server actually need to ship.
#
# ---------------------------------------------------------------------------
# Stage 1: build the IronRDP -> WASM engine and drop WebRDP's UI on top of
# the vendored ironrdp-wasm example, same as scripts/setup.sh does locally.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl git build-essential pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack --version 0.15.0

WORKDIR /build

# Tracks the vendored repo's main branch, same as scripts/setup.sh. For a
# fully reproducible build (recommended once you're happy with how this
# runs), pin a commit instead:
#   RUN git clone https://github.com/electerm/ironrdp-wasm.git \
#       && cd ironrdp-wasm && git checkout <commit-sha>
RUN git clone --depth 1 https://github.com/electerm/ironrdp-wasm.git

# Same harmless "unused import" warning patch as scripts/setup.sh - purely
# cosmetic, never fails the build if upstream has already changed the file.
RUN if [ -f ironrdp-wasm/src/lib.rs ] && ! grep -q "allow(unused_imports)" ironrdp-wasm/src/lib.rs; then \
      sed -i '1i #![allow(unused_imports)]' ironrdp-wasm/src/lib.rs; \
    fi

WORKDIR /build/ironrdp-wasm
RUN npm install && npm run build

WORKDIR /build/ironrdp-wasm/example
# --omit=dev: this is the runtime proxy server's own deps, not a build tool
RUN npm install --omit=dev \
    && npm audit fix --audit-level=moderate || true

WORKDIR /build
COPY web ./webrdp-ui
RUN rm -f ironrdp-wasm/example/lib/file-transfer.js && \
    cp webrdp-ui/index.html        ironrdp-wasm/example/index.html && \
    cp webrdp-ui/style.css         ironrdp-wasm/example/style.css && \
    cp webrdp-ui/app.js            ironrdp-wasm/example/app.js && \
    cp webrdp-ui/lib/logger.js     ironrdp-wasm/example/lib/logger.js && \
    cp webrdp-ui/lib/session.js    ironrdp-wasm/example/lib/session.js && \
    cp webrdp-ui/lib/input.js      ironrdp-wasm/example/lib/input.js && \
    cp webrdp-ui/lib/clipboard.js  ironrdp-wasm/example/lib/clipboard.js && \
    cp webrdp-ui/lib/api.js        ironrdp-wasm/example/lib/api.js && \
    cp webrdp-ui/lib/dashboard.js  ironrdp-wasm/example/lib/dashboard.js && \
    cp webrdp-ui/lib/modal.js      ironrdp-wasm/example/lib/modal.js && \
    cp webrdp-ui/lib/reveal.js     ironrdp-wasm/example/lib/reveal.js && \
    rm -rf ironrdp-wasm/example/assets && \
    cp -r webrdp-ui/assets ironrdp-wasm/example/assets

# ---------------------------------------------------------------------------
# Stage 2: slim runtime image - Node + the built engine + the proxy server
# only. No Rust toolchain, no git history, no wasm build cache.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim
WORKDIR /app

# Kept as siblings (pkg/ next to example/), exactly like the local dev
# layout - web/app.js imports the engine via a relative '../pkg/...' path,
# so this directory shape isn't cosmetic, it's load-bearing.
COPY --from=builder /build/ironrdp-wasm/pkg     ./ironrdp-wasm/pkg
COPY --from=builder /build/ironrdp-wasm/example ./ironrdp-wasm/example
COPY scripts/tls-ip-sni-fix.js ./tls-ip-sni-fix.js

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

WORKDIR /app/ironrdp-wasm/example
CMD ["node", "-r", "/app/tls-ip-sni-fix.js", "server.js"]
