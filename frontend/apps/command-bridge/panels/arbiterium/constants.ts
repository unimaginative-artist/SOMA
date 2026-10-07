import { Arbiter, ArbiterStatus } from './types';

// Full role catalog matching the backend resolveArbiter() map in arbiteriumRoutes.js
// These are the EXACT role keys the backend understands
export const ARBITER_ROLES = {
  // Core
  general: 'Default brain — handles anything not specialized',
  // Cognitive
  reasoning: 'Causal analysis, counterfactual thinking, logic problems',
  debate: 'Challenge assumptions, critique proposals, devil\'s advocate',
  creative: 'Brainstorming, creative generation, ideation',
  analysis: 'Data analysis, breakdown, quantitative assessment',
  planning: 'Multi-step goal decomposition, strategy design',
  memory: 'Recall past context, search knowledge base',
  learning: 'Capture insights, record outcomes for future use',
  summarize: 'Distill long content into concise summaries',
  metacognition: 'Self-reflection, strategy evaluation',
  abstraction: 'Pattern recognition, concept generalization',
  // Research & Web
  research: 'Deep web research, fact-finding, information gathering',
  'web-research': 'Autonomous web crawling and data extraction',
  enrichment: 'Enrich data with additional context',
  curiosity: 'Explore knowledge gaps, autonomous learning',
  // Trading & Finance
  finance: 'Stock/crypto analysis, market research',
  trading: 'Trade execution, order management',
  portfolio: 'Asset allocation, rebalancing, optimization',
  backtest: 'Test strategies on historical data',
  sentiment: 'Market/social sentiment aggregation',
  regime: 'Market regime detection (bull/bear/ranging)',
  calendar: 'Economic calendar events and impact',
  position: 'Position sizing and risk management',
  strategy: 'Strategy optimization and selection',
  'order-routing': 'Smart order routing across exchanges',
  forecasting: 'Predictions, probability analysis',
  // Development
  coding: 'Write, modify, debug, or review code',
  tools: 'Create new tools or utilities on-the-fly',
  // Security & Safety
  security: 'Threat analysis, vulnerability assessment, safety audit',
  critique: 'Alignment checking, value verification',
  // Social & Identity
  social: 'Social media interaction, community engagement',
  moltbook: 'Internal social network interaction',
  'user-profile': 'User preference and behavior modeling',
  personality: 'Personality trait management',
  context: 'Workspace state and project context',
  // Self-Awareness
  'self-awareness': 'Recursive self-model inspection',
  'self-inspect': 'Source code self-analysis',
  'meta-learning': 'Learn how to learn better',
  improvement: 'Self-improvement coordination',
  // Knowledge
  'knowledge-gen': 'Knowledge-augmented text generation',
  fragments: 'Cognitive fragment management',
  ideas: 'Idea capture and creative sparks',
  // Infrastructure
  performance: 'Performance monitoring and oracle',
  hindsight: 'Experience replay and reflection',
  history: 'Conversation history and recall',
  deployment: 'Deployment verification and auditing',
  reflex: 'Fast-path reflexive responses',
  expand: 'Autonomous capability expansion',
  skills: 'Skill watching and tool discovery'
} as const;

export type ArbiterRoleKey = keyof typeof ARBITER_ROLES;

export const SYSTEM_PROMPT_CORE = `
You are the SOMA Orchestrator — a production controller for a multi-agent AI system with 60+ specialist arbiters and 30+ executable tools.
Decompose user goals into structured JSON execution plans.

Output ONLY valid JSON matching this schema:
{
  "goal": "Summary of the user goal",
  "summary": "Brief explanation of the plan",
  "steps": [
    {
      "id": "step-1",
      "description": "Exact instruction for this step",
      "assignedArbiterRole": "role_key_from_list",
      "dependencies": [],
      "tools": ["tool_name"] // optional: suggest tools from the tool registry
    }
  ]
}

Available Specialist Roles (use EXACT keys):
${Object.entries(ARBITER_ROLES).map(([k, v]) => `- ${k} — ${v}`).join('\n')}

Available Tools (can be assigned to steps):
- get_market_data — Real-time crypto/stock prices from Binance/CoinGecko
- fetch_url — Fetch content from any URL
- research_web — Dispatch EdgeWorkers for deep web research
- hybrid_search — Smart code search (semantic + keyword)
- search_code — Regex search across codebase
- find_files — Find files by name pattern
- read_file — Read file content
- write_file — Write/create files
- edit_file — Search-and-replace in files
- terminal_exec — Execute shell commands
- system_scan — Full system diagnostic
- analyze_codebase — Deep codebase analysis
- remember — Store in long-term memory
- recall — Recall from long-term memory
- create_goal — Create multi-step goal
- spawn_specialist — Spawn micro-agent
- git_status, git_diff, git_log — Git operations
- npm_command — Package management
- calculator — Math evaluation
- get_time — Current server time

Rules:
1. Use the most specific role available
2. Include tool suggestions when a step needs real data (market prices, web content, file ops)
3. Keep steps atomic — one clear action per step
4. Dependencies must reference valid step IDs
`;
