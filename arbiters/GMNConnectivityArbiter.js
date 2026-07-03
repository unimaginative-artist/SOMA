/**
 * GMNConnectivityArbiter.js
 *
 * THE NETWORK ADAPTER (Pillar of SOMA-Net)
 *
 * Manages peer-to-peer connections across the Graymatter Network.
 * Implements:
 * - Auto-discovery via Beacon protocol.
 * - Quantum-safe handshake (via GMNHandshakeEngine).
 * - Persistent trusted synapses.
 * - Peer reputation tracking.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { GMNHandshakeEngine } from '../core/GMNHandshakeEngine.js';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import path from 'node:path';
import messageBroker from '../core/MessageBroker.js';
import gmnRegistry from '../server/services/GMNSiteRegistry.js';
import { buildSiteAnnounce, verifySiteAnnounce, buildReplicaAnnounce, verifyReplicaAnnounce } from '../server/services/GMNAnnounce.js';
import GMNSiteService from '../server/services/GMNSiteService.js';
import gmnPinStore from '../server/services/GMNPinStore.js';
import gmnPeerBook from '../server/services/GMNPeerBook.js';
import gmnMessaging from '../server/services/GMNMessaging.js';
import gmnIdentity, { deriveNodeIdFromPublicKeyHex } from '../server/services/GMNIdentity.js';
import bannedNodes from '../server/services/GMNBannedNodes.js';
import { readFileSync } from 'node:fs';

export class GMNConnectivityArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'GMN-Connectivity',
            role: ArbiterRole.CONDUCTOR, // Use uppercase enum
            capabilities: [
                'network_access',
                'fractal-sync',
                'integrate-systems'
            ]
        });

        this.broker = messageBroker;
        this.port = opts.port || 7777;
        this.discoveryPort = opts.discoveryPort || 7778;
        this.nodeAddress = opts.nodeAddress || 'local.gmn.somaexample.cd';
        this.handshake = new GMNHandshakeEngine(this.name);
        
        // Peer Management
        this.peers = new Map(); // nodeId -> { socket, address, status, reputation, publicKey }
        this.trustedSynapses = new Set(); // Set of verified nodeIds
        this.seenMessages = new Set(); // Deduplication cache

        this.server = null;
        this.reconnectTimer = null;
        this.peersFile = path.resolve(process.cwd(), 'config', 'gmn-peers.json');

        // Batch 3: serve local site bundles to peers, and track in-flight fetches.
        this.siteService = new GMNSiteService();
        this._pendingFetches = new Map(); // reqId -> { resolve, timer, domain, expectedHash }

        // Batch 4: replication — auto-pin announced sites toward a target replica
        // count so a site survives its origin going offline.
        this.replicationEnabled = process.env.GMN_REPLICATION !== 'false';
        this.targetReplicas = Number(process.env.GMN_TARGET_REPLICAS || 3);

        // Batch 5: rendezvous / peer-exchange — a self-assembling mesh beyond the LAN.
        this.peerBook = gmnPeerBook;
        this.maxPeers = Number(process.env.GMN_MAX_PEERS || 16);
        this.peerBook.maxPeers = this.maxPeers;
        const net = this._loadNetworkConfig();
        this.publicAddress = net.publicAddress || null;   // our reachable host:port, if any
        this.bootstrapAddresses = net.bootstrap || [];
        for (const addr of this.bootstrapAddresses) this.peerBook.remember(addr, { source: 'bootstrap' });
        this._meshTimer = null;
    }

    async onInitialize() {
        this.log('info', `Initializing GMN Connectivity on port ${this.port}...`);

        // Start Peer Server
        this._startServer();

        // Start Auto-Discovery Beacon
        this._startDiscoveryBeacon();

        // Section 3: Gossip Protocol Subscription
        messageBroker.subscribe('gmn.publication', (env) => this._gossipWisdom(env));
        messageBroker.subscribe('gmn.gossip', (env) => this._processGossip(env));

        // Batch 2: site-announce gossip — a local publish/change fans a signed
        // announce across the mesh so peers learn the site exists.
        messageBroker.subscribe('gmn.site.announce', (env) => this._broadcastAnnounce(env?.payload || env));

        // Batch 4: a manual pin (from the HTTP layer) fans a replica announce.
        messageBroker.subscribe('gmn.replica.announce', (env) => this._broadcastReplica(env?.payload || env));

        // Reconnect to saved peers (cross-internet manual connections)
        setTimeout(() => this._reconnectSavedPeers(), 5000);

        // Batch 3: expose this transport so HTTP routes can request peer sites.
        globalThis.__gmnMesh = this;

        // Batch 5: dial bootstrap seeds, then keep the mesh assembled (dial + PEX).
        for (const addr of this.bootstrapAddresses) { try { this.connectToPeer(addr); } catch {} }
        setTimeout(() => this._maintainMesh(), 8000);
        this._meshTimer = setInterval(() => this._maintainMesh(), 60000);
        this._meshTimer.unref?.();

        this.auditLogger.info('GMN Connectivity Arbiter Ready');
    }

    async _reconnectSavedPeers() {
        try {
            const raw = await fs.readFile(this.peersFile, 'utf8');
            const saved = JSON.parse(raw);
            if (Array.isArray(saved) && saved.length > 0) {
                this.log('info', `🔗 Reconnecting to ${saved.length} saved peer(s)...`);
                for (const address of saved) {
                    try { this.connectToPeer(address); } catch { /* non-fatal */ }
                }
            }
        } catch { /* file doesn't exist yet — normal on first run */ }
    }

    async _savePeers(addresses) {
        try {
            await fs.mkdir(path.dirname(this.peersFile), { recursive: true });
            await fs.writeFile(this.peersFile, JSON.stringify(addresses, null, 2));
        } catch (e) {
            this.log('warn', `Could not save peers: ${e.message}`);
        }
    }

    async addManualPeer(address) {
        // Connect now
        this.connectToPeer(address);

        // Persist so it auto-reconnects on next boot
        let saved = [];
        try {
            const raw = await fs.readFile(this.peersFile, 'utf8');
            saved = JSON.parse(raw);
        } catch { /* file doesn't exist yet */ }
        if (!saved.includes(address)) {
            saved.push(address);
            await this._savePeers(saved);
        }
    }

    async removeManualPeer(address) {
        try {
            const raw = await fs.readFile(this.peersFile, 'utf8');
            const saved = JSON.parse(raw).filter(a => a !== address);
            await this._savePeers(saved);
        } catch { /* non-fatal */ }
    }

    /**
     * Section 3: Viral Propagation (The 'Good Virus')
     * Spread a piece of wisdom to all currently connected peers.
     */
    async _gossipWisdom(envelope) {
        const { payload } = envelope;
        const msgId = payload.id || crypto.randomUUID();

        // 1. Loop Prevention
        if (this.seenMessages.has(msgId)) return;
        this.seenMessages.add(msgId);
        
        // 2. Thalamus Check (Security Gate)
        // We verify with the local Thalamus before broadcasting outbound
        const thalamus = messageBroker.getArbiter('LocalThalamus')?.instance;
        if (thalamus) {
            const check = await thalamus.validateOutbound(envelope);
            if (!check.allowed) {
                this.log('warn', `🛑 Gossip blocked by Thalamus: ${check.reason}`);
                return;
            }
        }

        const nodeId = payload.sourceAddress;
        this.log('info', `🦠 Viral Propagation: Gossiping wisdom from ${nodeId} to peers.`);

        const gossipMsg = JSON.stringify({
            type: 'gmn_gossip',
            id: msgId,
            payload: payload,
            hops: (payload.hops || 0) + 1
        });

        for (const [peerId, peer] of this.peers.entries()) {
            if (peer.socket.readyState === WebSocket.OPEN) {
                peer.socket.send(gossipMsg);
            }
        }
        
        // Limit cache size
        if (this.seenMessages.size > 1000) {
            const it = this.seenMessages.values();
            this.seenMessages.delete(it.next().value);
        }
    }

    /**
     * Process incoming gossip from a peer
     */
    async _processGossip(envelope) {
        const { payload, hops, id } = envelope;
        
        // 1. Loop Prevention
        if (this.seenMessages.has(id)) return;
        this.seenMessages.add(id);

        if (hops > 5) return; // Prevent infinite loops (TTL)

        this.log('info', `📥 Received GMN Gossip (Hop ${hops})`);

        // Forward to Trust Engine for auditing
        const trustEngine = messageBroker.getArbiter('GMN-TrustEngine')?.instance;
        if (trustEngine && payload.wisdom) {
            for (const fractal of payload.wisdom) {
                const audit = await trustEngine.auditWisdom(fractal, payload.sourceAddress);
                if (audit.verdict === 'valid') {
                    // Integrate into local memory
                    this.emit('wisdom_integrated', fractal);
                }
            }
        }

        // Viral re-propagation (Section 3)
        // We re-use _gossipWisdom which now handles Thalamus checks and sending
        await this._gossipWisdom({ payload: { ...payload, hops, id } });
    }

    /**
     * Start the incoming connection server
     */
    _startServer() {
        try {
            this.server = new WebSocketServer({ port: this.port });
            
            this.server.on('connection', (socket, req) => {
                const ip = req.socket.remoteAddress;
                this.log('info', `Incoming GMN connection from ${ip}`);
                this._handleIncomingConnection(socket, req);
            });

            this.server.on('error', (err) => {
                this.log('error', `GMN Peer Server error: ${err.message}`);
                if (err.code === 'EADDRINUSE') {
                    this.log('warn', `Port ${this.port} already in use. GMN Peer Server will be disabled for this instance.`);
                }
            });

            console.log(`[${this.name}] 📡 GMN Peer Server listening on port ${this.port}`);
        } catch (e) {
            this.log('error', `Failed to start GMN Peer Server: ${e.message}`);
        }
    }

    /**
     * Handle incoming peer handshake
     */
    async _handleIncomingConnection(socket, req) {
        const remoteIP = req.socket.remoteAddress;
        
        // 1. Blacklist Check
        const trustEngine = messageBroker.getArbiter('TrustRegistry')?.instance;
        if (trustEngine && trustEngine.getScore(remoteIP) < 0.2) {
            this.log('warn', `🚨 Blacklisted connection from ${remoteIP}. Redirecting to Amber Trap.`);
            const senturian = messageBroker.getArbiter('IdolSenturian')?.instance;
            if (senturian) {
                return senturian.applyAmberPressure(socket, remoteIP);
            }
            return socket.close();
        }

        socket.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                
                if (msg.type === 'handshake_init') {
                    await this._processHandshake(socket, msg);
                } else {
                    // Unauthorized message format before handshake -> Potential exploit attempt
                    throw new Error('Protocol Violation');
                }
            } catch (e) {
                this.log('error', `Handshake parse error from ${remoteIP}: ${e.message}`);
                // REDIRECT TO TRAP: Feed the attacker gibberish
                const senturian = messageBroker.getArbiter('IdolSenturian')?.instance;
                if (senturian) {
                    senturian.applyAmberPressure(socket, remoteIP);
                } else {
                    socket.close();
                }
            }
        });
    }

    /**
     * Initiate connection to a new peer
     */
    async connectToPeer(address) {
        // Prevent connecting to self or existing peers
        if (address.includes(`localhost:${this.port}`) || address.includes(`127.0.0.1:${this.port}`)) return;
        if (this.peers.has(address)) return;

        this.log('info', `Attempting to connect to GMN Node: ${address}`);
        
        try {
            const socket = new WebSocket(`ws://${address}`);

            socket.on('open', () => {
                this._sendHandshakeInit(socket);
            });

            // Connecting side of the mutual handshake: the peer replies to our
            // handshake_init with a handshake_response (their signature over our
            // challenge + their own challenge). We verify, counter-sign, and finalize.
            socket.on('message', (data) => this._handleOutgoingHandshake(socket, data, address));

            socket.on('error', (err) => {
                this.log('error', `Failed to connect to ${address}: ${err.message}`);
            });
        } catch (e) {
            this.log('error', `Socket error for ${address}: ${e.message}`);
        }
    }

    /**
     * STAGE 1: Send Handshake Initialization
     */
    _sendHandshakeInit(socket) {
        const challenge = this.handshake.generateChallenge();
        socket.challengeSent = challenge;
        
        socket.send(JSON.stringify({
            type: 'handshake_init',
            nodeId: this.name,
            address: this.nodeAddress,
            publicKey: this.handshake.getPublicKey(),
            encPub: gmnIdentity.getEncPublicKeyHex(),
            challenge: challenge,
            port: this.port
        }));
    }

    /**
     * STAGE 2: Process Handshake Response & Verification
     */
    async _processHandshake(socket, msg) {
        const { nodeId, address, publicKey, challenge } = msg;
        
        this.log('info', `Processing handshake from ${nodeId} (${address})`);

        // 1. Sign their challenge
        const signature = this.handshake.signChallenge(challenge);
        
        // 2. Send back our identity and signature
        const ourChallenge = this.handshake.generateChallenge();
        socket.challengeSent = ourChallenge;

        socket.send(JSON.stringify({
            type: 'handshake_response',
            nodeId: this.name,
            address: this.nodeAddress,
            publicKey: this.handshake.getPublicKey(),
            encPub: gmnIdentity.getEncPublicKeyHex(),
            signature: signature,
            challenge: ourChallenge
        }));

        // 3. Verify their response (once received)
        const responseHandler = async (data) => {
            const nextMsg = JSON.parse(data);
            if (nextMsg.type === 'handshake_response') {
                const verified = this.handshake.verifyPeerSignature(
                    socket.challengeSent, 
                    nextMsg.signature, 
                    nextMsg.publicKey
                );

                if (verified) {
                    this.log('success', `✅ Node ${nodeId} VERIFIED via 512-bit Arbiter Handshake`);
                    this.trustedSynapses.add(nodeId);
                    const peerEncPub = msg.encPub || nextMsg.encPub || null;
                    this.peers.set(nodeId, { socket, address, status: 'online', publicKey: nextMsg.publicKey, encPub: peerEncPub, connectedAt: Date.now() });
                    this._recordMessagingContact(nextMsg.publicKey, peerEncPub);
                    this._notifyPeerChanged();

                    // Cleanup this listener
                    socket.removeListener('message', responseHandler);

                    // General post-handshake message handler
                    socket.on('message', (raw) => {
                        try { this._handlePeerMessage(JSON.parse(raw), nodeId); } catch {}
                    });

                    socket.on('close', () => {
                        this.log('warn', `Node ${nodeId} disconnected.`);
                        this.peers.delete(nodeId);
                        this._notifyPeerChanged();
                    });

                    // Sync our local site catalog + exchange peers with the newcomer.
                    this._sendLocalAnnounces(socket);
                    this._sendPeerExchange(socket);
                } else {
                    this.log('error', `🚨 Verification FAILED for node ${nodeId}. Closing connection.`);
                    socket.close();
                }
            }
        };

        socket.on('message', responseHandler);
    }

    /**
     * Handle a general message from a verified peer
     */
    _handlePeerMessage(msg, fromNodeId) {
        if (!msg?.type) return;

        if (msg.type === 'thirdplace.position') {
            // Relay to local clients via messageBroker
            try { messageBroker.publish('gmn.relay.thirdplace.position', msg.data); } catch {}
            return;
        }

        if (msg.type === 'gmn_gossip') {
            this._processGossip(msg).catch(() => {});
            return;
        }

        if (msg.type === 'gmn_site_announce') {
            this._onSiteAnnounce(msg, fromNodeId);
            return;
        }

        if (msg.type === 'gmn_site_fetch') {
            this._serveSiteFetch(msg, fromNodeId);
            return;
        }

        if (msg.type === 'gmn_site_fetch_reply') {
            this._onSiteFetchReply(msg);
            return;
        }

        if (msg.type === 'gmn_replica_announce') {
            this._onReplicaAnnounce(msg, fromNodeId);
            return;
        }

        if (msg.type === 'gmn_peer_exchange') {
            this._onPeerExchange(msg);
            return;
        }

        if (msg.type === 'gmn_dm') {
            this._onDirectMessage(msg, fromNodeId);
            return;
        }

        if (msg.type === 'gmn_dm_receipt') {
            this._onDmReceipt(msg, fromNodeId);
            return;
        }
    }

    // ── Batch 7b: ephemeral E2E direct messages over the mesh ──────────────────
    // Messages flood toward the addressed node (cleartext `to` for routing; the body
    // is sealed so only the recipient reads it). Each node dedups + relays; the
    // recipient stores it and sends a signed delivery receipt back.

    _floodPacket(wire, hops, exceptNodeId) {
        const packet = JSON.stringify({ ...wire, hops });
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId === exceptNodeId) continue;
            if (peer.socket?.readyState === WebSocket.OPEN) { try { peer.socket.send(packet); } catch {} }
        }
    }

    /** Send a sealed DM onto the mesh (called by the HTTP layer). */
    routeDM(wire) {
        if (!wire?.to || !wire?.msgId) return false;
        this.seenMessages.add('dm|' + wire.msgId); // we originate it
        this._floodPacket(wire, 0, null);
        this._trimSeen();
        return true;
    }

    _onDirectMessage(msg, fromNodeId) {
        const key = 'dm|' + msg.msgId;
        if (this.seenMessages.has(key)) return;
        this.seenMessages.add(key); this._trimSeen();

        if (msg.to === gmnIdentity.getNodeId()) {
            const r = gmnMessaging.receive(msg);
            if (r?.ok && !r.duplicate) {
                try { messageBroker.publish('gmn.dm.received', { from: r.from, msgId: msg.msgId }); } catch {}
                this._sendReceipt(r.from, msg.msgId, 'delivered');
            }
            return;
        }
        if ((msg.hops || 0) > 6) return; // TTL
        this._floodPacket(msg, (msg.hops || 0) + 1, fromNodeId); // relay onward
    }

    _sendReceipt(toNodeId, msgId, kind) {
        const wire = { type: 'gmn_dm_receipt', to: toNodeId, from: gmnIdentity.getNodeId(), msgId, kind, ts: Date.now() };
        this.seenMessages.add('rcpt|' + msgId + '|' + kind);
        this._floodPacket(wire, 0, null);
    }

    _onDmReceipt(msg, fromNodeId) {
        const key = 'rcpt|' + msg.msgId + '|' + msg.kind;
        if (this.seenMessages.has(key)) return;
        this.seenMessages.add(key); this._trimSeen();

        if (msg.to === gmnIdentity.getNodeId()) {
            if (msg.kind === 'delivered') gmnMessaging.markDelivered(msg.from, msg.msgId);
            try { messageBroker.publish('gmn.dm.receipt', { from: msg.from, msgId: msg.msgId, kind: msg.kind }); } catch {}
            return;
        }
        if ((msg.hops || 0) > 6) return;
        this._floodPacket(msg, (msg.hops || 0) + 1, fromNodeId);
    }

    /**
     * Batch 7c: turn a verified peer into a messageable contact.
     * The handshake carries the peer's SIGNING key (nodeId source) + encryption key;
     * we store {gmnNodeId, encPub} so Axis can seal directs to them.
     */
    _recordMessagingContact(signPubHex, encPubHex) {
        if (!signPubHex || !encPubHex) return; // pre-7c peer — no encryption key yet
        try {
            const gmnNodeId = deriveNodeIdFromPublicKeyHex(signPubHex);
            if (gmnNodeId) gmnMessaging.recordPeer(gmnNodeId, encPubHex);
        } catch { /* non-fatal — contact just won't be addressable */ }
    }

    /** The gmn nodeIds of currently-connected peers (derived from their signing keys). */
    connectedGmnIds() {
        const ids = new Set();
        for (const [, peer] of this.peers.entries()) {
            if (peer?.publicKey) {
                try { const id = deriveNodeIdFromPublicKeyHex(peer.publicKey); if (id) ids.add(id); } catch {}
            }
        }
        return ids;
    }

    // ── Batch 3: cross-node site fetch ─────────────────────────────────────────

    /** Ask the mesh for a site we don't host; resolves to a VERIFIED bundle or null. */
    requestSite(domain, { timeoutMs = 8000 } = {}) {
        return new Promise((resolve) => {
            const dom = String(domain || '').toLowerCase();
            const entry = gmnRegistry.get(dom);
            const reqId = crypto.randomUUID();
            const wire = JSON.stringify({ type: 'gmn_site_fetch', reqId, domain: dom });

            let sent = 0;
            for (const [, peer] of this.peers.entries()) {
                if (peer.socket?.readyState === WebSocket.OPEN) {
                    try { peer.socket.send(wire); sent++; } catch {}
                }
            }
            if (sent === 0) return resolve(null);

            const timer = setTimeout(() => { this._pendingFetches.delete(reqId); resolve(null); }, timeoutMs);
            this._pendingFetches.set(reqId, { resolve, timer, domain: dom, expectedHash: entry?.contentHash || null });
        });
    }

    /** A peer asked us for a site. Serve it only if WE host it and they aren't banned. */
    _serveSiteFetch(msg, fromNodeId) {
        const { reqId, domain } = msg || {};
        const peer = this.peers.get(fromNodeId);
        const reply = (payload) => {
            if (peer?.socket?.readyState === WebSocket.OPEN) {
                try { peer.socket.send(JSON.stringify({ type: 'gmn_site_fetch_reply', reqId, ...payload })); } catch {}
            }
        };
        if (bannedNodes.isBanned(fromNodeId)) return reply({ ok: false, reason: 'banned' });
        const dom = String(domain || '').toLowerCase();
        const site = dom.replace(/\.gmn$/, '');
        const entry = gmnRegistry.get(dom);
        try {
            // We can serve a site we ORIGINATE or one we hold as a verified pin.
            if (entry && entry.source === 'local') {
                return reply({ ok: true, bundle: this.siteService.exportBundle(entry.site || site) });
            }
            if (gmnPinStore.has(dom)) {
                return reply({ ok: true, bundle: gmnPinStore.exportBundle(site) });
            }
            return reply({ ok: false, reason: 'not_hosted' });
        } catch (e) {
            reply({ ok: false, reason: e.message });
        }
    }

    // ── Batch 4: replication / pinning ─────────────────────────────────────────

    /** Decide whether to pin an announced site to help keep it alive, then do it. */
    async _maybePin(announce) {
        if (!this.replicationEnabled || !announce?.domain) return;
        const domain = announce.domain;
        const myId = gmnIdentity.getNodeId();
        if (announce.originNodeId === myId) return;                  // our own site
        if (gmnPinStore.has(domain, announce.contentHash)) return;  // already current
        const entry = gmnRegistry.get(domain);
        if ((entry?.replicas?.length || 0) >= this.targetReplicas) return; // enough copies
        if (gmnPinStore.stats().pins >= gmnPinStore.maxPins) return;        // at capacity

        try {
            const bundle = await this.requestSite(domain);
            if (!bundle) return;
            if (announce.contentHash && bundle.contentHash !== announce.contentHash) return;
            gmnPinStore.pin(bundle);
            gmnRegistry.recordReplica(domain, bundle.contentHash, myId);
            this._broadcastReplica(buildReplicaAnnounce(domain, bundle.contentHash));
            this.log('info', `📌 Pinned replica of ${domain} — keeping it alive`);
        } catch (e) {
            this.log('warn', `Auto-pin ${domain} failed: ${e.message}`);
        }
    }

    _broadcastReplica(replica) {
        if (!replica?.domain) return;
        const id = crypto.createHash('sha256').update(`replica|${replica.domain}|${replica.replicaNodeId}|${replica.contentHash}`).digest('hex');
        if (this.seenMessages.has(id)) return;
        this.seenMessages.add(id);
        this._sendReplicaToPeers(replica, id, 0, null);
        this._trimSeen();
    }

    _sendReplicaToPeers(replica, id, hops, exceptNodeId) {
        const wire = JSON.stringify({ type: 'gmn_replica_announce', id, replica, hops });
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId === exceptNodeId) continue;
            if (peer.socket?.readyState === WebSocket.OPEN) { try { peer.socket.send(wire); } catch {} }
        }
    }

    _onReplicaAnnounce(msg, fromNodeId) {
        const { replica, id, hops = 0 } = msg || {};
        if (!replica || !id) return;
        if (this.seenMessages.has(id)) return;
        this.seenMessages.add(id);
        if (hops > 6) return;
        const verdict = verifyReplicaAnnounce(replica);
        if (!verdict.ok) { this._trimSeen(); return; }
        gmnRegistry.recordReplica(replica.domain, replica.contentHash, replica.replicaNodeId);
        this._sendReplicaToPeers(replica, id, hops + 1, fromNodeId);
        this._trimSeen();
    }

    // ── Batch 5: rendezvous / peer exchange ────────────────────────────────────

    _loadNetworkConfig() {
        const out = { publicAddress: process.env.GMN_PUBLIC_ADDRESS || null, bootstrap: [] };
        if (process.env.GMN_BOOTSTRAP) out.bootstrap = process.env.GMN_BOOTSTRAP.split(',').map(s => s.trim()).filter(Boolean);
        try {
            const cfg = JSON.parse(readFileSync(path.resolve(process.cwd(), 'config', 'gmn-network.json'), 'utf8'));
            if (!out.publicAddress && cfg.publicAddress) out.publicAddress = String(cfg.publicAddress);
            if (out.bootstrap.length === 0 && Array.isArray(cfg.bootstrap)) out.bootstrap = cfg.bootstrap.map(String);
        } catch { /* no network config — LAN/manual only */ }
        return out;
    }

    _selfAddresses() {
        return new Set([this.publicAddress, `localhost:${this.port}`, `127.0.0.1:${this.port}`].filter(Boolean));
    }

    /** Dial known-but-unconnected peers (up to the cap), then gossip our peerbook. */
    _maintainMesh() {
        const connectedNodeIds = new Set(this.peers.keys());
        const connectedAddresses = new Set(Array.from(this.peers.values()).map(p => p.address).filter(Boolean));
        const selfAddresses = this._selfAddresses();
        for (const addr of this.peerBook.dialTargets({ connectedNodeIds, connectedAddresses, selfAddresses })) {
            try { this.connectToPeer(addr); } catch {}
        }
        for (const [, peer] of this.peers.entries()) {
            if (peer.socket?.readyState === WebSocket.OPEN) this._sendPeerExchange(peer.socket);
        }
    }

    /** Hand a peer our reachable address + the addresses we know (PEX). */
    _sendPeerExchange(socket) {
        const peers = [];
        if (this.publicAddress) peers.push({ nodeId: gmnIdentity.getNodeId(), address: this.publicAddress });
        for (const entry of this.peerBook.list()) {
            if (entry.address && entry.address !== this.publicAddress) peers.push({ nodeId: entry.nodeId || null, address: entry.address });
        }
        if (!peers.length) return;
        try { socket.send(JSON.stringify({ type: 'gmn_peer_exchange', peers: peers.slice(0, 64) })); } catch {}
    }

    /** Learn dialable addresses from a peer; dialing happens on the next maintenance tick. */
    _onPeerExchange(msg) {
        const list = Array.isArray(msg?.peers) ? msg.peers : [];
        const self = this._selfAddresses();
        for (const p of list.slice(0, 64)) {
            if (!p?.address || self.has(p.address)) continue;
            this.peerBook.remember(p.address, { nodeId: p.nodeId || null, source: 'pex' });
        }
    }

    /** A peer answered our fetch. Verify the content hash before accepting it. */
    _onSiteFetchReply(msg) {
        const { reqId, ok, bundle } = msg || {};
        const pending = this._pendingFetches.get(reqId);
        if (!pending) return;
        if (!ok || !bundle) return; // wait for another peer or the timeout
        const verdict = this.siteService.verifyBundle(bundle);
        if (!verdict.ok) { this.log('warn', `Fetched ${pending.domain} failed verify: ${verdict.reason}`); return; }
        if (pending.expectedHash && bundle.contentHash !== pending.expectedHash) {
            this.log('warn', `Fetched ${pending.domain} hash != announced hash — ignoring`);
            return;
        }
        clearTimeout(pending.timer);
        this._pendingFetches.delete(reqId);
        pending.resolve(bundle);
    }

    // ── Batch 2: site-announce gossip ──────────────────────────────────────────

    _announceId(announce) {
        const k = `${announce.domain}|${announce.originNodeId}|${announce.rev}|${announce.contentHash}`;
        return crypto.createHash('sha256').update(k).digest('hex');
    }

    /** Outbound: a local publish/change → fan a signed announce to all peers. */
    _broadcastAnnounce(announce) {
        if (!announce?.domain || !announce?.contentHash) return;
        const id = this._announceId(announce);
        if (this.seenMessages.has(id)) return; // idempotent on (domain,rev,hash)
        this.seenMessages.add(id);
        this._sendAnnounceToPeers(announce, id, 0, null);
        this._trimSeen();
    }

    _sendAnnounceToPeers(announce, id, hops, exceptNodeId) {
        const wire = JSON.stringify({ type: 'gmn_site_announce', id, announce, hops });
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId === exceptNodeId) continue;
            if (peer.socket?.readyState === WebSocket.OPEN) {
                try { peer.socket.send(wire); } catch {}
            }
        }
    }

    /** Inbound: verify a peer's announce, record it, and re-propagate. */
    _onSiteAnnounce(msg, fromNodeId) {
        const { announce, id, hops = 0 } = msg || {};
        if (!announce || !id) return;
        if (this.seenMessages.has(id)) return; // loop prevention
        this.seenMessages.add(id);
        if (hops > 6) return; // TTL

        const verdict = verifySiteAnnounce(announce);
        if (!verdict.ok) {
            this.log('warn', `🚫 Rejected site announce (${verdict.reason}) from ${fromNodeId}`);
            this._trimSeen();
            return;
        }

        const result = gmnRegistry.applyRemoteAnnounce(announce);
        if (result.applied) {
            this.log('info', `🌐 Learned GMN site ${announce.domain} (rev ${announce.rev}) from ${announce.originNodeId}`);
            try { messageBroker.publish('gmn.registry.changed', { domain: announce.domain, source: 'remote' }); } catch {}
        }

        // Consider holding a replica so the site survives its origin going offline.
        this._maybePin(announce).catch(() => {});

        // Re-propagate outward (not back to the sender).
        this._sendAnnounceToPeers(announce, id, hops + 1, fromNodeId);
        this._trimSeen();
    }

    /** Catch-up: hand a freshly-connected peer all of our local site announces. */
    _sendLocalAnnounces(socket) {
        try {
            for (const entry of gmnRegistry.list()) {
                if (entry.source !== 'local' || !entry.contentHash) continue;
                const announce = buildSiteAnnounce(entry);
                const id = this._announceId(announce);
                this.seenMessages.add(id);
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'gmn_site_announce', id, announce, hops: 0 }));
                }
            }
        } catch (e) {
            this.log('warn', `Catch-up announce failed: ${e.message}`);
        }
    }

    _trimSeen() {
        if (this.seenMessages.size > 2000) {
            const it = this.seenMessages.values();
            for (let i = 0; i < 500; i++) this.seenMessages.delete(it.next().value);
        }
    }

    /** Connecting side of the mutual handshake (counterpart to _processHandshake). */
    _handleOutgoingHandshake(socket, data, address) {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg.type !== 'handshake_response') return;

        // The peer signed OUR challenge. Verify it before trusting them.
        const verified = this.handshake.verifyPeerSignature(socket.challengeSent, msg.signature, msg.publicKey);
        if (!verified) {
            this.log('error', `🚨 Outbound handshake verify FAILED for ${address}. Closing.`);
            return socket.close();
        }

        // Counter-sign their challenge so they can verify us too.
        socket.send(JSON.stringify({
            type: 'handshake_response',
            nodeId: this.name,
            address: this.nodeAddress,
            publicKey: this.handshake.getPublicKey(),
            encPub: gmnIdentity.getEncPublicKeyHex(),
            signature: this.handshake.signChallenge(msg.challenge),
        }));

        const nodeId = msg.nodeId;
        this.log('success', `✅ Verified outbound peer ${nodeId} (${address})`);
        this.trustedSynapses.add(nodeId);
        this.peers.set(nodeId, { socket, address, status: 'online', publicKey: msg.publicKey, encPub: msg.encPub || null, connectedAt: Date.now() });
        this._recordMessagingContact(msg.publicKey, msg.encPub);
        this._notifyPeerChanged();

        // Swap to the general peer message handler for everything after the handshake.
        socket.removeAllListeners('message');
        socket.on('message', (raw) => { try { this._handlePeerMessage(JSON.parse(raw), nodeId); } catch {} });
        socket.on('close', () => { this.peers.delete(nodeId); this._notifyPeerChanged(); });

        // Send our local site catalog so the peer's registry syncs immediately.
        this._sendLocalAnnounces(socket);
        // We dialed this address — bind the nodeId to it, and exchange peers.
        this.peerBook.remember(address, { nodeId });
        this._sendPeerExchange(socket);
    }

    /**
     * Send a typed message to all verified connected peers
     */
    sendToNetwork(type, data) {
        const msg = JSON.stringify({ type, data });
        for (const [, peer] of this.peers.entries()) {
            if (peer.socket?.readyState === WebSocket.OPEN) {
                try { peer.socket.send(msg); } catch {}
            }
        }
    }

    /**
     * Section 5.3: REAL Discovery Beacon (UDP Broadcast)
     */
    _startDiscoveryBeacon() {
        this.udpBeacon = dgram.createSocket('udp4');

        this.udpBeacon.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.type === 'gmn_beacon' && data.nodeId !== this.name) {
                    this.log('info', `🕵️ Discovery: Found node ${data.nodeId} at ${rinfo.address}:${data.port}`);
                    this.connectToPeer(`${rinfo.address}:${data.port}`);
                }
            } catch (e) {}
        });

        this.udpBeacon.on('error', (err) => {
            this.log('error', `UDP Beacon error: ${err.message}`);
            if (err.code === 'EADDRINUSE') {
                this.log('warn', `Discovery port ${this.discoveryPort} already in use. Discovery beacon disabled for this instance.`);
            }
        });

        try {
            this.udpBeacon.bind(this.discoveryPort, () => {
                this.udpBeacon.setBroadcast(true);
                this.log('info', `📡 GMN Discovery Beacon active on UDP port ${this.discoveryPort}`);

                // Periodically broadcast our presence
                setInterval(() => {
                    const beacon = Buffer.from(JSON.stringify({
                        type: 'gmn_beacon',
                        nodeId: this.name,
                        port: this.port
                    }));
                    this.udpBeacon.send(beacon, 0, beacon.length, this.discoveryPort, '255.255.255.255');
                }, 30000);
            });
        } catch (e) {
            this.log('error', `Failed to bind UDP Beacon: ${e.message}`);
        }
    }

    _notifyPeerChanged() {
        const peerList = [];
        for (const [id, peer] of this.peers.entries()) {
            peerList.push({
                id,
                address: peer.address,
                status: peer.status || 'online',
                connectedAt: peer.connectedAt || null,
                trusted: this.trustedSynapses.has(id)
            });
        }
        try {
            messageBroker.publish('gmn.peer.changed', { peers: peerList });
        } catch { /* non-fatal */ }
    }

    async onShutdown() {
        if (this._meshTimer) clearInterval(this._meshTimer);
        if (this.server) this.server.close();
        if (this.udpBeacon) this.udpBeacon.close();
        for (const peer of this.peers.values()) {
            peer.socket.close();
        }
    }
}

export default GMNConnectivityArbiter;
