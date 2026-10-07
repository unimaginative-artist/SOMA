import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RIPPLE_DIR = path.join(process.cwd(), 'data', 'ripple');
const LOOP_FILE = path.join(RIPPLE_DIR, 'loop-ledger.json');
const CHECK_FILE = path.join(RIPPLE_DIR, 'outcome-checks.json');
const REFLECTION_DIR = path.join(process.cwd(), 'data', 'vault', 'reflections');

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function writeJson(file, value) {
    ensureDir(file);
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function appendJson(file, entry, max = 1000) {
    const rows = readJson(file, []);
    const next = [entry, ...rows.filter(row => row.id !== entry.id)].slice(0, max);
    writeJson(file, next);
    return entry;
}

function hash(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function clean(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function mdEscape(value = '') {
    return String(value || '').replace(/\r/g, '').trim();
}

function directionMatches(expected, changePct) {
    const dir = String(expected || '').toLowerCase();
    if (dir === 'up') return changePct > 0.15;
    if (dir === 'down') return changePct < -0.15;
    if (dir === 'volatile') return Math.abs(changePct) > 0.4;
    if (dir === 'mixed') return Math.abs(changePct) <= 0.5;
    return null;
}

async function fetchYahooPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Yahoo ${symbol} HTTP ${response.status}`);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const metaPrice = result?.meta?.regularMarketPrice || result?.meta?.previousClose;
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const lastClose = [...closes].reverse().find(Number.isFinite);
    const price = Number(metaPrice || lastClose);
    if (!Number.isFinite(price)) throw new Error(`No numeric Yahoo price for ${symbol}`);
    return { symbol, price, provider: 'yahoo-chart', timestamp: Date.now() };
}

async function snapshotSignals(signals = []) {
    const snapshots = [];
    for (const signal of signals.slice(0, 10)) {
        const asset = String(signal.asset || '').trim().toUpperCase();
        if (!asset) continue;
        try {
            const price = await fetchYahooPrice(asset);
            snapshots.push({ ...signal, asset, baseline: price, error: null });
        } catch (error) {
            snapshots.push({ ...signal, asset, baseline: null, error: error.message });
        }
    }
    return snapshots;
}

function predictionTitle(prediction = {}) {
    return prediction.headline || prediction.headlines?.[0] || prediction.query || 'Ripple prediction';
}

function predictionText(prediction = {}) {
    return prediction.rippleEffectsPrediction || prediction.prediction || prediction.summary || '';
}

export class RippleLoopLedger {
    constructor() {
        fs.mkdirSync(RIPPLE_DIR, { recursive: true });
        fs.mkdirSync(REFLECTION_DIR, { recursive: true });
    }

    readLoops() {
        return readJson(LOOP_FILE, []);
    }

    readOutcomeChecks() {
        return readJson(CHECK_FILE, []);
    }

    appendLoop(kind, payload = {}) {
        return appendJson(LOOP_FILE, {
            id: payload.id || `ripple-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            kind,
            createdAt: new Date().toISOString(),
            ...payload
        });
    }

    async trackPrediction(prediction = {}) {
        const fingerprint = prediction.fingerprint || hash(`${predictionTitle(prediction)} ${predictionText(prediction)}`);
        const signals = prediction.marketSignals?.signals || [];
        const check = await this.createOutcomeCheck(prediction, signals);
        const reflection = this.writePredictionReflection(prediction, check);
        this.appendLoop('prediction_tracked', {
            id: `ripple-track-${fingerprint}`,
            fingerprint,
            title: predictionTitle(prediction),
            lens: prediction.lens,
            sourceMeta: prediction.sourceMeta,
            outcomeCheckId: check?.id || null,
            reflectionPath: reflection?.path || null,
            summary: predictionText(prediction)
        });
        this.appendLoop('market_lab_context', {
            id: `ripple-market-context-${fingerprint}`,
            fingerprint,
            title: predictionTitle(prediction),
            lens: prediction.lens,
            marketSignals: prediction.marketSignals || null,
            policy: 'context_only_not_trade_signal',
            lesson: 'Market Lab may use these signals as research context only; no live execution is authorized by Ripple.'
        });
        return { check, reflection };
    }

    async createOutcomeCheck(prediction = {}, signals = []) {
        const fingerprint = prediction.fingerprint || hash(`${predictionTitle(prediction)} ${predictionText(prediction)}`);
        const existing = this.readOutcomeChecks().find(item => item.fingerprint === fingerprint);
        if (existing) return existing;

        const snapshots = await snapshotSignals(signals);
        const now = Date.now();
        const check = {
            id: `ripple-check-${fingerprint}`,
            fingerprint,
            status: 'pending',
            createdAt: new Date(now).toISOString(),
            dueAt: new Date(now + 24 * 3600_000).toISOString(),
            title: predictionTitle(prediction),
            lens: prediction.lens || null,
            claim: predictionText(prediction),
            sourceMeta: prediction.sourceMeta || null,
            snapshots,
            result: null,
            lesson: null
        };
        appendJson(CHECK_FILE, check);
        return check;
    }

    async assessOutcomeCheck(idOrFingerprint, { force = false } = {}) {
        const checks = this.readOutcomeChecks();
        const idx = checks.findIndex(item => item.id === idOrFingerprint || item.fingerprint === idOrFingerprint);
        if (idx < 0) throw new Error('Outcome check not found');
        const check = checks[idx];
        const due = Date.parse(check.dueAt || 0);
        if (!force && due && Date.now() < due) return { ...check, notDue: true };
        const beforeDue = Boolean(due && Date.now() < due);

        const observations = [];
        for (const snapshot of check.snapshots || []) {
            if (!snapshot.baseline?.price) {
                observations.push({ asset: snapshot.asset, expected: snapshot.direction, ok: null, error: snapshot.error || 'missing baseline' });
                continue;
            }
            try {
                const current = await fetchYahooPrice(snapshot.asset);
                const changePct = ((current.price - snapshot.baseline.price) / snapshot.baseline.price) * 100;
                observations.push({
                    asset: snapshot.asset,
                    expected: snapshot.direction,
                    baseline: snapshot.baseline,
                    current,
                    changePct: Number(changePct.toFixed(3)),
                    ok: directionMatches(snapshot.direction, changePct)
                });
            } catch (error) {
                observations.push({ asset: snapshot.asset, expected: snapshot.direction, ok: null, error: error.message });
            }
        }

        const graded = observations.filter(item => typeof item.ok === 'boolean');
        const hits = graded.filter(item => item.ok).length;
        const accuracy = graded.length ? hits / graded.length : null;
        const failed = !beforeDue && graded.length > 0 && accuracy < 0.4;
        const status = beforeDue
            ? 'early_assessment'
            : failed
                ? 'failed_prediction'
                : graded.length
                    ? 'assessed'
                    : 'insufficient_market_data';
        const updated = {
            ...check,
            status,
            assessedAt: new Date().toISOString(),
            result: { observations, graded: graded.length, hits, accuracy },
            lesson: beforeDue
                ? `Early smoke check only: ${hits}/${graded.length} confirming instruments currently match, but the real check is due at ${check.dueAt}.`
                : failed
                ? `Ripple claim weakened: only ${hits}/${graded.length} confirming instruments moved as expected.`
                : graded.length
                    ? `Ripple claim partially checked: ${hits}/${graded.length} confirming instruments matched expected direction.`
                    : 'Outcome check could not grade because market data was unavailable.'
        };
        checks[idx] = updated;
        writeJson(CHECK_FILE, checks);
        this.appendLoop(failed ? 'failed_prediction_memory' : 'outcome_checked', {
            id: `ripple-outcome-${updated.fingerprint}-${updated.assessedAt}`,
            fingerprint: updated.fingerprint,
            title: updated.title,
            status: updated.status,
            result: updated.result,
            lesson: updated.lesson
        });
        if (failed) this.writeFailedPredictionReflection(updated);
        return updated;
    }

    writePredictionReflection(prediction = {}, check = null) {
        const fingerprint = prediction.fingerprint || hash(`${predictionTitle(prediction)} ${predictionText(prediction)}`);
        const filename = `ripple.${fingerprint}.md`;
        const filePath = path.join(REFLECTION_DIR, filename);
        if (fs.existsSync(filePath)) return { path: filePath, filename, existed: true };
        const watchlist = (prediction.marketSignals?.validationWatchlist || prediction.validation?.watchlist || []).join(', ');
        const signals = (prediction.marketSignals?.signals || [])
            .map(s => `- ${s.asset}: ${s.direction} - ${s.reason}`)
            .join('\n') || '- No market signals extracted.';
        const body = [
            '---',
            `title: "Ripple: ${mdEscape(predictionTitle(prediction)).replace(/"/g, '\\"')}"`,
            'tags: [reflections, ripple, causal-forecast, market-context]',
            `created: ${new Date().toISOString()}`,
            `fingerprint: ${fingerprint}`,
            '---',
            '',
            '# Claim',
            mdEscape(predictionText(prediction)),
            '',
            '# Evidence',
            ...(prediction.headlines || [predictionTitle(prediction)]).slice(0, 8).map(h => `- ${mdEscape(h)}`),
            '',
            '# Expected Confirmation',
            signals,
            '',
            '# Falsifier',
            `The claim weakens if ${watchlist || 'the watchlist'} fails to move together and the headline effect fades without cross-asset confirmation.`,
            '',
            '# Outcome Check',
            check ? `Scheduled: ${check.dueAt}\nCheck ID: ${check.id}` : 'Not scheduled.'
        ].join('\n');
        fs.writeFileSync(filePath, body, 'utf8');
        return { path: filePath, filename, existed: false };
    }

    writeFailedPredictionReflection(check = {}) {
        const filename = `ripple.failed.${check.fingerprint}.${Date.now()}.md`;
        const filePath = path.join(REFLECTION_DIR, filename);
        const observations = (check.result?.observations || [])
            .map(o => `- ${o.asset}: expected ${o.expected}, ${o.changePct ?? 'n/a'}% change, ok=${o.ok}`)
            .join('\n');
        fs.writeFileSync(filePath, [
            '---',
            `title: "Failed Ripple Check: ${mdEscape(check.title).replace(/"/g, '\\"')}"`,
            'tags: [reflections, ripple, failed-prediction, calibration]',
            `created: ${new Date().toISOString()}`,
            `fingerprint: ${check.fingerprint}`,
            '---',
            '',
            '# What Failed',
            check.lesson || 'Prediction did not receive enough confirmation.',
            '',
            '# Original Claim',
            mdEscape(check.claim),
            '',
            '# Observations',
            observations || '- No observations available.',
            '',
            '# Memory Update',
            'Preserve this as negative evidence before reusing the same causal chain.'
        ].join('\n'), 'utf8');
        return { path: filePath, filename };
    }

    recordPaperRipple(paper = {}) {
        const title = paper.title || paper.topic || 'Paper signal';
        const summary = paper.summary || paper.text || paper.description || '';
        const domains = [];
        if (/chip|semiconductor|gpu|data center|energy|power|grid/i.test(`${title} ${summary}`)) domains.push('ai_infrastructure');
        if (/security|vulnerab|exploit|attack|privacy/i.test(`${title} ${summary}`)) domains.push('cyber_risk');
        if (/health|clinical|patient|medical|drug|protein/i.test(`${title} ${summary}`)) domains.push('medical_research');
        const event = this.appendLoop('paper_to_ripple', {
            id: `ripple-paper-${hash(paper.sourceKey || paper.url || title)}`,
            title,
            url: paper.url || null,
            domains,
            summary: clean(summary).slice(0, 900),
            ripplePrompt: `Ask what second-order effects this paper could have across ${domains.join(', ') || 'markets, software, and society'}.`
        });
        return event;
    }

    recordCyberRipple(challenge = {}) {
        return this.appendLoop('cyber_to_ripple', {
            id: `ripple-cyber-${challenge.cveId || challenge.id || Date.now()}`,
            title: challenge.title || challenge.cveId || 'Cyber event',
            cveId: challenge.cveId || null,
            attackVector: challenge.attackVector || null,
            cwe: challenge.cwe || null,
            mitigation: challenge.mitigation || null,
            ripple: `Cyber event may ripple through patch urgency, vendor trust, cloud exposure, security spend, and operational risk.`
        });
    }

    recordGameTheorySocialStrategy(match = {}) {
        const lesson = match.winner === 'SOMA'
            ? `${match.strategy} performed well against ${match.persona}; social strategy can test firm claims with selective forgiveness after low engagement.`
            : `${match.strategy} underperformed against ${match.persona}; social strategy should avoid overcommitting to one cadence or tone.`;
        return this.appendLoop('game_theory_to_social', {
            id: `ripple-game-social-${hash(`${match.timestamp}-${match.strategy}-${match.persona}`)}`,
            strategy: match.strategy,
            persona: match.persona,
            winner: match.winner,
            lesson
        });
    }

    recordSocialRippleOutcome(entry = {}, metrics = {}, score = 0) {
        if (entry.type !== 'ripple_insight') return null;
        return this.appendLoop('social_to_ripple_learning', {
            id: `ripple-social-${hash(entry.uri || entry.text || Date.now())}`,
            text: entry.text || '',
            metrics,
            score,
            lesson: score > 0
                ? 'Ripple-style causal posts received engagement; keep testing grounded causal observations.'
                : 'Ripple-style causal post did not receive engagement yet; vary lens, length, or hook before increasing volume.'
        });
    }

    status() {
        const loops = this.readLoops();
        const checks = this.readOutcomeChecks();
        return {
            loops: loops.length,
            checks: checks.length,
            pendingChecks: checks.filter(c => c.status === 'pending').length,
            failedPredictions: checks.filter(c => c.status === 'failed_prediction').length,
            recent: loops.slice(0, 20),
            outcomeChecks: checks.slice(0, 20)
        };
    }
}

export default new RippleLoopLedger();
