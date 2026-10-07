@echo off
REM ════════════════════════════════════════════════════════════════
REM SOMA - Connect to Google Cloud Instance (Windows)
REM ════════════════════════════════════════════════════════════════

echo.
echo ════════════════════════════════════════════════════════════════
echo   SOMA → Google Cloud Connection Helper
echo ════════════════════════════════════════════════════════════════
echo.

REM Check if gcloud is installed
where gcloud >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Google Cloud CLI not found!
    echo.
    echo 📦 Download from: https://cloud.google.com/sdk/docs/install
    echo    Run installer and restart terminal
    echo.
    pause
    exit /b 1
)

echo ✅ Google Cloud CLI found!
echo.

REM Login
echo 🔐 Step 1: Logging in to Google Cloud...
gcloud auth login

REM Set project
echo.
echo 📋 Step 2: Setting project to 1059546448038...
gcloud config set project 1059546448038

REM List instances
echo.
echo 📊 Step 3: Your Compute Instances:
echo.
gcloud compute instances list

echo.
echo ════════════════════════════════════════════════════════════════
echo   Connection Commands:
echo ════════════════════════════════════════════════════════════════
echo.
echo SSH to instance (replace INSTANCE_NAME and ZONE):
echo   gcloud compute ssh INSTANCE_NAME --zone ZONE
echo.
echo Example:
echo   gcloud compute ssh soma-gpu-trainer --zone us-central1-a
echo.
echo Copy files TO instance:
echo   gcloud compute scp LOCAL_FILE INSTANCE_NAME:~/REMOTE_PATH --zone ZONE
echo.
echo Copy files FROM instance:
echo   gcloud compute scp INSTANCE_NAME:~/REMOTE_FILE ./LOCAL_PATH --zone ZONE
echo.
echo ════════════════════════════════════════════════════════════════
pause
