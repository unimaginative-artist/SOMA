# Gray Matter Network (GMN) — Architecture Map

> A self-propagating intranet. Each Command Bridge is a node; nodes connect into a
> mesh. Everything we own — sites, apps (Studio), data — lives on it, self-hosted,
> so no one can take it down. A closed ecosystem governed by SOMA. **Pulse** publishes
> sites to the GMN; **Portal** (the browser) browses and searches them.

The headline finding from auditing the codebase: **~80% of this already exists.** What's
missing is not the hard infrastructure — it's the wire that connects two halves that are
already built but currently isolated.

---

## Who runs it — the participation model

A decentralized network doesn't need *everyone* to run a node; it needs *enough*. Like
the web (few run servers) or BitTorrent (a file lives on its seeders), GMN stays alive on
its hosts while everyone else rides it. People pick a rung:

1. **Full node (Command Bridge)** — power users and hosts. Run the software, host their
   own `.gmn` sites, hold replicas, act as bootstrap/gateway nodes. The backbone.
2. **Gateway client (Studio mobile / web)** — *normal people.* Install just the app; it
   talks to a **gateway** (a real Command Bridge on the network — their own, a community
   one, or a public one) and rides it to browse GMN + use Studio. A phone can't run a peer
   server and doesn't need to: `/api/gmn/render/:domain` on any node already resolves any
   site from the whole mesh (local → replica → mesh-fetch → verify → sandbox), so the app
   just asks a node to fetch on its behalf. **This is Batch 6.**
3. **Hosted node** — a sovereign presence without running software: a service runs a node
   on your behalf (your identity, your sites). Semi-decentralized middle ground.

**Publishing** needs a host: a normal user publishes through a gateway/hosted node that
holds their site; replication (Batch 4) keeps it alive if that node blinks. Full
sovereignty (un-takedownable, self-hosted) = run your own node.

**The honest tradeoff:** gateways pull *some* centralization back in. Three things keep it
honest — content-addressing means a gateway can't tamper (verified or rejected); anyone
can be a gateway (no single owner of the door); and you can always leave a gateway and run
your own node (the sovereign path is always open — the part the corporate web never gives).

**Shipping path:** run a few public gateway + bootstrap nodes (a Command Bridge with a
public address *is* one); Studio mobile ships as a gateway client; power users self-host;
later a lightweight "GMN Lite" daemon lets regular folks host cheaply without the full CB.

---

## 1. What already exists (and works)

### A. The node / mesh transport — `arbiters/GMNConnectivityArbiter.js`
The peer layer is real, not a stub:
- **Node identity + secure handshake** — `core/GMNHandshakeEngine.js`: keypair per node, challenge/response, signature verification ("512-bit Arbiter Handshake").
- **LAN auto-discovery** — UDP beacon on port **7778**, broadcasts presence every 30s, auto-connects to discovered nodes. *Two Command Bridges on the same network already find each other.*
- **WebSocket peer mesh** — server on port **7777**; verified peers tracked in `peers` Map.
- **Cross-internet manual peering** — `addManualPeer(address)` → persisted to `config/gmn-peers.json`, auto-reconnect on boot.
- **Gossip / viral propagation** — `_gossipWisdom` / `_processGossip`: dedup (`seenMessages`), TTL (`hops > 5`), re-broadcast.
- **Governance gates** — Thalamus validates outbound gossip; TrustRegistry blacklist; IdolSenturian "Amber Trap" feeds attackers gibberish.

### B. Site hosting — `server/services/GMNSiteService.js`
A full personal-web host:
- Publishes `{name}.gmn` sites to `data/gmn/sites/{name}/` with `manifest.gmn.json` + `construct.manifest.json`.
- **Heavy sandbox = "SOMA-governed"**: strips `<script>`/`on*` handlers/`javascript:`, blocks `eval/Function/setTimeout`, injects strict CSP (`default-src 'none'`), blocks forms by default, inlines same-site assets, 5 MB cap.
- **Portal bridge** injected into every page: `.gmn` links navigate inside Portal via `postMessage('gmn-navigate')`.
- Versioning (snapshot/restore), file CRUD, ZIP import/export, resolution **outside public DNS**.
- Seeds `barry.gmn` on first run.

