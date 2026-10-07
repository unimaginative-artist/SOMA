import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * DiagnosticCortexArbiter.js
 * 
 * The "General Hospital" layer of SOMA.
 * Responsible for symptom intake, differential diagnosis, and medical reasoning.
 */
export class DiagnosticCortexArbiter extends BaseArbiterV4 {
  constructor(config = {}) {
    super({
      name: 'DiagnosticCortex',
      role: ArbiterRole.DIAGNOSTICIAN,
      capabilities: [ArbiterCapability.REASON_TASK, 'differential_diagnosis'],
      lobe: 'THALAMUS', // Neural index: security/risk/diagnostic lobe
      tier: 'operational',
      ...config
    });

    this.knowledgeGraph = config.knowledgeGraph;
    this.quadBrain = config.quadBrain;
  }

  async onInitialize() {
    this.log('info', '🏥 Diagnostic Cortex online. SOMA General Hospital is open.');
    
    // Subscribe to symptoms/ailment signals (lobe-scoped: THALAMUS handles health/risk signals)
    if (this.messageBroker) {
      this.messageBroker.subscribeByLobe('THALAMUS', 'user_symptom_report', (envelope) => this.handleSymptomIntake(envelope.payload));
    }
  }

  /**
   * Conversational symptom intake
   */
  async handleSymptomIntake(data) {
    const { userQuery, context = {} } = data;
    this.log('info', `🩺 Intake session: "${userQuery.substring(0, 50)}..."`);

    // 1. Identify "Red Flags" (Emergency situations)
    // 2. Perform Differential Diagnosis via ODIN
    // 3. Consult BiotechArbiter for latest research on the suspected condition
    
    const result = await this.quadBrain.callBrain({
        prompt: `You are SOMA's Diagnostic Cortex. 
                 User reports: "${userQuery}"
                 
                 Perform a professional differential diagnosis. 
                 - List most likely causes.
                 - Ask 2 clarifying questions (e.g. "Is the pain sharp or dull?").
                 - Provide a research-backed insight into a possible mechanism.
                 
                 Note: Add a strict disclaimer that SOMA is an AI and this is for research only.`,
        mode: 'logos'
    });

    return result;
  }
}

export default DiagnosticCortexArbiter;
