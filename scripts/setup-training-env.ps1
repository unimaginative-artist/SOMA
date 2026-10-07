$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.soma_train_venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv is required to create the isolated SOMA training environment.'
}

if (-not (Test-Path -LiteralPath $python)) {
    uv venv $venv --python 3.11
}

uv pip install --python $python torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0 `
    --index-url https://download.pytorch.org/whl/cu128
uv pip install --python $python -r (Join-Path $root 'config\training-requirements.txt')

& $python (Join-Path $root 'scripts\training_preflight.py') --require-free-gb 1
