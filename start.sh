#!/usr/bin/env bash
# start.sh — SOMA production launcher (Linux / macOS)
# First time? Run:  node setup.mjs

set -e

echo "==================================================="
echo "   SOMA Cognitive OS — Production Launcher"
echo "==================================================="

# ── Kill any lingering SOMA processes ─────────────────
echo ""
echo "[1] Clearing old processes..."
pkill -f "launcher_ULTRA.mjs" 2>/dev/null || true
pkill -f "soma.*server" 2>/dev/null || true
sleep 1

# ── Verify dist/ exists ────────────────────────────────
if [ ! -d "dist" ]; then
    echo ""
    echo "[!] dist/ not found — building frontend first..."
    npm run build
fi

# ── Launch SOMA ────────────────────────────────────────
echo ""
echo "[2] Starting SOMA Core Backend..."
export NODE_ENV=production
export SOMA_LOAD_HEAVY=true
export SOMA_LOAD_TRADING=true

node --max-old-space-size=4096 launcher_ULTRA.mjs
