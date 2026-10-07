import fs from 'fs';
import path from 'path';

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function keyFor(event = {}) {
  return `${event.target || event.topic || 'unknown'}:${event.strand || event.query || event.category || 'general'}`;
}

export class MedicalDiscoveryScoreboard {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.path = config.path || path.join(this.root, 'data', 'medical-lab', 'discovery-scoreboard.json');
  }

  read() {
    return readJson(this.path, { version: 1, updatedAt: null, areas: {} });
  }

  record(event = {}) {
    const board = this.read();
    const key = keyFor(event);
    const area = board.areas[key] || {
      key,
      target: event.target || event.topic || 'unknown',
      strand: event.strand || event.query || 'general',
      category: event.category || null,
      runs: 0,
      positives: 0,
      negatives: 0,
      literatureEvents: 0,
      paperReadyDrafts: 0,
      blockedClaims: 0,
      cumulativeScore: 0,
      lessons: [],
      lastUpdated: null
    };

    area.runs += 1;
    if (event.outcome === 'positive') area.positives += 1;
    if (event.outcome === 'negative') area.negatives += 1;
    if (event.outcome === 'literature_ingested') area.literatureEvents += 1;
    if (event.reviewState === 'paper_ready_draft' || event.readiness === 'paper_ready_draft') area.paperReadyDrafts += 1;
    if (event.citationIntegrity === 'blocked_claims_present') area.blockedClaims += 1;

    const evidenceBoost = /plausible|literature|paper_ready|evidence/i.test(String(event.evidenceGrade || event.readiness || '')) ? 0.12 : 0;
    const negativePenalty = event.outcome === 'negative' ? -0.14 : 0;
    const blockedPenalty = event.citationIntegrity === 'blocked_claims_present' ? -0.20 : 0;
    const qualityBoost = Number(event.manuscriptScore || 0) * 0.18;
    area.cumulativeScore += evidenceBoost + negativePenalty + blockedPenalty + qualityBoost;
    area.utilityScore = Number(Math.max(0, Math.min(1, 0.45 + area.cumulativeScore / Math.max(1, area.runs))).toFixed(3));
    area.recommendation = area.utilityScore >= 0.68
      ? 'double_down'
      : area.utilityScore <= 0.36
        ? 'deprioritize'
        : 'continue_cautiously';

    if (event.lesson) area.lessons = [event.lesson, ...(area.lessons || [])].slice(0, 8);
    area.lastOutcome = event.outcome || event.status || 'unknown';
    area.lastEvidenceGrade = event.evidenceGrade || null;
    area.lastReflectionPath = event.reflectionPath || null;
    area.lastUpdated = new Date().toISOString();

    board.areas[key] = area;
    board.updatedAt = new Date().toISOString();
    writeJson(this.path, board);
    return area;
  }

  summary(limit = 12) {
    const board = this.read();
    const areas = Object.values(board.areas || {}).sort((a, b) => (b.utilityScore || 0) - (a.utilityScore || 0));
    return {
      updatedAt: board.updatedAt,
      totalAreas: areas.length,
      topAreas: areas.slice(0, limit),
      deprioritized: areas.filter(area => area.recommendation === 'deprioritize').slice(0, limit),
      path: this.path
    };
  }
}

export default MedicalDiscoveryScoreboard;
