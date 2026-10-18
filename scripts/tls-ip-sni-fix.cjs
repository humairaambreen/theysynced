'use strict'

/**
 * tls-ip-sni-fix.js
 *
 * Fixes a crash in ironrdp-wasm/example/lib/rdp-proxy.js: it calls
 * tls.connect() with `servername` set to the destination host, but
 * Node.js refuses to accept an IP address as a TLS SNI servername
 * (RFC 6066 says SNI is for hostnames only) and throws
 * ERR_INVALID_ARG_VALUE, killing the whole process.
 *
 * This is loaded via `node -r` BEFORE the example server starts, so it
 * patches the global tls module before rdp-proxy.js ever calls it -
 * no need to edit the vendored file directly.
 *
 * What it does:
 *   1. If `servername` is an IP address, remove it. Node then just
 *      skips sending SNI, which is exactly what it would do anyway if
 *      servername was never set - this matches how e.g. mstsc behaves
 *      when connecting straight to an IP.
 *   2. If `rejectUnauthorized` wasn't explicitly set, default it to
 *      false. Windows RDP servers almost always present a self-signed
 *      certificate, and without this the *next* thing you'd hit is a
 *      cert validation failure. This intentionally loosens TLS
 *      verification - acceptable for connecting to your own known
 *      server, but worth knowing about if you ever point this at
 *      something you don't fully trust.
 */

const tls = require('tls')
const net = require('net')

const originalConnect = tls.connect

function isIpAddress (value) {
  return typeof value === 'string' && net.isIP(value) !== 0
}

function findOptionsObject (args) {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && !Buffer.isBuffer(arg)) {
      return arg
    }
  }
  return null
}

tls.connect = function patchedTlsConnect (...args) {
  const options = findOptionsObject(args)

  if (options) {
    if (isIpAddress(options.servername)) {
      delete options.servername
    }
    if (options.rejectUnauthorized === undefined) {
      options.rejectUnauthorized = false
    }
  }

  return originalConnect.apply(this, args)
}

console.log('[tls-ip-sni-fix] Patched tls.connect (IP-as-SNI guard + self-signed cert tolerance)')
