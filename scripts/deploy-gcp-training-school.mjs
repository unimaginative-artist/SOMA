#!/usr/bin/env node

/**
 * Deploy "SOMA Training School" to GCP
 *
 * Creates a GPU-powered instance that runs intensive 8-hour learning sessions
 * - NVIDIA T4 GPU for actual training
 * - Runs 10 PM - 6 AM (8 hours)
 * - Auto-starts/stops to save money
 * - Full learning curriculum from nighttime-learning.json
 *
 * Cost: ~$0.59/hour * 8 hours = $4.72/night = ~$140/month
 * OR use spot instance: ~$0.18/hour * 8 hours = $1.44/night = ~$43/month
 *
 * Usage:
 *   node scripts/deploy-gcp-training-school.mjs --create        # Create GPU instance
 *   node scripts/deploy-gcp-training-school.mjs --deploy        # Deploy SOMA
 *   node scripts/deploy-gcp-training-school.mjs --schedule      # Setup auto on/off
 *   node scripts/deploy-gcp-training-school.mjs --start         # Manual start
 *   node scripts/deploy-gcp-training-school.mjs --stop          # Manual stop
 *   node scripts/deploy-gcp-training-school.mjs --status        # Check status
 *   node scripts/deploy-gcp-training-school.mjs --logs          # View learning logs
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  projectId: 'able-copilot-479415-r8',
  region: 'us-central1',
  zone: 'us-central1-a',

  instance: {
    name: 'soma-training-school',
    // GPU Instance specs
    machineType: 'n1-standard-4',  // 4 vCPUs, 15GB RAM
    acceleratorType: 'nvidia-tesla-t4',
    acceleratorCount: 1,
    diskSize: '50GB',
    imageFamily: 'pytorch-latest-gpu',
    imageProject: 'deeplearning-platform-release',
    // Use spot/preemptible for 70% cost savings
    useSpot: true
  },

  schedule: {
    // Training hours: 10 PM - 6 AM EST
    startTime: '22:00',
    stopTime: '06:00',
    timezone: 'America/New_York'
  },

  coordinator: process.env.SOMA_COORDINATOR || '192.168.1.251:7777'
};

function run(command, options = {}) {
  console.log(`\n🔧 ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
  try {
    const output = execSync(command, {
      stdio: options.silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
      shell: true
    });
    return output;
  } catch (error) {
    if (!options.ignoreError) throw error;
    return null;
  }
}

async function createInstance() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  🎓 Creating SOMA Training School (GPU-Powered)');
  console.log('═══════════════════════════════════════════════════════\n');

  const { instance } = CONFIG;

  console.log('Configuration:');
  console.log(`  Name: ${instance.name}`);
  console.log(`  GPU: ${instance.acceleratorType}`);
  console.log(`  Machine: ${instance.machineType}`);
  console.log(`  Training: 10 PM - 6 AM (8 hours/night)`);
  console.log(`  Mode: ${instance.useSpot ? 'SPOT (70% cheaper)' : 'On-demand'}`);

  if (instance.useSpot) {
    console.log(`  Cost: ~$0.18/hour * 8 = $1.44/night = ~$43/month`);
  } else {
    console.log(`  Cost: ~$0.59/hour * 8 = $4.72/night = ~$140/month`);
  }
  console.log();

  const startupScript = `#!/bin/bash
set -e

echo "🎓 SOMA Training School - GPU Setup"

# Install additional dependencies
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# Verify GPU
nvidia-smi
python3 -c "import torch; print(f'CUDA Available: {torch.cuda.is_available()}')"

echo "✅ GPU Training School Ready"
`;

  let command = `gcloud compute instances create ${instance.name} \\
    --project=${CONFIG.projectId} \\
    --zone=${CONFIG.zone} \\
    --machine-type=${instance.machineType} \\
    --accelerator=type=${instance.acceleratorType},count=${instance.acceleratorCount} \\
    --boot-disk-size=${instance.diskSize} \\
    --image-family=${instance.imageFamily} \\
    --image-project=${instance.imageProject} \\
    --maintenance-policy=TERMINATE \\
    --metadata=install-nvidia-driver=True \\
    --metadata=startup-script='${startupScript}' \\
    --tags=soma-training,http-server \\
    --scopes=cloud-platform`;

  if (instance.useSpot) {
    command += ' \\\n    --provisioning-model=SPOT \\\n    --instance-termination-action=STOP';
  }

  try {
    run(command.replace(/\n/g, ' '));
    console.log('\n✅ Training School instance created!');
    console.log('\n📝 Next steps:');
    console.log('   1. Wait 3-5 minutes for GPU drivers to install');
    console.log('   2. Run: node scripts/deploy-gcp-training-school.mjs --deploy');
    console.log('   3. Run: node scripts/deploy-gcp-training-school.mjs --schedule');
  } catch (error) {
    console.error('\n❌ Failed to create instance');
    console.error('   Tip: Use --deploy to update existing instance');
  }
}

async function deploySOMA() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  📚 Deploying Full Learning Curriculum to GPU School');
  console.log('═══════════════════════════════════════════════════════\n');

  const { instance } = CONFIG;

  const deployScript = `#!/bin/bash
set -e

echo "📚 Deploying SOMA Learning Curriculum"

cd /opt/deeplearning
mkdir -p soma-training-school
cd soma-training-school

# Extract deployment package
tar -xzf ~/soma-deploy.tar.gz

# Install Node.js dependencies
npm install --production

# Create environment file
cat > .env << 'ENVFILE'
# AI API Keys
GEMINI_API_KEY=${process.env.GEMINI_API_KEY || ''}
DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY || ''}
OLLAMA_ENDPOINT=${process.env.OLLAMA_ENDPOINT || 'http://localhost:11434'}

# GCP Vertex AI
GCP_PROJECT_ID=able-copilot-479415-r8
VERTEX_AI_LOCATION=us-central1

# Cluster mode (worker)
SOMA_MODE=cluster
SOMA_CLUSTER=true
SOMA_COORDINATOR=${CONFIG.coordinator}

# GPU enabled
SOMA_GPU=true
SOMA_MULTIMODAL=true
SOMA_CONTINUOUS_LEARNING=true
ENVFILE

# Copy Vertex AI credentials
cp vertex-credentials.json /opt/deeplearning/soma-training-school/

# Create systemd service
sudo tee /etc/systemd/system/soma-training-school.service > /dev/null << 'SERVICEEOF'
[Unit]
Description=SOMA Training School - 8 Hour Learning Sessions
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/deeplearning/soma-training-school
Environment="CUDA_VISIBLE_DEVICES=0"
ExecStart=/opt/conda/bin/node scripts/start-nighttime-learning-service.mjs
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Enable service
sudo systemctl daemon-reload
sudo systemctl enable soma-training-school

echo "✅ SOMA Training School Deployed!"
echo "🎓 Learning curriculum:"
echo "   22:00 - Knowledge Consolidation"
echo "   23:00 - Deep Learning (60 min intensive)"
echo "   00:00 - Autonomous Data Gathering"
echo "   01:00 - Memory Optimization"
echo "   02:00 - Pattern Analysis"
echo "   03:00 - Self-Improvement & Code Modification"
echo "   04:00 - GPU Training Session"
echo "   04:30 - Deep Archive (Sundays)"
echo ""
echo "📊 Start training: sudo systemctl start soma-training-school"
echo "📋 View logs: sudo journalctl -u soma-training-school -f"
`;

  // Create deployment package
  console.log('📦 Creating deployment package...');

  const files = [
    'package.json',
    'scripts/start-nighttime-learning-service.mjs',
    'core/NighttimeLearningOrchestrator.js',
    'config/nighttime-learning.json',
    'arbiters/MnemonicArbiter.js',
    'arbiters/AdaptiveLearningPlanner.js',
    'arbiters/GPUTrainingArbiter.js',
    'arbiters/ArchivistArbiter.js',
    'SOMArbiterV2_TriBrain.js',
    'vertex-credentials.json'
  ].join(' ');

  try {
    run(`tar -czf /tmp/soma-deploy.tar.gz ${files}`, { ignoreError: true });

    console.log('📤 Uploading to GPU instance...');
    run(`gcloud compute scp /tmp/soma-deploy.tar.gz root@${instance.name}:~ --zone=${CONFIG.zone} --project=${CONFIG.projectId}`);

    fs.writeFileSync('/tmp/deploy-training-school.sh', deployScript);
    run(`gcloud compute scp /tmp/deploy-training-school.sh root@${instance.name}:~ --zone=${CONFIG.zone} --project=${CONFIG.projectId}`);

    console.log('🚀 Running deployment...');
    run(`gcloud compute ssh root@${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId} --command="bash deploy-training-school.sh"`);

    console.log('\n✅ Training School Deployed!');
    console.log('\n🎓 She will now train 8 hours/night with:');
    console.log('   - NVIDIA T4 GPU acceleration');
    console.log('   - Full learning curriculum');
    console.log('   - Autonomous self-improvement');
    console.log('   - Memory optimization');
    console.log('   - Pattern learning');
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
  }
}

async function setupSchedule() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ⏰ Setting Up Auto Start/Stop Schedule');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Creating Cloud Scheduler jobs...');
  console.log(`  Start: ${CONFIG.schedule.startTime} ${CONFIG.schedule.timezone}`);
  console.log(`  Stop:  ${CONFIG.schedule.stopTime} ${CONFIG.schedule.timezone}`);
  console.log();

  // Parse time for cron (convert 22:00 to "0 22 * * *")
  const startHour = CONFIG.schedule.startTime.split(':')[0];
  const stopHour = CONFIG.schedule.stopTime.split(':')[0];

  try {
    // Create start schedule
    console.log('📅 Creating START schedule (10 PM)...');
    run(`gcloud scheduler jobs create http soma-training-start \\
      --project=${CONFIG.projectId} \\
      --location=${CONFIG.region} \\
      --schedule="0 ${startHour} * * *" \\
      --time-zone="${CONFIG.schedule.timezone}" \\
      --uri="https://compute.googleapis.com/compute/v1/projects/${CONFIG.projectId}/zones/${CONFIG.zone}/instances/${CONFIG.instance.name}/start" \\
      --http-method=POST \\
      --oauth-service-account-email=vertex-express@${CONFIG.projectId}.iam.gserviceaccount.com \\
      --description="Start SOMA Training School at 10 PM"`, { ignoreError: true });

    // Create stop schedule
    console.log('📅 Creating STOP schedule (6 AM)...');
    run(`gcloud scheduler jobs create http soma-training-stop \\
      --project=${CONFIG.projectId} \\
      --location=${CONFIG.region} \\
      --schedule="0 ${stopHour} * * *" \\
      --time-zone="${CONFIG.schedule.timezone}" \\
      --uri="https://compute.googleapis.com/compute/v1/projects/${CONFIG.projectId}/zones/${CONFIG.zone}/instances/${CONFIG.instance.name}/stop" \\
      --http-method=POST \\
      --oauth-service-account-email=vertex-express@${CONFIG.projectId}.iam.gserviceaccount.com \\
      --description="Stop SOMA Training School at 6 AM"`, { ignoreError: true });

    console.log('\n✅ Schedule configured!');
    console.log('\n🎓 Training School will now:');
    console.log('   - Auto-start at 10 PM');
    console.log('   - Train for 8 hours');
    console.log('   - Auto-stop at 6 AM (saves money)');
    console.log('\n💰 Estimated monthly cost: $43-140 (spot vs regular)');
  } catch (error) {
    console.error('\n❌ Schedule setup failed:', error.message);
    console.error('   You may need to enable Cloud Scheduler API');
  }
}

async function startInstance() {
  const { instance } = CONFIG;
  console.log(`\n🎓 Starting Training School...`);
  run(`gcloud compute instances start ${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId}`);
  console.log('\n✅ Training session started!');
  console.log('   Wait 2-3 minutes for GPU drivers to initialize');
}

async function stopInstance() {
  const { instance } = CONFIG;
  console.log(`\n⏸️  Stopping Training School...`);
  run(`gcloud compute instances stop ${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId}`);
  console.log('\n✅ Training paused (no charges while stopped)');
}

async function checkStatus() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  📊 Training School Status');
  console.log('═══════════════════════════════════════════════════════\n');

  const { instance } = CONFIG;

  console.log('Instance Status:');
  run(`gcloud compute instances describe ${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId} --format="table(name,status,machineType,scheduling.preemptible)"`, { ignoreError: true });

  console.log('\n🎓 Training Service Status:');
  run(`gcloud compute ssh root@${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId} --command="systemctl status soma-training-school --no-pager || echo 'Not deployed yet'"`, { ignoreError: true });

  console.log('\n📅 Scheduled Jobs:');
  run(`gcloud scheduler jobs list --project=${CONFIG.projectId} --location=${CONFIG.region} | grep soma-training`, { ignoreError: true });
}

async function viewLogs() {
  const { instance } = CONFIG;
  console.log('\n📋 Streaming training logs...\n');
  console.log('Press Ctrl+C to stop\n');

  run(`gcloud compute ssh root@${instance.name} --zone=${CONFIG.zone} --project=${CONFIG.projectId} --command="journalctl -u soma-training-school -f --no-pager"`, { ignoreError: true });
}

// ════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════

const command = process.argv[2];

switch (command) {
  case '--create':
    await createInstance();
    break;

  case '--deploy':
    await deploySOMA();
    break;

  case '--schedule':
    await setupSchedule();
    break;

  case '--start':
    await startInstance();
    break;

  case '--stop':
    await stopInstance();
    break;

  case '--status':
    await checkStatus();
    break;

  case '--logs':
    await viewLogs();
    break;

  default:
    console.log(`
═══════════════════════════════════════════════════════
  🎓 SOMA Training School - GPU-Powered Learning
═══════════════════════════════════════════════════════

Deploy an NVIDIA T4 GPU instance that trains SOMA 8 hours/night

Usage:
  --create     Create GPU training instance (T4 + PyTorch)
  --deploy     Deploy SOMA with full learning curriculum
  --schedule   Setup auto start (10 PM) and stop (6 AM)
  --start      Manually start training session
  --stop       Manually stop training (saves money)
  --status     Check training status
  --logs       View live training logs

Quick Start:
  1. --create    (~5 min to setup GPU drivers)
  2. --deploy    (installs SOMA + 8-hour curriculum)
  3. --schedule  (auto on/off to save money)

💰 Cost Options:
  Spot Instance:  ~$1.44/night = $43/month  (may be interrupted)
  Regular:        ~$4.72/night = $140/month (guaranteed)

🎓 8-Hour Curriculum:
  22:00 - Knowledge Consolidation (30min)
  23:00 - Deep Learning Session (60min)
  00:00 - Autonomous Data Gathering (60min)
  01:00 - Memory Optimization (45min)
  02:00 - Pattern Analysis (45min)
  03:00 - Self-Improvement (30min)
  03:30 - Autonomous Code Modification (60min)
  04:00 - GPU Training (45min)
  04:30 - Weekly Archive (90min Sundays)

She literally improves her own code while you sleep! 🤯
`);
}
