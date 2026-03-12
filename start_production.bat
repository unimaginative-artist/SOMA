@echo off
echo ===============================================================================
echo   SOMA ULTRA - PRODUCTION STARTUP
echo ===============================================================================
echo.
echo   [1] Setting Environment to PRODUCTION...
set NODE_ENV=production
set SOMA_MODE=cluster
set SOMA_GPU=true
set SOMA_LOAD_HEAVY=true
set SOMA_LOAD_TRADING=true
set SOMA_HYBRID_SEARCH=true

echo   [2] Checking for dependencies...
if not exist "node_modules" (
    echo       Node modules not found. Installing...
    npm install
)

echo   [3] Starting SOMA ULTRA...
echo       - Backend: Enabled
echo       - Frontend: Serving from /dist
echo       - GPU Acceleration: Enabled
echo       - Auto-Training: Enabled
echo.
echo   Access the dashboard at: http://localhost:3001
echo.

node --max-old-space-size=4096 launcher_ULTRA.mjs
pause
