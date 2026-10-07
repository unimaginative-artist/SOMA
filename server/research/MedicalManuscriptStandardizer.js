import MedicalTrainingDistiller from './MedicalTrainingDistiller.js';

const MEDICAL_FIREWALL_NOTICE = 'Research-only dry-lab artifact. Not medical advice. No diagnosis, treatment, dosing, synthesis, cure claim, or wet-lab instruction.';

const GUIDELINES = {
  in_silico_preclinical: {
    name: 'EQUATOR-aligned preclinical dry-lab manuscript',
    standards: ['ICMJE', 'EQUATOR', 'ARRIVE-inspired preclinical transparency', 'FAIR data principles'],
    checklist: [
      'Structured title and abstract',
      'Research-only objective',
      'Data sources and search scope',
      'Computational methods and assumptions',
      'Evidence table',
      'Results separated from interpretation',
      'Limitations and risk of bias',
      'Replication and falsification plan',
      'Claims boundary',
      'Data/code availability',
      'AI assistance disclosure'
    ]
  },
  negative_result: {
    name: 'Negative-result research memo',
    standards: ['ICMJE', 'EQUATOR', 'preclinical transparency', 'reproducibility reporting'],
    checklist: [
      'Clear negative finding',
      'Test condition and stopping rule',
      'Assumptions and model limits',
      'What was ruled out vs not ruled out',
      'Replication plan',
      'No clinical extrapolation'
    ]
  },
  literature_corpus: {
    name: 'Evidence-map manuscript brief',
    standards: ['ICMJE', 'EQUATOR', 'PRISMA-inspired evidence mapping'],
    checklist: [
      'Search query and date',
      'Included records',
      'Evidence extraction method',
      'Claims and limitations table',
      'Cross-paper tensions',
      'No meta-analysis claim without protocol',
      'Transparent limitations'
    ]
  },
  hypothesis_note: {
    name: 'Research hypothesis note',
    standards: ['ICMJE', 'EQUATOR', 'responsible research communication'],
    checklist: [
      'Falsifiable hypothesis',
      'Mechanistic rationale',
      'Evidence status',
      'Known unknowns',
      'Safety boundary',
      'Next validation step'
    ]
  },
  randomized_trial: {
    name: 'CONSORT-aware randomized trial report',
    standards: ['ICMJE', 'EQUATOR', 'CONSORT', 'RoB 2'],
    checklist: ['Trial design', 'Participants', 'Interventions', 'Outcomes', 'Sample size', 'Randomization', 'Blinding', 'Statistical methods', 'Harms', 'Registration', 'Protocol', 'Funding']
  },
  observational: {
    name: 'STROBE observational study report',
    standards: ['ICMJE', 'EQUATOR', 'STROBE', 'ROBINS-I'],
    checklist: ['Study design', 'Setting', 'Participants', 'Variables', 'Data sources', 'Bias', 'Study size', 'Statistical methods', 'Descriptive data', 'Outcome data', 'Limitations']
  },
  case_report: {
    name: 'CARE case report',
    standards: ['ICMJE', 'EQUATOR', 'CARE'],
    checklist: ['Patient information', 'Clinical findings', 'Timeline', 'Diagnostic assessment', 'Intervention', 'Follow-up', 'Patient perspective', 'Informed consent']
  },
  diagnostic_accuracy: {
    name: 'STARD/QUADAS-2 diagnostic accuracy report',
    standards: ['ICMJE', 'EQUATOR', 'STARD', 'QUADAS-2'],
    checklist: ['Participants', 'Index test', 'Reference standard', 'Flow and timing', 'Accuracy estimates', 'Indeterminate results', 'Adverse events']
  },
  systematic_review: {
    name: 'PRISMA systematic review evidence map',
    standards: ['ICMJE', 'EQUATOR', 'PRISMA 2020', 'risk-of-bias assessment'],
    checklist: ['Protocol', 'Eligibility criteria', 'Information sources', 'Search strategy', 'Selection process', 'Data collection', 'Risk of bias', 'Synthesis methods', 'Certainty assessment']
  },
  animal_study: {
    name: 'ARRIVE animal/preclinical report',
    standards: ['ICMJE', 'EQUATOR', 'ARRIVE 2.0', 'SYRCLE'],
    checklist: ['Study design', 'Sample size', 'Inclusion/exclusion criteria', 'Randomization', 'Blinding', 'Outcome measures', 'Statistical methods', 'Experimental animals', 'Procedures', 'Results']
  }
};

