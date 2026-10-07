const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeGoalContract } = require('./LearningSpine.cjs');
const { compileEvidencePreflight, isTerminal, normalizeStatus, STATUS } = require('./GoalLifecycle.cjs');

const DEFAULT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'goal',
  'task', 'soma', 'system', 'review', 'analyze', 'improve'
]);

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function overlapScore(a = '', b = '') {
  const left = new Set(normalizeText(a).filter(w => !DEFAULT_STOPWORDS.has(w)));
  const right = new Set(normalizeText(b).filter(w => !DEFAULT_STOPWORDS.has(w)));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits++;
  return hits / Math.min(left.size, right.size);
}

function buildQualityReport(goalData = {}, existingGoals = []) {
  const issues = [];
  const warnings = [];
  const contract = normalizeGoalContract(goalData);
  const title = String(goalData.title || '').trim();
  const description = String(goalData.description || '').trim();
  const category = String(goalData.category || '').trim();
  const successCriteria = Array.isArray(goalData.successCriteria)
    ? goalData.successCriteria.filter(Boolean)
    : Array.isArray(goalData.metadata?.successCriteria)
      ? goalData.metadata.successCriteria.filter(Boolean)
      : contract.successCriteria;
  const verification = goalData.verification || goalData.metadata?.verification || contract.verification;

  if (!title) issues.push('Missing title');
  if (!category) issues.push('Missing category');
  if (title && title.length < 12) warnings.push('Title is very short');
  if (!description || description.length < 40) warnings.push('Description should explain why the goal matters');
  if (!successCriteria.length) warnings.push('No success criteria provided');
  if (!verification) warnings.push('No verification method provided');

  const duplicate = existingGoals.find(g => {
    // Use the shared lifecycle rather than a second, incomplete terminal list.
    // Abandoned experiments are history, not active execution reservations.
    if (!g || isTerminal(g.status) || [STATUS.BROKEN, STATUS.DEFERRED, 'cancelled'].includes(normalizeStatus(g.status))) return false;
    return overlapScore(`${title} ${description}`, `${g.title || ''} ${g.description || ''}`) >= 0.62;
  });
  if (duplicate) issues.push(`Likely duplicate of active goal "${duplicate.title}"`);

  const score = Math.max(0, Math.min(100, 100 - issues.length * 35 - warnings.length * 10));
  return {
    approved: issues.length === 0,
    score,
    issues,
    warnings,
    duplicateGoalId: duplicate?.id || null,
    successCriteria,
    verification,
    contract
  };
}

