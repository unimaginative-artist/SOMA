// ════════════════════════════════════════════════════════════════════════════
// TheoryOfMindArbiter — User Mental State Modeling & Social Intelligence
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Model user mental states, infer intent, track knowledge, and adapt
// responses based on perspective-taking
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const fs = require('fs').promises;
const path = require('path');

class TheoryOfMindArbiter extends BaseArbiter {
  static role = 'theory-of-mind';
  static capabilities = [
    'infer-user-intent',
    'model-user-knowledge',
    'predict-user-reaction',
    'adapt-to-user-level',
    'build-user-profile',
    'track-preferences',
    'detect-confusion',
    'perspective-taking',
    'generate-clarifications'
  ];

  constructor(id, config = {}) {
    super(id, config);

    this.name = 'TheoryOfMindArbiter';
    this.config = {
      userProfilePath: config.userProfilePath || path.join(__dirname, '../data/user-profiles'),
      intentConfidenceThreshold: config.intentConfidenceThreshold || 0.7,
      confusionThreshold: config.confusionThreshold || 0.6,
      adaptiveResponseEnabled: config.adaptiveResponseEnabled !== false,
      maxInteractionHistory: config.maxInteractionHistory || 1000,
      ...config
    };

    // User profiles: userId -> profile data
    this.userProfiles = new Map();

    // Intent history: interactionId -> inferred intent
    this.intentHistory = new Map();

    // Interaction tracking
    this.interactionLog = [];

    // Knowledge state tracking: userId -> knowledge domains
    this.userKnowledgeStates = new Map();

    // Preference models: userId -> preferences
    this.userPreferences = new Map();

    // Confusion patterns
    this.confusionPatterns = new Set([
      'what do you mean',
      'i don\'t understand',
      'can you explain',
      'confused',
      'unclear',
      'not sure what',
      'how does that work',
      'what is'
    ]);

    console.log(`[TheoryOfMindArbiter] Initialized with config:`, {
      intentThreshold: this.config.intentConfidenceThreshold,
      confusionThreshold: this.config.confusionThreshold,
      adaptiveResponses: this.config.adaptiveResponseEnabled
    });
  }

  /**
   * Lifecycle: Activate arbiter
   */
  async onActivate() {
    console.log(`[${this.name}] 🧠 Activating Theory of Mind system...`);

    // Load existing user profiles
    await this.loadUserProfiles();

    // Subscribe to interaction events
    this.subscribeToEvents();

    // Start periodic profile updates
    this.startProfileMaintenance();

    console.log(`[${this.name}] ✅ Theory of Mind active`);
  }

