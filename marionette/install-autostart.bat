@echo off
REM ── Make Marionette start automatically at every login (no admin needed) ────
REM Drops a shortcut in your Startup folder that launches the hidden,
REM self-restarting supervisor. Run once. To undo: delete the shortcut from
REM   shell:startup   (a Run box: Win+R -> shell:startup).

setlocal
set "VBS=%~dp0run-marionette-hidden.vbs"

powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell);" ^
  "$lnk=$s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Marionette.lnk'));" ^
  "$lnk.TargetPath='wscript.exe';" ^
  "$lnk.Arguments='\"%VBS%\"';" ^
  "$lnk.WorkingDirectory='%~dp0';" ^
  "$lnk.WindowStyle=7;" ^
  "$lnk.Description='Marionette - SOMA/MAX stack supervisor (auto-start, self-restarting)';" ^
  "$lnk.Save();" ^
  "Write-Host 'Startup shortcut installed.'"

echo.
echo Starting Marionette now so you don't have to log out/in:
start "" wscript.exe "%VBS%"
echo.
echo  Status:  http://127.0.0.1:9000/status
echo  Done. Marionette will now start on every login and keep SOMA (+ MAX) alive.
pause
