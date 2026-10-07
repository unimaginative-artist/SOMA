@echo off
REM Automatic daily knowledge feed for SOMA
REM This script is run by Windows Task Scheduler

cd /d "%~dp0\.."
node scripts\feed-soma-daily.mjs >> logs\daily-feed.log 2>&1

echo [%date% %time%] Daily feed completed >> logs\daily-feed.log