### C. API — `server/routes/gmnRoutes.js`
`/api/gmn/*`: list/resolve/publish/render sites, full file editing, metadata, versions, export/import, reindex, repair-security, and **`POST /generate-site`** — SSE streaming **AI site generation** via `quadBrain.reason()` with the sandbox rules baked into the prompt.

### D. Browser — `frontend/apps/command-bridge/panels/aperture/apps/Portal.jsx`
Fetches `/api/gmn/render/{domain}` and `/api/gmn/sites`, renders sandboxed sites, has a built-in site editor.

### E. Search — `server/services/DendriteSearchEngine.js`
Indexes rendered GMN site text; reindexes every 15 min. Portal searches it.

### F. UI / publisher
`panels/GrayMatter/GrayMatterPanel.jsx` (GMN dashboard) and the **Pulse** app (`panels/pulse/`) for building/editing/publishing.

### G. Wisdom gossip (separate track, already live)
`CronaArbiter`, `GossipArbiter`, `InternalInstinctCore` emit `gmn.publication` (knowledge fractals) → `GMNConnectivityArbiter` propagates them across peers, audited by a Trust engine. This is the seed of the distributed-reasoning ("gmn") tier.

---

## 2. The gap (the missing 20% = "the network")

Today there are **two disconnected halves**:
1. A complete **single-node personal web** (host/browse/edit/search/AI-generate **your own** sites).
2. A **mesh that gossips wisdom** (cognitive knowledge) between nodes.

**They don't touch.** Concretely:

| Gap | Today | Needed |
|-----|-------|--------|
| **G1 — Site announce** | Publishing a site is local-only; the mesh never hears about it | On publish/update, gossip `gmn.site.announce` {domain, hostNodeId, title, summary, hash, ts}; peers keep a registry of who-hosts-what |
| **G2 — Cross-node resolve + fetch** | Portal resolves/renders only the **local** host | If `{name}.gmn` isn't local, look up its host in the announce registry and fetch the rendered page **from that peer over the mesh** |
| **G3 — Federated search** | Dendrite indexes only local sites | Index the gossiped site summaries (instant network-wide title/summary search); later, fan out full-text queries to peers |
| **G4 — Hands-free internet reach** | Cross-internet peering is **manual** (`gmn-peers.json`) | A known **rendezvous/bootstrap** node (or few) for auto-discovery + NAT assist, so the net self-propagates beyond the LAN |
| **G5 — Pathways + reasoning on the mesh** | Pathways is local/simulated; the `gmn` tier just hits local SOMA | Both ride the same peer transport as typed, E2E messages |

---

## 3. Layered architecture (target)

