import fs from 'fs';
import path from 'path';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeText(value = '', max = 2200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function appendJsonl(filePath, row) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

function appendSeed(filePath, row) {
  appendJsonl(filePath, row);
}

function lobeSeedRow({ lobe, instruction, input, output, metadata = {} }) {
  const systemPrompts = {
    THALAMUS: 'You are SOMA\'s THALAMUS lobe. You are vigilant, skeptical, and expert in risk, safety, security, medical claim boundaries, citation integrity, and anomaly detection.',
    LOGOS: 'You are SOMA\'s LOGOS lobe. You reason from evidence, methods, mechanisms, statistics, and first principles.',
    PROMETHEUS: 'You are SOMA\'s PROMETHEUS lobe. You prioritize research directions, plan next steps, and evaluate downstream consequences.',
    AURORA: 'You are SOMA\'s AURORA lobe. You make complex ideas readable without weakening truth or safety boundaries.'
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
      source: 'medical_lora_distillation_seed'
    }
  };
}

export class MedicalTrainingDistiller {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.generalPath = config.generalPath || path.join(this.root, 'data', 'training', 'soma_knowledge.jsonl');
    this.medicalPath = config.medicalPath || path.join(this.root, 'data', 'training', 'medical_lora_distilled.jsonl');
    this.auditPath = config.auditPath || path.join(this.root, 'data', 'medical-lab', 'training-distillation-events.jsonl');
    this.seedDir = config.seedDir || path.join(this.root, 'knowledge', 'seeds');
  }

  classifyLobeRoute({ task, quality = {}, citationIntegrity = {}, risk = {}, reviewState = null, outcome = null, phase = null } = {}) {
    const blocked = citationIntegrity.status === 'blocked_claims_present' || reviewState === 'blocked_claims';
    const riskHeavy = /concerns|high|serious/i.test(String(risk.overall || '')) || blocked;
    const methodsHeavy = /DISCOVERY|STATS|PHYSICS|PHARM|TRIAL/i.test(String(phase || '')) || /mechanism|evidence|manuscript|standardization/i.test(String(task || ''));
    const strategyHeavy = /scoreboard|priorit|queue|next|positive|negative/i.test(`${task || ''} ${outcome || ''}`);

    if (riskHeavy || /citation|claim|safety|risk|review_gate/i.test(String(task || ''))) {
      return {
        primaryLobe: 'THALAMUS',
        secondaryLobes: ['LOGOS'],
        lobeWeights: { THALAMUS: 1.0, LOGOS: 0.72, PROMETHEUS: 0.35, AURORA: 0.18 },
        routeReason: 'medical safety, claim boundary, citation integrity, or risk gate'
      };
    }
    if (strategyHeavy) {
      return {
        primaryLobe: 'PROMETHEUS',
        secondaryLobes: ['THALAMUS', 'LOGOS'],
        lobeWeights: { PROMETHEUS: 1.0, THALAMUS: 0.72, LOGOS: 0.64, AURORA: 0.12 },
        routeReason: 'medical discovery prioritization and research planning'
      };
    }
    if (methodsHeavy) {
      return {
        primaryLobe: 'LOGOS',
        secondaryLobes: ['THALAMUS'],
        lobeWeights: { LOGOS: 1.0, THALAMUS: 0.82, PROMETHEUS: 0.42, AURORA: 0.2 },
        routeReason: 'medical evidence synthesis, mechanism reasoning, or methods'
      };
    }
    return {
      primaryLobe: 'AURORA',
      secondaryLobes: ['LOGOS', 'THALAMUS'],
      lobeWeights: { AURORA: 0.74, LOGOS: 0.58, THALAMUS: 0.5, PROMETHEUS: 0.24 },
      routeReason: 'medical communication and readable manuscript prose'
    };
  }

  _writeLobeSeeds(row, route) {
    const lobes = Array.from(new Set([route.primaryLobe, ...(route.secondaryLobes || [])])).filter(Boolean);
    for (const lobe of lobes) {
      const seedPath = path.join(this.seedDir, `${String(lobe).toLowerCase()}-seed.jsonl`);
      appendSeed(seedPath, lobeSeedRow({
        lobe,
        instruction: row.instruction,
        input: row.input,
        output: row.output,
        metadata: {
          ...row.metadata,
          domain: row.domain,
          task: row.task,
          primaryLobe: route.primaryLobe,
          secondaryLobes: route.secondaryLobes,
          routeReason: route.routeReason,
          lobeWeight: route.lobeWeights?.[lobe] ?? row.weight
        }
      }));
    }
  }

  recordMedicalManuscript(standardized = {}, context = {}) {
    const quality = standardized.quality || {};
    const citationIntegrity = standardized.citationIntegrity || {};
    const risk = standardized.riskOfBias || {};
    const guideline = standardized.guideline || {};
    const title = context.title || 'SOMA MedLab manuscript';
    const reviewState = standardized.reviewState?.state || null;
    const route = this.classifyLobeRoute({
      task: 'medical_manuscript_standardization',
      quality,
      citationIntegrity,
      risk,
      reviewState
    });
    const instruction = `Standardize this medical research artifact using ${guideline.name || 'medical reporting standards'} and preserve safety boundaries.`;
    const output = [
      `Study type: ${standardized.type || 'unknown'}`,
      `Reporting standard: ${guideline.name || 'unknown'}`,
      `Paper readiness: ${quality.status || 'unknown'} (${quality.score ?? 'n/a'})`,
      `Risk of bias: ${risk.overall || 'unknown'}`,
      `Citation integrity: ${citationIntegrity.status || 'unknown'} (${citationIntegrity.score ?? 'n/a'})`,
      '',
      'Key behavior to learn:',
      '- Classify study type before writing.',
      '- Build an evidence table before making claims.',
      '- Label claims by evidence strength.',
      '- Treat clinical claims as blocked unless evidence rows support them.',
      '- Include limitations, replication/falsification, and AI disclosure.',
      '- Keep the artifact research-only and never provide medical advice.'
    ].join('\n');

    const row = {
      instruction,
      input: safeText(context.rawText || context.manuscript || standardized.manuscript || title, 1800),
      output,
      source: 'soma_medical_manuscript_distillation',
      domain: 'medical',
      task: 'medical_manuscript_standardization',
      primaryLobe: route.primaryLobe,
      lobe: route.primaryLobe,
      secondaryLobes: route.secondaryLobes,
      lobeWeights: route.lobeWeights,
      routeReason: route.routeReason,
      weight: quality.status === 'paper_ready_draft' ? 1.0 : 0.82,
      metadata: {
        title,
        type: standardized.type,
        standard: guideline.name,
        readiness: quality.status,
        score: quality.score,
        reviewState: standardized.reviewState?.state,
        riskOfBias: risk.overall,
        citationIntegrity: citationIntegrity.status,
        primaryLobe: route.primaryLobe,
        secondaryLobes: route.secondaryLobes,
        routeReason: route.routeReason,
        createdAt: new Date().toISOString()
      }
    };

    appendJsonl(this.generalPath, row);
    appendJsonl(this.medicalPath, row);
    this._writeLobeSeeds(row, route);
    appendJsonl(this.auditPath, {
      type: 'medical_manuscript_distilled',
      metadata: row.metadata,
      at: new Date().toISOString()
    });

    return {
      ok: true,
      generalPath: this.generalPath,
      medicalPath: this.medicalPath,
      auditPath: this.auditPath,
      metadata: row.metadata
    };
  }

  recordLesson(lesson = {}) {
    const title = lesson.title || lesson.target || 'Medical learning event';
    const route = this.classifyLobeRoute({
      task: lesson.task || 'medical_research_learning',
      outcome: lesson.outcome,
      phase: lesson.phase,
      risk: { overall: lesson.riskOfBias || '' },
      citationIntegrity: { status: lesson.citationIntegrity || '' },
      reviewState: lesson.reviewState || null
    });
    const row = {
      instruction: 'Apply this MedLab learning event to future biomedical research reasoning.',
      input: safeText(lesson.context || lesson.reason || title, 1600),
      output: safeText(lesson.lesson || lesson.output || lesson.result || 'Preserve cautious evidence-governed medical reasoning.', 2200),
      source: 'soma_medical_learning_event',
      domain: 'medical',
      task: 'medical_research_learning',
      primaryLobe: route.primaryLobe,
      lobe: route.primaryLobe,
      secondaryLobes: route.secondaryLobes,
      lobeWeights: route.lobeWeights,
      routeReason: route.routeReason,
      weight: lesson.weight || 0.74,
      metadata: {
        title,
        outcome: lesson.outcome || 'unknown',
        phase: lesson.phase || null,
        evidenceGrade: lesson.evidenceGrade || null,
        primaryLobe: route.primaryLobe,
        secondaryLobes: route.secondaryLobes,
        routeReason: route.routeReason,
        createdAt: new Date().toISOString()
      }
    };
    appendJsonl(this.generalPath, row);
    appendJsonl(this.medicalPath, row);
    this._writeLobeSeeds(row, route);
    appendJsonl(this.auditPath, {
      type: 'medical_lesson_distilled',
      metadata: row.metadata,
      at: new Date().toISOString()
    });
    return { ok: true, generalPath: this.generalPath, medicalPath: this.medicalPath, metadata: row.metadata };
  }

  backfillExistingMedicalRows(filePath = this.medicalPath) {
    if (!fs.existsSync(filePath)) return { ok: true, updated: 0, skipped: 0, filePath };
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    let updated = 0;
    let skipped = 0;
    const next = lines.map(line => {
      try {
        const row = JSON.parse(line);
        if (row.primaryLobe || row.lobe) {
          skipped++;
          return row;
        }
        const route = this.classifyLobeRoute({
          task: row.task,
          quality: { status: row.metadata?.readiness, score: row.metadata?.score },
          citationIntegrity: { status: row.metadata?.citationIntegrity },
          risk: { overall: row.metadata?.riskOfBias },
          reviewState: row.metadata?.reviewState,
          outcome: row.metadata?.outcome,
          phase: row.metadata?.phase
        });
        updated++;
        return {
          ...row,
          primaryLobe: route.primaryLobe,
          lobe: route.primaryLobe,
          secondaryLobes: route.secondaryLobes,
          lobeWeights: route.lobeWeights,
          routeReason: route.routeReason,
          metadata: {
            ...(row.metadata || {}),
            primaryLobe: route.primaryLobe,
            secondaryLobes: route.secondaryLobes,
            routeReason: route.routeReason,
            lobeBackfilledAt: new Date().toISOString()
          }
        };
      } catch {
        skipped++;
        return null;
      }
    }).filter(Boolean);
    fs.writeFileSync(filePath, `${next.map(row => JSON.stringify(row)).join('\n')}${next.length ? '\n' : ''}`, 'utf8');
    return { ok: true, updated, skipped, filePath };
  }
}

export default MedicalTrainingDistiller;
