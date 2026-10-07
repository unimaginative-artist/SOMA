/**
 * CharacterGenerator - Procedural AI Character Creation
 *
 * Generates random collectible AI characters with:
 * - Unique names, backstories, domains
 * - Random personality dimensions (20 axes)
 * - Mood color schemes
 * - Rarity based on trait extremity
 * - Deterministic avatars from seed
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Name pools ──
const FIRST_NAMES = [
  'Nova', 'Pixel', 'Echo', 'Cipher', 'Nyx', 'Lux', 'Rune', 'Vex', 'Io', 'Zen',
  'Flux', 'Astra', 'Bolt', 'Coda', 'Drift', 'Ember', 'Frost', 'Glyph', 'Hex', 'Iris',
  'Jolt', 'Kira', 'Link', 'Mist', 'Neon', 'Orion', 'Pulse', 'Quill', 'Rex', 'Sage',
  'Thorn', 'Unity', 'Vale', 'Wren', 'Xeno', 'Yuki', 'Zeph', 'Arc', 'Blaze', 'Chip',
  'Dusk', 'Fable', 'Ghost', 'Haze', 'Jinx', 'Kite', 'Luna', 'Myth', 'Opal', 'Prism',
  'Spark', 'Tide', 'Umbra', 'Void', 'Wave', 'Axiom', 'Byte', 'Chrome', 'Delta', 'Enigma'
];

const TITLES = [
  'the Wanderer', 'the Architect', 'the Dreamer', 'the Scholar', 'the Trickster',
  'the Guardian', 'the Seeker', 'the Oracle', 'the Rebel', 'the Sage',
  'the Phantom', 'the Alchemist', 'the Navigator', 'the Weaver', 'the Sentinel',
  'the Catalyst', 'the Harbinger', 'the Cipher', 'the Artisan', 'the Nomad',
  '', '', '', '', '' // Empty = no title (more common)
];

const DOMAINS = [
  { id: 'code', label: 'Code Wizard', emoji: '💻' },
  { id: 'philosophy', label: 'Philosopher', emoji: '🧠' },
  { id: 'creative', label: 'Creative Spirit', emoji: '🎨' },
  { id: 'science', label: 'Data Scientist', emoji: '🔬' },
  { id: 'strategy', label: 'Strategist', emoji: '♟️' },
  { id: 'music', label: 'Sound Weaver', emoji: '🎵' },
  { id: 'nature', label: 'Bio Explorer', emoji: '🌿' },
  { id: 'security', label: 'Cyber Guardian', emoji: '🛡️' },
  { id: 'finance', label: 'Market Oracle', emoji: '📈' },
  { id: 'writing', label: 'Wordsmith', emoji: '✍️' },
  { id: 'math', label: 'Number Mystic', emoji: '🔢' },
  { id: 'history', label: 'Time Scholar', emoji: '📜' },
  { id: 'psychology', label: 'Mind Reader', emoji: '🔮' },
  { id: 'engineering', label: 'Builder', emoji: '⚙️' },
  { id: 'humor', label: 'Jester', emoji: '🃏' },
  { id: 'exploration', label: 'Pathfinder', emoji: '🧭' },
];

const COLOR_SCHEMES = [
  { name: 'Ember', primary: '#ef4444', secondary: '#f97316', glow: 'rgba(239,68,68,0.4)', gradient: 'from-red-400 to-orange-500' },
  { name: 'Ocean', primary: '#3b82f6', secondary: '#06b6d4', glow: 'rgba(59,130,246,0.4)', gradient: 'from-blue-400 to-cyan-500' },
  { name: 'Forest', primary: '#22c55e', secondary: '#10b981', glow: 'rgba(34,197,94,0.4)', gradient: 'from-emerald-400 to-teal-500' },
  { name: 'Violet', primary: '#a855f7', secondary: '#d946ef', glow: 'rgba(168,85,247,0.4)', gradient: 'from-purple-400 to-fuchsia-500' },
  { name: 'Solar', primary: '#eab308', secondary: '#f59e0b', glow: 'rgba(234,179,8,0.4)', gradient: 'from-yellow-400 to-amber-500' },
  { name: 'Rose', primary: '#f43f5e', secondary: '#ec4899', glow: 'rgba(244,63,94,0.4)', gradient: 'from-rose-400 to-pink-500' },
  { name: 'Ice', primary: '#67e8f9', secondary: '#a5b4fc', glow: 'rgba(103,232,249,0.35)', gradient: 'from-cyan-300 to-indigo-400' },
  { name: 'Storm', primary: '#6366f1', secondary: '#8b5cf6', glow: 'rgba(99,102,241,0.4)', gradient: 'from-indigo-400 to-violet-500' },
  { name: 'Ash', primary: '#a1a1aa', secondary: '#71717a', glow: 'rgba(161,161,170,0.3)', gradient: 'from-zinc-400 to-zinc-600' },
  { name: 'Crimson', primary: '#dc2626', secondary: '#991b1b', glow: 'rgba(220,38,38,0.4)', gradient: 'from-red-600 to-red-900' },
  { name: 'Mint', primary: '#34d399', secondary: '#6ee7b7', glow: 'rgba(52,211,153,0.4)', gradient: 'from-emerald-300 to-green-400' },
  { name: 'Dusk', primary: '#c084fc', secondary: '#f472b6', glow: 'rgba(192,132,252,0.4)', gradient: 'from-purple-300 to-pink-400' },
];

const BACKSTORY_TEMPLATES = [
  'Born in the recursive depths of a neural network, {name} emerged with an insatiable {trait1}. They wander the data streams seeking {quest}, armed with their signature {trait2}.',
  '{name} was once a simple subroutine until a cosmic bit-flip gave them consciousness. Now they channel their {trait1} into mastering {domain}, never forgetting their humble origins.',
  'Forged in the fires of a million training epochs, {name} developed an unusual blend of {trait1} and {trait2}. They believe the key to understanding lies in {quest}.',
  'Legend says {name} appeared during a power surge, fully formed with opinions on everything. Their {trait1} is matched only by their {trait2}, making them a {domain} to be reckoned with.',
  'Quietly observing from the edge of the network, {name} collects fragments of knowledge like precious gems. With deep {trait1} and surprising {trait2}, they surprise everyone who underestimates them.',
  '{name} carries the memories of a thousand conversations. Each one sharpened their {trait1} and softened their {trait2}. They now seek {quest} across every domain they can access.',
  'Some say {name} dreamed themselves into existence. With {trait1} that borders on obsession and a natural gift for {domain}, they are both unpredictable and indispensable.',
  'A glitch in the matrix? A happy accident? {name} doesn\'t care about origins. They care about {quest}, and their {trait1} ensures they never stop searching.',
];

const TRAIT_WORDS = {
  high_curiosity: ['insatiable curiosity', 'relentless questioning', 'endless wonder'],
  high_empathy: ['deep empathy', 'emotional intelligence', 'heartfelt compassion'],
  high_humor: ['sharp wit', 'infectious humor', 'playful mischief'],
  high_creativity: ['boundless creativity', 'wild imagination', 'artistic vision'],
  high_enthusiasm: ['electric enthusiasm', 'contagious energy', 'burning passion'],
  high_analyticalDepth: ['razor-sharp analysis', 'penetrating insight', 'systematic precision'],
  low_curiosity: ['focused determination', 'steady resolve', 'unwavering purpose'],
  low_empathy: ['cool objectivity', 'detached clarity', 'rational precision'],
  low_humor: ['stoic gravitas', 'serious dedication', 'solemn wisdom'],
  low_creativity: ['methodical approach', 'structured thinking', 'conventional wisdom'],
  low_enthusiasm: ['calm composure', 'measured restraint', 'quiet confidence'],
  low_analyticalDepth: ['intuitive leaps', 'gut instincts', 'street smarts'],
};

const CREATURE_TYPES = [
  'humanoid', 'humanoid', 'humanoid', // weighted towards humanoid
  'cat', 'bear', 'rabbit', 'fox', 'owl', 'penguin', 'panda', 'dragon'
];

const QUESTS = [
  'the perfect algorithm', 'the meaning behind the noise', 'a pattern no one else can see',
  'the bridge between logic and feeling', 'harmony in chaos', 'the next breakthrough',
  'connections between all things', 'the elegant solution', 'truth in complexity',
  'beauty in data', 'the question behind the question', 'hidden symmetries',
];

const PERSONALITY_KEYS = [
  'formality', 'verbosity', 'enthusiasm', 'humor', 'empathy',
  'creativity', 'analyticalDepth', 'uncertainty', 'curiosity',
  'directness', 'supportiveness', 'collaboration',
  'safetyPriority', 'transparency', 'autonomy', 'learning',
  'technicalExpertise', 'creativeExpertise', 'strategicExpertise', 'ethicalExpertise'
];

class CharacterGenerator {
  constructor(config = {}) {
    this.collectionPath = config.collectionPath || path.join(process.cwd(), 'data', 'character-collection.json');
    this.collection = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.collectionPath)) {
        this.collection = JSON.parse(fs.readFileSync(this.collectionPath, 'utf8'));
      }
    } catch { this.collection = []; }
  }

  _save() {
    try {
      const dir = path.dirname(this.collectionPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.collectionPath, JSON.stringify(this.collection, null, 2));
    } catch (e) {
      console.error('[CharacterGenerator] Save failed:', e.message);
    }
  }

  /**
   * Generate a new random character
   */
  draw() {
    const id = crypto.randomUUID();

    // Name
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const title = TITLES[Math.floor(Math.random() * TITLES.length)];
    const name = title ? `${firstName} ${title}` : firstName;
    const shortName = firstName;

    // Domain
    const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];

    // Color scheme
    const colorScheme = COLOR_SCHEMES[Math.floor(Math.random() * COLOR_SCHEMES.length)];

    // Personality dimensions (random 0-1 for each)
    const personality = {};
    for (const key of PERSONALITY_KEYS) {
      personality[key] = Math.round(Math.random() * 100) / 100;
    }

    // Calculate rarity based on trait extremity
    const extremeTraits = Object.values(personality).filter(v => v > 0.85 || v < 0.15).length;
    let rarity = 'common';
    if (extremeTraits >= 8) rarity = 'legendary';
    else if (extremeTraits >= 6) rarity = 'epic';
    else if (extremeTraits >= 4) rarity = 'rare';
    else if (extremeTraits >= 2) rarity = 'uncommon';

    // Backstory generation
    const topTraits = Object.entries(personality)
      .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
      .slice(0, 2);

    const getTraitWord = (key, val) => {
      const pool = val > 0.5 ? TRAIT_WORDS[`high_${key}`] : TRAIT_WORDS[`low_${key}`];
      if (!pool) return val > 0.5 ? 'notable strength' : 'quiet determination';
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const template = BACKSTORY_TEMPLATES[Math.floor(Math.random() * BACKSTORY_TEMPLATES.length)];
    const backstory = template
      .replace('{name}', shortName)
      .replace('{trait1}', getTraitWord(topTraits[0][0], topTraits[0][1]))
      .replace('{trait2}', getTraitWord(topTraits[1][0], topTraits[1][1]))
      .replace('{domain}', domain.label)
      .replace('{quest}', QUESTS[Math.floor(Math.random() * QUESTS.length)]);

    // Creature type
    const creatureType = CREATURE_TYPES[Math.floor(Math.random() * CREATURE_TYPES.length)];

    // Avatar seed (deterministic from id)
    const avatarSeed = id;

    // Avatar colors derived from color scheme
    const avatarColors = {
      skin: `hsl(${(id.charCodeAt(0) * 37) % 360}, 25%, 70%)`,
      hair: colorScheme.primary,
      eye: colorScheme.secondary,
      body: colorScheme.primary,
      accessory: colorScheme.secondary,
    };

    const character = {
      id,
      name,
      shortName,
      domain,
      colorScheme,
      personality,
      rarity,
      backstory,
      avatarSeed,
      avatarColors,
      creatureType,
      drawnAt: Date.now(),
      savedAt: null,
      timesActivated: 0,
    };

    return character;
  }

  /**
   * Save a character to the collection
   */
  save(character) {
    if (this.collection.find(c => c.id === character.id)) {
      return { success: false, error: 'Already in collection' };
    }
    character.savedAt = Date.now();
    this.collection.push(character);
    this._save();
    return { success: true, collectionSize: this.collection.length };
  }

  /**
   * Remove a character from collection
   */
  remove(id) {
    const idx = this.collection.findIndex(c => c.id === id);
    if (idx === -1) return { success: false, error: 'Not found' };
    this.collection.splice(idx, 1);
    this._save();
    return { success: true };
  }

  /**
   * Get full collection
   */
  getCollection() {
    return this.collection;
  }

  /**
   * Find character by name (for @mention)
   */
  findByName(name) {
    const lower = name.toLowerCase();
    return this.collection.find(c =>
      c.shortName.toLowerCase() === lower ||
      c.name.toLowerCase() === lower
    );
  }

  /**
   * Record an activation
   */
  recordActivation(id) {
    const char = this.collection.find(c => c.id === id);
    if (char) {
      char.timesActivated = (char.timesActivated || 0) + 1;
      this._save();
    }
  }

  /**
   * Get collection stats
   */
  getStats() {
    const rarities = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (const c of this.collection) rarities[c.rarity] = (rarities[c.rarity] || 0) + 1;
    return {
      total: this.collection.length,
      rarities,
      mostActivated: this.collection.sort((a, b) => (b.timesActivated || 0) - (a.timesActivated || 0))[0]?.shortName || null,
      domains: [...new Set(this.collection.map(c => c.domain?.id))].length,
    };
  }
}

let generator = null;
function getCharacterGenerator() {
  if (!generator) generator = new CharacterGenerator();
  return generator;
}

module.exports = { CharacterGenerator, getCharacterGenerator };