  /**
   * Subscribe to relevant events
   */
  subscribeToEvents() {
    const events = [
      'user_message',
      'user_interaction',
      'response_generated',
      'user_feedback',
      'clarification_needed',
      'task_completed',
      'error_occurred'
    ];

    for (const event of events) {
      messageBroker.subscribe(this.name, event);
    }

    // Handle user interactions
    messageBroker.on('user_message', async (msg) => {
      await this.handleUserMessage(msg.payload);
    });

    messageBroker.on('user_interaction', async (msg) => {
      await this.processInteraction(msg.payload);
    });

    messageBroker.on('user_feedback', async (msg) => {
      await this.updateFromFeedback(msg.payload);
    });

    console.log(`[${this.name}] 📡 Subscribed to ${events.length} events`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER MENTAL STATE MODELING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Infer user intent from interaction
   */
  async inferUserIntent(interaction) {
    const { userId, message, context = {} } = interaction;

    // Analyze message patterns
    const patterns = this.analyzeMessagePatterns(message);

    // Get user history
    const profile = this.getUserProfile(userId);
    const recentInteractions = this.getRecentInteractions(userId, 10);

    // Infer intent
    const intent = {
      primary: null,
      confidence: 0,
      alternatives: [],
      reasoning: []
    };

    // Intent classification rules
    if (this.isQuestion(message)) {
      intent.primary = 'seek_information';
      intent.confidence = 0.9;
      intent.reasoning.push('Message contains question markers');
    } else if (this.isCommand(message)) {
      intent.primary = 'request_action';
      intent.confidence = 0.85;
      intent.reasoning.push('Message contains imperative language');
    } else if (this.isConfused(message)) {
      intent.primary = 'seek_clarification';
      intent.confidence = 0.95;
      intent.reasoning.push('User expressing confusion');
    } else if (this.isFeedback(message)) {
      intent.primary = 'provide_feedback';
      intent.confidence = 0.8;
      intent.reasoning.push('Message contains evaluative language');
    } else if (this.isExploration(message)) {
      intent.primary = 'explore_capability';
      intent.confidence = 0.75;
      intent.reasoning.push('User exploring system capabilities');
    } else {
      intent.primary = 'general_conversation';
      intent.confidence = 0.6;
      intent.reasoning.push('No clear intent pattern detected');
    }

    // Adjust based on context
    if (context.previousIntent === intent.primary) {
      intent.confidence = Math.min(0.95, intent.confidence + 0.1);
      intent.reasoning.push('Consistent with previous interaction');
    }

    // Store intent
    this.intentHistory.set(interaction.id || Date.now(), intent);

    // Emit intent inference event
    await messageBroker.publish('intent_inferred', {
      userId,
      intent: intent.primary,
      confidence: intent.confidence,
      timestamp: Date.now()
    });

    return intent;
  }

  /**
   * Model user knowledge in specific domain
   */
  async modelUserKnowledge(userId, domain = 'general') {
    const profile = this.getUserProfile(userId);
    const interactions = this.getRecentInteractions(userId, 50);

    // Initialize knowledge state
    if (!this.userKnowledgeStates.has(userId)) {
      this.userKnowledgeStates.set(userId, new Map());
    }
    const knowledgeMap = this.userKnowledgeStates.get(userId);

    // Analyze interactions for knowledge signals
    const knowledgeState = {
      domain,
      level: 'beginner', // beginner, intermediate, advanced, expert
      confidence: 0,
      signals: {
        questionsAsked: 0,
        technicalTermsUsed: 0,
        complexConceptsGrasped: 0,
        independentProblemSolving: 0
      },
      gaps: [],
      strengths: []
    };

    // Count signals from interactions
    for (const interaction of interactions) {
      const isBasicQ = this.isBasicQuestion(interaction.message);

      if (this.isQuestion(interaction.message)) {
        knowledgeState.signals.questionsAsked++;

        // Basic questions indicate beginner
        if (isBasicQ) {
          knowledgeState.gaps.push('Basic concepts');
        }
      }

      // Don't count technical language if it's in a "what is X?" question
      // (asking what something is means you don't know it)
      if (this.hasTechnicalLanguage(interaction.message) && !isBasicQ) {
        knowledgeState.signals.technicalTermsUsed++;
      }

      if (this.showsProblemSolving(interaction.message)) {
        knowledgeState.signals.independentProblemSolving++;
      }
    }

    // Estimate expertise level
    const technicalRatio = knowledgeState.signals.technicalTermsUsed / Math.max(1, interactions.length);
    const solvingRatio = knowledgeState.signals.independentProblemSolving / Math.max(1, interactions.length);

    if (technicalRatio > 0.5 && solvingRatio > 0.3) {
      knowledgeState.level = 'expert';
      knowledgeState.confidence = 0.85;
    } else if (technicalRatio > 0.3 && solvingRatio > 0.2) {
      knowledgeState.level = 'advanced';
      knowledgeState.confidence = 0.8;
    } else if (technicalRatio > 0.15 || solvingRatio > 0.1) {
      knowledgeState.level = 'intermediate';
      knowledgeState.confidence = 0.75;
    } else {
      knowledgeState.level = 'beginner';
      knowledgeState.confidence = 0.7;
    }

    // Store knowledge state
    knowledgeMap.set(domain, knowledgeState);

    return knowledgeState;
  }

  /**
   * Predict how user will react to a response
   */
  async predictUserReaction(userId, proposedResponse) {
    const profile = this.getUserProfile(userId);
    const knowledgeState = await this.modelUserKnowledge(userId);
    const preferences = this.getUserPreferences(userId);

    const prediction = {
      likelyReaction: 'neutral',
      confidence: 0,
      concerns: [],
      suggestions: []
    };

    // Check if response matches user level
    const responseComplexity = this.assessComplexity(proposedResponse);
    if (responseComplexity > knowledgeState.level && knowledgeState.level === 'beginner') {
      prediction.likelyReaction = 'confused';
      prediction.confidence = 0.8;
      prediction.concerns.push('Response may be too complex for user level');
      prediction.suggestions.push('Simplify language and add examples');
    }

    // Check if response is too verbose/terse
    const wordCount = proposedResponse.split(/\s+/).length;
    if (preferences.communicationStyle === 'concise' && wordCount > 200) {
      prediction.likelyReaction = 'impatient';
      prediction.confidence = 0.7;
      prediction.concerns.push('Response too verbose for user preference');
      prediction.suggestions.push('Condense to key points');
    }

    // Check if response addresses user's likely intent
    const recentIntent = Array.from(this.intentHistory.values()).slice(-1)[0];
    if (recentIntent && recentIntent.primary === 'seek_clarification') {
      if (!this.containsExplanation(proposedResponse)) {
        prediction.likelyReaction = 'unsatisfied';
        prediction.confidence = 0.75;
        prediction.concerns.push('User seeking clarification but response lacks explanation');
        prediction.suggestions.push('Add step-by-step explanation');
      }
    }

    // Default to positive if no concerns
    if (prediction.concerns.length === 0) {
      prediction.likelyReaction = 'satisfied';
      prediction.confidence = 0.6;
    }

    return prediction;
  }

  /**
   * Adapt content to user's expertise level
   */
  async adaptToUserLevel(userId, content) {
    const knowledgeState = await this.modelUserKnowledge(userId);

    let adapted = content;

    switch (knowledgeState.level) {
      case 'beginner':
        adapted = this.simplifyForBeginner(content);
        break;
      case 'intermediate':
        adapted = this.balanceForIntermediate(content);
        break;
      case 'advanced':
      case 'expert':
        adapted = this.enrichForAdvanced(content);
        break;
    }

    return {
      original: content,
      adapted,
      level: knowledgeState.level,
      confidence: knowledgeState.confidence
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER PROFILE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build comprehensive user profile
   */
  async buildUserProfile(userId) {
    const existingProfile = this.userProfiles.get(userId);

    const profile = {
      userId,
      created: existingProfile?.created || Date.now(),
      lastInteraction: Date.now(),
      totalInteractions: (existingProfile?.totalInteractions || 0) + 1,

      // Demographics (inferred)
      inferredExpertise: 'intermediate',
      communicationStyle: 'balanced', // concise, balanced, detailed

      // Interaction patterns
      averageResponseTime: 0,
      preferredTimeOfDay: [],
      sessionDuration: [],

      // Knowledge tracking
      knowledgeDomains: new Map(),
      learningVelocity: 1.0,

      // Preferences
      preferences: {
        technicalDepth: 'medium',
        examplePreference: true,
        stepByStepGuidance: false,
        proactiveHelp: false
      },

      // History
      recentTopics: [],
      commonTasks: [],
      errorPatterns: [],

      // Emotional patterns
      frustrationIndicators: [],
      satisfactionIndicators: [],

      // Goals (inferred)
      likelyGoals: [],
      completedGoals: []
    };

    this.userProfiles.set(userId, profile);
    await this.saveUserProfile(userId, profile);

    // Return a shallow copy to avoid reference issues in tests
    return { ...profile };
  }

  /**
   * Update user model based on interaction
   */
  async updateUserModel(userId, interaction) {
    let profile = this.userProfiles.get(userId);

    if (!profile) {
      profile = await this.buildUserProfile(userId);
    }

    // Update interaction count
    profile.totalInteractions++;
    profile.lastInteraction = Date.now();

    // Track topics
    const topics = this.extractTopics(interaction.message);
    for (const topic of topics) {
      if (!profile.recentTopics.includes(topic)) {
        profile.recentTopics.unshift(topic);
        if (profile.recentTopics.length > 20) {
          profile.recentTopics.pop();
        }
      }
    }

    // Detect preference signals
    if (interaction.message.length < 50) {
      profile.preferences.communicationStyle = 'concise';
    } else if (interaction.message.length > 200) {
      profile.preferences.communicationStyle = 'detailed';
    }

    // Detect frustration
    if (this.showsFrustration(interaction.message)) {
      profile.frustrationIndicators.push({
        timestamp: Date.now(),
        context: interaction.message.substring(0, 100)
      });
    }

    // Save updated profile
    this.userProfiles.set(userId, profile);
    await this.saveUserProfile(userId, profile);

    // Return a shallow copy to avoid reference issues
    return { ...profile };
  }

  /**
   * Get user preferences
   */
  getUserPreferences(userId) {
    const profile = this.userProfiles.get(userId);

    return profile?.preferences || {
      technicalDepth: 'medium',
      examplePreference: true,
      stepByStepGuidance: false,
      proactiveHelp: false,
      communicationStyle: 'balanced'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSPECTIVE-TAKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Simulate user's perspective on a scenario
   */
  async simulateUserPerspective(userId, scenario) {
    const profile = this.getUserProfile(userId);
    const knowledgeState = await this.modelUserKnowledge(userId);
    const preferences = this.getUserPreferences(userId);

    const perspective = {
      userId,
      scenario,
      likelyUnderstanding: 'partial',
      predictedQuestions: [],
      anticipatedChallenges: [],
      recommendedApproach: ''
    };

    // Simulate comprehension based on knowledge level
    if (knowledgeState.level === 'beginner') {
      perspective.likelyUnderstanding = 'surface';
      perspective.predictedQuestions.push('What does that mean?');
      perspective.predictedQuestions.push('Can you show an example?');
      perspective.anticipatedChallenges.push('Technical jargon may be unfamiliar');
      perspective.recommendedApproach = 'Start with basics, use analogies, provide examples';
    } else if (knowledgeState.level === 'expert') {
      perspective.likelyUnderstanding = 'deep';
      perspective.predictedQuestions.push('What are the edge cases?');
      perspective.predictedQuestions.push('How does this compare to alternatives?');
      perspective.anticipatedChallenges.push('May want more implementation details');
      perspective.recommendedApproach = 'Focus on nuances, trade-offs, and advanced concepts';
    }

    return perspective;
  }

  /**
   * Identify if user is confused
   */
  async identifyUserConfusion(interaction) {
    const { message, userId, context = {} } = interaction;

    const confusion = {
      isConfused: false,
      confidence: 0,
      indicators: [],
      likelySource: null,
      suggestedClarification: null
    };

    // Check for explicit confusion markers
    for (const pattern of this.confusionPatterns) {
      if (message.toLowerCase().includes(pattern)) {
        confusion.isConfused = true;
        confusion.confidence = 0.9;
        confusion.indicators.push(`Contains phrase: "${pattern}"`);
      }
    }

    // Check for repeated questions
    const recentInteractions = this.getRecentInteractions(userId, 5);
    const similarQuestions = recentInteractions.filter(i =>
      this.isSimilar(i.message, message)
    );
    if (similarQuestions.length > 1) {
      confusion.isConfused = true;
      confusion.confidence = Math.min(0.95, confusion.confidence + 0.3);
      confusion.indicators.push('Repeated similar questions');
      confusion.likelySource = 'Previous answer was unclear';
    }

    // Check for short follow-up questions
    if (recentInteractions.length > 0 && this.isQuestion(message) && message.length < 30) {
      confusion.isConfused = true;
      confusion.confidence = Math.min(0.95, confusion.confidence + 0.2);
      confusion.indicators.push('Brief follow-up question suggests incomplete understanding');
    }

    // Generate clarification suggestion
    if (confusion.isConfused) {
      confusion.suggestedClarification = await this.generateClarifyingQuestion(interaction);
    }

    return confusion;
  }

  /**
   * Generate clarifying question to address confusion
   */
  async generateClarifyingQuestion(context) {
    const { message, userId } = context;
    const profile = this.getUserProfile(userId);
    const knowledgeState = await this.modelUserKnowledge(userId);

    // Identify what user is confused about
    const confusionTarget = this.extractConfusionTarget(message);

    let clarification = '';

    if (confusionTarget) {
      if (knowledgeState.level === 'beginner') {
        clarification = `Let me break down ${confusionTarget} into simpler steps. Which part would you like me to explain first?`;
      } else {
        clarification = `To clarify ${confusionTarget}: would you like me to explain the concept, show an example, or walk through how it works?`;
      }
    } else {
      clarification = 'I want to make sure I understand - which specific part is unclear?';
    }

    return clarification;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  getUserProfile(userId) {
    return this.userProfiles.get(userId) || {
      userId,
      totalInteractions: 0,
      preferences: {},
      knowledgeDomains: new Map()
    };
  }

  getRecentInteractions(userId, limit = 10) {
    return this.interactionLog
      .filter(i => i.userId === userId)
      .slice(-limit);
  }

  async handleUserMessage(payload) {
    const { userId, message, context } = payload;

    // Log interaction
    this.interactionLog.push({
      userId,
      message,
      context,
      timestamp: Date.now()
    });

    // Trim log if too large
    if (this.interactionLog.length > this.config.maxInteractionHistory) {
      this.interactionLog.shift();
    }

    // Infer intent
    const intent = await this.inferUserIntent({ userId, message, context });

    // Check for confusion
    const confusion = await this.identifyUserConfusion({ userId, message, context });

    // Update user model
    await this.updateUserModel(userId, { message, context });

    // Emit insights
    if (confusion.isConfused && confusion.confidence > this.config.confusionThreshold) {
      await messageBroker.publish('user_confused', {
        userId,
        confusion,
        suggestedClarification: confusion.suggestedClarification
      });
    }
  }

  async processInteraction(payload) {
    // Process general interaction events
    await this.handleUserMessage(payload);
  }

  async updateFromFeedback(payload) {
    const { userId, feedbackType, rating } = payload;
    const profile = this.getUserProfile(userId);

    if (rating && rating >= 4) {
      profile.satisfactionIndicators.push({
        timestamp: Date.now(),
        rating
      });
    } else if (rating && rating <= 2) {
      profile.frustrationIndicators.push({
        timestamp: Date.now(),
        rating
      });
    }

    await this.saveUserProfile(userId, profile);
  }

  // Pattern detection methods
  analyzeMessagePatterns(message) {
    return {
      hasQuestion: this.isQuestion(message),
      hasCommand: this.isCommand(message),
      hasConfusion: this.isConfused(message),
      hasFeedback: this.isFeedback(message),
      hasExploration: this.isExploration(message)
    };
  }

  isQuestion(message) {
    return message.includes('?') ||
           message.toLowerCase().startsWith('what') ||
           message.toLowerCase().startsWith('how') ||
           message.toLowerCase().startsWith('why') ||
           message.toLowerCase().startsWith('when') ||
           message.toLowerCase().startsWith('where') ||
           message.toLowerCase().startsWith('can you');
  }

  isCommand(message) {
    const commandVerbs = ['create', 'make', 'build', 'generate', 'write', 'implement', 'add', 'remove', 'delete', 'update', 'fix', 'deploy'];
    const firstWord = message.toLowerCase().split(/\s+/)[0];
    return commandVerbs.includes(firstWord);
  }

  isConfused(message) {
    const msg = message.toLowerCase();
    for (const pattern of this.confusionPatterns) {
      if (msg.includes(pattern)) return true;
    }
    return false;
  }

  isFeedback(message) {
    const feedbackWords = ['good', 'bad', 'great', 'poor', 'excellent', 'terrible', 'works', 'doesn\'t work', 'broken', 'perfect'];
    return feedbackWords.some(word => message.toLowerCase().includes(word));
  }

  isExploration(message) {
    const explorationPhrases = ['can you', 'are you able', 'do you support', 'what can you', 'show me'];
    return explorationPhrases.some(phrase => message.toLowerCase().includes(phrase));
  }

  isBasicQuestion(message) {
    const basicMarkers = ['what is', 'what are', 'define', 'explain', 'tell me about'];
    return basicMarkers.some(marker => message.toLowerCase().includes(marker));
  }

  hasTechnicalLanguage(message) {
    const technicalTerms = [
      'function', 'class', 'api', 'endpoint', 'database', 'algorithm',
      'architecture', 'implementation', 'deployment', 'refactor', 'maml',
      'causal', 'inference', 'do-calculus', 'meta-learning', 'pipeline',
      'optimization', 'temporal', 'indexing', 'episodic', 'consolidation',
      'o(log n)', 'o(1)', 'arbiter', 'cognitive', 'neural'
    ];
    return technicalTerms.some(term => message.toLowerCase().includes(term));
  }

  showsProblemSolving(message) {
    const solvingMarkers = [
      'i tried', 'i figured', 'i solved', 'i found', 'my solution',
      'i implemented', 'i\'ll implement', 'i refactored', 'i optimized',
      'implemented', 'refactored', 'optimized', 'i built', 'i created'
    ];
    return solvingMarkers.some(marker => message.toLowerCase().includes(marker));
  }

  showsFrustration(message) {
    const frustrationMarkers = ['frustrated', 'annoying', 'doesn\'t work', 'broken', 'why won\'t', 'still not working'];
    return frustrationMarkers.some(marker => message.toLowerCase().includes(marker));
  }

  assessComplexity(text) {
    // Simple complexity score based on avg word length and sentence structure
    const words = text.split(/\s+/);
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;

    if (avgWordLength > 7) return 'expert';
    if (avgWordLength > 5.5) return 'advanced';
    if (avgWordLength > 4) return 'intermediate';
    return 'beginner';
  }

  containsExplanation(text) {
    const explanationMarkers = ['because', 'this means', 'in other words', 'for example', 'specifically', 'that is'];
    return explanationMarkers.some(marker => text.toLowerCase().includes(marker));
  }

  isSimilar(text1, text2) {
    // Simple similarity check
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size > 0.6;
  }

  extractTopics(message) {
    // Extract likely topics (simple implementation)
    const topics = [];
    const topicKeywords = {
      'agi': ['agi', 'intelligence', 'learning'],
      'memory': ['memory', 'remember', 'recall'],
      'planning': ['plan', 'goal', 'strategy'],
      'development': ['code', 'implement', 'build', 'create']
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => message.toLowerCase().includes(kw))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  extractConfusionTarget(message) {
    // Extract what the user is confused about
    const patterns = [
      /what (?:is|are) ([\w\s]+)\?/i,
      /confused about ([\w\s]+)/i,
      /don't understand ([\w\s]+)/i,
      /unclear (?:about )?([\w\s]+)/i
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) return match[1].trim();
    }

    return null;
  }

  simplifyForBeginner(content) {
    // Add beginner-friendly markers
    return `Let me explain this step-by-step:\n\n${content}\n\n💡 Tip: Don't worry if this seems complex - we can break it down further!`;
  }

  balanceForIntermediate(content) {
    return content; // Keep as is for intermediate
  }

  enrichForAdvanced(content) {
    // Add advanced context
    return `${content}\n\n🔧 Technical note: This involves advanced concepts - let me know if you want deeper implementation details.`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  async loadUserProfiles() {
    try {
      await fs.mkdir(this.config.userProfilePath, { recursive: true });
      const files = await fs.readdir(this.config.userProfilePath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = file.replace('.json', '');
          const profilePath = path.join(this.config.userProfilePath, file);
          const data = await fs.readFile(profilePath, 'utf-8');
          const profile = JSON.parse(data);
          this.userProfiles.set(userId, profile);
        }
      }

      console.log(`[${this.name}] 📂 Loaded ${this.userProfiles.size} user profiles`);
    } catch (error) {
      console.warn(`[${this.name}] ⚠️  Could not load user profiles:`, error.message);
    }
  }

  async saveUserProfile(userId, profile) {
    try {
      await fs.mkdir(this.config.userProfilePath, { recursive: true });
      const profilePath = path.join(this.config.userProfilePath, `${userId}.json`);
      await fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to save profile for ${userId}:`, error.message);
    }
  }

  startProfileMaintenance() {
    // Periodically save profiles
    this.profileMaintenanceInterval = setInterval(async () => {
      for (const [userId, profile] of this.userProfiles.entries()) {
        await this.saveUserProfile(userId, profile);
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Get insights for the dashboard panel
   * Returns { intent: { current, confidence }, contextTags, ... }
   */
  getInsights(userId = 'default_user') {
    const profile = this.getUserProfile(userId);
    const recentIntent = Array.from(this.intentHistory.values()).slice(-1)[0];
    const knowledgeMap = this.userKnowledgeStates.get(userId);
    const generalKnowledge = knowledgeMap?.get?.('general');

    return {
      intent: {
        current: recentIntent?.primary || 'awaiting_interaction',
        confidence: recentIntent?.confidence || 0
      },
      contextTags: (profile.recentTopics || []).slice(0, 5),
      knowledgeLevel: generalKnowledge?.level || 'unknown',
      totalInteractions: profile.totalInteractions || 0,
      preferences: profile.preferences || {}
    };
  }

  /**
   * Lifecycle: Deactivate arbiter
   */
  async onDeactivate() {
    console.log(`[${this.name}] 🛑 Deactivating Theory of Mind system...`);

    // Save all profiles
    for (const [userId, profile] of this.userProfiles.entries()) {
      await this.saveUserProfile(userId, profile);
    }

    // Clear maintenance interval
    if (this.profileMaintenanceInterval) {
      clearInterval(this.profileMaintenanceInterval);
    }

    console.log(`[${this.name}] ✅ Theory of Mind deactivated`);
  }
}

module.exports = TheoryOfMindArbiter;
