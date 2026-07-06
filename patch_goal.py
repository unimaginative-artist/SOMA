import sys
with open('arbiters/GoalPlannerArbiter.cjs', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''      // --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---
      // Remove deferred/completed/failed goals older than 30 days to prevent unbounded Map growth
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let pruned = 0;
      for (const [id, goal] of this.goals) {
        if (this.activeGoals.has(id)) continue; // never prune active goals
        const age = now - (goal.completedAt || goal.createdAt || 0);
        if (age > THIRTY_DAYS && (goal.status === 'deferred' || goal.status === 'completed' || goal.status === 'failed')) {
          this.goals.delete(id);
          pruned++;
        }
      }'''

replacement = '''      // --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---
      // Remove deferred/completed/failed goals older than 30 days to prevent unbounded Map growth
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let pruned = 0;
      for (const [id, goal] of this.goals) {
        const age = now - (goal.completedAt || goal.createdAt || 0);

        // 1. Auto-prune stale active goals (Ledger Janitor: 7 days at 0%)
        if (this.activeGoals.has(id)) {
            const progress = goal.metrics?.progress || 0;
            if (progress === 0 && age > SEVEN_DAYS && goal.status !== 'deferred') {
                this.activeGoals.delete(id);
                this.goals.delete(id);
                pruned++;
                this.logger.warn([ + this.name + ] ?? Auto-pruned stale active goal: "" (0% for >7 days));
            }
            continue;
        }

        // 2. Prune old non-active goals > 30 days
        if (age > THIRTY_DAYS && (goal.status === 'deferred' || goal.status === 'completed' || goal.status === 'failed')) {
          this.goals.delete(id);
          pruned++;
        }
      }'''

if target in content:
    content = content.replace(target, replacement)
    with open('arbiters/GoalPlannerArbiter.cjs', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched successfully")
else:
    print("Target not found")
