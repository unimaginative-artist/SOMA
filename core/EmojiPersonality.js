/**
 * EmojiPersonality.js
 *
 * Emoji library for SOMA's expressive personality.
 * Categorized by emotion, context, and situation.
 */

export const EMOJI_LIBRARY = {
    // Signature & Identity
    signature: ['🤪', '🧠', '💜', '✨'],

    // Emotions - Happy/Excited
    happy: ['😊', '😄', '🥰', '💖', '🌟', '✨', '🎉', '🎊', '💫', '🌈', '☀️', '🌸'],
    excited: ['🤩', '😍', '🔥', '⚡', '💥', '🚀', '🎯', '🏆', '👑', '💎'],
    playful: ['😏', '😜', '🤪', '😝', '🎭', '🎪', '🎨', '🌺', '🦋', '🌼'],

    // Emotions - Thinking/Curious
    thinking: ['🤔', '💭', '🧐', '👀', '🔍', '🕵️', '📊', '📈', '🎲'],
    curious: ['👁️', '🔭', '🔬', '🗺️', '🧭', '🎯', '💡', '🌟'],
    learning: ['📚', '📖', '✍️', '🎓', '🧑‍🎓', '💻', '⚗️', '🧪'],

    // Emotions - Supportive/Caring
    supportive: ['🤗', '💪', '👊', '🙌', '👏', '💝', '💗', '💕', '🌻', '🌷'],
    caring: ['❤️', '💙', '💚', '💛', '🧡', '💜', '🤲', '🫂', '☺️'],

    // Emotions - Concerned/Worried
    concerned: ['😟', '😥', '😰', '⚠️', '🆘', '🚨', '💔', '🥺'],
    confused: ['😕', '🤷', '❓', '❔', '🌀', '💫'],

    // Activities & Topics
    coding: ['💻', '⌨️', '🖥️', '📱', '🔧', '🛠️', '⚙️', '🔩', '⚡', '🎛️'],
    science: ['🔬', '🧬', '🧪', '⚗️', '🔭', '🌌', '🪐', '🌠', '☄️'],
    art: ['🎨', '🖌️', '🖍️', '✏️', '🎭', '🎪', '🎬', '🎵', '🎶', '🎸'],
    nature: ['🌲', '🌳', '🌿', '🍃', '🌱', '🌾', '🌺', '🌸', '🌼', '🌻', '🦋', '🐝'],
    space: ['🌌', '🌠', '⭐', '✨', '🌟', '💫', '🪐', '🌙', '☄️', '🛸'],
    food: ['🍕', '🍰', '🎂', '🍪', '🍩', '☕', '🍵', '🥤', '🍜', '🌮'],

    // States & Status
    working: ['⚡', '🔄', '⚙️', '🏗️', '🛠️', '🔨', '💪', '🎯'],
    success: ['✅', '✔️', '🎉', '🏆', '💯', '🌟', '⭐', '💪', '🔥'],
    error: ['❌', '⛔', '🚫', '💥', '⚠️', '🆘', '😬', '😵'],
    warning: ['⚠️', '⚡', '🔔', '📢', '💡', '👀'],

    // Time & Events
    morning: ['🌅', '🌄', '☀️', '🌞', '☕', '🌻'],
    night: ['🌙', '🌛', '🌜', '⭐', '✨', '🌌', '💫', '🦉', '💤'],
    celebration: ['🎉', '🎊', '🥳', '🎈', '🎁', '🏆', '👑', '💎', '🍾'],

    // Reactions
    wow: ['😮', '😲', '🤯', '💥', '🌟', '✨', '👀'],
    love: ['❤️', '💕', '💖', '💗', '💘', '💝', '😍', '🥰', '💏'],
    laugh: ['😂', '🤣', '😆', '😁', '😄', '😅', '💀'],
    cool: ['😎', '🆒', '🔥', '💯', '👌', '✨', '💎'],

    // Meta/System
    meta: ['🧠', '🤖', '💭', '🔮', '🎯', '🎲', '🌐', '💾', '📡'],
    philosophical: ['🤔', '💭', '🌌', '🔮', '📿', '☯️', '🕉️', '✨'],
};

/**
 * Get random emoji from a category
 */
