# SOMA Auto-Training Dependency Installer (Windows/Production)
# -----------------------------------------------------------
# Sets up a dedicated Python environment for SOMA's self-training loop.
# Handles PyTorch CUDA installation and bitsandbytes compatibility.

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "           SOMA TRAINING STACK INSTALLER (v2.1)             " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Check Python
Write-Host "`n[1/5] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version
    Write-Host "   Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Error "Python not found! Please install Python 3.10+ and add to PATH."
}

# 2. Create/Activate Virtual Environment
$venvPath = Join-Path (Get-Location) ".soma_venv"
Write-Host "`n[2/5] Setting up Virtual Environment at: $venvPath" -ForegroundColor Yellow

if (-not (Test-Path $venvPath)) {
    Write-Host "   Creating venv..."
    python -m venv $venvPath
} else {
    Write-Host "   Venv exists, verifying..."
}

# Activate venv for current session
$pipPath = Join-Path $venvPath "Scripts\pip.exe"
$pythonPath = Join-Path $venvPath "Scripts\python.exe"

if (-not (Test-Path $pipPath)) {
    Write-Error "Failed to locate pip in venv!"
}

# 3. Upgrade Pip
Write-Host "   Upgrading pip..."
& $pythonPath -m pip install --upgrade pip --quiet

# 4. Install PyTorch with CUDA 12.1
Write-Host "`n[3/5] Installing PyTorch (CUDA 12.1)..." -ForegroundColor Yellow
& $pipPath install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# 5. Install Core Requirements
Write-Host "`n[4/5] Installing SOMA ML Stack..." -ForegroundColor Yellow
& $pipPath install -r requirements-training.txt

# 6. Verification
Write-Host "`n[5/5] Verifying GPU Acceleration..." -ForegroundColor Yellow
$verifyScript = "import torch; print(f'Torch: {torch.__version__}'); print(f'CUDA Available: {torch.cuda.is_available()}');"

& $pythonPath -c $verifyScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSUCCESS: SOMA TRAINING STACK INSTALLED!" -ForegroundColor Green
    Write-Host "   Interpreter: $pythonPath" -ForegroundColor Gray
} else {
    Write-Host "`nFAILURE: Verification Failed." -ForegroundColor Red
}