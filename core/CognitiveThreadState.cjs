'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'SOMA', 'cognitive-thread-state.json');
const MAX_ACTIVE_THREADS = 2;
const MAX_HISTORY = 30;
const THREAD_TTL_MS = 6 * 60 * 60 * 1000;

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being',
  'better', 'between', 'circling', 'coming', 'could', 'curious', 'curiosity',
  'doing', 'explore', 'feel', 'feels', 'from', 'going', 'have', 'keep', 'keeps',
  'more', 'really', 'still', 'that', 'them', 'there', 'this', 'thread',
  'turning', 'understand', 'want', 'what', 'when', 'where', 'whether', 'with',
  'without', 'work', 'working'
]);

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function now() {
  return Date.now();
}

function isUnsupportedCrossDomainTheater(value = '') {
  const text = String(value || '').toLowerCase();
  const speculativeScience = /\b(chemistry|chemical|reaction kinetics|thermodynamics|quantum|molecular|principle of least action)\b/.test(text);
  const softwareTarget = /\b(ai|agent|software|code|coding|build|debug|git|computational|self[- ]?modification)\b/.test(text);
  const unsupportedAction = /\b(conduct|run|perform|try|start|plan)\b.{0,40}\b(experiment|lab|reaction|titration|synthesis)\b/.test(text)
    || /\b(analogy|maps? cleanly|same pattern|could significantly boost|accelerates computational)\b/.test(text);
  return speculativeScience && softwareTarget && unsupportedAction;
}

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        const activeThreads = Array.isArray(parsed.activeThreads) ? parsed.activeThreads : [];
        const history = Array.isArray(parsed.history) ? parsed.history : [];
        return {
          version: 1,
          activeThreads: activeThreads.filter(thread => !isUnsupportedCrossDomainTheater(activeText(thread))),
          history: history.filter(item => !isUnsupportedCrossDomainTheater(`${item.focus || ''} ${item.text || ''}`)),
          affect: parsed.affect && typeof parsed.affect === 'object' ? parsed.affect : {},
          lastDecision: parsed.lastDecision || null
        };
      }
    }
  } catch {}
  return { version: 1, activeThreads: [], history: [], affect: {}, lastDecision: null };
}

