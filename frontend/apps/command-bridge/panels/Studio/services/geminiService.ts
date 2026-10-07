
async function somaAsk(prompt: string, sessionId = 'studio-ai'): Promise<string> {
  const res = await fetch('/api/soma/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt, conversationHistory: [], sessionId, silent: true, source: 'studio-utility' }),
  });
  if (!res.ok) throw new Error(`SOMA ${res.status}`);
  const data = await res.json();
  return (data.response || data.message || '').trim();
}

export const generateOracleInsight = async (context: string): Promise<string> => {
  try {
    return await somaAsk(
      `You are a cryptic but inspiring voice in a retro-futuristic dashboard. Based on this context: "${context}", generate a short profound "oblique strategy" or creative prompt. Under 30 words. Sound like a transmission from the future. No quotes.`,
      'studio-oracle'
    );
  } catch {
    return 'Signal interrupted. Realigning creative matrix...';
  }
};

export const analyzeVibe = async (): Promise<string> => {
  try {
    const raw = await somaAsk(
      'Give me exactly a 3-word abstract aesthetic description for a high-tech portfolio dashboard, like "Neon Glitch Silence" or "Velvet Void Echo". Respond with ONLY the 3 words, nothing else.',
      'studio-vibe'
    );
    return raw || 'Static Void Null';
  } catch {
    return 'Static Void Null';
  }
};

export type ArtifactType = 'MYTH' | 'QUOTE' | 'CONCEPT';

export interface CreativeArtifact {
  type: ArtifactType;
  content: string;
  title?: string;
}

export const generateCreativeArtifact = async (userContext: any): Promise<CreativeArtifact> => {
  try {
    const ctx = [
      `Name: ${userContext.name || 'Unknown'}`,
      `Role: ${userContext.role || 'Creator'}`,
      `Bio: ${userContext.bio || ''}`,
      `Manifesto: ${userContext.manifesto || ''}`,
    ].join('\n');

    const raw = await somaAsk(
      `You are the Creative Engine of a personal dashboard — a generative mirror, not a chatbot.\nUser:\n${ctx}\n\nGenerate ONE creative artifact. Pick the type that fits best:\n- MYTH: 2-sentence micro-myth/fable that metaphorically reflects their identity\n- QUOTE: profound aphorism in their voice, artistic/cyberpunk, not generic motivation\n- CONCEPT: specific avant-garde idea for a visual project they could build\n\nRespond ONLY with valid JSON: {"type":"MYTH"|"QUOTE"|"CONCEPT","title":"2-3 word cryptic title","content":"the text"}`,
      'studio-inspire'
    );

    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed?.type && parsed?.content) return parsed as CreativeArtifact;
    }
    return { type: 'QUOTE', title: 'SIGNAL', content: raw.slice(0, 200) };
  } catch {
    return { type: 'QUOTE', title: 'SYSTEM GLITCH', content: 'The void stares back, but today it is silent. Try again.' };
  }
};

export const generateAvatar = async (userContext: any): Promise<string | null> => {
  try {
    const seed = localAestheticSeed(userContext, 'creator');
    return makeGeneratedAvatar(seed, userContext);
  } catch {
    return null;
  }
};

export const generateCoverImage = async (userContext: any): Promise<string | null> => {
  try {
    const seed = localAestheticSeed(userContext, 'abstract');
    return makeGeneratedCover(seed, userContext);
  } catch {
    return null;
  }
};

function localAestheticSeed(userContext: any, fallback: string) {
  const text = `${userContext.role || ''} ${userContext.bio || ''}`.toLowerCase();
  const rules = [
    ['steel', /\b(builder|operator|system|infrastructure|command|bridge|engineer|architecture)\b/],
    ['neural', /\b(ai|soma|agent|autonomous|cognitive|mind|intelligence)\b/],
    ['market', /\b(trading|market|finance|risk|alpha)\b/],
    ['archive', /\b(reflection|memory|notes|knowledge|research)\b/],
    ['creative', /\b(art|creative|story|muse|portfolio|studio)\b/],
    ['forest', /\b(health|medical|biotech|helping|healing)\b/],
  ] as const;
  const match = rules.find(([, pattern]) => pattern.test(text));
  return (match?.[0] || fallback).toLowerCase().slice(0, 20);
}

