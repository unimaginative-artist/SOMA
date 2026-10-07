// Test function for NEMESIS review
async function testOptimizationTarget(items) {
  // Intentionally inefficient O(n²) duplicate finder
  let result = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (items[i] === items[j] && i !== j) {
        result.push(items[i]);
      }
    }
  }
  return result;
}

module.exports = { testOptimizationTarget };
