# scheduled_prometheus_train.ps1
# Automated 3:00 AM execution script for SOMA Prometheus LoRA fine-tuning

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$SomaDir = Split-Path -Parent $ScriptDir
$LogDir = Join-Path $SomaDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "scheduled-prometheus-train.log"

function Log-Message {
    param([string]$Msg)
    $TimeStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Line = "[$TimeStamp] $Msg"
    Write-Host $Line
    Add-Content -Path $LogFile -Value $Line -Encoding utf8
}

Log-Message "========================================================"
Log-Message "🚀 3:00 AM Prometheus LoRA Fine-Tuning Trigger Started"
Log-Message "Working directory: $SomaDir"

$ServerOnline = $false
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get -TimeoutSec 5 -ErrorAction Stop
    if ($health.status -eq "healthy" -or $health.ok -eq $true) {
        $ServerOnline = $true
        Log-Message "✅ SOMA core server online (uptime: $($health.uptime)s)"
    }
} catch {
    Log-Message "⚠️ SOMA server health check returned: $_"
}

if ($ServerOnline) {
    Log-Message "Triggering LoRA training via SOMA API: POST /api/soma/training/approve-lora"
    try {
        $body = @{ lobe = "prometheus" } | ConvertTo-Json
        $response = Invoke-RestMethod -Uri "http://localhost:3001/api/soma/training/approve-lora" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
        Log-Message "✅ API Trigger Response: $($response | ConvertTo-Json -Compress)"
        Log-Message "SOMA OllamaAutoTrainer is now orchestrating Prometheus training, NEMESIS gating, and promotion."
    } catch {
        Log-Message "❌ API POST failed: $_. Falling back to direct CLI execution..."
        $ServerOnline = $false
    }
}

if (-not $ServerOnline) {
    Log-Message "Executing direct standalone training via .soma_train_venv..."
    Set-Location $SomaDir
    $PythonExe = Join-Path $SomaDir ".soma_train_venv\Scripts\python.exe"
    $TrainerScript = Join-Path $SomaDir "scripts\finetune_gemma3.py"
    $DataDir = Join-Path $SomaDir "SOMA\training-data"

    if (-not (Test-Path $PythonExe)) {
        $PythonExe = "python"
    }

    Log-Message "Launching: $PythonExe $TrainerScript --lobe prometheus --data-path `"$DataDir`" --yes"
    & $PythonExe $TrainerScript --lobe prometheus --data-path "$DataDir" --yes 2>&1 | Tee-Object -FilePath $LogFile -Append
    Log-Message "Direct CLI training execution finished with exit code: $LASTEXITCODE"
}

Log-Message "🏁 Prometheus 3:00 AM job sequence finished."
Log-Message "========================================================"
