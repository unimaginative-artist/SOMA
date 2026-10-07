import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'SOMA', 'ct-conversations.sqlite');

function json(value, fallback = {}) {
    try { return JSON.parse(value); } catch { return fallback; }
}

export class CtConversationStore {
    constructor(file = DB_PATH) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.db = new Database(file);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ct_conversations (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT 'New Chat',
                icon TEXT DEFAULT '',
                parent_id TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ct_conversations_owner_updated
                ON ct_conversations(owner_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS ct_messages (
                id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                role TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                edited_at INTEGER,
                pinned INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (conversation_id, id),
                FOREIGN KEY (conversation_id) REFERENCES ct_conversations(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ct_messages_conversation
                ON ct_messages(conversation_id, ordinal);
        `);
        this.db.pragma('foreign_keys = ON');
        this.replaceMessagesTx = this.db.transaction((conversationId, messages) => {
            this.db.prepare('DELETE FROM ct_messages WHERE conversation_id = ?').run(conversationId);
            const insert = this.db.prepare(`INSERT INTO ct_messages
                (id, conversation_id, ordinal, role, type, content, metadata, created_at, edited_at, pinned)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            messages.slice(-1000).forEach((message, index) => {
                const content = typeof message.content === 'string' ? message.content : '[Rich terminal artifact]';
                insert.run(
                    String(message.id || `${Date.now()}-${index}`), conversationId, index,
                    message.role || (message.type === 'command' ? 'user' : 'assistant'),
                    String(message.type || 'response'), content.slice(0, 250_000),
                    JSON.stringify(message.metadata || {}), Number(message.timestamp || Date.now()),
                    message.editedAt || null, message.pinned ? 1 : 0
                );
            });
        });
    }

    list(ownerId, search = '') {
        const term = String(search || '').trim();
        const rows = term
            ? this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM ct_messages m WHERE m.conversation_id=c.id) message_count
                FROM ct_conversations c WHERE c.owner_id=? AND c.archived=0 AND
                (c.title LIKE ? OR EXISTS (SELECT 1 FROM ct_messages m WHERE m.conversation_id=c.id AND m.content LIKE ?))
                ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`).all(ownerId, `%${term}%`, `%${term}%`)
            : this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM ct_messages m WHERE m.conversation_id=c.id) message_count
                FROM ct_conversations c WHERE c.owner_id=? AND c.archived=0
                ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`).all(ownerId);
        return rows.map(this._conversation);
    }

    get(ownerId, id) {
        const row = this.db.prepare('SELECT * FROM ct_conversations WHERE id=? AND owner_id=?').get(id, ownerId);
        if (!row) return null;
        const messages = this.db.prepare('SELECT * FROM ct_messages WHERE conversation_id=? ORDER BY ordinal').all(id)
            .map(message => ({
                id: message.id,
                role: message.role,
                type: message.type,
                content: message.content,
                metadata: json(message.metadata),
                timestamp: message.created_at,
                editedAt: message.edited_at,
                pinned: !!message.pinned
            }));
        return { ...this._conversation(row), messages };
    }

    upsert(ownerId, input = {}) {
        const now = Date.now();
        const id = String(input.id || `conv_${now}`);
        this.db.prepare(`INSERT INTO ct_conversations
            (id, owner_id, title, icon, parent_id, pinned, archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, icon=excluded.icon,
            parent_id=COALESCE(excluded.parent_id, ct_conversations.parent_id), pinned=excluded.pinned,
            archived=excluded.archived, updated_at=excluded.updated_at`)
            .run(id, ownerId, String(input.title || 'New Chat').slice(0, 160), String(input.icon || '').slice(0, 2048),
                input.parentId || null, input.pinned ? 1 : 0, input.archived ? 1 : 0,
                Number(input.createdAt || now), now);
        if (Array.isArray(input.messages)) this.replaceMessagesTx(id, input.messages);
        return this.get(ownerId, id);
    }

    delete(ownerId, id) {
        const result = this.db.prepare('DELETE FROM ct_conversations WHERE id=? AND owner_id=?').run(id, ownerId);
        return result.changes > 0;
    }

    _conversation(row) {
        return {
            id: row.id,
            title: row.title,
            icon: row.icon,
            parentId: row.parent_id,
            pinned: !!row.pinned,
            archived: !!row.archived,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.message_count
        };
    }
}

export default new CtConversationStore();