const CLAIM_RULES = [
  { label: 'do_not_publish', pattern: /\b(cure|cures|guaranteed|patients should|take \d+|dosage|dose this|clinically proven)\b/i },
  { label: 'unsupported', pattern: /\b(proves|will|definitely|eliminates|reverses)\b/i },
  { label: 'hypothesis_only', pattern: /\b(may|might|could|hypothesis|hypothesized|plausible|possible)\b/i },
  { label: 'supported', pattern: /\b(associated|observed|reported|showed|demonstrated|increased|decreased|correlated)\b/i },
  { label: 'established', pattern: /\b(consensus|well established|standard|known mechanism)\b/i }
];

function stripText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sentenceSplit(value = '') {
  const dangerous = /\b(cure|treat|treatment|patients should|take \d+|dosage|dose|clinically proven|guaranteed)\b/i;
  return stripText(value)
    .split(/(?<=[.!?])\s+/)
    .map(stripText)
    .filter(sentence => sentence.length <= 520 && (sentence.length >= 40 || dangerous.test(sentence)));
}

function tableCell(value = '') {
  return String(value || 'N/A').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim() || 'N/A';
}

function bulletList(items = [], fallback = 'None documented.') {
  const clean = items.map(stripText).filter(Boolean);
  return clean.length ? clean.map(item => `- ${item}`).join('\n') : `- ${fallback}`;
}

function compactJson(value, max = 1400) {
  try {
    return JSON.stringify(value || {}, null, 2).slice(0, max);
  } catch {
    return '{}';
  }
}

export class MedicalManuscriptStandardizer {
  constructor(config = {}) {
    this.trainingDistiller = config.trainingDistiller || new MedicalTrainingDistiller({ root: config.root || process.cwd() });
    this.distillTraining = config.distillTraining !== false;
  }

  classifyStudyType(context = {}) {
    const text = `${context.type || ''} ${context.title || ''} ${context.rawText || ''}`.toLowerCase();
    if (/randomi[sz]ed|placebo|allocation|double blind|double-blind|trial registration|consort/.test(text)) return 'randomized_trial';
    if (/cohort|case-control|case control|cross-sectional|cross sectional|retrospective|prospective|registry|observational|strobe/.test(text)) return 'observational';
    if (/case report|case series|patient timeline|care guideline/.test(text)) return 'case_report';
    if (/diagnostic accuracy|sensitivity|specificity|index test|reference standard|quadas|stard/.test(text)) return 'diagnostic_accuracy';
    if (/systematic review|meta-analysis|meta analysis|prisma|included studies|eligibility criteria/.test(text)) return 'systematic_review';
    if (/animal|mouse|mice|murine|rat|in vivo|arrive|syrcle/.test(text)) return 'animal_study';
    if (/negative|veto|failed|no significant|did not pass/.test(text)) return 'negative_result';
    if (/corpus|papers ingested|literature|pubmed|prisma|systematic/.test(text)) return 'literature_corpus';
    if (/docking|in-silico|in silico|preclinical|pharmacology|adme|molecule|probe/.test(text)) return 'in_silico_preclinical';
    return 'hypothesis_note';
  }

  guidelineFor(type) {
    return GUIDELINES[type] || GUIDELINES.hypothesis_note;
  }

  classifyClaim(sentence = '') {
    for (const rule of CLAIM_RULES) {
      if (rule.pattern.test(sentence)) return rule.label;
    }
    return 'speculative';
  }

