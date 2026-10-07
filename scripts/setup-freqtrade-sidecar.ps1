$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $workspace '.soma_trade_venv'
$python = Join-Path $venv 'Scripts\python.exe'
$freqtrade = Join-Path $venv 'Scripts\freqtrade.exe'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv is required. Install uv, then rerun npm run trading:freqtrade:setup.'
}

Push-Location $workspace
try {
    if (-not (Test-Path $python)) {
        uv venv $venv --python 3.11
    }
    uv pip install --python $python 'freqtrade==2026.7'
    & $freqtrade --version
} finally {
    Pop-Location
}

