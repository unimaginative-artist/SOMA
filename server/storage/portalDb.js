import axisStore from '../axis/AxisStore.js';

class PortalDb {
    constructor() {
        this.db = axisStore.db;
        this.init();
    }

    
        init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS portal_tabs (
                id TEXT PRIMARY KEY,
                title TEXT,
                url TEXT,
                favicon TEXT,
                active INTEGER DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS portal_permissions (
                origin TEXT PRIMARY KEY,
                camera TEXT DEFAULT 'ask',
                microphone TEXT DEFAULT 'ask',
                location TEXT DEFAULT 'ask',
                notifications TEXT DEFAULT 'ask',
                clipboard TEXT DEFAULT 'ask',
                downloads TEXT DEFAULT 'ask',
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS portal_downloads (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                url TEXT NOT NULL,
                save_path TEXT NOT NULL,
                state TEXT NOT NULL, -- 'progress', 'completed', 'failed', 'cancelled'
                received_bytes INTEGER DEFAULT 0,
                total_bytes INTEGER DEFAULT 0,
                error_message TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS portal_credentials (
                id TEXT PRIMARY KEY,
                origin TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS portal_acquisition_queue (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL UNIQUE,
                title TEXT,
                state TEXT NOT NULL,
                depth INTEGER DEFAULT 0,
                error_message TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
    }

    // Permissions
    getPermissions(origin) {
        try {
            const row = this.db.prepare('SELECT * FROM portal_permissions WHERE origin = ?').get(origin);
            if (row) return row;
            return {
                origin,
                camera: 'ask',
                microphone: 'ask',
                location: 'ask',
                notifications: 'ask',
                clipboard: 'ask',
                downloads: 'ask'
            };
        } catch (e) {
            console.error('[PortalDb] Error getting permissions:', e);
            return null;
        }
    }

    setPermission(origin, permission, value) {
        const validPermissions = ['camera', 'microphone', 'location', 'notifications', 'clipboard', 'downloads'];
        if (!validPermissions.includes(permission)) {
            throw new Error(`Invalid permission type: ${permission}`);
        }
        const validValues = ['allow', 'deny', 'ask'];
        if (!validValues.includes(value)) {
            throw new Error(`Invalid permission value: ${value}`);
        }

        const now = Date.now();
        const existing = this.getPermissions(origin);
        if (existing && existing.updated_at) {
            this.db.prepare(`
                UPDATE portal_permissions
                SET ${permission} = ?, updated_at = ?
                WHERE origin = ?
            `).run(value, now, origin);
        } else {
            const defaults = {
                camera: 'ask',
                microphone: 'ask',
                location: 'ask',
                notifications: 'ask',
                clipboard: 'ask',
                downloads: 'ask',
                [permission]: value
            };
            this.db.prepare(`
                INSERT INTO portal_permissions (origin, camera, microphone, location, notifications, clipboard, downloads, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(origin, defaults.camera, defaults.microphone, defaults.location, defaults.notifications, defaults.clipboard, defaults.downloads, now);
        }
        return this.getPermissions(origin);
    }

    getAllPermissions() {
        return this.db.prepare('SELECT * FROM portal_permissions ORDER BY origin ASC').all();
    }

    deletePermissions(origin) {
        const res = this.db.prepare('DELETE FROM portal_permissions WHERE origin = ?').run(origin);
        return res.changes > 0;
    }

    // Downloads
    getDownloads() {
        return this.db.prepare('SELECT * FROM portal_downloads ORDER BY created_at DESC').all();
    }

    createDownload({ id, filename, url, savePath, totalBytes }) {
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO portal_downloads (id, filename, url, save_path, state, received_bytes, total_bytes, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'progress', 0, ?, ?, ?)
        `).run(id, filename, url, savePath, totalBytes || 0, now, now);
        return this.db.prepare('SELECT * FROM portal_downloads WHERE id = ?').get(id);
    }

    updateDownloadProgress(id, receivedBytes, state = 'progress') {
        const now = Date.now();
        this.db.prepare(`
            UPDATE portal_downloads
            SET received_bytes = ?, state = ?, updated_at = ?
            WHERE id = ?
        `).run(receivedBytes, state, now, id);
        return this.db.prepare('SELECT * FROM portal_downloads WHERE id = ?').get(id);
    }

    completeDownload(id, totalBytes = null) {
        const now = Date.now();
        if (totalBytes !== null) {
            this.db.prepare(`
                UPDATE portal_downloads
                SET state = 'completed', received_bytes = ?, total_bytes = ?, updated_at = ?
                WHERE id = ?
            `).run(totalBytes, totalBytes, now, id);
        } else {
            this.db.prepare(`
                UPDATE portal_downloads
                SET state = 'completed', received_bytes = total_bytes, updated_at = ?
                WHERE id = ?
            `).run(now, id);
        }
        return this.db.prepare('SELECT * FROM portal_downloads WHERE id = ?').get(id);
    }

    failDownload(id, errorMessage) {
        const now = Date.now();
        this.db.prepare(`
            UPDATE portal_downloads
            SET state = 'failed', error_message = ?, updated_at = ?
            WHERE id = ?
        `).run(errorMessage || 'Unknown download error', now, id);
        return this.db.prepare('SELECT * FROM portal_downloads WHERE id = ?').get(id);
    }

    deleteDownload(id) {
        const res = this.db.prepare('DELETE FROM portal_downloads WHERE id = ?').run(id);
        return res.changes > 0;
    }

    // Credentials
    getCredentials(origin) {
        try {
            return this.db.prepare('SELECT * FROM portal_credentials WHERE origin = ? ORDER BY created_at DESC').all(origin);
        } catch (e) {
            console.error('[PortalDb] Error getting credentials:', e);
            return [];
        }
    }

    getAllCredentials() {
        try {
            return this.db.prepare('SELECT * FROM portal_credentials ORDER BY origin ASC, username ASC').all();
        } catch (e) {
            console.error('[PortalDb] Error getting all credentials:', e);
            return [];
        }
    }

    saveCredential(origin, username, password) {
        try {
            const now = Date.now();
            const existing = this.db.prepare('SELECT id FROM portal_credentials WHERE origin = ? AND username = ?').get(origin, username);
            if (existing) {
                this.db.prepare(`
                    UPDATE portal_credentials
                    SET password = ?, updated_at = ?
                    WHERE id = ?
                `).run(password, now, existing.id);
                return this.db.prepare('SELECT * FROM portal_credentials WHERE id = ?').get(existing.id);
            } else {
                const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                this.db.prepare(`
                    INSERT INTO portal_credentials (id, origin, username, password, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(id, origin, username, password, now, now);
                return this.db.prepare('SELECT * FROM portal_credentials WHERE id = ?').get(id);
            }
        } catch (e) {
            console.error('[PortalDb] Error saving credential:', e);
            throw e;
        }
    }

    deleteCredential(id) {
        try {
            const res = this.db.prepare('DELETE FROM portal_credentials WHERE id = ?').run(id);
            return res.changes > 0;
        } catch (e) {
            console.error('[PortalDb] Error deleting credential:', e);
            return false;
        }
    }

    // Acquisition Queue
    getAcquisitionQueue() {
        try {
            return this.db.prepare('SELECT * FROM portal_acquisition_queue ORDER BY created_at ASC').all();
        } catch (e) {
            console.error('[PortalDb] Error getting acquisition queue:', e);
            return [];
        }
    }

    enqueueAcquisition({ url, title = '', depth = 0 }) {
        try {
            const now = Date.now();
            const id = `acq-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
            this.db.prepare(`
                INSERT INTO portal_acquisition_queue (id, url, title, state, depth, error_message, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', ?, '', ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    state = 'pending',
                    error_message = '',
                    updated_at = excluded.updated_at
            `).run(id, url, title, depth, now, now);
            return this.db.prepare('SELECT * FROM portal_acquisition_queue WHERE url = ?').get(url);
        } catch (e) {
            console.error('[PortalDb] Error enqueuing acquisition:', e);
            throw e;
        }
    }

    updateAcquisitionState(id, state, errorMessage = '') {
        try {
            const now = Date.now();
            this.db.prepare(`
                UPDATE portal_acquisition_queue
                SET state = ?, error_message = ?, updated_at = ?
                WHERE id = ?
            `).run(state, errorMessage, now, id);
            return this.db.prepare('SELECT * FROM portal_acquisition_queue WHERE id = ?').get(id);
        } catch (e) {
            console.error('[PortalDb] Error updating acquisition state:', e);
            throw e;
        }
    }

    deleteAcquisition(id) {
        try {
            const res = this.db.prepare('DELETE FROM portal_acquisition_queue WHERE id = ?').run(id);
            return res.changes > 0;
        } catch (e) {
            console.error('[PortalDb] Error deleting acquisition:', e);
            return false;
        }
    }

    saveTabs(tabs = []) {
        try {
            this.db.prepare('DELETE FROM portal_tabs').run();
            const stmt = this.db.prepare('INSERT INTO portal_tabs (id, title, url, favicon, active, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
            const now = Date.now();
            for (const t of tabs) {
                stmt.run(t.id || String(Math.random()), t.title || 'New Tab', t.url || 'about:blank', t.favicon || '', t.active ? 1 : 0, now);
            }
        } catch (e) {
            console.error('[PortalDb] Error saving tabs:', e.message);
        }
    }

    getSavedTabs() {
        try {
            return this.db.prepare('SELECT * FROM portal_tabs ORDER BY updated_at ASC').all() || [];
        } catch (e) {
            return [];
        }
    }
}

const portalDb = new PortalDb();
export default portalDb;
export { PortalDb };
