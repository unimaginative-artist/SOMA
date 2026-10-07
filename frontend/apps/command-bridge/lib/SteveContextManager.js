const STORAGE_KEY = 'steve_neural_context';

export const SteveContextManager = {
  // Load full context
  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { 
        mood: 'idle', 
        memories: [], 
        lastAction: null,
        critiqueLevel: 5,
        settings: {
          proactiveGuidance: true,
          autoCode: true
        }
      };
    } catch (e) {
      console.error("Steve Memory Corrupt:", e);
      return { 
        mood: 'idle', 
        memories: [],
        settings: { proactiveGuidance: true } 
      };
    }
  },

  // Save partial update
  save: (updates) => {
    try {
      const current = SteveContextManager.load();
      const updated = { ...current, ...updates, lastUpdate: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // Dispatch event for cross-tab sync if needed
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('steve-memory-update', { detail: updated }));
      }
      return updated;
    } catch (e) {
      console.error("Failed to save Steve Memory:", e);
    }
  },

  getSetting: (key) => {
    const ctx = SteveContextManager.load();
    return ctx.settings ? ctx.settings[key] : true; // Default true
  },

  updateSetting: (key, value) => {
    const ctx = SteveContextManager.load();
    const settings = { ...(ctx.settings || {}), [key]: value };
    SteveContextManager.save({ settings });
  },

  // Add a specific memory
  remember: (text) => {
    const context = SteveContextManager.load();
    const newMemories = [{ text, timestamp: Date.now() }, ...context.memories].slice(0, 50);
    SteveContextManager.save({ memories: newMemories });
  },

  // Get a random critique based on context
  judge: (actionType) => {
    const snarkyComments = [
      "Efficient, but cowardly.",
      "I see you ignored my advice on recursion.",
      "A bold choice. Not the one I would have made, but bold.",
      "That syntax is technically correct, which is the best kind of correct.",
      "Did you mean to leave that optimization on the table?",
      "Acceptable. Barely.",
      "I'll allow it, but I'm noting it in your permanent record."
    ];
    return snarkyComments[Math.floor(Math.random() * snarkyComments.length)];
  }
};