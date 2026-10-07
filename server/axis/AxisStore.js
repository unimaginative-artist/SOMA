import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const require   = createRequire(import.meta.url);
const Database  = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', '..', 'SOMA');
const DB_PATH   = path.join(DATA_DIR, 'axis.db');

const COLORS     = ['blue', 'emerald', 'violet', 'amber', 'rose', 'cyan', 'orange', 'fuchsia'];
const uid        = () => crypto.randomUUID();
const inviteCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const colorFor   = (id) => { let h = 0; for (const c of (id || 'x')) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff; return COLORS[Math.abs(h) % COLORS.length]; };

const DEFAULT_COMMUNITIES = [
    { id: 'c-ai',       name: 'AI Builders',        icon: '🤖', description: 'Building with LLMs, agents, and neural nets.',               members: 2100, image: 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600', category: 'Code',   tags: ['LLM', 'Agents', 'ML'] },
    { id: 'c-webgl',    name: 'WebGL Shaders',      icon: '🎨', description: 'Fragment shaders, raymarching, and generative art.',        members: 1240, image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600', category: 'Code',   tags: ['GLSL', 'ThreeJS', 'Art'] },
    { id: 'c-photo',    name: 'Analog Photography', icon: '📷', description: 'Film is not dead. Grain, process, darkroom secrets.',       members: 8540, image: 'https://images.unsplash.com/photo-1493863641943-9b68992a8d07?w=600', category: 'Art',    tags: ['35mm', 'Darkroom'] },
    { id: 'c-cyber',    name: 'Cyberdeck Builders', icon: '⚡', description: 'Custom hardware builds, deck aesthetics, portable computing.', members: 3200, image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600', category: 'Tech',   tags: ['Hardware', 'Cyberpunk'] },
    { id: 'c-tokyo',    name: 'Tokyo Urbanists',    icon: '🌃', description: 'Mapping the neon streets and hidden alleys of the megacity.', members: 450,  image: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=600', category: 'Travel', tags: ['Urban', 'Exploration'] },
    { id: 'c-music',    name: 'Music Production',   icon: '🎵', description: 'DAWs, synthesis, sampling, and sound design.',              members: 1800, image: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600', category: 'Music',  tags: ['DAW', 'Synthesis', 'Audio'] },
    { id: 'c-design',   name: 'Interface Design',   icon: '✦',  description: 'Typography, motion, interaction design, and tooling.',      members: 960,  image: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=600', category: 'Design', tags: ['UI', 'Motion', 'Systems'] },
    { id: 'c-security', name: 'Offensive Security', icon: '🔐', description: 'CTFs, red team, and security research.',                    members: 670,  image: 'https://images.unsplash.com/photo-1614850523060-8da1d56ae167?w=600', category: 'Tech',   tags: ['CTF', 'RedTeam', 'Exploit'] },
];

class AxisStore {
    constructor() {
        mkdirSync(DATA_DIR, { recursive: true });
        this.db = new Database(DB_PATH);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this._init();
        this._contactImagesFile = path.join(DATA_DIR, 'axis-contact-images.json');
        try { this._contactImages = JSON.parse(readFileSync(this._contactImagesFile, 'utf8')); } catch { this._contactImages = {}; }
    }

    setContactImage(userId, image) {
        if (!userId || !image) return;
        this._contactImages[userId] = image;
        try { writeFileSync(this._contactImagesFile, JSON.stringify(this._contactImages)); } catch {}
    }

    getContactImage(userId) {
        return (userId && this._contactImages[userId]) || '';
    }

    _init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT DEFAULT '💬',
                color TEXT DEFAULT 'blue',
                created_by TEXT,
                created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'text',
                description TEXT DEFAULT '',
                invite_code TEXT UNIQUE,
                is_private INTEGER DEFAULT 0,
                created_by TEXT,
                created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS members (
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                user_color TEXT DEFAULT 'blue',
                role TEXT DEFAULT 'member',
                joined_at INTEGER,
                PRIMARY KEY (channel_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                sender_color TEXT DEFAULT 'blue',
                content TEXT NOT NULL,
                mode TEXT DEFAULT 'archive',
                expires_at INTEGER,
                is_soma INTEGER DEFAULT 0,
                reply_to TEXT,
                reactions TEXT DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS last_read (
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                last_read_at INTEGER NOT NULL,
                PRIMARY KEY (channel_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_channels_workspace ON channels(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_members_channel ON members(channel_id);
            CREATE INDEX IF NOT EXISTS idx_last_read ON last_read(user_id);
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                icon TEXT DEFAULT '📁',
                color TEXT DEFAULT 'blue',
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_members (
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                user_avatar TEXT DEFAULT '',
                user_color TEXT DEFAULT 'blue',
                role TEXT DEFAULT 'contributor',
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (project_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT DEFAULT 'todo',
                priority TEXT DEFAULT 'medium',
                assignee_id TEXT DEFAULT '',
                assignee_name TEXT DEFAULT '',
                created_by TEXT NOT NULL,
                created_by_name TEXT NOT NULL,
                due_date INTEGER,
                completed_at INTEGER,
                sort_order INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_comments (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_activity (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                actor_id TEXT DEFAULT '',
                actor_name TEXT DEFAULT '',
                action TEXT NOT NULL,
                target_type TEXT DEFAULT '',
                target_id TEXT DEFAULT '',
                summary TEXT DEFAULT '',
                metadata TEXT DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS communities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                icon TEXT DEFAULT '🌐',
                cover_image TEXT DEFAULT '',
                creator_id TEXT NOT NULL,
                creator_name TEXT NOT NULL,
                is_public INTEGER DEFAULT 1,
                member_count INTEGER DEFAULT 1,
                category TEXT DEFAULT 'General',
                tags TEXT DEFAULT '[]',
                rules TEXT DEFAULT '',
                links TEXT DEFAULT '[]',
                moderation_tone TEXT DEFAULT 'thoughtful',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS community_members (
                community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                user_avatar TEXT DEFAULT '',
                role TEXT DEFAULT 'member',
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (community_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS community_posts (
                id TEXT PRIMARY KEY,
                community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                author_avatar TEXT DEFAULT '',
                content TEXT NOT NULL,
                images TEXT DEFAULT '[]',
                likes_count INTEGER DEFAULT 0,
                comments_count INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                edited_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS community_post_likes (
                post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (post_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS community_post_comments (
                id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                author_avatar TEXT DEFAULT '',
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_project_members    ON project_members(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_project      ON tasks(project_id, status);
            CREATE INDEX IF NOT EXISTS idx_task_comments      ON task_comments(task_id);
            CREATE INDEX IF NOT EXISTS idx_project_activity   ON project_activity(project_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_community_posts    ON community_posts(community_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_community_members  ON community_members(community_id);
        `);

        // Safe migrations for existing DBs
        try { this.db.prepare('ALTER TABLE messages   ADD COLUMN edited_at  INTEGER').run(); } catch {}
        try { this.db.prepare('ALTER TABLE channels   ADD COLUMN project_id TEXT').run();    } catch {}
        try { this.db.prepare("ALTER TABLE workspaces ADD COLUMN type TEXT DEFAULT 'workspace'").run(); } catch {}
        try { this.db.prepare('ALTER TABLE workspaces ADD COLUMN description TEXT DEFAULT ""').run();   } catch {}
        try { this.db.prepare('ALTER TABLE workspaces ADD COLUMN is_public INTEGER DEFAULT 1').run();    } catch {}
        try { this.db.prepare('ALTER TABLE workspaces ADD COLUMN avatar_url TEXT').run();               } catch {}
        try { this.db.prepare('ALTER TABLE channels   ADD COLUMN icon TEXT').run();                     } catch {}
        try { this.db.prepare('ALTER TABLE workspaces ADD COLUMN community_id TEXT').run();             } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN category TEXT DEFAULT 'General'").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN tags TEXT DEFAULT '[]'").run();         } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN rules TEXT DEFAULT ''").run();          } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN links TEXT DEFAULT '[]'").run();        } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN moderation_tone TEXT DEFAULT 'thoughtful'").run(); } catch {}
        // Robust community creation — branding, handle, join policy, SOMA assist, workspace link
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN color TEXT DEFAULT ''").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN handle TEXT DEFAULT ''").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN theme TEXT DEFAULT ''").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN join_policy TEXT DEFAULT 'open'").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN soma_assist INTEGER DEFAULT 1").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN soma_features TEXT DEFAULT '[]'").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN structure TEXT DEFAULT ''").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN workspace_id TEXT").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN verified INTEGER DEFAULT 0").run(); } catch {}
        try { this.db.prepare("ALTER TABLE communities ADD COLUMN updated_at INTEGER").run(); } catch {}
        try { this.db.prepare("ALTER TABLE community_members ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch {}

        // FTS5 search index — wrapped so a bad SQLite FTS5 build doesn't crash the store
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                    msg_id UNINDEXED,
                    content,
                    sender_name,
                    channel_id UNINDEXED,
                    workspace_id UNINDEXED,
                    created_at UNINDEXED,
                    tokenize = 'porter unicode61'
                );
            `);
            this.ftsReady = true;
        } catch (e) {
            console.warn('[AxisStore] FTS5 unavailable — search disabled:', e.message);
            this.ftsReady = false;
        }

        // Backfill FTS for existing messages (safe no-op after first run)
        if (this.ftsReady) {
            try {
                const ftsCount = this.db.prepare('SELECT COUNT(*) as n FROM messages_fts').get().n;
                const msgCount = this.db.prepare('SELECT COUNT(*) as n FROM messages').get().n;
                if (ftsCount === 0 && msgCount > 0) {
                    const rows = this.db.prepare('SELECT id, content, sender_name, channel_id, workspace_id, created_at FROM messages').all();
                    const ins  = this.db.prepare('INSERT OR IGNORE INTO messages_fts (msg_id,content,sender_name,channel_id,workspace_id,created_at) VALUES (?,?,?,?,?,?)');
                    this.db.transaction(() => rows.forEach(r => ins.run(r.id, r.content, r.sender_name, r.channel_id, r.workspace_id, r.created_at)))();
                }
            } catch (e) {
                console.warn('[AxisStore] FTS backfill failed:', e.message);
            }
        }

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS portal_tabs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                is_active INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                tab_state TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portal_history (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                address TEXT NOT NULL,
                kind TEXT NOT NULL,
                query TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portal_bookmarks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                address TEXT NOT NULL,
                kind TEXT NOT NULL,
                query TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_portal_history ON portal_history(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_portal_bookmarks ON portal_bookmarks(created_at DESC);
        `);

        if (this.db.prepare('SELECT COUNT(*) as n FROM workspaces').get().n === 0) this._seed();
        this._seedDefaultCommunities();
    }

    _seed() {
        const wsId = 'ws-main', now = Date.now();
        this.db.prepare('INSERT INTO workspaces (id,name,icon,color,created_by,created_at) VALUES (?,?,?,?,?,?)').run(wsId, 'Main', '🌐', 'blue', 'system', now);
        for (const ch of [
            { id: 'ch-general',  name: 'general',  type: 'text',      desc: 'General discussion' },
            { id: 'ch-soma',     name: 'soma',      type: 'text',      desc: 'Direct line to SOMA' },
            { id: 'ch-whispers', name: 'whispers',  type: 'ephemeral', desc: 'Messages fade after read' },
        ]) {
            this.db.prepare('INSERT INTO channels (id,workspace_id,name,type,description,invite_code,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(ch.id, wsId, ch.name, ch.type, ch.desc, inviteCode(), 'system', now);
        }
    }

    _seedDefaultCommunities() {
        const now = Date.now();
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO communities
                (id,name,description,icon,cover_image,creator_id,creator_name,is_public,member_count,category,tags,rules,links,moderation_tone,created_at)
            VALUES
                (@id,@name,@description,@icon,@image,'system','SOMA',1,@members,@category,@tags,@rules,'[]','thoughtful',@createdAt)
        `);
        const touch = this.db.prepare(`
            UPDATE communities
            SET description = CASE WHEN description = '' THEN @description ELSE description END,
                cover_image = CASE WHEN cover_image = '' OR cover_image IS NULL THEN @image ELSE cover_image END,
                icon = CASE WHEN icon = '' OR icon IS NULL THEN @icon ELSE icon END,
                is_public = 1,
                member_count = CASE WHEN member_count < @members THEN @members ELSE member_count END,
                category = CASE WHEN category = '' OR category IS NULL OR category = 'General' THEN @category ELSE category END,
                tags = CASE WHEN tags = '' OR tags IS NULL OR tags = '[]' THEN @tags ELSE tags END,
                rules = CASE WHEN rules = '' OR rules IS NULL THEN @rules ELSE rules END
            WHERE id = @id
        `);
        const seed = this.db.transaction(() => {
            DEFAULT_COMMUNITIES.forEach((community, index) => {
                const row = {
                    ...community,
                    category: community.category || 'General',
                    tags: JSON.stringify(community.tags || []),
                    rules: community.rules || 'Be useful. Stay on topic. No spam, harassment, or low-effort bait.',
                    createdAt: now - ((DEFAULT_COMMUNITIES.length - index) * 1000),
                };
                insert.run(row);
                touch.run(row);
            });
        });
        seed();
    }

    // ── Workspaces ───────────────────────────────────────────────────────────
    getWorkspaces()  { return this.db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all(); }
    deleteWorkspace(id) {
        const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
        if (!workspace) return false;
        if (workspace.name === 'Directs') return false;

        const snapshotDir = path.join(DATA_DIR, 'axis', 'deleted-workspaces');
        mkdirSync(snapshotDir, { recursive: true });
        const snapshot = {
            deletedAt: Date.now(),
            workspace,
            channels: this.db.prepare('SELECT * FROM channels WHERE workspace_id = ? ORDER BY created_at ASC').all(id),
            projects: this.db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC').all(id),
            tasks: this.db.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at ASC').all(id),
            messages: this.db.prepare('SELECT * FROM messages WHERE workspace_id = ? ORDER BY created_at ASC').all(id),
        };
        const safeName = String(workspace.name || id).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || id;
        writeFileSync(
            path.join(snapshotDir, `${Date.now()}-${safeName}.json`),
            JSON.stringify(snapshot, null, 2),
            'utf8'
        );

        this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
        return true;
    }
    updateWorkspace(id, { name, icon, color, type, description, is_public, avatar_url } = {}) {
        const fields = [], vals = [];
        if (name        !== undefined) { fields.push('name = ?');        vals.push(name);        }
        if (icon        !== undefined) { fields.push('icon = ?');        vals.push(icon);        }
        if (color       !== undefined) { fields.push('color = ?');       vals.push(color);       }
        if (type        !== undefined) { fields.push('type = ?');        vals.push(type);        }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (is_public   !== undefined) { fields.push('is_public = ?');   vals.push(is_public ? 1 : 0); }
        if (avatar_url  !== undefined) { fields.push('avatar_url = ?');  vals.push(avatar_url || null); }
        if (!fields.length) return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
        vals.push(id);
        this.db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    }

    updateChannel(id, { name, icon, description } = {}) {
        const fields = [], vals = [];
        if (name        !== undefined) { fields.push('name = ?');        vals.push(name);        }
        if (icon        !== undefined) { fields.push('icon = ?');        vals.push(icon || null); }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (!fields.length) return this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
        vals.push(id);
        this.db.prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        return this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    }
    createWorkspace({ name, icon = '💬', color = 'blue', createdBy, type = 'workspace', description = '', community_id = null }) {
        const id = `ws-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO workspaces (id,name,icon,color,created_by,created_at,type,description,community_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id, name, icon, color, createdBy, now, type, description, community_id || null);
        const chId = `ch-${uid()}`;
        this.db.prepare('INSERT INTO channels (id,workspace_id,name,type,description,invite_code,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(chId, id, 'general', 'text', `Main channel for ${name}`, inviteCode(), createdBy, now);
        return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    }

    // ── Channels ─────────────────────────────────────────────────────────────
    getChannels(workspaceId) { return this.db.prepare('SELECT * FROM channels WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId); }
    getChannel(id)           { return this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id); }
    deleteChannel(id)        { this.db.prepare('DELETE FROM channels WHERE id = ?').run(id); }
    refreshInvite(channelId) { const code = inviteCode(); this.db.prepare('UPDATE channels SET invite_code = ? WHERE id = ?').run(code, channelId); return code; }
    findByInvite(code)       { return this.db.prepare('SELECT * FROM channels WHERE invite_code = ?').get((code || '').toUpperCase().trim()); }
    createChannel({ workspaceId, name, type = 'text', description = '', isPrivate = false, createdBy }) {
        const id   = `ch-${uid()}`, now = Date.now();
        const slug = (name || 'channel').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        this.db.prepare('INSERT INTO channels (id,workspace_id,name,type,description,invite_code,is_private,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, workspaceId, slug, type, description, inviteCode(), isPrivate ? 1 : 0, createdBy, now);
        if (createdBy) this.addMember(id, { userId: createdBy, userName: createdBy, role: 'admin' });
        return this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    }

    // ── Members ──────────────────────────────────────────────────────────────
    getMembers(channelId)             { return this.db.prepare('SELECT * FROM members WHERE channel_id = ? ORDER BY joined_at ASC').all(channelId); }
    removeMember(channelId, userId)   { this.db.prepare('DELETE FROM members WHERE channel_id = ? AND user_id = ?').run(channelId, userId); }
    addMember(channelId, { userId, userName, userColor, role = 'member' }) {
        if (!userColor) userColor = colorFor(userId);
        this.db.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,user_name,user_color,role,joined_at) VALUES (?,?,?,?,?,?)').run(channelId, userId, userName, userColor, role, Date.now());
    }

    // ── Messages ─────────────────────────────────────────────────────────────
    getMessages(channelId, { limit = 100, before = null } = {}) {
        this.db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now());
        const params = [channelId];
        let sql = 'SELECT * FROM messages WHERE channel_id = ?';
        if (before) { sql += ' AND created_at < ?'; params.push(before); }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(Math.min(limit, 500));
        return this.db.prepare(sql).all(...params).reverse();
    }

    addMessage({ channelId, workspaceId, senderId, senderName, senderColor, content, mode = 'archive', expiresAt = null, isSoma = false, replyTo = null }) {
        const id  = `msg-${uid()}`, now = Date.now();
        if (!senderColor) senderColor = colorFor(senderId);
        this.db.prepare('INSERT INTO messages (id,channel_id,workspace_id,sender_id,sender_name,sender_color,content,mode,expires_at,is_soma,reply_to,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, channelId, workspaceId, senderId, senderName, senderColor, content, mode, expiresAt, isSoma ? 1 : 0, replyTo, now);
        if (this.ftsReady) {
            try { this.db.prepare('INSERT INTO messages_fts (msg_id,content,sender_name,channel_id,workspace_id,created_at) VALUES (?,?,?,?,?,?)').run(id, content, senderName, channelId, workspaceId, now); } catch {}
        }
        return { ...this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id), reactions: {} };
    }

    editMessage(id, newContent, requesterId) {
        const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
        if (!row || row.sender_id !== requesterId) return null;
        const now = Date.now();
        this.db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(newContent, now, id);
        if (this.ftsReady) {
            try { this.db.prepare('UPDATE messages_fts SET content = ? WHERE msg_id = ?').run(newContent, id); } catch {}
        }
        return { ...this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id), reactions: JSON.parse(row.reactions || '{}') };
    }

    deleteMessage(id) {
        this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
        if (this.ftsReady) {
            try { this.db.prepare('DELETE FROM messages_fts WHERE msg_id = ?').run(id); } catch {}
        }
    }

    addReaction(msgId, emoji, userId) {
        const row = this.db.prepare('SELECT reactions FROM messages WHERE id = ?').get(msgId);
        if (!row) return {};
        const r = JSON.parse(row.reactions || '{}');
        if (!r[emoji]) r[emoji] = [];
        if (!r[emoji].includes(userId)) r[emoji].push(userId);
        this.db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(r), msgId);
        return r;
    }

    removeReaction(msgId, emoji, userId) {
        const row = this.db.prepare('SELECT reactions FROM messages WHERE id = ?').get(msgId);
        if (!row) return {};
        const r = JSON.parse(row.reactions || '{}');
        if (r[emoji]) { r[emoji] = r[emoji].filter(u => u !== userId); if (!r[emoji].length) delete r[emoji]; }
        this.db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(r), msgId);
        return r;
    }

    // ── Search (FTS5) ─────────────────────────────────────────────────────────
    searchMessages(query, { workspaceId, channelId, limit = 40 } = {}) {
        if (!this.ftsReady) return [];
        // Sanitize: keep only word chars + spaces, append * for prefix match
        const safe = (query || '').replace(/[^\w\s]/g, ' ').trim();
        if (!safe) return [];
        const ftsQ = safe.split(/\s+/).filter(Boolean).map(w => `${w}*`).join(' ');
        try {
            let sql = `
                SELECT m.*, snippet(messages_fts, 1, '[[', ']]', '…', 32) AS snippet
                FROM messages_fts
                JOIN messages m ON m.id = messages_fts.msg_id
                WHERE messages_fts MATCH ?
            `;
            const params = [ftsQ];
            if (channelId)        { sql += ' AND m.channel_id = ?';    params.push(channelId); }
            else if (workspaceId) { sql += ' AND m.workspace_id = ?';  params.push(workspaceId); }
            sql += ' ORDER BY rank LIMIT ?';
            params.push(Math.min(limit, 100));
            return this.db.prepare(sql).all(...params).map(r => ({ ...r, reactions: JSON.parse(r.reactions || '{}') }));
        } catch (e) {
            console.warn('[AxisStore] FTS search error:', e.message);
            return [];
        }
    }

    // ── Last-read / unread counts ─────────────────────────────────────────────
    markRead(channelId, userId) {
        this.db.prepare('INSERT OR REPLACE INTO last_read (channel_id, user_id, last_read_at) VALUES (?,?,?)').run(channelId, userId, Date.now());
    }

    getUnreadCounts(workspaceId, userId) {
        const channels = this.db.prepare('SELECT id FROM channels WHERE workspace_id = ?').all(workspaceId);
        const result   = {};
        const stmt     = this.db.prepare('SELECT COUNT(*) as n FROM messages WHERE channel_id = ? AND created_at > ? AND sender_id != ? AND (expires_at IS NULL OR expires_at > ?)');
        for (const ch of channels) {
            const lr    = this.db.prepare('SELECT last_read_at FROM last_read WHERE channel_id = ? AND user_id = ?').get(ch.id, userId);
            const since = lr?.last_read_at || 0;
            result[ch.id] = stmt.get(ch.id, since, userId, Date.now()).n;
        }
        return result;
    }

    getHomeData(userId, userName) {
        const now = Date.now();
        // Recent active non-DM channels with last message + workspace info
        const recentChannels = this.db.prepare(`
            SELECT c.id, c.name, c.type, c.workspace_id, c.description, c.icon,
                   w.name as ws_name, w.icon as ws_icon,
                   m.content as last_content, m.sender_name as last_sender,
                   m.sender_id as last_sender_id, m.created_at as last_at
            FROM channels c
            JOIN workspaces w ON w.id = c.workspace_id AND w.name != 'Directs'
            LEFT JOIN messages m ON m.id = (
                SELECT id FROM messages WHERE channel_id = c.id
                AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC LIMIT 1
            )
            WHERE c.type NOT IN ('dm', 'ephemeral', 'voice')
            ORDER BY COALESCE(m.created_at, c.created_at) DESC
            LIMIT 10
        `).all(now);

        // Annotate with unread counts
        if (userId && userId !== 'anon') {
            const lrStmt    = this.db.prepare('SELECT last_read_at FROM last_read WHERE channel_id = ? AND user_id = ?');
            const cntStmt   = this.db.prepare('SELECT COUNT(*) as n FROM messages WHERE channel_id = ? AND created_at > ? AND sender_id != ? AND (expires_at IS NULL OR expires_at > ?)');
            for (const ch of recentChannels) {
                const lr    = lrStmt.get(ch.id, userId);
                ch.unread   = cntStmt.get(ch.id, lr?.last_read_at || 0, userId, now).n;
            }
        }

        // DMs can live in Main now, but older installs may still have a Directs workspace.
        let directs = [];
        {
            const dmRows = this.db.prepare(`
                SELECT c.id, c.workspace_id, c.description,
                       m.content as last_content, m.sender_id as last_sender_id, m.created_at as last_at
                FROM channels c
                LEFT JOIN messages m ON m.id = (
                    SELECT id FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1
                )
                WHERE c.type = 'dm'
                ORDER BY COALESCE(m.created_at, c.created_at) DESC
                LIMIT 8
            `).all();

            const uid = userId && userId !== 'anon' ? userId : '';
            const lrStmt  = uid ? this.db.prepare('SELECT last_read_at FROM last_read WHERE channel_id = ? AND user_id = ?') : null;
            const cntStmt = uid ? this.db.prepare('SELECT COUNT(*) as n FROM messages WHERE channel_id = ? AND created_at > ? AND sender_id != ? AND (expires_at IS NULL OR expires_at > ?)') : null;

            directs = dmRows.map(row => {
                const other = this.db.prepare(
                    'SELECT user_name, user_color FROM members WHERE channel_id = ? AND user_id != ? LIMIT 1'
                ).get(row.id, uid || '') || this.db.prepare(
                    'SELECT user_name, user_color FROM members WHERE channel_id = ? LIMIT 1'
                ).get(row.id);
                let unread = 0;
                if (lrStmt && cntStmt) {
                    const lr = lrStmt.get(row.id, uid);
                    unread   = cntStmt.get(row.id, lr?.last_read_at || 0, uid, now).n;
                }
                return {
                    id:           row.id,
                    workspaceId:  row.workspace_id,
                    name:         (row.description || '').replace(/^Direct with\s+/i, '').trim() || other?.user_name || 'Direct',
                    otherColor:   other?.user_color || 'violet',
                    lastContent:  row.last_content  || null,
                    lastSenderId: row.last_sender_id || null,
                    lastAt:       row.last_at        || null,
                    unread,
                    isSelf:       row.last_sender_id === uid,
                };
            });
        }

        const mentions = userName ? this.getMentions(userId, userName) : [];
        return { recentChannels, directs, mentions };
    }

    getMyTasks(userId, limit = 10) {
        if (!userId || userId === 'anon') return [];
        try {
            return this.db.prepare(`
                SELECT t.id, t.title, t.status, t.priority, t.due_date,
                       t.assignee_name, t.project_id,
                       p.name as project_name, p.icon as project_icon,
                       w.id as workspace_id, w.name as workspace_name
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                JOIN workspaces w ON w.id = t.workspace_id
                WHERE (t.assignee_id = ? OR t.created_by = ?)
                AND t.status != 'done'
                ORDER BY t.created_at DESC
                LIMIT ?
            `).all(userId, userId, limit);
        } catch { return []; }
    }

    getMentions(userId, userName, limit = 20) {
        if (!userName || userName === 'Anonymous' || userName === 'anon') return [];
        try {
            const safe = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
            const rows = this.db.prepare(`
                SELECT m.id, m.content, m.sender_name, m.created_at,
                       c.id as channel_id, c.name as channel_name, c.type as channel_type,
                       c.workspace_id,
                       w.name as workspace_name, w.icon as workspace_icon
                FROM messages m
                JOIN channels c ON c.id = m.channel_id
                JOIN workspaces w ON w.id = c.workspace_id AND w.name != 'Directs'
                WHERE m.content LIKE ? ESCAPE '\\'
                AND m.sender_id != ?
                AND (m.expires_at IS NULL OR m.expires_at > ?)
                ORDER BY m.created_at DESC
                LIMIT ?
            `).all(`%@${safe(userName)}%`, userId, Date.now(), limit);
            return rows.map(r => ({
                id:            r.id,
                content:       r.content,
                senderName:    r.sender_name,
                createdAt:     r.created_at,
                channelId:     r.channel_id,
                channelName:   r.channel_name,
                channelType:   r.channel_type,
                workspaceId:   r.workspace_id,
                workspaceName: r.workspace_name,
                workspaceIcon: r.workspace_icon,
            }));
        } catch { return []; }
    }

    // ── Projects ─────────────────────────────────────────────────────────────
    getProjects(workspaceId) { return this.db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId); }
    getProject(id)           { return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id); }
    deleteProject(id)        { this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); }
    createProject({ workspaceId, name, description = '', icon = '📁', color = 'blue', createdBy, createdByName = '' }) {
        const id = `proj-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO projects (id,workspace_id,name,description,status,icon,color,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, workspaceId, name, description, 'active', icon, color, createdBy, now);
        this.addProjectMember(id, { userId: createdBy, userName: createdByName || createdBy, role: 'owner' });
        const ch = `ch-${uid()}`;
        this.db.prepare('INSERT INTO channels (id,workspace_id,project_id,name,type,description,invite_code,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(ch, workspaceId, id, 'general', 'text', `General for ${name}`, inviteCode(), createdBy, now);
        return this.getProject(id);
    }
    updateProject(id, { name, description, status, icon, color } = {}) {
        const fields = [], vals = [];
        if (name        !== undefined) { fields.push('name = ?');        vals.push(name); }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
        if (icon        !== undefined) { fields.push('icon = ?');        vals.push(icon); }
        if (color       !== undefined) { fields.push('color = ?');       vals.push(color); }
        if (!fields.length) return this.getProject(id);
        vals.push(id);
        this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        return this.getProject(id);
    }

    // ── Project Members ──────────────────────────────────────────────────────
    getProjectMembers(projectId) { return this.db.prepare('SELECT * FROM project_members WHERE project_id = ? ORDER BY joined_at ASC').all(projectId); }
    getProjectMember(projectId, userId) { return this.db.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId); }
    addProjectMember(projectId, { userId, userName, userAvatar = '', userColor = '', role = 'contributor' }) {
        if (!userColor) userColor = colorFor(userId);
        this.db.prepare('INSERT OR IGNORE INTO project_members (project_id,user_id,user_name,user_avatar,user_color,role,joined_at) VALUES (?,?,?,?,?,?,?)').run(projectId, userId, userName, userAvatar, userColor, role, Date.now());
    }
    removeProjectMember(projectId, userId) { this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId); }
    updateProjectMemberRole(projectId, userId, role) { this.db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, projectId, userId); }
    isProjectMember(projectId, userId) { return !!this.db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId); }

    // ── Project Channels ─────────────────────────────────────────────────────
    getProjectChannels(projectId) { return this.db.prepare('SELECT * FROM channels WHERE project_id = ? ORDER BY created_at ASC').all(projectId); }
    createProjectChannel({ projectId, workspaceId, name, type = 'text', description = '', isPrivate = false, createdBy }) {
        const id   = `ch-${uid()}`, now = Date.now();
        const slug = (name || 'channel').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        this.db.prepare('INSERT INTO channels (id,workspace_id,project_id,name,type,description,invite_code,is_private,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, projectId, slug, type, description, inviteCode(), isPrivate ? 1 : 0, createdBy, now);
        if (createdBy) this.addMember(id, { userId: createdBy, userName: createdBy, role: 'admin' });
        return this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    }

    // ── Tasks ────────────────────────────────────────────────────────────────
    getTasks(projectId, { status } = {}) {
        if (status) return this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY sort_order ASC, created_at ASC').all(projectId, status);
        return this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC').all(projectId);
    }
    getTask(id) { return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id); }
    createTask({ projectId, workspaceId, title, description = '', priority = 'medium', assigneeId = '', assigneeName = '', createdBy, createdByName, dueDate = null, tags = [] }) {
        const id = `task-${uid()}`, now = Date.now();
        const order = this.db.prepare('SELECT COUNT(*) as n FROM tasks WHERE project_id = ?').get(projectId).n;
        this.db.prepare('INSERT INTO tasks (id,project_id,workspace_id,title,description,status,priority,assignee_id,assignee_name,created_by,created_by_name,due_date,sort_order,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, workspaceId, title, description, 'todo', priority, assigneeId, assigneeName, createdBy, createdByName, dueDate, order, JSON.stringify(tags), now, now);
        return this.getTask(id);
    }
    updateTask(id, updates = {}) {
        const fields = [], vals = [];
        const map = { title: 'title', description: 'description', status: 'status', priority: 'priority', assigneeId: 'assignee_id', assigneeName: 'assignee_name', dueDate: 'due_date', sortOrder: 'sort_order' };
        for (const [k, col] of Object.entries(map)) { if (updates[k] !== undefined) { fields.push(`${col} = ?`); vals.push(updates[k]); } }
        if (updates.tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
        if (updates.status === 'done' && !updates.completedAt) { fields.push('completed_at = ?'); vals.push(Date.now()); }
        if (!fields.length) return this.getTask(id);
        fields.push('updated_at = ?'); vals.push(Date.now());
        vals.push(id);
        this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        return this.getTask(id);
    }
    deleteTask(id) { this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id); }

    // ── Task Comments ────────────────────────────────────────────────────────
    getTaskComments(taskId) { return this.db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId); }
    addTaskComment({ taskId, authorId, authorName, content }) {
        const id = `tc-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO task_comments (id,task_id,author_id,author_name,content,created_at) VALUES (?,?,?,?,?,?)').run(id, taskId, authorId, authorName, content, now);
        return this.db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
    }

    addProjectActivity({ projectId, actorId = '', actorName = '', action, targetType = '', targetId = '', summary = '', metadata = {} }) {
        const id = `pa-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO project_activity (id,project_id,actor_id,actor_name,action,target_type,target_id,summary,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(id, projectId, actorId, actorName, action, targetType, targetId, summary, JSON.stringify(metadata || {}), now);
        return this.db.prepare('SELECT * FROM project_activity WHERE id = ?').get(id);
    }
    getProjectActivity(projectId, limit = 50) {
        return this.db.prepare('SELECT * FROM project_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
            .map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
    }

    // ── Communities ──────────────────────────────────────────────────────────
    normalizeCommunity(row = {}) {
        if (!row) return row;
        const parse = (value, fallback) => {
            if (Array.isArray(value)) return value;
            try { return JSON.parse(value || ''); } catch { return fallback; }
        };
        const postCount = row.id ? this.db.prepare('SELECT COUNT(*) as n FROM community_posts WHERE community_id = ?').get(row.id).n : 0;
        const latestPostAt = row.id ? this.db.prepare('SELECT MAX(created_at) as at FROM community_posts WHERE community_id = ?').get(row.id).at : null;
        const completeness = [
            row.name,
            row.description,
            row.cover_image,
            row.icon,
            row.category,
            row.rules,
            parse(row.tags, []).length ? 'tags' : '',
        ].filter(Boolean).length / 7;
        const merit_score = Math.round(
            Math.log10((row.member_count || 0) + 10) * 28
            + Math.log10(postCount + 2) * 18
            + completeness * 26
            + (latestPostAt ? Math.max(0, 18 - ((Date.now() - latestPostAt) / 86400000)) : 0)
        );
        return {
            ...row,
            tags: parse(row.tags, []),
            links: parse(row.links, []),
            rules: parse(row.rules, []),
            soma_features: parse(row.soma_features, []),
            soma_assist: row.soma_assist == null ? true : !!row.soma_assist,
            is_public: !!row.is_public,
            verified: !!row.verified,
            join_policy: row.join_policy || 'open',
            color: row.color || '',
            handle: row.handle || '',
            post_count: postCount,
            latest_post_at: latestPostAt,
            merit_score,
        };
    }
    getCommunities({ userId } = {}) {
        const rows = userId ? this.db.prepare(`
            SELECT c.*, cm.role as my_role
            FROM communities c
            LEFT JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = ?
            WHERE c.is_public = 1 OR cm.user_id IS NOT NULL
            ORDER BY c.created_at DESC
        `).all(userId) : this.db.prepare('SELECT * FROM communities WHERE is_public = 1 ORDER BY created_at DESC').all();
        return rows.map(row => this.normalizeCommunity(row))
            .sort((a, b) => (b.merit_score || 0) - (a.merit_score || 0) || (b.created_at || 0) - (a.created_at || 0));
    }
    getCommunity(id, { userId } = {}) {
        const row = userId ? this.db.prepare(`
            SELECT c.*, cm.role as my_role
            FROM communities c
            LEFT JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = ?
            WHERE c.id = ?
        `).get(userId, id) : this.db.prepare('SELECT * FROM communities WHERE id = ?').get(id);
        return this.normalizeCommunity(row);
    }
    getCommunityRole(communityId, userId) {
        if (!communityId || !userId) return null;
        return this.db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?').get(communityId, userId)?.role || null;
    }
    canModerateCommunity(communityId, userId) {
        const community = this.db.prepare('SELECT creator_id FROM communities WHERE id = ?').get(communityId);
        const role = this.getCommunityRole(communityId, userId);
        return community?.creator_id === userId || role === 'admin' || role === 'mod';
    }
    uniqueCommunityHandle(base) {
        let h = String(base || 'community').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'community';
        let cand = h, n = 1;
        while (this.db.prepare('SELECT 1 FROM communities WHERE handle = ?').get(cand)) cand = `${h}-${++n}`;
        return cand;
    }
    createCommunity({
        name, description = '', icon = '🌐', coverImage = '', creatorId, creatorName, isPublic = true,
        category = 'General', tags = [], rules = [], links = [], moderationTone = 'thoughtful',
        color = '', handle = '', theme = '', joinPolicy = 'open', somaAssist = true, somaFeatures = [],
        channels = [], structure = '', verified = false,
    } = {}) {
        if (!name || !String(name).trim()) throw new Error('Community name is required');
        const id = `c-${uid()}`, now = Date.now();
        const finalHandle = this.uniqueCommunityHandle(handle || name);
        const rulesJson = JSON.stringify(Array.isArray(rules) ? rules : (rules ? [rules] : []));
        this.db.prepare(`INSERT INTO communities
            (id,name,description,icon,cover_image,creator_id,creator_name,is_public,member_count,category,tags,rules,links,moderation_tone,color,handle,theme,join_policy,soma_assist,soma_features,structure,verified,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id, String(name).trim(), description, icon, coverImage, creatorId, creatorName, isPublic ? 1 : 0, 1,
                category || 'General', JSON.stringify(Array.isArray(tags) ? tags : []), rulesJson,
                JSON.stringify(Array.isArray(links) ? links : []), moderationTone || 'thoughtful',
                color || '', finalHandle, theme || '', joinPolicy || 'open', somaAssist ? 1 : 0,
                JSON.stringify(Array.isArray(somaFeatures) ? somaFeatures : []), structure || '', verified ? 1 : 0, now, now);
        // Founder is admin
        this.joinCommunity(id, { userId: creatorId, userName: creatorName, role: 'admin', force: true });
        // A real workspace + channels back the community (not just a feed)
        try {
            const ws = this.createWorkspace({
                name, icon: (typeof icon === 'string' && icon.length <= 4) ? icon : '💬',
                color: color || 'blue', createdBy: creatorId, type: 'community', description, community_id: id,
            });
            const extra = (Array.isArray(channels) ? channels : []).map(c => String(c || '').trim())
                .filter(Boolean).filter(c => c.toLowerCase() !== 'general');
            for (const ch of extra) { try { this.createChannel({ workspaceId: ws.id, name: ch, createdBy: creatorId }); } catch {} }
            this.db.prepare('UPDATE communities SET workspace_id = ? WHERE id = ?').run(ws.id, id);
        } catch {}
        // SOMA "welcome" assist drops a founding post
        try {
            const wantsWelcome = somaAssist && (!Array.isArray(somaFeatures) || !somaFeatures.length || somaFeatures.some(f => /welcome/i.test(f)));
            if (wantsWelcome) this.createCommunityPost({ communityId: id, authorId: creatorId, authorName: creatorName,
                content: `${String(name).trim()} is live. ${description || 'Welcome — introduce yourself and start the first thread.'}`.trim() });
        } catch {}
        return this.getCommunity(id, { userId: creatorId });
    }
    approveCommunityMember(communityId, userId) {
        this.db.prepare("UPDATE community_members SET status = 'active' WHERE community_id = ? AND user_id = ?").run(communityId, userId);
        this.db.prepare("UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active') WHERE id = ?").run(communityId, communityId);
        return this.getCommunityRole(communityId, userId);
    }
    getCommunityJoinRequests(communityId) {
        return this.db.prepare("SELECT * FROM community_members WHERE community_id = ? AND status = 'pending' ORDER BY joined_at ASC").all(communityId);
    }
    updateCommunity(id, { name, description, icon, coverImage, isPublic, category, tags, rules, links, moderationTone, color, handle, theme, joinPolicy, somaAssist, somaFeatures, structure, verified } = {}) {
        const fields = [], vals = [];
        if (name        !== undefined) { fields.push('name = ?');        vals.push(name); }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (icon        !== undefined) { fields.push('icon = ?');        vals.push(icon); }
        if (coverImage  !== undefined) { fields.push('cover_image = ?'); vals.push(coverImage); }
        if (isPublic    !== undefined) { fields.push('is_public = ?');   vals.push(isPublic ? 1 : 0); }
        if (category    !== undefined) { fields.push('category = ?');    vals.push(category || 'General'); }
        if (tags        !== undefined) { fields.push('tags = ?');        vals.push(JSON.stringify(Array.isArray(tags) ? tags : [])); }
        if (rules       !== undefined) { fields.push('rules = ?');       vals.push(JSON.stringify(Array.isArray(rules) ? rules : (rules ? [rules] : []))); }
        if (links       !== undefined) { fields.push('links = ?');       vals.push(JSON.stringify(Array.isArray(links) ? links : [])); }
        if (moderationTone !== undefined) { fields.push('moderation_tone = ?'); vals.push(moderationTone || 'thoughtful'); }
        if (color       !== undefined) { fields.push('color = ?');       vals.push(color || ''); }
        if (handle      !== undefined) { fields.push('handle = ?');      vals.push(handle || ''); }
        if (theme       !== undefined) { fields.push('theme = ?');       vals.push(theme || ''); }
        if (joinPolicy  !== undefined) { fields.push('join_policy = ?'); vals.push(joinPolicy || 'open'); }
        if (somaAssist  !== undefined) { fields.push('soma_assist = ?'); vals.push(somaAssist ? 1 : 0); }
        if (somaFeatures !== undefined) { fields.push('soma_features = ?'); vals.push(JSON.stringify(Array.isArray(somaFeatures) ? somaFeatures : [])); }
        if (structure   !== undefined) { fields.push('structure = ?');   vals.push(structure || ''); }
        if (verified    !== undefined) { fields.push('verified = ?');    vals.push(verified ? 1 : 0); }
        if (!fields.length) return this.getCommunity(id);
        fields.push('updated_at = ?'); vals.push(Date.now());
        vals.push(id);
        this.db.prepare(`UPDATE communities SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
        return this.getCommunity(id);
    }
    deleteCommunity(id) { this.db.prepare('DELETE FROM communities WHERE id = ?').run(id); }
    joinCommunity(communityId, { userId, userName, userAvatar = '', role = 'member', force = false }) {
        const com = this.db.prepare('SELECT join_policy, creator_id FROM communities WHERE id = ?').get(communityId);
        const policy = (com && com.join_policy) || 'open';
        const status = (!force && role === 'member' && policy !== 'open' && (!com || com.creator_id !== userId)) ? 'pending' : 'active';
        this.db.prepare('INSERT OR IGNORE INTO community_members (community_id,user_id,user_name,user_avatar,role,status,joined_at) VALUES (?,?,?,?,?,?,?)').run(communityId, userId, userName, userAvatar, role, status, Date.now());
        this.db.prepare("UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active') WHERE id = ?").run(communityId, communityId);
        return { status };
    }
    leaveCommunity(communityId, userId) {
        this.db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(communityId, userId);
        this.db.prepare('UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ?) WHERE id = ?').run(communityId, communityId);
    }
    getCommunityMembers(communityId) { return this.db.prepare('SELECT * FROM community_members WHERE community_id = ? ORDER BY joined_at ASC').all(communityId); }

    // ── Community Posts ──────────────────────────────────────────────────────
    getCommunityPosts(communityId, { limit = 50, before = null } = {}) {
        const params = [communityId];
        let sql = 'SELECT * FROM community_posts WHERE community_id = ?';
        if (before) { sql += ' AND created_at < ?'; params.push(before); }
        sql += ' ORDER BY is_pinned DESC, created_at DESC LIMIT ?';
        params.push(Math.min(limit, 100));
        return this.db.prepare(sql).all(...params).map(p => ({ ...p, images: JSON.parse(p.images || '[]') }));
    }
    createCommunityPost({ communityId, authorId, authorName, authorAvatar = '', content, images = [] }) {
        const id = `post-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO community_posts (id,community_id,author_id,author_name,author_avatar,content,images,likes_count,comments_count,is_pinned,created_at) VALUES (?,?,?,?,?,?,?,0,0,0,?)').run(id, communityId, authorId, authorName, authorAvatar, content, JSON.stringify(images), now);
        return { ...this.db.prepare('SELECT * FROM community_posts WHERE id = ?').get(id), images };
    }
    deleteCommunityPost(id) { this.db.prepare('DELETE FROM community_posts WHERE id = ?').run(id); }
    pinCommunityPost(id, pinned) { this.db.prepare('UPDATE community_posts SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id); }
    likeCommunityPost(postId, userId) {
        try { this.db.prepare('INSERT INTO community_post_likes (post_id,user_id,created_at) VALUES (?,?,?)').run(postId, userId, Date.now()); } catch {}
        this.db.prepare('UPDATE community_posts SET likes_count = (SELECT COUNT(*) FROM community_post_likes WHERE post_id = ?) WHERE id = ?').run(postId, postId);
        return this.db.prepare('SELECT likes_count FROM community_posts WHERE id = ?').get(postId)?.likes_count || 0;
    }
    unlikeCommunityPost(postId, userId) {
        this.db.prepare('DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
        this.db.prepare('UPDATE community_posts SET likes_count = (SELECT COUNT(*) FROM community_post_likes WHERE post_id = ?) WHERE id = ?').run(postId, postId);
        return this.db.prepare('SELECT likes_count FROM community_posts WHERE id = ?').get(postId)?.likes_count || 0;
    }
    hasLikedPost(postId, userId) { return !!this.db.prepare('SELECT 1 FROM community_post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId); }
    getCommunityPostComments(postId) { return this.db.prepare('SELECT * FROM community_post_comments WHERE post_id = ? ORDER BY created_at ASC').all(postId); }
    addCommunityPostComment({ postId, authorId, authorName, authorAvatar = '', content }) {
        const id = `pcom-${uid()}`, now = Date.now();
        this.db.prepare('INSERT INTO community_post_comments (id,post_id,author_id,author_name,author_avatar,content,created_at) VALUES (?,?,?,?,?,?,?)').run(id, postId, authorId, authorName, authorAvatar, content, now);
        this.db.prepare('UPDATE community_posts SET comments_count = (SELECT COUNT(*) FROM community_post_comments WHERE post_id = ?) WHERE id = ?').run(postId, postId);
        return this.db.prepare('SELECT * FROM community_post_comments WHERE id = ?').get(id);
    }

    stats() {
        const now = Date.now();
        return {
            workspaces: this.db.prepare('SELECT COUNT(*) as n FROM workspaces').get().n,
            channels:   this.db.prepare('SELECT COUNT(*) as n FROM channels').get().n,
            messages:   this.db.prepare('SELECT COUNT(*) as n FROM messages WHERE expires_at IS NULL OR expires_at > ?').get(now).n,
            members:    this.db.prepare('SELECT COUNT(DISTINCT user_id) as n FROM members').get().n,
        };
    }
}

export default new AxisStore();
