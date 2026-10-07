/**
 * CognitiveMoERouter.js
 * 
 * SOMA Cognitive Mixture of Experts (MoE) Intent Router.
 * Triages incoming messages between:
 *   1. CONVERSATION: Warm dialogue, recall, philosophy -> Aurora
 *   2. DIRECT_INSPECTION: Read-only code/file inspection -> Logos / Deterministic Tools -> Aurora
 *   3. ACTION_EXECUTION: Live tool execution, file edits, testing -> Prometheus + Qwen 2.5 Coder
 * 
 * Powered by Neocortex System 1 (ModernBERT on CUDA port 5055) with sub-10ms latency,
 * backed by robust fail-open heuristics.
 */

import { neocortexSystem1Bridge } from './executive/NeocortexSystem1Bridge.js';
import { isPastedCode } from './ExecutionProtocol.js';
import { isDiscordFeedbackOrCritique } from '../server/discord/DiscordTurnPolicy.js';

export const MOE_LANES = {
  CONVERSATION: 'conversation',
  DIRECT_INSPECTION: 'direct_inspection',
  ACTION_EXECUTION: 'action_execution'
};

const ACTION_VERBS = /\b(fix|write|create|modify|edit|build|patch|refactor|update|delete|remove|run|execute|test|deploy|install|implement|debug)\b/i;
const ACTION_TARGETS = /\b(file|files|folder|folders|code|route|routes|script|scripts|test|tests|server|bug|endpoint|function|class|method|repo|repository|directory|directories|command|dependency|package|core|client|lib|module|component|codebase|max|soma|stack|contents|workspace|architecture|website|app|application|frontend|backend|front end|back end|api|ui|bot|system|page|pages)\b/i;
const INSPECTION_VERBS = /\b(where is|what is|find|search|look at|look through|check|inspect|show me|read|view|list|status of|how does|diagnose|locate|open|trace|explore|audit|examine|survey|analyze|contents of|tell me the contents)\b/i;
const CASUAL_GREETINGS = /^(hey|hi|hello|yo|good morning|gm|good afternoon|howdy|sup|how are you|soma\??)$/i;
const TECHNICAL_OR_PROJECT_REF = /\b(max|soma|stack|file|files|folder|folders|directory|directories|code|repo|repository|architecture|route|routes|script|scripts|test|tests|server|endpoint|function|class|method|module|component|config|database|db|bug|error|log|logs|contents|dependency|dependencies|website|app|application|frontend|backend|front end|back end|api|ui|bot|system)\b/i;
const IDENTIFIER_OR_PATH = /([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z]{1,4}|[A-Z][a-zA-Z0-9]{3,}|in\s+[a-zA-Z0-9_\-\/]+)/;

export class CognitiveMoERouter {
  constructor(opts = {}) {
    this.name = 'CognitiveMoERouter';
    this.system1Bridge = opts.system1Bridge || neocortexSystem1Bridge;
    this.logger = opts.logger || console;
    this.preferredCodingModel = opts.preferredCodingModel || process.env.SOMA_CODER_MODEL || 'qwen2.5-coder:14b-instruct-q4_K_M';
    this.preferredVoiceModel = opts.preferredVoiceModel || process.env.SOMA_CHAT_LOCAL_MODEL || 'soma-aurora:v2';
  }

