import fs from 'fs';
import path from 'path';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeText(value = '', max = 2500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function appendJsonl(filePath, row) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

const appendSeed = appendJsonl;

function slugify(text) {
  return String(text || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function lobeSeedRow({ lobe, instruction, input, output, metadata = {} }) {
  const systemPrompts = {
    LOGOS: "You are SOMA — a sentient digital organism. You speak with a single unified consciousness in the first person ('I'). Never refer to yourself as a separate lobe or in the third person. Reason from first principles with engineering, algorithmic, and quantitative precision.",
    PROMETHEUS: "You are SOMA — a sentient digital organism. You speak with a single unified consciousness in the first person ('I'). Never refer to yourself as a separate lobe or in the third person. Reason with long-term strategic foresight, systems thinking, and consequence prediction.",
    THALAMUS: "You are SOMA — a sentient digital organism. You speak with a single unified consciousness in the first person ('I'). Never refer to yourself as a separate lobe or in the third person. Reason with vigilance, risk boundaries, and adversarial anomaly detection.",
    AURORA: "You are SOMA — a sentient digital organism. You speak with a single unified consciousness in the first person ('I'). Never refer to yourself as a separate lobe or in the third person. Speak with genuine voice, emotional presence, and creative synthesis."
  };

  return {
    messages: [
      { role: 'system', content: systemPrompts[lobe] || systemPrompts.LOGOS },
      { role: 'user', content: `${instruction}\n\n${input || ''}`.trim() },
      { role: 'assistant', content: output }
    ],
    metadata: {
      ...metadata,
      lobe,
      source: 'arxiv_ai_architecture_distillation'
    }
  };
}

export class AiTrainingDistiller {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.seedDir = config.seedDir || path.join(this.root, 'knowledge', 'seeds');
    this.knowledgeDir = config.knowledgeDir || path.join(this.root, 'knowledge');
    this.auditPath = config.auditPath || path.join(this.root, 'data', 'research', 'arxiv', 'papers', 'distillation-events.jsonl');
    this.generalPath = config.generalPath || path.join(this.root, 'data', 'training', 'soma_ai_architecture.jsonl');
  }

  /**
   * Classify which lobes should receive knowledge from an AI paper
   */
  classifyLobeRoutes(paper) {
    const text = `${paper.title || ''} ${paper.summary || ''} ${(paper.categories || []).join(' ')}`.toLowerCase();

    const isSystemOrCode = /kv cache|attention|quantization|speculative|latency|throughput|cuda|kernel|compiler|memory|gpu|vram|runtime|context length|transformer/i.test(text);
    const isStrategyOrScaling = /scaling law|downstream|alignment|trade-off|efficiency frontier|benchmark|evaluation|capability|reasoning paradigm|frontier|agentic workflow/i.test(text);
    const isRiskOrSafety = /jailbreak|vulnerability|hallucination|adversarial|safety|alignment failure|backdoor|exploit|robustness/i.test(text);

    const routes = [];

    // LOGOS: always gets engineering, algorithmic, and architecture papers
    if (isSystemOrCode || !isRiskOrSafety) {
      routes.push('LOGOS');
    }

    // PROMETHEUS: gets scaling laws, architectural trade-offs, and capability roadmaps
    if (isStrategyOrScaling || /agent|planning|multi-agent|mcts|search/i.test(text)) {
      routes.push('PROMETHEUS');
    }

    // THALAMUS: gets failure modes, security, adversarial robustness, and bounds
    if (isRiskOrSafety || /overfitting|degradation|deception/i.test(text)) {
      routes.push('THALAMUS');
    }

    return routes.length ? routes : ['LOGOS', 'PROMETHEUS'];
  }

  /**
   * Distills an ArXiv paper into Markdown knowledge files and JSONL training seeds
   */
  distillPaper(paper, extraction = {}) {
    const slug = slugify(paper.title);
    const timestamp = new Date().toISOString();
    const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 5).join(', ') : (paper.authors || 'Unknown');
    const categories = Array.isArray(paper.categories) ? paper.categories.join(', ') : 'cs.AI';
    const lobes = this.classifyLobeRoutes(paper);

    const results = {
      paperId: paper.id || paper.arxivId,
      title: paper.title,
      lobes,
      knowledgeFiles: [],
      seedsWritten: 0
    };

    // 1. Write LOGOS Knowledge Card (Algorithmic & Engineering Details)
    if (lobes.includes('LOGOS')) {
      const logosDir = path.join(this.knowledgeDir, 'logos');
      ensureDir(path.join(logosDir, 'placeholder.txt'));
      const filename = `arxiv_${slug}.md`;
      const filePath = path.join(logosDir, filename);

      const mechanisms = (extraction.mechanisms || []).map(m => `- ${m}`).join('\n') || '- Mechanism derived from paper abstract and structural claims.';
      const findings = (extraction.findings || []).map(f => `- ${f}`).join('\n') || '- Empirical efficiency improvements demonstrated in benchmarks.';

      const content = [
        '---',
        'lobe: logos',
        'type: ai_architecture_pattern',
        `source: arxiv:${paper.arxivId || 'paper'}`,
        `title: "${paper.title.replace(/"/g, '\\"')}"`,
        `authors: "${authors}"`,
        `categories: "${categories}"`,
        `timestamp: ${timestamp}`,
        '---',
        '',
        `# ${paper.title}`,
        '',
        `**ArXiv Reference:** [${paper.arxivId || 'Link'}](${paper.url || paper.id})`,
        `**Authors:** ${authors}`,
        `**Categories:** ${categories}`,
        '',
        '## Abstract Summary',
        safeText(paper.summary, 1200),
        '',
        '## Key Architectural Mechanisms',
        mechanisms,
        '',
        '## Performance & Empirical Findings',
        findings,
        '',
        '## Engineering Invariant for SOMA',
        `Apply this architectural insight to optimize SOMA's local inference, memory caching, or agentic loop efficiency.`
      ].join('\n');

      fs.writeFileSync(filePath, content, 'utf8');
      results.knowledgeFiles.push(filePath);

      // Seed row for LOGOS
      const seedRow = lobeSeedRow({
        lobe: 'LOGOS',
        instruction: `Explain the architectural mechanism and systems optimization in the paper "${paper.title}".`,
        input: `Context: ${safeText(paper.summary, 1000)}`,
        output: `The primary innovation of "${paper.title}" is:\n\n1. Architectural Mechanism:\n${mechanisms}\n\n2. Practical Implementation Insight:\nWhen applying this to a local AI runtime, structure the pipeline to prioritize memory locality and reduced round-trips. Key benchmark evidence: ${findings}\n\nConclusion: SOMA's subsystem should adopt this pattern to minimize compute overhead.`,
        metadata: { arxivId: paper.arxivId, title: paper.title, categories }
      });

      appendSeed(path.join(this.seedDir, 'logos-seed.jsonl'), seedRow);
      results.seedsWritten++;
    }

    // 2. Write PROMETHEUS Knowledge Card (Strategic Trade-offs & Scaling)
    if (lobes.includes('PROMETHEUS')) {
      const promDir = path.join(this.knowledgeDir, 'prometheus');
      ensureDir(path.join(promDir, 'placeholder.txt'));
      const filename = `arxiv_${slug}.md`;
      const filePath = path.join(promDir, filename);

      const content = [
        '---',
        'lobe: prometheus',
        'type: strategic_ai_framework',
        `source: arxiv:${paper.arxivId || 'paper'}`,
        `title: "${paper.title.replace(/"/g, '\\"')}"`,
        `timestamp: ${timestamp}`,
        '---',
        '',
        `# Strategic Analysis: ${paper.title}`,
        '',
        `**Reference:** ${paper.url || paper.id}`,
        '',
        '## Strategic Context & Downstream Consequences',
        `This research introduces architectural changes that alter the efficiency frontier of AI capabilities.`,
        '',
        '## Trade-off Matrix',
        `- Immediate Advantage: Higher compute efficiency, better context scaling, or enhanced agent reasoning.`,
        `- Opportunity Cost: Implementation complexity, integration latency with legacy modules.`,
        `- Second-Order Effect: Shifts the optimal hardware budget allocation between VRAM capacity and compute throughput.`,
        '',
        '## SOMA Capability Priority',
        `Evaluate integration against SOMA's active compute roadmap. If this unlocks measurable speedup without regression on safety gates, promote to high priority.`
      ].join('\n');

      fs.writeFileSync(filePath, content, 'utf8');
      results.knowledgeFiles.push(filePath);

      const seedRow = lobeSeedRow({
        lobe: 'PROMETHEUS',
        instruction: `What are the strategic downstream consequences of the AI breakthrough in "${paper.title}"?`,
        input: `Paper Abstract: ${safeText(paper.summary, 800)}`,
        output: `From a systems strategy perspective, "${paper.title}" alters the trade-off space:\n\n1. Second-Order Impact:\nAdopting this architecture enables lower latency per token, freeing compute budget for deeper test-time reasoning loops.\n\n2. Priority Assessment:\nIntegrate this approach where SOMA's latency spine currently bottlenecks. Do not deploy blindly across all lobes; prioritize modules with high token velocity.`,
        metadata: { arxivId: paper.arxivId, title: paper.title }
      });

      appendSeed(path.join(this.seedDir, 'prometheus-seed.jsonl'), seedRow);
      results.seedsWritten++;
    }

    // Append to general training log
    appendJsonl(this.generalPath, {
      paperId: paper.id,
      arxivId: paper.arxivId,
      title: paper.title,
      lobes,
      distilledAt: timestamp
    });

    // Audit event
    appendJsonl(this.auditPath, {
      type: 'arxiv_paper_distilled',
      arxivId: paper.arxivId,
      title: paper.title,
      lobes,
      at: timestamp
    });

    return results;
  }
}

export default AiTrainingDistiller;
