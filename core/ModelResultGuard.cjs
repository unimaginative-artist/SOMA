'use strict';

const RUNTIME_FAILURE_PATTERN = /\b(?:local brain is overloaded|exceeded my time budget|neural link unstable|retry in a moment|reasoning pipeline.+failed|local heartbeat also failed|provider unavailable|model(?: request)? timed? out)\b/i;

function textOfModelResult(result) {
  if (typeof result === 'string') return result.trim();
  return String(result?.text || result?.response || result?.message || '').trim();
}

function inspectModelResult(result) {
  const text = textOfModelResult(result);
  const metadataFailure = Boolean(
    result && typeof result === 'object' && (
      result.ok === false || result.degraded === true || result.retryable === true
      || result.errorCode || result.error
    )
  );
  const textFailure = RUNTIME_FAILURE_PATTERN.test(text);
  return {
    usable: Boolean(text) && !metadataFailure && !textFailure,
    text,
    reason: !text ? 'empty_model_result'
      : metadataFailure ? `degraded_model_result:${result.errorCode || result.error || 'metadata'}`
        : textFailure ? 'runtime_failure_text' : null
  };
}

function requireUsableModelResult(result, stage = 'model') {
  const inspected = inspectModelResult(result);
  if (!inspected.usable) {
    const error = new Error(`${stage}:${inspected.reason}`);
    error.code = 'UNUSABLE_MODEL_RESULT';
    error.stage = stage;
    throw error;
  }
  return inspected.text;
}

module.exports = {
  RUNTIME_FAILURE_PATTERN,
  textOfModelResult,
  inspectModelResult,
  requireUsableModelResult,
  isRuntimeFailureText: value => RUNTIME_FAILURE_PATTERN.test(String(value || ''))
};
