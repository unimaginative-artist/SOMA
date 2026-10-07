import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const DOMAIN_TARGETS = {
  medical: { workbook: 'SOMA Research', segment: 'Medical Literature', section: 'Evidence Folios' },
  finance: { workbook: 'Mission Control Research', segment: 'Market Evidence', section: 'Research Folios' },
  code: { workbook: 'Code Lab Research', segment: 'Repository Evidence', section: 'Implementation Notes' },
  creative: { workbook: 'Creative Studio', segment: 'Story Notes', section: 'Creative Research' },
  social: { workbook: 'Social Presence', segment: 'Audience Learning', section: 'Social Signals' },
  system: { workbook: 'SOMA Operating Memory', segment: 'Decisions And Lessons', section: 'Operating Lessons' },
  general: { workbook: 'SOMA Knowledge', segment: 'Inbox', section: 'General Folios' }
};

const slugValue = (value = 'untitled') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'untitled';

const compact = (value = '', max = 120_000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const frontmatterValue = (value) => JSON.stringify(String(value || ''));

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function keywordSet(text = '') {
  const stop = new Set(['about', 'after', 'again', 'against', 'because', 'before', 'between', 'could', 'every', 'found', 'from', 'have', 'into', 'more', 'only', 'other', 'paper', 'papers', 'research', 'should', 'their', 'there', 'these', 'this', 'those', 'through', 'using', 'where', 'which', 'while', 'with', 'would']);
  return new Set((String(text).toLowerCase().match(/\b[a-z][a-z0-9-]{3,}\b/g) || [])
    .filter(word => !stop.has(word))
    .slice(0, 80));
}

function overlapScore(a, b) {
  const left = keywordSet(a);
  const right = keywordSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function tone(text = '') {
  const value = String(text).toLowerCase();
  if (/\b(no|not|failed|fails|weak|negative|non-significant|contradict|against|unlikely|risk|limitation|blocked)\b/.test(value)) return 'negative';
  if (/\b(support|supports|positive|significant|improved|useful|passed|promoted|validated|proves?|proven|signal)\b/.test(value)) return 'positive';
  return 'neutral';
}

function stableId(prefix, ...parts) {
  const digest = createHash('sha256')
    .update(parts.map(value => typeof value === 'string' ? value : JSON.stringify(value || null)).join('\n'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}-${digest}`;
}

function confidenceValue(value, fallback = 0.35) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function asEvidenceList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(asEvidenceList);
  if (typeof value === 'string') return [{ label: compact(value), value: compact(value) }];
  if (typeof value === 'object') return [value];
  return [];
}

export class KnowledgeIngestionSpine {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.system = config.system || null;
    this.dataDir = config.dataDir || path.join(this.root, 'data', 'knowledge-spine');
    this.reflectionsPath = config.reflectionsPath || path.join(this.root, 'data', 'vault', 'reflections');
    this.corpusPath = path.join(this.dataDir, 'corpus.json');
    this.auditPath = path.join(this.dataDir, 'events.jsonl');
  }

  _readCorpus() {
    const corpus = readJson(this.corpusPath, { version: 2, entries: [], units: [], nodes: [], edges: [], updatedAt: null });
    return {
      version: 2,
      entries: Array.isArray(corpus.entries) ? corpus.entries : [],
      units: Array.isArray(corpus.units) ? corpus.units : [],
      nodes: Array.isArray(corpus.nodes) ? corpus.nodes : [],
      edges: Array.isArray(corpus.edges) ? corpus.edges : [],
      updatedAt: corpus.updatedAt || null
    };
  }

  _writeCorpus(corpus) {
    fs.mkdirSync(path.dirname(this.corpusPath), { recursive: true });
    const next = { ...corpus, updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.corpusPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  _audit(event) {
    try {
      fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
      fs.appendFileSync(this.auditPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, 'utf8');
    } catch {}
  }

  _targetFor(payload = {}) {
    const domain = String(payload.domain || 'general').toLowerCase();
    const defaults = DOMAIN_TARGETS[domain] || DOMAIN_TARGETS.general;
    return {
      domain,
      workbook: payload.targetWorkbook || defaults.workbook,
      segment: payload.targetSegment || defaults.segment,
      section: payload.targetSection || defaults.section
    };
  }

  _ensureScaffold(workbook, segment, domain, section = 'General Folios') {
    fs.mkdirSync(this.reflectionsPath, { recursive: true });
    const now = new Date().toISOString();
    const workbookFile = path.join(this.reflectionsPath, `workbook.${slugValue(workbook)}.md`);
    if (!fs.existsSync(workbookFile)) {
      fs.writeFileSync(workbookFile, [
        '---',
        `title: ${frontmatterValue(workbook)}`,
        'type: workbook',
        'status: active',
        `createdAt: ${now}`,
        `domain: ${frontmatterValue(domain)}`,
        'tags: [reflections, knowledge-spine]',
        '---',
        '',
        `# ${workbook}`,
        '',
        'Reusable SOMA knowledge workspace populated by the ingestion spine.'
      ].join('\n'), 'utf8');
    }

    const segmentFile = path.join(this.reflectionsPath, `segment.${slugValue(workbook)}.${slugValue(segment)}.md`);
    if (!fs.existsSync(segmentFile)) {
      fs.writeFileSync(segmentFile, [
        '---',
        `title: ${frontmatterValue(segment)}`,
        'type: segment',
        `workbook: ${frontmatterValue(workbook)}`,
        `parent: ${frontmatterValue(workbook)}`,
        'status: active',
        `createdAt: ${now}`,
        `domain: ${frontmatterValue(domain)}`,
        'tags: [reflections, knowledge-spine]',
        '---',
        '',
        `# ${segment}`,
        '',
        'Structured notes, evidence units, contradictions, and reusable lessons.'
      ].join('\n'), 'utf8');
    }

    const sectionFile = path.join(this.reflectionsPath, `section.${slugValue(workbook)}.${slugValue(segment)}.${slugValue(section)}.md`);
    if (!fs.existsSync(sectionFile)) {
      fs.writeFileSync(sectionFile, [
        '---',
        `title: ${frontmatterValue(section)}`,
        'type: section',
        `workbook: ${frontmatterValue(workbook)}`,
        `segment: ${frontmatterValue(segment)}`,
        `parent: ${frontmatterValue(segment)}`,
        'status: active',
        `createdAt: ${now}`,
        `domain: ${frontmatterValue(domain)}`,
        'tags: [reflections, knowledge-spine, section]',
        '---',
        '',
        `# ${section}`,
        '',
        'Structured folios for this segment.'
      ].join('\n'), 'utf8');
    }
  }

  extractUnits(payload = {}) {
    const content = String(payload.content || payload.summary || '').trim();
    const metadata = payload.metadata || {};
    const explicit = Array.isArray(payload.units) ? payload.units : [];
    const sentences = content
      .split(/(?<=[.!?])\s+|\n+/)
      .map(compact)
      .filter(sentence => sentence.length >= 35 && sentence.length <= 600);

    const claimRe = /\b(is|are|was|were|shows?|suggests?|indicates?|supports?|reduces?|increases?|improves?|fails?|failed|correlates?|predicts?|outperforms?|underperforms?)\b/i;
    const riskRe = /\b(risk|limitation|caution|unsafe|failed|weak|uncertain|overfit|stale|bias|blocked|veto|drawdown|loss)\b/i;
    const questionRe = /\?$/;
    const signalRe = /\b(signal|pattern|edge|lesson|finding|result|evidence|opportunity|contradiction)\b/i;

    const units = [];
    for (const unit of explicit) {
      if (!unit?.text) continue;
      units.push({
        id: `unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: unit.kind || 'claim',
        text: compact(unit.text),
        confidence: unit.confidence ?? metadata.confidence ?? null,
        sourceId: payload.id || null,
        tone: unit.tone || tone(unit.text)
      });
    }

    for (const sentence of sentences.slice(0, 40)) {
      let kind = null;
      if (questionRe.test(sentence)) kind = 'question';
      else if (riskRe.test(sentence)) kind = 'risk';
      else if (signalRe.test(sentence)) kind = 'signal';
      else if (claimRe.test(sentence)) kind = 'claim';
      if (!kind) continue;
      units.push({
        id: `unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        text: sentence,
        confidence: metadata.confidence ?? null,
        sourceId: payload.id || null,
        tone: tone(sentence)
      });
      if (units.length >= 18) break;
    }

    return units;
  }

  buildEvidenceGraph(entry, units, payload = {}) {
    const metadata = payload.metadata || {};
    const sourceDescriptors = [
      ...asEvidenceList(payload.sourceUrl ? { url: payload.sourceUrl, label: payload.sourceUrl } : null),
      ...asEvidenceList(payload.sources),
      ...asEvidenceList(metadata.sources),
      ...asEvidenceList(metadata.citations)
    ];
    const sources = sourceDescriptors.map(source => {
      const url = compact(source.url || source.href || source.sourceUrl || source.value || '', 1000);
      const label = compact(source.title || source.label || source.name || url || 'Unlabeled source', 500);
      return {
        id: stableId('source', url || label),
        type: 'source',
        label,
        url: url || null,
        sourceType: compact(source.type || source.sourceType || entry.sourceType || 'unknown', 80),
        retrievedAt: source.retrievedAt || source.capturedAt || entry.createdAt,
        metadata: source.metadata || {}
      };
    });
    const uniqueSources = [...new Map(sources.map(source => [source.id, source])).values()];

    const evidenceDescriptors = [
      ...asEvidenceList(payload.evidence),
      ...asEvidenceList(metadata.evidence)
    ];
    if (!evidenceDescriptors.length) {
      evidenceDescriptors.push(...uniqueSources.map(source => ({
        label: `Source record: ${source.label}`,
        sourceId: source.id,
        kind: 'source_record'
      })));
    }
    const evidence = evidenceDescriptors.map(item => {
      const label = compact(item.label || item.title || item.text || item.quote || item.value || 'Evidence record', 1000);
      const sourceId = item.sourceId || (
        item.url
          ? stableId('source', compact(item.url, 1000))
          : uniqueSources.length === 1
            ? uniqueSources[0].id
            : null
      );
      return {
        id: stableId('evidence', entry.id, label, sourceId || ''),
        type: 'evidence',
        label,
        kind: compact(item.kind || item.type || 'observation', 80),
        sourceId,
        confidence: confidenceValue(item.confidence, confidenceValue(entry.confidence)),
        metadata: item.metadata || {}
      };
    });

    const entryNode = {
      id: entry.id,
      type: 'knowledge_entry',
      label: entry.title,
      domain: entry.domain,
      sourceType: entry.sourceType,
      confidence: confidenceValue(entry.confidence),
      createdAt: entry.createdAt
    };
    const enrichedUnits = units.map(unit => {
      const sourceIds = [...new Set([
        ...uniqueSources.map(source => source.id),
        ...evidence.map(item => item.sourceId).filter(Boolean)
      ])];
      const evidenceIds = evidence.map(item => item.id);
      const explicitConfidence = unit.confidence !== null && unit.confidence !== undefined;
      const confidence = confidenceValue(unit.confidence ?? entry.confidence, evidenceIds.length ? 0.55 : 0.25);
      return {
        ...unit,
        confidence,
        confidenceBasis: explicitConfidence
          ? 'explicit'
          : evidenceIds.length
            ? 'evidence-backed-default'
            : 'unverified-default',
        provenance: {
          entryId: entry.id,
          sourceIds,
          evidenceIds
        },
        verificationStatus: evidenceIds.length
          ? confidence >= 0.8 ? 'supported' : 'provisional'
          : 'unverified'
      };
    });

    const unitNodes = enrichedUnits.map(unit => ({
      id: unit.id,
      type: unit.kind,
      label: unit.text,
      domain: entry.domain,
      confidence: unit.confidence,
      confidenceBasis: unit.confidenceBasis,
      verificationStatus: unit.verificationStatus,
      entryId: entry.id
    }));
    const edges = [
      ...uniqueSources.map(source => ({
        id: stableId('edge', entry.id, 'derived_from', source.id),
        from: entry.id,
        to: source.id,
        relationship: 'derived_from',
        confidence: 1
      })),
      ...enrichedUnits.map(unit => ({
        id: stableId('edge', unit.id, 'extracted_from', entry.id),
        from: unit.id,
        to: entry.id,
        relationship: 'extracted_from',
        confidence: 1
      })),
      ...enrichedUnits.flatMap(unit => evidence.map(item => ({
        id: stableId('edge', unit.id, 'supported_by', item.id),
        from: unit.id,
        to: item.id,
        relationship: 'supported_by',
        confidence: unit.confidence
      }))),
      ...evidence.filter(item => item.sourceId).map(item => ({
        id: stableId('edge', item.id, 'located_at', item.sourceId),
        from: item.id,
        to: item.sourceId,
        relationship: 'located_at',
        confidence: 1
      }))
    ];
    return {
      units: enrichedUnits,
      nodes: [entryNode, ...unitNodes, ...evidence, ...uniqueSources],
      edges,
      sourceIds: uniqueSources.map(source => source.id),
      evidenceIds: evidence.map(item => item.id)
    };
  }

  compareUnits(units, priorUnits) {
    const duplicates = [];
    const contradictions = [];
    const related = [];

    for (const unit of units) {
      for (const prior of priorUnits.slice(0, 600)) {
        const score = overlapScore(unit.text, prior.text);
        if (score >= 0.92) {
          duplicates.push({ incoming: unit.text, prior: prior.text, priorEntryId: prior.entryId, score: Number(score.toFixed(2)) });
        } else if (score >= 0.42 && unit.tone !== 'neutral' && prior.tone !== 'neutral' && unit.tone !== prior.tone) {
          contradictions.push({ incoming: unit.text, prior: prior.text, priorEntryId: prior.entryId, score: Number(score.toFixed(2)) });
        } else if (score >= 0.48) {
          related.push({ incoming: unit.text, prior: prior.text, priorEntryId: prior.entryId, score: Number(score.toFixed(2)) });
        }
      }
    }

    return {
      duplicateCount: duplicates.length,
      contradictionCount: contradictions.length,
      relatedCount: related.length,
      duplicates: duplicates.slice(0, 8),
      contradictions: contradictions.slice(0, 8),
      related: related.slice(0, 8)
    };
  }

  publishToReflections(entry, units, comparison, target) {
    this._ensureScaffold(target.workbook, target.segment, target.domain, target.section);
    const now = new Date().toISOString();
    const title = entry.title || 'Knowledge Ingestion';
    const filename = `folio.${slugValue(target.workbook)}.${slugValue(target.segment)}.${slugValue(target.section)}.${slugValue(title)}.${Date.now()}.md`;
    const filePath = path.join(this.reflectionsPath, filename);
    const sourceLines = [
      `- Domain: ${target.domain}`,
      `- Source type: ${entry.sourceType || 'unknown'}`,
      `- Source URL: ${entry.sourceUrl || 'N/A'}`,
      `- Confidence: ${entry.confidence ?? 'N/A'}`,
      `- Created: ${now}`
    ];
    const unitLines = units.length
      ? units.map(unit => `- [${unit.kind}] (${unit.verificationStatus || 'unverified'}, confidence ${unit.confidence ?? 'N/A'}) ${unit.text}`)
      : ['- No structured units extracted.'];
    const evidenceLines = units.length
      ? units.map(unit => `- ${unit.id} → evidence: ${(unit.provenance?.evidenceIds || []).join(', ') || 'none'} → sources: ${(unit.provenance?.sourceIds || []).join(', ') || 'none'}`)
      : ['- No claim-evidence links extracted.'];
    const contradictionLines = comparison.contradictions.length
      ? comparison.contradictions.map(item => `- Incoming: ${item.incoming}\n  Prior: ${item.prior}`)
      : ['- None detected.'];
    const relatedLines = comparison.related.length
      ? comparison.related.map(item => `- ${item.incoming}`)
      : ['- None detected.'];

    const body = [
      '---',
      `title: ${frontmatterValue(title)}`,
      'type: folio',
      'status: inbox',
      `workbook: ${frontmatterValue(target.workbook)}`,
      `segment: ${frontmatterValue(target.segment)}`,
      `section: ${frontmatterValue(target.section)}`,
      `parent: ${frontmatterValue(target.section)}`,
      `createdAt: ${now}`,
      `domain: ${frontmatterValue(target.domain)}`,
      `sourceType: ${frontmatterValue(entry.sourceType || 'unknown')}`,
      'tags: [reflections, knowledge-spine]',
      '---',
      '',
      `# ${title}`,
      '',
      '## Ingestion Receipt',
      '',
      ...sourceLines,
      '',
      '## Extracted Units',
      '',
      ...unitLines,
      '',
      '## Evidence Chain',
      '',
      ...evidenceLines,
      '',
      '## Contradictions Or Tensions',
      '',
      ...contradictionLines,
      '',
      '## Related Prior Signals',
      '',
      ...relatedLines,
      '',
      '## Source Content',
      '',
      entry.content || entry.summary || ''
    ].join('\n');

    fs.writeFileSync(filePath, body, 'utf8');
    return { filename, path: filePath };
  }

  async ingest(payload = {}) {
    const target = this._targetFor(payload);
    const now = new Date().toISOString();
    const id = payload.id || `kg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id,
      title: payload.title || `${target.domain} knowledge entry`,
      domain: target.domain,
      sourceType: payload.sourceType || 'event',
      sourceUrl: payload.sourceUrl || null,
      confidence: payload.confidence ?? payload.metadata?.confidence ?? null,
      content: String(payload.content || payload.summary || '').slice(0, 120_000),
      metadata: payload.metadata || {},
      createdAt: now
    };
    const corpus = this._readCorpus();
    const extractedUnits = this.extractUnits({ ...payload, id });
    const graph = this.buildEvidenceGraph(entry, extractedUnits, payload);
    const units = graph.units;
    const comparison = this.compareUnits(units, corpus.units || []);
    const reflection = payload.publishToReflections === false
      ? null
      : this.publishToReflections(entry, units, comparison, target);

    const unitsWithEntry = units.map(unit => ({
      ...unit,
      entryId: id,
      domain: target.domain,
      sourceType: entry.sourceType,
      createdAt: now
    }));
    const nextNodes = [...graph.nodes, ...(corpus.nodes || [])];
    const nextEdges = [...graph.edges, ...(corpus.edges || [])];
    const nextCorpus = this._writeCorpus({
      ...corpus,
      entries: [{
        ...entry,
        reflection,
        unitCount: units.length,
        claimIds: unitsWithEntry.map(unit => unit.id),
        evidenceIds: graph.evidenceIds,
        sourceIds: graph.sourceIds
      }, ...(corpus.entries || [])].slice(0, 1000),
      units: [...unitsWithEntry, ...(corpus.units || [])].slice(0, 5000),
      nodes: [...new Map(nextNodes.map(node => [node.id, node])).values()].slice(0, 20_000),
      edges: [...new Map(nextEdges.map(edge => [edge.id, edge])).values()].slice(0, 50_000)
    });

    const result = {
      success: true,
      entry: { ...entry, reflection, unitCount: units.length },
      target,
      units: unitsWithEntry,
      comparison,
      evidenceGraph: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        sourceIds: graph.sourceIds,
        evidenceIds: graph.evidenceIds
      },
      corpus: this.status(nextCorpus)
    };

    this._audit({ type: 'knowledge.ingested', id, domain: target.domain, sourceType: entry.sourceType, unitCount: units.length, comparison, reflection });
    await this.system?.messageBroker?.publish?.('knowledge.ingested', result).catch?.(() => {});
    await this.system?.messageBroker?.publish?.('vault_entry_added', {
      type: 'knowledge_spine',
      title: entry.title,
      filename: reflection?.filename,
      timestamp: Date.now()
    }).catch?.(() => {});

    if (this.system?.mnemonicArbiter?.remember && units.length) {
      await this.system.mnemonicArbiter.remember(`[KNOWLEDGE SPINE] ${entry.title}\n${units.slice(0, 5).map(unit => `- ${unit.text}`).join('\n')}`, {
        importance: 0.65,
        sector: target.domain,
        category: 'knowledge_spine',
        sourceType: entry.sourceType
      }).catch(() => {});
    }

    return result;
  }

  suggest(payload = {}) {
    const content = String(payload.content || payload.summary || '');
    const units = this.extractUnits(payload);
    const score = Math.min(1, (
      (units.length >= 3 ? 0.35 : units.length * 0.08) +
      (/\b(decision|lesson|result|evidence|contradiction|failed|passed|risk|signal)\b/i.test(content) ? 0.25 : 0) +
      (content.length > 800 ? 0.15 : 0) +
      (payload.confidence ? Number(payload.confidence) * 0.25 : 0.10)
    ));
    return {
      suggested: score >= 0.55,
      confidence: Number(score.toFixed(2)),
      unitCount: units.length,
      reason: score >= 0.55
        ? 'Content contains reusable claims, risks, decisions, or evidence signals.'
        : 'Content does not yet look worth permanent filing.'
    };
  }

  status(corpus = this._readCorpus()) {
    const byDomain = {};
    const bySourceType = {};
    for (const entry of corpus.entries || []) {
      byDomain[entry.domain || 'general'] = (byDomain[entry.domain || 'general'] || 0) + 1;
      bySourceType[entry.sourceType || 'event'] = (bySourceType[entry.sourceType || 'event'] || 0) + 1;
    }
    return {
      entryCount: corpus.entries?.length || 0,
      unitCount: corpus.units?.length || 0,
      nodeCount: corpus.nodes?.length || 0,
      edgeCount: corpus.edges?.length || 0,
      updatedAt: corpus.updatedAt || null,
      byDomain,
      bySourceType,
      recentEntries: (corpus.entries || []).slice(0, 10)
    };
  }

  evidenceGraph({ limit = 500 } = {}) {
    const corpus = this._readCorpus();
    const cap = Math.max(1, Math.min(5000, Number(limit) || 500));
    const nodes = (corpus.nodes || []).slice(0, cap);
    const ids = new Set(nodes.map(node => node.id));
    return {
      version: corpus.version,
      nodes,
      edges: (corpus.edges || []).filter(edge => ids.has(edge.from) && ids.has(edge.to)).slice(0, cap * 4),
      updatedAt: corpus.updatedAt
    };
  }

  backfillEvidenceGraph() {
    const corpus = this._readCorpus();
    const entriesById = new Map((corpus.entries || []).map(entry => [entry.id, entry]));
    const nodes = new Map((corpus.nodes || []).map(node => [node.id, node]));
    const edges = new Map((corpus.edges || []).map(edge => [edge.id, edge]));
    let entriesAdded = 0;
    let unitsAdded = 0;
    let sourcesAdded = 0;
    let evidenceAdded = 0;

    for (const entry of corpus.entries || []) {
      if (!nodes.has(entry.id)) {
        nodes.set(entry.id, {
          id: entry.id,
          type: 'knowledge_entry',
          label: entry.title,
          domain: entry.domain,
          sourceType: entry.sourceType,
          confidence: confidenceValue(entry.confidence),
          createdAt: entry.createdAt,
          legacyBackfill: true
        });
        entriesAdded++;
      }
    }

    const enrichedUnits = (corpus.units || []).map(unit => {
      const entry = entriesById.get(unit.entryId || unit.sourceId);
      const sourceReference = compact(
        entry?.sourceUrl
        || entry?.metadata?.sourceUrl
        || entry?.metadata?.reflection?.path
        || entry?.reflection?.path
        || '',
        1000
      );
      let sourceId = null;
      let evidenceId = null;
      if (sourceReference) {
        sourceId = stableId('source', sourceReference);
        if (!nodes.has(sourceId)) {
          nodes.set(sourceId, {
            id: sourceId,
            type: 'source',
            label: sourceReference,
            url: /^https?:\/\//i.test(sourceReference) ? sourceReference : null,
            sourceType: entry?.sourceType || 'legacy',
            retrievedAt: entry?.createdAt || unit.createdAt || null,
            legacyBackfill: true
          });
          sourcesAdded++;
        }
        evidenceId = stableId('evidence', entry?.id || unit.entryId || '', 'legacy-source-record', sourceId);
        if (!nodes.has(evidenceId)) {
          nodes.set(evidenceId, {
            id: evidenceId,
            type: 'evidence',
            label: `Legacy source record for ${entry?.title || unit.entryId || 'knowledge unit'}`,
            kind: 'legacy_source_record',
            sourceId,
            confidence: confidenceValue(entry?.confidence, 0.35),
            legacyBackfill: true
          });
          evidenceAdded++;
        }
        const entrySourceEdge = {
          id: stableId('edge', entry?.id || unit.entryId, 'derived_from', sourceId),
          from: entry?.id || unit.entryId,
          to: sourceId,
          relationship: 'derived_from',
          confidence: 1,
          legacyBackfill: true
        };
        edges.set(entrySourceEdge.id, entrySourceEdge);
        const evidenceSourceEdge = {
          id: stableId('edge', evidenceId, 'located_at', sourceId),
          from: evidenceId,
          to: sourceId,
          relationship: 'located_at',
          confidence: 1,
          legacyBackfill: true
        };
        edges.set(evidenceSourceEdge.id, evidenceSourceEdge);
      }

      if (!nodes.has(unit.id)) {
        nodes.set(unit.id, {
          id: unit.id,
          type: unit.kind || 'claim',
          label: unit.text,
          domain: unit.domain || entry?.domain,
          confidence: confidenceValue(unit.confidence ?? entry?.confidence),
          confidenceBasis: unit.confidence === null || unit.confidence === undefined ? 'legacy-default' : 'legacy-explicit',
          verificationStatus: sourceId ? 'provisional' : 'unverified',
          entryId: entry?.id || unit.entryId || null,
          legacyBackfill: true
        });
        unitsAdded++;
      }
      if (entry?.id) {
        const extractedEdge = {
          id: stableId('edge', unit.id, 'extracted_from', entry.id),
          from: unit.id,
          to: entry.id,
          relationship: 'extracted_from',
          confidence: 1,
          legacyBackfill: true
        };
        edges.set(extractedEdge.id, extractedEdge);
      }
      if (evidenceId) {
        const supportEdge = {
          id: stableId('edge', unit.id, 'supported_by', evidenceId),
          from: unit.id,
          to: evidenceId,
          relationship: 'supported_by',
          confidence: confidenceValue(unit.confidence ?? entry?.confidence),
          legacyBackfill: true
        };
        edges.set(supportEdge.id, supportEdge);
      }
      if (unit.provenance) return unit;
      return {
        ...unit,
        confidence: confidenceValue(unit.confidence ?? entry?.confidence),
        confidenceBasis: unit.confidence === null || unit.confidence === undefined ? 'legacy-default' : 'legacy-explicit',
        verificationStatus: sourceId ? 'provisional' : 'unverified',
        provenance: {
          entryId: entry?.id || unit.entryId || null,
          sourceIds: sourceId ? [sourceId] : [],
          evidenceIds: evidenceId ? [evidenceId] : []
        }
      };
    });

    const next = this._writeCorpus({
      ...corpus,
      units: enrichedUnits,
      nodes: Array.from(nodes.values()).slice(0, 20_000),
      edges: Array.from(edges.values()).slice(0, 50_000)
    });
    const result = {
      success: true,
      entriesAdded,
      unitsAdded,
      sourcesAdded,
      evidenceAdded,
      nodeCount: next.nodes.length,
      edgeCount: next.edges.length,
      legacyStatus: 'provisional_or_unverified'
    };
    this._audit({ type: 'knowledge.evidence_graph.backfilled', ...result });
    return result;
  }
}

export default KnowledgeIngestionSpine;
