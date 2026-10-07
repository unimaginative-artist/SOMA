import os from 'os';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

function getAutoRole() {
  const hostname = os.hostname().toLowerCase();
  if (hostname.includes('imac')) return 'coordinator';
  if (hostname.includes('bear')) return 'worker';
  if (hostname.includes('mac') && hostname.includes('pro')) return 'worker';
  return process.env.SOMA_ROLE || 'coordinator';
}

export const CONFIG = {
  mode: process.env.SOMA_MODE || 'cluster',
  role: getAutoRole(),
  port: process.env.PORT || 3010, // Default to 3010 (auto-fallback enabled in launcher)
  clusterPort: parseInt(process.env.SOMA_CLUSTER_PORT || '7777'),
  coordinatorAddress: process.env.SOMA_COORDINATOR || null,
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY || null,
    kevinEmail: process.env.KEVIN_EMAIL || null,
    kevinAppPassword: process.env.KEVIN_APP_PASSWORD || null
  },
  enableGPU: process.env.SOMA_GPU !== 'false',
  enableCluster: process.env.SOMA_CLUSTER === 'true',
  enableMultiModal: true,
  enableContinuousLearning: true,
  enableDashboard: true,
  enableFileWatch: true,
  graphifyPath: "C:\\Users\\owner\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python313\\Scripts\\graphify.exe"
};
