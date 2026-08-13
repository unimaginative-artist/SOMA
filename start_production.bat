@echo off
echo ===============================================================================
echo   SOMA ULTRA - PRODUCTION STARTUP
echo ===============================================================================
echo.
echo   [0] Igniting Hot Tier Infrastructure (WSL2 Redis) in background...
REM Non-blocking: a slow/unresponsive WSL must NEVER hang the whole launch
REM (it used to block here forever, so node never started). Redis is an
REM optional hot-tier cache; SOMA runs fine while it warms up separately.
start "RedisInit" /min cmd /c "wsl -u root service redis-server start >nul 2>&1"
echo       Redis init launched (non-blocking; Hot Tier warms up shortly).
echo.

echo   [1] Setting Environment to PRODUCTION...
set NODE_ENV=production
set SOMA_MODE=standalone
set SOMA_GPU=true
set SOMA_LOAD_HEAVY=true
set SOMA_LOAD_TRADING=true
set SOMA_HYBRID_SEARCH=true
set SOMA_LOAD_VISION=true
REM Keep native ML helpers from monopolizing every CPU core. Ollama/Bonsai run
REM in their own processes; SOMA's in-process embeddings and CLIP need only a
REM small bounded pool so chat, Discord, trading, and /health stay responsive.
set OMP_NUM_THREADS=2
set OMP_THREAD_LIMIT=2
set MKL_NUM_THREADS=2
set ORT_NUM_THREADS=2
set SOMA_IMAGE_PROVIDER=bonsai
set BONSAI_IMAGE_ENDPOINT=http://127.0.0.1:8000/generate
set BONSAI_IMAGE_BACKEND=bonsai-ternary-gemlite
set BONSAI_IMAGE_STEPS=4
set SOMA_BLUESKY_AUTO_IMAGES=true

rem ── DeepSeek spend caps (CostLedger). SOMA is local-first; DeepSeek is only for
rem   social posting + chatting. $1/day is the safety net if her local limiters get
rem   accidentally removed; $15/month is the hard ceiling.
set SOMA_DAILY_BUDGET_USD=1
set SOMA_MONTHLY_BUDGET_USD=15

rem ── Local Ollama models (installed on this machine) ──────────────────────────
rem   OLLAMA_MODEL      : default / heartbeat / proactive messages
rem   OLLAMA_MODEL_LOGOS     : code, logic, engineering (heaviest, best quality)
rem   OLLAMA_MODEL_AURORA    : creative, synthesis, emotional reasoning
rem   OLLAMA_MODEL_PROMETHEUS: strategy, planning, short tasks (fast)
set OLLAMA_MODEL=qwen2.5:7b
REM LOGOS was pinned to qwen2.5-coder:14b (9.9GB) — on this 32GB box that + the
REM 7B + MAX's model thrashed RAM to 98% and wedged SOMA on Discord (2026-08-12).
REM Consolidated to the 7B (shared with OLLAMA_MODEL, so no extra model loads).
set OLLAMA_MODEL_LOGOS=qwen2.5:7b
set OLLAMA_MODEL_AURORA=qwen2.5:7b
set OLLAMA_MODEL_PROMETHEUS=llama3.2:latest

echo   [2] Checking for dependencies...
if not exist "node_modules" (
    echo       Node modules not found. Installing...
    npm install
)

echo   [3] Starting Project Siren (Fish-Speech TTS)...
echo       - Fish-Speech Core on :8080
echo       - Paula Voice Proxy on :8081
start "" /B powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start_siren.ps1"
echo       Siren launching in background (takes ~15s to warm up)...
echo.

echo   [3b] Starting Bonsai Image Engine...
echo       - Backend: http://127.0.0.1:8000/generate
echo       - Frontend: http://localhost:3101
start "" /B powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\start-bonsai-image-engine.ps1" -BackendPort 8000 -FrontendPort 3101
echo       Bonsai launching in background; SOMA will use fallback until it is warm.
echo.

echo   [4] Starting SOMA ULTRA...
echo       - Backend: Enabled
echo       - Frontend: Serving from /dist
echo       - GPU Acceleration: Enabled
echo       - Auto-Training: Enabled
echo.
echo   Access the dashboard at: http://localhost:3001
echo.

node --max-old-space-size=4096 --expose-gc launcher_ULTRA.mjs
pause
