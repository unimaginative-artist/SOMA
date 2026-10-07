import fs from 'fs';
import path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'data', 'vault', 'memory_spine');

function ensureDir() {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

export class MemorySpine {
    constructor() {
        ensureDir();
        this.cache = {
            episodic: [],
            semantic: [],
            procedural: [],
            social: [],
            autobiographical: [],
            working: []
        };
        this.loadMemories();
    }

    loadMemories() {
        ensureDir();
        ['episodic', 'semantic', 'procedural', 'social', 'autobiographical', 'working'].forEach(type => {
            const fp = path.join(MEMORY_DIR, `${type}.json`);
            try {
                if (fs.existsSync(fp)) {
                    this.cache[type] = JSON.parse(fs.readFileSync(fp, 'utf8'));
                }
            } catch (e) {}
        });
        console.log('[MemorySpine] 📚 Unified Memory Spine initialized (Episodic: ' + this.cache.episodic.length + ', Social: ' + this.cache.social.length + ')');
    }

    saveMemoryType(type) {
        ensureDir();
        const fp = path.join(MEMORY_DIR, `${type}.json`);
        try {
            fs.writeFileSync(fp, JSON.stringify(this.cache[type] || [], null, 2), 'utf8');
        } catch (e) {}
    }

    recordMemory(type, entry = {}) {
        if (!this.cache[type]) this.cache[type] = [];
        const record = {
            id: `mem_${type}_${Date.now()}`,
            timestamp: Date.now(),
            ...entry
        };
        this.cache[type].unshift(record);
        if (this.cache[type].length > 500) this.cache[type] = this.cache[type].slice(0, 500);
        this.saveMemoryType(type);
        return record;
    }

    getMemories(type, limit = 10) {
        return (this.cache[type] || []).slice(0, limit);
    }
}

export default new MemorySpine();
