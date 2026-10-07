const AVATAR_PALETTE = [
  ['#7c3aed', '#22d3ee'],
  ['#2563eb', '#14b8a6'],
  ['#db2777', '#f59e0b'],
  ['#059669', '#84cc16'],
  ['#dc2626', '#f97316'],
  ['#4f46e5', '#a855f7'],
  ['#0891b2', '#38bdf8'],
  ['#be123c', '#fb7185'],
];

export function stableHash(value = '') {
  let hash = 0;
  for (const char of String(value || 'direct')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

export function isUnstableAvatar(value = '') {
  const url = String(value || '');
  return /picsum\.photos/i.test(url);
}

export function initialsFor(name = '') {
  const parts = String(name || 'Direct')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || 'D').slice(0, 2)).toUpperCase();
}

export function stableAvatar(input: { id?: string | number; name?: string; title?: string; handle?: string; image?: string; avatar?: string } = {}) {
  const existing = String(input.image || input.avatar || '').trim();
  if (existing && !isUnstableAvatar(existing)) return existing;

  const key = String(input.id || input.handle || input.title || input.name || 'direct');
  const name = String(input.name || input.title || input.handle || key);
  const [from, to] = AVATAR_PALETTE[stableHash(key) % AVATAR_PALETTE.length];
  const initials = initialsFor(name);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
    '<defs>',
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
    '</defs>',
    '<rect width="256" height="256" rx="64" fill="url(#g)"/>',
    '<circle cx="205" cy="42" r="64" fill="rgba(255,255,255,0.16)"/>',
    '<circle cx="48" cy="218" r="72" fill="rgba(0,0,0,0.14)"/>',
    `<text x="128" y="145" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="82" font-weight="800" fill="white">${initials}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
