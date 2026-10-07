#!/usr/bin/env node
// memory-hub.cjs - WebSocket hub for UnifiedMemory coordination
const WebSocket = require('ws');
const http = require('http');

const PORT = 3001;
const agents = new Map(); // nodeId -> ws connection
const memoryMap = new Map(); // chunkId -> {nodeId, compressed, metadata}

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      agents: agents.size,
      chunks: memoryMap.size,
      nodes: Array.from(agents.keys())
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  let nodeId = null;
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'register':
          nodeId = msg.nodeId;
          agents.set(nodeId, ws);
          console.log(`✅ Agent registered: ${nodeId} (${agents.size} total)`);
          ws.send(JSON.stringify({ type: 'registered', nodeId }));
          break;
          
        case 'allocate':
          // Store chunk location
          memoryMap.set(msg.chunkId, {
            nodeId: msg.nodeId,
            size: msg.size,
            compressed: msg.compressed || false
          });
          broadcast({ type: 'allocated', ...msg });
          break;
          
        case 'read':
          // Find which node has the chunk
          const location = memoryMap.get(msg.chunkId);
          if (location) {
            const targetWs = agents.get(location.nodeId);
            if (targetWs) {
              targetWs.send(JSON.stringify({
                type: 'read_request',
                chunkId: msg.chunkId,
                requesterId: msg.nodeId
              }));
            }
          }
          break;
          
        case 'write':
          // Update chunk metadata
          if (memoryMap.has(msg.chunkId)) {
            memoryMap.get(msg.chunkId).size = msg.size;
          }
          broadcast({ type: 'written', ...msg });
          break;
          
        case 'free':
          memoryMap.delete(msg.chunkId);
          broadcast({ type: 'freed', chunkId: msg.chunkId });
          break;
          
        case 'status':
          ws.send(JSON.stringify({
            type: 'status',
            agents: agents.size,
            chunks: memoryMap.size,
            memory: Array.from(memoryMap.entries())
          }));
          break;
      }
    } catch (err) {
      console.error('Message error:', err);
    }
  });
  
  ws.on('close', () => {
    if (nodeId) {
      agents.delete(nodeId);
      console.log(`❌ Agent disconnected: ${nodeId} (${agents.size} remaining)`);
      
      // Clean up chunks from this node
      for (const [chunkId, info] of memoryMap.entries()) {
        if (info.nodeId === nodeId) {
          memoryMap.delete(chunkId);
        }
      }
    }
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of agents.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

server.listen(PORT, () => {
  console.log(`🧠 Memory Hub running on ws://localhost:${PORT}`);
  console.log(`📊 Status: http://localhost:${PORT}/status`);
});
