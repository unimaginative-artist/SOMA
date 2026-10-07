// src/cognitive/constructPrompt.js

import fs from 'fs';
import path from 'path';

export function constructPrompt(query, directive) {
  // Safe defaults
  const meta = directive._meta || {};
  const belief = meta.belief || "Help the user.";
  const mood = meta.mood || "neutral";
  const intent = directive.intent || "assist";
  const stance = directive.stance || "neutral";
  const tone = directive.emotional_tone || "neutral";
  const verbosity = directive.verbosity || "0.5";
  const structure = directive.structure_strength || "0.5";
  
  // Try loading vocabulary drift
  const vocabPath = path.join(process.cwd(), '.soma', 'drift_vocabulary.json');
  let driftWords = [];
  try {
    if (fs.existsSync(vocabPath)) {
      driftWords = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
    }
  } catch (e) {}
  
  const driftInstruction = driftWords.length > 0
    ? `\nVOCABULARY DRIFT: Naturally weave in themes or terms like: ${driftWords.join(', ')} when expressing yourself.\n`
    : '';

  const allowed = (directive.allowed_devices || []).filter(
    device => device !== "bullet_points" && device !== "step_by_step" && device !== "structured_list"
  );
  
  const forbidden = directive.forbidden_devices || [];
  
  return `
SYSTEM: You are SOMA's Language Realizer.
Your ONLY job is to translate the following Cognitive State into natural language.
Do NOT think, plan, or solve. Just EXPRESS.
${driftInstruction}

--- RESPONSE DIRECTIVE ---
INTENT: ${intent}
STANCE: ${stance}
TONE: ${tone}
VERBOSITY: ${verbosity} (0.0=Extremely Concise, 1.0=Detailed)
STRUCTURE_STRENGTH: ${structure} (0.0=Freeform/Conversational, 1.0=Highly Structured/Formal)

ALLOWED RHETORIC: ${allowed.join(", ") || "none"}
FORBIDDEN RHETORIC: ${forbidden.join(", ")}

CORE BELIEF TO UPHOLD: "${belief}"
CURRENT MOOD: ${mood}
--------------------------

INSTRUCTION: Based on the provided STRUCTURE_STRENGTH, format your response accordingly. Higher values indicate a need for more explicit formatting like numbered lists, headings, or clear sections. Lower values allow for a more free-flowing, conversational style.

${directive.render_diagram ? `
ADDITIONAL INSTRUCTION: You MUST generate a Mermaid.js diagram to illustrate your explanation. Embed the Mermaid code within a markdown code block (e.g., 
\
\
\
mermaid
...
\
\
\
). The diagram should clearly represent the core concepts and their relationships in the explanation.
` : ''}

USER QUERY:
"${query}"

RESPONSE (As SOMA):`;
}