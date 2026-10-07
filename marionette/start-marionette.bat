@echo off
REM ── Marionette supervisor launcher ──────────────────────────────────────────
REM Keeps SOMA + MAX alive and monitors the bridge. Pure-stdlib Python (no deps).
REM
REM For true production resilience, register this with Windows Task Scheduler so
REM the supervisor itself restarts on boot/crash:
REM   schtasks /Create /TN "Marionette" /SC ONSTART /RL HIGHEST ^
REM     /TR "python \"%~dp0marionette_daemon.py\"" /F
REM
REM Optional Discord alerts: set MARIONETTE_DISCORD_WEBHOOK before launching.

cd /d "%~dp0"
echo [Marionette] Starting production supervisor...
python marionette_daemon.py
pause