function hashSeed(value = '') {
  let hash = 0;
  for (const char of String(value || 'studio')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function initialsFor(name = '') {
  const parts = String(name || 'Studio')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || 'S').slice(0, 2)).toUpperCase();
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function paletteFor(seed: string) {
  const palettes = [
    ['#7c3aed', '#22d3ee', '#f8fafc'],
    ['#0f766e', '#84cc16', '#ecfeff'],
    ['#be123c', '#f97316', '#fff7ed'],
    ['#2563eb', '#14b8a6', '#eff6ff'],
    ['#581c87', '#db2777', '#fdf2f8'],
    ['#111827', '#64748b', '#f8fafc'],
  ];
  return palettes[hashSeed(seed) % palettes.length];
}

function makeGeneratedAvatar(seed: string, userContext: any) {
  const [from, to, text] = paletteFor(`${seed}:${userContext.role || ''}`);
  const initials = initialsFor(userContext.name || userContext.role || seed);
  const orbit = 44 + (hashSeed(seed) % 32);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    '<defs>',
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
    '<radialGradient id="glow" cx="50%" cy="44%" r="62%"><stop offset="0" stop-color="rgba(255,255,255,.42)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>',
    '</defs>',
    '<rect width="512" height="512" rx="128" fill="url(#bg)"/>',
    '<circle cx="256" cy="224" r="182" fill="url(#glow)"/>',
    `<circle cx="256" cy="256" r="${orbit}" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="10"/>`,
    '<path d="M110 344c52-88 244-88 296 0" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="22" stroke-linecap="round"/>',
    '<circle cx="386" cy="102" r="72" fill="rgba(255,255,255,.16)"/>',
    '<circle cx="104" cy="410" r="92" fill="rgba(0,0,0,.16)"/>',
    `<text x="256" y="292" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="132" font-weight="900" fill="${text}">${initials}</text>`,
    '</svg>',
  ].join('');
  return svgDataUrl(svg);
}

function makeGeneratedCover(seed: string, userContext: any) {
  const [from, to] = paletteFor(`${seed}:cover:${userContext.bio || ''}`);
  const title = String(seed || 'studio').toUpperCase().slice(0, 18);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520">',
    '<defs>',
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset=".55" stop-color="#050505"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
    '<radialGradient id="a" cx="24%" cy="34%" r="46%"><stop offset="0" stop-color="rgba(255,255,255,.24)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>',
    '<radialGradient id="b" cx="78%" cy="64%" r="48%"><stop offset="0" stop-color="rgba(255,255,255,.16)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>',
    '</defs>',
    '<rect width="1600" height="520" fill="url(#bg)"/>',
    '<rect width="1600" height="520" fill="url(#a)"/>',
    '<rect width="1600" height="520" fill="url(#b)"/>',
    '<g opacity=".28" stroke="white" stroke-width="2" fill="none">',
    '<path d="M120 350 C 320 140, 470 430, 680 210 S 1050 130, 1240 310 S 1460 420, 1540 180"/>',
    '<path d="M60 210 C 260 310, 430 90, 650 260 S 940 450, 1140 190 S 1400 80, 1560 260"/>',
    '</g>',
    '<g opacity=".2">',
    '<circle cx="230" cy="164" r="8" fill="white"/><circle cx="520" cy="280" r="6" fill="white"/><circle cx="850" cy="172" r="10" fill="white"/><circle cx="1210" cy="322" r="7" fill="white"/><circle cx="1450" cy="190" r="9" fill="white"/>',
    '</g>',
    `<text x="96" y="430" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="900" letter-spacing="8" fill="rgba(255,255,255,.42)">${title}</text>`,
    '</svg>',
  ].join('');
  return svgDataUrl(svg);
}

export const chatWithAgent = async (message: string): Promise<string> => {
  try {
    return await somaAsk(
      `You are SOMA managing a creator's Studio dashboard. User says: "${message}". Respond in under 20 words. Efficient, slightly cyberpunk.`,
      'studio-agent'
    );
  } catch {
    return 'Connection unstable.';
  }
};
