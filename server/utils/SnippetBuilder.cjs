function buildSnippet(content, query, maxLen = 280) {
  if (!content) return '';
  if (!query || typeof query !== 'string') {
    return content.length > maxLen ? `${content.slice(0, maxLen)}…` : content;
  }

  const lower = content.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2);

  let idx = -1;
  for (const term of terms) {
    idx = lower.indexOf(term);
    if (idx !== -1) break;
  }

  if (idx === -1) {
    return content.length > maxLen ? `${content.slice(0, maxLen)}…` : content;
  }

  const start = Math.max(0, idx - Math.floor(maxLen / 2));
  const end = Math.min(content.length, start + maxLen);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

module.exports = { buildSnippet };