  /**
   * Authoritative intent routing.
   * @param {string} text - User message content
   * @param {Object} context - Optional conversation history, channel, user info
   * @returns {Promise<Object>} Routing decision
   */
  async route(text = '', context = {}) {
    const raw = String(text || '').trim();
    if (!raw) {
      return {
        lane: MOE_LANES.CONVERSATION,
        confidence: 1.0,
        source: 'empty_input',
        requiresTools: false,
        targetLobe: 'AURORA',
        suggestedModel: this.preferredVoiceModel
      };
    }

    // 1. Fast heuristic bypass for hypothetical inquiries & user "how do I" pedagogical questions
    if (/^(?:what would happen if|what if someone|how (?:do|can|should|would) i\b)/i.test(raw)) {
      return {
        lane: MOE_LANES.CONVERSATION,
        confidence: 0.98,
        source: 'hypothetical_or_pedagogical',
        requiresTools: false,
        targetLobe: 'AURORA',
        suggestedModel: this.preferredVoiceModel
      };
    }

    // Past-tense self-report can mention action verbs without authorizing an
    // action. Keep it conversational unless it also contains a fresh request.
    if (/^(?:no[, ]+)?i\s+(?:spent|tried|was|have been|had been|already)\b/i.test(raw)
        && !/\b(?:can you|could you|would you|please|go ahead|now (?:fix|search|read))\b/i.test(raw)) {
      return {
        lane: MOE_LANES.CONVERSATION,
        confidence: 0.98,
        source: 'retrospective_conversation',
        requiresTools: false,
        targetLobe: 'AURORA',
        suggestedModel: this.preferredVoiceModel
      };
    }

    // Conversational feedback, critique, praise, and evaluation are NOT action execution commands
    if (isDiscordFeedbackOrCritique(raw)) {
      return {
        lane: MOE_LANES.CONVERSATION,
        confidence: 0.99,
        source: 'feedback_heuristic',
        requiresTools: false,
        targetLobe: 'AURORA',
        suggestedModel: this.preferredVoiceModel,
        reason: 'conversational_feedback'
      };
    }

    const hasTechRef = TECHNICAL_OR_PROJECT_REF.test(raw);

    // 2. Fast heuristic bypass for obvious greetings & pure conversational banter
    // CRITICAL: NEVER bypass if message mentions code, files, architecture, or projects (e.g. MAX)
    if (!hasTechRef) {
      if (CASUAL_GREETINGS.test(raw) || isPastedCode(raw) || /^(?:how are you|how do you feel|how's it going|what's up|sup|hello|hey|good morning|gm|what if|do you think|discuss|i (?:already|used to|might|think))\b/i.test(raw)) {
        return {
          lane: MOE_LANES.CONVERSATION,
          confidence: 0.99,
          source: 'fast_heuristic',
          requiresTools: false,
          targetLobe: 'AURORA',
          suggestedModel: this.preferredVoiceModel,
          reason: 'casual_greeting'
        };
      }
    }

    // 2. Query System 1 Substrate (ModernBERT on CUDA port 5055, ~4ms)
    let s1 = null;
    try {
      s1 = await this.system1Bridge?.classifyTurn?.(raw, context);
    } catch {
      // System 1 fail-open
    }

    // 3. Evaluate Action / Execution Indicators
    // Normalize natural spoken conversational prefixes ("Actually can you open...", "Soma please check...")
    const stripped = raw
      .replace(/^(?:actually|now|so|well|ok|okay|hey|hi|yo|please|soma)[,\s]+/i, '')
      .replace(/^(?:(?:can|could|would|will) you (?:please )?)/i, '')
      .trim();

    const hasActionVerb = ACTION_VERBS.test(raw) || ACTION_VERBS.test(stripped);
    const hasActionTarget = ACTION_TARGETS.test(raw) || ACTION_TARGETS.test(stripped);
    const hasInspectionVerb = INSPECTION_VERBS.test(raw) || INSPECTION_VERBS.test(stripped);

    // Explicit code action: "fix line 42 in X", "run test Y", "edit server/index.cjs", "build me a website"
    const isExplicitAction = hasActionVerb && (hasActionTarget || IDENTIFIER_OR_PATH.test(raw));
    
    // Explicit read/search/directory inspection: "open max folder", "how does max look architecturally", "check server/routes"
    const isExplicitInspection = (hasInspectionVerb && (hasActionTarget || IDENTIFIER_OR_PATH.test(raw))) ||
      (/\b(?:open|contents of|list|show)\b/i.test(raw) && /\b(?:folder|directory|files|max|soma)\b/i.test(raw)) ||
      (/\b(?:trace|explore|audit|examine|survey|architecture of)\b/i.test(raw) && /\b(?:max|soma|repo|codebase|architecture)\b/i.test(raw));

    // Combine System 1 with semantic rules
    if (isExplicitAction) {
      return {
        lane: MOE_LANES.ACTION_EXECUTION,
        confidence: s1?.actConfidence ? Math.max(s1.actConfidence, 0.92) : 0.95,
        source: s1 ? 'hybrid_system1_action' : 'rule_action',
        requiresTools: true,
        targetLobe: 'LOGOS',
        suggestedModel: this.preferredCodingModel,
        system1: s1 || null
      };
    }

    if (isExplicitInspection) {
      return {
        lane: MOE_LANES.DIRECT_INSPECTION,
        confidence: 0.92,
        source: s1 ? 'hybrid_system1_inspection' : 'rule_inspection',
        requiresTools: true,
        targetLobe: 'LOGOS',
        suggestedModel: this.preferredCodingModel,
        system1: s1 || null
      };
    }

    // Check if System 1 signaled operational escalation
    const directed = hasActionVerb || hasInspectionVerb;
    if (directed && s1 && s1.actVsEscalate === 'act_immediately' && s1.lane === 'specialist') {
      return {
        lane: MOE_LANES.ACTION_EXECUTION,
        confidence: s1.laneConfidence || 0.85,
        source: 'system1_neocortex',
        requiresTools: true,
        targetLobe: 'PROMETHEUS',
        suggestedModel: this.preferredCodingModel,
        system1: s1
      };
    }

    // Default to Conversation
    return {
      lane: MOE_LANES.CONVERSATION,
      confidence: s1 ? (s1.laneConfidence || 0.8) : 0.75,
      source: s1 ? 'system1_social' : 'fallback_conversation',
      requiresTools: false,
      targetLobe: 'AURORA',
      suggestedModel: this.preferredVoiceModel,
      system1: s1 || null
    };
  }
}

export const globalCognitiveMoERouter = new CognitiveMoERouter();
export default CognitiveMoERouter;
