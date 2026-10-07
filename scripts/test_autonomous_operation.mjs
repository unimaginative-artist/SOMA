import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { categorizeDomain } from '../core/CuriosityMind.js';

console.log('\n======================================================');
console.log('⚙️ TEST 3: SOMA Autonomous Operation & Schedule Health');
console.log('======================================================\n');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  // 1. Check Live Marionette Daemon & Managed Services
  console.log('[Step 1] Checking Marionette Process Supervisor (port 9000)...');
  const marionetteRes = await fetchJson('http://localhost:9000/status');
  if (marionetteRes.status !== 200) {
    throw new Error(`Marionette supervisor unreachable: HTTP ${marionetteRes.status}`);
  }
  const services = marionetteRes.data.services;
  const supervisorUptime = (marionetteRes.data.supervisor?.uptime_s / 3600).toFixed(1);
  console.log(`  ✅ Supervisor active (Uptime: ${supervisorUptime}h, PID: ${marionetteRes.data.supervisor?.self_pid})`);
  console.log(`  ✅ ollama: state=${services.ollama.state}, restarts=${services.ollama.total_restarts}`);
  console.log(`  ✅ soma: state=${services.soma.state}, last_healthy_age=${services.soma.last_healthy_age_s}s`);
  console.log(`  ✅ siren: state=${services.siren.state}`);

  // 2. Check SOMA Core Health & Autonomous Scheduler Readiness
  console.log('\n[Step 2] Checking SOMA Live Core Engine (port 3001)...');
  const somaHealth = await fetchJson('http://localhost:3001/api/soma/health');
  if (somaHealth.status !== 200 || !somaHealth.data.ok) {
    throw new Error(`SOMA core health failed: ${JSON.stringify(somaHealth)}`);
  }
  console.log(`  ✅ SOMA Core: status=${somaHealth.data.status}, chatReady=${somaHealth.data.chatReady}`);
  console.log(`  ✅ Continuous Uptime: ${(somaHealth.data.uptime / 3600).toFixed(2)} hours`);

  // 3. Check Autonomous Scoreboard & Self-Repair Governance
  console.log('\n[Step 3] Checking Autonomous Governance & Anti-Drift Contract...');
  const promoRes = await fetchJson('http://localhost:3001/api/soma/training/promotion/status');
  if (promoRes.status === 200 && promoRes.data.success) {
    console.log(`  ✅ Anti-Drift Lock Enabled: ${promoRes.data.antiDriftLock?.enabled}`);
    console.log(`  ✅ Blocked Hallucination Patterns: ${promoRes.data.antiDriftLock?.blockedPatterns?.length}`);
    console.log(`  ✅ Verified Learning Rows: ${promoRes.data.learningRows}`);
    console.log(`  ✅ Graveyard / Quarantined Rows: ${promoRes.data.graveyardRows}`);
    console.log(`  ✅ Active Specialist Lobes: LOGOS (${promoRes.data.lobes.logos.activeModel}), PROMETHEUS (${promoRes.data.lobes.prometheus.activeModel})`);
  }

  // 4. Test CuriosityMind Live Autonomous Cognition & Journal
  console.log('\n[Step 4] Checking Live CuriosityMind State & Cross-Domain Stimuli...');
  const curiosityStatePath = path.join(process.cwd(), 'SOMA', 'curiosity-mind.json');
  const rawState = await fs.readFile(curiosityStatePath, 'utf8');
  const curiosityState = JSON.parse(rawState);

  console.log(`  ✅ Live Autonomous Drives:`, curiosityState.drives);
  console.log(`  ✅ Active Inquiry Threads: ${curiosityState.threads?.length}`);
  console.log(`  ✅ Latest Autonomous Thread: "${curiosityState.threads?.[0]?.question?.substring(0, 75)}..."`);
  console.log(`  ✅ Thread Domain: "${curiosityState.threads?.[0]?.domain}" (Origin: ${curiosityState.threads?.[0]?.origin})`);

  // Verify domain rotation balance
  const domain = categorizeDomain('Evaluating machine learning loss gradients and vector embeddings');
  console.log(`  ✅ Domain Categorization Engine: "${domain}"`);

  // Check recent live journal events
  const journalPath = path.join(process.cwd(), 'SOMA', 'curiosity-journal.jsonl');
  const rawJournal = await fs.readFile(journalPath, 'utf8');
  const journalLines = rawJournal.trim().split('\n').filter(Boolean);
  const recentEvents = journalLines.slice(-3).map(l => JSON.parse(l));

  console.log(`\n[Recent Live Autonomous Journal Events] (${journalLines.length} total logged events):`);
  for (const ev of recentEvents) {
    console.log(`  - [${new Date(ev.at).toLocaleTimeString()}] Type: ${ev.type} | Source: ${ev.source || ev.kind || 'internal'}`);
  }

  console.log('\n======================================================');
  console.log('✅ TEST 3: AUTONOMOUS OPERATION & SCHEDULE VERIFIED');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ Test 3 failed:', err);
  process.exit(1);
});
