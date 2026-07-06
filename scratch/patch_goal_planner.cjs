const fs = require('fs');

let content = fs.readFileSync('arbiters/GoalPlannerArbiter.cjs', 'utf8');

// 1. Deduplication change
content = content.replace(
    /for \(const goalId of this\.activeGoals\) \{\s*const goal = this\.goals\.get\(goalId\);/g,
    `for (const goal of this.goals.values()) {
      if (goal.status === 'completed' || goal.status === 'failed') continue;`
);

content = content.replace(
    /const strongIntentMatch = overlap >= 0\.58;/g,
    `const strongIntentMatch = overlap >= 0.50;`
);

// 2. Prune stale goals & 3. SELECTION Layer deliberation
const additions = `
  async _pruneStaleGoals() {
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let pruned = 0;
    
    for (const [id, goal] of this.goals) {
      if (goal.status === 'completed' || goal.status === 'failed') continue;
      if ((goal.metrics?.progress ?? 0) > 0) continue;
      
      const lastTouch = goal.metadata?.lastProgressAt || goal.startedAt || goal.createdAt || now;
      if (now - lastTouch > ONE_WEEK) {
        this.transitionGoal(id, 'failed', { reason: 'pruned: 0% progress after 7 days', actor: this.name });
        pruned++;
      }
    }
    if (pruned > 0) this.logger.info(\`[\${this.name}] 🗑️ Pruned \${pruned} stale goal(s)\`);
  }

  async _deliberateBeforeDispatch(goal) {
      if (!this.brain) return { approved: true };
      const activeCount = Array.from(this.activeGoals).map(id => this.goals.get(id)).filter(g => g?.status === 'active').length;
      
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const isHighPressure = heapUsedMB > 700 || activeCount >= 3;

      if (!isHighPressure) return { approved: true };

      const prompt = \`System is under high resource pressure (Heap: \${heapUsedMB}MB, Active Goals: \${activeCount}).
We are about to dispatch the following goal:
TITLE: "\${goal.title}"
PRIORITY: \${goal.priority}
DESCRIPTION: "\${goal.description}"

Is this goal ABSOLUTELY CRITICAL to execute right now? 
Respond with ONLY "YES" or "NO: [reason]".\`;

      try {
          const response = await this.brain.reason(prompt, { quickResponse: true, preferredBrain: 'LOGOS' });
          if (response.text.trim().toUpperCase().startsWith('NO')) {
              return { approved: false, reason: response.text.trim().substring(4) || 'Deferred due to resource pressure' };
          }
      } catch (err) {}
      return { approved: true };
  }

  async reviewStalledGoals() {`;

if (!content.includes('async _pruneStaleGoals()')) {
    content = content.replace(
        /async reviewStalledGoals\(\) \{/,
        additions
    );
}

content = content.replace(
    /let top = pending\[0\];/,
    `let top = pending[0];
    const deliberation = await this._deliberateBeforeDispatch(top);
    if (!deliberation.approved) {
        this.logger.warn(\`[\${this.name}] ✋ SELECTION GATE: Rejected goal "\${top.title}" - \${deliberation.reason}\`);
        this.transitionGoal(top.id, 'deferred', { reason: \`deliberation_rejected: \${deliberation.reason}\` });
        return;
    }`
);

// 4. Poseidon Feedback Loop
content = content.replace(
    /const transition = this\.transitionGoal\(\s*goalId,\s*STATUS\.COMPLETED,/,
    `// Notify Poseidon
    try {
      const { epistemicLayer } = await import('../core/EpistemicLayer.js');
      if (epistemicLayer && epistemicLayer.poseidon) {
        await epistemicLayer.poseidon.updateTension(goal.category || 'engineering', -0.1);
        this.logger.info(\`[\${this.name}] 🔱 Poseidon tension updated for completed goal.\`);
      }
    } catch(e) {}
    const transition = this.transitionGoal(
      goalId,
      STATUS.COMPLETED,`
);

fs.writeFileSync('arbiters/GoalPlannerArbiter.cjs', content, 'utf8');
