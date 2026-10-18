#!/bin/sh
set -e

# Start Tor privacy daemon in background if available
if command -v tor >/dev/null 2>&1; then
  echo "[TheySynced OS] Starting Tor privacy network daemon (SOCKS5 127.0.0.1:9050)..."
  tor --runasdaemon 1 --DataDirectory /var/lib/tor --SocksPort 9050 2>/dev/null || true
fi

# Ensure workspace directory hierarchy
mkdir -p /workspace/chats
mkdir -p /workspace/docs
mkdir -p /workspace/spreadsheets
mkdir -p /workspace/drawings
mkdir -p /workspace/tasks
mkdir -p /workspace/files
mkdir -p /workspace/export

# Ensure full workspace read/write access for all team members
chmod -R 777 /workspace 2>/dev/null || true

echo "[TheySynced OS] Enterprise Linux Work OS initialized."
echo "[TheySynced OS] Host: $(hostname) | Kernel: $(uname -sr) | Architecture: $(uname -m)"

exec "$@"
