/**
 * UserProfileArbiter.js - SOMA's User Memory System
 *
 * Remembers information about users across sessions.
 * Stores preferences, context, and builds relationships over time.
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export class UserProfileArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'UserProfileArbiter';
    
    // Configuration
    this.storageDir = config.storageDir || path.join(process.cwd(), 'SOMA', 'user-profiles');
    this.currentUserId = 'default_user';
    
    // In-memory profile cache
    this.profiles = new Map();
    
    console.log(`[${this.name}] 👤 User Profile system initialized`);
  }

  async initialize(arbiters = {}) {
    console.log(`[${this.name}] 🌱 Initializing user profile system...`);

    // Ensure storage directory exists
    await fs.mkdir(this.storageDir, { recursive: true });

    // Load existing profiles
    await this.loadProfiles();

    // Create default user profile if it doesn't exist
    if (!this.profiles.has('default_user')) {
      await this.createProfile('default_user', {
        name: 'User',
        createdAt: Date.now()
      });
    }

    console.log(`[${this.name}] ✅ User profile system ready`);
    console.log(`[${this.name}]    Loaded profiles: ${this.profiles.size}`);

    this.emit('initialized');
  }

  /**
   * Load all profiles from disk
   */
  async loadProfiles() {
    try {
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = file.replace('.json', '');
          const filePath = path.join(this.storageDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const profile = JSON.parse(data);
          
          this.profiles.set(userId, profile);
        }
      }
      
      console.log(`[${this.name}] 📚 Loaded ${this.profiles.size} user profiles`);
    } catch (error) {
      console.log(`[${this.name}] No existing profiles found (starting fresh)`);
    }
  }

  /**
   * Create a new user profile
   */
  async createProfile(userId, initialData = {}) {
    const profile = {
      userId,
      name: initialData.name || 'User',
      preferences: {
        communicationStyle: 'balanced', // casual, professional, balanced
        detailLevel: 'medium', // brief, medium, detailed
        useEmojis: true,
        technicalLevel: 'medium' // beginner, medium, advanced
      },
      memory: {
        name: initialData.name || null,
        location: null,
        occupation: null,
        interests: [],
        goals: [],
        projects: []
      },
      conversationContext: {
        topics: new Map(), // topic -> frequency
        lastDiscussed: {},
        favoriteTopics: []
      },
      relationship: {
        firstInteraction: Date.now(),
        lastInteraction: Date.now(),
        totalInteractions: 0,
        sentiment: 0.5, // 0 = negative, 1 = positive
        trust: 0.5 // How much user seems to trust SOMA's suggestions
      },
      notes: [], // Important things to remember
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    };

    this.profiles.set(userId, profile);
    await this.saveProfile(userId);

    console.log(`[${this.name}] 🆕 Created new profile: ${userId}`);

    return profile;
  }

  /**
   * Get user profile
   */
  getProfile(userId = null) {
    const id = userId || this.currentUserId;
    return this.profiles.get(id) || null;
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    const profile = this.profiles.get(userId);
    
    if (!profile) {
      console.warn(`[${this.name}] Profile not found: ${userId}`);
      return null;
    }

    // Deep merge updates
    const updatedProfile = this.deepMerge(profile, updates);
    updatedProfile.metadata.updatedAt = Date.now();

    this.profiles.set(userId, updatedProfile);
    await this.saveProfile(userId);

    this.emit('profile_updated', { userId, updates });

    return updatedProfile;
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }

  /**
   * Remember a fact about the user
   */
  async rememberFact(userId, category, fact) {
    const profile = this.getProfile(userId);
    
    if (!profile) {
      await this.createProfile(userId);
    }

    const updatedProfile = this.profiles.get(userId);

    if (category === 'name') {
      updatedProfile.memory.name = fact;
      updatedProfile.name = fact;
    } else if (category === 'interest') {
      if (!updatedProfile.memory.interests.includes(fact)) {
        updatedProfile.memory.interests.push(fact);
      }
    } else if (category === 'goal') {
      if (!updatedProfile.memory.goals.includes(fact)) {
        updatedProfile.memory.goals.push(fact);
      }
    } else if (category === 'project') {
      const existing = updatedProfile.memory.projects.find(p => p.name === fact);
      if (!existing) {
        updatedProfile.memory.projects.push({
          name: fact,
          startedAt: Date.now(),
          lastMentioned: Date.now()
        });
      }
    } else {
      // Store as general note
      updatedProfile.notes.push({
        content: fact,
        category,
        timestamp: Date.now()
      });
    }

    await this.saveProfile(userId);

    console.log(`[${this.name}] 💭 Remembered: ${category} -> ${fact}`);
  }

  /**
   * Update conversation context
   */
  async updateConversationContext(userId, topic) {
    const profile = this.getProfile(userId);
    
    if (!profile) {
      return;
    }

    // Convert Map to object for storage
    const topicsObj = profile.conversationContext.topics instanceof Map 
      ? Object.fromEntries(profile.conversationContext.topics)
      : profile.conversationContext.topics;

    const currentCount = topicsObj[topic] || 0;
    topicsObj[topic] = currentCount + 1;

    profile.conversationContext.topics = topicsObj;
    profile.conversationContext.lastDiscussed[topic] = Date.now();

    // Update favorite topics (top 5)
    const sortedTopics = Object.entries(topicsObj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    profile.conversationContext.favoriteTopics = sortedTopics;

    await this.saveProfile(userId);
  }

  /**
   * Update relationship metrics
   */
  async updateRelationship(userId, interaction) {
    const profile = this.getProfile(userId);
    
    if (!profile) {
      return;
    }

    profile.relationship.lastInteraction = Date.now();
    profile.relationship.totalInteractions++;

    // Update sentiment based on interaction
    if (interaction.positive) {
      profile.relationship.sentiment = Math.min(1, profile.relationship.sentiment + 0.05);
      profile.relationship.trust = Math.min(1, profile.relationship.trust + 0.02);
    } else if (interaction.negative) {
      profile.relationship.sentiment = Math.max(0, profile.relationship.sentiment - 0.05);
      profile.relationship.trust = Math.max(0, profile.relationship.trust - 0.02);
    }

    await this.saveProfile(userId);
  }

  /**
   * Set user preferences
   */
  async setPreferences(userId, preferences) {
    const profile = this.getProfile(userId);
    
    if (!profile) {
      return;
    }

    profile.preferences = {
      ...profile.preferences,
      ...preferences
    };

    await this.saveProfile(userId);

    console.log(`[${this.name}] ⚙️ Updated preferences for ${userId}`);
  }

  /**
   * Get personalized context for AI
   */
  getPersonalizedContext(userId = null) {
    const id = userId || this.currentUserId;
    const profile = this.getProfile(id);

    if (!profile) {
      return null;
    }

    const context = [];

    // User identity
    if (profile.memory.name) {
      context.push(`The user's name is ${profile.memory.name}.`);
    }

    // User interests
    if (profile.memory.interests.length > 0) {
      context.push(`User interests: ${profile.memory.interests.join(', ')}.`);
    }

    // User goals
    if (profile.memory.goals.length > 0) {
      context.push(`User goals: ${profile.memory.goals.join(', ')}.`);
    }

    // Active projects
    if (profile.memory.projects.length > 0) {
      const projectNames = profile.memory.projects.map(p => p.name);
      context.push(`User projects: ${projectNames.join(', ')}.`);
    }

    // Communication preferences
    if (profile.preferences.communicationStyle !== 'balanced') {
      context.push(`Preferred communication style: ${profile.preferences.communicationStyle}.`);
    }

    // Recent topics
    if (profile.conversationContext.favoriteTopics.length > 0) {
      context.push(`Recent discussion topics: ${profile.conversationContext.favoriteTopics.join(', ')}.`);
    }

    // Relationship info
    const daysSinceFirst = Math.floor((Date.now() - profile.relationship.firstInteraction) / (1000 * 60 * 60 * 24));
    if (daysSinceFirst > 0) {
      context.push(`You've been interacting with this user for ${daysSinceFirst} days.`);
    }

    return context.join(' ');
  }

  /**
   * Save profile to disk
   */
  async saveProfile(userId) {
    try {
      const profile = this.profiles.get(userId);
      
      if (!profile) {
        return;
      }

      const filePath = path.join(this.storageDir, `${userId}.json`);
      
      // Convert Map to object for JSON serialization
      const serializable = JSON.parse(JSON.stringify(profile, (key, value) => {
        if (value instanceof Map) {
          return Object.fromEntries(value);
        }
        return value;
      }));

      await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (error) {
      console.error(`[${this.name}] Failed to save profile ${userId}:`, error.message);
    }
  }

  /**
   * Get all profiles
   */
  getAllProfiles() {
    return Array.from(this.profiles.values());
  }

  /**
   * Get statistics
   */
  getStats() {
    const profiles = Array.from(this.profiles.values());
    
    return {
      totalProfiles: profiles.length,
      totalInteractions: profiles.reduce((sum, p) => sum + p.relationship.totalInteractions, 0),
      averageSentiment: profiles.reduce((sum, p) => sum + p.relationship.sentiment, 0) / profiles.length,
      averageTrust: profiles.reduce((sum, p) => sum + p.relationship.trust, 0) / profiles.length
    };
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Saving user profiles...`);
    
    // Save all profiles
    for (const userId of this.profiles.keys()) {
      await this.saveProfile(userId);
    }

    console.log(`[${this.name}] User profiles saved`);
  }
}

export default UserProfileArbiter;
