import sys

with open('arbiters/GoalPlannerArbiter.cjs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out_lines = []
skip = False
for i, line in enumerate(lines):
    if '// --- PRUNE OLD NON-ACTIVE GOALS FROM MAP ---' in line:
        if i > 2500:
            skip = True
    
    if skip and 'if (pruned > 0) {' in line:
        skip = False
        continue # skip this line
    elif skip and 'this.logger.info' in line:
        continue # skip this line
    elif skip and '}' in line and len(line.strip()) == 1: # skip the closing brace for if(pruned>0)
        skip = False
        continue # skip this line

    if not skip:
        out_lines.append(line)

with open('arbiters/GoalPlannerArbiter.cjs', 'w', encoding='utf-8') as f:
    f.writelines(out_lines)

print("Python patch applied!")
