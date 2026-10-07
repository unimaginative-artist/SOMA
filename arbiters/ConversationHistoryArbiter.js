/**
 * ConversationHistoryArbiter.js - SOMA's Conversation Memory System
 *
 * Maintains persistent conversation history across sessions.
 * Enables SOMA to remember past interactions with users.
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ConversationHistoryArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'ConversationHistoryArbiter';
    
    // Configuration
    this.dbPath = config.dbPath || path.join(process.cwd(), 'SOMA', 'conversations.db');
    this.maxHistoryLength = config.maxHistoryLength || 500; // Per session - SOMA remembers deeply
    this.currentSessionId = null;
    
    // Database
    this.db = null;
    
    // Connected systems
    this.mnemonic = null;
    this.personalityForge = null;
    
    console.log(`[${this.name}] 💬 Conversation History system initialized`);
  }

  async initialize(arbiters = {}) {
    console.log(`[${this.name}] 🌱 Initializing conversation history database...`);

    // Connect to other arbiters
    this.mnemonic = arbiters.mnemonic || null;
    this.personalityForge = arbiters.personalityForge || null;

    // Ensure SOMA directory exists
    const somaDir = path.dirname(this.dbPath);
    await fs.mkdir(somaDir, { recursive: true });

    // Initialize SQLite database
    this.db = new Database(this.dbPath);

    // Create schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT 'default_user',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        key_topics TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_messages ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages(timestamp);
    `);

    // Create or load current session
    await this.startNewSession();

    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();

    console.log(`[${this.name}] ✅ Conversation history ready`);
    console.log(`[${this.name}]    Total sessions: ${sessionCount.count}`);
    console.log(`[${this.name}]    Total messages: ${messageCount.count}`);
    console.log(`[${this.name}]    Current session: ${this.currentSessionId}`);

    this.emit('initialized');
  }

  /**
   * Start a new conversation session
   */
  async startNewSession(userId = 'default_user', metadata = {}) {
    this.currentSessionId = crypto.randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, started_at, metadata)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      this.currentSessionId,
      userId,
      Date.now(),
      JSON.stringify(metadata)
    );

    console.log(`[${this.name}] 🆕 New session started: ${this.currentSessionId}`);

    this.emit('session_started', { sessionId: this.currentSessionId, userId });

    return this.currentSessionId;
  }

  /**
   * Load existing session or create it if it doesn't exist
   */
  async ensureSession(sessionId, userId = 'default_user', metadata = {}) {
    // Check if session exists
    const existing = this.db.prepare(`
      SELECT id FROM sessions WHERE id = ?
    `).get(sessionId);

    if (existing) {
      // Session exists, just set it as current
      this.currentSessionId = sessionId;
      console.log(`[${this.name}] 📂 Resumed existing session: ${sessionId}`);
    } else {
      // Session doesn't exist, create it
      this.currentSessionId = sessionId;
      const stmt = this.db.prepare(`
        INSERT INTO sessions (id, user_id, started_at, metadata)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(
        sessionId,
        userId,
        Date.now(),
        JSON.stringify(metadata)
      );

      console.log(`[${this.name}] 🆕 Created new session: ${sessionId}`);
    }

    return this.currentSessionId;
  }

  /**
   * Add a message to the current session
   */
  async addMessage(role, content, metadata = {}) {
    if (!this.currentSessionId) {
      await this.startNewSession();
    }

    // Validate content is not null/undefined
    if (content === null || content === undefined || content === '') {
      console.warn(`[ConversationHistoryArbiter] Attempted to add message with empty content. Role: ${role}, Metadata:`, metadata);
      return; // Skip saving empty messages
    }

    const messageId = crypto.randomUUID();
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      messageId,
      this.currentSessionId,
      role,
      content,
      timestamp,
      JSON.stringify(metadata)
    );

    // Update session message count
    this.db.prepare(`
      UPDATE sessions 
      SET message_count = message_count + 1 
      WHERE id = ?
    `).run(this.currentSessionId);

    // If personality forge is connected, process the interaction
    if (this.personalityForge && role === 'assistant') {
      // Get the previous user message
      const previousMessage = this.getRecentMessages(2).find(m => m.role === 'user');
      
      if (previousMessage) {
        await this.personalityForge.processInteraction({
          id: messageId,
          input: previousMessage.content,
          output: content,
          metadata: {
            ...metadata,
            sessionId: this.currentSessionId,
            timestamp
          }
        });
      }
    }

    // Store in long-term memory if Mnemonic is available
    if (this.mnemonic) {
      try {
        await this.mnemonic.remember(
          `${role}: ${content}`,
          {
            type: 'conversation',
            role,
            sessionId: this.currentSessionId,
            timestamp,
            ...metadata
          }
        );
      } catch (err) {
        // Don't fail chat if Mnemonic isn't ready
        console.warn(`[${this.name}] Mnemonic storage failed (non-critical): ${err.message}`);
      }
    }

    this.emit('message_added', {
      messageId,
      sessionId: this.currentSessionId,
      role,
      content
    });

    return messageId;
  }

  /**
   * Get recent messages from current session
   */
  getRecentMessages(count = 10) {
    if (!this.currentSessionId) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT id, session_id, role, content, timestamp, metadata
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const messages = stmt.all(this.currentSessionId, count);

    // Parse metadata and reverse (oldest first)
    return messages.reverse().map(msg => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : {}
    }));
  }

  /**
   * Get conversation history formatted for AI context
   */
  getContextHistory(count = 10) {
    const messages = this.getRecentMessages(count);
    
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Get all messages from a specific session
   */
  getSessionMessages(sessionId) {
    const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp, metadata
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const messages = stmt.all(sessionId);

    return messages.map(msg => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : {}
    }));
  }

  /**
   * Get all sessions
   */
  getAllSessions(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT id, user_id, started_at, ended_at, message_count, metadata
      FROM sessions
      ORDER BY started_at DESC
      LIMIT ?
    `);

    const sessions = stmt.all(limit);

    return sessions.map(session => ({
      ...session,
      metadata: session.metadata ? JSON.parse(session.metadata) : {}
    }));
  }

  /**
   * End the current session
   */
  async endCurrentSession() {
    if (!this.currentSessionId) {
      return;
    }

    this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?
      WHERE id = ?
    `).run(Date.now(), this.currentSessionId);

    console.log(`[${this.name}] 🔚 Session ended: ${this.currentSessionId}`);

    this.emit('session_ended', { sessionId: this.currentSessionId });

    this.currentSessionId = null;
  }

  /**
   * Create a summary of a session
   */
  async createSessionSummary(sessionId, summary, keyTopics = []) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_summaries (session_id, summary, key_topics, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      summary,
      JSON.stringify(keyTopics),
      Date.now()
    );

    console.log(`[${this.name}] 📝 Summary created for session: ${sessionId}`);
  }

  /**
   * Get session summary
   */
  getSessionSummary(sessionId) {
    const stmt = this.db.prepare(`
      SELECT summary, key_topics, created_at
      FROM session_summaries
      WHERE session_id = ?
    `);

    const summary = stmt.get(sessionId);

    if (summary) {
      return {
        ...summary,
        key_topics: JSON.parse(summary.key_topics)
      };
    }

    return null;
  }

  /**
   * Search conversations
   */
  searchConversations(query, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT m.id, m.session_id, m.role, m.content, m.timestamp,
             s.started_at as session_started
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE m.content LIKE ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `);

    return stmt.all(`%${query}%`, limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();
    const userMessages = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE role = 'user'").get();
    const assistantMessages = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE role = 'assistant'").get();

    return {
      totalSessions: sessionCount.count,
      totalMessages: messageCount.count,
      userMessages: userMessages.count,
      assistantMessages: assistantMessages.count,
      currentSession: this.currentSessionId
    };
  }

  /**
   * Cleanup old sessions
   */
  async cleanupOldSessions(olderThanDays = 90) {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    // Delete old messages first
    const deletedMessages = this.db.prepare(`
      DELETE FROM messages
      WHERE session_id IN (
        SELECT id FROM sessions WHERE started_at < ?
      )
    `).run(cutoffTime);

    // Delete old sessions
    const deletedSessions = this.db.prepare(`
      DELETE FROM sessions WHERE started_at < ?
    `).run(cutoffTime);

    console.log(`[${this.name}] 🧹 Cleaned up ${deletedSessions.changes} old sessions`);

    return {
      deletedSessions: deletedSessions.changes,
      deletedMessages: deletedMessages.changes
    };
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Saving conversation history...`);
    
    // End current session
    await this.endCurrentSession();

    // Close database
    if (this.db) {
      this.db.close();
    }

    console.log(`[${this.name}] Conversation history saved`);
  }
}

export default ConversationHistoryArbiter;
