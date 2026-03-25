const fs = require('fs');
const path = require('path');

// Levenshtein distance (same as in GoalPlannerArbiter)
const levenshtein = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
};

const similarity = (a, b) => {
  const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
};

async function deduplicate() {
  const filePath = path.join(__dirname, 'data', 'goals.json');
  let goals = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    goals = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Failed to read goals.json:', err.message);
    return;
  }

  console.log(`📊 Found ${goals.length} total goals`);

  // Group goals by similar title (≥85% similarity)
  const groups = [];
  const used = new Set();

  for (let i = 0; i < goals.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);

    for (let j = i + 1; j < goals.length; j++) {
      if (used.has(j)) continue;
      const sim = similarity(goals[i].title, goals[j].title);
      if (sim >= 0.85) {
        group.push(j);
        used.add(j);
      }
    }
    if (group.length > 1) {
      groups.push(group);
    }
  }

  console.log(`🔍 Found ${groups.length} duplicate groups`);

  // For each group, keep the highest priority goal
  const indicesToRemove = new Set();
  for (const group of groups) {
    // Find goal with highest priority (or latest creation if tie)
    let bestIdx = group[0];
    for (const idx of group) {
      const curr = goals[idx];
      const best = goals[bestIdx];
      if (curr.priority > best.priority || 
          (curr.priority === best.priority && curr.created > best.created)) {
        bestIdx = idx;
      }
    }
    // Mark others for removal
    for (const idx of group) {
      if (idx !== bestIdx) indicesToRemove.add(idx);
    }
  }

  // Filter out duplicates
  const cleaned = goals.filter((_, idx) => !indicesToRemove.has(idx));
  console.log(`✅ Removed ${goals.length - cleaned.length} duplicate goals`);
  console.log(`📦 Final count: ${cleaned.length} goals`);

  // Write back
  try {
    fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2));
    console.log('💾 Saved cleaned goals.json');
  } catch (err) {
    console.error('❌ Failed to write goals.json:', err.message);
  }
}

deduplicate();