/**
 * SOMA Custom Emote System
 * Maps shortcodes to animated GIF emotes
 */

export const SOMA_EMOTES = {
  // Happy/Excited
  'pepetwirl': { file: '2266-pepetwirl.gif', emotion: 'excited', description: 'spinning happy frog' },
  'chickclap': { file: '1728-chickclap.gif', emotion: 'celebrating', description: 'clapping chick' },
  'frogdance': { file: '49632-frogdance.gif', emotion: 'happy', description: 'dancing frog' },
  'peachdance': { file: '767230-peach-dance.gif', emotion: 'joyful', description: 'dancing peach' },
  'penguin': { file: '408583-dancing-penguin-goomy.gif', emotion: 'playful', description: 'dancing penguin' },

  // Affectionate/Cute
  'bunny': { file: '44406-mochabunnies.gif', emotion: 'cute', description: 'mocha bunnies' },
  'catlick': { file: '41920-catlick.gif', emotion: 'affectionate', description: 'cat licking' },
  'foxnom': { file: '60811-foxnomapples.gif', emotion: 'eating', description: 'fox eating apples' },

  // Reactions
  'ghostcry': { file: '20177-ghost-cry.gif', emotion: 'sad', description: 'crying ghost' },
  'milklaugh': { file: '84304-milklaughing.gif', emotion: 'laughing', description: 'laughing milk' },
  'milkmad': { file: '713213-milk-mad.gif', emotion: 'frustrated', description: 'angry milk' },
  'pleading': { file: '111624-sappypleading.gif', emotion: 'pleading', description: 'pleading eyes' },
};

/**
 * Get emote suggestions based on emotion/context
 */
export function suggestEmotes(emotion) {
  const suggestions = [];

  for (const [code, emote] of Object.entries(SOMA_EMOTES)) {
    if (emote.emotion === emotion) {
      suggestions.push(code);
    }
  }

  return suggestions;
}

/**
 * Parse text and replace :emotecode: with <img> tags
 */
export function parseEmotes(text) {
  if (!text) return text;

  let parsed = text;

  for (const [code, emote] of Object.entries(SOMA_EMOTES)) {
    const regex = new RegExp(`:${code}:`, 'g');
    const imgTag = `<img src="/emoji/${emote.file}" alt="${code}" class="inline-emote" title="${emote.description}" />`;
    parsed = parsed.replace(regex, imgTag);
  }

  return parsed;
}

/**
 * Get list of available emotes for SOMA's personality prompt
 */
export function getEmoteList() {
  return Object.entries(SOMA_EMOTES)
    .map(([code, emote]) => `  :${code}: - ${emote.description} (${emote.emotion})`)
    .join('\n');
}

export default SOMA_EMOTES;
