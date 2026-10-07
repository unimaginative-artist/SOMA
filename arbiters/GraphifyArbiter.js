/**
 * GraphifyArbiter.js - Bridge between SOMA and Graphify Knowledge Graph
 * 
 * Provides production-grade indexing and querying capabilities by wrapping
 * Safi Shamsi's Graphify engine. Replaces legacy flat indexing with a
 * community-aware, multi-hop semantic graph.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { CONFIG } from '../core/SomaConfig.js';

export class GraphifyArbiter extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.name = 'GraphifyArbiter';
        this.messageBroker = opts.messageBroker;
        
        // Paths
        this.projectRoot = opts.projectRoot || process.cwd();
        this.graphDir = path.join(this.projectRoot, 'graphify-out');
        this.graphJsonPath = path.join(this.graphDir, 'graph.json');
        this.graphIndexPath = path.join(this.projectRoot, 'SOMA', 'graph-retrieval.sqlite');
        this.graphifyExe = opts.graphifyExe || CONFIG.graphifyPath || 'graphify'; 
        this.autoIndexOnBoot = opts.autoIndexOnBoot ?? process.env.SOMA_GRAPHIFY_BOOT_INDEX === 'true';
        this.backgroundIndexOnBoot = opts.backgroundIndexOnBoot ?? process.env.SOMA_GRAPHIFY_BACKGROUND_INDEX === 'true';
        this.commandTimeoutMs = Number.parseInt(process.env.SOMA_GRAPHIFY_TIMEOUT_MS || '120000', 10);
        
        // State
        this.isIndexing = false;
        this.lastUpdate = null;
        this.stats = {
            nodes: 0,
            edges: 0,
            communities: 0
        };

        console.log(`[${this.name}] 🕸️ Initialized`);
    }

    async initialize() {
        console.log(`[${this.name}] 🔍 Verifying knowledge graph...`);
        
        // 1. Check if graph exists
        try {
            await fs.access(this.graphJsonPath);
            await this._loadStats();
            console.log(`[${this.name}] ✅ Found existing graph: ${this.stats.nodes} nodes, ${this.stats.edges} edges`);
        } catch (e) {
            console.log(`[${this.name}] 🆕 No existing graph found. Initial indexing required.`);
        }

        // 2. Register with MessageBroker before any optional indexing work.
        if (this.messageBroker) {
            this.messageBroker.registerArbiter(this.name, {
                instance: this,
                type: 'knowledge-graph-v2',
                capabilities: ['graph_query', 'graph_path', 'graph_update', 'community_analysis']
            });

            this.messageBroker.subscribe('graph.query', this.handleQuery.bind(this));
            this.messageBroker.subscribe('graph.update', this.triggerUpdate.bind(this));
        }

        // 3. Domain indexing is expensive on large graphs, so it is opt-in at boot.
        const domainDirs = [
            { path: path.join(this.projectRoot, 'data', 'vault', 'reflections'), category: 'reflection' },
            { path: path.join(this.projectRoot, 'knowledge', 'medical'), category: 'medical' },
            { path: path.join(this.projectRoot, 'knowledge', 'finance'), category: 'financial' }
        ];

        if (this.autoIndexOnBoot) {
            await this._indexDomainDirectories(domainDirs);
        } else if (this.backgroundIndexOnBoot) {
            console.log(`[${this.name}] Boot indexing scheduled in background`);
            setTimeout(() => {
                this._indexDomainDirectories(domainDirs)
                    .catch(error => console.error(`[${this.name}] Background indexing failed:`, error.message));
            }, 30000).unref?.();
        } else {
            console.log(`[${this.name}] Boot indexing skipped. Set SOMA_GRAPHIFY_BOOT_INDEX=true to run synchronously or SOMA_GRAPHIFY_BACKGROUND_INDEX=true to run after startup.`);
        }

        return { success: true };
    }

    async _loadStats() {
        try {
            // Never parse the 100MB+ graph JSON in Soma's main process merely
            // to calculate counters. The retrieval projection has the same
            // node/edge/community facts and opens read-only in milliseconds.
            await fs.access(this.graphIndexPath);
            const db = new Database(this.graphIndexPath, { readonly: true, fileMustExist: true });
            this.stats = {
                nodes: db.prepare('SELECT COUNT(*) AS count FROM nodes').get().count,
                edges: db.prepare('SELECT COUNT(*) AS count FROM edges').get().count,
                communities: db.prepare("SELECT COUNT(DISTINCT community) AS count FROM nodes WHERE community != ''").get().count
            };
            db.close();
            this.lastUpdate = Date.now();
        } catch (e) {
            console.warn(`[${this.name}] Failed to load graph stats: ${e.message}`);
        }
    }

    /**
     * Executes a graph traversal query via Graphify CLI
     */
    async query(question, options = {}) {
        const budget = options.budget || 2000;
        
        console.log(`[${this.name}] 🧠 Querying graph: "${question}"`);
        
        try {
            const args = ['query', String(question), '--budget', String(budget)];
            if (options.dfs) args.push('--dfs');
            const output = await this._runCommand(args);
            return {
                success: true,
                raw: output,
                question
            };
        } catch (error) {
            console.error(`[${this.name}] ❌ Query failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Finds shortest path between two nodes
     */
    async findPath(nodeA, nodeB) {
        try {
            const output = await this._runCommand(['path', String(nodeA), String(nodeB)]);
            return { success: true, path: output };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Explains a specific node and its immediate neighbors
     */
    async explain(nodeLabel) {
        try {
            const output = await this._runCommand(['explain', String(nodeLabel)]);
            return { success: true, explanation: output };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Triggers incremental AST update of the graph
     */
    async triggerUpdate(force = false) {
        if (this.isIndexing) {
            console.log(`[${this.name}] ⏳ Update already in progress...`);
            return { success: false, message: 'Update in progress' };
        }

        this.isIndexing = true;
        console.log(`[${this.name}] 🔄 Triggering graph update...`);

        try {
            const args = ['update', '.'];
            if (force) args.push('--force');
            
            await this._runCommand(args);
            await this._loadStats();
            
            console.log(`[${this.name}] ✅ Graph updated: ${this.stats.nodes} nodes`);
            this.emit('updated', this.stats);
            return { success: true, stats: this.stats };
        } catch (error) {
            console.error(`[${this.name}] ❌ Update failed:`, error.message);
            return { success: false, error: error.message };
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Semantically indexes a directory of markdown files into the knowledge graph
     * by wrapping them as Graphify results.
     */
    async indexDirectory(dirPath, category = 'knowledge') {
        console.log(`[${this.name}] 📂 Indexing ${category} from: ${dirPath}`);
        try {
            const files = await fs.readdir(dirPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));
            const memoryDir = path.join(this.graphDir, 'memory');
            await fs.mkdir(memoryDir, { recursive: true });

            for (const file of mdFiles) {
                const filePath = path.join(dirPath, file);
                const content = await fs.readFile(filePath, 'utf8');
                const timestamp = new Date().toISOString();
                const safeName = file.replace(/[^a-zA-Z0-9]/g, '_');
                const memoryFile = path.join(memoryDir, `${category}_${Date.now()}_${safeName}`);
                
                const memoryContent = `---
type: "query"
date: "${timestamp}"
question: "${category}: ${file}"
contributor: "SOMA_${this.name}"
source_nodes: ["${category}", "system"]
---

# Q: ${category}: ${file}

## Answer

${content}

## Source Nodes

- ${category}
- system
`;
                await fs.writeFile(memoryFile, memoryContent);
            }
            
            // After injection, update the graph to fuse the new memory nodes
            await this.triggerUpdate();
            return { success: true, count: mdFiles.length };
        } catch (error) {
            console.error(`[${this.name}] ❌ Directory indexing failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async _indexDomainDirectories(domainDirs) {
        for (const dir of domainDirs) {
            try {
                await fs.access(dir.path);
                await this.indexDirectory(dir.path, dir.category);
            } catch (e) {
                // Skip missing directories.
            }
        }
    }

    /**
     * Internal command runner for Graphify CLI
     */
    _runCommand(args) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const child = spawn(this.graphifyExe, args, {
                cwd: this.projectRoot,
                shell: false,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';
            const timeoutMs = Number.isFinite(this.commandTimeoutMs) && this.commandTimeoutMs > 0
                ? this.commandTimeoutMs
                : 120000;

            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(value);
            };

            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                finish(reject, new Error(`Graphify command timed out after ${timeoutMs}ms: ${args.join(' ')}`));
            }, timeoutMs);

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                if (code === 0) finish(resolve, stdout.trim());
                else finish(reject, new Error(stderr.trim() || `Process exited with code ${code}`));
            });

            child.on('error', (error) => {
                finish(reject, error);
            });
        });
    }

    // ==================== MESSAGE HANDLERS ====================

    async handleQuery(payload) {
        return await this.query(payload.question, payload.options);
    }

    getStatus() {
        return {
            name: this.name,
            indexing: this.isIndexing,
            lastUpdate: this.lastUpdate,
            stats: this.stats,
            graphPath: this.graphJsonPath
        };
    }
}

export default GraphifyArbiter;
