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
      }
      if (pruned > 0) {
        this.logger.info([ + this.name + ] ?? Pruned  old non-active goals from Map);
      }'''

target2 = target.replace('[ + this.name + ]', '[]')

if target2 in content:
    content = content.replace(target2, '')
    with open('arbiters/GoalPlannerArbiter.cjs', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Python patch applied!")
else:
    print("Target not found")
