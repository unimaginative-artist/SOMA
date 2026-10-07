@echo off
cd /d "C:\Users\YOUR_USER\Desktop\The Stack\SOMA"
node scripts\check-selfmod-progress.mjs >> data\selfmod-check.log 2>&1
