@echo off
echo ===================================================
echo   SOMA CLEAN RESTART PROTOCOL
echo ===================================================
echo.

echo [1/4] Killing lingering Node.js processes...
taskkill /F /IM node.exe /T 2>nul
if %errorlevel% equ 0 (
    echo    - Killed node.exe processes.
) else (
    echo    - No node.exe processes found or access denied.
)

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
