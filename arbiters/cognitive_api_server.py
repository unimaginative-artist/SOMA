#!/usr/bin/env python3
"""
Cognitive API Server - FastAPI wrapper for cognitive_loop_engine
Exposes HTTP endpoints for SOMA agents to use cognitive reasoning
Port: 5000 (configurable)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uvicorn
import asyncio
from datetime import datetime
import sys
import os

# Import cognitive engine
sys.path.insert(0, os.path.dirname(__file__))
from cognitive_loop_engine import (
    CognitiveLoopManager,
    InMemorySharedMemoryClient,
    InMemoryBroker,
    deterministic_embed,
    ThoughtState
)

# ============================================================
# FastAPI App Setup
# ============================================================

app = FastAPI(
    title="SOMA Cognitive API",
    description="Cognitive Loop Engine for SOMA agents",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Global Cognitive Manager Instance
# ============================================================

broker = InMemoryBroker()
shared_memory = InMemorySharedMemoryClient()
cognitive_manager = CognitiveLoopManager(
    shared_memory_client=shared_memory,
    broker=broker,
    embedding_fn=deterministic_embed,
    max_workers=4
)

# Storage for recent thought states
recent_thoughts: List[Dict[str, Any]] = []
MAX_RECENT_THOUGHTS = 50

# ============================================================
# Request/Response Models
# ============================================================

class ThinkRequest(BaseModel):
    actor: str
    text: str
    context: Optional[Dict[str, Any]] = None
    timeout: Optional[float] = 8.0

class ThinkResponse(BaseModel):
    thought_id: str
    actor: str
    input_text: str
    rounds: List[Dict[str, Any]]
    final_output: Optional[Dict[str, Any]]
    confidence: float
    created: str

class MemoryAddRequest(BaseModel):
    text: str
    meta: Optional[Dict[str, Any]] = None
    actor: Optional[str] = "system"

class MemorySearchRequest(BaseModel):
    text: str
    topk: Optional[int] = 8

# ============================================================
# Broker Event Listeners (for real-time updates)
# ============================================================

def on_perception_result(msg):
    """Capture perception results for history"""
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "result",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

def on_low_confidence(msg):
    """Capture low confidence events"""
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "low_confidence",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

def on_conflict(msg):
    """Capture conflict events"""
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "conflict",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

broker.subscribe("perception.result", on_perception_result)
broker.subscribe("perception.low_confidence", on_low_confidence)
broker.subscribe("perception.conflict", on_conflict)

# ============================================================
# API Endpoints
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Start cognitive manager on server startup"""
    print("[Cognitive API] Starting cognitive manager...")
    cognitive_manager.start()

    # Seed some initial memories
    shared_memory.add(
        "SOMA uses federated learning across distributed agents.",
        embedding=deterministic_embed("federated learning")
    )
    shared_memory.add(
        "MnemonicArbiter manages hot/warm/cold memory tiers with Redis and SQLite.",
        embedding=deterministic_embed("memory tiers")
    )
    shared_memory.add(
        "GenomeArbiter uses genetic programming for code evolution.",
        embedding=deterministic_embed("genetic programming")
    )
    print("[Cognitive API] OK Cognitive manager started with seeded memories")

@app.on_event("shutdown")
async def shutdown_event():
    """Stop cognitive manager on server shutdown"""
    print("[Cognitive API] Stopping cognitive manager...")
    cognitive_manager.stop()
    print("[Cognitive API] OK Cognitive manager stopped")

@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "operational",
        "service": "SOMA Cognitive API",
        "version": "1.0.0",
        "uptime": "N/A"
    }

@app.post("/api/cognitive/think", response_model=ThinkResponse)
async def think(request: ThinkRequest):
    """
    Submit a query for cognitive reasoning.
    Returns thought state with multi-round reasoning trace.
    """
    try:
        # Submit to cognitive manager (async wrapper)
        loop = asyncio.get_event_loop()

        # Run synchronous think() in thread pool
        state: ThoughtState = await loop.run_in_executor(
            None,
            lambda: cognitive_manager.reasoner.think(
                request.actor,
                request.text,
                context=request.context,
                timeout=request.timeout
            )
        )

        return ThinkResponse(
            thought_id=state.id,
            actor=state.actor,
            input_text=state.input_text,
            rounds=state.rounds,
            final_output=state.final_output,
            confidence=state.confidence,
            created=state.created
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cognitive/submit")
async def submit(request: ThinkRequest):
    """
    Submit query asynchronously (returns immediately, processes in background).
    Query perception.result channel for results.
    """
    try:
        cognitive_manager.submit(
            request.actor,
            request.text,
            context=request.context
        )
        return {
            "success": True,
            "message": "Query submitted for processing",
            "actor": request.actor
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cognitive/thoughts")
async def get_recent_thoughts():
    """Get recent thought events"""
    return {
        "thoughts": recent_thoughts,
        "count": len(recent_thoughts)
    }

@app.post("/api/memory/add")
async def add_memory(request: MemoryAddRequest):
    """Add memory to shared memory store"""
    try:
        embedding = deterministic_embed(request.text)
        chunk = shared_memory.add(
            request.text,
            embedding=embedding,
            meta=request.meta,
            actor=request.actor
        )
        return {
            "success": True,
            "chunk_id": chunk["id"],
            "chunk": chunk
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memory/search")
async def search_memory(request: MemorySearchRequest):
    """Search shared memory"""
    try:
        embedding = deterministic_embed(request.text)
        results = shared_memory.search(
            qtext=request.text,
            qembedding=embedding,
            topk=request.topk
        )
        return {
            "results": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memory/status")
async def memory_status():
    """Get memory store statistics"""
    with shared_memory.lock:
        count = len(shared_memory.store)
        chunks = list(shared_memory.store.values())

    return {
        "total_chunks": count,
        "recent_chunks": chunks[:10] if chunks else []
    }

@app.get("/api/cognitive/causal-graph")
async def get_causal_graph():
    """Get causal graph nodes and edges"""
    causal = cognitive_manager.reasoner.causal
    with causal.lock:
        nodes = list(causal.nodes.values())
        edges = [
            {"from": a, "to": b, "weight": w}
            for (a, b), w in causal.edges.items()
        ]

    return {
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges)
    }

# ============================================================
# Run Server
# ============================================================

if __name__ == "__main__":
    print("=" * 60)
    print("SOMA Cognitive API Server")
    print("=" * 60)
    print("Starting on http://localhost:5000")
    print("Docs: http://localhost:5000/docs")
    print("=" * 60)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000,
        log_level="info"
    )
