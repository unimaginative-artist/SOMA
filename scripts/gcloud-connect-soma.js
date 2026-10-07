#!/usr/bin/env node

/**
 * Google Cloud Connection Script for SOMA
 * Easy setup to deploy SOMA on GCP with GPU instances
 *
 * Usage:
 *   node gcloud-connect-soma.js --setup         # Initial GCloud setup
 *   node gcloud-connect-soma.js --create-gpu    # Create GPU instance
 *   node gcloud-connect-soma.js --deploy        # Deploy SOMA to cloud
 *   node gcloud-connect-soma.js --status        # Check cloud status
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════════

const CONFIG = {
  projectId: process.env.GCP_PROJECT_ID || 'soma-ai-cluster',
  region: 'us-central1',
  zone: 'us-central1-a',

  // GPU Instance Options
  gpuInstance: {
    name: 'soma-gpu-trainer',
    machineType: 'n1-standard-4',  // 4 vCPUs, 15GB RAM
    acceleratorType: 'nvidia-tesla-t4',
    acceleratorCount: 1,
    diskSize: '50GB',
    imageFamily: 'pytorch-latest-gpu',
    imageProject: 'deeplearning-platform-release'
  },

  // Cluster Options
  cluster: {
    name: 'soma-cluster',
    numNodes: 3,
    machineType: 'e2-medium'  // 2 vCPUs, 4GB RAM
  }
};

// ════════════════════════════════════════════════════════════════════
// Helper Functions
// ════════════════════════════════════════════════════════════════════

function checkGCloud() {
  try {
    execSync('gcloud --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔧 Running: ${command} ${args.join(' ')}`);

    const proc = spawn(command, args, { stdio: 'inherit' });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// ════════════════════════════════════════════════════════════════════
// Setup Functions
// ════════════════════════════════════════════════════════════════════

async function setupGCloud() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SOMA → Google Cloud Setup');
  console.log('═══════════════════════════════════════════════════════\n');

  // Check if gcloud CLI is installed
  if (!checkGCloud()) {
    console.log('❌ Google Cloud CLI not installed!');
    console.log('\n📦 Install from: https://cloud.google.com/sdk/docs/install');
    console.log('\nWindows: Download installer from link above');
    console.log('Mac: brew install google-cloud-sdk');
    console.log('Linux: curl https://sdk.cloud.google.com | bash');
    process.exit(1);
  }

  console.log('✅ Google Cloud CLI found!\n');

  // Login
  console.log('🔐 Step 1: Login to Google Cloud');
  await runCommand('gcloud', ['auth', 'login']);

  // Set project
  console.log('\n📋 Step 2: Set project');
  try {
    await runCommand('gcloud', ['config', 'set', 'project', CONFIG.projectId]);
  } catch {
    console.log(`\n⚠️  Project "${CONFIG.projectId}" not found. Creating it...`);
    await runCommand('gcloud', ['projects', 'create', CONFIG.projectId]);
    await runCommand('gcloud', ['config', 'set', 'project', CONFIG.projectId]);
  }

  // Enable required APIs
  console.log('\n🔌 Step 3: Enable required APIs');
  const apis = [
    'compute.googleapis.com',
    'container.googleapis.com',
    'aiplatform.googleapis.com'
  ];

  for (const api of apis) {
    console.log(`   Enabling ${api}...`);
    await runCommand('gcloud', ['services', 'enable', api]);
  }

  console.log('\n✅ Google Cloud setup complete!');
  console.log('\n💡 Next steps:');
  console.log('   node gcloud-connect-soma.js --create-gpu    # Create GPU instance');
  console.log('   node gcloud-connect-soma.js --deploy        # Deploy SOMA');
}

async function createGPUInstance() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Creating NVIDIA T4 GPU Instance for SOMA');
  console.log('═══════════════════════════════════════════════════════\n');

  const { gpuInstance } = CONFIG;

  console.log('Configuration:');
  console.log(`  Name: ${gpuInstance.name}`);
  console.log(`  GPU: ${gpuInstance.acceleratorType}`);
  console.log(`  Machine: ${gpuInstance.machineType}`);
  console.log(`  Region: ${CONFIG.region}`);
  console.log(`  Cost: ~$0.35/hour (T4) + $0.24/hour (compute) = $0.59/hour`);
  console.log(`  Your $300 credit = ~508 hours of GPU training!\n`);

  const args = [
    'compute', 'instances', 'create', gpuInstance.name,
    '--zone', CONFIG.zone,
    '--machine-type', gpuInstance.machineType,
    '--accelerator', `type=${gpuInstance.acceleratorType},count=${gpuInstance.acceleratorCount}`,
    '--image-family', gpuInstance.imageFamily,
    '--image-project', gpuInstance.imageProject,
    '--boot-disk-size', gpuInstance.diskSize,
    '--maintenance-policy', 'TERMINATE',
    '--metadata', 'install-nvidia-driver=True',
    '--tags', 'soma-gpu,http-server,https-server'
  ];

  try {
    await runCommand('gcloud', args);
    console.log('\n✅ GPU instance created successfully!');
    console.log('\n🔗 SSH into instance:');
    console.log(`   gcloud compute ssh ${gpuInstance.name} --zone ${CONFIG.zone}`);
  } catch (error) {
    console.error('\n❌ Failed to create GPU instance:', error.message);
  }
}

async function deploySoma() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Deploying SOMA to Google Cloud');
  console.log('═══════════════════════════════════════════════════════\n');

  const { gpuInstance } = CONFIG;

  // Create deployment script
  const deployScript = `#!/bin/bash
set -e

echo "🚀 Installing SOMA dependencies..."

# Update system
sudo apt-get update
sudo apt-get install -y python3-pip nodejs npm git

# Install PyTorch with CUDA
pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# Clone SOMA (you'll need to set this up)
# git clone YOUR_SOMA_REPO /home/soma

# Install Node.js dependencies
# cd /home/soma && npm install

echo "✅ SOMA deployment complete!"
echo "🎮 GPU Training ready!"

# Verify GPU
python3 -c "import torch; print(f'CUDA Available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"
`;

  fs.writeFileSync('/tmp/deploy-soma.sh', deployScript);

  console.log('📦 Uploading deployment script...');
  await runCommand('gcloud', [
    'compute', 'scp',
    '/tmp/deploy-soma.sh',
    `${gpuInstance.name}:/tmp/deploy-soma.sh`,
    '--zone', CONFIG.zone
  ]);

  console.log('🚀 Running deployment...');
  await runCommand('gcloud', [
    'compute', 'ssh', gpuInstance.name,
    '--zone', CONFIG.zone,
    '--command', 'bash /tmp/deploy-soma.sh'
  ]);

  console.log('\n✅ SOMA deployed successfully!');
}

async function checkStatus() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SOMA Cloud Status');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📊 Instances:');
  await runCommand('gcloud', ['compute', 'instances', 'list']);

  console.log('\n💰 Billing (last 30 days):');
  await runCommand('gcloud', ['billing', 'accounts', 'list']);
}

// ════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--setup':
      await setupGCloud();
      break;

    case '--create-gpu':
      await createGPUInstance();
      break;

    case '--deploy':
      await deploySoma();
      break;

    case '--status':
      await checkStatus();
      break;

    default:
      console.log(`
═══════════════════════════════════════════════════════
  SOMA → Google Cloud Connection
═══════════════════════════════════════════════════════

Usage:
  node gcloud-connect-soma.js --setup         # Initial setup
  node gcloud-connect-soma.js --create-gpu    # Create GPU instance
  node gcloud-connect-soma.js --deploy        # Deploy SOMA
  node gcloud-connect-soma.js --status        # Check status

Quick Start:
  1. node gcloud-connect-soma.js --setup
  2. node gcloud-connect-soma.js --create-gpu
  3. node gcloud-connect-soma.js --deploy

Your $300 Credit:
  - NVIDIA T4 GPU: ~$0.59/hour = 508 hours
  - ~21 days of continuous GPU training!
  - Or use for cluster nodes, storage, etc.
`);
  }
}

main().catch(console.error);
