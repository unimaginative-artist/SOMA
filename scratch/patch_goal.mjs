import fs from 'fs';
let content = fs.readFileSync('arbiters/GoalPlannerArbiter.cjs', 'utf8');

const autopsyLogic = `      if (!failedTransition.success) return failedTransition;
      goal.metrics.progress = Math.min(goal.metrics.progress || 0, resumable ? 75 : 95);
      
      // Goal Autopsy Mechanism for choked transitions
      if (goal.metrics.progress >= 80) {
         goal.metadata.failureCount = (goal.metadata.failureCount || 0) + 1;
         if (goal.metadata.failureCount >= 3) {
             try {
                 const autopsyPath = path.join(process.cwd(), 'data', 'autopsies', \`autopsy_\${goal.id}.md\`);
                 fs.mkdirSync(path.dirname(autopsyPath), { recursive: true });
                 const autopsyContent = \`# Goal Autopsy: \${goal.title}\\n\\n## Goal State\\n\` + JSON.stringify(goal, null, 2) + \`\\n\\n## Last Verification\\n\` + JSON.stringify(verification, null, 2) + \`\\n\\n## Error\\nFailed transition from PENDING to COMPLETED 3 times due to invalid artifact or state mismatch.\\n\`;
                 fs.writeFileSync(autopsyPath, autopsyContent, 'utf8');
                 this.logger.error(\`[\${this.name}] Goal choked on transition. Autopsy written to \${autopsyPath}.\`);
                 
                 // Queue fix bug task
                 this.sendMessage('EngineeringSwarmArbiter', 'task', {
                     query: \`Fix choked goal transition for goal \${goal.id}. Read autopsy at \${autopsyPath}.\`
                 });
                 
                 // Set to failed so it stops looping
                 this.transitionGoal(goalId, STATUS.FAILED, { reason: 'max_transition_failures', actor: this.name });
             } catch (e) {
                 this.logger.error(\`[\${this.name}] Failed to write goal autopsy: \${e.message}\`);
             }
         }
      }
      
      try {`;

if (!content.includes('Goal Autopsy Mechanism for choked transitions')) {
    content = content.replace(
        /if \(!failedTransition\.success\) return failedTransition;\n\s*goal\.metrics\.progress = Math\.min\(goal\.metrics\.progress \|\| 0, resumable \? 75 : 95\);\n\s*try \{/m,
        autopsyLogic
    );
}

fs.writeFileSync('arbiters/GoalPlannerArbiter.cjs', content, 'utf8');
console.log('patched GoalPlannerArbiter.cjs');
