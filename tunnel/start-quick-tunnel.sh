#!/bin/bash
# Starts an instant Cloudflare Quick Tunnel (Free, no domain or account required)
# Exposes the local Axum backend on a public HTTPS *.trycloudflare.com URL

echo "=========================================================="
echo "🌐 Starting Cloudflare Quick Tunnel for TheySynced Axum"
echo "=========================================================="

if ! command -v cloudflared &> /dev/null; then
    echo "cloudflared CLI not found. Installing via brew / curl..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install cloudflared
    else
        curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
        sudo dpkg -i cloudflared.deb
    fi
fi

echo "Launching Quick Tunnel forwarding to Axum on http://127.0.0.1:8000..."
cloudflared tunnel --url http://127.0.0.1:8000
