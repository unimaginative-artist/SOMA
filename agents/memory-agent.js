import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export default class MemoryAgent extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.hubUrl = opts.hubUrl;
    this.nodeId = opts.nodeId || 'local-node';
    this.role = opts.role || 'worker';
    this.chunkPath = opts.chunkPath || path.join(process.cwd(), 'memory-chunks');
    this.compressionHandler = opts.compressionHandler;

    // Local stores
    this.ramAllocated = new Map(); // chunkId -> Buffer
    this.swapAllocated = new Map(); // chunkId -> Buffer (pretend disk)

    // Pretend connected
    this._ws = { readyState: 1 };
  }

  startTelemetryLoop() {
    // No-op for now
  }

  async allocateLocalChunk(chunkId, size) {
    this.ramAllocated.set(chunkId, Buffer.alloc(size));
    this.emit('chunk_stored', { chunkId, size, compressed: false, nodeId: this.nodeId });
  }

  async allocateRemoteChunk(target, chunkId, size) {
    // target should be host:port
    const url = `http://${target}/memory/chunk/alloc`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkId, size })
    });
    if (!res.ok) {
      throw new Error(`alloc_failed:${res.status}`);
    }
  }

  async writeLocalChunk(chunkId, buffer) {
    this.ramAllocated.set(chunkId, Buffer.from(buffer));
    this.emit('chunk_stored', { chunkId, size: buffer.length, compressed: false, nodeId: this.nodeId });
    return { success: true };
  }

  async transferChunkToNode(target, chunkId, data, compressed) {
    const url = `http://${target}/memory/chunk/write`;
    const dataBase64 = Buffer.from(data).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkId, dataBase64 })
    });
    if (!res.ok) {
      throw new Error(`write_failed:${res.status}`);
    }
    return { success: true };
  }

  async readLocalChunk(chunkId) {
    const buf = this.ramAllocated.get(chunkId) || this.swapAllocated.get(chunkId);
    if (!buf) throw new Error(`Chunk not found: ${chunkId}`);
    return Buffer.from(buf);
  }

  async fetchRemoteChunk(target, chunkId) {
    const url = `http://${target}/memory/chunk/read?chunkId=${encodeURIComponent(chunkId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch remote chunk failed: ${res.status}`);
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'remote_error');
    return Buffer.from(j.dataBase64, 'base64');
  }

  close() {}
}
