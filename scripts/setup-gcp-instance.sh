#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SOMA - GCP Instance Setup Script
# Run this on your Google Cloud instance after SSH'ing in
# ═══════════════════════════════════════════════════════════════

echo "════════════════════════════════════════════════════════════"
echo "  SOMA - Cloud Instance Setup"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check GPU
echo "🎮 Step 1: Checking GPU..."
nvidia-smi
echo ""

# Update system
echo "📦 Step 2: Updating system..."
sudo apt-get update -y
echo ""

# Install Python dependencies
echo "🐍 Step 3: Installing Python packages..."
pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip3 install google-cloud-aiplatform
echo ""

# Verify PyTorch CUDA
echo "✅ Step 4: Verifying PyTorch CUDA..."
python3 -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA Available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"
echo ""

echo "════════════════════════════════════════════════════════════"
echo "  ✅ Setup Complete!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Upload SOMA training script from your laptop:"
echo "     (In a NEW terminal on your laptop, run:)"
echo "     gcloud compute scp arbiters/gpu_training_real.py soma-1126:~/ --zone YOUR_ZONE"
echo ""
echo "  2. Run training on cloud GPU:"
echo "     python3 gpu_training_real.py --command benchmark --batch-size 1024 --iterations 1000"
echo ""
