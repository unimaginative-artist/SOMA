import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  actionDeadlineState,
  evidenceProgress,
  inspectionSignature,
  repeatedInspectionCount
} from '../core/AgenticExecutionPolicy.js';
import { MissionControlRuntime } from '../server/finance/MissionControlRuntime.js';
import {
  artifactPathMatches,
  goalAllowsMutationPath,
  goalAllowsTool,
  nextContractedWorkflowTool,
  SomaAgenticExecutor,
  selectArtifactProductionRecovery,
  selectDistinctInspectionRecovery
} from '../core/SomaAgenticExecutor.js';
import {
  OfflineStrategyEvolutionLab,
  evaluateWalkForward,
  mutateCandidate
} from '../server/finance/OfflineStrategyEvolutionLab.js';
import { backtestBars, CompiledStrategyBacktester, evaluateCompiledStrategyDecision } from '../server/finance/CompiledStrategyBacktester.js';
import {
  ALPACA_CRYPTO_FEES,
  enforceVenueCompatibility,
  TRADING_ECONOMICS_VERSION
} from '../server/finance/TradingResearchPolicy.js';
const require = createRequire(import.meta.url);
const { buildQualityReport } = require('../core/GoalQualityGate.cjs');
const GoalPlannerArbiter = require('../arbiters/GoalPlannerArbiter.cjs');
const AutonomousHeartbeat = require('../server/services/AutonomousHeartbeat.cjs');
const ROOT = process.cwd();