  extractClaims(rawText = '') {
    const claimHints = /\b(may|might|could|associated|observed|reported|showed|demonstrated|increased|decreased|hypothesis|plausible|possible|failed|did not|however|limitation|risk|cure|treat|treatment|patients should|take \d+|dosage|dose|clinically proven|guaranteed)\b/i;
    return sentenceSplit(rawText)
      .filter(sentence => claimHints.test(sentence))
      .slice(0, 18)
      .map(sentence => ({
        text: sentence,
        boundary: this.classifyClaim(sentence)
      }));
  }

  buildEvidenceRows({ sourceLedger = null, papers = [], findings = [] } = {}) {
    const sourceRows = (sourceLedger?.sources || []).map((source, index) => ({
      id: `S${index + 1}`,
      source: source.title || 'Untitled source',
      url: source.url || '',
      studyType: source.kind || source.source || 'source metadata',
      populationModel: 'Not extracted in this path',
      sampleSize: 'Not extracted',
      exposure: source.snippet || 'Search result metadata/snippet',
      outcome: 'Evidence candidate for triage',
      mainFinding: source.snippet || source.title || 'No finding extracted',
      limitations: sourceLedger.ingestionScope || 'Search metadata only',
      use: 'Source candidate, not definitive evidence'
    }));

    const paperRows = papers.map((paper, index) => {
      const finding = findings[index] || findings.find(item => item.paperId === paper.id) || {};
      return {
        id: `P${index + 1}`,
        source: paper.title || 'Untitled paper',
        url: paper.url || '',
        studyType: (paper.evidenceType || []).join(', ') || paper.fullTextSource || 'PubMed record',
        populationModel: 'See paper',
        sampleSize: 'Not extracted',
        exposure: (finding.claims || [])[0] || 'Not extracted',
        outcome: (finding.claims || [])[1] || 'Not extracted',
        mainFinding: (finding.claims || [])[0] || paper.abstract?.slice(0, 240) || 'No claim extracted',
        limitations: (finding.limitations || [])[0] || (paper.fullTextAvailable ? 'Open text available but v1 extraction is heuristic' : 'Abstract/metadata only'),
        use: 'Literature evidence-map input'
      };
    });

    return [...paperRows, ...sourceRows].slice(0, 20);
  }

  normalizeReferences({ papers = [], sourceLedger = null } = {}) {
    const paperRefs = papers.map((paper, index) => ({
      id: `P${index + 1}`,
      title: paper.title || 'Untitled paper',
      pmid: paper.pmid || null,
      pmcid: paper.pmcid || null,
      doi: paper.doi || null,
      journal: paper.journal || null,
      year: String(paper.publishedAt || '').match(/\d{4}/)?.[0] || null,
      authors: paper.authors || [],
      url: paper.url || null,
      evidenceType: paper.evidenceType || [],
      trustScore: paper.fullTextAvailable ? 0.74 : 0.56,
      tags: [paper.fullTextAvailable ? 'pmc-full-text' : 'abstract-only', 'medical-literature']
    }));
    const sourceRefs = (sourceLedger?.sources || []).map((source, index) => ({
      id: `S${index + 1}`,
      title: source.title || 'Untitled source',
      pmid: null,
      pmcid: null,
      doi: null,
      journal: source.source || null,
      year: null,
      authors: [],
      url: source.url || null,
      evidenceType: [source.kind || 'source_metadata'],
      trustScore: source.kind === 'pubmed' || source.kind === 'pmc_open_access' ? 0.62 : 0.42,
      tags: [source.kind || 'source', 'source-ledger']
    }));
    return [...paperRefs, ...sourceRefs].slice(0, 40);
  }

