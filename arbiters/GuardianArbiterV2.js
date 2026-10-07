
import BaseArbiterV4, { ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
const BaseArbiter = BaseArbiterV4; // Alias for compatibility
import fs from 'fs/promises';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { GuardianArbiter } from './GuardianArbiter.js';
import Database from 'better-sqlite3';
import { NodeVM } from 'vm2';
import os from 'os';
import crypto from 'crypto';

const TMP_DIR = path.join(process.cwd(), '.soma', 'immune_system_tmp');
// Ensure temp dir exists
fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

// --------------------- Antibody (Clone) ---------------------
class AntibodyClone {
  constructor(id, originalPath, logger) {
    this.id = id;
    this.originalPath = originalPath;
    this.tmpDir = path.join(TMP_DIR, `antibody_${this.id}`);
    this.patchedPath = path.join(this.tmpDir, path.basename(originalPath));
    this.logger = logger;
  }

  async prepare() {
    await fs.mkdir(this.tmpDir, { recursive: true });
  }

  async injectPatch(patchCode) {
    await fs.writeFile(this.patchedPath, patchCode, 'utf8');
  }

  async verify(timeoutMs = 5000) {
    console.log(`[Antibody ${this.id}] 🧪 Verifying patch...`);
    
    try {
      const code = await fs.readFile(this.patchedPath, 'utf8');
      
      const vm = new NodeVM({
        console: 'inherit',
        sandbox: {},
        require: {
          external: true, // Allow external modules
          builtin: ['*'],
          root: process.cwd() // Allow loading project modules
        },
        wrapper: 'commonjs',
        timeout: timeoutMs
      });

      // Try to load the module
      const exported = vm.run(code, this.patchedPath);
      
      // Basic verification: Did it export something?
      if (!exported) throw new Error('Module exported nothing');
      if (exported.status === 'crashed') throw new Error(exported.error || 'Module reported crash');

      console.log(`[Antibody ${this.id}] ✅ Verification SUCCESS`);
      return { success: true };

    } catch (err) {
      console.warn(`[Antibody ${this.id}] ❌ Verification FAILED: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async cleanup() {
    try {
        await fs.rm(this.tmpDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  }
}

export class SelfHealingCloningGuardianArbiter extends BaseArbiter {
  static role = ArbiterRole.IMMUNE_SYSTEM;
  static capabilities = [ArbiterCapability.MONITOR_HEALTH, ArbiterCapability.PATCH_CODE, ArbiterCapability.VERIFY_FIX];

  constructor(config = {}) {
    super({
      name: 'SelfHealingCloningGuardianArbiter',
      role: SelfHealingCloningGuardianArbiter.role,
      capabilities: SelfHealingCloningGuardianArbiter.capabilities
    });

    this.quadBrain = config.quadBrain;
    this.clones = new Map();
    this.maxClones = 10;
    this.guardian = new GuardianArbiter({ quadBrain: this.quadBrain });

    // Relative to project root
    this.rootPath = process.cwd();
    this.storagePath = path.join(this.rootPath, 'SOMA', 'polymer-storage');
    this.compressedPath = path.join(this.storagePath, 'compressed');
    this.resultsPath = path.join(this.rootPath, 'SOMA', 'polymer-results');
    this.dbPath = path.join(this.storagePath, 'guardian.db');

    this.issueHistory = new Map();
    this.db = null; // Will be initialized
    this.logger = this; // Reference for AntibodyClone logging
  }

  async initialize() {
    try {
      await super.initialize();
      await this.ensureStorageFolders();
      await this.ensureResultsFolder();
      await this.initializeDatabase();
      this.startMonitoring();
      console.log(`[${this.name}] Initialized with storage at ${this.storagePath}`);
      return true;
    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error.message);
      console.error(`[${this.name}] Stack:`, error.stack);
      // Don't throw - allow SOMA to continue without GuardianArbiterV2
      return false;
    }
  }

  async initializeDatabase() {
    try {
      this.db = new Database(this.dbPath);
      // Create tables if not exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT,
          path TEXT,
          createdAt INTEGER,
          tags TEXT
        );
      `);
      console.log(`[${this.name}] Database initialized at ${this.dbPath}`);
    } catch (err) {
      console.error(`[${this.name}] Database initialization failed: ${err.message}`);
      throw err;
    }
  }

  startMonitoring() {
    if (!this.db) {
      console.warn(`[${this.name}] ⚠️ Cannot start monitoring - database not initialized`);
      return;
    }
    this.monitoringInterval = setInterval(async () => await this.checkHealth(), 30000);
    console.log(`[${this.name}] Monitoring started (30s interval)`);
  }

  async checkHealth() {
    // Check internal DB health
    if (!this.db) {
      console.warn(`[${this.name}] ⚠️ Health check skipped - database not initialized`);
      return;
    }

    try {
      this.db.prepare('SELECT 1').get();
    } catch (error) {
      console.error('Database health check failed:', error);
      await this.selfHeal({ type: 'database-failure', error });
    }

    // NOTE: In the original code, this checked orchestrator.arbiters directly.
    // In SOMA V2, we should use the MessageBroker or known arbiter list.
    // For now, we'll implement a self-check and basic system check.

    // Check if we can query the broker for other arbiters
    if (this.broker) {
      // Placeholder for distributed health check
      // await this.broker.broadcast('health_check', {});
    }
  }

  async selfHeal(issue) {
    console.log(`🔧 Healing requested: ${issue.type}`);
    if (this.clones.size >= this.maxClones) {
      console.warn('Max clone limit reached — merging clones');
      await this.mergeAllClones();
    }
    const cloneId = await this.createClone(issue);
    const clone = this.clones.get(cloneId);

    // Run sandbox fix loop
    const sandboxResult = await this.sandboxAutoFixLoop(clone);

    if (sandboxResult.success) {
      console.log(`✅ Clone ${cloneId} passed sandbox testing. Merging back.`);
      await this.mergeClone(cloneId);
      return { success: true, cloneId, merged: true };
    } else {
      console.warn(`⚠️ Clone ${cloneId} failed sandbox testing. Discarding clone.`);
      this.clones.delete(cloneId);
      return { success: false, cloneId, merged: false };
    }
  }

  async sandboxAutoFixLoop(clone, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      console.log(`🔄 Sandbox Auto-Fix attempt ${attempt} for clone ${clone.id}`);
      try {
        const fixProposal = await clone.guardian.handleIssues([clone.issue]);
        if (!fixProposal.success) continue;
        
        // Don't apply fix to real file yet - verify in sandbox first
        // const applied = await clone.applyFix(fixProposal.patch); // SKIP THIS
        
        // Pass the patch CONTENT to the sandbox
        // Assuming fixProposal.patch contains the code
        const testResult = await clone.runSandboxTests(fixProposal.patch);
        
        if (testResult.success) {
            // NOW apply the fix if verified
            await clone.applyFix(fixProposal.patch);
            return { success: true, attempt };
        }
      } catch (error) {
        console.error(`Sandbox Auto-Fix error:`, error);
      }
    }
    return { success: false, attempts: attempt };
  }

  async createClone(issue) {
    const cloneId = `clone-${Date.now()}`;
    // Create a shallow copy for simulation
    // In a real VM environment, this would spin up a new process/container
    const clone = Object.create(this);
    clone.id = cloneId;
    clone.issue = issue;
    clone.guardian = this.guardian; // Use same guardian logic
    this.clones.set(cloneId, clone);
    return cloneId;
  }

  async mergeClone(cloneId) {
    const clone = this.clones.get(cloneId);
    if (!clone) return false;
    console.log(`Merging clone ${cloneId} back into parent.`);
    this.clones.delete(cloneId);
    return true;
  }

  async mergeAllClones() {
    for (const cloneId of this.clones.keys()) {
      await this.mergeClone(cloneId);
    }
  }

  async applyFix(patch) {
    try {
      // In a real scenario, this writes to the clone's sandboxed file
      // For this implementation, we just log it
      console.log(`[Clone] Applying patch: ${patch.substring(0, 50)}...`);
      // await fs.writeFile(this.getCodePath(), patch, 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to apply fix:', error);
      return false;
    }
  }

  async runSandboxTests(patchCode) {
    const antibodyId = crypto.randomUUID();
    // Assuming this.issue.path contains the file path
    const targetPath = this.issue.path || this.getCodePath(); 
    const antibody = new AntibodyClone(antibodyId, targetPath, this.logger);

    try {
        await antibody.prepare();
        await antibody.injectPatch(patchCode);
        return await antibody.verify();
    } catch (error) {
        console.error('Sandbox test critical failure:', error);
        return { success: false, error: error.message };
    } finally {
        await antibody.cleanup();
    }
  }

  getCodePath() {
    return path.join(this.rootPath, 'arbiters', `${this.constructor.name}.js`);
  }

  async ensureStorageFolders() {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(this.compressedPath, { recursive: true });
  }

  async ensureResultsFolder() {
    await fs.mkdir(this.resultsPath, { recursive: true });
  }

  async execute(task) {
    return this.processTask(task);
  }

  async processTask(task) {
    // BaseArbiter metric
    // this.taskCount++; (handled by BaseArbiter metrics)

    try {
      const { type, payload } = task;
      switch (type) {
        case 'analyze-storage': return await this.analyzeStorage(payload.path || this.storagePath);
        case 'compress-file': return await this.compressFile(payload.filepath);
        case 'compress-folder': return await this.compressFolder(payload.folderpath);
        case 'decompress-file': return await this.decompressFile(payload.filepath);
        case 'cleanup': return await this.cleanupOldFiles(payload.olderThanDays || 30);
        case 'find-duplicates': return await this.findDuplicates(payload.path || this.storagePath);
        case 'storage-report': return await this.generateStorageReport();
        case 'organize': return await this.organizeResults(payload);
        case 'tag': return await this.tagResult(payload.id, payload.tags);
        case 'search': return await this.searchResults(payload.query);
        default: throw new Error(`Unknown task type: ${type}`);
      }
    } catch (err) {
      throw err;
    }
  }

  // ───── STORAGE FUNCTIONS ─────
  async analyzeStorage(targetPath) {
    const analysis = { path: targetPath, totalSize: 0, totalFiles: 0, totalFolders: 0, fileTypes: {}, largestFiles: [], oldestFiles: [], newestFiles: [] };
    const files = await this.scanDirectory(targetPath);
    for (const file of files) {
      try {
        const stats = await fs.stat(file.path);
        if (stats.isFile()) {
          analysis.totalFiles++;
          analysis.totalSize += stats.size;
          const ext = path.extname(file.path) || 'no-extension';
          if (!analysis.fileTypes[ext]) analysis.fileTypes[ext] = { count: 0, size: 0 };
          analysis.fileTypes[ext].count++;
          analysis.fileTypes[ext].size += stats.size;
          analysis.largestFiles.push({ path: file.path, size: stats.size, modified: stats.mtime });
          analysis.oldestFiles.push({ path: file.path, modified: stats.mtime });
          analysis.newestFiles.push({ path: file.path, modified: stats.mtime });
        } else if (stats.isDirectory()) analysis.totalFolders++;
      } catch (error) {
        console.warn(`Failed to stat ${file.path}:`, error.message);
      }
    }
    analysis.largestFiles.sort((a, b) => b.size - a.size).splice(10);
    analysis.oldestFiles.sort((a, b) => a.modified - b.modified).splice(10);
    analysis.newestFiles.sort((a, b) => b.modified - a.modified).splice(10);
    return { success: true, data: analysis };
  }

  async scanDirectory(dir, fileList = []) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filepath = path.join(dir, file);
      const stat = await fs.stat(filepath);
      if (stat.isDirectory()) await this.scanDirectory(filepath, fileList);
      else fileList.push({ path: filepath, size: stat.size });
    }
    return fileList;
  }

  async compressFile(filepath) {
    const outputPath = path.join(this.compressedPath, path.basename(filepath) + '.gz');
    try {
      await pipeline(createReadStream(filepath), createGzip({ level: 9 }), createWriteStream(outputPath));
      const originalSize = (await fs.stat(filepath)).size;
      const compressedSize = (await fs.stat(outputPath)).size;
      return { success: true, data: { original: filepath, compressed: outputPath, originalSize, compressedSize } };
    } catch (error) {
      throw error;
    }
  }

  async compressFolder(folderpath) {
    const files = await this.scanDirectory(folderpath);
    const results = [];
    let totalOriginal = 0, totalCompressed = 0;
    for (const file of files) {
      try {
        const result = await this.compressFile(file.path);
        results.push(result.data);
        totalOriginal += result.data.originalSize;
        totalCompressed += result.data.compressedSize;
      } catch { }
    }
    return { success: true, data: { filesCompressed: results.length, totalOriginalSize: totalOriginal, totalCompressedSize: totalCompressed, files: results } };
  }

  async decompressFile(filepath) {
    if (!filepath.endsWith('.gz')) throw new Error('File must be .gz format');
    const outputPath = filepath.replace('.gz', '');
    try {
      await pipeline(createReadStream(filepath), createGunzip(), createWriteStream(outputPath));
      return { success: true, data: { compressed: filepath, decompressed: outputPath } };
    } catch (error) {
      throw error;
    }
  }

  async cleanupOldFiles(olderThanDays) {
    const cutoffDate = Date.now() - olderThanDays * 86400000;
    const files = await this.scanDirectory(this.storagePath);
    const deleted = [];
    for (const file of files) {
      try {
        const stats = await fs.stat(file.path);
        if (stats.mtime.getTime() < cutoffDate) {
          await fs.unlink(file.path);
          deleted.push({ path: file.path, size: stats.size });
        }
      } catch { }
    }
    return { success: true, data: { filesDeleted: deleted.length, files: deleted } };
  }

  async findDuplicates(targetPath) {
    const files = await this.scanDirectory(targetPath);
    const sizeMap = new Map(), duplicates = [];
    for (const file of files) {
      if (!sizeMap.has(file.size)) sizeMap.set(file.size, []);
      sizeMap.get(file.size).push(file.path);
    }
    for (const [size, paths] of sizeMap) {
      if (paths.length > 1) duplicates.push({ size, count: paths.length, paths });
    }
    return { success: true, data: { duplicateGroups: duplicates.length, duplicates } };
  }

  async generateStorageReport() {
    const analysis = await this.analyzeStorage(this.storagePath);
    const duplicates = await this.findDuplicates(this.storagePath);
    const report = { timestamp: new Date().toISOString(), summary: analysis.data, duplicates: duplicates.data };
    const reportPath = path.join(this.storagePath, `storage-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    return { success: true, data: report };
  }

  // ───── ORGANIZATION FUNCTIONS ─────
  async organizeResults(data) {
    const filename = `result-${Date.now()}.json`;
    const filepath = path.join(this.resultsPath, filename);
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));

    // DB Insert
    const stmt = this.db.prepare('INSERT INTO results (filename, path, createdAt, tags) VALUES (?, ?, ?, ?)');
    const info = stmt.run(filename, filepath, Date.now(), JSON.stringify(data.tags || []));

    return { filename, path: filepath, id: info.lastInsertRowid };
  }

  async tagResult(id, tags) {
    // DB Update
    const stmt = this.db.prepare('UPDATE results SET tags = ? WHERE id = ?');
    stmt.run(JSON.stringify(tags), id);
    return { id, tags };
  }

  async searchResults(query) {
    // DB Search (Simple LIKE search for now)
    const stmt = this.db.prepare('SELECT * FROM results WHERE tags LIKE ? OR filename LIKE ?');
    const results = stmt.all(`%${query}%`, `%${query}%`);
    return results.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}