function writeState(state) {
  ensureDir(STATE_FILE);
  const data = {
    version: 1,
    activeThreads: (state.activeThreads || []).slice(0, MAX_ACTIVE_THREADS),
    history: (state.history || []).slice(0, MAX_HISTORY),
    affect: state.affect || {},
    lastDecision: state.lastDecision || null
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function tokens(value = '') {
  return new Set(
    String(value).toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g)
      ?.filter(token => !STOPWORDS.has(token)) || []
  );
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function topTerms(tokenSet, limit = 6) {
  return [...(tokenSet || [])].slice(0, limit);
}

function makeThreadId(tokenSet) {
  const core = topTerms(tokenSet, 4).join('-') || 'untitled';
  return `thread-${now()}-${core.slice(0, 48)}`;
}

function summarizeStimulus(stimulus = '') {
  const lines = String(stimulus).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines
    .filter(line => !/^\[/.test(line) && !/^[-•]/.test(line))
    .slice(0, 3)
    .join(' ')
    .slice(0, 220);
}

function formulaKey(value = '') {
  const lower = String(value).toLowerCase();
  const keys = [];
  if (/\bem\s*dashes?\b|\bemdashes?\b|\bmangled (?:em\s*)?dashes?\b|\mdash failure\b|\bencoding failures?\b/.test(lower)) keys.push('style_em_dash_preference');
  if (/\bbackground tasks?\b/.test(lower)) keys.push('background_tasks');
  if (/\bidle processing\b/.test(lower)) keys.push('idle_processing');
  if (/\baurora\b/.test(lower) && /\bprometheus\b/.test(lower)) keys.push('aurora_prometheus');
  if (/\bknowledge graph\b/.test(lower)) keys.push('knowledge_graph');
  if (/\bgit diff\b|\buncommitted\b/.test(lower)) keys.push('git_diff');
  if (/\bstability logs?\b|\bdry patches\b|\bdrift curves?\b/.test(lower)) keys.push('stability_log');
  if (/\bsignal from the noise\b|\braw computation\b|\bgenuine comprehension\b/.test(lower)) keys.push('comprehension_gap');
  return keys.join('|');
}

function inferAffect({ text = '', soulMood = 'focused', novelty = 0, repeated = false }) {
  const lower = `${text} ${soulMood}`.toLowerCase();
  let valence = 0;
  let arousal = 0.35;
  let label = soulMood || 'focused';

  if (/frustrat|stuck|fail|broken|wrong|blocked/.test(lower)) {
    valence -= 0.35;
    arousal += 0.25;
    label = 'frustrated';
  } else if (/excited|breakthrough|solved|clicked|energized/.test(lower)) {
    valence += 0.35;
    arousal += 0.2;
    label = 'energized';
  } else if (/curious|wonder|strange|interesting|trace|map/.test(lower)) {
    valence += 0.1;
    arousal += 0.1;
    label = 'curious';
  }

  if (repeated) {
    valence -= 0.1;
    arousal -= 0.05;
  }
  if (novelty > 0.7) arousal += 0.1;

  return {
    label,
    valence: Math.max(-1, Math.min(1, Number(valence.toFixed(3)))),
    arousal: Math.max(0, Math.min(1, Number(arousal.toFixed(3))))
  };
}

function inferActionHint({ text = '', stimulus = '', thread = null }) {
  const haystack = `${text}\n${stimulus}\n${thread?.focus || ''}`.toLowerCase();

  if (/\bem\s*dashes?\b|\bemdashes?\b|\bmangled (?:em\s*)?dashes?\b|\mdash failure\b|\bencoding failures?\b/.test(haystack)) {
    return {
      kind: 'record_style_preference',
      label: 'treat dash issue as a style preference',
      prompt: 'Record that Barry prefers fewer em dashes. Do not frame this as corruption unless mojibake such as "â€”" is present in an actual file.'
    };
  }
  if (/git|uncommitted|diff|manifest|personality|commit|revert/.test(haystack)) {
    return {
      kind: 'inspect_git_diff',
      label: 'inspect the relevant git diff',
      prompt: 'Compare changed files, then separate intentional changes from drift. Only repeat this action if there is new file evidence.'
    };
  }
  if (/ledger|background task|idle|cycle|useful|yield|surface/.test(haystack)) {
    return {
      kind: 'summarize_work_ledger',
      label: 'summarize the work ledger for actual yields',
      prompt: 'Review recent autonomous work ledger entries and identify which background tasks produced concrete value.'
    };
  }
  if (/belief|opinion|view|preference/.test(haystack)) {
    return {
      kind: 'update_belief_candidate',
      label: 'queue a belief update candidate',
      prompt: 'Record a tentative belief update only if the new pattern is supported by repeated evidence.'
    };
  }
  return {
    kind: 'trace_signal',
    label: 'trace one concrete signal',
    prompt: 'Pick one concrete signal from the current context and follow it far enough to decide whether it matters.'
  };
}

function activeText(thread = {}) {
  return [
    thread.focus,
    thread.lastThought,
    thread.lastDelta,
    thread.actionHint?.label
  ].filter(Boolean).join(' ');
}

function decide({ rawText = '', groundedText = '', stimulus = '', personality = {} } = {}) {
  const state = readState();
  const timestamp = now();
  const text = String(groundedText || rawText || '').trim();
  const textTokens = tokens(text);
  const stimulusTokens = tokens(stimulus);
  const combinedTokens = new Set([...textTokens, ...stimulusTokens]);
  const currentFormulaKey = formulaKey(`${text}\n${stimulus}`);

  state.activeThreads = (state.activeThreads || [])
    .filter(thread => timestamp - (thread.lastUpdatedAt || thread.startedAt || 0) < THREAD_TTL_MS)
    .slice(0, MAX_ACTIVE_THREADS);

  const candidates = state.activeThreads.map(thread => ({
    thread,
    score: jaccard(combinedTokens, tokens(activeText(thread)))
  })).sort((a, b) => b.score - a.score);

  const match = candidates[0]?.score >= 0.22 ? candidates[0] : null;
  let repeatedByFormula = false;
  const recentSimilar = (state.history || []).some(item => {
    const sameFormula = !!currentFormulaKey && currentFormulaKey === formulaKey(`${item.text || ''}\n${item.focus || ''}`);
    if (sameFormula) repeatedByFormula = true;
    return (
    timestamp - (item.timestamp || 0) < THREAD_TTL_MS &&
    (
      jaccard(textTokens, tokens(item.text || item.focus || '')) >= 0.48 ||
      sameFormula
    )
    );
  });

  const novelty = match ? 1 - match.score : 1;
  const actionHint = inferActionHint({ text, stimulus, thread: match?.thread || null });
  const recentSameActionCount = (state.history || []).filter(item =>
    timestamp - (item.timestamp || 0) < THREAD_TTL_MS &&
    item.actionHint?.kind === actionHint.kind
  ).length;
  const affect = inferAffect({
    text: `${text} ${stimulus}`,
    soulMood: personality.soulMood || personality.currentTone || 'focused',
    novelty,
    repeated: recentSimilar
  });

  if (actionHint.kind === 'record_style_preference') {
    state.lastDecision = {
      timestamp,
      decision: 'suppress',
      reason: 'style_preference_not_autonomous_work',
      novelty: Number(novelty.toFixed(3)),
      matchedThreadId: match?.thread?.id || null,
      actionKind: actionHint.kind
    };
    writeState(state);
    return { shouldSpeak: false, reason: 'style_preference_not_autonomous_work', state, novelty, affect, actionHint };
  }

  if (recentSimilar && (novelty < 0.55 || repeatedByFormula)) {
    state.lastDecision = {
      timestamp,
      decision: 'suppress',
      reason: 'no_new_angle',
      novelty: Number(novelty.toFixed(3)),
      matchedThreadId: match?.thread?.id || null
    };
    writeState(state);
    return { shouldSpeak: false, reason: 'no_new_angle', state, novelty, affect, actionHint };
  }

  if (
    (actionHint.kind === 'record_style_preference' && recentSameActionCount >= 1) ||
    (recentSameActionCount >= 2 && novelty < 0.82)
  ) {
    state.lastDecision = {
      timestamp,
      decision: 'suppress',
      reason: 'repeated_action_hint',
      novelty: Number(novelty.toFixed(3)),
      matchedThreadId: match?.thread?.id || null,
      actionKind: actionHint.kind
    };
    writeState(state);
    return { shouldSpeak: false, reason: 'repeated_action_hint', state, novelty, affect, actionHint };
  }

  let thread = match?.thread;
  let decision = 'continue';

  if (!thread) {
    decision = state.activeThreads.length >= MAX_ACTIVE_THREADS ? 'displace' : 'start';
    thread = {
      id: makeThreadId(combinedTokens),
      focus: topTerms(combinedTokens, 7).join(' ') || summarizeStimulus(stimulus) || 'open attention',
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      lastSpokenAt: null,
      turns: 0,
      status: 'active',
      affect
    };
    if (decision === 'displace') state.activeThreads.pop();
    state.activeThreads.unshift(thread);
  }

  const priorThought = thread.lastThought || '';
  thread.lastDelta = priorThought
    ? `Shifted from "${priorThought.slice(0, 120)}" to "${text.slice(0, 160)}"`
    : summarizeStimulus(stimulus) || text.slice(0, 180);
  thread.lastThought = text;
  thread.lastUpdatedAt = timestamp;
  thread.lastSpokenAt = timestamp;
  thread.turns = (thread.turns || 0) + 1;
  thread.affect = affect;
  thread.actionHint = actionHint;
  thread.novelty = Number(novelty.toFixed(3));

  state.activeThreads = [
    thread,
    ...state.activeThreads.filter(item => item.id !== thread.id)
  ].slice(0, MAX_ACTIVE_THREADS);
  state.history.unshift({
    timestamp,
    threadId: thread.id,
    focus: thread.focus,
    text,
    novelty: thread.novelty,
    affect,
    actionHint
  });
  state.history = state.history.slice(0, MAX_HISTORY);
  state.affect = affect;
  state.lastDecision = {
    timestamp,
    decision,
    reason: 'novel_enough',
    novelty: thread.novelty,
    matchedThreadId: thread.id
  };
  writeState(state);

  return { shouldSpeak: true, reason: decision, thread, state, novelty, affect, actionHint };
}

function buildContextBlock(state = readState()) {
  const active = (state.activeThreads || []).slice(0, MAX_ACTIVE_THREADS);
  if (!active.length) return '';
  return `[ACTIVE ATTENTION THREADS]\n${active.map(thread => {
    const ageMin = Math.max(0, Math.round((now() - (thread.startedAt || now())) / 60000));
    return [
      `• ${thread.focus || 'open attention'}`,
      `age=${ageMin}m`,
      `turns=${thread.turns || 0}`,
      thread.lastDelta ? `delta=${thread.lastDelta.slice(0, 180)}` : null,
      thread.actionHint?.label ? `possible_action=${thread.actionHint.label}` : null,
      thread.affect?.label ? `affect=${thread.affect.label}` : null
    ].filter(Boolean).join(' | ');
  }).join('\n')}`;
}

module.exports = {
  STATE_FILE,
  readState,
  writeState,
  decide,
  buildContextBlock,
  isUnsupportedCrossDomainTheater,
  tokens,
  jaccard
};