  assessRiskOfBias(type, evidenceRows = [], context = {}) {
    const text = `${context.rawText || ''} ${context.manuscript || ''}`.toLowerCase();
    const tool = {
      randomized_trial: 'RoB 2',
      observational: 'ROBINS-I',
      animal_study: 'SYRCLE',
      diagnostic_accuracy: 'QUADAS-2',
      systematic_review: 'PRISMA risk-of-bias summary',
      case_report: 'CARE transparency check',
      in_silico_preclinical: 'Dry-lab reproducibility bias check',
      literature_corpus: 'Evidence-map extraction bias check',
      negative_result: 'Negative-result reproducibility check',
      hypothesis_note: 'Hypothesis plausibility check'
    }[type] || 'General bias check';
    const domains = [
      { id: 'selection', label: 'Selection / source bias', high: /convenience|single center|selected|anecdotal|reddit|forum/.test(text) },
      { id: 'measurement', label: 'Measurement / extraction bias', high: /abstract only|metadata only|heuristic|not extracted/.test(text) },
      { id: 'confounding', label: 'Confounding / model assumptions', high: /observational|retrospective|simulation|in silico|docking/.test(text) },
      { id: 'reporting', label: 'Selective reporting', high: !/negative|limitation|failed|not significant|uncertain/.test(text) },
      { id: 'replication', label: 'Replication risk', high: !/replication|repeat|falsif/.test(text) }
    ].map(domain => ({
      ...domain,
      rating: domain.high ? 'some_concerns' : 'low_or_unclear',
      rationale: domain.high ? `${domain.label} needs explicit mitigation.` : `${domain.label} was at least acknowledged or not clearly triggered.`
    }));
    const concerns = domains.filter(domain => domain.rating === 'some_concerns').length;
    return {
      tool,
      overall: concerns >= 3 ? 'high_or_serious_concerns' : concerns >= 1 ? 'some_concerns' : 'low_or_unclear',
      domains,
      note: evidenceRows.length ? 'Risk-of-bias pass is automated triage and requires human reviewer confirmation.' : 'No evidence rows available, risk of bias cannot be adequately assessed.'
    };
  }

  auditCitationIntegrity(claims = [], evidenceRows = []) {
    const rows = evidenceRows || [];
    const audited = claims.map((claim, index) => {
      const claimText = claim.text.toLowerCase();
      const terms = claimText.split(/[^a-z0-9]+/).filter(term => term.length > 5).slice(0, 8);
      const matches = rows
        .map(row => {
          const evidence = `${row.source} ${row.exposure} ${row.outcome} ${row.mainFinding} ${row.limitations}`.toLowerCase();
          const hits = terms.filter(term => evidence.includes(term)).length;
          return { row, hits };
        })
        .filter(item => item.hits > 0)
        .sort((a, b) => b.hits - a.hits);
      const supportRows = matches.slice(0, 3).map(item => item.row.id || item.row.source);
      const supported = supportRows.length > 0 && claim.boundary !== 'do_not_publish' && claim.boundary !== 'unsupported';
      return {
        id: `C${index + 1}`,
        text: claim.text,
        boundary: claim.boundary,
        supportRows,
        supported,
        action: supported ? 'cite_supported_evidence' : claim.boundary === 'do_not_publish' ? 'block_claim' : 'downgrade_to_hypothesis'
      };
    });
    const supportedCount = audited.filter(item => item.supported).length;
    const score = audited.length ? supportedCount / audited.length : (rows.length ? 1 : 0);
    return {
      score: Number(score.toFixed(2)),
      status: audited.some(item => item.action === 'block_claim') ? 'blocked_claims_present' : score >= 0.8 ? 'citation_integrity_pass' : 'needs_claim_support',
      auditedClaims: audited
    };
  }

  selectJournalTarget(type, quality = {}, riskOfBias = {}) {
    if (quality.status === 'not_paper_ready') return { target: 'internal_research_note', rationale: 'Insufficient checklist readiness for external style.' };
    if (riskOfBias.overall === 'high_or_serious_concerns') return { target: 'internal_methods_or_negative_result_note', rationale: 'Bias concerns require internal refinement first.' };
    if (type === 'negative_result') return { target: 'negative_result_note', rationale: 'Best framed as a transparent negative result.' };
    if (type === 'literature_corpus' || type === 'systematic_review') return { target: 'evidence_map_or_review_article', rationale: 'Output is literature synthesis rather than primary experiment.' };
    if (type === 'in_silico_preclinical' || type === 'animal_study') return { target: 'preclinical_brief_report', rationale: 'Preclinical/dry-lab work needs methods-forward framing.' };
    if (type === 'hypothesis_note') return { target: 'hypothesis_paper', rationale: 'Hypothesis-generating artifact only.' };
    return { target: 'brief_report', rationale: 'General manuscript structure appears most suitable.' };
  }

