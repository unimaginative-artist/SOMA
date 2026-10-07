
import BaseArbiterV4 from './BaseArbiter.js';
const BaseArbiter = BaseArbiterV4; // Alias for compatibility

export class GuardianArbiter extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'GuardianArbiter',
      role: 'guardian',
      ...config
    });
    this.quadBrain = config.quadBrain;
  }

  /**
   * Analyze issues and propose fixes using QuadBrain (LOGOS/PROMETHEUS)
   * @param {Array} issues 
   * @returns {Object} { success: boolean, patch: string }
   */
  async handleIssues(issues) {
    console.log(`Guardian analyzing ${issues.length} issues...`);

    if (!this.quadBrain) {
      console.warn('QuadBrain not connected to Guardian - falling back to stub');
      return { success: false, error: 'Brain missing' };
    }

    const issue = issues[0];
    if (!issue) return { success: false, error: 'No issues provided' };

    try {
      // Construct a prompt for the AI
      const prompt = `You are the GUARDIAN, SOMA's immune system.
        
        CRITICAL ERROR DETECTED:
        Type: ${issue.type}
        Context: ${JSON.stringify(issue.context || {}, null, 2)}
        Message: ${issue.error || 'Unknown error'}
        
        TASK:
        Generate a specific, rigorous code patch or strategy to fix this.
        If it's a code error, provide the corrected code block.
        If it's a system failure, provide a recovery strategy.
        
        RESPONSE FORMAT:
        Return ONLY the fix/patch.`;

      // Use LOGOS for rigorous technical analysis
      const response = await this.quadBrain.callBrain('LOGOS', prompt, {
        mode: 'analytical',
        temperature: 0.1 // Precision is key
      });

      return {
        success: true,
        patch: response.text,
        analysis: response.reasoning || 'AI Generated Fix',
        confidence: response.confidence
      };

    } catch (err) {
      console.error('Guardian brain failure:', err);
      return { success: false, error: err.message };
    }
  }
}
