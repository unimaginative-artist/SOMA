/**
 * AgentMemoryManager.js
 * 
 * Bridges Arbiterium ↔ MnemonicArbiter ↔ KnowledgeGraph.
 * Handles:
 * - Auto-remember: completed workflows → long-term memory
 * - Smart recall: relevant past workflows → injected into new task context
 * - Token budgeting: compress context to fit within limits
 * - Memory consolidation: periodic merge of similar memories
 */

const DEFAULT_TOKEN_BUDGET = 4000; // ~4000 tokens for context portion
const TOKENS_PER_CHAR = 0.25; // rough estimate: 4 chars ≈ 1 token

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length * TOKENS_PER_CHAR);
}

function truncateToTokens(text, maxTokens) {
    if (!text) return '';
    const maxChars = Math.floor(maxTokens / TOKENS_PER_CHAR);
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + '... [truncated]';
}

class AgentMemoryManager {
    constructor({ mnemonic, knowledgeGraph, brain, outcomeTracker } = {}) {
        this.mnemonic = mnemonic;      // MnemonicArbiter instance
        this.kg = knowledgeGraph;       // KnowledgeGraphFusion instance
        this.brain = brain;             // QuadBrain for summarization
        this.outcomeTracker = outcomeTracker;

        // Cache of recent workflow summaries to avoid re-summarizing
        this.workflowSummaryCache = new Map(); // goalHash → summary
        this.maxCacheSize = 100;

        // Consolidation timer
        this.consolidationTimer = null;
        this.consolidationInterval = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Initialize the manager and start background tasks
     */
    initialize() {
        console.log('[AgentMemory] Initializing persistent agent memory...');

        // Start periodic consolidation
        this.consolidationTimer = setInterval(() => {
            this._consolidateMemories().catch(e =>
                console.warn('[AgentMemory] Consolidation error:', e.message)
            );
        }, this.consolidationInterval);

        console.log('[AgentMemory] ✅ Ready — auto-remember, recall, token budgeting active');
    }

    shutdown() {
        if (this.consolidationTimer) {
            clearInterval(this.consolidationTimer);
            this.consolidationTimer = null;
        }
    }

    // ═══════════════════════════════════════════
    // AUTO-REMEMBER: Store completed workflow results
    // ═══════════════════════════════════════════

    /**
     * Called when an entire workflow completes.
     * Distills the goal + step results into a compact memory entry.
     */
    async rememberWorkflow(plan) {
        if (!this.mnemonic || !plan) return null;

        try {
            const { goal, steps, summary } = plan;

            // Build a compact digest of the workflow
            const completedSteps = (steps || []).filter(s => s.status === 'COMPLETED' || s.status === 'completed');
            const failedSteps = (steps || []).filter(s => s.status === 'FAILED' || s.status === 'failed');
            const toolsUsed = new Set();
            const rolesUsed = new Set();

            const stepDigests = completedSteps.map(s => {
                rolesUsed.add(s.assignedArbiterRole);
                if (s.toolsUsed) s.toolsUsed.forEach(t => toolsUsed.add(t.name));
                if (s.tools) s.tools.forEach(t => toolsUsed.add(t));
                // Compact: description + first 200 chars of output
                const output = s.output ? s.output.substring(0, 200) : 'no output';
                return `[${s.assignedArbiterRole}] ${s.description}: ${output}`;
            });

            const memoryContent = [
                `WORKFLOW: ${goal}`,
                summary ? `APPROACH: ${summary}` : '',
                `OUTCOME: ${completedSteps.length}/${steps.length} steps completed, ${failedSteps.length} failed`,
                `ROLES: ${[...rolesUsed].join(', ')}`,
                toolsUsed.size > 0 ? `TOOLS: ${[...toolsUsed].join(', ')}` : '',
                `STEPS:\n${stepDigests.join('\n')}`
            ].filter(Boolean).join('\n');

            const tags = [
                'arbiterium-workflow',
                ...rolesUsed,
                ...toolsUsed,
                failedSteps.length === 0 ? 'success' : 'partial-failure'
            ];

            const result = await this.mnemonic.remember(memoryContent, {
                tags,
                source: 'arbiterium',
                type: 'workflow-result',
                goal,
                stepsCompleted: completedSteps.length,
                stepsFailed: failedSteps.length,
                totalSteps: steps.length,
                importance: failedSteps.length === 0 ? 0.8 : 0.5,
                timestamp: Date.now()
            });

            console.log(`[AgentMemory] 💾 Stored workflow memory: "${goal.substring(0, 50)}..." (${estimateTokens(memoryContent)} tokens)`);

            // Also add to knowledge graph if significant
            if (this.kg && completedSteps.length >= 3 && typeof this.kg.addNode === 'function') {
                try {
                    await this.kg.addNode({
                        label: `Workflow: ${goal.substring(0, 60)}`,
                        description: summary || `Completed workflow with ${completedSteps.length} steps`,
                        type: 'workflow',
                        domain: 'ARBITERIUM',
                        importance: failedSteps.length === 0 ? 8 : 5,
                        timestamp: Date.now()
                    });
                } catch (kgErr) {
                    // Non-critical
                    console.warn('[AgentMemory] KG store skipped:', kgErr.message);
                }
            }

            return result;
        } catch (error) {
            console.error('[AgentMemory] rememberWorkflow failed:', error.message);
            return null;
        }
    }

    /**
     * Called when a single step completes with significant output.
     * Only stores steps with substantial results (>100 chars).
     */
    async rememberStep(step, goal) {
        if (!this.mnemonic || !step?.output || step.output.length < 100) return null;

        try {
            const content = `STEP RESULT [${step.assignedArbiterRole}]: ${step.description}\nGOAL: ${goal}\nOUTPUT: ${step.output.substring(0, 500)}`;

            return await this.mnemonic.remember(content, {
                tags: ['arbiterium-step', step.assignedArbiterRole, ...(step.tools || [])],
                source: 'arbiterium',
                type: 'step-result',
                goal,
                stepId: step.id,
                importance: 0.4,
                timestamp: Date.now()
            });
        } catch (error) {
            // Non-critical — don't block execution
            return null;
        }
    }

    // ═══════════════════════════════════════════
    // SMART RECALL: Retrieve relevant past context
    // ═══════════════════════════════════════════

    /**
     * Before orchestrating a new goal, recall relevant past workflows.
     * Returns formatted context string + metadata.
     */
    async recallForGoal(goal, tokenBudget = 1500) {
        if (!this.mnemonic) return { context: '', memories: [], tokenCount: 0 };

        try {
            const recallResult = await this.mnemonic.recall(goal, 5);
            const memories = recallResult?.results || [];

            if (memories.length === 0) {
                return { context: '', memories: [], tokenCount: 0 };
            }

            // Filter to workflow-relevant memories (above threshold)
            const relevant = memories.filter(m => {
                const score = m.similarity || m.score || 0;
                return score > 0.3; // Relevance threshold
            });

            if (relevant.length === 0) {
                return { context: '', memories: [], tokenCount: 0 };
            }

            // Build context within token budget
            let contextParts = [];
            let totalTokens = 0;

            for (const mem of relevant) {
                const content = mem.content || '';
                const tokens = estimateTokens(content);

                if (totalTokens + tokens > tokenBudget) {
                    // Try to fit a truncated version
                    const remaining = tokenBudget - totalTokens;
                    if (remaining > 100) { // Only include if we have room for 100+ tokens
                        contextParts.push(truncateToTokens(content, remaining));
                        totalTokens += remaining;
                    }
                    break;
                }

                contextParts.push(content);
                totalTokens += tokens;
            }

            const context = contextParts.length > 0
                ? `RELEVANT PAST EXPERIENCE (${contextParts.length} memories):\n${contextParts.join('\n---\n')}`
                : '';

            console.log(`[AgentMemory] 🧠 Recalled ${contextParts.length} memories for "${goal.substring(0, 40)}..." (${totalTokens} tokens)`);

            return {
                context,
                memories: relevant.map(m => ({
                    content: (m.content || '').substring(0, 100),
                    score: m.similarity || m.score || 0,
                    tier: m.tier || 'unknown'
                })),
                tokenCount: totalTokens
            };
        } catch (error) {
            console.warn('[AgentMemory] Recall failed:', error.message);
            return { context: '', memories: [], tokenCount: 0 };
        }
    }

    // ═══════════════════════════════════════════
    // TOKEN BUDGETING: Smart context compression
    // ═══════════════════════════════════════════

    /**
     * Build budget-aware context for a step execution.
     * Allocates tokens across: memories, previous results, tool outputs.
     */
    buildStepContext({ description, goal, previousResults, toolOutputs, recalledMemories, totalBudget = DEFAULT_TOKEN_BUDGET }) {
        const sections = [];
        let remaining = totalBudget;

        // Priority 1: Tool outputs (real data, highest value)
        if (toolOutputs && Object.keys(toolOutputs).length > 0) {
            const toolBudget = Math.min(Math.floor(remaining * 0.4), 1500);
            const toolSection = this._compressToolOutputs(toolOutputs, toolBudget);
            if (toolSection) {
                sections.push(toolSection);
                remaining -= estimateTokens(toolSection);
            }
        }

        // Priority 2: Recalled memories (past experience)
        if (recalledMemories && recalledMemories.context) {
            const memBudget = Math.min(Math.floor(remaining * 0.35), 1200);
            const memSection = truncateToTokens(recalledMemories.context, memBudget);
            if (memSection) {
                sections.push(memSection);
                remaining -= estimateTokens(memSection);
            }
        }

        // Priority 3: Previous step results (workflow continuity)
        if (previousResults && Object.keys(previousResults).length > 0) {
            const prevBudget = Math.min(remaining, 1200);
            const prevSection = this._compressPreviousResults(previousResults, prevBudget);
            if (prevSection) {
                sections.push(prevSection);
                remaining -= estimateTokens(prevSection);
            }
        }

        return sections.join('\n\n');
    }

    /**
     * Compress tool outputs to fit within budget.
     * Prioritizes by output length (shorter = likely more focused).
     */
    _compressToolOutputs(toolOutputs, tokenBudget) {
        const entries = Object.entries(toolOutputs);
        if (entries.length === 0) return null;

        let parts = [];
        let remaining = tokenBudget;

        // Header
        const header = 'TOOL RESULTS:';
        remaining -= estimateTokens(header);

        // Allocate budget per tool
        const perToolBudget = Math.floor(remaining / entries.length);

        for (const [name, output] of entries) {
            const prefix = `[${name}]: `;
            const prefixTokens = estimateTokens(prefix);
            const outputStr = String(output);
            const outputTokens = estimateTokens(outputStr);

            if (outputTokens <= perToolBudget - prefixTokens) {
                parts.push(prefix + outputStr);
            } else {
                parts.push(prefix + truncateToTokens(outputStr, perToolBudget - prefixTokens));
            }
        }

        return header + '\n' + parts.join('\n');
    }

    /**
     * Compress previous step results. Most recent steps get more budget.
     */
    _compressPreviousResults(results, tokenBudget) {
        const entries = Object.entries(results);
        if (entries.length === 0) return null;

        const header = 'CONTEXT FROM PREVIOUS STEPS:';
        let remaining = tokenBudget - estimateTokens(header);
        const parts = [];

        // Reverse so most recent steps get priority
        const reversed = entries.reverse();

        // First pass: allocate more to recent, less to older
        for (let i = 0; i < reversed.length; i++) {
            const [stepId, output] = reversed[i];
            // Recent steps get 40% of remaining, older ones split the rest
            const thisBudget = i === 0
                ? Math.floor(remaining * 0.4)
                : Math.floor(remaining / (reversed.length - i));

            if (thisBudget < 50) break; // Not worth including

            const prefix = `Step ${stepId}: `;
            const prefixTokens = estimateTokens(prefix);
            const outputStr = String(output);

            parts.push(prefix + truncateToTokens(outputStr, thisBudget - prefixTokens));
            remaining -= thisBudget;
        }

        if (parts.length === 0) return null;
        return header + '\n' + parts.join('\n');
    }

    // ═══════════════════════════════════════════
    // MEMORY CONSOLIDATION: Background optimization
    // ═══════════════════════════════════════════

    /**
     * Periodic task: review recent memories, merge duplicates,
     * boost importance of frequently-recalled ones.
     */
    async _consolidateMemories() {
        if (!this.mnemonic) return;

        try {
            // Get recent arbiterium memories
            let recent;
            if (typeof this.mnemonic.getRecentMemories === 'function') {
                recent = await this.mnemonic.getRecentMemories(24, 50); // Last 24 hours, max 50
            } else if (typeof this.mnemonic.getRecentColdMemories === 'function') {
                recent = this.mnemonic.getRecentColdMemories(50);
            }

            if (!recent || recent.length < 2) return;

            // Filter to arbiterium memories
            const arbMemories = recent.filter(m => {
                const meta = m.metadata || {};
                return meta.source === 'arbiterium';
            });

            if (arbMemories.length < 2) return;

            // Find duplicate workflows (same goal, different executions)
            const goalMap = new Map();
            for (const mem of arbMemories) {
                const goal = mem.metadata?.goal;
                if (!goal) continue;
                if (!goalMap.has(goal)) goalMap.set(goal, []);
                goalMap.get(goal).push(mem);
            }

            let consolidated = 0;
            for (const [goal, mems] of goalMap.entries()) {
                if (mems.length < 2) continue;

                // Keep the most recent, boost its importance
                const sorted = mems.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                const keeper = sorted[0];

                // Boost importance based on repetition
                const newImportance = Math.min(1.0, (keeper.importance || 0.5) + 0.1 * (mems.length - 1));
                if (newImportance !== keeper.importance) {
                    try {
                        await this.mnemonic.remember(keeper.content, {
                            ...keeper.metadata,
                            importance: newImportance,
                            consolidated: true,
                            consolidatedFrom: mems.length
                        });
                        consolidated++;
                    } catch (e) {
                        // Skip
                    }
                }
            }

            if (consolidated > 0) {
                console.log(`[AgentMemory] 🔄 Consolidated ${consolidated} memory groups`);
            }
        } catch (error) {
            console.warn('[AgentMemory] Consolidation error:', error.message);
        }
    }

    // ═══════════════════════════════════════════
    // STATS
    // ═══════════════════════════════════════════

    getStats() {
        return {
            cacheSize: this.workflowSummaryCache.size,
            mnemonicAvailable: !!this.mnemonic,
            knowledgeGraphAvailable: !!this.kg,
            brainAvailable: !!this.brain
        };
    }
}

export default AgentMemoryManager;
