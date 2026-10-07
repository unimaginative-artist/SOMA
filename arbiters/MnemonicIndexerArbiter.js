import { BaseArbiterV4, ArbiterCapability, ArbiterRole } from './BaseArbiter.js';
import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Worker } from 'worker_threads';
import messageBroker from '../core/MessageBroker.js';
import { ContentExtractor } from '../server/utils/ContentExtractor.js';

/**
 * MnemonicIndexerArbiter - The "Always Knowing" file watcher.
 * Automatically indexes the codebase into SOMA's hybrid memory system.
 */
export default class MnemonicIndexerArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      name: opts.name || 'MnemonicIndexerArbiter',
      role: ArbiterRole.SPECIALIST,
      capabilities: [
        ArbiterCapability.READ_FILES,
        ArbiterCapability.MEMORY_ACCESS
      ],
      ...opts
    });

    this.watchPath = opts.watchPath || process.cwd();
    this.allowedRoots = opts.allowedRoots || [this.watchPath];
    this.ignored = opts.ignored || [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/SOMA/**',
      '**/package-lock.json',
      '**/*.log',
      '**/*.db',
      '**/*.ico',
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
      '**/*.zip',
      '**/*.exe',
      '**/*.bin'
    ];
    this.watcher = null;
    this.mnemonicArbiter = opts.mnemonicArbiter || null;
    this.storageArbiter = opts.storageArbiter || null; // Link to Storage Database
    this.indexingQueue = [];
    this.isProcessing = false;
    
    // Universal Content Extractor (PDF, DOCX, etc.)
    this.extractor = new ContentExtractor();

    // Resumable scan journal
    this.journalPath = opts.journalPath || path.join(process.cwd(), '.soma', 'index_journal.json');
    this.journal = new Map();
    this.journalDirty = false;
    this.journalSaveTimer = null;
    this.useWorkerPool = opts.useWorkerPool !== false;
    this.workerPool = null;
    this.dedupe = opts.dedupe || false;
    this.contentHashSet = new Set();
    this.pauseRequested = false;
    this.paused = false;
    this.lastScanStatePath = path.join(process.cwd(), '.soma', 'index_state.json');
    this.lastScanState = null;
    this._lastScanStateSave = 0;
    this.extractCacheDir = path.join(process.cwd(), '.soma', 'extract_cache');
  }

  async onInitialize() {
    this.log('info', `Initializing MnemonicIndexerArbiter watching ${this.watchPath}`);

    await this._loadJournal();
    await this._loadScanState();

    if (this.useWorkerPool) {
        const size = parseInt(process.env.SOMA_INDEX_WORKERS || '2', 10);
        this.workerPool = new IndexerWorkerPool(size);
        this.log('info', `Indexer worker pool online (${size} workers)`);
    }
    
    // Start watcher on default path
    this.startWatcher(this.watchPath);

    return true;
  }

  startWatcher(targetPath) {
    if (this.watcher) {
        this.watcher.add(targetPath);
    } else {
        this.watcher = chokidar.watch(targetPath, {
            ignored: this.ignored,
            persistent: true,
            ignoreInitial: true, // Don't scan everything on startup via watcher (use scanDirectory)
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });

        this.watcher
          .on('add', filePath => this.queueIndexing(filePath))
          .on('change', filePath => this.queueIndexing(filePath))
          .on('unlink', filePath => this.handleUnlink(filePath))
          .on('error', error => this.log('error', `Watcher error: ${error.message}`));
    }
  }

  /**
   * Fast initial scan of a directory tree
   */
  async scanDirectory(targetPath, options = {}) {
      this.log('info', `🚀 Starting deep scan of: ${targetPath}`);
      this.watchPath = targetPath;
      const startTime = Date.now();
      let scanned = 0;
      let indexed = 0;
      let skippedForMemory = 0;
      const progressCallback = options.progressCallback || null;
      const progressEvery = options.progressEvery || 100;
      const maxFiles = options.maxFiles || 50000;   // sane default — was 500000
      const maxDepth = options.maxDepth || 15;      // was 20
      const concurrency = options.concurrency || 2; // was 4 — 4x parallel remember() causes heap exhaustion
      const skipUnchanged = options.skipUnchanged !== false;
      const useHash = options.useHash || false;
      const dedupe = options.dedupe || process.env.SOMA_INDEX_DEDUP === 'true';
      const hashMaxSize = options.hashMaxSize || 1024 * 1024 * 2; // 2MB
      const throttleMs = options.throttleMs || 5;   // default 5ms breathing room for GC
      const HEAP_PRESSURE_THRESHOLD = 0.75;         // skip embedding above 75% heap usage
      const CONTENT_EMBED_MAX_CHARS = 2000;         // truncate before passing to MnemonicArbiter
      const MAX_FILE_SIZE_FOR_CONTENT = 2 * 1024 * 1024; // 2MB max for content read (was 10MB)

      // ── Pre-count total files so progress bar shows a real percentage ──
      // Quick pass: stat + readdir only, no content read. Usually <2s for 10k files.
      this.log('info', `Counting files in ${targetPath}...`);
      let totalFiles = 0;
      const quickCount = async (dir, depth = 0) => {
          if (depth > maxDepth || totalFiles >= maxFiles) return;
          try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const entry of entries) {
                  if (this._isIgnoredPath(path.join(dir, entry.name), entry.name)) continue;
                  if (entry.isDirectory()) await quickCount(path.join(dir, entry.name), depth + 1);
                  else if (entry.isFile()) totalFiles++;
              }
          } catch {}
      };
      await quickCount(targetPath);
      this.log('info', `Pre-count: ${totalFiles} files to scan`);

      this.lastScanState = {
          path: targetPath,
          startedAt: Date.now(),
          scanned: 0,
          indexed: 0,
          total: totalFiles,
          state: 'running'
      };
      this._saveScanState();

      const pool = new Set();
      const runTask = async (task) => {
          const p = task().finally(() => pool.delete(p));
          pool.add(p);
          if (pool.size >= concurrency) {
              await Promise.race(pool);
          }
      };

      // Recursive scanner function
      const scan = async (dir, depth = 0) => {
          if (depth > maxDepth || scanned >= maxFiles) return;
          try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const entry of entries) {
                  const fullPath = path.join(dir, entry.name);
                  
                  // Check ignore rules (basic)
                  if (this._isIgnoredPath(fullPath, entry.name)) continue;

                  await this._waitIfPaused();

                  if (entry.isDirectory()) {
                      await scan(fullPath, depth + 1);
                  } else if (entry.isFile()) {
                      scanned++;
                      this.lastScanState.scanned = scanned;

                      // Throttle state save (every 2s)
                      if (Date.now() - this._lastScanStateSave > 2000) {
                          this._saveScanState();
                          this._lastScanStateSave = Date.now();
                      }

                      // Heap guard — check memory before queuing embedding work
                      const mem = process.memoryUsage();
                      const heapPct = mem.heapUsed / mem.heapTotal;
                      const underPressure = heapPct > HEAP_PRESSURE_THRESHOLD;
                      if (underPressure) {
                          skippedForMemory++;
                          // Under pressure: just do fast metadata index, skip embedding
                          await this.fastIndex(fullPath, targetPath);
                          if (skippedForMemory % 50 === 1) {
                              this.log('warn', `Heap at ${(heapPct * 100).toFixed(0)}% — skipping embedding for ${skippedForMemory} files (fast-index only)`);
                          }
                      } else {
                          await runTask(async () => {
                              const didIndex = await this.indexFile(fullPath, {
                                  skipUnchanged,
                                  useHash,
                                  hashMaxSize,
                                  basePath: targetPath,
                                  dedupe,
                                  maxFileSizeForContent: MAX_FILE_SIZE_FOR_CONTENT,
                                  contentEmbedMaxChars: CONTENT_EMBED_MAX_CHARS
                              });
                              if (didIndex) indexed++;
                              this.lastScanState.indexed = indexed;
                          });
                      }

                      if (scanned % 500 === 0) this.log('info', `Scanned ${scanned}/${totalFiles} files (indexed: ${indexed}, skipped-mem: ${skippedForMemory})...`);
                      if (progressCallback && scanned % progressEvery === 0) {
                          progressCallback({ scanned, indexed, skippedForMemory, total: totalFiles, path: fullPath });
                      }
                      if (throttleMs > 0) {
                          await new Promise(r => setTimeout(r, throttleMs));
                      }
                  }
              }
          } catch (e) {
              this.log('warn', `Access denied: ${dir}`);
          }
      };

      await scan(targetPath);
      await Promise.all(pool);
      this.startWatcher(targetPath); // Watch for future changes
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.lastScanState = {
          path: targetPath,
          startedAt: this.lastScanState?.startedAt || Date.now(),
          finishedAt: Date.now(),
          scanned,
          indexed,
          duration,
          state: 'completed'
      };
      this._saveScanState();
      this.log('success', `✅ Scan complete. Indexed ${indexed}/${scanned} files in ${duration}s`);
      await this._saveJournal();
      return { scanned, indexed, duration };
  }

  /**
   * Fast Indexing: Stores metadata in Storage Database (Lightweight)
   */
  async fastIndex(filePath, basePath = null) {
      try {
          const stats = await fs.stat(filePath);
          const relativePath = path.relative(basePath || this.watchPath, filePath);
          
          const metadata = {
              path: filePath,
              name: path.basename(filePath),
              size: stats.size,
              modified: stats.mtime,
              type: 'file',
              indexedAt: Date.now()
          };

          // Store in Storage Database (Fast Lookups)
          if (this.storageArbiter) {
              await this.storageArbiter.store(`index/${filePath}`, metadata, 'database');
          }

      } catch (e) {
          // Ignore transient errors
      }
  }

  queueIndexing(filePath) {
    this.indexingQueue.push(filePath);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing || this.indexingQueue.length === 0) return;
    this.isProcessing = true;

    while (this.indexingQueue.length > 0) {
      const filePath = this.indexingQueue.shift();
      await this.indexFile(filePath);
    }

    this.isProcessing = false;
  }

  // Deep Indexing (Content Reading) - Only for changed files or small batches
  async indexFile(filePath, options = {}) {
    try {
      const stats = await fs.stat(filePath);
      const maxSizeForContent = options.maxFileSizeForContent || 2 * 1024 * 1024; // 2MB
      if (stats.size > maxSizeForContent) return; 

      const skipUnchanged = options.skipUnchanged !== false;
      const useHash = options.useHash || false;
      const hashMaxSize = options.hashMaxSize || 1024 * 1024 * 2;

      const fingerprint = await this._fingerprint(filePath, stats, { useHash, hashMaxSize });
      const journalEntry = this.journal.get(filePath);
      if (skipUnchanged && journalEntry?.fingerprint === fingerprint && journalEntry?.contentIndexed) {
          return false;
      }

      const basePath = options.basePath || this.watchPath;
      const dedupe = options.dedupe || false;
      await this.fastIndex(filePath, basePath); // Always update metadata first

      // Use Universal Content Extractor (worker pool if available)
      let content = null;
      const cachePath = path.join(this.extractCacheDir, `${fingerprint}.txt`);
      if (skipUnchanged) {
          const cached = await fs.readFile(cachePath, 'utf8').catch(() => null);
          if (cached) content = cached;
      }
      if (this.workerPool) {
          content = content || await this.workerPool.extract(filePath);
      } else {
          content = content || await this.extractor.extract(filePath);
      }
      
      if (!content) {
          // Skipped (binary or unsupported)
          return;
      }

      if (dedupe) {
          const contentHash = crypto.createHash('sha1').update(content).digest('hex');
          if (this.contentHashSet.has(contentHash)) {
              this._markIndexed(filePath, fingerprint);
              return false;
          }
          this.contentHashSet.add(contentHash);
      }

      const relativePath = path.relative(basePath, filePath);
      this.log('info', `Indexing: ${relativePath}`);

      const metadata = {
        type: 'file_content',
        path: relativePath,
        absolutePath: filePath,
        indexedAt: new Date().toISOString(),
        importance: 0.8, // Codebase files are highly important
        size: stats.size,
        modified: stats.mtimeMs,
        owner: process.env.USERNAME || process.env.USER || 'unknown'
      };

      // 1. Store in Memory — truncate content to avoid heap exhaustion during embedding
      if (this.mnemonicArbiter) {
        const maxChars = options.contentEmbedMaxChars || 2000;
        const embedContent = content.length > maxChars
          ? content.substring(0, maxChars) + `\n[...${Math.round((content.length - maxChars) / 1000)}k chars truncated for embedding]`
          : content;
        await this.mnemonicArbiter.remember(embedContent, metadata);
      }

      // 2. Notify Hybrid Search (Real-time updates)
      messageBroker.emit('index_document', {
          id: relativePath, // Use relative path as ID for stability
          content: content,
          metadata: {
              ...metadata,
              name: path.basename(filePath),
              extension: path.extname(filePath).substring(1),
              absolutePath: filePath
          }
      });

      await fs.mkdir(this.extractCacheDir, { recursive: true });
      await fs.writeFile(cachePath, content, 'utf8').catch(() => {});

      this._markIndexed(filePath, fingerprint);
      
      this.metrics.tasksCompleted++;
      return true;
    } catch (error) {
      this.log('error', `Failed to index file ${filePath}: ${error.message}`);
    }
    return false;
  }

  async handleUnlink(filePath) {
    const relativePath = path.relative(this.watchPath, filePath);
    this.log('info', `File removed: ${relativePath}`);
    this.journal.delete(filePath);
    this._scheduleJournalSave();
    
    // Notify Hybrid Search to remove from index
    // Note: HybridSearchArbiter needs a 'remove_document' handler (TODO)
    // For now we just log it, but in production we'd want to remove it.
  }

  async onShutdown() {
    if (this.watcher) {
      await this.watcher.close();
      this.log('info', 'MnemonicIndexerArbiter watcher closed');
    }
    if (this.workerPool) {
      await this.workerPool.close();
    }
    await this._saveJournal();
    return true;
  }

  getStatus() {
      return {
          watchPath: this.watchPath,
          journalSize: this.journal?.size || 0,
          queueLength: this.indexingQueue.length,
          isProcessing: this.isProcessing,
          paused: this.paused,
          lastScan: this.lastScanState
      };
  }

  pause() {
      this.pauseRequested = true;
  }

  resume() {
      this.pauseRequested = false;
      this.paused = false;
  }

  async _waitIfPaused() {
      if (!this.pauseRequested) return;
      this.paused = true;
      this.lastScanState = { ...(this.lastScanState || {}), state: 'paused' };
      this._saveScanState();
      while (this.pauseRequested) {
          await new Promise(r => setTimeout(r, 500));
      }
      this.paused = false;
      this.lastScanState = { ...(this.lastScanState || {}), state: 'running' };
      this._saveScanState();
  }

  async _loadScanState() {
      try {
          const raw = await fs.readFile(this.lastScanStatePath, 'utf8');
          this.lastScanState = JSON.parse(raw);
      } catch {
          this.lastScanState = null;
      }
  }

  async _saveScanState() {
      try {
          await fs.mkdir(path.dirname(this.lastScanStatePath), { recursive: true });
          await fs.writeFile(this.lastScanStatePath, JSON.stringify(this.lastScanState || {}, null, 2), 'utf8');
      } catch {
          // ignore
      }
  }

  _isIgnoredPath(fullPath, name = '') {
      if (name.startsWith('.')) return true;
      const lower = fullPath.toLowerCase();
      if (lower.includes(`${path.sep}node_modules${path.sep}`)) return true;
      if (lower.includes(`${path.sep}.git${path.sep}`)) return true;
      if (lower.includes(`${path.sep}dist${path.sep}`)) return true;
      if (lower.includes(`${path.sep}build${path.sep}`)) return true;
      for (const pattern of this.ignored) {
          if (pattern.includes('*')) continue;
          if (lower.includes(pattern.replace(/\*/g, '').toLowerCase())) return true;
      }
      return false;
  }

  async _fingerprint(filePath, stats, options = {}) {
      const base = `${stats.size}:${stats.mtimeMs}`;
      if (!options.useHash || stats.size > options.hashMaxSize) {
          return base;
      }
      try {
          const fd = await fs.open(filePath, 'r');
          const buffer = Buffer.alloc(Math.min(options.hashMaxSize, stats.size));
          const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
          await fd.close();
          const hash = crypto.createHash('sha1').update(buffer.slice(0, bytesRead)).digest('hex');
          return `${base}:${hash}`;
      } catch {
          return base;
      }
  }

  _markIndexed(filePath, fingerprint) {
      this.journal.set(filePath, {
          fingerprint,
          contentIndexed: true,
          indexedAt: Date.now()
      });
      this._scheduleJournalSave();
  }

  async _loadJournal() {
      try {
          const raw = await fs.readFile(this.journalPath, 'utf8');
          const data = JSON.parse(raw);
          this.journal = new Map(Object.entries(data || {}));
          this.log('info', `Journal loaded: ${this.journal.size} entries`);
      } catch {
          // First run
          this.journal = new Map();
      }
  }

  _scheduleJournalSave() {
      if (this.journalSaveTimer) return;
      this.journalSaveTimer = setTimeout(() => {
          this.journalSaveTimer = null;
          this._saveJournal();
      }, 2000);
  }

  async _saveJournal() {
      if (!this.journalPath) return;
      try {
          await fs.mkdir(path.dirname(this.journalPath), { recursive: true });
          const obj = Object.fromEntries(this.journal.entries());
          await fs.writeFile(this.journalPath, JSON.stringify(obj), 'utf8');
      } catch (e) {
          this.log('warn', `Failed to save journal: ${e.message}`);
      }
  }
}

