#!/usr/bin/env bash
# Waits for AURORA training to complete, then exports + registers + trains PROMETHEUS
set -e

SOMA_ROOT="C:\Users\YOUR_USER/OneDrive/Desktop/The Stack/SOMA"
LOBE_DIR="$SOMA_ROOT/SOMA/models/lobe-aurora"
ADAPTER="$LOBE_DIR/adapter_model.safetensors"

echo "=== POST-AURORA CHAIN: waiting for training to complete ==="
echo "Watching: $ADAPTER"

while [ ! -f "$ADAPTER" ]; do
  echo "[$(date '+%H:%M:%S')] Still training... (checking every 60s)"
  sleep 60
done

echo ""
echo "[$(date '+%H:%M:%S')] adapter_model.safetensors found — AURORA training complete!"
echo ""

cd "$SOMA_ROOT"

# Step 1: Export AURORA -> GGUF
echo "=== STEP 1: Export AURORA LoRA -> GGUF ==="
python -X utf8 scripts/export_lobe_gguf.py --lobe aurora
echo "Export done."

# Step 2: Register in Ollama
echo ""
echo "=== STEP 2: Register soma-aurora in Ollama ==="
ollama create soma-aurora -f "SOMA/models/Modelfile.aurora"
echo "Ollama registration done."

# Step 3: Verify registration
echo ""
echo "=== STEP 3: Verify ==="
ollama list | grep aurora || echo "(not found in ollama list — check manually)"

# Step 4: Start PROMETHEUS training
echo ""
echo "=== STEP 4: Train PROMETHEUS lobe ==="
python -X utf8 scripts/finetune_gemma3.py \
  --lobe prometheus \
  --model nvidia/nemotron-mini-4b-instruct \
  --epochs 3

echo ""
echo "=== PROMETHEUS training complete ==="

# Step 5: Export PROMETHEUS -> GGUF
echo "=== STEP 5: Export PROMETHEUS LoRA -> GGUF ==="
python -X utf8 scripts/export_lobe_gguf.py --lobe prometheus
echo "Export done."

# Step 6: Register PROMETHEUS in Ollama
echo ""
echo "=== STEP 6: Register soma-prometheus in Ollama ==="
ollama create soma-prometheus -f "SOMA/models/Modelfile.prometheus"
echo "Ollama registration done."

# Step 7: Final status
echo ""
echo "=== ALL DONE — Ollama lobe roster ==="
ollama list | grep soma
echo ""
echo "All 4 lobes trained and registered. Sandwich Pattern is fully armed."
