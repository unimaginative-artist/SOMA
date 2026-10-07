#!/usr/bin/env python3
"""
SOMA Cognitive API Server - ULTIMATE EDITION
Phoenix Ferrari Edition - Maximum Power Cognitive Engine

Combines:
- FastAPI with proper REST endpoints
- Worker pool for concurrent thinking
- Pub/sub event system
- Real-time WebSocket streaming
- Metrics & observability
- LLM integration hooks
- Production-ready architecture

Port: 5000 (replaces basic version)
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uvicorn
import asyncio
from datetime import datetime
import sys
import os
import time
import threading
import json
import math
import uuid
import traceback
from dataclasses import dataclass, field
from copy import deepcopy
from functools import wraps

# ============================================================
# Configuration
# ============================================================
DEFAULT_EMBED_DIM = 128
DEFAULT_MAX_ROUNDS = 4
DEFAULT_SEARCH_TOPK = 6
DEFAULT_CONFIDENCE_THRESHOLD = 0.75
DEFAULT_TIMEOUT_SEC = 8.0
MAX_WORKERS = 4

# ============================================================
# Utilities
# ============================================================
def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def uid(prefix="id"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"

def safe_repr(x, n=400):
    try:
        s = json.dumps(x, default=str)
    except Exception:
        s = str(x)
    return s[:n] + ("..." if len(s) > n else "")

def time_limited(timeout):
    """Decorator for time-limited execution"""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            result = [None]
            exc = [None]
            def target():
                try:
                    result[0] = fn(*args, **kwargs)
                except Exception as e:
                    exc[0] = e
            t = threading.Thread(target=target, daemon=True)
            t.start()
            t.join(timeout)
            if t.is_alive():
                raise TimeoutError(f"Function {fn.__name__} timed out after {timeout}s")
            if exc[0]:
                raise exc[0]
            return result[0]
        return wrapper
    return deco

# ============================================================
# Broker (Pub/Sub Event System)
# ============================================================
class InMemoryBroker:
    def __init__(self):
        self.subs = {}
        self.lock = threading.Lock()
        self.history = []  # Keep recent events for WebSocket streaming

    def publish(self, channel: str, message: dict):
        with self.lock:
            cbs = list(self.subs.get(channel, []))
            # Store in history for streaming
            self.history.append({"channel": channel, "message": message, "ts": now_iso()})
            if len(self.history) > 200:
                self.history = self.history[-200:]

        for cb in cbs:
            try:
                threading.Thread(target=cb, args=(message,), daemon=True).start()
            except Exception:
                traceback.print_exc()

    def subscribe(self, channel: str, callback):
        with self.lock:
            self.subs.setdefault(channel, []).append(callback)

    def get_recent_events(self, limit=50):
        with self.lock:
            return self.history[-limit:]

# ============================================================
# Shared Memory Client
# ============================================================
class InMemorySharedMemoryClient:
    def __init__(self):
        self.store = {}
        self.lock = threading.Lock()

    def add(self, text: str, embedding: Optional[List[float]] = None, meta: Optional[Dict]=None, actor: str="system"):
        cid = uid("mem")
        chunk = {
            "id": cid,
            "text": text,
            "embedding": embedding or [],
            "meta": meta or {},
            "created_ts": int(time.time()),
            "updated_ts": int(time.time()),
            "score": 1.0,
            "version": 1,
            "actor": actor
        }
        with self.lock:
            self.store[cid] = chunk
        return deepcopy(chunk)

    def get(self, cid: str):
        with self.lock:
            return deepcopy(self.store.get(cid))

    def search(self, qtext: str = "", qembedding: Optional[List[float]] = None, topk: int = 8):
        with self.lock:
            items = list(self.store.values())

        results = []
        for it in items:
            score = 0.0
            if qembedding and it.get("embedding"):
                try:
                    a = qembedding
                    b = it["embedding"]
                    sm = sum((a[i] if i < len(a) else 0.0) * (b[i] if i < len(b) else 0.0)
                            for i in range(min(len(a), len(b))))
                    score = float(sm)
                except Exception:
                    score = 0.0
            else:
                if qtext and qtext.lower() in (it["text"] or "").lower():
                    score = 1.0
                else:
                    score = 0.0
            results.append((score, it))

        results.sort(key=lambda x: -x[0])
        return [{"id": r[1]["id"], "score": r[0], "chunk": r[1]} for r in results[:topk]]

# ============================================================
# Embedding Function
# ============================================================
def deterministic_embed(text: str, dim: int = DEFAULT_EMBED_DIM):
    import hashlib, struct
    m = hashlib.sha256(text.encode("utf-8")).digest()
    vec = []
    i = 0
    while len(vec) < dim:
        part = m[i % len(m):(i%len(m))+4]
        if len(part) < 4:
            part = part.ljust(4, b'\0')
        v = struct.unpack(">I", part)[0] / 0xFFFFFFFF
        vec.append((v * 2.0) - 1.0)
        i += 4
    norm = math.sqrt(sum(x*x for x in vec)) or 1.0
    return [x / norm for x in vec]

# ============================================================
# Data Structures
# ============================================================
@dataclass
class ThoughtState:
    id: str = field(default_factory=lambda: uid("thought"))
    actor: str = "soma"
    input_text: str = ""
    rounds: List[Dict[str,Any]] = field(default_factory=list)
    created: str = field(default_factory=now_iso)
    final_output: Optional[Dict[str,Any]] = None
    confidence: float = 0.0

# ============================================================
# Causal Graph
# ============================================================
class CausalGraph:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.lock = threading.Lock()

    def add_node(self, nid: str, label: str, meta: Optional[dict]=None):
        with self.lock:
            self.nodes[nid] = {"label": label, "meta": meta or {}, "ts": now_iso()}

    def add_edge(self, a: str, b: str, weight: float = 0.5):
        with self.lock:
            k = (a,b)
            self.edges[k] = max(0.0, min(1.0, float(weight)))

    def observe(self, a: str, b: str, success: bool):
        with self.lock:
            k = (a,b)
            prev = self.edges.get(k, 0.5)
            alpha = 0.1
            if success:
                new = prev + alpha * (1.0 - prev)
            else:
                new = prev - alpha * prev
            self.edges[k] = max(0.0, min(1.0, new))
            return self.edges[k]

    def predict(self, a: str, threshold: float = 0.5):
        with self.lock:
            res = []
            for (x,y), w in self.edges.items():
                if x == a and w >= threshold:
                    res.append((y,w))
            res.sort(key=lambda t:-t[1])
            return res

# ============================================================
# Conflict Detector
# ============================================================
class ConflictDetector:
    def __init__(self, similarity_threshold: float = 0.6):
        self.similarity_threshold = similarity_threshold

    def score_consistency(self, candidate_text: str, memory_chunks: List[dict]) -> Dict[str,Any]:
        support = []
        conflicts = []
        cand_lower = candidate_text.lower()

        for c in memory_chunks:
            text = (c.get("text") or "").lower()
            if ("not " + text) in cand_lower or ("no " + text) in cand_lower:
                conflicts.append(c["id"])
            elif text and text in cand_lower:
                support.append(c["id"])
            else:
                if c.get("embedding") and len(c["embedding"]) > 0:
                    try:
                        a = deterministic_embed(candidate_text, dim=len(c["embedding"]))
                        b = c["embedding"]
                        num = sum(a[i]*b[i] for i in range(min(len(a),len(b))))
                        den = (math.sqrt(sum(x*x for x in a))*math.sqrt(sum(x*x for x in b))) or 1.0
                        sim = num/den
                        if sim >= self.similarity_threshold:
                            support.append(c["id"])
                        elif sim <= (1 - self.similarity_threshold):
                            conflicts.append(c["id"])
                    except Exception:
                        pass

        if support and not conflicts:
            score = min(0.95, 0.6 + 0.1*len(support))
        elif conflicts and not support:
            score = max(0.05, 0.4 - 0.1*len(conflicts))
        elif support and conflicts:
            score = 0.5 * (0.6 + 0.1*len(support)) + 0.5 * (0.4 - 0.1*len(conflicts))
        else:
            score = 0.5

        score = max(0.01, min(0.99, score))
        return {"consistency_score": score, "conflicts": conflicts, "support": support}

# ============================================================
# Simulator (Hypothesis Generator)
# ============================================================
class Simulator:
    def __init__(self, creative_fn=None, creative_timeout: float = 3.0):
        self.creative_fn = creative_fn
        self.creative_timeout = creative_timeout

    def generate_hypotheses(self, prompt: str, n: int = 3) -> List[str]:
        if self.creative_fn:
            try:
                return time_limited(self.creative_timeout)(self.creative_fn)(prompt, n)
            except TimeoutError:
                return [f"(creative_fn timeout) {prompt}"][:n]
            except Exception:
                return [f"(creative_fn error) {prompt}"][:n]

        # Deterministic fallback
        out = [
            prompt,
            f"Possible alternate interpretation: {prompt} (with emphasis on causality)",
            f"Counterfactual: if NOT ({prompt}), then ..."
        ]
        return out[:n]

# ============================================================
# Reflective Reasoner
# ============================================================
class ReflectiveReasoner:
    def __init__(self,
                 shared_memory_client,
                 broker,
                 embedding_fn = deterministic_embed,
                 max_rounds: int = DEFAULT_MAX_ROUNDS,
                 search_topk: int = DEFAULT_SEARCH_TOPK,
                 confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
                 autosave: bool = True,
                 creative_fn = None):
        self.shared_memory = shared_memory_client
        self.broker = broker
        self.embedding_fn = embedding_fn
        self.max_rounds = max_rounds
        self.search_topk = search_topk
        self.confidence_threshold = confidence_threshold
        self.autosave = autosave

        self.conflict_detector = ConflictDetector()
        self.simulator = Simulator(creative_fn=creative_fn)
        self.causal = CausalGraph()

    def think(self, actor: str, input_text: str, context: Optional[Dict]=None, timeout: float = DEFAULT_TIMEOUT_SEC) -> ThoughtState:
        start_ts = time.time()
        state = ThoughtState(actor=actor, input_text=input_text)

        # Initial embedding
        try:
            emb = self.embedding_fn(input_text)
        except Exception:
            emb = deterministic_embed(input_text)

        # Retrieve initial evidence
        retrieved = []
        try:
            retrieved = self.shared_memory.search(input_text, qembedding=emb, topk=self.search_topk)
        except Exception:
            try:
                retrieved = self.shared_memory.search(input_text, qtext=input_text, topk=self.search_topk)
            except Exception:
                retrieved = []

        candidate = {"text": input_text, "meta": {"source": actor}}

        # Multi-round reasoning loop
        for r in range(self.max_rounds):
            round_info = {
                "round": r+1,
                "timestamp": now_iso(),
                "candidate": candidate,
                "evidence": [],
                "consistency": None,
                "hypotheses": [],
                "decision": None
            }

            mems = [m["chunk"] for m in retrieved] if retrieved else []
            round_info["evidence"] = [{"id": m["id"], "text": (m.get("text") or "")[:200]} for m in mems]

            # Consistency scoring
            cons = self.conflict_detector.score_consistency(candidate["text"], mems)
            round_info["consistency"] = cons

            # Generate hypotheses
            hyps = self.simulator.generate_hypotheses(candidate["text"], n=3)
            round_info["hypotheses"] = hyps

            # Evaluate hypotheses
            hyp_scores = []
            for h in hyps:
                try:
                    h_emb = self.embedding_fn(h)
                except Exception:
                    h_emb = deterministic_embed(h)
                try:
                    hits = self.shared_memory.search(h, qembedding=h_emb, topk=4)
                except Exception:
                    hits = []
                sc = self.conflict_detector.score_consistency(h, [hh["chunk"] for hh in hits])
                hyp_scores.append({
                    "hyp": h,
                    "score": sc["consistency_score"],
                    "support": sc["support"],
                    "conflicts": sc["conflicts"]
                })

            cand_conf = cons["consistency_score"]
            best_h = max(hyp_scores, key=lambda x: x["score"], default=None)

            if best_h and best_h["score"] > cand_conf + 0.12:
                candidate = {
                    "text": best_h["hyp"],
                    "meta": {
                        "derived_from": candidate["text"],
                        "adopted_round": r+1
                    }
                }
                cand_conf = best_h["score"] * 0.9
                round_info["decision"] = f"adopted_hypothesis_{candidate['meta']['adopted_round']}"
            else:
                round_info["decision"] = "retain_candidate"

            # Causal graph update
            node_id = uid("node")
            self.causal.add_node(node_id, label=candidate["text"])

            state.rounds.append(round_info)
            state.confidence = cand_conf

            # Check termination conditions
            if cand_conf >= self.confidence_threshold:
                state.final_output = {
                    "text": candidate["text"],
                    "reason": "confidence_reached",
                    "confidence": cand_conf
                }
                break

            if time.time() - start_ts > timeout:
                state.final_output = {
                    "text": candidate["text"],
                    "reason": "timeout",
                    "confidence": cand_conf
                }
                break

            # Update embedding for next round
            try:
                emb = self.embedding_fn(candidate["text"])
            except Exception:
                emb = deterministic_embed(candidate["text"])

            try:
                retrieved = self.shared_memory.search(candidate["text"], qembedding=emb, topk=self.search_topk)
            except Exception:
                retrieved = self.shared_memory.search(candidate["text"], qtext=candidate["text"], topk=self.search_topk)

        # Autosave to memory
        if self.autosave:
            try:
                meta = {"source": actor, "confidence": state.confidence, "created": now_iso()}
                final_text = state.final_output["text"] if state.final_output else candidate["text"]
                chunk = self.shared_memory.add(final_text, embedding=emb, meta=meta, actor=actor)
                if state.final_output:
                    state.final_output["stored_id"] = chunk["id"]
            except Exception:
                pass

        # Publish trace event
        try:
            self.broker.publish("cognition.trace", {
                "actor": actor,
                "thought_id": state.id,
                "summary": safe_repr(state.final_output),
                "confidence": state.confidence,
                "ts": now_iso()
            })
        except Exception:
            pass

        return state

# ============================================================
# Cognitive Loop Manager (Worker Pool)
# ============================================================
class CognitiveLoopManager:
    def __init__(self,
                 shared_memory_client,
                 broker,
                 embedding_fn = deterministic_embed,
                 creative_fn = None,
                 max_workers: int = MAX_WORKERS):
        self.broker = broker
        self.shared_memory = shared_memory_client
        self.embedding_fn = embedding_fn
        self.creative_fn = creative_fn
        self.reasoner = ReflectiveReasoner(
            self.shared_memory,
            self.broker,
            embedding_fn=self.embedding_fn,
            creative_fn=self.creative_fn
        )
        self.max_workers = max_workers
        self.queue = []
        self.lock = threading.Lock()
        self.threads = []
        self.running = False
        self.metrics = {
            "processed": 0,
            "errors": 0,
            "avg_latency_ms": 0.0,
            "queue_size": 0,
            "active_workers": 0
        }

        # Subscribe to input channel
        self.broker.subscribe("perception.input", self._on_input)

    def start(self):
        self.running = True
        for i in range(self.max_workers):
            t = threading.Thread(target=self._worker_loop, name=f"Worker-{i+1}", daemon=True)
            t.start()
            self.threads.append(t)
        print(f"[CognitiveManager] Started {self.max_workers} worker threads")

    def stop(self):
        self.running = False
        for t in self.threads:
            t.join(timeout=1)
        print("[CognitiveManager] Stopped all workers")

    def _on_input(self, message: dict):
        with self.lock:
            self.queue.append(message)
            self.metrics["queue_size"] = len(self.queue)

    def submit(self, actor: str, text: str, context: Optional[dict] = None):
        """Submit thinking task to queue (async)"""
        msg = {"actor": actor, "text": text, "context": context or {}, "ts": now_iso()}
        try:
            self.broker.publish("perception.input", msg)
        except Exception:
            pass
        with self.lock:
            self.queue.append(msg)
            self.metrics["queue_size"] = len(self.queue)
        return msg

    def _worker_loop(self):
        while True:
            if not self.running:
                time.sleep(0.05)
                continue

            item = None
            with self.lock:
                if self.queue:
                    item = self.queue.pop(0)
                    self.metrics["queue_size"] = len(self.queue)
                    self.metrics["active_workers"] += 1

            if not item:
                time.sleep(0.05)
                continue

            start = time.time()
            try:
                state = self.reasoner.think(
                    item.get("actor", "unknown"),
                    item.get("text", ""),
                    context=item.get("context", {}),
                    timeout=DEFAULT_TIMEOUT_SEC
                )

                self.metrics["processed"] += 1
                latency = (time.time() - start) * 1000.0

                # Update moving average
                prev_avg = self.metrics["avg_latency_ms"]
                n = self.metrics["processed"]
                self.metrics["avg_latency_ms"] = (prev_avg * (n - 1) + latency) / n

                # Publish result
                self.broker.publish("perception.result", {
                    "actor": item.get("actor"),
                    "thought": {
                        "id": state.id,
                        "final": state.final_output,
                        "confidence": state.confidence,
                        "rounds": state.rounds
                    },
                    "confidence": state.confidence,
                    "rounds": len(state.rounds)
                })

                # Low confidence alert
                if state.confidence < 0.45:
                    self.broker.publish("perception.low_confidence", {
                        "actor": item.get("actor"),
                        "thought_id": state.id,
                        "text": item.get("text")
                    })

                # Conflict alert
                conflicts = []
                for r in state.rounds:
                    if r.get("consistency") and r["consistency"].get("conflicts"):
                        conflicts.extend(r["consistency"]["conflicts"])
                if conflicts:
                    self.broker.publish("perception.conflict", {
                        "actor": item.get("actor"),
                        "thought_id": state.id,
                        "conflicts": conflicts
                    })

            except Exception as e:
                self.metrics["errors"] += 1
                traceback.print_exc()
                try:
                    self.broker.publish("perception.error", {
                        "error": str(e),
                        "ts": now_iso(),
                        "item": safe_repr(item)
                    })
                except Exception:
                    pass
            finally:
                with self.lock:
                    self.metrics["active_workers"] -= 1

# ============================================================
# FastAPI App Setup
# ============================================================
app = FastAPI(
    title="SOMA Cognitive API - ULTIMATE",
    description="Phoenix Ferrari Edition - Maximum Power Cognitive Engine",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Global Instance
# ============================================================
broker = InMemoryBroker()
shared_memory = InMemorySharedMemoryClient()
cognitive_manager = CognitiveLoopManager(
    shared_memory_client=shared_memory,
    broker=broker,
    embedding_fn=deterministic_embed,
    max_workers=MAX_WORKERS
)

# Storage for recent thoughts (for dashboard)
recent_thoughts: List[Dict[str, Any]] = []
MAX_RECENT_THOUGHTS = 100

# WebSocket connections
websocket_clients = set()

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
# Broker Event Listeners
# ============================================================
def on_perception_result(msg):
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "result",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

    # Broadcast to WebSocket clients
    asyncio.create_task(broadcast_to_websockets({
        "event": "perception.result",
        "data": msg
    }))

def on_low_confidence(msg):
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "low_confidence",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

    asyncio.create_task(broadcast_to_websockets({
        "event": "perception.low_confidence",
        "data": msg
    }))

def on_conflict(msg):
    global recent_thoughts
    recent_thoughts.insert(0, {
        "type": "conflict",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "data": msg
    })
    recent_thoughts = recent_thoughts[:MAX_RECENT_THOUGHTS]

    asyncio.create_task(broadcast_to_websockets({
        "event": "perception.conflict",
        "data": msg
    }))

broker.subscribe("perception.result", on_perception_result)
broker.subscribe("perception.low_confidence", on_low_confidence)
broker.subscribe("perception.conflict", on_conflict)

# ============================================================
# WebSocket Broadcasting
# ============================================================
async def broadcast_to_websockets(message: dict):
    """Broadcast message to all connected WebSocket clients"""
    disconnected = set()
    for ws in websocket_clients:
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.add(ws)

    # Clean up disconnected clients
    for ws in disconnected:
        websocket_clients.discard(ws)

# ============================================================
# API Endpoints
# ============================================================
@app.on_event("startup")
async def startup_event():
    print("=" * 60)
    print("SOMA Cognitive API - ULTIMATE EDITION")
    print("Phoenix Ferrari - Maximum Power Mode")
    print("=" * 60)
    print(f"[Startup] Starting cognitive manager with {MAX_WORKERS} workers...")
    cognitive_manager.start()

    # Seed initial memories
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
    shared_memory.add(
        "ConductorArbiter orchestrates AI swarms and task delegation.",
        embedding=deterministic_embed("ai orchestration")
    )

    print("[Startup] OK Cognitive manager started with seeded memories")
    print(f"[Startup] Worker pool: {MAX_WORKERS} threads active")
    print(f"[Startup] Pub/Sub broker: operational")
    print(f"[Startup] WebSocket streaming: enabled")
    print("=" * 60)

@app.on_event("shutdown")
async def shutdown_event():
    print("[Shutdown] Stopping cognitive manager...")
    cognitive_manager.stop()
    print("[Shutdown] OK Cognitive manager stopped")

@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "operational",
        "service": "SOMA Cognitive API - ULTIMATE",
        "version": "2.0.0",
        "edition": "Phoenix Ferrari",
        "workers": MAX_WORKERS,
        "features": [
            "worker_pool",
            "pub_sub_events",
            "websocket_streaming",
            "metrics",
            "causal_graph",
            "llm_ready"
        ]
    }

@app.post("/api/cognitive/think", response_model=ThinkResponse)
async def think(request: ThinkRequest):
    """
    Synchronous thinking - blocks until complete.
    Use this for immediate results.
    """
    try:
        loop = asyncio.get_event_loop()
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
    Asynchronous thinking - returns immediately, processes in background.
    Subscribe to WebSocket or poll /api/cognitive/thoughts for results.
    """
    try:
        msg = cognitive_manager.submit(
            request.actor,
            request.text,
            context=request.context
        )
        return {
            "success": True,
            "message": "Query submitted for processing",
            "actor": request.actor,
            "queued_at": msg["ts"],
            "queue_size": cognitive_manager.metrics["queue_size"]
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

@app.get("/api/cognitive/metrics")
async def get_metrics():
    """Get performance metrics"""
    return {
        "metrics": cognitive_manager.metrics,
        "broker_events": len(broker.get_recent_events()),
        "memory_chunks": len(shared_memory.store),
        "websocket_clients": len(websocket_clients)
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

@app.get("/api/broker/events")
async def get_broker_events():
    """Get recent broker events"""
    events = broker.get_recent_events(limit=50)
    return {
        "events": events,
        "count": len(events)
    }

@app.websocket("/ws/cognitive")
async def websocket_cognitive(websocket: WebSocket):
    """
    WebSocket endpoint for real-time cognitive events.
    Streams: perception.result, perception.low_confidence, perception.conflict
    """
    await websocket.accept()
    websocket_clients.add(websocket)
    print(f"[WebSocket] Client connected. Total clients: {len(websocket_clients)}")

    try:
        # Send initial status
        await websocket.send_json({
            "event": "connected",
            "data": {
                "workers": MAX_WORKERS,
                "metrics": cognitive_manager.metrics,
                "memory_chunks": len(shared_memory.store)
            }
        })

        # Keep connection alive and handle incoming messages
        while True:
            data = await websocket.receive_text()
            # Echo back or handle commands if needed
            await websocket.send_json({"echo": data})

    except WebSocketDisconnect:
        websocket_clients.discard(websocket)
        print(f"[WebSocket] Client disconnected. Total clients: {len(websocket_clients)}")
    except Exception as e:
        print(f"[WebSocket] Error: {e}")
        websocket_clients.discard(websocket)

# ============================================================
# Run Server
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("SOMA Cognitive API Server - ULTIMATE EDITION")
    print("Phoenix Ferrari - Maximum Power Mode")
    print("=" * 60)
    print("Starting on http://localhost:5000")
    print("WebSocket: ws://localhost:5000/ws/cognitive")
    print("Docs: http://localhost:5000/docs")
    print("=" * 60)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000,
        log_level="info"
    )
