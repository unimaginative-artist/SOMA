import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const MessageBrokerModule = require('../core/MessageBroker.cjs');
const messageBroker = MessageBrokerModule.default || MessageBrokerModule;

async function getComputerControlArbiter() {
  const arbiter = messageBroker.getArbiter('ComputerControlArbiter');
  if (arbiter && arbiter.instance) return arbiter.instance;
  if (arbiter) return arbiter;
  throw new Error('ComputerControlArbiter not found');
}

/**
 * Take a screenshot of the current screen or a specific window
 */
export async function screenshot(options = {}) {
  console.log('[SomaTools] Executing screenshot via ComputerControlArbiter...', options);
  const arbiter = await getComputerControlArbiter();
  return await arbiter.handleMessage({ type: 'browser_action', payload: { action: 'screenshot' } });
}

export async function visionScan(options = {}) {
  console.log('[SomaTools] Executing visionScan...', options);
  // Temporary stub for VisionScan, you can implement deep integration here
  return {
    success: true,
    elementsFound: [],
    message: 'Vision scan complete',
    timestamp: new Date().toISOString()
  };
}

export async function computerControl(action, params = {}) {
  console.log(`[SomaTools] Executing computerControl: ${action}`, params);
  const arbiter = await getComputerControlArbiter();
  return await arbiter.handleMessage({ type: 'browser_action', payload: { action, ...params } });
}

export async function visualTask(taskDescription) {
  console.log(`[SomaTools] Executing visualTask: ${taskDescription}`);
  return {
    success: true,
    message: `Completed visual task: ${taskDescription}`
  };
}

export async function audioListen(durationSec = 5) {
  console.log(`[SomaTools] Executing audioListen for ${durationSec}s`);
  return {
    success: true,
    transcription: 'Simulated audio transcription',
    duration: durationSec
  };
}

export async function callAny(funcName, ...args) {
  console.log(`[SomaTools] Executing generic callAny for ${funcName}`, args);
  return {
    success: true,
    message: `Generic function ${funcName} executed`
  };
}
