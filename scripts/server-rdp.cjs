'use strict';

const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const { handleConnection } = require('./rdp-proxy.cjs');

// Ensure IP SNI guard is loaded
require('./tls-ip-sni-fix.cjs');

const PORT = parseInt(process.env.RDP_PORT || process.env.PORT || '8080', 10);
const PKG = path.join(__dirname, '..', 'public', 'pkg');

const app = express();
expressWs(app);

// Serve WASM package from public/pkg with correct application/wasm MIME type
app.use('/pkg', express.static(PKG, {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    },
}));

// WebSocket RDCleanPath proxy (accepts on both '/' and '/rdp-ws')
app.ws('/', (ws, _req) => {
    handleConnection(ws);
});

app.ws('/rdp-ws', (ws, _req) => {
    handleConnection(ws);
});

app.listen(PORT, () => {
    console.log(`\n  🚀 TheySynced RDP proxy listening on http://localhost:${PORT}/`);
    console.log(`  📦 Serving IronRDP WASM from ${PKG}`);
    console.log(`  🔌 WebSocket bridge active on ws://localhost:${PORT}/rdp-ws\n`);
});
