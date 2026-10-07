#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { defaultLearningSpine } = require('../core/LearningSpine.cjs');

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, 'data', 'learning', 'experience-backfill-state.json');

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function clean(value, max = 1200) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function loadJsonl(filePath, maxRows = 2000) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxRows)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function recordOnce(state, sourceKey, interaction) {
  if (!interaction?.id) return false;
  const key = `${sourceKey}:${interaction.id}`;
  if (state.processed[key]) return false;
  defaultLearningSpine.recordInteractionOutcome(interaction);
  state.processed[key] = new Date().toISOString();
  return true;
}

function backfillOutcomes(state) {
  const filePath = path.join(ROOT, 'data', 'outcomes', 'outcomes_current.json');
  const data = readJson(filePath, {});
  const outcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
  let count = 0;

  for (const outcome of outcomes) {
    const interaction = {
      id: outcome.id,
      timestamp: outcome.timestamp || Date.parse(outcome.recorded) || Date.now(),
      type: outcome.action || 'outcome',
      agent: outcome.agent || 'unknown',
      input: outcome.context?.query || outcome.context?.message || clean(outcome.context, 700),
      output: clean(outcome.result, 1200),
      context: outcome.context || {},
      metadata: {
        ...(outcome.metadata || {}),
        success: outcome.success,
        reward: outcome.reward,
        source: 'data/outcomes/outcomes_current.json'
      }
    };
    if (recordOnce(state, 'outcome', interaction)) count += 1;
  }

  return count;
}

function backfillExperiences(state) {
  const filePath = path.join(ROOT, '.soma', 'experiences', 'experiences_current.json');
  const data = readJson(filePath, {});
  const experiences = Array.isArray(data.experiences) ? data.experiences : Array.isArray(data) ? data : [];
  let count = 0;

  for (const item of experiences) {
    const id = item.id || item.experienceId || `experience-${item.timestamp || ''}-${clean(item.action, 40)}`;
    const interaction = {
      id,
      timestamp: item.timestamp || item.state?.timestamp || Date.now(),
      type: item.action || 'experience',
      agent: item.agent || item.metadata?.agent || 'ExperienceReplay',
      input: item.metadata?.input || clean(item.state, 700),
      output: item.outcome || item.result || clean(item.nextState, 700),
      context: item.state?.context || {},
      metadata: {
        ...(item.metadata || {}),
        success: item.reward >= 0,
        reward: item.reward,
        source: '.soma/experiences/experiences_current.json'
      }
    };
    if (recordOnce(state, 'experience', interaction)) count += 1;
  }

  return count;
}

function backfillJsonlLearningEvents(state) {
  const files = [
    path.join(ROOT, 'data', 'medical-lab', 'training-distillation-events.jsonl'),
    path.join(ROOT, 'data', 'medical-lab', 'learning-events.jsonl')
  ];
  let count = 0;

  for (const filePath of files) {
    const rows = loadJsonl(filePath, 3000);
    for (const row of rows) {
      const id = row.id || `${path.basename(filePath)}-${row.at || row.recordedAt || row.createdAt || count}`;
      const interaction = {
        id,
        timestamp: Date.parse(row.at || row.recordedAt || row.createdAt || '') || Date.now(),
        type: row.type || row.outcome || 'learning_event',
        agent: row.agent || 'MedicalLearning',
        input: clean(row.metadata?.title || row.target || row.strand || row.key || row, 700),
        output: clean(row.metadata?.routeReason || row.lesson || row.reason || row.summary || row, 1200),
        context: { file: path.relative(ROOT, filePath) },
        metadata: {
          category: 'medical',
          success: !/\bfailed|veto|negative\b/i.test(clean(row, 1000)),
          source: path.relative(ROOT, filePath),
          evidencePath: row.evidencePath || row.artifactPath || null
        }
      };
      if (recordOnce(state, `jsonl:${path.basename(filePath)}`, interaction)) count += 1;
    }
  }

  return count;
}

function backfillSocial(state) {
  const files = [
    path.join(ROOT, 'SOMA', 'social-discord.json'),
    path.join(ROOT, 'SOMA', 'social-discord-reflections.json'),
    path.join(ROOT, 'SOMA', 'social-engagement.json')
  ];
  let count = 0;

  for (const filePath of files) {
    const data = readJson(filePath, null);
    const rows = Array.isArray(data) ? data
      : Array.isArray(data?.events) ? data.events
      : Array.isArray(data?.reflections) ? data.reflections
      : Array.isArray(data?.posts) ? data.posts
      : [];
    for (const row of rows.slice(-1000)) {
      const id = row.id || row.uri || row.cid || `${path.basename(filePath)}-${row.timestamp || row.createdAt || count}`;
      const interaction = {
        id,
        timestamp: Date.parse(row.timestamp || row.createdAt || row.at || '') || Date.now(),
        type: row.type || row.action || 'social_event',
        agent: row.agent || 'SocialCortex',
        input: clean(row.input || row.prompt || row.replyTo || row.text || row, 700),
        output: clean(row.output || row.response || row.post || row.reply || row.reflection || row, 1200),
        context: { file: path.relative(ROOT, filePath), platform: row.platform || 'social' },
        metadata: {
          category: 'social',
          success: row.success !== false,
          source: path.relative(ROOT, filePath)
        }
      };
      if (recordOnce(state, `social:${path.basename(filePath)}`, interaction)) count += 1;
    }
  }

  return count;
}

function main() {
  const state = readJson(STATE_PATH, { version: 1, processed: {}, runs: [] });
  state.processed = state.processed || {};

  const result = {
    startedAt: new Date().toISOString(),
    outcomes: backfillOutcomes(state),
    experiences: backfillExperiences(state),
    medicalEvents: backfillJsonlLearningEvents(state),
    social: backfillSocial(state)
  };
  result.total = result.outcomes + result.experiences + result.medicalEvents + result.social;
  result.finishedAt = new Date().toISOString();

  state.runs = [...(state.runs || []), result].slice(-20);
  state.updatedAt = result.finishedAt;
  writeJson(STATE_PATH, state);

  console.log(JSON.stringify(result, null, 2));
}

main();