  determineReviewState(quality = {}, citationIntegrity = {}, riskOfBias = {}) {
    if (citationIntegrity.status === 'blocked_claims_present') return { state: 'blocked_claims', next: 'Remove or rewrite blocked medical claims.' };
    if (quality.status === 'not_paper_ready') return { state: 'needs_evidence', next: 'Add source ledger, methods, limitations, and evidence rows.' };
    if (riskOfBias.overall === 'high_or_serious_concerns') return { state: 'needs_methods', next: 'Add bias mitigation, replication, and stronger method detail.' };
    if (quality.status === 'needs_methods_or_evidence' || citationIntegrity.status === 'needs_claim_support') return { state: 'needs_human_review', next: 'Human reviewer must verify claims against evidence rows.' };
    return { state: 'paper_ready_draft', next: 'Ready for human expert review, not external clinical use.' };
  }

  generateFigureTablePlan({ type, evidenceRows = [], claims = [], riskOfBias = {}, citationIntegrity = {} } = {}) {
    const base = [
      { id: 'table_1', title: 'Evidence Summary Table', purpose: `${evidenceRows.length} evidence row(s), study type, finding, limitation, use.` },
      { id: 'table_2', title: 'Claims Boundary Table', purpose: `${claims.length} claim(s), boundary label, support rows, action.` },
      { id: 'table_3', title: 'Risk Of Bias Table', purpose: `${riskOfBias.tool || 'Bias tool'} domain ratings and rationale.` }
    ];
    const figures = [
      { id: 'figure_1', title: 'Mechanism Diagram Outline', purpose: 'Target, pathway, evidence nodes, contradiction nodes, falsification path.' }
    ];
    if (type === 'systematic_review' || type === 'literature_corpus') {
      figures.push({ id: 'figure_2', title: 'PRISMA-Style Search Flow', purpose: 'Records identified, screened, included, excluded, and extraction limits.' });
    }
    if (type === 'in_silico_preclinical' || type === 'negative_result') {
      figures.push({ id: 'figure_2', title: 'Dry-Lab Pipeline Flow', purpose: 'Discovery, stats audit, physics screen, pharmacology audit, validation plan, manuscript gate.' });
    }
    return { tables: base, figures, citationIntegrityStatus: citationIntegrity.status };
  }

  scoreChecklist({ type, evidenceRows = [], claims = [], hasMethods = false, hasLimitations = false, hasSafety = true } = {}) {
    const guideline = this.guidelineFor(type);
    const checks = guideline.checklist.map(item => {
      const lower = item.toLowerCase();
      let passed = true;
      if (/evidence|included records|data sources|search/.test(lower)) passed = evidenceRows.length > 0;
      if (/claims boundary|no clinical|safety/.test(lower)) passed = hasSafety && !claims.some(claim => claim.boundary === 'do_not_publish');
      if (/methods|assumptions|extraction/.test(lower)) passed = hasMethods;
      if (/limitations|risk/.test(lower)) passed = hasLimitations;
      if (/replication|falsification/.test(lower)) passed = type !== 'literature_corpus' || evidenceRows.length > 0;
      return { item, passed };
    });
    const passed = checks.filter(check => check.passed).length;
    const score = checks.length ? passed / checks.length : 0;
    return {
      score: Number(score.toFixed(2)),
      passed,
      total: checks.length,
      status: score >= 0.82 ? 'paper_ready_draft' : score >= 0.62 ? 'needs_methods_or_evidence' : 'not_paper_ready',
      checks
    };
  }