```
┌──────────────────────────────────────────────────────────────┐
│  APPS        Portal (browse/search) · Pulse (publish) ·        │
│              Studio · Pathways · gmn reasoning tier            │
├──────────────────────────────────────────────────────────────┤
│  RESOLUTION  local GMNSiteService → mesh announce-registry →   │  ← G1,G2
│  + SEARCH    Dendrite (local + federated summaries)            │  ← G3
├──────────────────────────────────────────────────────────────┤
│  HOSTING     GMNSiteService (sandboxed .gmn sites)  [DONE]     │
├──────────────────────────────────────────────────────────────┤
│  TRANSPORT   GMNConnectivityArbiter — WS mesh, gossip,         │
│              request/response over peers  [DONE; add req/resp] │
├──────────────────────────────────────────────────────────────┤
│  DISCOVERY   LAN UDP beacon [DONE] + rendezvous/bootstrap      │  ← G4
├──────────────────────────────────────────────────────────────┤
│  IDENTITY    GMNHandshakeEngine keypairs  [DONE]               │
├──────────────────────────────────────────────────────────────┤
│  GOVERNANCE  Thalamus / TrustRegistry / Senturian  [DONE]      │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. The two hard problems (these reshape the plan)

### 4a. Availability — a site must outlive its origin node
**Requirement (Barry's #1):** a published site must NOT die when the owner's Command
Bridge is off. "Fetch from the host" fails the moment the host sleeps. The answer is
**content-addressed replication (pinning)**:
- A published site is packaged and hashed (`contentHash` already exists per render —
  extend to the whole bundle). **The hash is the site's true address.**
- Sites are **replicated / pinned** across nodes: the origin pins it, and the network
  keeps ≥N copies on other nodes (auto-replicate on announce + opt-in "host this" pins).
- Resolution finds *any* node holding the hash, fetches the bundle, and **verifies it
  against the hash**. Origin can be offline — the site lives as long as ≥1 replica is up.
- This is exactly what makes a site "fully self-hosted" **and** "un-takedownable":
  no single node's downtime kills it.

### 4b. Mobile — how Studio mobile joins GMN
A phone can't run a Node WS peer server, so mobile can't be a full node.
- **Now: gateway client.** Mobile talks HTTPS to a **gateway node** — its own home
  Command Bridge when reachable, else any public/rendezvous gateway. The gateway
  resolves `.gmn` over the mesh + replication and serves sandboxed HTML to mobile's
  Portal/Studio. **Because of replication (4a), this works even when the user's own
  node is offline.**
- **Later: WebRTC peer.** A mobile PWA/WebView can hold WebRTC data channels, so after
  a rendezvous handshake the phone becomes a real (if light) peer. Upgrade path, not blocker.

---

## 5. Batched roadmap (~a week+, one batch per sitting)

- **Batch 1 — Content-addressed bundles + local site registry.** Package + hash whole
  sites; each node keeps `gmnSiteRegistry` (domain → {originNodeId, contentHash, title,
  summary, replicas[], lastSeen}). No networking. Foundation for everything.
- **Batch 2 — Site-announce gossip (G1).** Publish/edit emits `gmn.site.announce`; peers
  populate their registry. The network now *knows* every site. (Registry lookup = instant
  federated search of titles/summaries — G3 for nearly free.)
- **Batch 3 — Cross-node fetch + verify (G2).** Mesh request/response: fetch a bundle by
  domain/hash from a holder, verify the hash, render in Portal. **Milestone: browse a
  peer's live site.**
- **Batch 4 — Replication / pinning (the availability fix, 4a).** Nodes pin copies;
  auto-replicate to ≥N nodes on announce. **Milestone: a site stays up with its origin
  offline.**
- **Batch 5 — Rendezvous / bootstrap + NAT (G4).** Bootstrap node list; nodes publish
  reachable addresses + registry digests; hands-free propagation beyond the LAN.
- **Batch 6 — Studio mobile → GMN via gateway (4b).** Mobile browses GMN through a
  gateway node; works offline-of-origin thanks to Batch 4.
- **Batch 7 — Apps on the mesh (G5).** Pathways as E2E messaging over the transport; the
  `gmn` reasoning tier fans queries across peers.
- **Batch 8 (stretch).** WebRTC mobile peer; DHT-style content routing for scale.

**Dependencies:** 1→2→3→4 strict; 5 after 3; 6 after 4; 7 after 3.
**Governance throughout:** site fetches render through the existing sandbox; announce /
replication pass Thalamus/TrustRegistry; `contentHash` guarantees integrity.

---

## 6. Honest constraints
- **NAT/firewalls** — pure-serverless across the open internet needs *some* rendezvous
  (Batch 5). LAN mesh is fully serverless today.
- **Replication policy** — who pins what, how many copies; needs a sane default + abuse
  controls. Start: origin + auto-pin to N trusted peers + opt-in manual pins.
- **Trust at scale** — announce/replication is a spam surface; gate via Thalamus/Trust.
- **Content integrity** — `contentHash` lets any replica serve and the requester verify;
  this is the backbone of un-takedownable hosting.

---

*Status: plan. Substrate ~80% built. Next: **Batch 1** (content-addressing + registry) —
small, local, no networking risk.*
