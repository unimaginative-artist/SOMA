#!/usr/bin/env node
/**
 * check-selfmod-progress.mjs — did SOMA's self-modification loop actually DO something?
 *
 * Compares live goal state against a baseline snapshot taken when the self-mod fix
 * landed (2026-08-17), then DMs Owner an HONEST plain-English verdict via Discord.
 * Runs LOCALLY (so it sees her real runtime state, unlike a cloud agent). Read-only
 * except for the Discord DM. Never fabricates progress; distinguishes "landed a fix"
 * from "diagnosed a target" from "on cooldown" from "still stuck".
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p, f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return f; } };

const base = rd('data/selfmod-check-baseline.json', null);
const g = rd('data/goals.json', { goals: [] });
const goalsArr = Array.isArray(g.goals) ? g.goals : Object.values(g.goals || {});
const mstate = rd('data/autonomous-mission-state.json', {});

const isDiag = x => /^Diagnose the single highest-value small correctness gap/.test(x.title || '') || x.metadata?.selfImprovementArea;
const isImpl = x => /^Implement verified finding from/.test(x.title || '') || x.metadata?.diagnosisOfGoalId;
const isNavel = x => /autonomous completion utility|proving ground|publish a verified narrative|artifact-first goal template/i.test(x.title || '');
const hasCodeEvidence = x => (x.metadata?.lastVerification?.checks || []).some(c =>
  ['code_change', 'code_modification', 'tests', 'executable_proof', 'command'].includes(c.type) && c.passed === true);

const completedNow = goalsArr.filter(x => x.status === 'completed');
const baseCompleted = new Set(base?.completedIds || []);
const newCompleted = completedNow.filter(x => !baseCompleted.has(x.id));

const diagGoals = goalsArr.filter(isDiag);
const implGoals = goalsArr.filter(isImpl);
const implCompleted = implGoals.filter(x => x.status === 'completed');
const implLandedWithProof = implCompleted.filter(hasCodeEvidence);
const diagCompleted = diagGoals.filter(x => x.status === 'completed');
const navelActive = goalsArr.filter(x => isNavel(x) && ['proposed', 'pending', 'active', 'delegated'].includes(x.status));

// Real code changes since baseline (candidate self-mod evidence).
let codeChanges = [];
let newCommits = [];
try {
  const since = base?.at || new Date(Date.now() - 6 * 3600e3).toISOString();
  const porcelain = execSync('git status --porcelain', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  codeChanges = porcelain.filter(l => /\s(core|arbiters|server|tests|scripts)\//.test(l)).slice(0, 15);
  newCommits = execSync(`git log --since="${since}" --oneline`, { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
} catch { /* non-fatal */ }

// ── Verdict (honest tiers) ───────────────────────────────────────────────────
let headline, detail;
if (implLandedWithProof.length > 0) {
  headline = '🎉 A REAL self-fix LANDED';
  detail = `She diagnosed a target, implemented it, and it passed verification: "${implLandedWithProof[0].title}".`;
} else if (implCompleted.length > 0) {
  headline = '✅ An implementation goal completed (verifying evidence)';
  detail = `"${implCompleted[0].title}" completed — checking it carried real code+test evidence, not just an artifact.`;
} else if (implGoals.length > 0) {
  headline = '🔧 A fix is IN FLIGHT';
  detail = `She diagnosed a concrete target and spawned an implementation goal ("${implGoals[0].title}") — not landed yet.`;
} else if (diagCompleted.length > 0) {
  headline = '🔎 She completed a concrete DIAGNOSIS';
  detail = 'She finished a real "diagnose one small fix" goal — the completable kind. The implementation step is next.';
} else if (diagGoals.length > 0) {
  headline = '🌱 Concrete goals are seeding (no more navel-gaze)';
  detail = `${diagGoals.length} concrete "Diagnose…" goal(s) exist and are being worked — the loop is pointed at real targets now.`;
} else {
  const activeMission = goalsArr.find(x => x.metadata?.autonomousMission && ['active', 'delegated', 'pending'].includes(x.status));
  const lastSeed = mstate.lastPurposefulSeedAt ? new Date(mstate.lastPurposefulSeedAt) : null;
  const cooldownLeftH = lastSeed ? Math.max(0, (6 * 3600e3 - (Date.now() - lastSeed.getTime())) / 3600e3) : 0;
  if (activeMission || mstate.lastDecision?.reason === 'autonomous_execution_slot_occupied') {
    headline = '🏃 She is busy executing a mission (not stuck)';
    detail = `An autonomous mission is running${activeMission ? `: "${(activeMission.title || '').slice(0, 80)}"` : ''}. The concrete-diagnosis seed only fires when idle, so it hasn't needed to yet — check whether that running mission is concrete or navel-gaze.`;
  } else if (cooldownLeftH > 0.1) {
    headline = '⏳ No concrete goal yet — idle-seed on cooldown';
    detail = `The concrete-diagnosis seed fires when idle after a 6h cooldown (~${cooldownLeftH.toFixed(1)}h left). Not stuck — just hasn't been allowed to fire. Last decision: ${mstate.lastDecision?.reason || 'n/a'}.`;
  } else {
    headline = '⚠️ Still no concrete self-improvement goal';
    detail = `The seed should have fired but hasn't produced a concrete diagnosis. Last decision: ${mstate.lastDecision?.reason || 'n/a'}. Worth a look.`;
  }
}

const msg = [
  `**Self-mod check** (${new Date().toLocaleString()})`,
  '',
  headline,
  detail,
  '',
  `Since the fix: goals ${base?.totalGoals ?? '?'} → ${goalsArr.length} · completed ${base?.completedIds?.length ?? '?'} → ${completedNow.length} (+${newCompleted.length} new)`,
  `Concrete diagnosis goals: ${diagGoals.length} (${diagCompleted.length} completed) · implementation goals: ${implGoals.length} (${implCompleted.length} completed)`,
  navelActive.length ? `⚠️ Still ${navelActive.length} navel-gaze goal(s) active` : '✅ No new navel-gaze goals in flight',
  (newCommits.length || codeChanges.length)
    ? `Code activity since baseline: ${newCommits.length} new commit(s), ${codeChanges.length} changed file(s) in code roots (may include Gemini/Owner, not only her).`
    : 'No code changes in her code roots since baseline yet.',
].join('\n');

console.log(msg);

// ── DM Owner via Discord REST ────────────────────────────────────────────────
async function dm() {
  const creds = rd('.soma/discord_creds.json', null);
  if (!creds?.token || !creds?.masterId) { console.error('No discord creds — printed above only.'); return; }
  const h = { 'Authorization': `Bot ${creds.token}`, 'Content-Type': 'application/json' };
  try {
    const ch = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: h, body: JSON.stringify({ recipient_id: creds.masterId })
    }).then(r => r.json());
    if (!ch?.id) { console.error('DM channel open failed:', JSON.stringify(ch).slice(0, 200)); return; }
    const sent = await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`, {
      method: 'POST', headers: h, body: JSON.stringify({ content: msg.slice(0, 1900) })
    }).then(r => r.json());
    console.error(sent?.id ? 'DM sent to Owner.' : 'DM send failed: ' + JSON.stringify(sent).slice(0, 200));
  } catch (e) { console.error('DM error:', e.message); }
}
if (process.argv.includes('--dry')) console.error('\n[dry-run: DM skipped]');
else dm();
