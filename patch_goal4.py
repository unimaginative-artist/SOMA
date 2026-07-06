import sys

with open('arbiters/GoalPlannerArbiter.cjs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out_lines = []
skip = False
for line in lines:
    if '// --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---' in line:
        if any('SEVEN_DAYS' in l for l in out_lines):
            skip = True
    
    if skip and 'if (pruned > 0) {' in line:
        skip = False
        continue

    if not skip:
        out_lines.append(line)

with open('arbiters/GoalPlannerArbiter.cjs', 'w', encoding='utf-8') as f:
    f.writelines(out_lines)

print("Python patch applied!")
