@echo off
echo ===================================================
echo   SOMA CLEAN RESTART PROTOCOL
echo ===================================================
echo.
set SOMA_LOAD_TRADING=true

echo [0/4] Pausing Marionette supervisor (auto-resumes in 4 min) so it does not
echo       race this restart...
curl -s -m 2 -X POST "http://127.0.0.1:9000/pause?seconds=240" >nul 2>&1

echo [1/4] Killing Siren TTS processes (Fish-Speech + Paula)...
taskkill /F /FI "WINDOWTITLE eq siren*" 2>nul
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080,8081 -State Listen -EA 0 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA 0 }; Write-Host '   - Siren ports 8080/8081 cleared.'"

echo [1b/4] Killing SOMA Node.js processes (sparing Claude Code)...
powershell -NoProfile -Command "$killed=0; Get-WmiObject Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'launcher_ULTRA|start-production|soma' -and $_.CommandLine -notmatch 'claude' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA 0; $killed++ }; Write-Host \"   - Killed $killed SOMA node process(es).\""
REM Reliably reclaim port 3001 — kill the owner and WAIT until the port is actually
REM free before relaunching (the old kill raced the new node and lost the bind).
powershell -NoProfile -Command "for($i=0;$i -lt 12;$i++){ $p=(Get-NetTCPConnection -LocalPort 3001 -State Listen -EA 0 ^| Select-Object -First 1).OwningProcess; if(-not $p){ if($i -gt 0){ Write-Host '   - Port 3001 free.' }; break }; Stop-Process -Id $p -Force -EA 0; Start-Sleep -Milliseconds 600 }; if((Get-NetTCPConnection -LocalPort 3001 -State Listen -EA 0)){ Write-Host '   - WARNING: port 3001 still held after retries.' } else { Write-Host '   - Killed port 3001 owner; port free.' }"

echo [2/4] Killing lingering Electron processes...
taskkill /F /IM electron.exe /T 2>nul
if %errorlevel% equ 0 (
    echo    - Killed electron.exe processes.
) else (
    echo    - No electron.exe processes found or access denied.
)

echo [3/4] Clearing temporary states (optional)...
REM Add any specific cache clearing if needed here
REM e.g., del /s /q .soma\*.tmp 2>nul

echo.
echo [4/4] Restarting SOMA System (Production Mode)...
echo    - Launching: start_production.bat
echo.

call start_production.bat
