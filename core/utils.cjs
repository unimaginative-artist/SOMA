// core/utils.cjs

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function expDecay(value, lambda, ageMs) {
  return value * Math.exp(-lambda * ageMs);
}

module.exports = {
  clamp,
  expDecay
};