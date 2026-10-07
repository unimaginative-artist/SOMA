"""
REAL GPU Training for SOMA - NO SIMULATION
Uses PyTorch with CUDA to train actual neural networks on your GTX 1650
"""

import torch
import torch.nn as nn
import torch.optim as optim
import time
import json
import sys
from datetime import datetime

class SOMANeuralNet(nn.Module):
    """Simple neural network for SOMA's learning"""
    def __init__(self, input_size=128, hidden_size=256, output_size=64):
        super(SOMANeuralNet, self).__init__()
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.relu1 = nn.ReLU()
        self.dropout1 = nn.Dropout(0.2)
        self.fc2 = nn.Linear(hidden_size, hidden_size)
        self.relu2 = nn.ReLU()
        self.dropout2 = nn.Dropout(0.2)
        self.fc3 = nn.Linear(hidden_size, output_size)

    def forward(self, x):
        x = self.fc1(x)
        x = self.relu1(x)
        x = self.dropout1(x)
        x = self.fc2(x)
        x = self.relu2(x)
        x = self.dropout2(x)
        x = self.fc3(x)
        return x

def check_gpu():
    """Check GPU availability and info"""
    cuda_available = torch.cuda.is_available()

    if cuda_available:
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
        return {
            'available': True,
            'name': gpu_name,
            'memory_gb': round(gpu_memory, 2),
            'cuda_version': torch.version.cuda
        }
    else:
        return {'available': False}

def train_on_device(device_type='cuda', batch_size=32, iterations=100, input_size=128,
                    hidden_size=256, output_size=64):
    """
    REAL training on specified device
    Returns actual performance metrics
    """

    # Set device
    device = torch.device(device_type if torch.cuda.is_available() and device_type == 'cuda' else 'cpu')

    # Create model
    model = SOMANeuralNet(input_size, hidden_size, output_size).to(device)

    # Loss and optimizer
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    # Generate random training data
    total_samples = batch_size * iterations
    X = torch.randn(total_samples, input_size).to(device)
    y = torch.randn(total_samples, output_size).to(device)

    # Training loop
    model.train()
    losses = []
    start_time = time.time()

    for i in range(iterations):
        # Get batch
        start_idx = i * batch_size
        end_idx = start_idx + batch_size
        batch_X = X[start_idx:end_idx]
        batch_y = y[start_idx:end_idx]

        # Forward pass
        outputs = model(batch_X)
        loss = criterion(outputs, batch_y)

        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        losses.append(loss.item())

    # Ensure all GPU operations complete
    if device_type == 'cuda':
        torch.cuda.synchronize()

    duration_ms = (time.time() - start_time) * 1000
    throughput = (total_samples / duration_ms) * 1000  # samples per second

    # Get memory usage
    memory_used_mb = 0
    if device_type == 'cuda':
        memory_used_mb = torch.cuda.max_memory_allocated() / (1024**2)
        torch.cuda.reset_peak_memory_stats()

    return {
        'device': device_type,
        'duration_ms': round(duration_ms, 2),
        'throughput': round(throughput, 2),
        'total_samples': total_samples,
        'batch_size': batch_size,
        'iterations': iterations,
        'final_loss': round(losses[-1], 6),
        'average_loss': round(sum(losses) / len(losses), 6),
        'memory_used_mb': round(memory_used_mb, 2),
        'model_params': sum(p.numel() for p in model.parameters())
    }

def benchmark(batch_size=32, iterations=100):
    """Run benchmark on both CPU and GPU"""
    results = {
        'timestamp': datetime.now().isoformat(),
        'batch_size': batch_size,
        'iterations': iterations
    }

    # Check GPU
    gpu_info = check_gpu()
    results['gpu_info'] = gpu_info

    # CPU benchmark
    print(f"[GPU Training] Running CPU benchmark...", file=sys.stderr)
    results['cpu'] = train_on_device('cpu', batch_size, iterations)

    # GPU benchmark (if available)
    if gpu_info['available']:
        print(f"[GPU Training] Running GPU benchmark...", file=sys.stderr)
        results['gpu'] = train_on_device('cuda', batch_size, iterations)

        # Calculate speedup
        speedup = results['cpu']['duration_ms'] / results['gpu']['duration_ms']
        results['speedup'] = round(speedup, 2)
        print(f"[GPU Training] GPU is {speedup:.2f}x faster than CPU!", file=sys.stderr)

    return results

def main():
    """Main entry point for command line usage"""
    import argparse

    parser = argparse.ArgumentParser(description='SOMA Real GPU Training')
    parser.add_argument('--command', type=str, required=True,
                       choices=['check_gpu', 'train', 'benchmark'],
                       help='Command to execute')
    parser.add_argument('--device', type=str, default='cuda', choices=['cuda', 'cpu'],
                       help='Device to use for training')
    parser.add_argument('--batch-size', type=int, default=32,
                       help='Batch size for training')
    parser.add_argument('--iterations', type=int, default=100,
                       help='Number of training iterations')

    args = parser.parse_args()

    if args.command == 'check_gpu':
        result = check_gpu()
    elif args.command == 'train':
        result = train_on_device(args.device, args.batch_size, args.iterations)
    elif args.command == 'benchmark':
        result = benchmark(args.batch_size, args.iterations)

    # Output JSON result
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
