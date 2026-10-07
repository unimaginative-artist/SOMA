'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteJson(filePath, value, options = {}) {
  ensureDir(filePath);
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const tempPath = `${filePath}.${suffix}.tmp`;
  const backupPath = `${filePath}.bak`;
  const payload = `${JSON.stringify(value, null, options.pretty === false ? 0 : 2)}\n`;
  let handle;

  try {
    handle = fs.openSync(tempPath, 'wx');
    fs.writeFileSync(handle, payload, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;

    if (options.backup !== false && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
    fs.renameSync(tempPath, filePath);
    return { path: filePath, backupPath: options.backup === false ? null : backupPath, bytes: Buffer.byteLength(payload) };
  } catch (error) {
    if (handle !== null && handle !== undefined) {
      try { fs.closeSync(handle); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function readJsonWithRecovery(filePath, fallback = null) {
  const candidates = [filePath, `${filePath}.bak`];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      return { value: JSON.parse(fs.readFileSync(candidate, 'utf8')), source: candidate, recovered: candidate !== filePath };
    } catch (error) {
      lastError = error;
    }
  }
  if (fallback !== null) return { value: fallback, source: null, recovered: false, error: lastError };
  throw lastError || new Error(`JSON store not found: ${filePath}`);
}

module.exports = { atomicWriteJson, readJsonWithRecovery };
