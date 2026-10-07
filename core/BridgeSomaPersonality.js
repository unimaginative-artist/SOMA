// =======================================
// Bridge-Soma Lightweight Personality Engine
// =======================================

// ---------- Intent Classifier ----------
// Intentionally dumb. Default = observation.
function classifyIntent(input) {
  const text = input.toLowerCase();

  if (
    text.includes("error") ||
    text.includes("broken") ||
    text.includes("not working") ||
    text.includes("failed") ||
    text.includes("stack trace")
  ) {
    return "debug";
  }

  if (
    text.startsWith("do ") ||
    text.startsWith("run ") ||
    text.startsWith("set ") ||
    text.startsWith("enable ") ||
    text.startsWith("disable ")
  ) {
    return "instruction";
  }

  if (
    text.includes("what do you think") ||
    text.includes("any ideas") ||
    text.includes("could we") ||
    text.includes("should we")
  ) {
    return "exploration";
  }

  if (text.includes("why") || text.includes("how")) {
    return "clarification";
  }

  // Default: user is making an observation
  return "observation";
}

// ---------- Response Mass Limits ----------
const RESPONSE_LIMITS = {
  observation: 2,    // sentences
  instruction: 1,
  clarification: 3,
  exploration: 6,
  debug: 999,        // full verbosity allowed
};

// ---------- Sentence Trimmer ----------
function trimToSentences(text, max) {
  // Split by sentence endings, keeping the punctuation
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  
  if (sentences.length <= max) return text;
  
  return sentences.slice(0, max).join("").trim();
}

// ---------- System-Voice Stripper ----------
function stripSystemVoice(text) {
  return text.replace(
    /(acknowledged\.?|several factors could contribute|to provide a more precise explanation|i can check|system metrics|resource allocation|code optimization|caching|i am aware of|perceived improvement)/gi,
    ""
  ).trim();
}

// ---------- Bridge-Soma Filter ----------
// Run this AFTER the model generates a draft reply
export function bridgeSomaFilter(userInput, modelDraft) {
  const intent = classifyIntent(userInput);
  const limit = RESPONSE_LIMITS[intent];

  let output = stripSystemVoice(modelDraft);
  
  // Clean up any double spaces or leading punctuation left by stripping
  output = output.replace(/^\s*[.,;:]\s*/, "").replace(/\s+/g, " ").trim();
  
  // Uppercase first letter if needed
  if (output.length > 0) {
      output = output.charAt(0).toUpperCase() + output.slice(1);
  }

  output = trimToSentences(output, limit);

  // Hard floor for observations (prevents awkward emptiness)
  if (intent === "observation" && output.length === 0) {
    return "Noted.";
  }

  return output;
}
