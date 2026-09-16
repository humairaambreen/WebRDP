'use strict';

const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const { handleConnection } = require('./lib/rdp-proxy');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT = path.join(__dirname, 'web');
const PKG = path.join(__dirname, 'pkg');

const app = express();
expressWs(app);

// ── Static file serving ──

// 1. Serve Web UI from web/
app.use(express.static(ROOT));

// 2. Serve WASM package from pkg/ with correct application/wasm MIME type
app.use('/pkg', express.static(PKG, {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    },
}));

// ── WebSocket RDCleanPath proxy ──
// The WASM client connects to ws://<host>:<port>/
// express-ws handles the upgrade; we delegate to lib/rdp-proxy.

app.ws('/', (ws, _req) => {
    handleConnection(ws);
});

// ── Start ──

app.listen(PORT, () => {
    console.log(`\n  🚀 WebRDP server on http://localhost:${PORT}/`);
    console.log(`  📂 Serving UI from ${ROOT}`);
    console.log(`  📦 Serving WASM from ${PKG}`);
    console.log(`  🔌 WebSocket proxy on ws://localhost:${PORT}/\n`);
});
