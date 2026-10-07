'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'SOMA', 'presence-awareness.json');
const DAILY_DIR = path.join(process.cwd(), 'SOMA', 'presence-daily');
const EVENT_LOG = path.join(process.cwd(), 'SOMA', 'presence-events.jsonl');

const ABSENCE_RESET_MS = 10 * 60 * 1000;
const PROBE_COOLDOWN_MS = Number(process.env.SOMA_PRESENCE_PROBE_COOLDOWN_MS || 45 * 60 * 1000);
const KNOWN_PERSON_PROBE_COOLDOWN_MS = Number(process.env.SOMA_KNOWN_PERSON_PROBE_COOLDOWN_MS || 20 * 60 * 1000);
const ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
const VISION_CONFIRM_WINDOW_MS = 25 * 1000;
const EVENT_NOVELTY_WINDOW_MS = 5 * 60 * 1000;

const PERSON_LABELS = new Set(['person', 'human', 'face', 'portrait']);
const PET_LABELS = new Set(['dog', 'puppy', 'cat', 'kitten', 'pet']);

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function now() {
  return Date.now();
}

function baseState(state = {}) {
  return {
    version: 1,
    mode: 'unknown',
    lastUserActivityAt: null,
    lastPersonSeenAt: null,
    lastPetSeenAt: null,
    lastProbeAt: null,
    lastKnownProbeAt: null,
    lastUnknownProbeAt: null,
    consecutivePersonFrames: 0,
    pendingReturnSince: null,
    lastIdentity: null,
    lastIdentityDisplay: null,
    lastProbeReason: null,
    learnedUsers: {},
    lastEventKeys: {},
    visionTruth: {
      cameraConnected: false,
      frameVisible: false,
      sceneAnalyzed: false,
      personDetected: false,
      petDetected: false,
      identityKnown: false,
      confidence: 0,
      source: 'none',
      summary: null,
      labels: [],
      updatedAt: null
    },
    ...state
  };
}

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return baseState(parsed);
    }
  } catch {}
  return baseState();
}

function writeState(state) {
  ensureDir(STATE_FILE);
  fs.writeFileSync(STATE_FILE, JSON.stringify(baseState(state), null, 2));
}

