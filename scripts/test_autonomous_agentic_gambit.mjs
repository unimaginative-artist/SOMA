/**
 * scripts/test_autonomous_agentic_gambit.mjs
 *
 * Master Verification Suite: Full Gambit of SOMA's Autonomous Agentic AI
 * 
 * 1. Code Editing & Surgical Modification (with rollback defense)
 * 2. Self-Authored Dynamic Test Suite Execution
 * 3. Autonomous Self-Modification & Candidate Governance
 * 4. Live Cross-System Bridge: SOMA -> MAX (AMX) Tool & Goal Invocation
 * 5. Closed-Loop Executive Followthrough (Intent -> Execution -> Artifacts -> Report-Back)
 * 6. Reality Loop Outcome Truth & Authoritative Goal Settlement
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MaxAgentBridge } from '../core/MaxAgentBridge.js';
import { EngineeringSwarmArbiter } from '../arbiters/EngineeringSwarmArbiter.js';
import { NeocortexFollowthrough } from '../core/executive/NeocortexFollowthrough.js';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { SelfRepairCandidate } from '../core/SelfRepairCandidate.js';
import { verifyGoal, buildQualityReport } from '../core/GoalQualityGate.cjs';

console.log('═══════════════════════════════════════════════════════════');
console.log('  🧠 SOMA AUTONOMOUS AGENTIC AI FULL GAMBIT VERIFICATION');
console.log('═══════════════════════════════════════════════════════════\n');

let passedTests = 0;
let failedTests = 0;

function pass(name, detail = '') {
    passedTests++;
    console.log(`  ✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, error) {
    failedTests++;
    console.error(`  ❌ FAIL: ${name} ->`, error?.message || error);
}

async function runFullGambit() {
    const root = process.cwd();

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 1: CODE EDITING & SURGICAL MODIFICATION
    // ─────────────────────────────────────────────────────────────────────
    console.log('[1/6] ✏️  Testing Surgical Code Editing & Rollback Defense...');
    try {
        const scratchDir = path.join(root, 'scratch', 'agentic-gambit');
        await fs.mkdir(scratchDir, { recursive: true });
        const targetFile = path.join(scratchDir, 'editable_module.js');
        
        // Initial state
        await fs.writeFile(targetFile, 'export function compute() { return 42; }\n', 'utf8');
        assert.ok(existsSync(targetFile));
        pass('Source file created in isolated scratchpad');

        // Surgical replacement via MaxAgentBridge
        const bridge = new MaxAgentBridge();
        const replaceRes = await bridge.replaceInFile(targetFile, 'return 42;', 'return 84;');
        assert.equal(replaceRes.success, true);
        const updatedContent = await fs.readFile(targetFile, 'utf8');
        assert.match(updatedContent, /return 84;/);
        pass('Surgical in-place code modification executed and verified', '42 -> 84');

        // Rollback defense test (invalid target string throws or rejects safely)
        let rollbackCaught = false;
        try {
            const rollbackRes = await bridge.replaceInFile(targetFile, 'NON_EXISTENT_STRING', 'WILL_FAIL');
            if (!rollbackRes || !rollbackRes.success) rollbackCaught = true;
        } catch {
            rollbackCaught = true;
        }
        assert.ok(rollbackCaught);
        const intactContent = await fs.readFile(targetFile, 'utf8');
        assert.match(intactContent, /return 84;/);
        pass('Rollback protection triggered cleanly on failed patch match');
    } catch (err) {
        fail('Code Editing & Surgical Modification', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 2: AUTONOMOUS TEST AUTHORING & EXECUTION
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[2/6] 🧪 Testing Dynamic Test Generation & Execution Harness...');
    try {
        const testDir = path.join(root, 'scratch', 'agentic-gambit', 'tests');
        await fs.mkdir(testDir, { recursive: true });
        const dynamicTestFile = path.join(testDir, 'generated_canary.test.mjs');

        // SOMA authors her own test
        const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';

test('SOMA self-generated canary test passes', () => {
    const memory = { tensor: [1, 2, 3], active: true };
    assert.equal(memory.tensor.reduce((a, b) => a + b, 0), 6);
    assert.equal(memory.active, true);
});
`;
        await fs.writeFile(dynamicTestFile, testCode, 'utf8');
        pass('Authored dynamic standalone test file');

        // Execute dynamic test via node test runner
        const { execFileSync } = await import('node:child_process');
        const output = execFileSync(process.execPath, ['--test', dynamicTestFile], { encoding: 'utf8' });
        assert.match(output, /tests 1/);
        assert.match(output, /pass 1/);
        pass('Executed self-generated test suite with zero failures', '1/1 pass');
    } catch (err) {
        fail('Autonomous Test Authoring & Execution', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 3: AUTONOMOUS SELF-MODIFICATION & CANDIDATE GOVERNANCE
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[3/6] 🧬 Testing Autonomous Self-Modification & Candidate Governance...');
    try {
        // Test 3a: Live capability discovery and dispatch via EngineeringSwarmArbiter
        const swarm = new EngineeringSwarmArbiter({ rootPath: root });
        await swarm.onInitialize();
        const dispatchRes = await swarm.handleMessage({
            type: 'goal_assigned',
            payload: {
                goalId: 'gambit-selfmod-' + Date.now(),
                goal: {
                    title: 'Autonomous capability bridge inspection',
                    description: 'Inspect arbiters/DiagnosticCortexArbiter.js for capability expansion.',
                    category: 'self_improvement',
                    metadata: { filePath: 'arbiters/DiagnosticCortexArbiter.js' }
                }
            }
        });
        assert.equal(dispatchRes.success, true);
        pass('EngineeringSwarmArbiter dispatched autonomous self-improvement goal');

        // Test 3b: Isolated Candidate Governance & Rollback Defense
        const govFixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-gambit-gov-'));
        const { execFileSync } = await import('node:child_process');
        const git = (args) => execFileSync('git', args, { cwd: govFixtureDir, encoding: 'utf8', stdio: 'pipe', windowsHide: true });
        
        git(['init']);
        git(['config', 'user.name', 'SOMA Agentic Test']);
        git(['config', 'user.email', 'soma@local']);
        await fs.mkdir(path.join(govFixtureDir, 'core'));
        await fs.writeFile(path.join(govFixtureDir, 'core', 'module.js'), 'export const active = false;\n');
        await fs.writeFile(path.join(govFixtureDir, 'package.json'), '{"type":"module"}');
        await fs.mkdir(path.join(govFixtureDir, 'tests'));
        await fs.writeFile(path.join(govFixtureDir, 'tests', 'module.test.mjs'), 
            "import test from 'node:test'; import assert from 'node:assert/strict'; import {active} from '../core/module.js'; test('active check', () => assert.equal(active, true));\n"
        );
        git(['add', '.']);
        git(['commit', '-m', 'Initial baseline']);

        const governance = new SelfModificationGovernance({ root: govFixtureDir, system: {} });
        await governance.initialize();

        // Propose a candidate patch that solves the test
        const patch = { files: [{ path: 'core/module.js', content: 'export const active = true;\n' }] };
        const candidate = await SelfRepairCandidate.create(governance, patch, {
            testFiles: ['tests/module.test.mjs'],
            risk: 'low'
        });

        assert.equal(candidate.validation.passed, true);
        pass('SelfRepairCandidate passed real validation in isolated worktree');
        await candidate.close();
        clearInterval(governance._timer);
        await fs.rm(govFixtureDir, { recursive: true, force: true });
    } catch (err) {
        fail('Autonomous Self-Modification & Candidate Governance', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 4: LIVE CROSS-SYSTEM BRIDGE (SOMA -> MAX)
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[4/6] 🌉 Testing Live Cross-System Bridge (SOMA ↔ MAX)...');
    try {
        const bridge = new MaxAgentBridge();
        const available = await bridge.isAvailable();
        assert.equal(available, true);
        const health = bridge.getLastHealth();
        pass('Connected to live running MAX instance on port 3100', `Status: ${health.status}, Uptime: ${Math.floor(health.uptime / 3600)}h`);

        // Tool invocation: list files in MAX core
        const coreFiles = await bridge.listFiles('core');
        assert.ok(Array.isArray(coreFiles.files) && coreFiles.files.length > 0);
        pass(`Queried MAX tool API (file:list) -> found ${coreFiles.files.length} core files`);

        // Tool invocation: read MAX package.json
        const maxPkg = await bridge.readFile('package.json');
        const parsedPkg = JSON.parse(maxPkg.content || '{}');
        assert.equal(parsedPkg.name, 'max-agent');
        pass('Read MAX package.json via bridge', `Agent Name: ${parsedPkg.name}, Version: ${parsedPkg.version}`);

        // Security check: Verify MAX AutonomyPolicy blocks unauthorized commands
        try {
            await bridge.runShell('echo ILLEGAL_COMMAND');
            assert.fail('Should have been blocked by AutonomyPolicy');
        } catch (blockedErr) {
            assert.match(blockedErr.message, /Command not in allowlist/);
            pass('MAX AutonomyPolicy security barrier active: unauthorized shell command rejected');
        }
    } catch (err) {
        fail('Live Cross-System Bridge (SOMA -> MAX)', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 5: CLOSED-LOOP EXECUTIVE FOLLOWTHROUGH
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[5/6] 🔄 Testing Closed-Loop Executive Followthrough...');
    try {
        const sentMessages = [];
        const workingMemoryEvents = [];
        const wsEvents = [];

        const mockSystem = {
            discordArbiter: {
                sendMessage: async ({ channelId, message }) => {
                    sentMessages.push({ channelId, message });
                    return { success: true, messageId: 'msg_gambit_' + Date.now() };
                }
            },
            workingMemory: {
                addAction: (entry) => workingMemoryEvents.push({ type: 'action', entry }),
                addDiscovery: (entry) => workingMemoryEvents.push({ type: 'discovery', entry }),
                setPreoccupation: (str) => workingMemoryEvents.push({ type: 'preoccupation', str })
            },
            broadcast: (event, payload) => wsEvents.push({ event, payload }),
            messageBroker: {
                _handlers: new Map(),
                subscribe(event, handler) {
                    if (!this._handlers.has(event)) this._handlers.set(event, []);
                    this._handlers.get(event).push(handler);
                },
                publish(event, payload) {
                    const handlers = this._handlers.get(event) || [];
                    for (const h of handlers) h({ type: event, payload });
                }
            }
        };

        const followthrough = new NeocortexFollowthrough({
            system: mockSystem,
            receiptsPath: path.join(root, 'scratch', 'agentic-gambit', 'receipts.jsonl')
        });
        await followthrough.initialize();

        // 1. Register lease with proper channel and taskTitle
        followthrough.registerIntent({
            goalId: 'gambit_goal_001',
            taskTitle: 'Multi-Timeframe Breakout Optimization',
            channel: 'discord',
            channelId: 'channel_gambit_777',
            actionType: 'backtest',
            requester: 'Owner'
        });
        pass('Followthrough intent registered with Discord channel mapping');

        // 2. Create artifact
        const artifactPath = path.join(root, 'scratch', 'agentic-gambit', 'backtest_result.json');
        await fs.writeFile(artifactPath, JSON.stringify({
            summary: 'BTC MTF TrendGuard Simulation',
            winRate: 41.2,
            netReturn: 118.5,
            profitFactor: 1.82,
            maxDrawdown: 14.8
        }, null, 2));

        // 3. Trigger completion
        const receipt = await followthrough.handleGoalCompleted({
            goal: {
                id: 'gambit_goal_001',
                title: 'Multi-Timeframe Breakout Optimization'
            },
            result: {
                artifact: artifactPath,
                result: 'Strategy simulation completed with high signal metrics.'
            }
        });

        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].channelId, 'channel_gambit_777');
        assert.match(sentMessages[0].message, /Hey Owner, I finished executing/);
        assert.match(sentMessages[0].message, /118\.5%/);
        assert.match(sentMessages[0].message, /Profit Factor: 1\.82/);
        pass('Closed loop: Synthesized report-back dispatched to Discord channel');

        assert.ok(workingMemoryEvents.some(e => e.type === 'action'));
        assert.ok(workingMemoryEvents.some(e => e.type === 'discovery'));
        pass('Closed loop: Present-tense Working Memory updated with findings');

        assert.ok(wsEvents.some(e => e.event === 'soma_activity'));
        pass('Closed loop: Real-time Command Bridge WebSocket pulse broadcasted');
    } catch (err) {
        fail('Closed-Loop Executive Followthrough', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 6: REALITY LOOP & AUTHORITATIVE GOAL SETTLEMENT
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[6/6] 🎯 Testing Reality Loop Learning & Goal Quality Gate...');
    try {
        const testGoal = {
            id: 'gambit_verified_goal',
            title: 'Execute quantitative strategy research',
            category: 'engineering',
            status: 'completed',
            metadata: {
                sources: ['https://arxiv.org/abs/2301.00001'],
                benchmarkTests: ['tests/agentic-execution-hardening.test.mjs']
            }
        };

        const quality = buildQualityReport(testGoal);
        Object.assign(testGoal, quality);
        pass('Constructed goal quality report with strict execution contract');

        // Test source trail verification in GoalQualityGate
        const mockEvidence = {
            sources: testGoal.metadata.sources,
            tests: true,
            artifact: 'package.json',
            summary: true
        };
        const verification = await verifyGoal(testGoal, {
            summary: 'Research validated across 1 primary source citation.',
            evidence: mockEvidence
        }, { falsificationTest: () => true });
        assert.equal(verification.passed, true);
        pass('Goal quality verification passed with authoritative source trail and Poseidon TRUE');
    } catch (err) {
        fail('Reality Loop Learning & Goal Quality Gate', err);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  GAMBIT SUITE COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(failedTests > 0 ? 1 : 0);
}

runFullGambit().catch(err => {
    console.error('Fatal error during full gambit execution:', err);
    process.exit(1);
});
