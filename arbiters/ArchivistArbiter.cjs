/**
 * ArchivistArbiter - Autonomous storage optimization partner
 * 
 * This arbiter gets encoded with the 'archivist' genome and operates autonomously.
 * It monitors storage, compresses cold data, deduplicates, reconstructs corrupted data,
 * and "dreams" up optimized storage layouts.
 */

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class ArchivistArbiter extends BaseArbiter {
  constructor(broker, config = {}) {
    super(broker, {
      name: config.name || 'ArchivistArbiter',
      role: 'autonomous_archivist',
      capabilities: ['compress', 'decompress', 'deduplicate', 'reconstruct', 'optimize', 'dream', 'analyze_storage'],
      ...config
    });
    
    // Partner reference
    this.storagePartner = null; // Will be set by StorageArbiter
    
    // Tracking maps
    this.accessPatterns = new Map(); // url/id -> [timestamps]
    this.compressionRules = new Map(); // fileType -> compressionStrategy
    this.dataFragments = new Map(); // id -> fragments for reconstruction
    this.hashIndex = new Map(); // hash -> [ids] for deduplication
    
    // Metrics
    this.metrics = {
      compressed: 0,
      deduped: 0,
      reconstructed: 0,
      spaceSaved: 0,
      compressionRatio: 0,
      avgRetrievalMs: 0
    };
    
    // Dream state
    this.lastDreamTime = 0;
    this.dreamResults = [];
    
    // Storage paths
    this.storagePath = config.storagePath || path.join(process.cwd(), 'hippocampus');
    this.archivePath = path.join(this.storagePath, 'archive');
    this.fragmentPath = path.join(this.storagePath, 'fragments');
    this.trainingDataPath = path.join(process.cwd(), 'SOMA', 'training-data'); // Watch training data
  }
  
  async initialize() {
    await super.initialize();
    
    this.log('info', '📦 ArchivistArbiter initialized');
    
    await this.ensureDirectories();
    
    // Subscribe to messages
    this.subscribe('compression.needed', this.handleCompressionRequest.bind(this));
    this.subscribe('reconstruction.needed', this.handleReconstructionRequest.bind(this));
    this.subscribe('archivist.dream', this.dream.bind(this));
    this.subscribe('storage.analyze', this.handleAnalysisRequest.bind(this));

    // Schedule Training Data Cleanup (Every 6 hours)
    setInterval(() => this.scanAndCompressTrainingData(), 6 * 60 * 60 * 1000);
  }

  // ==================== STORAGE ANALYSIS & REPORTING ====================

  async handleAnalysisRequest(payload) {
    const targetPath = payload.path || this.storagePath;
    this.log('info', `📊 Storage analysis requested for: ${targetPath}`);
    const result = await this.generateStorageReport(targetPath);
    return result;
  }

  async analyzeStorage(targetPath) {
    const analysis = { 
        path: targetPath, 
        totalSize: 0, 
        totalFiles: 0, 
        totalFolders: 0, 
        fileTypes: {}, 
        largestFiles: [], 
        oldestFiles: [], 
        newestFiles: [] 
    };

    try {
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
                    
                    const fileInfo = { path: file.path, size: stats.size, modified: stats.mtimeMs };
                    
                    analysis.largestFiles.push(fileInfo);
                    analysis.oldestFiles.push(fileInfo);
                    analysis.newestFiles.push(fileInfo);
                } else if (stats.isDirectory()) {
                    analysis.totalFolders++;
                }
            } catch (error) {
                this.log('warn', `Failed to stat ${file.path}: ${error.message}`);
            }
        }
        
        // Sort and slice top 10s
        analysis.largestFiles.sort((a,b) => b.size - a.size).splice(10);
        analysis.oldestFiles.sort((a,b) => a.modified - b.modified).splice(10);
        analysis.newestFiles.sort((a,b) => b.modified - a.modified).splice(10);
        
        return { success: true, data: analysis };
    } catch (error) {
        return { success: false, error: error.message };
    }
  }

  async scanDirectory(dir, fileList = []) {
    try {
        const files = await fs.readdir(dir);
        for (const file of files) {
            const filepath = path.join(dir, file);
            const stat = await fs.stat(filepath);
            if (stat.isDirectory()) {
                await this.scanDirectory(filepath, fileList);
            } else {
                fileList.push({ path: filepath, size: stat.size });
            }
        }
    } catch (e) {
        // Ignore errors for unreadable dirs
    }
    return fileList;
  }

  async generateStorageReport(targetPath) {
    const analysis = await this.analyzeStorage(targetPath || this.storagePath);
    const duplicates = await this.findDuplicates(); // Uses existing duplicate finder
    
    const report = { 
        timestamp: new Date().toISOString(), 
        summary: analysis.data, 
        duplicates: duplicates,
        metrics: this.metrics
    };
    
    // Save report to disk
    const reportPath = path.join(this.storagePath, `storage-report-${Date.now()}.json`);
    try {
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        this.log('info', `📝 Generated storage report: ${reportPath}`);
    } catch (e) {
        this.log('error', `Failed to save storage report: ${e.message}`);
    }
    
    return { success: true, data: report, path: reportPath };
  }

  // ==================== TRAINING DATA MANAGEMENT ====================

  async scanAndCompressTrainingData() {
    this.log('info', '🧹 Scanning training data for compression...');
    try {
        const files = await fs.readdir(this.trainingDataPath);
        const threshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours old

        for (const file of files) {
            if (file.endsWith('.jsonl')) {
                const filePath = path.join(this.trainingDataPath, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtimeMs < threshold) {
                    await this.compressTrainingFile(file, filePath);
                }
            }
        }
    } catch (error) {
        // Directory might not exist yet, which is fine
        if (error.code !== 'ENOENT') {
            this.log('warn', `Training data scan failed: ${error.message}`);
        }
    }
  }

  async compressTrainingFile(filename, filepath) {
      try {
          const data = await fs.readFile(filepath);
          const compressed = await gzip(data);
          const archivePath = path.join(this.archivePath, `training_${filename}.gz`);
          
          await fs.writeFile(archivePath, compressed);
          await fs.unlink(filepath); // Remove original
          
          this.log('info', `🗜️ Compressed training data: ${filename} -> archive`);
          this.metrics.compressed++;
      } catch (error) {
          this.log('error', `Failed to compress ${filename}: ${error.message}`);
      }
  }
  
  async ensureDirectories() {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      await fs.mkdir(this.archivePath, { recursive: true });
      await fs.mkdir(this.fragmentPath, { recursive: true });
    } catch (error) {
      this.log('error', `Directory creation error: ${error.message}`);
    }
  }
  
  // ==================== PARTNER LINKING ====================
  
  async linkToStorage(storageArbiter) {
    this.storagePartner = storageArbiter;
    this.log('info', `🔗 Linked to ${storageArbiter.name}`);
    
    return { success: true };
  }
  
  // ==================== MESSAGE HANDLING ====================
  
  async handleCompressionRequest(payload) {
    this.log('info', `🗜️ Compression request received (urgency: ${payload.urgency})`);
    
    // Find cold data
    const coldData = await this.findColdData(payload.ageThresholdDays || 30);
    
    // Compress them
    await this.autonomousCompression(coldData);
    
    return { success: true, compressed: coldData.length };
  }
  
  async handleReconstructionRequest(payload) {
    this.log('info', `🔧 Reconstruction request received (urgency: ${payload.urgency})`);
    
    // Detect corrupted files
    const corrupted = await this.detectCorruption();
    
    // Reconstruct them
    await this.autonomousReconstruction(corrupted);
    
    return { success: true, reconstructed: corrupted.length };
  }
  
  // ==================== AUTONOMOUS BEHAVIORS ====================
  
  async findColdData(ageThresholdDays = 30) {
    const threshold = Date.now() - (ageThresholdDays * 24 * 60 * 60 * 1000);
    const coldData = [];
    
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const file of files) {
        if (file.startsWith('.') || file === 'archive' || file === 'fragments') continue;
        
        const filepath = path.join(this.storagePath, file);
        const stats = await fs.stat(filepath);
        
        // Check if accessed recently
        const lastAccess = this.accessPatterns.get(file) || [stats.atimeMs];
        const mostRecentAccess = Math.max(...lastAccess);
        
        if (mostRecentAccess < threshold && !file.endsWith('.gz')) {
          coldData.push({
            id: file,
            path: filepath,
            size: stats.size,
            lastAccess: mostRecentAccess,
            compressed: false
          });
        }
      }
    } catch (error) {
      this.log('error', `Error finding cold data: ${error.message}`);
    }
    
    return coldData;
  }
  
  async autonomousCompression(coldData) {
    for (const item of coldData) {
      try {
        await this.compressData(item);
      } catch (error) {
        this.log('error', `Compression failed for ${item.id}: ${error.message}`);
      }
    }
  }
  
  async compressData(item) {
    try {
      this.log('info', `🗜️ Compressing ${item.id}...`);
      
      // Read file
      const data = await fs.readFile(item.path);
      
      // Compress
      const compressed = await gzip(data);
      
      // Create fragments for reconstruction (erasure coding simulation)
      const fragments = this.createFragments(data, 3); // 3 fragments
      await this.storeFragments(item.id, fragments);
      
      // Write compressed to archive
      const archivePath = path.join(this.archivePath, `${item.id}.gz`);
      await fs.writeFile(archivePath, compressed);
      
      // Delete original
      await fs.unlink(item.path);
      
      // Update metrics
      const savedSpace = item.size - compressed.length;
      this.metrics.compressed++;
      this.metrics.spaceSaved += savedSpace;
      this.metrics.compressionRatio = compressed.length / item.size;
      
      this.log('info', `✅ Compressed ${item.id}: ${this.formatBytes(item.size)} → ${this.formatBytes(compressed.length)} (${((1 - compressed.length/item.size) * 100).toFixed(1)}% saved)`);
      
      return { success: true, savedSpace };
    } catch (error) {
      this.log('error', `Compression error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  createFragments(data, count = 3) {
    // LIMITATION: This uses simple data splitting, NOT true erasure coding (Reed-Solomon)
    // Current implementation:
    // - Simply divides data into N equal chunks
    // - Each fragment is concatenated sequentially during reconstruction
    // - Requires ALL fragments to be present for reconstruction (no redundancy)
    //
    // TODO: For true fault tolerance, replace with a real erasure coding library:
    // - npm install reedsolomon
    // - This would allow reconstruction with k of n fragments (k < n)
    // - Useful for distributed storage resilience
    // 
    // For now, this provides basic compression + storage distribution
    // but does NOT provide data redundancy or fault tolerance.
    
    const chunkSize = Math.ceil(data.length / count);
    const fragments = [];
    
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const fragment = data.slice(start, end);
      
      fragments.push({
        index: i,
        data: fragment,
        hash: crypto.createHash('sha256').update(fragment).digest('hex')
      });
    }
    
    return fragments;
  }
  
  async storeFragments(id, fragments) {
    this.dataFragments.set(id, fragments);
    
    // Also persist to disk
    try {
      const fragmentDir = path.join(this.fragmentPath, id);
      await fs.mkdir(fragmentDir, { recursive: true });
      
      for (const frag of fragments) {
        const fragPath = path.join(fragmentDir, `fragment_${frag.index}.dat`);
        await fs.writeFile(fragPath, frag.data);
      }
    } catch (error) {
      this.log('error', `Fragment storage error: ${error.message}`);
    }
  }
  
  async findDuplicates() {
    const duplicates = [];
    
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const file of files) {
        if (file.startsWith('.') || file === 'archive' || file === 'fragments') continue;
        
        const filepath = path.join(this.storagePath, file);
        const data = await fs.readFile(filepath);
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        
        if (this.hashIndex.has(hash)) {
          const original = this.hashIndex.get(hash)[0];
          duplicates.push({
            duplicate: file,
            original: original,
            hash: hash
          });
        } else {
          this.hashIndex.set(hash, [file]);
        }
      }
    } catch (error) {
      this.log('error', `Duplicate detection error: ${error.message}`);
    }
    
    return duplicates;
  }
  
  async deduplicate(dup) {
    try {
      this.log('info', `🗑️ Deduplicating ${dup.duplicate} → ${dup.original}`);
      
      const dupPath = path.join(this.storagePath, dup.duplicate);
      const stats = await fs.stat(dupPath);
      
      // Create symlink (or metadata pointer)
      const symlinkPath = path.join(this.storagePath, `${dup.duplicate}.link`);
      await fs.writeFile(symlinkPath, JSON.stringify({
        type: 'symlink',
        target: dup.original,
        originalSize: stats.size
      }));
      
      // Delete duplicate
      await fs.unlink(dupPath);
      
      // Update metrics
      this.metrics.deduped++;
      this.metrics.spaceSaved += stats.size;
      
      this.log('info', `✅ Deduped ${dup.duplicate} (saved ${this.formatBytes(stats.size)})`);
      
      return { success: true, savedSpace: stats.size };
    } catch (error) {
      this.log('error', `Deduplication error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async detectCorruption() {
    const corrupted = [];
    
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const file of files) {
        if (file.startsWith('.') || file === 'archive' || file === 'fragments') continue;
        
        const filepath = path.join(this.storagePath, file);
        
        try {
          // Try to read and parse JSON (assumes JSON storage)
          const data = await fs.readFile(filepath, 'utf8');
          JSON.parse(data);
        } catch (error) {
          corrupted.push({
            id: file,
            path: filepath,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.log('error', `Corruption detection error: ${error.message}`);
    }
    
    return corrupted;
  }
  
  async autonomousReconstruction(corrupted) {
    for (const item of corrupted) {
      try {
        this.log('info', `🔧 Reconstructing ${item.id}...`);
        
        // Get fragments
        const fragments = this.dataFragments.get(item.id);
        
        if (!fragments) {
          this.log('warn', `⚠️ No fragments for ${item.id} - checking disk...`);
          
          // Try to load from disk
          const fragmentDir = path.join(this.fragmentPath, item.id);
          const fragFiles = await fs.readdir(fragmentDir).catch(() => []);
          
          if (fragFiles.length > 0) {
            const loadedFragments = [];
            for (const fragFile of fragFiles) {
              const fragData = await fs.readFile(path.join(fragmentDir, fragFile));
              const index = parseInt(fragFile.match(/\d+/)[0]);
              loadedFragments.push({ index, data: fragData });
            }
            
            const reconstructed = await this.reconstructFromFragments(loadedFragments);
            await fs.writeFile(item.path, reconstructed);
            
            this.metrics.reconstructed++;
            this.log('info', `✅ Reconstructed ${item.id} from disk fragments`);
          } else {
            this.log('error', `❌ Cannot reconstruct ${item.id} - no fragments available`);
          }
          continue;
        }
        
        // Reconstruct from memory fragments
        const reconstructed = await this.reconstructFromFragments(fragments);
        await fs.writeFile(item.path, reconstructed);
        
        this.metrics.reconstructed++;
        this.log('info', `✅ Reconstructed ${item.id}`);
        
      } catch (error) {
        this.log('error', `Reconstruction error for ${item.id}: ${error.message}`);
      }
    }
  }
  
  async reconstructFromFragments(fragments) {
    // Sort by index
    fragments.sort((a, b) => a.index - b.index);
    
    // Concatenate
    const buffers = fragments.map(f => f.data);
    return Buffer.concat(buffers);
  }
  
  // ==================== DREAM OPTIMIZATION ====================
  
  async dream() {
    this.log('info', '💭 Entering dream state...');
    
    // Simulate different storage layouts and access patterns
    const currentLayout = await this.getCurrentLayout();
    
    // Generate alternative layouts
    const alternatives = [
      this.generateLayoutByFrequency(currentLayout),
      this.generateLayoutBySize(currentLayout),
      this.generateLayoutByType(currentLayout),
      this.generateLayoutByDate(currentLayout)
    ];
    
    // Simulate access patterns
    const simulations = [];
    for (const layout of alternatives) {
      const result = await this.simulateAccessPatterns(layout);
      simulations.push(result);
    }
    
    // Find best
    const best = simulations.reduce((prev, curr) => 
      curr.avgAccessTime < prev.avgAccessTime ? curr : prev
    );
    
    // Calculate improvement
    const currentAvg = simulations[0].avgAccessTime; // Assume first is current
    const improvement = (currentAvg - best.avgAccessTime) / currentAvg;
    
    const dreamResult = {
      improvement,
      currentAvgMs: currentAvg,
      proposedAvgMs: best.avgAccessTime,
      layout: best.layout,
      timestamp: Date.now()
    };
    
    this.dreamResults.push(dreamResult);
    
    this.log('info', `✨ Dream complete: ${(improvement * 100).toFixed(1)}% improvement potential`);
    
    return dreamResult;
  }
  
  async getCurrentLayout() {
    const layout = [];
    
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const file of files) {
        if (file.startsWith('.') || file === 'archive' || file === 'fragments') continue;
        
        const filepath = path.join(this.storagePath, file);
        const stats = await fs.stat(filepath);
        
        const accesses = this.accessPatterns.get(file) || [stats.atimeMs];
        
        layout.push({
          id: file,
          size: stats.size,
          accessFrequency: accesses.length,
          lastAccess: Math.max(...accesses),
          type: path.extname(file)
        });
      }
    } catch (error) {
      this.log('error', `Layout error: ${error.message}`);
    }
    
    return layout;
  }
  
  generateLayoutByFrequency(layout) {
    // Most frequently accessed first
    return {
      name: 'frequency-optimized',
      files: [...layout].sort((a, b) => b.accessFrequency - a.accessFrequency)
    };
  }
  
  generateLayoutBySize(layout) {
    // Smallest first (faster to read)
    return {
      name: 'size-optimized',
      files: [...layout].sort((a, b) => a.size - b.size)
    };
  }
  
  generateLayoutByType(layout) {
    // Group by file type
    return {
      name: 'type-optimized',
      files: [...layout].sort((a, b) => a.type.localeCompare(b.type))
    };
  }
  
  generateLayoutByDate(layout) {
    // Most recent first
    return {
      name: 'date-optimized',
      files: [...layout].sort((a, b) => b.lastAccess - a.lastAccess)
    };
  }
  
  async simulateAccessPatterns(layout) {
    // Simulate 1000 random accesses based on real patterns
    let totalTime = 0;
    const accessCount = 1000;
    
    for (let i = 0; i < accessCount; i++) {
      // Pick a random file weighted by frequency
      const file = this.weightedRandomFile(layout.files);
      
      // Simulate access time (position in layout affects time)
      const position = layout.files.findIndex(f => f.id === file.id);
      const accessTime = 10 + (position * 0.5); // Base 10ms + 0.5ms per position
      
      totalTime += accessTime;
    }
    
    return {
      layout: layout.name,
      avgAccessTime: totalTime / accessCount,
      simulatedAccesses: accessCount
    };
  }
  
  weightedRandomFile(files) {
    const totalFrequency = files.reduce((sum, f) => sum + f.accessFrequency, 0);
    let random = Math.random() * totalFrequency;
    
    for (const file of files) {
      random -= file.accessFrequency;
      if (random <= 0) return file;
    }
    
    return files[files.length - 1]; // Fallback
  }
  
  // ==================== UTILITIES ====================
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
  
  trackAccess(id) {
    if (!this.accessPatterns.has(id)) {
      this.accessPatterns.set(id, []);
    }
    this.accessPatterns.get(id).push(Date.now());
    
    // Keep only last 100 accesses
    const accesses = this.accessPatterns.get(id);
    if (accesses.length > 100) {
      accesses.shift();
    }
  }
  
  // ==================== STATUS ====================
  
  getStatus() {
    return {
      ...super.getStatus(),
      metrics: this.metrics,
      activeFragments: this.dataFragments.size,
      hashIndexSize: this.hashIndex.size,
      dreamCount: this.dreamResults.length,
      lastDream: this.lastDreamTime,
      storagePartner: this.storagePartner?.name || 'none'
    };
  }
  
  async shutdown() {
    this.log('info', '📦 Shutting down ArchivistArbiter...');
    
    // Could save state here (accessPatterns, hashIndex, etc.)
    
    this.log('info', '✅ Shutdown complete');
  }
}

module.exports = ArchivistArbiter;






