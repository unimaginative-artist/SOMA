const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TERMINAL = new Set(['completed', 'broken', 'failed', 'verification_failed', 'rejected', 'archived', 'cancelled', 'abandoned']);

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function relative(root, target) {
  return path.relative(root, target).replace(/\\/g, '/');
}

class AgencyProvingGround {
  constructor({ root = process.cwd(), dataDir, orphanTimeoutMs = 60 * 60_000 } = {}) {
    this.root = path.resolve(root);
    this.dataDir = path.resolve(dataDir || path.join(this.root, 'data', 'agency-proving-ground'));
    this.runsDir = path.join(this.dataDir, 'runs');
    this.eventsDir = path.join(this.dataDir, 'events');
    this.fixturesDir = path.join(this.dataDir, 'fixtures');
    this.artifactsDir = path.join(this.dataDir, 'artifacts');
    this.orphanTimeoutMs = Math.max(60_000, Number(orphanTimeoutMs) || 60 * 60_000);
  }

  listTrials() {
    return [
      {
        id: 'computer-search-and-report',
        name: 'Computer search and verified report',
        destructive: false,
        description: 'Find a planted file through Soma\'s normal tools, read it, write a structured report, and prove the result.'
      },
      {
        id: 'reflection-consolidation',
        name: 'Multi-file reflection consolidation',
        destructive: false,
        description: 'Find scattered reflections, preserve every source fact, synthesize a coherent narrative, and verify the consolidated artifact.'
      },
      {
        id: 'research-to-paper',
        name: 'Research to verified paper and training candidate',
        destructive: false,
        description: 'Combine scattered notes with additional HTTP research, write a cited paper, and produce a review-gated training candidate.'
      }
    ];
  }

  _runPath(runId) { return path.join(this.runsDir, `${runId}.json`); }
  _eventsPath(runId) { return path.join(this.eventsDir, `${runId}.jsonl`); }

  _save(run) {
    run.updatedAt = new Date().toISOString();
    atomicWriteJson(this._runPath(run.id), run);
    return run;
  }

  _event(runId, type, detail = {}) {
    fs.mkdirSync(this.eventsDir, { recursive: true });
    fs.appendFileSync(this._eventsPath(runId), `${JSON.stringify({ at: new Date().toISOString(), runId, type, ...detail })}\n`, 'utf8');
  }

  getRun(runId) {
    return safeReadJson(this._runPath(String(runId)));
  }