class IndexerWorkerPool {
    constructor(size = 2) {
        this.size = size;
        this.workers = [];
        this.queue = [];
        this.pending = new Map();
        this.requestId = 0;

        for (let i = 0; i < size; i++) {
            const worker = new Worker(path.join(process.cwd(), 'server', 'workers', 'IndexerWorker.cjs'));
            worker.on('message', (msg) => this._handleMessage(worker, msg));
            worker.on('error', () => this._markIdle(worker));
            worker._busy = false;
            this.workers.push(worker);
        }
    }

    async extract(filePath) {
        return new Promise((resolve, reject) => {
            const requestId = this.requestId++;
            this.pending.set(requestId, { resolve, reject });
            this.queue.push({ type: 'extract', filePath, requestId });
            this._pump();
        });
    }

    _pump() {
        const worker = this.workers.find(w => !w._busy);
        if (!worker) return;
        const job = this.queue.shift();
        if (!job) return;
        worker._busy = true;
        worker.postMessage(job);
    }

    _handleMessage(worker, msg) {
        const { requestId } = msg || {};
        const pending = this.pending.get(requestId);
        if (pending) {
            if (msg.type === 'extracted') pending.resolve(msg.content || null);
            else pending.reject(new Error(msg.error || 'worker error'));
            this.pending.delete(requestId);
        }
        this._markIdle(worker);
    }

    _markIdle(worker) {
        worker._busy = false;
        this._pump();
    }

    async close() {
        await Promise.all(this.workers.map(w => w.terminate()));
    }
}
