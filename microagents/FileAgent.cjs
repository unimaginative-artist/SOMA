// FileAgent.cjs
// Specialized MicroAgent for file system operations

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const fs = require('fs').promises;
const path = require('path');

class FileAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'file' });
    
    this.basePath = config.basePath || process.cwd();
    this.allowedExtensions = config.allowedExtensions || null; // null = all
  }
  
  /**
   * Execute file operation
   * Task format:
   * {
   *   operation: 'read' | 'write' | 'list' | 'search' | 'stat' | 'delete',
   *   path: 'file/path',
   *   data: 'content' (for write),
   *   pattern: 'regex' (for search),
   *   recursive: true/false (for list)
   * }
   */
  async execute(task) {
    const { operation, path: filePath, data, pattern, recursive = false, encoding = 'utf-8' } = task;
    
    if (!operation) {
      throw new Error('Task must include operation');
    }
    
    this.logger.info(`[FileAgent:${this.id}] ${operation} operation on ${filePath || 'directory'}`);
    
    switch (operation) {
      case 'read':
        return await this._read(filePath, encoding);
      
      case 'write':
        return await this._write(filePath, data, encoding);
      
      case 'append':
        return await this._append(filePath, data, encoding);
      
      case 'list':
        return await this._list(filePath || '.', recursive);
      
      case 'search':
        return await this._search(filePath || '.', pattern, recursive);
      
      case 'stat':
        return await this._stat(filePath);
      
      case 'delete':
        return await this._delete(filePath);
      
      case 'exists':
        return await this._exists(filePath);
      
      case 'mkdir':
        return await this._mkdir(filePath);
      
      case 'copy':
        return await this._copy(filePath, task.destination);
      
      case 'move':
        return await this._move(filePath, task.destination);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  _resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.basePath, filePath);
  }
  
  _checkExtension(filePath) {
    if (!this.allowedExtensions) return true;
    const ext = path.extname(filePath).toLowerCase();
    return this.allowedExtensions.includes(ext);
  }
  
  async _read(filePath, encoding) {
    if (!filePath) {
      throw new Error('Read operation requires path');
    }
    
    const fullPath = this._resolvePath(filePath);
    
    if (!this._checkExtension(fullPath)) {
      throw new Error(`File extension not allowed: ${path.extname(fullPath)}`);
    }
    
    const content = await fs.readFile(fullPath, encoding);
    const stats = await fs.stat(fullPath);
    
    return {
      path: fullPath,
      content,
      size: stats.size,
      modified: stats.mtime,
      encoding
    };
  }
  
  async _write(filePath, data, encoding) {
    if (!filePath) {
      throw new Error('Write operation requires path');
    }
    
    if (data === undefined || data === null) {
      throw new Error('Write operation requires data');
    }
    
    const fullPath = this._resolvePath(filePath);
    
    if (!this._checkExtension(fullPath)) {
      throw new Error(`File extension not allowed: ${path.extname(fullPath)}`);
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(fullPath, data, encoding);
    const stats = await fs.stat(fullPath);
    
    return {
      path: fullPath,
      size: stats.size,
      written: true
    };
  }
  
  async _append(filePath, data, encoding) {
    if (!filePath) {
      throw new Error('Append operation requires path');
    }
    
    if (data === undefined || data === null) {
      throw new Error('Append operation requires data');
    }
    
    const fullPath = this._resolvePath(filePath);
    
    await fs.appendFile(fullPath, data, encoding);
    const stats = await fs.stat(fullPath);
    
    return {
      path: fullPath,
      size: stats.size,
      appended: true
    };
  }
  
  async _list(dirPath, recursive) {
    const fullPath = this._resolvePath(dirPath);
    const files = [];
    
    async function scan(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (recursive) {
            await scan(entryPath);
          }
        } else {
          const stats = await fs.stat(entryPath);
          files.push({
            path: entryPath,
            name: entry.name,
            size: stats.size,
            modified: stats.mtime,
            ext: path.extname(entry.name)
          });
        }
      }
    }
    
    await scan(fullPath);
    
    return {
      directory: fullPath,
      count: files.length,
      files
    };
  }
  
  async _search(dirPath, pattern, recursive) {
    if (!pattern) {
      throw new Error('Search operation requires pattern');
    }
    
    const fullPath = this._resolvePath(dirPath);
    const regex = new RegExp(pattern, 'i');
    const matches = [];
    
    async function scan(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (recursive) {
            await scan(entryPath);
          }
        } else {
          if (regex.test(entry.name)) {
            const stats = await fs.stat(entryPath);
            matches.push({
              path: entryPath,
              name: entry.name,
              size: stats.size,
              modified: stats.mtime
            });
          }
        }
      }
    }
    
    await scan(fullPath);
    
    return {
      directory: fullPath,
      pattern,
      count: matches.length,
      matches
    };
  }
  
  async _stat(filePath) {
    if (!filePath) {
      throw new Error('Stat operation requires path');
    }
    
    const fullPath = this._resolvePath(filePath);
    const stats = await fs.stat(fullPath);
    
    return {
      path: fullPath,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      permissions: stats.mode
    };
  }
  
  async _delete(filePath) {
    if (!filePath) {
      throw new Error('Delete operation requires path');
    }
    
    const fullPath = this._resolvePath(filePath);
    const stats = await fs.stat(fullPath);
    
    if (stats.isDirectory()) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.unlink(fullPath);
    }
    
    return {
      path: fullPath,
      deleted: true
    };
  }
  
  async _exists(filePath) {
    if (!filePath) {
      throw new Error('Exists operation requires path');
    }
    
    const fullPath = this._resolvePath(filePath);
    
    try {
      await fs.access(fullPath);
      return { path: fullPath, exists: true };
    } catch {
      return { path: fullPath, exists: false };
    }
  }
  
  async _mkdir(dirPath) {
    if (!dirPath) {
      throw new Error('Mkdir operation requires path');
    }
    
    const fullPath = this._resolvePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });
    
    return {
      path: fullPath,
      created: true
    };
  }
  
  async _copy(sourcePath, destPath) {
    if (!sourcePath || !destPath) {
      throw new Error('Copy operation requires source and destination paths');
    }
    
    const fullSource = this._resolvePath(sourcePath);
    const fullDest = this._resolvePath(destPath);
    
    await fs.copyFile(fullSource, fullDest);
    
    return {
      source: fullSource,
      destination: fullDest,
      copied: true
    };
  }
  
  async _move(sourcePath, destPath) {
    if (!sourcePath || !destPath) {
      throw new Error('Move operation requires source and destination paths');
    }
    
    const fullSource = this._resolvePath(sourcePath);
    const fullDest = this._resolvePath(destPath);
    
    await fs.rename(fullSource, fullDest);
    
    return {
      source: fullSource,
      destination: fullDest,
      moved: true
    };
  }
}

module.exports = { FileAgent };
