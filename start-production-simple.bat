@echo off
echo ===================================================
echo   SOMA PRODUCTION LAUNCHER (Simple)
echo ===================================================

echo 1. Killing old SOMA processes...
taskkill /F /IM electron.exe /T 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq SOMA BACKEND" /T 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq CT SERVER" /T 2>nul

echo.
echo 2. Starting SOMA Core Backend...
set SOMA_LOAD_HEAVY=true
set SOMA_LOAD_TRADING=true
start "SOMA BACKEND" /min cmd /c "node --max-old-space-size=4096 launcher_ULTRA.mjs"

echo.
echo 3. Starting CT Backend...
cd "a cognitive terminal"
start "CT SERVER" /min cmd /c "npm run server"
cd ..

echo.
echo 4. Waiting for SOMA backend to come online (up to 60s)...
powershell -NoProfile -Command ^
  "$deadline = [DateTime]::Now.AddSeconds(60); " ^
  "do { Start-Sleep -Milliseconds 1500; " ^
  "  try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; break } catch {} " ^
  "} while ([DateTime]::Now -lt $deadline); " ^
  "Write-Host 'SOMA backend is up'"

echo.
echo 5. Launching Command Bridge (Production Mode)...
:: Clear VITE_DEV_SERVER_URL so Electron loads from SOMA backend (http://localhost:3001)
set VITE_DEV_SERVER_URL=
npx electron .

echo.
echo Launch complete. Closing this window...
exit
