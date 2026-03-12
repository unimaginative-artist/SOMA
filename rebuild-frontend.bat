@echo off
echo ===============================================
echo   SOMA Frontend Rebuild
echo ===============================================
echo.
echo   Building frontend/dist from source...
echo.
cd /d "%~dp0frontend"
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Build failed! Check output above.
    pause
    exit /b 1
)
echo.
echo   [DONE] frontend/dist updated.
echo   Restart SOMA to pick up changes.
echo.
pause
