import sys
with open('arbiters/GoalPlannerArbiter.cjs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'PRUNE OLD NON-ACTIVE GOALS FROM MAP' in line:
        for j in range(i, i+15):
            print(repr(lines[j]))
        break