function dateKey(timestamp = now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function appendPresenceEvent(state, event = {}) {
  const timestamp = Number(event.timestamp || now());
  const key = event.key || `${event.type || 'event'}:${event.identity || event.label || 'general'}`;
  state.lastEventKeys = state.lastEventKeys || {};
  if (state.lastEventKeys[key] && timestamp - state.lastEventKeys[key] < EVENT_NOVELTY_WINDOW_MS) return null;
  state.lastEventKeys[key] = timestamp;

  const record = {
    timestamp,
    type: event.type || 'presence_event',
    key,
    title: event.title || 'Presence event',
    summary: event.summary || '',
    confidence: Number(event.confidence || 0),
    identity: event.identity || state.lastIdentity || null,
    evidence: event.evidence || null
  };

  try {
    ensureDir(EVENT_LOG);
    fs.appendFileSync(EVENT_LOG, `${JSON.stringify(record)}\n`, 'utf8');

    fs.mkdirSync(DAILY_DIR, { recursive: true });
    const dailyPath = path.join(DAILY_DIR, `${dateKey(timestamp)}.md`);
    if (!fs.existsSync(dailyPath)) {
      fs.writeFileSync(dailyPath, [
        '---',
        `title: "Presence Daily ${dateKey(timestamp)}"`,
        'type: presence-daily-journal',
        'source: PresenceAwarenessState',
        'tags: [presence, visual-memory, daily]',
        '---',
        '',
        `# Presence Daily ${dateKey(timestamp)}`,
        ''
      ].join('\n'), 'utf8');
    }
    const time = new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    fs.appendFileSync(dailyPath, `\n- ${time} - ${record.summary || record.title}\n`, 'utf8');
  } catch {}

  return record;
}

function labelsFromVision(payload = {}) {
  const objects = payload.objects || payload.analysis?.objects || payload.scene?.objects || [];
  return objects
    .map(obj => ({
      label: String(obj.label || '').toLowerCase(),
      score: Number(obj.score ?? obj.confidence ?? 0)
    }))
    .filter(obj => obj.label);
}

function classifyVision(payload = {}) {
  const labels = labelsFromVision(payload);
  const semanticAnalysis = Boolean(
    payload.semanticAnalysis ||
    payload.scene?.semanticAnalysis ||
    payload.source === 'deep-describe' ||
    payload.scene?.source === 'deep-describe' ||
    payload.engine ||
    payload.scene?.engine
  );
  const placeholderOnly = labels.length === 0 || (labels.length === 1 && labels[0].label === 'webcam frame');
  const person = labels.find(item => PERSON_LABELS.has(item.label) && item.score >= 0.55);
  const pet = labels.find(item => PET_LABELS.has(item.label) && item.score >= 0.45);
  return {
    cameraConnected: payload.channel === 'webcam' || payload.scene?.channel === 'webcam' || Boolean(payload.imagePath || payload.scene?.imagePath),
    frameVisible: Boolean(payload.imagePath || payload.scene?.imagePath || labels.length),
    sceneAnalyzed: semanticAnalysis && !placeholderOnly,
    personDetected: semanticAnalysis && !!person,
    personConfidence: person?.score || 0,
    petDetected: semanticAnalysis && !!pet,
    petLabel: pet?.label || null,
    summary: payload.summary || payload.scene?.summary || null,
    source: payload.source || payload.scene?.source || null,
    engine: payload.engine || payload.scene?.engine || null,
    labels: labels.map(item => item.label).slice(0, 8)
  };
}

function rememberIdentity(state, payload = {}, timestamp = now()) {
  const name = payload.name || payload.identity || payload.recognizedAs;
  if (!name) return;
  state.lastIdentityDisplay = String(name).trim();
  state.lastIdentity = state.lastIdentityDisplay.toLowerCase();
  state.lastIdentityConfidence = Number(payload.confidence || 0);
  state.lastIdentityAt = timestamp;
  state.learnedUsers = state.learnedUsers || {};
  state.learnedUsers[state.lastIdentity] = {
    displayName: state.lastIdentityDisplay,
    firstSeenAt: state.learnedUsers[state.lastIdentity]?.firstSeenAt || timestamp,
    lastSeenAt: timestamp,
    confidence: state.lastIdentityConfidence,
    source: payload.source || 'unknown'
  };
}

function buildProbe({ state, timestamp, reason, confidence }) {
  const identity = state.lastIdentity || 'unknown_person';
  const displayName = state.lastIdentityDisplay || null;
  const knownPerson = identity !== 'unknown_person';
  return {
    type: 'presence_probe',
    timestamp,
    reason,
    identity,
    displayName,
    confidence,
    listenWindowMs: 25_000,
    message: knownPerson
      ? `Hello${displayName ? `, ${displayName}` : ''}. I noticed you came back. What do you have going on?`
      : 'Hello? I thought someone was there. Who am I talking with?'
  };
}

function maybeProbe({ state, timestamp, reason, confidence }) {
  const knownPerson = state.lastIdentity && state.lastIdentity !== 'unknown_person';
  const cooldownMs = knownPerson ? KNOWN_PERSON_PROBE_COOLDOWN_MS : PROBE_COOLDOWN_MS;
  const scopedKey = knownPerson ? 'lastKnownProbeAt' : 'lastUnknownProbeAt';
  const cooldownOpen = !state.lastProbeAt || timestamp - state.lastProbeAt > cooldownMs;
  const scopedCooldownOpen = !state[scopedKey] || timestamp - state[scopedKey] > cooldownMs;
  if (!cooldownOpen || !scopedCooldownOpen) return null;

  const recentActivity = state.lastUserActivityAt && timestamp - state.lastUserActivityAt < ACTIVITY_WINDOW_MS;
  const confirmedVision = state.consecutivePersonFrames >= 2;
  if (!recentActivity && !confirmedVision) return null;

  state.lastProbeAt = timestamp;
  state[scopedKey] = timestamp;
  state.lastProbeReason = reason;
  appendPresenceEvent(state, {
    timestamp,
    type: 'presence_probe',
    key: `probe:${knownPerson ? state.lastIdentity : 'unknown'}`,
    title: 'Presence probe',
    summary: knownPerson
      ? `SOMA greeted ${state.lastIdentityDisplay || state.lastIdentity} after a return signal.`
      : 'SOMA noticed a possible person nearby and asked who was there.',
    confidence,
    identity: state.lastIdentity
  });
  return buildProbe({ state, timestamp, reason, confidence });
}

function recordUserActivity(payload = {}) {
  const state = readState();
  const timestamp = Number(payload.timestamp || now());
  const wasAway = !state.lastUserActivityAt || timestamp - state.lastUserActivityAt > ABSENCE_RESET_MS;
  state.lastUserActivityAt = timestamp;

  let probe = null;
  if (wasAway && state.lastPersonSeenAt && timestamp - state.lastPersonSeenAt < ACTIVITY_WINDOW_MS) {
    state.mode = 'present';
    probe = maybeProbe({
      state,
      timestamp,
      reason: 'activity_after_absence_with_recent_person',
      confidence: state.lastPersonConfidence || 0.6
    });
  }

  writeState(state);
  return { state, probe };
}

function recordIdentity(payload = {}) {
  const state = readState();
  const timestamp = Number(payload.timestamp || now());
  rememberIdentity(state, payload, timestamp);
  if (state.lastIdentity) {
    state.visionTruth = {
      ...(state.visionTruth || {}),
      identityKnown: true,
      updatedAt: timestamp
    };
    appendPresenceEvent(state, {
      timestamp,
      type: 'identity_learned',
      key: `identity:${state.lastIdentity}`,
      title: 'Identity learned',
      summary: `SOMA learned or refreshed the presence identity ${state.lastIdentityDisplay}.`,
      confidence: state.lastIdentityConfidence,
      identity: state.lastIdentity,
      evidence: payload.source || 'presence_identity'
    });
  }
  writeState(state);
  return { state, probe: null };
}

function updateVisionTruth(state, vision, timestamp) {
  state.visionTruth = {
    cameraConnected: vision.cameraConnected,
    frameVisible: vision.frameVisible,
    sceneAnalyzed: vision.sceneAnalyzed,
    personDetected: vision.personDetected,
    petDetected: vision.petDetected,
    identityKnown: Boolean(state.lastIdentity && state.lastIdentity !== 'unknown_person'),
    confidence: Math.max(vision.personConfidence || 0, vision.petDetected ? 0.45 : 0),
    source: vision.source || (vision.sceneAnalyzed ? 'vision-analysis' : 'raw-frame'),
    summary: vision.summary || (vision.sceneAnalyzed ? 'Scene analyzed.' : 'Camera frame captured but not semantically analyzed.'),
    labels: vision.labels,
    updatedAt: timestamp
  };
}

function recordVision(payload = {}) {
  const state = readState();
  const timestamp = Number(payload.timestamp || now());
  const vision = classifyVision(payload);
  const stalePerson = !state.lastPersonSeenAt || timestamp - state.lastPersonSeenAt > ABSENCE_RESET_MS;
  updateVisionTruth(state, vision, timestamp);

  if (vision.cameraConnected && !vision.sceneAnalyzed) {
    appendPresenceEvent(state, {
      timestamp,
      type: 'camera_raw',
      key: 'camera:raw',
      title: 'Camera connected without analysis',
      summary: 'The webcam feed was connected, but SOMA did not yet have semantic evidence about the room.',
      confidence: 0.2,
      evidence: vision.source || 'raw-frame'
    });
  }

  if (vision.petDetected) {
    state.lastPetSeenAt = timestamp;
    state.lastPetLabel = vision.petLabel;
    appendPresenceEvent(state, {
      timestamp,
      type: 'pet_seen',
      key: `pet:${vision.petLabel || 'pet'}`,
      title: 'Pet seen',
      summary: `SOMA noticed ${vision.petLabel || 'a pet'} nearby.`,
      confidence: 0.45,
      evidence: vision.labels.join(', ')
    });
  }

  let probe = null;
  if (vision.personDetected) {
    const priorSeenAt = state.lastPersonSeenAt || 0;
    const samePresenceRun = priorSeenAt && timestamp - priorSeenAt < VISION_CONFIRM_WINDOW_MS;
    state.consecutivePersonFrames = samePresenceRun ? (state.consecutivePersonFrames || 0) + 1 : 1;
    state.lastPersonSeenAt = timestamp;
    state.lastPersonConfidence = vision.personConfidence;
    const payloadIdentity = payload.identity?.name || payload.recognizedAs;
    if (payloadIdentity) {
      rememberIdentity(state, {
        name: payloadIdentity,
        confidence: payload.identity?.confidence || payload.confidence || vision.personConfidence,
        source: 'vision'
      }, timestamp);
      state.visionTruth.identityKnown = true;
    } else {
      state.lastIdentity = state.lastIdentity || 'unknown_person';
    }
    state.mode = 'present';

    appendPresenceEvent(state, {
      timestamp,
      type: 'person_seen',
      key: `person:${state.lastIdentity || 'unknown'}`,
      title: 'Person seen',
      summary: state.lastIdentity && state.lastIdentity !== 'unknown_person'
        ? `SOMA noticed ${state.lastIdentityDisplay || state.lastIdentity} nearby.`
        : 'SOMA noticed a person nearby, but did not know who it was.',
      confidence: vision.personConfidence,
      identity: state.lastIdentity,
      evidence: vision.labels.join(', ')
    });

    if (stalePerson) {
      state.pendingReturnSince = timestamp;
    }

    const pendingReturnActive = state.pendingReturnSince &&
      timestamp - state.pendingReturnSince < VISION_CONFIRM_WINDOW_MS;
    if (pendingReturnActive) {
      probe = maybeProbe({
        state,
        timestamp,
        reason: 'person_seen_after_absence',
        confidence: vision.personConfidence
      });
      if (probe) state.pendingReturnSince = null;
    } else if (state.pendingReturnSince) {
      state.pendingReturnSince = null;
    }
  } else if (state.lastPersonSeenAt && timestamp - state.lastPersonSeenAt > ABSENCE_RESET_MS) {
    state.mode = state.lastPetSeenAt && timestamp - state.lastPetSeenAt < ABSENCE_RESET_MS ? 'pet_nearby' : 'absent';
    state.consecutivePersonFrames = 0;
    state.pendingReturnSince = null;
  }

  state.lastVisionLabels = vision.labels;
  writeState(state);
  return { state, probe };
}

function evidenceSnapshot() {
  const state = readState();
  return {
    mode: state.mode,
    learnedUsers: state.learnedUsers || {},
    lastIdentity: state.lastIdentity || null,
    lastIdentityDisplay: state.lastIdentityDisplay || null,
    visionTruth: state.visionTruth || {},
    lastPersonSeenAt: state.lastPersonSeenAt || null,
    lastPetSeenAt: state.lastPetSeenAt || null,
    lastProbeAt: state.lastProbeAt || null
  };
}

function formatForPrompt() {
  const snap = evidenceSnapshot();
  const truth = snap.visionTruth || {};
  const lines = [
    '[PRESENCE EVIDENCE]',
    `Mode: ${snap.mode || 'unknown'}.`,
    `Camera connected: ${truth.cameraConnected ? 'yes' : 'no'}. Frame visible: ${truth.frameVisible ? 'yes' : 'no'}. Scene analyzed: ${truth.sceneAnalyzed ? 'yes' : 'no'}.`,
    `Person detected: ${truth.personDetected ? 'yes' : 'no'}. Pet detected: ${truth.petDetected ? 'yes' : 'no'}. Identity known: ${truth.identityKnown ? 'yes' : 'no'}.`
  ];
  if (snap.lastIdentityDisplay) lines.push(`Last known nearby identity: ${snap.lastIdentityDisplay}.`);
  if (truth.summary) lines.push(`Current visual evidence: ${truth.summary}`);
  lines.push('Rules: never describe the room, lighting, people, pets, or layout unless scene analyzed is yes or a specific object/person label is present. If identity is unknown, ask naturally instead of guessing.');
  lines.push('[/PRESENCE EVIDENCE]');
  return lines.join('\n');
}

module.exports = {
  STATE_FILE,
  DAILY_DIR,
  EVENT_LOG,
  readState,
  writeState,
  recordUserActivity,
  recordIdentity,
  recordVision,
  classifyVision,
  evidenceSnapshot,
  formatForPrompt
};
