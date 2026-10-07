import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SelfModificationArbiter = require('../arbiters/SelfModificationArbiter.cjs');
const { SomaBridge } = await import('../../MAX/core/SomaBridge.js');

async function testRelay() {
  console.log('🧪 Starting Full Stack Relay Test...\n');

  // Initialize SelfModificationArbiter in a dummy way
  const arbiter = new SelfModificationArbiter({
    name: 'SelfModificationArbiter'
  });
  arbiter.logger = {
    info: (msg) => console.log(`[SOMA-to-MAX-Relay Info] ${msg}`),
    warn: (msg) => console.log(`[SOMA-to-MAX-Relay Warn] ${msg}`),
    error: (msg) => console.log(`[SOMA-to-MAX-Relay Error] ${msg}`)
  };
  arbiter.maxUrl = 'http://127.0.0.1:3100';

  console.log('--- 1. Testing SOMA-to-MAX Startup Spawner ---');
  let maxActive = false;
  try {
    const res = await fetch('http://127.0.0.1:3100/health', { signal: AbortSignal.timeout(1500) });
    maxActive = res.ok;
  } catch {}

  console.log(`MAX Status: ${maxActive ? 'ONLINE' : 'OFFLINE'}`);

  if (!maxActive) {
    console.log('Calling ensureMaxActive()...');
    await arbiter.ensureMaxActive();
    console.log('Waiting 8 seconds for MAX to start up...');
    await new Promise(r => setTimeout(r, 8000));
    
    let maxActiveAfter = false;
    try {
      const res = await fetch('http://127.0.0.1:3100/health', { signal: AbortSignal.timeout(1500) });
      maxActiveAfter = res.ok;
    } catch {}
    console.log(`MAX status after relay trigger: ${maxActiveAfter ? 'ONLINE (Pass)' : 'OFFLINE'}`);
  } else {
    console.log('MAX is already online.');
  }

  console.log('\n--- 2. Testing MAX-to-SOMA Startup Spawner ---');
  let somaActive = false;
  try {
    const res = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(1500) });
    somaActive = res.ok;
  } catch {}

  console.log(`SOMA Status: ${somaActive ? 'ONLINE' : 'OFFLINE'}`);

  if (!somaActive) {
    console.log('Initializing SomaBridge and triggering _probe()...');
    const bridge = new SomaBridge({ url: 'http://localhost:3001' });
    await bridge._probe();
    console.log('Waiting 8 seconds for SOMA to start up...');
    await new Promise(r => setTimeout(r, 8000));

    let somaActiveAfter = false;
    try {
      const res = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(1500) });
      somaActiveAfter = res.ok;
    } catch {}
    console.log(`SOMA status after relay trigger: ${somaActiveAfter ? 'ONLINE (Pass)' : 'OFFLINE'}`);
  } else {
    console.log('SOMA is already online.');
  }

  console.log('\nVerification run finished.');
}

testRelay().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