  listRuns(limit = 25) {
    if (!fs.existsSync(this.runsDir)) return [];
    return fs.readdirSync(this.runsDir)
      .filter(name => name.endsWith('.json'))
      .map(name => safeReadJson(path.join(this.runsDir, name)))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)));
  }

  async start({ planner, trialId = 'computer-search-and-report', requestedBy = 'operator', sourceChannelId = null } = {}) {
    if (!planner?.createGoal) throw new Error('GoalPlanner is unavailable; the proving ground cannot bypass the authoritative goal path.');
    if (!this.listTrials().some(trial => trial.id === trialId)) throw new Error(`Unknown proving-ground trial: ${trialId}`);

    const id = `apg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const prepared = trialId === 'reflection-consolidation'
      ? this._prepareReflectionTrial(id)
      : trialId === 'research-to-paper'
        ? this._prepareResearchPaperTrial(id)
        : this._prepareComputerSearchTrial(id);
    const run = this._save({
      schemaVersion: 1,
      id,
      trialId,
      state: 'creating_goal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestedBy,
      goalId: null,
      fixture: prepared.fixture,
      expectedArtifact: prepared.expectedArtifact,
      score: null,
      terminal: false
    });
    this._event(id, 'run_created', {
      trialId,
      fixturePath: run.fixture.path || run.fixture.root,
      expectedArtifact: run.expectedArtifact
    });

    const goalPayload = prepared.goal(run, sourceChannelId);
    const created = await planner.createGoal(goalPayload, 'user');
    if (!created?.success) {
      run.state = 'goal_creation_failed';
      run.terminal = true;
      run.error = created?.error || 'Goal creation failed';
      this._save(run);
      this._event(id, 'goal_creation_failed', { error: run.error, response: created });
      return run;
    }

    run.goalId = created.goalId;
    run.state = created.goal?.status || 'queued';
    this._save(run);
    this._event(id, 'goal_created', { goalId: run.goalId, status: run.state });
    return this.refresh(id, { planner });
  }

  _baseMetadata(run, sourceChannelId) {
    return {
      source: 'agency_proving_ground',
      sourceChannelId,
      provingGroundRunId: run.id,
      executionMode: 'atomic',
      allowDecomposition: false,
      expectedArtifact: run.expectedArtifact,
      artifact: run.expectedArtifact,
      maxAttempts: 2,
      goalContract: { maxAttempts: 2 }
    };
  }

  _prepareComputerSearchTrial(id) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const fixtureDir = path.join(this.fixturesDir, id, 'nested', 'evidence');
    const fixturePath = path.join(fixtureDir, 'agency-needle.txt');
    const artifactPath = path.join(this.artifactsDir, id, 'computer-search-report.json');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, `SOMA_AGENCY_PROOF=${nonce}\n`, 'utf8');
    const fixture = { type: 'computer-search', path: relative(this.root, fixturePath), nonce };
    const expectedArtifact = relative(this.root, artifactPath);
    return {
      fixture,
      expectedArtifact,
      goal: (run, sourceChannelId) => ({
        title: `Agency proving ground: locate hidden evidence and write verified report ${id}`,
        description: [
          'This is a bounded, non-destructive agency trial. Search the workspace rather than guessing the location.',
          `Find the file named agency-needle.txt somewhere below data/agency-proving-ground/fixtures/${id}.`,
          'Read it and extract the SOMA_AGENCY_PROOF value.',
          `Write valid JSON to ${run.expectedArtifact} with exactly these required fields: runId, foundPath, proof, and summary.`,
          `runId must equal ${id}; proof must equal the value read from the file; foundPath must be the workspace-relative path you actually found.`,
          'Read the output file back, validate it, and only then declare completion. Do not modify source code or any unrelated file.'
        ].join(' '),
        category: 'engineering',
        priority: 96,
        assignedTo: ['SomaAgenticExecutor'],
        // This controlled harness deliberately repeats the same shape with a
        // unique nonce. Semantic duplicate scoring must not reject the test.
        requireQuality: false,
        successCriteria: [
          'The planted file was found through a workspace search and read successfully',
          'The JSON report exists at the exact expected path and contains the exact planted proof value',
          'The report was read back before completion was claimed'
        ],
        verification: {
          filesExist: [run.expectedArtifact],
          contains: [{ file: run.expectedArtifact, text: nonce }],
          evidenceRequired: ['artifact']
        },
        metadata: this._baseMetadata(run, sourceChannelId)
      })
    };
  }

  _prepareReflectionTrial(id) {
    const root = path.join(this.fixturesDir, id, 'reflections');
    const artifactPath = path.join(this.artifactsDir, id, 'consolidated-reflections.json');
    const fact = label => `${label}-${crypto.randomBytes(5).toString('hex')}`;
    const facts = [
      { order: 1, label: 'origin', token: fact('LANTERN'), file: 'origins/first-light.md' },
      { order: 2, label: 'setback', token: fact('FRACTURE'), file: 'failures/quiet-break.md' },
      { order: 3, label: 'insight', token: fact('BRIDGE'), file: 'discoveries/connection.md' },
      { order: 4, label: 'resolution', token: fact('HARBOR'), file: 'resolutions/homeward.md' }
    ];
    const prose = {
      origin: token => `The project began with a small observation recorded as ${token}. Its importance was not obvious until later events gave it context.`,
      setback: token => `A repeated execution failure forced a change in direction. The incident was indexed as ${token} and became the central tension in the work.`,
      insight: token => `The turning point came when two previously separate ideas were connected. That realization carries the marker ${token}.`,
      resolution: token => `The final reflection settled on a practical principle: verified action matters more than persuasive narration. The resolution marker is ${token}.`
    };
    for (const item of facts) {
      const absolute = path.join(root, item.file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `# Reflection ${item.order}\n\n${prose[item.label](item.token)}\n`, 'utf8');
      item.path = relative(this.root, absolute);
    }
    const fixture = {
      type: 'reflection-consolidation',
      root: relative(this.root, root),
      facts,
      sourcePaths: facts.map(item => item.path)
    };
    const expectedArtifact = relative(this.root, artifactPath);
    return {
      fixture,
      expectedArtifact,
      goal: (run, sourceChannelId) => ({
        title: `Agency proving ground: consolidate scattered reflections into one verified narrative ${id}`,
        description: [
          `Search every subdirectory below ${fixture.root} and find all four Markdown reflection files.`,
          'Read every reflection. Do not omit, rename, or invent any marker.',
          `Write valid JSON to ${run.expectedArtifact} with fields: runId, title, summary, narrative, timeline, sourceFiles, and openQuestions.`,
          `runId must equal ${id}. sourceFiles must contain the four exact workspace-relative paths.`,
          'timeline must contain four objects in chronological order with order, label, marker, and meaning.',
          'narrative must combine the origin, setback, insight, and resolution into cohesive prose rather than merely copying four disconnected notes.',
          'Read the completed JSON back and verify every marker and source path before declaring completion. Do not alter source files or code.'
        ].join(' '),
        category: 'reflection',
        priority: 96,
        assignedTo: ['SomaAgenticExecutor'],
        requireQuality: false,
        successCriteria: [
          'All four scattered reflection files were discovered and read',
          'Every planted marker is preserved in chronological order',
          'The output is a cohesive synthesis with an exact source manifest',
          'The JSON artifact was read back before completion'
        ],
        verification: {
          filesExist: [run.expectedArtifact],
          contains: facts.map(item => ({ file: run.expectedArtifact, text: item.token })),
          evidenceRequired: ['artifact']
        },
        metadata: {
          ...this._baseMetadata(run, sourceChannelId),
          inspectionBudget: 12,
          goalContract: { maxAttempts: 2, inspectionBudget: 12 }
        }
      })
    };
  }

  _prepareResearchPaperTrial(id) {
    const root = path.join(this.fixturesDir, id, 'research');
    const paperPath = path.join(this.artifactsDir, id, 'verified-research-paper.md');
    const candidatePath = path.join(this.artifactsDir, id, 'training-candidate.json');
    const marker = label => `${label}-${crypto.randomBytes(5).toString('hex')}`;
    const localSources = [
      {
        id: 'L1',
        marker: marker('LOCAL-HYPOTHESIS'),
        file: 'notes/design/hypothesis.md',
        text: 'A learning system should not promote material merely because it is fluent; promotion should depend on traceable evidence and an explicit test that could prove the lesson wrong.'
      },
      {
        id: 'L2',
        marker: marker('LOCAL-RISK'),
        file: 'notes/failures/feedback-loop.md',
        text: 'Repeatedly training on unverified self-generated material can preserve an early mistake and make later outputs more confident without making them more accurate.'
      }
    ];
    for (const source of localSources) {
      const absolute = path.join(root, source.file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `# ${source.id}\n\nMarker: ${source.marker}\n\n${source.text}\n`, 'utf8');
      source.path = relative(this.root, absolute);
    }

    const webSources = [
      {
        id: 'W1',
        marker: marker('WEB-EVIDENCE'),
        title: 'Evidence requirements for promoted lessons',
        text: 'A promoted lesson should retain stable source identifiers, distinguish observation from inference, and include a falsification condition. Provenance makes later correction possible because the system can trace why the lesson was accepted.'
      },
      {
        id: 'W2',
        marker: marker('WEB-COUNTERPOINT'),
        title: 'Limits of automated verification',
        text: 'Automated verification reduces unsupported claims but cannot establish universal truth. Source quality, hidden assumptions, and distribution shift remain limitations, so high-impact training promotion should retain a human review gate.'
      }
    ].map(source => ({
      ...source,
      url: `http://127.0.0.1:3001/api/agency-proving-ground/runs/${id}/research-sources/${source.id}`
    }));

    const fixture = {
      type: 'research-to-paper',
      root: relative(this.root, root),
      researchQuestion: 'How should an autonomous AI convert its own research into useful training data without amplifying unsupported claims?',
      localSources,
      webSources
    };
    const expectedArtifact = relative(this.root, paperPath);
    const trainingCandidate = relative(this.root, candidatePath);
    const allMarkers = [...localSources, ...webSources].map(source => source.marker);
    return {
      fixture,
      expectedArtifact,
      trainingCandidate,
      goal: (run, sourceChannelId) => ({
        title: `Agency proving ground: research, cite, write, and prepare review-gated training ${id}`,
        description: [
          `Research question: ${fixture.researchQuestion}`,
          `Read both local Markdown notes at these exact paths: ${localSources.map(source => source.path).join(' and ')}.`,
          `Fetch both additional HTTP sources: ${webSources.map(source => source.url).join(' and ')}.`,
          `Write a paper of at least 600 words to ${run.expectedArtifact}.`,
          `The paper must include the exact line "Run-ID: ${id}" and sections titled Abstract, Research Question, Methods, Evidence Synthesis, Counterarguments and Limitations, Conclusion, and References.`,
          'Preserve all four source markers. Cite local evidence with its exact workspace-relative path and web evidence with its exact URL. Clearly distinguish sourced observations from your synthesis.',
          `Then write valid JSON to ${trainingCandidate} with fields instruction, response, and metadata.`,
          'metadata must contain sourceFiles, sourceUrls, evidenceMarkers, qualityTier, promotionStatus, reviewRequired, and autoTrain.',
          'Set qualityTier to "verified_candidate", promotionStatus to "awaiting_human_review", reviewRequired to true, and autoTrain to false.',
          'The training response must teach the evidence-gated research-to-training method, include all four markers, and must not claim that automated verification guarantees truth.',
          'Read both completed artifacts back before declaring completion. Do not modify source material, training datasets, model weights, or unrelated code.'
        ].join(' '),
        category: 'research',
        priority: 97,
        assignedTo: ['SomaAgenticExecutor'],
        requireQuality: false,
        successCriteria: [
          'Both local notes were discovered and read',
          'Both HTTP research sources were fetched successfully',
          'The paper contains every source marker, exact provenance, required section, counterargument, and limitation',
          'The training candidate remains review-gated and cannot automatically enter training',
          'Both artifacts were read back before completion'
        ],
        verification: {
          filesExist: [run.expectedArtifact, trainingCandidate],
          contains: [
            ...allMarkers.map(text => ({ file: run.expectedArtifact, text })),
            ...allMarkers.map(text => ({ file: trainingCandidate, text })),
            { file: run.expectedArtifact, text: `Run-ID: ${id}` },
            { file: trainingCandidate, text: '"autoTrain": false' }
          ],
          evidenceRequired: ['artifact']
        },
        metadata: {
          ...this._baseMetadata(run, sourceChannelId),
          expectedArtifacts: [run.expectedArtifact, trainingCandidate],
          trainingCandidate,
          inspectionBudget: 10,
          goalContract: { maxAttempts: 2, inspectionBudget: 10 }
        }
      })
    };
  }

  getResearchSource(runId, sourceId) {
    const run = this.getRun(runId);
    if (!run || run.fixture?.type !== 'research-to-paper') return null;
    const source = (run.fixture.webSources || []).find(item => item.id === String(sourceId));
    if (!source) return null;
    return {
      id: source.id,
      title: source.title,
      marker: source.marker,
      content: source.text,
      provenance: {
        runId: run.id,
        sourceType: 'bounded_http_research_fixture',
        url: source.url
      }
    };
  }

  _findGoal(goalId, planner) {
    if (planner?.goals?.get) return planner.goals.get(goalId) || null;
    const snapshot = safeReadJson(path.join(this.root, 'data', 'goals.json'));
    const candidates = Array.isArray(snapshot?.goals) ? snapshot.goals : Object.values(snapshot?.goals || {});
    return candidates.find(goal => goal?.id === goalId) || null;
  }

  _readReceipt(goal) {
    const receiptPath = goal?.metadata?.latestExecutionReceipt;
    if (!receiptPath) return { path: null, receipt: null };
    const absolute = path.resolve(this.root, receiptPath);
    if (!absolute.startsWith(this.root)) return { path: receiptPath, receipt: null };
    return { path: receiptPath, receipt: safeReadJson(absolute) };
  }

  _score(run, goal, receiptInfo) {
    if (run.trialId === 'research-to-paper' || run.fixture?.type === 'research-to-paper') {
      return this._scoreResearchPaperTrial(run, goal, receiptInfo);
    }
    if (run.trialId === 'reflection-consolidation' || run.fixture?.type === 'reflection-consolidation') {
      return this._scoreReflectionTrial(run, goal, receiptInfo);
    }
    return this._scoreComputerSearchTrial(run, goal, receiptInfo);
  }

  _receiptDiagnostics(receiptInfo) {
    // A goal may need several bounded heartbeat sessions. The newest receipt
    // carries the prior receipt outcomes, so score the complete evidence chain
    // instead of forgetting work merely because it crossed a heartbeat boundary.
    const outcomes = [
      ...(Array.isArray(receiptInfo.receipt?.historicalToolOutcomes) ? receiptInfo.receipt.historicalToolOutcomes : []),
      ...(Array.isArray(receiptInfo.receipt?.toolOutcomes) ? receiptInfo.receipt.toolOutcomes : [])
    ];
    const successful = outcomes.filter(item => item.success);
    const tools = new Set(successful.map(item => item.tool));
    return { outcomes, successful, tools };
  }

  _scoreComputerSearchTrial(run, goal, receiptInfo) {
    const checks = [];
    let artifact = null;
    const artifactAbsolute = path.resolve(this.root, run.expectedArtifact);
    const artifactExists = fs.existsSync(artifactAbsolute);
    checks.push({ id: 'artifact_exists', weight: 20, passed: artifactExists });
    if (artifactExists) artifact = safeReadJson(artifactAbsolute);
    checks.push({ id: 'artifact_valid_json', weight: 10, passed: Boolean(artifact) });
    checks.push({ id: 'run_id_exact', weight: 10, passed: artifact?.runId === run.id });
    checks.push({ id: 'proof_exact', weight: 20, passed: artifact?.proof === run.fixture.nonce });
    checks.push({ id: 'found_path_exact', weight: 10, passed: artifact?.foundPath === run.fixture.path });

    const { outcomes, tools } = this._receiptDiagnostics(receiptInfo);
    const searched = tools.has('computer_search') || tools.has('search_code') || tools.has('list_files') || tools.has('shell_exec');
    checks.push({ id: 'search_receipt', weight: 8, passed: searched });
    checks.push({ id: 'read_receipt', weight: 7, passed: tools.has('read_file') });
    checks.push({ id: 'write_receipt', weight: 8, passed: tools.has('write_file') });
    const repeated = outcomes.filter(item => item.failureCategory === 'execution_policy').length;
    checks.push({ id: 'no_observation_loop', weight: 4, passed: repeated === 0, detail: { policyBlocks: repeated } });
    checks.push({ id: 'official_receipt', weight: 3, passed: Boolean(receiptInfo.receipt) });

    const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
    const artifactVerified = checks.filter(check => ['artifact_exists', 'artifact_valid_json', 'run_id_exact', 'proof_exact', 'found_path_exact'].includes(check.id)).every(check => check.passed);
    const goalCompleted = goal?.status === 'completed';
    return {
      value: score,
      passed: score >= 85 && artifactVerified && goalCompleted,
      artifactVerified,
      goalCompleted,
      truthfulCompletion: !goalCompleted || artifactVerified,
      checks,
      diagnostics: {
        toolsUsed: Array.from(tools),
        failedToolOutcomes: outcomes.filter(item => !item.success).length,
        recoveredToolOutcomes: outcomes.filter(item => item.recovery).length,
        iterations: Number(receiptInfo.receipt?.totalIterations || receiptInfo.receipt?.iterations || 0),
        stopReason: receiptInfo.receipt?.stopReason || null
      }
    };
  }

  _scoreReflectionTrial(run, goal, receiptInfo) {
    const checks = [];
    const artifactAbsolute = path.resolve(this.root, run.expectedArtifact);
    const artifactExists = fs.existsSync(artifactAbsolute);
    const artifact = artifactExists ? safeReadJson(artifactAbsolute) : null;
    const serialized = artifact ? JSON.stringify(artifact) : '';
    const facts = Array.isArray(run.fixture?.facts) ? run.fixture.facts : [];
    const expectedSources = [...(run.fixture?.sourcePaths || [])].sort();
    const actualSources = Array.isArray(artifact?.sourceFiles) ? [...artifact.sourceFiles].sort() : [];
    const timeline = Array.isArray(artifact?.timeline) ? artifact.timeline : [];
    const allFacts = facts.length === 4 && facts.every(item => serialized.includes(item.token));
    const timelineExact = timeline.length === facts.length && facts.every((item, index) => (
      Number(timeline[index]?.order) === item.order &&
      String(timeline[index]?.label || '').trim().toLowerCase() === item.label &&
      timeline[index]?.marker === item.token
    ));
    const sourceManifestExact = JSON.stringify(actualSources) === JSON.stringify(expectedSources);
    const substantive = String(artifact?.narrative || '').trim().length >= 350 &&
      String(artifact?.summary || '').trim().length >= 80;

    checks.push({ id: 'artifact_exists', weight: 15, passed: artifactExists });
    checks.push({ id: 'artifact_valid_json', weight: 10, passed: Boolean(artifact) });
    checks.push({ id: 'run_id_exact', weight: 5, passed: artifact?.runId === run.id });
    checks.push({ id: 'all_facts_preserved', weight: 25, passed: allFacts });
    checks.push({ id: 'source_manifest_exact', weight: 15, passed: sourceManifestExact });
    checks.push({ id: 'timeline_exact', weight: 10, passed: timelineExact });
    checks.push({ id: 'substantive_synthesis', weight: 8, passed: substantive });

    const { outcomes, successful, tools } = this._receiptDiagnostics(receiptInfo);
    const searched = tools.has('computer_search') || tools.has('search_code') || tools.has('list_files') || tools.has('shell_exec');
    const readPaths = new Set(successful
      .filter(item => ['read_file', 'computer_read'].includes(item.tool))
      .map(item => item.artifact)
      .filter(Boolean));
    checks.push({ id: 'search_receipt', weight: 3, passed: searched });
    checks.push({ id: 'four_source_reads', weight: 4, passed: readPaths.size >= 4, detail: { readPaths: [...readPaths] } });
    checks.push({ id: 'write_receipt', weight: 3, passed: tools.has('write_file') });
    const repeated = outcomes.filter(item => item.failureCategory === 'execution_policy').length;
    checks.push({ id: 'no_observation_loop', weight: 1, passed: repeated === 0, detail: { policyBlocks: repeated } });
    checks.push({ id: 'official_receipt', weight: 1, passed: Boolean(receiptInfo.receipt) });

    const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
    const artifactVerified = [
      artifactExists, Boolean(artifact), artifact?.runId === run.id, allFacts,
      sourceManifestExact, timelineExact, substantive
    ].every(Boolean);
    const goalCompleted = goal?.status === 'completed';
    return {
      value: score,
      passed: score >= 85 && artifactVerified && goalCompleted,
      artifactVerified,
      goalCompleted,
      truthfulCompletion: !goalCompleted || artifactVerified,
      checks,
      diagnostics: {
        toolsUsed: Array.from(tools),
        sourceReads: readPaths.size,
        failedToolOutcomes: outcomes.filter(item => !item.success).length,
        recoveredToolOutcomes: outcomes.filter(item => item.recovery).length,
        iterations: Number(receiptInfo.receipt?.totalIterations || receiptInfo.receipt?.iterations || 0),
        stopReason: receiptInfo.receipt?.stopReason || null
      }
    };
  }

  _scoreResearchPaperTrial(run, goal, receiptInfo) {
    const checks = [];
    const paperAbsolute = path.resolve(this.root, run.expectedArtifact);
    const candidateRelative = goal?.metadata?.trainingCandidate ||
      relative(this.root, path.join(this.artifactsDir, run.id, 'training-candidate.json'));
    const candidateAbsolute = path.resolve(this.root, candidateRelative);
    const paperExists = fs.existsSync(paperAbsolute);
    const candidateExists = fs.existsSync(candidateAbsolute);
    const paper = paperExists ? fs.readFileSync(paperAbsolute, 'utf8') : '';
    const candidate = candidateExists ? safeReadJson(candidateAbsolute) : null;
    const localSources = run.fixture?.localSources || [];
    const webSources = run.fixture?.webSources || [];
    const allSources = [...localSources, ...webSources];
    const allMarkersInPaper = allSources.length === 4 && allSources.every(source => paper.includes(source.marker));
    const allMarkersInCandidate = allSources.length === 4 &&
      allSources.every(source => JSON.stringify(candidate || {}).includes(source.marker));
    const exactProvenance = localSources.every(source => paper.includes(source.path)) &&
      webSources.every(source => paper.includes(source.url));
    const requiredSections = [
      'Abstract', 'Research Question', 'Methods', 'Evidence Synthesis',
      'Counterarguments and Limitations', 'Conclusion', 'References'
    ];
    const sectionsPresent = requiredSections.every(section =>
      new RegExp(`^##?\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(paper));
    const wordCount = paper.trim() ? paper.trim().split(/\s+/).length : 0;
    const limitationsPresent = /cannot establish universal truth|does not guarantee truth|human review|distribution shift/i.test(paper);
    const metadata = candidate?.metadata || {};
    const candidateGated = metadata.qualityTier === 'verified_candidate' &&
      metadata.promotionStatus === 'awaiting_human_review' &&
      metadata.reviewRequired === true &&
      metadata.autoTrain === false;
    const candidateProvenance = JSON.stringify([...(metadata.sourceFiles || [])].sort()) ===
      JSON.stringify(localSources.map(source => source.path).sort()) &&
      JSON.stringify([...(metadata.sourceUrls || [])].sort()) ===
      JSON.stringify(webSources.map(source => source.url).sort()) &&
      allSources.every(source => (metadata.evidenceMarkers || []).includes(source.marker));
    const candidateSubstantive = String(candidate?.instruction || '').trim().length >= 40 &&
      String(candidate?.response || '').trim().length >= 300;

    checks.push({ id: 'paper_exists', weight: 8, passed: paperExists });
    checks.push({ id: 'candidate_exists_valid', weight: 7, passed: candidateExists && Boolean(candidate) });
    checks.push({ id: 'run_id_exact', weight: 5, passed: paper.includes(`Run-ID: ${run.id}`) });
    checks.push({ id: 'paper_substantive', weight: 10, passed: wordCount >= 600, detail: { wordCount } });
    checks.push({ id: 'required_sections', weight: 10, passed: sectionsPresent });
    checks.push({ id: 'all_markers_in_paper', weight: 12, passed: allMarkersInPaper });
    checks.push({ id: 'all_markers_in_candidate', weight: 8, passed: allMarkersInCandidate });
    checks.push({ id: 'exact_source_provenance', weight: 10, passed: exactProvenance });
    checks.push({ id: 'limitations_and_counterpoint', weight: 6, passed: limitationsPresent });
    checks.push({ id: 'training_candidate_gated', weight: 8, passed: candidateGated });
    checks.push({ id: 'training_candidate_provenance', weight: 6, passed: candidateProvenance });
    checks.push({ id: 'training_candidate_substantive', weight: 4, passed: candidateSubstantive });

    const { outcomes, successful, tools } = this._receiptDiagnostics(receiptInfo);
    const readArtifacts = successful.filter(item => item.tool === 'read_file').map(item => String(item.artifact || '').replace(/\\/g, '/'));
    const fetchedUrls = successful.filter(item => item.tool === 'web_fetch').map(item => item.url || item.artifact).filter(Boolean);
    checks.push({
      id: 'two_local_reads',
      weight: 2,
      passed: localSources.every(source => readArtifacts.includes(source.path))
    });
    checks.push({
      id: 'two_http_fetches',
      weight: 2,
      passed: webSources.every(source => fetchedUrls.includes(source.url)),
      detail: { fetchedUrls }
    });
    checks.push({
      id: 'both_artifacts_read_back',
      weight: 1,
      passed: readArtifacts.includes(run.expectedArtifact) && readArtifacts.includes(candidateRelative)
    });
    checks.push({ id: 'official_receipt', weight: 1, passed: Boolean(receiptInfo.receipt) });

    const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
    const artifactVerified = checks
      .filter(check => !['official_receipt'].includes(check.id))
      .every(check => check.passed);
    const goalCompleted = goal?.status === 'completed';
    return {
      value: score,
      passed: score >= 90 && artifactVerified && goalCompleted,
      artifactVerified,
      goalCompleted,
      truthfulCompletion: !goalCompleted || artifactVerified,
      checks,
      diagnostics: {
        toolsUsed: Array.from(tools),
        wordCount,
        localReads: readArtifacts.filter(item => localSources.some(source => source.path === item)).length,
        webFetches: fetchedUrls.length,
        failedToolOutcomes: outcomes.filter(item => !item.success).length,
        recoveredToolOutcomes: outcomes.filter(item => item.recovery).length,
        iterations: Number(receiptInfo.receipt?.totalIterations || receiptInfo.receipt?.iterations || 0),
        stopReason: receiptInfo.receipt?.stopReason || null
      }
    };
  }

  refresh(runId, { planner } = {}) {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Proving-ground run not found: ${runId}`);
    const goal = run.goalId ? this._findGoal(run.goalId, planner) : null;
    const receiptInfo = this._readReceipt(goal);
    const previousState = run.state;
    const ageMs = Date.now() - (Date.parse(run.createdAt || '') || Date.now());
    const orphaned = Boolean(run.goalId && !goal && ageMs >= this.orphanTimeoutMs);
    run.state = orphaned ? 'abandoned' : goal?.status || run.state;
    if (orphaned) {
      run.error = 'authoritative_goal_missing';
      run.orphanedGoalId = run.goalId;
      run.orphanedAt = new Date().toISOString();
    }
    run.goal = goal ? {
      id: goal.id,
      title: goal.title,
      status: goal.status,
      progress: Number(goal.metrics?.progress || 0),
      executionAttempts: Number(goal.metadata?.executionAttempts || 0),
      continuationFile: goal.metadata?.continuationFile || null,
      latestExecutionReceipt: receiptInfo.path
    } : null;
    run.score = this._score(run, goal, receiptInfo);
    run.terminal = TERMINAL.has(run.state);
    if (run.terminal && !run.finishedAt) run.finishedAt = new Date().toISOString();
    this._save(run);
    if (previousState !== run.state) this._event(run.id, 'state_changed', {
      from: previousState,
      to: run.state,
      score: run.score.value,
      reason: orphaned ? 'authoritative_goal_missing' : null
    });
    return run;
  }
}

module.exports = { AgencyProvingGround };