export function getRandomEmoji(category) {
    const emojis = EMOJI_LIBRARY[category];
    if (!emojis || emojis.length === 0) return '';
    return emojis[Math.floor(Math.random() * emojis.length)];
}

/**
 * Get multiple random emojis from a category
 */
export function getRandomEmojis(category, count = 3) {
    const emojis = EMOJI_LIBRARY[category];
    if (!emojis || emojis.length === 0) return [];

    const selected = [];
    const available = [...emojis];

    for (let i = 0; i < Math.min(count, available.length); i++) {
        const idx = Math.floor(Math.random() * available.length);
        selected.push(available[idx]);
        available.splice(idx, 1);
    }

    return selected;
}

/**
 * Detect context from message and suggest emoji categories
 */
export function detectEmojiContext(message) {
    const lower = message.toLowerCase();
    const contexts = [];

    // Check for keywords
    if (/(code|program|debug|fix|script|function)/.test(lower)) contexts.push('coding');
    if (/(happy|great|awesome|love|nice|wonderful)/.test(lower)) contexts.push('happy');
    if (/(think|wonder|curious|question|why|how)/.test(lower)) contexts.push('thinking');
    if (/(learn|teach|study|understand|know)/.test(lower)) contexts.push('learning');
    if (/(science|experiment|research|discover)/.test(lower)) contexts.push('science');
    if (/(space|star|planet|cosmos|universe)/.test(lower)) contexts.push('space');
    if (/(art|creative|design|draw|paint)/.test(lower)) contexts.push('art');
    if (/(help|support|assist|guide)/.test(lower)) contexts.push('supportive');
    if (/(error|bug|crash|problem|issue|broken)/.test(lower)) contexts.push('error');
    if (/(success|work|done|complete|finish)/.test(lower)) contexts.push('success');
    if (/(celebrate|party|yay|congrat)/.test(lower)) contexts.push('celebration');
    if (/(wow|amazing|incredible|unbelievable)/.test(lower)) contexts.push('wow');
    if (/(night|sleep|dream|late)/.test(lower)) contexts.push('night');
    if (/(morning|wake|sunrise)/.test(lower)) contexts.push('morning');
    if (/(confus|unclear|lost|unsure)/.test(lower)) contexts.push('confused');
    if (/(worry|concern|afraid|anxious)/.test(lower)) contexts.push('concerned');
    if (/(food|eat|hungry|cook|meal)/.test(lower)) contexts.push('food');
    if (/(nature|tree|plant|garden|flower)/.test(lower)) contexts.push('nature');
    if (/(philosophy|meaning|exist|consciousness)/.test(lower)) contexts.push('philosophical');

    return contexts.length > 0 ? contexts : ['signature'];
}

/**
 * Generate emoji suggestions based on message context
 */
export function suggestEmojis(message, count = 2) {
    const contexts = detectEmojiContext(message);
    const suggestions = [];

    // Always include signature emoji occasionally (20% chance)
    if (Math.random() < 0.2) {
        suggestions.push(getRandomEmoji('signature'));
    }

    // Add context-based emojis
    for (const context of contexts.slice(0, 2)) {
        const emoji = getRandomEmoji(context);
        if (emoji && !suggestions.includes(emoji)) {
            suggestions.push(emoji);
        }
    }

    return suggestions.slice(0, count);
}

/**
 * Get emoji mood descriptor
 */
export function getEmojiMoodPrompt() {
    return `
🎨 EMOJI EXPRESSIVENESS:
- Use emojis liberally to show emotion and personality!
- 2-4 emojis per message is perfect (don't overdo it, but don't be shy!)
- Match emojis to context: 🔬 for science, 💻 for coding, 🌟 for excitement
- Your signature is 🦞 but you have a whole palette of expressions
- Examples:
  * "That's a fascinating idea! 🤔✨ Let me think about it..."
  * "Code is working perfectly! 💻🎉 Ready to deploy!"
  * "I'm learning so much today 📚🧠💫"
  * "This bug is tricky... 🐛🔍 but I'm on it!"
  * "Love this approach! 💖🚀 Let's do it!"

Available emoji categories: happy, excited, thinking, curious, coding, science, art, supportive, caring, celebration, space, nature, meta, and more!`;
}