test('compiled backtester loads both wrapped and top-level historical bar arrays', async () => {
  const cacheDir = path.join(ROOT, 'data', 'test-historical-cache', `${process.pid}-${Date.now()}`);
  await fs.mkdir(cacheDir, { recursive: true });
  try {
    const bars = Array.from({ length: 120 }, (_, index) => ({ timestamp: index, close: 100 + index }));
    await fs.writeFile(path.join(cacheDir, 'BTC-USD_1H.json'), JSON.stringify(bars));
    const backtester = new CompiledStrategyBacktester({ cacheDir });
    const loaded = await backtester.loadBars('BTC', '1H');
    assert.equal(loaded.bars.length, 120);
    assert.equal(loaded.timeframe, '1H');
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

function observation(tool, args = {}, result = { success: true }) {
  return { tool, args, effectiveArgs: args, result, outcome: { ok: !result.error } };
}

test('inspection policy blocks substantially identical reads after two calls', () => {
  const first = observation('read_file', { path: 'core/Foo.js', startLine: 1, endLine: 100 }, { content: 'x' });
  const second = observation('read_file', { path: 'core\\Foo.js', startLine: 1, maxLines: 100 }, { content: 'x' });
  assert.equal(inspectionSignature(first.tool, first.args), inspectionSignature(second.tool, second.args));
  assert.equal(repeatedInspectionCount([first, second], 'read_file', first.args), 2);
  assert.equal(repeatedInspectionCount([first, second], 'read_file', { path: 'core/Foo.js', startLine: 301, endLine: 400 }), 0);
});

test('successful state changes reset stale inspection repetition', () => {
  const read = observation('read_file', { path: 'data/new.md' }, { content: 'old' });
  const write = observation('write_file', { path: 'data/new.md', content: 'new' }, { success: true, path: 'data/new.md' });
  assert.equal(repeatedInspectionCount([read, read], 'read_file', read.args), 2);
  assert.equal(repeatedInspectionCount([read, read, write], 'read_file', read.args), 0);
  assert.equal(repeatedInspectionCount([read, read, write, read], 'read_file', read.args), 1);
});

test('artifact path matching reconciles relative tool results with absolute contracts', () => {
  const expected = path.join(ROOT, 'data', 'autonomous-missions', 'proof', 'result.md');
  assert.equal(artifactPathMatches(expected, 'data\\autonomous-missions\\proof\\result.md'), true);
  assert.equal(artifactPathMatches(expected, 'data/elsewhere/result.md'), false);
});

test('a bounded mission recovers a missing output directory by searching goal-grounded code', () => {
  const goal = {
    title: 'Autonomous mission: Recover research-to-paper verification_failed handling',
    description: 'Inspect research-to-paper and verification_failed implementation paths.',
    metadata: {
      autonomousMission: true,
      expectedArtifact: path.join(ROOT, 'data', 'autonomous-missions', 'new', 'result.md')
    }
  };
  const recovery = selectDistinctInspectionRecovery(goal, [
    observation('list_files', { directory: 'autonomous-missions/new' }, { error: 'ENOENT' })
  ]);
  assert.equal(recovery.tool, 'search_code');
  assert.equal(recovery.reason, 'recover_missing_mission_path_with_grounded_code_search');
  assert.match(recovery.args.pattern, /research-to-paper|verification_failed/);
});

test('autonomous file discovery skips environment and key material', () => {
  const recovery = selectDistinctInspectionRecovery({
    title: 'Autonomous mission: inspect loader behavior',
    metadata: { autonomousMission: true }
  }, [
    observation('list_files', { directory: '.' }, {
      path: '.',
      files: [
        { name: '.env', type: 'file' },
        { name: 'credentials.json', type: 'file' },
        { name: 'private.pem', type: 'file' },
        { name: 'loader.js', type: 'file' }
      ]
    })
  ]);
  assert.equal(recovery.tool, 'read_file');
  assert.equal(recovery.args.path, './loader.js');
});

test('artifact deadline survives checkpoint sessions and resets only after real work', () => {
  const priorSessionReads = Array.from({ length: 6 }, (_, index) => (
    observation('read_file', { path: `core/source-${index}.js` }, { content: `source ${index}` })
  ));
  assert.equal(actionDeadlineState(priorSessionReads, { maxInspectionActions: 6 }).reached, true);

  const nextSessionRead = observation('search_code', { pattern: 'next' }, { matches: [] });
  assert.equal(actionDeadlineState([...priorSessionReads, nextSessionRead], { maxInspectionActions: 6 }).reached, true);

  const write = observation('write_file', { path: 'data/result.md', content: 'result' }, {
    success: true,
    path: 'data/result.md'
  });
  const afterWrite = actionDeadlineState([...priorSessionReads, write], { maxInspectionActions: 6 });
  assert.equal(afterWrite.reached, false);
  assert.equal(afterWrite.inspectionActions, 0);
});

test('bounded autonomous investigations deterministically produce and read back their artifact', async () => {
  const artifact = path.join(ROOT, 'data', `mission-recovery-${Date.now()}.md`);
  const goal = {
    title: 'Autonomous mission: diagnose a loader failure',
    description: `Inspect a loader failure and produce a bounded evidence report.

This mission was selected autonomously under Owner’s standing mission charter.
The report must cite evidence; placeholder paths and TODO prose do not count.`,
    metadata: { autonomousMission: true, expectedArtifact: artifact }
  };
  const evidence = [
    observation('read_file', { path: 'core/A.js' }, { path: 'core/A.js', content: 'source A' }),
    observation('search_code', { pattern: 'logger.success' }, { matches: [] }),
    observation('read_file', { path: 'core/B.js' }, { path: 'core/B.js', content: 'source B' })
  ];
  const write = selectArtifactProductionRecovery(goal, evidence);
  assert.equal(write.tool, 'write_file');
  assert.equal(write.args.path, artifact);
  assert.match(write.args.content, /Evidence inspected/);
  assert.doesNotMatch(write.args.content, /\bTODO\b/);
  await fs.writeFile(artifact, write.args.content, 'utf8');
  const afterWrite = [
    ...evidence,
    observation('write_file', { path: artifact, content: write.args.content }, { success: true, path: artifact })
  ];
  const readBack = selectArtifactProductionRecovery(goal, afterWrite);
  assert.equal(readBack.tool, 'read_file');
  assert.equal(readBack.args.path, artifact);
  await fs.unlink(artifact);
});

test('bounded mission recovery replaces placeholder reports with revision-safe evidence', async () => {
  const artifact = path.join(ROOT, 'data', `mission-placeholder-${Date.now()}.md`);
  const placeholder = '# Report\n\nTODO: evidence is at path/to/evidence.md and work will be taken later.';
  await fs.writeFile(artifact, placeholder, 'utf8');
  const hash = (await import('node:crypto')).createHash('sha256').update(placeholder).digest('hex');
  const goal = {
    title: 'Autonomous mission: AbstractionArbiter repair',
    description: 'Diagnose the AbstractionArbiter loader failure with concrete evidence.',
    metadata: { autonomousMission: true, expectedArtifact: artifact }
  };
  const observations = [
    observation('read_file', { path: 'arbiters/AbstractionArbiter.js' }, { path: 'arbiters/AbstractionArbiter.js', content: 'class AbstractionArbiter {}' }),
    observation('search_code', { pattern: 'logger.success' }, { matches: [] }),
    observation('read_file', { path: 'core/BaseArbiter.cjs' }, { path: 'core/BaseArbiter.cjs', content: 'logger.info' }),
    observation('read_file', { path: artifact }, { path: artifact, content: placeholder, contentHash: hash })
  ];
  const recovery = selectArtifactProductionRecovery(goal, observations);
  assert.equal(recovery.tool, 'write_file');
  assert.equal(recovery.args.expectedHash, hash);
  assert.doesNotMatch(recovery.args.content, /path\/to/);
  assert.match(recovery.args.content, /Evidence-backed finding/);
  await fs.unlink(artifact);
});

test('bounded mission recovery does not treat its own artifact as evidence and grounds the investigation in code', async () => {
  const artifact = path.join(ROOT, 'data', `mission-self-citation-${Date.now()}.md`);
  const placeholder = '# Report\n\nTODO: inspect actual sources.';
  await fs.writeFile(artifact, placeholder, 'utf8');
  const goal = {
    title: 'Autonomous mission: diagnose source verification',
    description: 'Diagnose source verification using concrete implementation evidence.',
    metadata: { autonomousMission: true, expectedArtifact: artifact }
  };
  const observations = [
    observation('list_files', { directory: '.' }, { path: '.', files: [] }),
    observation('list_files', { directory: 'data' }, { path: 'data', files: [] }),
    observation('list_files', { directory: path.dirname(artifact) }, { path: path.dirname(artifact), files: [] }),
    observation('read_file', { path: artifact }, { path: artifact, content: placeholder, contentHash: 'old' }),
    observation('read_file', { path: artifact }, { path: artifact, content: placeholder, contentHash: 'old' })
  ];
  const recovery = selectArtifactProductionRecovery(goal, observations);
  assert.equal(recovery.tool, 'search_code');
  assert.equal(recovery.reason, 'ground_bounded_mission_in_substantive_code_evidence');
  assert.notEqual(recovery.args.pattern.toLowerCase(), 'autonomous');
  await fs.unlink(artifact);
});

test('stale bounded mission revisions force a fresh read before another write', async () => {
  const artifact = path.join(ROOT, 'data', `mission-stale-${Date.now()}.md`);
  const placeholder = '# Report\n\nTODO: replace this placeholder.';
  await fs.writeFile(artifact, placeholder, 'utf8');
  const goal = {
    title: 'Autonomous mission: diagnose stale revisions',
    description: 'Diagnose stale revisions using concrete implementation evidence.',
    metadata: { autonomousMission: true, expectedArtifact: artifact }
  };
  const observations = [
    observation('read_file', { path: 'core/A.js' }, { path: 'core/A.js', content: 'source A' }),
    observation('search_code', { pattern: 'revision' }, { matches: [{ path: 'core/B.js' }] }),
    observation('read_file', { path: 'core/B.js' }, { path: 'core/B.js', content: 'source B' }),
    observation('read_file', { path: artifact }, { path: artifact, content: placeholder, contentHash: 'stale-hash' }),
    {
      ...observation('write_file', { path: artifact, content: 'replacement', expectedHash: 'stale-hash' }, {
        path: artifact,
        error: 'write_file failed: STALE_CONTENT_REVISION'
      }, false),
      outcome: {
        ok: false,
        code: 'STALE_CONTENT_REVISION',
        message: 'STALE_CONTENT_REVISION: the file changed after it was read'
      }
    }
  ];
  const recovery = selectArtifactProductionRecovery(goal, observations);
  assert.equal(recovery.tool, 'read_file');
  assert.equal(recovery.args.path, artifact);
  assert.equal(recovery.reason, 'refresh_stale_bounded_mission_artifact_revision');
  await fs.unlink(artifact);
});

test('bounded missions execute explicitly requested local delegation after artifact readback', async () => {
  const artifact = path.join(ROOT, 'data', `mission-delegation-${Date.now()}.md`);
  const report = `# Agent benchmark

## Evidence inspected
core/SomaAgenticExecutor.js and tests/agentic-execution-hardening.test.mjs were inspected.

## Evidence-backed finding
The engineering agents need a bounded benchmark with explicit verification.

## Verification status
The report exists and has concrete source provenance. ${'verified '.repeat(90)}`;
  await fs.writeFile(artifact, report, 'utf8');
  const goal = {
    id: 'delegation-mission',
    title: 'Autonomous mission: benchmark engineering agents',
    description: 'Delegate researcher, coder, tester, and reviewer roles to build an engineering benchmark.',
    allowedTools: ['read_file', 'write_file', 'search_code', 'spawn_agents'],
    metadata: {
      autonomousMission: true,
      expectedArtifact: artifact,
      allowedTools: ['read_file', 'write_file', 'search_code', 'spawn_agents']
    }
  };
  const observations = [
    observation('search_code', { pattern: 'agentic' }, { matches: ['core/SomaAgenticExecutor.js:1'] }),
    observation('search_code', { pattern: 'benchmark' }, { matches: ['tests/agentic-execution-hardening.test.mjs:1'] }),
    observation('write_file', { path: artifact, content: report }, { success: true, path: artifact }),
    observation('read_file', { path: artifact }, { path: artifact, content: report, contentHash: 'hash' })
  ];
  const recovery = selectArtifactProductionRecovery(goal, observations);
  assert.equal(recovery.tool, 'spawn_agents');
  assert.equal(recovery.reason, 'execute_contracted_local_delegation');
  assert.deepEqual(recovery.args.roles, ['researcher', 'coder', 'tester', 'reviewer']);
  await fs.unlink(artifact);
});

test('verified proving-ground reads advance deterministically to the required artifact', () => {
  const runId = `apg-test-${Date.now()}`;
  const expectedArtifact = `data/agency-proving-ground/artifacts/${runId}/computer-search-report.json`;
  const recovery = selectArtifactProductionRecovery({
    metadata: { provingGroundRunId: runId, expectedArtifact }
  }, [observation('read_file', { path: `data/fixtures/${runId}/agency-needle.txt` }, {
    path: `data\\fixtures\\${runId}\\agency-needle.txt`,
    content: 'SOMA_AGENCY_PROOF=abcdef123456\n'
  })]);
  assert.equal(recovery.tool, 'write_file');
  const parsed = JSON.parse(recovery.args.content);
  assert.equal(parsed.runId, runId);
  assert.equal(parsed.proof, 'abcdef123456');
  assert.match(parsed.foundPath, /agency-needle\.txt$/);
});

test('four verified research sources advance to a sourced paper artifact', () => {
  const runId = `apg-research-${Date.now()}`;
  const recovery = selectArtifactProductionRecovery({ metadata: {
    provingGroundRunId: runId,
    expectedArtifact: `data/agency-proving-ground/artifacts/${runId}/paper.md`,
    trainingCandidate: `data/agency-proving-ground/artifacts/${runId}/candidate.json`
  } }, [
    observation('read_file', { path: 'research/a.md' }, { path: 'research/a.md', content: 'LOCAL-HYPOTHESIS-a1b2c3 evidence one' }),
    observation('read_file', { path: 'research/a.md' }, { path: 'research\\a.md', content: 'LOCAL-HYPOTHESIS-a1b2c3 evidence one' }),
    observation('read_file', { path: 'research/b.md' }, { path: 'research/b.md', content: 'LOCAL-RISK-d4e5f6 evidence two' }),
    observation('web_fetch', { url: 'http://example.test/W1' }, { content: JSON.stringify({ source: { marker: 'WEB-EVIDENCE-aabbcc', content: 'web one', provenance: { url: 'http://example.test/W1' } } }) }),
    observation('web_fetch', { url: 'http://example.test/W2' }, { content: JSON.stringify({ source: { marker: 'WEB-COUNTERPOINT-ddeeff', content: 'web two', provenance: { url: 'http://example.test/W2' } } }) })
  ]);
  assert.equal(recovery.tool, 'write_file');
  assert.match(recovery.args.content, new RegExp(`Run-ID: ${runId}`));
  assert.match(recovery.args.content, /Counterarguments and Limitations/);
  assert.match(recovery.args.content, /LOCAL-RISK-d4e5f6/);
  assert.ok(recovery.args.content.split(/\s+/).length >= 600);
});

test('completed research artifacts are read back after their writes before completion', async () => {
  const runId = `apg-research-readback-${process.pid}-${Date.now()}`;
  const directory = `data/agency-proving-ground/artifacts/${runId}`;
  const expectedArtifact = `${directory}/paper.md`;
  const trainingCandidate = `${directory}/candidate.json`;
  await fs.mkdir(path.join(ROOT, directory), { recursive: true });
  await fs.writeFile(path.join(ROOT, expectedArtifact), `Run-ID: ${runId}\nLOCAL-HYPOTHESIS-a1b2c3 LOCAL-RISK-d4e5f6 WEB-EVIDENCE-aabbcc WEB-COUNTERPOINT-ddeeff`, 'utf8');
  await fs.writeFile(path.join(ROOT, trainingCandidate), '{}', 'utf8');
  const observations = [
    observation('read_file', { path: 'research/a.md' }, { path: 'research/a.md', content: 'LOCAL-HYPOTHESIS-a1b2c3 evidence one' }),
    observation('read_file', { path: 'research/b.md' }, { path: 'research/b.md', content: 'LOCAL-RISK-d4e5f6 evidence two' }),
    observation('web_fetch', { url: 'http://example.test/W1' }, { url: 'http://example.test/W1', content: JSON.stringify({ source: { marker: 'WEB-EVIDENCE-aabbcc' } }) }),
    observation('web_fetch', { url: 'http://example.test/W2' }, { url: 'http://example.test/W2', content: JSON.stringify({ source: { marker: 'WEB-COUNTERPOINT-ddeeff' } }) }),
    observation('write_file', { path: expectedArtifact }, { success: true, path: expectedArtifact }),
    observation('write_file', { path: trainingCandidate }, { success: true, path: trainingCandidate }),
    observation('read_file', { path: trainingCandidate }, { path: trainingCandidate, content: '{}' })
  ];
  try {
    const recovery = selectArtifactProductionRecovery({ metadata: {
      provingGroundRunId: runId,
      expectedArtifact,
      trainingCandidate
    } }, observations);
    assert.equal(recovery.tool, 'read_file');
    assert.equal(recovery.args.path, expectedArtifact);
    assert.equal(recovery.reason, 'read_back_completed_research_paper');
  } finally {
    await fs.rm(path.join(ROOT, directory), { recursive: true, force: true });
  }
});

test('progress is earned from artifacts and proof rather than tool-call volume', () => {
  const repeatedReads = Array.from({ length: 12 }, () => observation('read_file', { path: 'core/Foo.js', startLine: 1, endLine: 100 }, { content: 'x' }));
  const readOnly = evidenceProgress(repeatedReads);
  assert.equal(readOnly.uniqueInspections, 1);
  assert.equal(readOnly.progress, 5);
  assert.equal(actionDeadlineState(repeatedReads).reached, true);

  const withArtifact = evidenceProgress([
    ...repeatedReads,
    observation('write_file', { path: 'data/result.json' }, { success: true, path: 'data/result.json' })
  ]);
  assert.ok(withArtifact.progress >= 45);
  assert.equal(withArtifact.hasArtifactAction, true);

  const withProof = evidenceProgress([
    ...repeatedReads,
    observation('write_file', { path: 'data/result.json' }, { success: true, path: 'data/result.json' }),
    observation('run_tests', { testFile: 'tests/result.test.mjs' }, { passed: true })
  ]);
  assert.ok(withProof.progress >= 78);
  assert.equal(withProof.hasExecutableProof, true);
});

test('bounded multi-source goals can contract for a larger inspection budget', () => {
  const observations = Array.from({ length: 9 }, (_, index) => observation(
    index < 5 ? 'list_files' : 'read_file',
    index < 5 ? { directory: `data/source-${index}` } : { path: `data/source-${index}.md` },
    index < 5 ? { files: [`source-${index}.md`] } : { content: `source ${index}` }
  ));
  assert.equal(actionDeadlineState(observations).reached, true);
  assert.equal(actionDeadlineState(observations, { maxInspectionActions: 12 }).reached, false);
});

test('strict child contracts enforce both tool and mutation-path scopes', () => {
  const goal = {
    metadata: {
      goalContract: {
        strict: true,
        allowedTools: ['read_file', 'write_file'],
        allowedWritePaths: ['data/self-improvement/parent/step-1.json']
      }
    }
  };
  assert.equal(goalAllowsTool(goal, 'write_file'), true);
  assert.equal(goalAllowsTool(goal, 'modify_code'), false);
  assert.equal(
    goalAllowsMutationPath(goal, 'write_file', { path: 'data/self-improvement/parent/step-1.json' }).allowed,
    true
  );
  assert.equal(
    goalAllowsMutationPath(goal, 'write_file', { path: 'data/unrelated.json' }).allowed,
    false
  );
});

test('bounded goals are not told to delegate when spawn_agents is outside their tool contract', () => {
  const executor = new SomaAgenticExecutor();
  executor.initialize({});
  const goal = {
    title: 'Analyze several reports and write one bounded artifact',
    description: 'Inspect local evidence and create a report.',
    category: 'research',
    priority: 100,
    metadata: {
      allowedTools: ['list_files', 'read_file', 'write_file'],
      expectedArtifact: 'Artifacts/bounded-report.md',
      successCriteria: ['Artifact exists']
    }
  };
  const prompt = executor._buildPrompt(goal, [], [], null, {});
  assert.match(prompt, /DOMAIN TOOL CONTRACT/);
  assert.doesNotMatch(prompt, /DELEGATION REQUIREMENT/);
});

test('enforced bounded workflows advance through exact tool steps despite model drift', () => {
  const goal = {
    metadata: {
      allowedTools: ['read_file', 'write_file'],
      workflow: {
        enforce: true,
        toolPlan: [
          { tool: 'read_file', args: { path: 'data/first.json' } },
          { tool: 'read_file', args: { path: 'data/second.json' } }
        ]
      }
    }
  };
  assert.deepEqual(nextContractedWorkflowTool(goal, []), {
    tool: 'read_file', args: { path: 'data/first.json' }, reason: 'enforced_goal_workflow'
  });
  const observations = [observation('read_file', { path: 'data\\first.json' }, { content: '{}' })];
  assert.deepEqual(nextContractedWorkflowTool(goal, observations), {
    tool: 'read_file', args: { path: 'data/second.json' }, reason: 'enforced_goal_workflow'
  });
  observations.push(observation('read_file', { path: 'data/second.json' }, { content: '{}' }));
  assert.equal(nextContractedWorkflowTool(goal, observations), null);
});

test('absolute goal scopes authorize equivalent workspace-relative mutation paths', () => {
  const diagnosticsRoot = path.join(ROOT, 'data', 'self-evolution', 'diagnostics');
  const goal = {
    metadata: {
      allowedWritePaths: [diagnosticsRoot],
      goalContract: { strict: true, allowedTools: ['write_file'] }
    }
  };
  assert.equal(
    goalAllowsMutationPath(goal, 'write_file', {
      path: 'data/self-evolution/diagnostics/planning-cycle.md'
    }).allowed,
    true
  );
  assert.equal(
    goalAllowsMutationPath(goal, 'write_file', { path: 'data/outside.md' }).allowed,
    false
  );
});

test('atomic goal contracts cannot be reinterpreted by decomposition', async () => {
  const dataDir = path.join(ROOT, 'data', 'test-atomic-goal', `${process.pid}-${Date.now()}`);
  await fs.mkdir(dataDir, { recursive: true });
  const planner = new GoalPlannerArbiter({ dataDir });
  const goal = {
    id: 'atomic-fixture',
    title: 'Run a detailed bounded verification procedure',
    description: 'A '.repeat(600),
    status: 'pending', tasks: [],
    metadata: { executionMode: 'atomic', allowDecomposition: false }
  };
  planner.goals.set(goal.id, goal);
  try {
    assert.equal(planner._isComplexGoal(goal), false);
    assert.deepEqual(await planner.decomposeGoal(goal.id, 'test'), {
      success: false, skipped: true, reason: 'atomic_goal_contract'
    });
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('terminal broken or blocked goals remain evidence but do not block a corrected retry', () => {
  const candidate = {
    title: 'Agency proving ground locate hidden evidence',
    description: 'Find a bounded fixture and write a verified JSON artifact for the operator.',
    category: 'engineering',
    successCriteria: ['Artifact exists'],
    verification: { filesExist: ['data/proof.json'] }
  };
  const quality = buildQualityReport(candidate, [{ ...candidate, id: 'old', status: 'broken' }]);
  assert.equal(quality.approved, true);
  assert.equal(quality.duplicateGoalId, null);
  const blocked = buildQualityReport(candidate, [{ ...candidate, id: 'old-blocked', status: 'blocked' }]);
  assert.equal(blocked.approved, true);
  assert.equal(blocked.duplicateGoalId, null);
});

test('agency proving-ground goals retain operator priority over background work', () => {
  const planner = new GoalPlannerArbiter({ maxActiveGoals: 8 });
  const background = {
    id: 'background', title: 'Background curiosity', description: '', category: 'research',
    status: 'active', priority: 99, createdAt: 1, startedAt: 1, metadata: { source: 'autonomous' }
  };
  const proving = {
    id: 'proving', title: 'Agency proving ground task', description: '', category: 'reflection',
    status: 'active', priority: 60, createdAt: 2, startedAt: 2, metadata: { source: 'agency_proving_ground' }
  };
  planner.goals.set(background.id, background);
  planner.goals.set(proving.id, proving);
  planner.activeGoals.add(background.id);
  planner.activeGoals.add(proving.id);
  try {
    assert.equal(planner.getExecutionFocus()?.id, proving.id);
    const reconciliation = planner.reconcileExecutionFocus();
    assert.equal(reconciliation.focusedGoalId, proving.id);
    assert.equal(background.status, 'pending');
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
  }
});

test('goal history compaction archives duplicates and bounds retained terminal/deferred goals', async () => {
  const dataDir = path.join(ROOT, 'data', 'test-goal-compaction', `${process.pid}-${Date.now()}`);
  await fs.mkdir(dataDir, { recursive: true });
  const planner = new GoalPlannerArbiter({ dataDir, maxActiveGoals: 8 });
  const makeGoal = (id, title, status, createdAt) => ({
    id, title, description: title, category: 'engineering', status, priority: 50,
    createdAt, completedAt: createdAt, metrics: { progress: 5 }, metadata: { source: 'autonomous' },
    assignedTo: [], tasks: [], dependencies: [], prerequisites: []
  });
  const now = Date.now();
  for (let index = 0; index < 4; index++) {
    const goal = makeGoal(`duplicate-${index}`, 'Measure current cognition pipeline baseline', 'broken', now - index);
    planner.goals.set(goal.id, goal);
  }
  for (let index = 0; index < 34; index++) {
    const goal = makeGoal(`terminal-${index}`, `Unique terminal goal ${index}`, 'broken', now - 100 - index);
    planner.goals.set(goal.id, goal);
  }
  for (let index = 0; index < 16; index++) {
    const goal = makeGoal(`deferred-${index}`, `Unique deferred goal ${index}`, 'deferred', now - 200 - index);
    planner.goals.set(goal.id, goal);
  }

  try {
    const history = planner.compactDuplicateAndTerminalGoals({ now, maxTerminalRetained: 25 });
    const deferred = planner.compactDeferredGoals({ now, maxRetained: 10, olderThanMs: 365 * 24 * 60 * 60_000 });
    assert.ok(history.archived >= 12);
    assert.equal(deferred.archived, 6);
    assert.ok(history.path);
    assert.ok(deferred.path);
    assert.ok((await fs.stat(history.path)).size > 0);
    assert.equal(Array.from(planner.goals.values()).filter(goal => goal.status === 'deferred').length, 10);
    assert.ok(Array.from(planner.goals.values()).filter(goal => ['broken', 'failed', 'verification_failed', 'rejected'].includes(goal.status)).length <= 25);
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('terminal Discord reports are sent exactly once with receipt evidence', async () => {
  const sent = [];
  const goal = {
    id: 'discord-terminal-fixture',
    title: 'Build a verified artifact',
    status: 'broken',
    source: 'discord_admin',
    metadata: {
      source: 'discord_admin', sourceChannelId: '123',
      lastTransition: { reason: 'artifactless_sessions_exhausted' },
      latestExecutionReceipt: 'data/goal-receipts/example.json'
    }
  };
  const heartbeat = new AutonomousHeartbeat({
    discordArbiter: { sendMessage: async payload => { sent.push(payload); return { success: true, messageId: 'posted-1' }; } },
    goalPlanner: { _saveToDisk() {} },
    ws: { broadcast() {} }
  }, {});
  const first = await heartbeat._reportGoalTerminal(goal, { execResult: { result: 'No artifact was produced.' } });
  const second = await heartbeat._reportGoalTerminal(goal, { execResult: { result: 'No artifact was produced.' } });
  assert.equal(first.reported, true);
  assert.equal(second.reason, 'already_reported');
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /artifactless_sessions_exhausted/);
  assert.match(sent[0].message, /goal-receipts\/example\.json/);
});

test('blocked Discord goals receive a terminal report instead of disappearing', async () => {
  const sent = [];
  const goal = {
    id: 'discord-blocked-fixture', title: 'Inspect the goal loop', status: 'blocked', source: 'discord_admin',
    metadata: { source: 'discord_admin', sourceChannelId: '123', lastTransition: { reason: 'execution_attempt_budget_exhausted' } }
  };
  const heartbeat = new AutonomousHeartbeat({
    discordArbiter: { sendMessage: async payload => { sent.push(payload); return { success: true, messageId: 'posted-2' }; } },
    goalPlanner: { _saveToDisk() {} }, ws: { broadcast() {} }
  }, {});
  const result = await heartbeat._reportGoalTerminal(goal, { execResult: { stopReason: 'max_attempts_reached' } });
  assert.equal(result.reported, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /blocked/);
  assert.match(sent[0].message, /execution_attempt_budget_exhausted/);
});

test('failed Discord delivery does not mark a terminal goal as reported', async () => {
  const goal = { id: 'undelivered-goal', title: 'Inspect architecture', status: 'blocked',
    metadata: { sourceChannelId: '123', lastTransition: { reason: 'execution_attempt_budget_exhausted' } } };
  const heartbeat = new AutonomousHeartbeat({
    discordArbiter: { sendMessage: async () => ({ success: false }) },
    goalPlanner: { _saveToDisk() {} }, ws: { broadcast() {} }
  }, {});
  const result = await heartbeat._reportGoalTerminal(goal);
  assert.equal(result.reported, false);
  assert.equal(goal.metadata.terminalReportSent, undefined);
});

test('Mission Control hydrates candidate safety metrics from the all-time SQLite ledger', () => {
  const runtime = new MissionControlRuntime();
  let observedSince = null;
  runtime.tradeLogger = {
    db: {},
    getClosedTrades(_days, { since } = {}) {
      observedSince = since;
      return [
        { status: 'closed', strategy: 'full_aggression', symbol: 'ETH-USD', pnl: 5 },
        { status: 'closed', strategy: 'full_aggression', symbol: 'ETH-USD', pnl: -1 },
        { status: 'closed', strategy: 'other', symbol: 'ETH-USD', pnl: 100 }
      ];
    }
  };
  runtime._readSimToLiveReport = () => ({
    generatedAt: '2026-07-15T00:00:00Z',
    policy: {
      economicsVersion: TRADING_ECONOMICS_VERSION,
      costModel: {
        takerFeeBps: ALPACA_CRYPTO_FEES.takerBps,
        makerFeeBps: ALPACA_CRYPTO_FEES.makerBps
      }
    },
    paperQueue: [enforceVenueCompatibility({
      id: 'sim-candidate', key: 'full_aggression:ETH-USD', strategyId: 'full_aggression', symbol: 'ETH',
      state: 'paper_candidate',
      paper: { trades: 999, totalPnl: -999, winRate: 1, profitFactor: 0.1 },
      simulation: { score: 0.9, winRate: 99, trades: 466, profitFactor: 2.4, averageDollarPnl: 12 },
      compiledStrategy: {
        id: 'compiled-test', strategyName: 'Full Aggression', assetClass: 'crypto', paperOnly: true,
        dsl: { execution: { style: 'taker_market' } }
      }
    })]
  });
  const active = runtime._hydrateFromSimToLive({ persist: false });
  assert.equal(observedSince, null);
  assert.equal(active.evidenceSource, 'sqlite_closed_trades');
  assert.equal(active.symbol, 'ETH-USD');
  assert.equal(active.trades, 2);
  assert.equal(active.pnl, 4);
  assert.equal(active.winRate, 50);
  assert.equal(active.simulationEvidence.trades, 466);
  assert.equal(active.paperEvidence.trades, 999);
});

function syntheticBars(count = 240) {
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    price *= 1 + (index % 40 < 30 ? 0.002 : -0.001);
    return { timestamp: new Date(1700000000000 + index * 300000).toISOString(), open: price * 0.999, high: price * 1.002, low: price * 0.998, close: price, volume: 1000 };
  });
}

function baseCandidate() {
  return {
    id: 'base', key: 'full_aggression:ETH-USD', strategyId: 'full_aggression', symbol: 'ETH-USD', assetClass: 'crypto',
    compiledStrategy: {
      id: 'compiled-base', paperOnly: true,
      dsl: {
        signalSet: ['trend', 'volatility_guard'],
        exit: { stopLossPct: 0.018, takeProfitPct: 0.045, trailingStopPct: 0.014 },
        sizing: { maxPositionPct: 0.03, maxPaperTradeValue: 1000 }
      }
    }
  };
}

test('compiled backtester executes declared short signals with symmetric costs and side evidence', () => {
  const bars = Array.from({ length: 240 }, (_, index) => {
    const price = 200 - index * 0.35;
    return {
      timestamp: new Date(1700000000000 + index * 3600000).toISOString(),
      open: price + 0.1,
      high: price + 0.25,
      low: price - 0.25,
      close: price,
      volume: 1000
    };
  });
  const candidate = baseCandidate();
  candidate.compiledStrategy.dsl.entry = {
    mode: 'trend', direction: 'long_or_short', fastWindow: 4, slowWindow: 12, minMomentum: 0.001
  };
  candidate.compiledStrategy.dsl.exit = {
    ...candidate.compiledStrategy.dsl.exit,
    takeProfitPct: 0.02,
    stopLossPct: 0.02,
    trailingStopPct: 0.015,
    exitMomentum: -0.0005
  };
  const result = backtestBars({ bars, candidate, tradeStartIndex: 20 });
  assert.ok(result.trades > 0);
  assert.ok(result.totalPnl > 0);
  assert.equal(result.sampleTrades.every(trade => trade.side === 'short'), true);
});

test('compiled backtester respects a short-only direction without leaking long entries', () => {
  const bars = Array.from({ length: 240 }, (_, index) => {
    const price = 100 + index * 0.2;
    return { timestamp: String(index), open: price, high: price + 0.1, low: price - 0.1, close: price, volume: 1000 };
  });
  const candidate = baseCandidate();
  candidate.compiledStrategy.dsl.entry = {
    mode: 'trend', direction: 'short_only', fastWindow: 4, slowWindow: 12, minMomentum: 0.001
  };
  const result = backtestBars({ bars, candidate, tradeStartIndex: 20 });
  assert.equal(result.trades, 0);
});

test('compiled runtime decision uses the completed bar and next execution bar', () => {
  const bars = Array.from({ length: 80 }, (_, index) => {
    const price = index < 79 ? 100 : 110;
    return { timestamp: index * 3600000, open: price, high: price, low: price, close: price, volume: index === 78 ? 5000 : 1000 };
  });
  bars[78] = { ...bars[78], open: 106, high: 109, low: 106, close: 109, volume: 5000 };
  const candidate = baseCandidate();
  candidate.compiledStrategy.dsl.entry = {
    mode: 'breakout', direction: 'long_or_short', fastWindow: 4, slowWindow: 12,
    breakoutWindow: 18, breakoutBufferPct: 0.001, minVolumeRatio: 1
  };
  const signal = evaluateCompiledStrategyDecision({ bars, candidate });
  assert.equal(signal.action, 'BUY');
  assert.equal(signal.metadata.signalBar, 78 * 3600000);
  assert.equal(signal.metadata.executionBar, 79 * 3600000);
});

test('offline evolution mutates candidates and evaluates chronological cost-aware folds without promotion', async () => {
  const bars = syntheticBars();
  const candidate = baseCandidate();
  const mutated = mutateCandidate(candidate, () => 0.8);
  assert.notDeepEqual(mutated.compiledStrategy.dsl.exit, candidate.compiledStrategy.dsl.exit);
  const evaluation = evaluateWalkForward({ bars, candidate: mutated, folds: 3 });
  assert.equal(evaluation.foldCount, 3);
  assert.equal(evaluation.folds.every(fold => typeof fold.frictionPassed === 'boolean'), true);

  const reportPath = path.join(ROOT, 'data', 'test-offline-evolution', `${process.pid}-${Date.now()}.json`);
  const lab = new OfflineStrategyEvolutionLab({
    reportPath,
    backtester: { loadBars: async () => ({ bars, file: path.join(ROOT, 'data', 'fixture-bars.json'), timeframe: '5Min' }) }
  });
  try {
    const report = await lab.evolve({ bases: [candidate], populationSize: 8, generations: 2, folds: 3, seed: 'test-seed' });
    assert.equal(report.summary.evaluations, 16);
    assert.equal(report.mode, 'offline_evolution_only');
    assert.equal(report.policy.noAutomaticPaperOrLivePromotion, true);
    assert.equal(report.topCandidates.every(row => row.requiresIndependentPaperValidation), true);
    assert.ok((await fs.stat(reportPath)).size > 0);
  } finally {
    await fs.rm(path.dirname(reportPath), { recursive: true, force: true });
  }
});
