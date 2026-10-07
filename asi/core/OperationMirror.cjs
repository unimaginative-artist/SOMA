// ═══════════════════════════════════════════════════════════
// FILE: asi/core/OperationMirror.cjs
// Critic-to-Nemesis Alignment (Operation Mirror)
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
require('dotenv').config();

class OperationMirror {
  constructor(config = {}) {
    this.resultsPath = config.resultsPath || path.join(__dirname, '../tests/validation-results.json');
    this.outputPath = config.outputPath || path.join(__dirname, '../learning/critic-alignment-dataset.jsonl');
    this.logger = config.logger || console;
    
    // Thresholds for "Dissonance"
    this.successSandboxThreshold = 0.9; // Sandbox says SUCCESS
    this.pessimisticCriticThreshold = 0.1; // Critic says TOTAL FAILURE (0.0)
  }

  /**
   * Run the mirror alignment process
   */
  async run(llm) {
    this.logger.info('🪞 Starting Operation Mirror: Critic-to-Nemesis Alignment');
    
    if (!fs.existsSync(this.resultsPath)) {
      throw new Error(`Results file not found: ${this.resultsPath}`);
    }

    const data = JSON.parse(fs.readFileSync(this.resultsPath, 'utf8'));
    const dissonanceNodes = this._extractDissonanceNodes(data.results);

    this.logger.info(`🔍 Found ${dissonanceNodes.length} nodes exhibiting Cognitive Dissonance`);

    const alignmentData = [];

    for (const node of dissonanceNodes) {
      this.logger.info(`[Aligning] Node: ${node.id} (${node.problemName})`);
      
      const groundTruth = await this._generateGroundTruth(llm, node);
      
      if (groundTruth) {
        alignmentData.push({
          input: {
            code: node.code,
            problem: node.problemDescription,
            failedCriticFeedback: node.criticFeedback
          },
          output: {
            groundTruthFeedback: groundTruth.feedback,
            groundTruthScore: groundTruth.score,
            identifiedStrengths: groundTruth.strengths
          },
          metadata: {
            nodeId: node.id,
            sandboxScore: node.sandboxScore,
            originalCriticScore: node.criticScore
          }
        });
      }
    }

    // Save to dataset
    this._saveDataset(alignmentData);
    
    this.logger.info(`\n✨ Operation Mirror Complete! Saved ${alignmentData.length} alignment pairs to ${this.outputPath}`);
    return alignmentData;
  }

  /**
   * Extract nodes where Sandbox Score is SUCCESS but Critic Score is FAILURE
   */
  _extractDissonanceNodes(results) {
    const dissonance = [];

    for (const problem of results) {
      if (!problem.tree || !problem.tree.children) continue;

      this.logger.info(`Checking problem: ${problem.name}`);

      // Recursive tree traversal
      const processNode = (node) => {
        // Correct path for score breakdown in the new toJSON format
        const sandboxScore = node.evaluation?.deterministic !== undefined ? node.evaluation.deterministic : (node.evaluation?.score || 0);
        const criticScore = node.evaluation?.llmCritique || 0;

        // Dissonance = Sandbox says SUCCESS, Critic says FAILURE
        if (sandboxScore >= this.successSandboxThreshold && criticScore <= this.pessimisticCriticThreshold) {
          dissonance.push({
            id: node.id,
            problemName: problem.name,
            problemDescription: problem.description,
            code: node.solution,
            sandboxScore,
            criticScore,
            criticFeedback: node.critique || node.evaluation?.critique || "No feedback"
          });
        }

        if (node.children && node.children.length > 0) {
          node.children.forEach(processNode);
        }
      };

      problem.tree.children.forEach(processNode);
    }

    return dissonance;
  }

  /**
   * Use Master Synthesizer to generate ground truth with retry logic
   */
  async _generateGroundTruth(llm, node) {
    const prompt = `You are NEMESIS, the Absolute Judge. 
Your goal is to correct a flawed code review.
The previous critic gave this code a score of 0 (TOTAL FAILURE), but it PASSED 100% of the functional tests.

PROBLEM:
${node.problemDescription}

CODE:
\`\`\`javascript
${node.code}
\`\`\`

SANDBOX VERDICT: SUCCESS (Score: ${node.sandboxScore})
PREVIOUS (FAILED) CRITIQUE: "${node.criticFeedback}"

TASK:
1. Explain why the previous critic was wrong to give a 0.
2. Acknowledge that while the code might be simple, its functional success is what matters.
3. Provide a corrected score (must be high, reflecting functional success).

Return ONLY valid JSON:
{
  "score": 0.8-1.0,
  "feedback": "Corrected analysis acknowledging functional success",
  "strengths": ["The main reason this code is actually good"],
  "failureOfPreviousCritic": "Why the previous review was invalid"
}`;

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await llm.generate(prompt, {
                temperature: 0.1,
                maxTokens: 1000
            });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (err) {
            if (err.message.includes('429') || err.message.includes('quota')) {
                attempt++;
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                this.logger.warn(`[429] Quota exceeded. Retrying attempt ${attempt}/${maxRetries} in ${delay.toFixed(0)}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                this.logger.error(`Ground truth generation failed: ${err.message}`);
                return null;
            }
        }
    }
    this.logger.error(`Failed to generate ground truth after ${maxRetries} attempts due to quota.`);
    return null;
  }

  _saveDataset(data) {
    const dir = path.dirname(this.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    data.forEach(item => {
      fs.appendFileSync(this.outputPath, JSON.stringify(item) + '\n', 'utf8');
    });
  }
}

module.exports = OperationMirror;