function safeResolve(repoRoot, target) {
  const resolved = path.resolve(repoRoot, target || '');
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path outside workspace: ${target}`);
  return resolved;
}

function normalizeContractPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function canonicalContractPath(repoRoot, value) {
  let resolved = path.resolve(repoRoot, normalizeContractPath(value).replace(/\/\*+$/, ''));
  const suffix = [];
  while (!fs.existsSync(resolved) && path.dirname(resolved) !== resolved) {
    suffix.unshift(path.basename(resolved));
    resolved = path.dirname(resolved);
  }
  // Resolve existing parent links too, so a symlink inside a permitted folder
  // cannot disguise a receipt for an outside write.
  const canonical = path.join(fs.realpathSync(resolved), ...suffix);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function contractPathAllows(candidate, allowed = [], repoRoot = process.cwd()) {
  if (!candidate) return true;
  let value;
  try { value = canonicalContractPath(repoRoot, candidate); } catch { return false; }
  return allowed.some(item => {
    if (!item) return false;
    try {
      const scope = canonicalContractPath(repoRoot, item);
      const relative = path.relative(scope, value);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    } catch { return false; }
  });
}

function runCommand(command, repoRoot) {
  const [shell, shellFlag] = process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];
  try {
    const output = execFileSync(shell, [shellFlag, command], {
      cwd: repoRoot,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8'
    });
    return { command, passed: true, output: String(output || '').slice(-2000) };
  } catch (error) {
    return {
      command,
      passed: false,
      output: String((error.stdout || '') + (error.stderr || '') || error.message).slice(-2000)
    };
  }
}

async function verifyGoal(goal = {}, result = {}, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const metadata = goal.metadata || {};
  const contract = metadata.goalContract || normalizeGoalContract(goal);
  const verification = result.verification || metadata.verification || goal.verification || contract.verification || null;
  const evidence = result.evidence || metadata.evidence || {};
  const scopedEvidence = evidence.completionEvidence && evidence.completionEvidence.goalId === goal.id
    ? evidence.completionEvidence
    : null;
  const checks = [];
  const preflight = compileEvidencePreflight(goal);
  const strictContract = preflight.strict === true;

  const criteria = result.successCriteria || metadata.successCriteria || goal.successCriteria || contract.successCriteria || [];
  for (let index = 0; index < criteria.length; index++) {
    const criterion = criteria[index];
    const scopedCriterion = scopedEvidence?.criterionCoverage?.[index];
    const hasExplicitEvidence = Boolean(evidence[String(criterion)]);
    const hasCompletionText = Boolean(result.summary || result.result || result.output || result.message);
    const hasStopReason = Boolean(result.stopReason || result.reason);
    checks.push({
      type: 'success_criterion',
      label: String(criterion),
      passed: Boolean(
        result.force ||
        scopedCriterion?.passed === true ||
        (!scopedEvidence && (
          hasExplicitEvidence ||
          (!strictContract && hasCompletionText) ||
          (verification?.allowStopReason && hasStopReason)
        ))
      ),
      receiptIds: scopedCriterion?.requirements?.flatMap(item => item.receiptIds || []) || []
    });
  }

  if (strictContract) {
    const allowedTools = Array.isArray(preflight.allowedTools) ? preflight.allowedTools.filter(Boolean) : [];
    const allowedWritePaths = Array.isArray(preflight.allowedWritePaths) ? preflight.allowedWritePaths.filter(Boolean) : [];
    const expectedArtifacts = Array.isArray(preflight.filesExist) ? preflight.filesExist.filter(Boolean) : [];
    checks.push({
      type: 'delegation_contract',
      label: contract.kind === 'child' ? 'Strict child-goal execution contract' : 'Strict autonomous execution contract',
      passed: Boolean(
        (contract.kind !== 'child' || contract.parentGoalId) &&
        criteria.length &&
        allowedTools.length &&
        allowedWritePaths.length &&
        expectedArtifacts.length &&
        preflight.maxSteps
      ),
      output: contract.kind === 'child'
        ? 'Child goals require parent identity, criteria, allowed tools/write paths, expected artifacts, and a step budget'
        : 'Strict autonomous goals require criteria, allowed tools/write paths, expected artifacts, and a step budget'
    });

    const toolsUsed = Array.isArray(evidence.toolsUsed)
      ? evidence.toolsUsed
      : Array.isArray(result.toolsUsed)
        ? result.toolsUsed
        : [];
    const disallowedTools = toolsUsed.filter(tool => !allowedTools.includes(tool));
    checks.push({
      type: 'delegation_tool_scope',
      label: 'Delegated tool scope',
      passed: disallowedTools.length === 0,
      output: disallowedTools.length ? `Disallowed tools used: ${disallowedTools.join(', ')}` : 'All observed tools were contracted'
    });

    const mutationTools = new Set([
      'write_file', 'workspace_write', 'workspace_mkdir', 'workspace_move',
      'workspace_trash', 'modify_code', 'pulse_stage_code', 'architecture_reorg_apply'
    ]);
    const touchedPaths = (scopedEvidence?.checks || [])
      .filter(item => mutationTools.has(item?.tool))
      .map(item => item.path)
      .filter(Boolean);
    const directPaths = [
      result.path, result.file, result.filepath,
      evidence.path, evidence.file, evidence.filepath
    ].filter(Boolean);
    const disallowedPaths = [...new Set([...touchedPaths, ...directPaths])]
      .filter(item => !contractPathAllows(item, allowedWritePaths, repoRoot));
    checks.push({
      type: 'delegation_path_scope',
      label: 'Delegated write-path scope',
      passed: disallowedPaths.length === 0,
      output: disallowedPaths.length ? `Writes outside contract: ${disallowedPaths.join(', ')}` : 'All observed writes were contracted'
    });

    const iterations = Number(result.iterations ?? evidence.iterations ?? 0);
    const withinSteps = !iterations || !preflight.maxSteps || iterations <= preflight.maxSteps;
    const withinDeadline = !preflight.deadlineAt || Date.now() <= preflight.deadlineAt;
    checks.push({
      type: 'execution_budget',
      label: 'Delegated execution budget',
      passed: withinSteps && withinDeadline,
      output: !withinSteps
        ? `Step budget exceeded: ${iterations}/${preflight.maxSteps}`
        : !withinDeadline
          ? `Contract deadline expired at ${new Date(preflight.deadlineAt).toISOString()}`
          : 'Execution remained inside contracted budget'
    });

    const failedExecutionFacts = (scopedEvidence?.checks || []).filter(item =>
      ['tests', 'syntax', 'delegation_artifact', 'sandbox_stage', 'code_modification', 'architecture_reorganization'].includes(item?.type) &&
      item.passed === false);
    checks.push({
      type: 'blocking_execution_receipts',
      label: 'No failed required execution receipts',
      passed: failedExecutionFacts.length === 0,
      output: failedExecutionFacts.length
        ? `Failed receipts: ${failedExecutionFacts.map(item => `${item.type}:${item.tool || 'unknown'}`).join(', ')}`
        : 'No failed test, syntax, code-change, stage, or delegation receipts'
    });
  }

  const requiredEvidence = verification?.evidenceRequired || metadata.evidenceRequired || contract.evidenceRequired || [];
  for (const key of requiredEvidence) {
    const value = result[key] ?? evidence[key] ?? metadata[key];
    const scopedPassed = scopedEvidence?.requiredChecks?.find(check => check.key === key)?.passed === true;
    const passed = Boolean(
      result.force ||
      scopedPassed ||
      value ||
      (key === 'summary' && (result.summary || result.result || result.output || result.message)) ||
      (verification?.allowStopReason && (result.stopReason || result.reason))
    );
    checks.push({
      type: 'evidence_required',
      label: String(key),
      passed,
      output: passed ? 'Evidence present' : `Missing required evidence: ${key}`
    });
  }

  const artifactValue = result.artifact || evidence.artifact || result.file || result.filepath || result.path || evidence.file || evidence.filepath || evidence.path;
  if (['code', 'research'].includes(preflight.profile) && artifactValue) {
    let artifactPath = null;
    let artifactContent = '';
    try {
      artifactPath = safeResolve(repoRoot, artifactValue);
      artifactContent = fs.readFileSync(artifactPath, 'utf8');
      checks.push({ type: 'artifact_readback', file: artifactValue, passed: artifactContent.trim().length > 0, output: 'Artifact exists and is non-empty' });
    } catch (error) {
      checks.push({ type: 'artifact_readback', file: artifactValue, passed: false, output: error.message });
    }
    if (preflight.profile === 'research') {
      const sources = Array.isArray(result.sources) ? result.sources :
        Array.isArray(evidence.sources) ? evidence.sources :
        Array.isArray(goal?.metadata?.sources) ? goal.metadata.sources :
        Array.isArray(goal?.metadata?.research?.sources) ? goal.metadata.research.sources :
        Array.isArray(goal?.metadata?.researchPlan?.sources) ? goal.metadata.researchPlan.sources :
        Array.isArray(goal?.metadata?.benchmarkTests) ? goal.metadata.benchmarkTests :
        Array.isArray(goal?.metadata?.testFiles) ? goal.metadata.testFiles : [];
      const sourceCount = sources.length + (artifactContent.match(/https?:\/\/\S+/g) || []).length;
      checks.push({ type: 'source_trail', label: 'Research source trail', passed: sourceCount > 0, output: `${sourceCount} source reference(s)` });
    }
  }

  if (preflight.profile === 'memory') {
    const memoryReceipt = scopedEvidence?.checks?.some(check => check?.passed && /memory|recall|receipt/i.test(`${check.type || ''} ${check.tool || ''}`)) ||
      checks.some(check => check.passed && /memory|receipt/i.test(`${check.type || ''} ${check.label || ''}`)) ||
      Boolean(result.receipt || evidence.receipt);
    checks.push({ type: 'memory_receipt', label: 'Memory write/readback receipt', passed: memoryReceipt, output: memoryReceipt ? 'Memory receipt present' : 'Missing memory write and retrieval evidence' });
  }

  if (verification?.commands && Array.isArray(verification.commands)) {
    for (const command of verification.commands) checks.push({ type: 'command', ...runCommand(command, repoRoot) });
  }

  if (verification?.filesExist && Array.isArray(verification.filesExist)) {
    for (const file of verification.filesExist) {
      let passed = false;
      let output = '';
      try {
        passed = fs.existsSync(safeResolve(repoRoot, file));
      } catch (error) {
        output = error.message;
      }
      checks.push({ type: 'file_exists', file, passed, output });
    }
  }

  if (verification?.contains && Array.isArray(verification.contains)) {
    for (const item of verification.contains) {
      const file = item.file;
      const text = item.text;
      let passed = false;
      let output = '';
      try {
        const content = fs.readFileSync(safeResolve(repoRoot, file), 'utf8');
        passed = content.includes(text);
      } catch (error) {
        output = error.message;
      }
      checks.push({ type: 'contains', file, text, passed, output });
    }
  }

  const toolsUsed = Array.isArray(evidence.toolsUsed) ? evidence.toolsUsed : Array.isArray(result.toolsUsed) ? result.toolsUsed : [];
  const writtenPath = result.file || result.filepath || result.path || evidence.file || evidence.filepath || evidence.path || '';
  const codeTouched = Boolean(
    result.codeTouched === true ||
    evidence.codeTouched === true ||
    toolsUsed.some(tool => ['modify_code', 'pulse_stage_code'].includes(tool)) ||
    (toolsUsed.includes('write_file') && /\.(?:js|cjs|mjs|ts)$/i.test(String(writtenPath)))
  );
  const requiresExecutableProof = Boolean(preflight.requiresExecutableProof || verification?.requiresExecutableProof || metadata.requiresExecutableProof || codeTouched);
  if (requiresExecutableProof) {
    const commandPassed = checks.some(check => check.type === 'command' && check.passed);
    const syntaxPassed = Boolean(result.verifySyntax || evidence.verifySyntax || checks.some(check => check.type === 'syntax' && check.passed));
    const testsPassed = Boolean(result.runTests || evidence.runTests || evidence.shellVerification || commandPassed);
    const fullCodeProofRequired = Boolean(
      verification?.requiresCodeChange ||
      metadata.requiresCodeChange ||
      contract.requiresCodeChange
    );
    const executablePassed = fullCodeProofRequired
      ? testsPassed && syntaxPassed
      : testsPassed || (verification?.allowSyntaxOnly && syntaxPassed);
    checks.push({
      type: 'executable_proof',
      label: 'Executable verification proof',
      passed: Boolean(result.force || executablePassed),
      output: executablePassed
        ? fullCodeProofRequired ? 'Passing tests and syntax/build proof present' : 'Executable proof present'
        : fullCodeProofRequired
          ? 'Missing executable proof: implementation missions require both passing tests and syntax/build verification'
          : 'Missing executable proof: run tests, build, syntax check plus explicit allowed syntax-only verification, or configured verification command'
    });
  }

  const requiresCodeChange = Boolean(
    verification?.requiresCodeChange ||
    metadata.requiresCodeChange ||
    contract.requiresCodeChange
  );
  if (requiresCodeChange) {
    const changeReceipts = (scopedEvidence?.checks || []).filter(item =>
      ['code_modification', 'sandbox_stage', 'architecture_reorganization'].includes(item?.type) &&
      item.passed === true);
    checks.push({
      type: 'code_change_proof',
      label: 'Governed source-code change proof',
      passed: Boolean(result.force || changeReceipts.length > 0),
      receiptIds: changeReceipts.map(item => item.receiptId).filter(Boolean),
      output: changeReceipts.length
        ? `${changeReceipts.length} governed source change receipt(s)`
        : 'Missing governed code modification, sandbox stage, or architecture reorganization receipt'
    });
  }

  if (!checks.length) {
    const hasEvidence = Boolean(result.result || result.summary || result.completedBy || result.force);
    checks.push({
      type: 'evidence',
      label: 'Completion evidence supplied',
      passed: hasEvidence,
      output: hasEvidence ? 'Result/evidence present' : 'No verifier or evidence supplied'
    });
  }

  const passed = checks.every(check => check.passed);
  
  // ----------------------------------------------------
  // POSEIDON PROTOCOL VERIFICATION
  // ----------------------------------------------------
  let poseidonVerdict = null;
  let poseidonError = null;
  
  if (!result.force) {
    try {
        const { Poseidon } = await import('./Poseidon.js');
        const poseidon = new Poseidon();
        
        const claim = `Goal Completed: ${goal.title}`;
        
        // A true falsification test must be a physical verification, not just text or success criteria assertions
        const validPhysicalTestTypes = ['command', 'file_exists', 'contains', 'syntax', 'executable_proof', 'artifact_readback'];
        const physicalChecks = checks.filter(c => c.passed && validPhysicalTestTypes.includes(c.type));
        
        const falsificationTest = physicalChecks.length > 0 
            ? `Physical checks passed: ${physicalChecks.map(c => c.type).join(', ')}` 
            : null;
            
        poseidonVerdict = await poseidon.verify(claim, {
            falsificationTest: falsificationTest,
            testResult: passed
        });
        
        if (poseidonVerdict) {
            checks.push({
                type: 'poseidon_protocol',
                label: 'Poseidon Ternary Certification',
                passed: poseidonVerdict.state === 'TRUE',
                output: poseidonVerdict.reason
            });
        }
    } catch (e) {
        poseidonError = e;
        console.error("Poseidon Verification Error:", e);
    }
  }

  if (strictContract && !result.force && (!poseidonVerdict || poseidonError)) {
    checks.push({
      type: 'poseidon_protocol',
      label: 'Poseidon Ternary Certification',
      passed: false,
      output: poseidonError?.message || 'Poseidon returned no verdict for a fail-closed child goal'
    });
  }

  const finalPassed = checks.every(check => check.passed) &&
    (!poseidonVerdict || poseidonVerdict.state === 'TRUE') &&
    (!strictContract || result.force || Boolean(poseidonVerdict && !poseidonError));

  return {
    passed: finalPassed,
    checkedAt: Date.now(),
    checks,
    score: checks.length ? Math.round((checks.filter(c => c.passed).length / checks.length) * 100) : 0,
    poseidon: poseidonVerdict
  };
}

module.exports = {
  buildQualityReport,
  verifyGoal,
  overlapScore
};