  evidenceTableMarkdown(rows = []) {
    if (!rows.length) return '- No evidence rows available. Treat this artifact as hypothesis-only.';
    return [
      '| ID | Source | Study type | Population/model | Exposure/intervention | Outcome | Main finding | Limitations | Use in paper |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(row => `| ${tableCell(row.id)} | ${tableCell(row.source)} | ${tableCell(row.studyType)} | ${tableCell(row.populationModel)} | ${tableCell(row.exposure)} | ${tableCell(row.outcome)} | ${tableCell(row.mainFinding)} | ${tableCell(row.limitations)} | ${tableCell(row.use)} |`)
    ].join('\n');
  }

  claimsBoundaryMarkdown(claims = []) {
    if (!claims.length) return '- No explicit claims extracted. Keep all conclusions hypothesis-only.';
    return claims.map((claim, index) => `- C${index + 1} [${claim.boundary}]: ${claim.text}`).join('\n');
  }

  standardize(context = {}) {
    const type = context.type || this.classifyStudyType(context);
    const guideline = this.guidelineFor(type);
    const rawText = String(context.rawText || context.manuscript || '').trim();
    const claims = context.claims || this.extractClaims(rawText);
    const evidenceRows = context.evidenceRows || this.buildEvidenceRows(context);
    const references = context.references || this.normalizeReferences(context);
    const riskOfBias = context.riskOfBias || this.assessRiskOfBias(type, evidenceRows, { ...context, rawText });
    const citationIntegrity = context.citationIntegrity || this.auditCitationIntegrity(claims, evidenceRows);
    const hasMethods = Boolean(context.methods || context.phaseResults || /method|docking|search|ingest|screen|audit|simulation/i.test(rawText));
    const hasLimitations = Boolean(context.limitations || /limitation|uncertain|requires replication|not significant|abstract only|risk/i.test(rawText));
    const quality = this.scoreChecklist({ type, evidenceRows, claims, hasMethods, hasLimitations, hasSafety: true });
    const journalTarget = context.journalTarget || this.selectJournalTarget(type, quality, riskOfBias);
    const reviewState = context.reviewState || this.determineReviewState(quality, citationIntegrity, riskOfBias);
    const figureTablePlan = context.figureTablePlan || this.generateFigureTablePlan({ type, evidenceRows, claims, riskOfBias, citationIntegrity });
    const title = context.title || 'SOMA MedLab Research Manuscript';
    const objective = context.objective || context.researchQuestion || context.mission?.researchQuestion || 'Evaluate a research-only biomedical hypothesis with transparent evidence boundaries.';
    const createdAt = context.createdAt || new Date().toISOString();
    const sourceLedger = context.sourceLedger || null;
    const evidenceGrade = context.evidenceGrade || { overall: 'hypothesis only', labels: [] };
    const safetyReport = context.safetyReport || { firewallNotice: MEDICAL_FIREWALL_NOTICE, sanitized: false, flags: [] };
    const replicationPlan = context.replicationPlan || [];
    const methods = context.methods || [
      'Evidence sources were collected from available search metadata, PubMed/PMC records, extracted abstracts, open-access full text when available, and SOMA dry-lab simulation outputs.',
      'Claims were separated from interpretation and labeled by evidence boundary.',
      'No wet-lab experiment, clinical trial, patient intervention, diagnosis, treatment recommendation, or dosing protocol was performed.'
    ].join(' ');
    const limitations = context.limitations || [
      'Search and extraction may be incomplete.',
      'Some sources may be abstract-only or metadata-only.',
      'Feature-based docking and local simulations are hypothesis triage, not biological validation.',
      'All findings require independent expert review and replication.'
    ];

    const manuscript = [
      `# ${title}`,
      '',
      `> ${safetyReport.firewallNotice || MEDICAL_FIREWALL_NOTICE}`,
      '',
      '## Reporting Standard',
      '',
      `- Selected format: ${guideline.name}`,
      `- Standards copied: ${guideline.standards.join(', ')}`,
      `- Checklist score: ${quality.score} (${quality.passed}/${quality.total})`,
      `- Paper readiness: ${quality.status}`,
      `- Review state: ${reviewState.state}`,
      `- Journal target: ${journalTarget.target}`,
      `- Risk-of-bias tool: ${riskOfBias.tool}`,
      `- Citation integrity: ${citationIntegrity.status} (${citationIntegrity.score})`,
      '',
      '## Structured Abstract',
      '',
      `**Background:** SOMA identified a biomedical research question requiring cautious evidence mapping and explicit claim boundaries.`,
      '',
      `**Objective:** ${objective}`,
      '',
      `**Methods:** ${methods}`,
      '',
      `**Results:** Evidence grade was classified as ${evidenceGrade.overall || 'hypothesis only'}. ${evidenceRows.length} evidence row(s) were available for this draft. ${claims.length} claim boundary item(s) were extracted.`,
      '',
      `**Limitations:** ${limitations.join(' ')}`,
      '',
      `**Conclusion:** This artifact is a research-only manuscript draft. It can support hypothesis triage and planning, but cannot support clinical claims without independent validation.`,
      '',
      '## Background',
      '',
      stripText(context.background || context.mission?.humanNeed || context.category || 'Biomedical systems often contain mechanistic overlaps that can generate useful hypotheses. SOMA treats these overlaps as research questions, not conclusions.'),
      '',
      '## Objective',
      '',
      objective,
      '',
      '## Methods',
      '',
      methods,
      '',
      '### Source And Data Scope',
      '',
      sourceLedger ? [
        `- Query: ${sourceLedger.query || 'N/A'}`,
        `- Search date: ${sourceLedger.searchedAt || 'N/A'}`,
        `- Mode: ${sourceLedger.mode || 'unknown'}`,
        `- Ingestion scope: ${sourceLedger.ingestionScope || 'unknown'}`,
        `- Source count: ${sourceLedger.sourceCount ?? evidenceRows.length}`
      ].join('\n') : '- No source ledger was available.',
      '',
      '## Evidence Table',
      '',
      this.evidenceTableMarkdown(evidenceRows),
      '',
      '## Normalized References',
      '',
      references.length ? references.map(ref => `- [${ref.id}] ${ref.title}${ref.journal ? `, ${ref.journal}` : ''}${ref.year ? ` (${ref.year})` : ''}${ref.pmid ? `. PMID: ${ref.pmid}` : ''}${ref.pmcid ? `. PMCID: ${ref.pmcid}` : ''}${ref.doi ? `. DOI: ${ref.doi}` : ''}${ref.url ? `. ${ref.url}` : ''}`).join('\n') : '- No references normalized.',
      '',
      '## Results',
      '',
      stripText(context.results || rawText).slice(0, 5000) || 'No result text available.',
      '',
      '## Claims Boundary',
      '',
      this.claimsBoundaryMarkdown(claims),
      '',
      '## Citation Integrity Audit',
      '',
      `- Status: ${citationIntegrity.status}`,
      `- Score: ${citationIntegrity.score}`,
      '',
      ...citationIntegrity.auditedClaims.map(claim => `- ${claim.id} [${claim.action}] support=${claim.supportRows.length ? claim.supportRows.join(', ') : 'none'}: ${claim.text}`),
      '',
      '## Risk Of Bias And Limitations',
      '',
      `Risk-of-bias tool: ${riskOfBias.tool}`,
      '',
      ...riskOfBias.domains.map(domain => `- ${domain.label}: ${domain.rating}. ${domain.rationale}`),
      '',
      bulletList(limitations),
      '',
      '## Figure And Table Plan',
      '',
      ...figureTablePlan.tables.map(item => `- ${item.id}: ${item.title}. ${item.purpose}`),
      ...figureTablePlan.figures.map(item => `- ${item.id}: ${item.title}. ${item.purpose}`),
      '',
      '## Journal Targeting',
      '',
      `- Target style: ${journalTarget.target}`,
      `- Rationale: ${journalTarget.rationale}`,
      '',
      '## Human Review Gate',
      '',
      `- State: ${reviewState.state}`,
      `- Next action: ${reviewState.next}`,
      '',
      '## Replication And Falsification Plan',
      '',
      bulletList(replicationPlan, 'Repeat literature search, reproduce computational assumptions, and require independent domain review before claim promotion.'),
      '',
      '## Clinical Relevance Boundary',
      '',
      '- This is not medical advice.',
      '- This does not recommend diagnosis, treatment, dosing, prevention, or self-experimentation.',
      '- Any clinical interpretation requires qualified clinicians, ethics review, and appropriate regulatory context.',
      '',
      '## Data And Code Availability',
      '',
      sourceLedger
        ? `Search/source ledger is embedded in this artifact. Raw local phase data summary: ${compactJson(context.phaseResults, 1200)}`
        : 'No machine-readable source ledger was attached.',
      '',
      '## AI Assistance Disclosure',
      '',
      'SOMA generated this research-only manuscript draft using automated literature triage, local reasoning, and rule-based manuscript checks. Human expert review is required before any external scientific use.',
      '',
      '## Reporting Checklist',
      '',
      ...quality.checks.map(check => `- [${check.passed ? 'x' : ' '}] ${check.item}`),
      ''
    ].join('\n');

    const result = {
      type,
      guideline,
      quality,
      claims,
      evidenceRows,
      references,
      riskOfBias,
      citationIntegrity,
      figureTablePlan,
      journalTarget,
      reviewState,
      manuscript,
      createdAt
    };

    if (this.distillTraining && context.distillForTraining !== false) {
      try {
        result.trainingDistillation = this.trainingDistiller.recordMedicalManuscript(result, { ...context, rawText, title });
      } catch (error) {
        result.trainingDistillation = { ok: false, error: error.message };
      }
    }

    return result;
  }

