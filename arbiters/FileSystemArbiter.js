import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
import { diffLines } from 'diff'; // Assuming a diff library or manual implementation

/**
 * FileSystemArbiter (Enhanced)
 * 
 * Replaces simple file overwrites with "Smart Diff" editing.
 * Inspired by claude-engineer's 'diffeditortool'.
 * 
 * Capabilities:
 * - Read/Write files
 * - Apply Diff (Patch)
 * - Create Directory Tree
 * - Search Files (Grep)
 */
export class FileSystemArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'FileSystemArbiter',
      role: ArbiterRole.IMPLEMENTER,
      capabilities: [
        ArbiterCapability.READ_FILES,
        ArbiterCapability.WRITE_FILES,
        ArbiterCapability.EXECUTE_CODE // For grep/find commands if needed
      ]
    });
  }

  async onInitialize() {
    this.auditLogger.info('FileSystem Arbiter (Smart Edit) initialized');
  }

  /**
   * Smart Edit: Replace a specific block of text without overwriting the whole file.
   * Useful for large files to avoid token limits and race conditions.
   */
  async applySmartEdit(filepath, searchBlock, replaceBlock) {
    this.auditLogger.info(`📝 [FileSystem] Applying smart edit to ${filepath}`);
    
    try {
        const fullPath = path.resolve(process.cwd(), filepath);
        const content = await fs.readFile(fullPath, 'utf8');
        
        // Normalize line endings for reliable matching
        const normalizedContent = content.replace(/\r\n/g, '\n');
        const normalizedSearch = searchBlock.replace(/\r\n/g, '\n');
        
        if (!normalizedContent.includes(normalizedSearch)) {
            // Fuzzy match fallback could go here
            throw new Error("Search block not found in file. Ensure exact match.");
        }
        
        const newContent = normalizedContent.replace(normalizedSearch, replaceBlock);
        await fs.writeFile(fullPath, newContent, 'utf8');
        
        this.auditLogger.info(`✅ [FileSystem] Smart edit successful`);
        return { success: true };
    } catch (e) {
        this.auditLogger.error(`[FileSystem] Edit failed: ${e.message}`);
        return { success: false, error: e.message };
    }
  }

  /**
   * Safe Write: Writes file but creates backup first.
   */
  async safeWrite(filepath, content) {
    const fullPath = path.resolve(process.cwd(), filepath);
    
    // Backup
    try {
        await fs.copyFile(fullPath, `${fullPath}.bak`);
    } catch (e) {
        // File might not exist, ignore
    }

    await fs.writeFile(fullPath, content, 'utf8');
    return { success: true, path: fullPath };
  }
}

export default FileSystemArbiter;
