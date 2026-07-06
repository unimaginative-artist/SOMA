import sys

with open('arbiters/GoalPlannerArbiter.cjs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out_lines = []
in_block = False
for line in lines:
    if '// --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---' in line:
        in_block = True
        out_lines.append('      // --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---\n')
        out_lines.append('      // Remove deferred/completed/failed goals older than 30 days to prevent unbounded Map growth\n')
        out_lines.append('      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;\n')
        out_lines.append('      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;\n')
        out_lines.append('      const now = Date.now();\n')
        out_lines.append('      let pruned = 0;\n')
        out_lines.append('      for (const [id, goal] of this.goals) {\n')
        out_lines.append('        const age = now - (goal.completedAt || goal.createdAt || 0);\n\n')
        out_lines.append('        // 1. Auto-prune stale active goals (Ledger Janitor: 7 days at 0%)\n')
        out_lines.append('        if (this.activeGoals.has(id)) {\n')
        out_lines.append('            const progress = goal.metrics?.progress || 0;\n')
        out_lines.append('            if (progress === 0 && age > SEVEN_DAYS && goal.status !== \'deferred\') {\n')
        out_lines.append('                this.activeGoals.delete(id);\n')
        out_lines.append('                this.goals.delete(id);\n')
        out_lines.append('                pruned++;\n')
        out_lines.append('                this.logger.warn([] ?? Auto-pruned stale active goal: "" (0% for >7 days));\n')
        out_lines.append('            }\n')
        out_lines.append('            continue;\n')
        out_lines.append('        }\n\n')
        out_lines.append('        // 2. Prune old non-active goals > 30 days\n')
        out_lines.append('        if (age > THIRTY_DAYS && (goal.status === \'deferred\' || goal.status === \'completed\' || goal.status === \'failed\')) {\n')
        out_lines.append('          this.goals.delete(id);\n')
        out_lines.append('          pruned++;\n')
        out_lines.append('        }\n')
        out_lines.append('      }\n')
    elif in_block and 'if (pruned > 0) {' in line:
        in_block = False
        out_lines.append(line)
    elif not in_block:
        out_lines.append(line)

with open('arbiters/GoalPlannerArbiter.cjs', 'w', encoding='utf-8') as f:
    f.writelines(out_lines)

print("Python patch applied!")