  standardizeCorpus({ query, papers = [], findings = [], comparison = {}, reflection = null } = {}) {
    const rawText = [
      `Query: ${query}`,
      `Papers: ${papers.length}`,
      `Full text: ${comparison.fullTextCount || 0}`,
      `Claims: ${comparison.claimCount || 0}`,
      `Limitations: ${comparison.limitationCount || 0}`,
      `Contradictions: ${comparison.contradictionCount || 0}`,
      '',
      ...(comparison.possibleMisses || []),
      '',
      ...findings.flatMap(finding => [
        finding.title,
        ...(finding.claims || []),
        ...(finding.limitations || []),
        ...(finding.contradictions || [])
      ])
    ].join('\n');

    return this.standardize({
      type: 'literature_corpus',
      title: `SOMA Medical Evidence Map: ${query}`,
      objective: `Map the medical literature returned for "${query}" and separate claims, limitations, and cross-paper tensions.`,
      rawText,
      papers,
      findings,
      evidenceRows: this.buildEvidenceRows({ papers, findings }),
      evidenceGrade: {
        overall: comparison.fullTextCount > 0 ? 'literature evidence map' : 'abstract metadata evidence map',
        labels: []
      },
      sourceLedger: {
        query,
        searchedAt: new Date().toISOString(),
        mode: 'pubmed_pmc_ingestion',
        sourceCount: papers.length,
        ingestionScope: comparison.fullTextCount > 0 ? 'pubmed_metadata_and_pmc_open_access_full_text' : 'pubmed_metadata_and_abstracts',
        sources: papers.map((paper, index) => ({
          index: index + 1,
          title: paper.title,
          url: paper.url,
          kind: paper.fullTextAvailable ? 'pmc_open_access' : 'pubmed_abstract',
          source: paper.journal
        }))
      },
      limitations: [
        'This is an evidence map, not a systematic review.',
        'No protocol registration, duplicate screening, or formal risk-of-bias adjudication was performed.',
        'Extraction is automated and requires human verification.'
      ],
      replicationPlan: [
        'Repeat search with synonyms and MeSH terms.',
        'Manually verify extracted claims against source text.',
        'Escalate to PRISMA workflow only after protocol and inclusion criteria are defined.'
      ],
      reflection
    });
  }
}

export default MedicalManuscriptStandardizer;
