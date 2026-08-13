@echo off
REM ── Lean, reliable SOMA launch for supervised auto-recovery ─────────────────
REM Same env as start_production.bat but WITHOUT the optional preamble that can
REM hang (WSL/Redis hot-tier, Siren TTS, Bonsai images). Marionette uses THIS so
REM recovery never blocks on WSL. Start those extras via start_production.bat for
REM a full interactive session; core SOMA runs fine without them.

cd /d "%~dp0"
set NODE_ENV=production
set SOMA_MODE=standalone
set SOMA_GPU=true
set SOMA_LOAD_HEAVY=true
set SOMA_LOAD_TRADING=true
set SOMA_HYBRID_SEARCH=true
set SOMA_LOAD_VISION=true
REM Bound in-process ONNX/CLIP/embedding parallelism. Unbounded native worker
REM pools previously consumed several cores and starved HTTP/Discord while a
REM goal performed memory recall or vision classification.
set OMP_NUM_THREADS=2
set OMP_THREAD_LIMIT=2
set MKL_NUM_THREADS=2
set ORT_NUM_THREADS=2
set OLLAMA_MODEL=qwen2.5:7b
REM LOGOS was pinned to qwen2.5-coder:14b (9.9GB) — on this 32GB box that + the
REM 7B + MAX's model thrashed RAM to 98% and wedged SOMA on Discord (2026-08-12).
REM Consolidated to the 7B (shared with OLLAMA_MODEL, so no extra model loads).
set OLLAMA_MODEL_LOGOS=qwen2.5:7b
set OLLAMA_MODEL_AURORA=qwen2.5:7b
set OLLAMA_MODEL_PROMETHEUS=llama3.2:latest

node --max-old-space-size=4096 --expose-gc launcher_ULTRA.mjs
