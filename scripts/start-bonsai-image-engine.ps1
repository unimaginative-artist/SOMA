param(
    [switch]$SkipSetup,
    [switch]$ForceRestart,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BonsaiDir = Join-Path $RepoRoot "research\Bonsai-Image-Demo"

if (-not (Test-Path $BonsaiDir)) {
    throw "Bonsai repo not found at $BonsaiDir"
}

$HealthUrl = "http://127.0.0.1:$BackendPort/backends"
if (-not $ForceRestart) {
    try {
        $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
        if ($health.healthy -eq $true) {
            Write-Host "[SOMA] Bonsai image engine already healthy on :$BackendPort."
            exit 0
        }
    } catch {
        # Not already healthy; continue into setup/start.
    }
}

Push-Location $BonsaiDir
try {
    $vendorDir = Join-Path $BonsaiDir "vendor"
    $modelsDir = Join-Path $BonsaiDir "models"
    $needsSetup = -not (Test-Path $vendorDir) -or -not (Test-Path $modelsDir)

    if ($needsSetup -and -not $SkipSetup) {
        Write-Host "[SOMA] Bonsai install not found. Running setup.ps1..."
        powershell -ExecutionPolicy Bypass -File .\setup.ps1
        if ($LASTEXITCODE -ne 0) { throw "Bonsai setup failed with exit code $LASTEXITCODE" }
    } elseif ($needsSetup) {
        Write-Host "[SOMA] Bonsai setup is missing, but -SkipSetup was passed."
        exit 1
    } else {
        Write-Host "[SOMA] Bonsai setup detected."
    }

    $env:BACKEND_PORT = "$BackendPort"
    $env:FRONTEND_PORT = "$FrontendPort"
    $env:SOMA_IMAGE_PROVIDER = "bonsai"
    $env:BONSAI_IMAGE_ENDPOINT = "http://127.0.0.1:$BackendPort/generate"
    if (-not $env:BONSAI_IMAGE_BACKEND) { $env:BONSAI_IMAGE_BACKEND = "bonsai-ternary-gemlite" }
    if (-not $env:BONSAI_IMAGE_STEPS) { $env:BONSAI_IMAGE_STEPS = "4" }

    Write-Host "[SOMA] Starting Bonsai image engine on $env:BONSAI_IMAGE_ENDPOINT"
    powershell -ExecutionPolicy Bypass -File .\scripts\serve.ps1
} finally {
    Pop-Location
}
