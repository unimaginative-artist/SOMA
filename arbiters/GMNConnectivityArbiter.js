/**
 * GMNConnectivityArbiter.js
 *
 * THE NETWORK ADAPTER (Pillar of SOMA-Net)
 *
 * Manages peer-to-peer connections across the Graymatter Network.
 * Implements:
 * - Auto-discovery via Beacon protocol.
 * - Mutually authenticated, encrypted GMN v2 transport.
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
import DendriteSearchEngine from '../server/services/DendriteSearchEngine.js';
import { buildSiteAnnounce, verifySiteAnnounce, buildReplicaAnnounce, verifyReplicaAnnounce } from '../server/services/GMNAnnounce.js';
import GMNSiteService from '../server/services/GMNSiteService.js';
import gmnPinStore from '../server/services/GMNPinStore.js';
import gmnPeerBook from '../server/services/GMNPeerBook.js';
import gmnMessaging from '../server/services/GMNMessaging.js';
import gmnIdentity, { deriveNodeIdFromPublicKeyHex, gmnStableStringify } from '../server/services/GMNIdentity.js';
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
        this.identity = opts.identity || gmnIdentity;
        this.handshake = new GMNHandshakeEngine(this.name, this.identity);
        const requestedBind = opts.bindAddress || process.env.GMN_BIND_ADDRESS || '127.0.0.1';
        const isLoopbackBind = ['127.0.0.1', '::1', 'localhost'].includes(requestedBind);
        this.bindAddress = isLoopbackBind || process.env.GMN_PUBLIC_LISTEN === 'true'
            ? requestedBind
            : '127.0.0.1';
        this.maxMessageBytes = Number(opts.maxMessageBytes || process.env.GMN_MAX_MESSAGE_BYTES || 1024 * 1024);
        this.handshakeTimeoutMs = Number(opts.handshakeTimeoutMs || process.env.GMN_HANDSHAKE_TIMEOUT_MS || 10_000);
        this.maxConnectionsPerMinute = Number(opts.maxConnectionsPerMinute || process.env.GMN_CONNECTIONS_PER_MINUTE || 30);
        this.maxMessagesPerWindow = Number(opts.maxMessagesPerWindow || process.env.GMN_MESSAGES_PER_10S || 250);
        this._sessions = new WeakMap();
        this._connectionWindows = new Map();
        this._activeConnectionsByIp = new Map();
        this._handshakeReplayCache = new Map();
        this.discoveryEnabled = opts.discoveryEnabled ?? (process.env.GMN_DISCOVERY_ENABLED === 'true');
        this._discoveryTimer = null;
        
        // Peer Management
        this.peers = new Map(); // nodeId -> { socket, address, status, reputation, publicKey }
        this.trustedSynapses = new Set(); // Set of verified nodeIds
        this.seenMessages = new Set(); // Deduplication cache

        this.server = null;
        this.reconnectTimer = null;
        this.peersFile = path.resolve(process.cwd(), 'config', 'gmn-peers.json');

        // Batch 3: serve local site bundles to peers, and track in-flight fetches.
        this.siteService = new GMNSiteService();
        this.dendriteSearch = opts.dendriteSearch || new DendriteSearchEngine({
            legacyJsonPath: path.resolve(process.cwd(), 'data', 'aperture', 'portal-index.json')
        });
        this._ownsDendriteSearch = !opts.dendriteSearch;
        this._pendingFetches = new Map(); // reqId -> { resolve, timer, domain, expectedHash }
        this._pendingPeerSearches = new Map(); // reqId -> { resolve, results, timer }

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

        // LAN discovery is opt-in because UDP advertisements expand the attack
        // surface. When enabled, every beacon is identity-bound and signed.
        if (this.discoveryEnabled) this._startDiscoveryBeacon();

        // Section 3: Gossip Protocol Subscription
        messageBroker.subscribe('gmn.publication', (env) => this._gossipWisdom(env));
        messageBroker.subscribe('gmn.gossip', (env) => this._processGossip(env));

        // Batch 2: site-announce gossip — a local publish/change fans a signed
        // announce across the mesh so peers learn the site exists.
        messageBroker.subscribe('gmn.site.announce', (env) => this._broadcastAnnounce(env?.payload || env));

        // Batch 4: a manual pin (from the HTTP layer) fans a replica announce.
        messageBroker.subscribe('gmn.replica.announce', (env) => this._broadcastReplica(env?.payload || env));

        // Reconnect to saved peers (cross-internet manual connections)
        this._reconnectStartupTimer = setTimeout(() => this._reconnectSavedPeers(), 5000);
        this._reconnectStartupTimer.unref?.();

        // Batch 3: expose this transport so HTTP routes can request peer sites.
        globalThis.__gmnMesh = this;

        // Batch 5: dial bootstrap seeds, then keep the mesh assembled (dial + PEX).
        for (const addr of this.bootstrapAddresses) { try { this.connectToPeer(addr); } catch {} }
        this._meshStartupTimer = setTimeout(() => this._maintainMesh(), 8000);
        this._meshStartupTimer.unref?.();
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
                this._sendSecure(peer.socket, gossipMsg);
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
            this.server = new WebSocketServer({
                port: this.port,
                host: this.bindAddress,
                maxPayload: this.maxMessageBytes,
                perMessageDeflate: false,
                clientTracking: true
            });
            
            this.server.on('connection', (socket, req) => {
                const ip = req.socket.remoteAddress || 'unknown';
                if (!this._admitConnection(ip)) {
                    try { socket.close(4029, 'GMN connection rate exceeded'); } catch {}
                    return;
                }
                this._activeConnectionsByIp.set(ip, (this._activeConnectionsByIp.get(ip) || 0) + 1);
                socket.once('close', () => {
                    const next = Math.max(0, (this._activeConnectionsByIp.get(ip) || 1) - 1);
                    if (next) this._activeConnectionsByIp.set(ip, next);
                    else this._activeConnectionsByIp.delete(ip);
                });
                this.log('info', `Incoming GMN connection from ${ip}`);
                this._handleIncomingConnection(socket, req);
            });

            this.server.on('error', (err) => {
                this.log('error', `GMN Peer Server error: ${err.message}`);
                if (err.code === 'EADDRINUSE') {
                    this.log('warn', `Port ${this.port} already in use. GMN Peer Server will be disabled for this instance.`);
                }
            });

            console.log(`[${this.name}] 📡 GMN Peer Server listening on ${this.bindAddress}:${this.port}`);
        } catch (e) {
            this.log('error', `Failed to start GMN Peer Server: ${e.message}`);
        }
    }

    _admitConnection(ip) {
        const now = Date.now();
        if (this._connectionWindows.size > 10_000) {
            for (const [key, value] of this._connectionWindows) {
                if (now - value.startedAt >= 60_000) this._connectionWindows.delete(key);
            }
        }
        const previous = this._connectionWindows.get(ip);
        const window = !previous || now - previous.startedAt >= 60_000
            ? { startedAt: now, count: 0 }
            : previous;
        window.count += 1;
        this._connectionWindows.set(ip, window);
        const maxActive = Number(process.env.GMN_MAX_CONNECTIONS_PER_IP || 8);
        return window.count <= this.maxConnectionsPerMinute
            && (this._activeConnectionsByIp.get(ip) || 0) < maxActive;
    }

    _rememberHandshake(message) {
        const now = Date.now();
        for (const [key, at] of this._handshakeReplayCache) {
            if (now - at > 60_000) this._handshakeReplayCache.delete(key);
        }
        const fingerprint = crypto.createHash('sha256')
            .update(`${message.nodeId}|${message.challenge}|${message.signature}`)
            .digest('hex');
        if (this._handshakeReplayCache.has(fingerprint)) return false;
        this._handshakeReplayCache.set(fingerprint, now);
        return true;
    }

    _securityReject(socket, fingerprint, reason) {
        this.log('warn', `GMN security rejection (${fingerprint}): ${reason}`);
        const senturian = messageBroker.getArbiter('IdolSenturian')?.instance;
        if (senturian) return senturian.applyAmberPressure(socket, fingerprint);
        try { socket.close(4003, String(reason || 'GMN security rejection').slice(0, 120)); } catch {}
    }

    /**
     * Handle incoming peer handshake
     */
    async _handleIncomingConnection(socket, req) {
        const remoteIP = req.socket.remoteAddress || 'unknown';
        socket._gmnHandshakeTimer = setTimeout(() => {
            this._securityReject(socket, remoteIP, 'handshake_timeout');
        }, this.handshakeTimeoutMs);
        socket._gmnHandshakeTimer.unref?.();
        
        // 1. Blacklist Check
        const trustEngine = messageBroker.getArbiter('TrustRegistry')?.instance;
        if (trustEngine && trustEngine.getScore(remoteIP) < 0.2) {
            return this._securityReject(socket, remoteIP, 'ip_trust_below_threshold');
        }

        const preAuthHandler = async (data) => {
            try {
                const msg = JSON.parse(data);
                const verdict = this.handshake.verifyInit(msg);
                if (!verdict.ok) throw new Error(verdict.reason);
                if (!this._rememberHandshake(msg)) throw new Error('handshake_replay');
                if (bannedNodes.isBanned(verdict.nodeId) || bannedNodes.isBanned(msg.publicKey)) throw new Error('node_banned');
                if (trustEngine && trustEngine.getScore(verdict.nodeId) < 0.2) throw new Error('node_trust_below_threshold');

                // The pre-auth listener must be removed before the final stage.
                // Leaving it attached caused valid post-handshake records to be
                // interpreted as protocol violations by the old implementation.
                socket.removeListener('message', preAuthHandler);
                await this._processHandshake(socket, msg, remoteIP);
            } catch (e) {
                this.log('error', `Handshake parse error from ${remoteIP}: ${e.message}`);
                this._securityReject(socket, remoteIP, e.message);
            }
        };
        socket.on('message', preAuthHandler);
    }

    /**
     * Initiate connection to a new peer
     */
    async connectToPeer(address) {
        const target = this._normalizePeerAddress(address);
        if (!target) {
            this.log('warn', `Rejected malformed GMN peer address: ${String(address).slice(0, 120)}`);
            return false;
        }
        // Prevent connecting to self or existing peers
        if ([`localhost:${this.port}`, `127.0.0.1:${this.port}`, `[::1]:${this.port}`].includes(target.host)) return false;
        if ([...this.peers.values()].some(peer => peer.address === target.host)) return false;
        if (this.peers.size >= this.maxPeers) return false;

        this.log('info', `Attempting to connect to GMN Node: ${target.host}`);
        
        try {
            const socket = new WebSocket(target.url, {
                maxPayload: this.maxMessageBytes,
                perMessageDeflate: false,
                handshakeTimeout: this.handshakeTimeoutMs
            });
            socket._gmnHandshakeTimer = setTimeout(() => {
                this._securityReject(socket, target.host, 'handshake_timeout');
            }, this.handshakeTimeoutMs);
            socket._gmnHandshakeTimer.unref?.();

            socket.on('open', () => {
                this._sendHandshakeInit(socket);
            });

            // Connecting side of the mutual handshake: the peer replies to our
            // handshake_init with a handshake_response (their signature over our
            // challenge + their own challenge). We verify, counter-sign, and finalize.
            const outgoingHandler = (data) => this._handleOutgoingHandshake(socket, data, target.host, outgoingHandler);
            socket.on('message', outgoingHandler);

            socket.on('error', (err) => {
                this.log('error', `Failed to connect to ${target.host}: ${err.message}`);
            });
            return true;
        } catch (e) {
            this.log('error', `Socket error for ${target.host}: ${e.message}`);
            return false;
        }
    }

    _normalizePeerAddress(address) {
        try {
            const raw = String(address || '').trim();
            if (!raw || raw.length > 300 || /[\s@]/.test(raw)) return null;
            const url = new URL(/^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`);
            if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) return null;
            if (!url.port || url.pathname !== '/' || url.search || url.hash) return null;
            if (['0.0.0.0', '::', '[::]', '169.254.169.254'].includes(url.hostname)) return null;
            return { url: url.toString(), host: url.host };
        } catch { return null; }
    }

    /**
     * STAGE 1: Send Handshake Initialization
     */
    _sendHandshakeInit(socket) {
        socket._gmnInit = this.handshake.createInit({ address: this.nodeAddress, port: this.port });
        socket.send(JSON.stringify(socket._gmnInit));
    }

    /**
     * STAGE 2: Process Handshake Response & Verification
     */
    async _processHandshake(socket, initMessage, remoteIP) {
        const response = this.handshake.createResponse(initMessage, { address: this.nodeAddress });
        socket.send(JSON.stringify(response));

        const finalHandler = (data) => {
            try {
                const finalMessage = JSON.parse(data);
                const verdict = this.handshake.verifyFinal(initMessage, response, finalMessage);
                if (!verdict.ok) throw new Error(verdict.reason);
                socket.removeListener('message', finalHandler);
                const keys = this.handshake.deriveSessionKeys({
                    peerEncPublicKeyHex: initMessage.encPub,
                    initiatorChallenge: initMessage.challenge,
                    responderChallenge: response.challenge,
                    initiatorNodeId: initMessage.nodeId,
                    responderNodeId: response.nodeId,
                    isInitiator: false
                });
                this._establishSecurePeer(socket, {
                    nodeId: initMessage.nodeId,
                    address: initMessage.address || remoteIP,
                    publicKey: initMessage.publicKey,
                    encPub: initMessage.encPub,
                    keys
                });
            } catch (error) {
                this._securityReject(socket, remoteIP, error.message);
            }
        };
        socket.on('message', finalHandler);
    }

    _establishSecurePeer(socket, { nodeId, address, publicKey, encPub, keys }) {
        clearTimeout(socket._gmnHandshakeTimer);
        const existing = this.peers.get(nodeId);
        if (existing?.socket && existing.socket !== socket) {
            try { existing.socket.close(4009, 'Superseded GMN session'); } catch {}
        }
        const session = {
            ...keys,
            txSequence: 0,
            rxSequence: 0,
            messageWindowStartedAt: Date.now(),
            messageCount: 0,
            nodeId
        };
        this._sessions.set(socket, session);
        this.trustedSynapses.add(nodeId);
        this.peers.set(nodeId, { socket, address, status: 'online', publicKey, encPub, connectedAt: Date.now(), encrypted: true });
        this._recordMessagingContact(publicKey, encPub);
        this._notifyPeerChanged();
        this.log('success', `✅ GMN v2 authenticated + encrypted peer ${nodeId}`);

        socket.on('message', (raw) => this._receiveSecureRecord(socket, raw, nodeId));
        socket.on('close', () => {
            if (this.peers.get(nodeId)?.socket === socket) this.peers.delete(nodeId);
            this._sessions.delete(socket);
            this._notifyPeerChanged();
        });

        this._sendLocalAnnounces(socket);
        this._sendPeerExchange(socket);
        this._sendRecentSearchIndex(socket);
    }

    _receiveSecureRecord(socket, raw, nodeId) {
        const session = this._sessions.get(socket);
        if (!session) return this._securityReject(socket, nodeId, 'missing_secure_session');
        const now = Date.now();
        if (now - session.messageWindowStartedAt >= 10_000) {
            session.messageWindowStartedAt = now;
            session.messageCount = 0;
        }
        session.messageCount += 1;
        if (session.messageCount > this.maxMessagesPerWindow) {
            return this._securityReject(socket, nodeId, 'message_rate_exceeded');
        }
        try {
            const record = JSON.parse(raw);
            const opened = this.handshake.decryptRecord(record, session.rxKey, session.rxSequence);
            session.rxSequence = opened.sequence;
            this._handlePeerMessage(opened.payload, nodeId);
        } catch (error) {
            const trust = messageBroker.getArbiter('TrustRegistry')?.instance;
            trust?.slash?.(nodeId, 0.1, `Invalid encrypted GMN record: ${error.message}`);
            this._securityReject(socket, nodeId, error.message);
        }
    }

    _sendSecure(socket, payload) {
        const session = this._sessions.get(socket);
        if (!session || socket?.readyState !== WebSocket.OPEN) return false;
        try {
            const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
            session.txSequence += 1;
            socket.send(JSON.stringify(this.handshake.encryptRecord(value, session.txKey, session.txSequence)));
            return true;
        } catch (error) {
            this.log('warn', `Secure GMN send failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Handle a general message from a verified peer
     */
    _handlePeerMessage(msg, fromNodeId) {
        const schema = this._validatePeerMessage(msg);
        if (!schema.ok) {
            messageBroker.getArbiter('TrustRegistry')?.instance?.slash?.(fromNodeId, 0.02, `Invalid GMN message: ${schema.reason}`);
            return;
        }

        if (msg.type === 'thirdplace.position') {
            // Relay to local clients via messageBroker
            try { messageBroker.publish('gmn.relay.thirdplace.position', msg.data); } catch {}
            return;
        }

        if (msg.type === 'gmn_gossip') {
            this._processGossip(msg).catch(() => {});
            return;
        }

        if (msg.type === 'gmn_search_gossip') {
            this._onSearchGossip(msg, fromNodeId).catch(() => {});
            return;
        }

        if (msg.type === 'gmn_search_index_sync') {
            this._onSearchIndexSync(msg, fromNodeId).catch(() => {});
            return;
        }

        if (msg.type === 'gmn_search_query') {
            this._onSearchQuery(msg, fromNodeId);
            return;
        }

        if (msg.type === 'gmn_search_query_reply') {
            this._onSearchQueryReply(msg);
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

    _validatePeerMessage(msg) {
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, reason: 'message_not_object' };
        if (typeof msg.type !== 'string' || msg.type.length > 64) return { ok: false, reason: 'invalid_type' };
        const allowed = new Set([
            'thirdplace.position', 'gmn_gossip', 'gmn_search_gossip',
            'gmn_search_index_sync', 'gmn_search_query', 'gmn_search_query_reply',
            'gmn_site_announce', 'gmn_replica_announce', 'gmn_site_fetch',
            'gmn_site_fetch_reply', 'gmn_peer_exchange', 'gmn_dm', 'gmn_dm_receipt'
        ]);
        if (!allowed.has(msg.type)) return { ok: false, reason: 'unknown_type' };
        if (msg.type === 'gmn_peer_exchange' && (!Array.isArray(msg.peers) || msg.peers.length > 64)) return { ok: false, reason: 'invalid_peer_exchange' };
        if (msg.type === 'gmn_search_index_sync' && (!Array.isArray(msg.pages) || msg.pages.length > 50)) return { ok: false, reason: 'invalid_search_sync' };
        if (msg.type === 'gmn_search_query_reply' && (!Array.isArray(msg.results) || msg.results.length > 50)) return { ok: false, reason: 'invalid_search_reply' };
        if (msg.type === 'gmn_search_query' && (typeof msg.q !== 'string' || msg.q.length > 500)) return { ok: false, reason: 'invalid_search_query' };
        if (msg.type === 'gmn_gossip' && (!Number.isInteger(Number(msg.hops)) || Number(msg.hops) < 0 || Number(msg.hops) > 6)) return { ok: false, reason: 'invalid_gossip_ttl' };
        return { ok: true };
    }

    // ── Batch 7b: ephemeral E2E direct messages over the mesh ──────────────────
    // Messages flood toward the addressed node (cleartext `to` for routing; the body
    // is sealed so only the recipient reads it). Each node dedups + relays; the
    // recipient stores it and sends a signed delivery receipt back.

    _floodPacket(wire, hops, exceptNodeId) {
        const packet = JSON.stringify({ ...wire, hops });
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId === exceptNodeId) continue;
            if (peer.socket?.readyState === WebSocket.OPEN) this._sendSecure(peer.socket, packet);
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
            else if (msg.kind === 'read') gmnMessaging.markRead(msg.from, msg.msgId);
            else if (msg.kind === 'screenshot') gmnMessaging.markScreenshot(msg.from, msg.msgId);
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
                    if (this._sendSecure(peer.socket, wire)) sent++;
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
                this._sendSecure(peer.socket, { type: 'gmn_site_fetch_reply', reqId, ...payload });
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
            if (peer.socket?.readyState === WebSocket.OPEN) this._sendSecure(peer.socket, wire);
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
        this._sendSecure(socket, { type: 'gmn_peer_exchange', peers: peers.slice(0, 64) });
    }

    _sendRecentSearchIndex(socket) {
        try {
            // Query the SQLite database for the latest 50 pages indexed by this node, excluding peers
            const rows = this.dendriteSearch.db.prepare(`
                SELECT url, title, content, hash, source
                FROM dendrite_pages
                WHERE archive_status != 'deleted' AND source != 'gmn:peer'
                ORDER BY indexed_at DESC
                LIMIT 50
            `).all();

            if (rows.length > 0) {
                const pages = rows.map(r => ({
                    url: r.url,
                    title: r.title,
                    contentSnippet: r.content ? r.content.substring(0, 1000) : '',
                    hash: r.hash,
                    source: r.source
                }));
                this._sendSecure(socket, {
                    type: 'gmn_search_index_sync',
                    pages
                });
                this.log('info', `📤 Sent search index sync (${pages.length} pages) to peer`);
            }
        } catch (err) {
            this.log('warn', `Failed to send recent search index sync: ${err.message}`);
        }
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

    // -- GMN Search Gossip Protocol --
    _searchGossipId(page) {
        const k = `search|${page.url}|${page.hash || ''}`;
        return crypto.createHash('sha256').update(k).digest('hex');
    }

    broadcastSearchGossip(page) {
        if (!page?.url) return;
        const id = this._searchGossipId(page);
        if (this.seenMessages.has(id)) return;
        this.seenMessages.add(id);
        this._sendSearchGossipToPeers(page, id, 0, null);
        this._trimSeen();
    }

    _sendSearchGossipToPeers(page, id, hops, exceptNodeId) {
        const wire = JSON.stringify({ type: 'gmn_search_gossip', id, page, hops });
        for (const [peerId, peer] of this.peers.entries()) {
            if (peerId === exceptNodeId) continue;
            if (peer.socket?.readyState === WebSocket.OPEN) {
                this._sendSecure(peer.socket, wire);
            }
        }
    }

    async _onSearchGossip(msg, fromNodeId) {
        const { page, id, hops = 0 } = msg || {};
        if (!page || !id) return;
        if (this.seenMessages.has(id)) return;
        this.seenMessages.add(id);
        if (hops > 6) return; // TTL

        try {
            // Format for SOMA local index database
            this.dendriteSearch.indexPage({
                url: page.url,
                title: page.title,
                content: page.contentSnippet || '',
                source: page.source === 'gmn:site' ? 'gmn:site' : 'gmn:peer',
                hash: page.hash || '',
                metadata: { gossipedFrom: fromNodeId, hops }
            });
            this.log('info', `📥 Indexed gossiped search item: ${page.url} from ${fromNodeId}`);
        } catch (err) {
            console.error('[GMNConnectivityArbiter] Search Gossip Indexing failed:', err);
            this.log('warn', `Failed to index gossiped page: ${err.message}`);
        }

        // Re-propagate to peers
        this._sendSearchGossipToPeers(page, id, hops + 1, fromNodeId);
        this._trimSeen();
    }

    async _onSearchIndexSync(msg, fromNodeId) {
        const { pages } = msg || {};
        if (!Array.isArray(pages)) return;
        this.log('info', `📥 Received search index sync from peer ${fromNodeId} (${pages.length} pages)`);

        try {
            let count = 0;
            for (const page of pages) {
                if (!page.url) continue;
                // Avoid self-loop/duplication if we already have it
                const existing = this.dendriteSearch.db.prepare('SELECT id FROM dendrite_pages WHERE url = ?').get(page.url);
                if (existing) continue;

                this.dendriteSearch.indexPage({
                    url: page.url,
                    title: page.title,
                    content: page.contentSnippet || '',
                    source: 'gmn:peer',
                    hash: page.hash || '',
                    metadata: { syncedFrom: fromNodeId, syncedAt: new Date().toISOString() }
                });
                count++;
            }
            if (count > 0) {
                this.log('success', `✅ Synced and indexed ${count} search pages from ${fromNodeId}`);
            }
        } catch (err) {
            console.error('[GMNConnectivityArbiter] Search Index Sync processing failed:', err);
            this.log('warn', `Failed to process search index sync: ${err.message}`);
        }
    }

    // -- GMN Real-Time Peer Search Protocol --
    queryPeersForSearch(queryText, timeoutMs = 1500) {
        return new Promise((resolve) => {
            const reqId = crypto.randomUUID();
            const results = [];

            const timer = setTimeout(() => {
                const pending = this._pendingPeerSearches.get(reqId);
                if (pending) {
                    this._pendingPeerSearches.delete(reqId);
                    resolve(pending.results);
                }
            }, timeoutMs);

            this._pendingPeerSearches.set(reqId, { resolve, results, timer });

            // Broadcast the search query to all connected GMN peers
            const wire = JSON.stringify({
                type: 'gmn_search_query',
                reqId,
                q: queryText,
                senderId: gmnIdentity.getNodeId()
            });

            for (const [peerId, peer] of this.peers.entries()) {
                if (peer.socket?.readyState === WebSocket.OPEN) {
                    this._sendSecure(peer.socket, wire);
                }
            }
        });
    }

    _onSearchQuery(msg, fromNodeId) {
        const { reqId, q } = msg || {};
        if (!reqId || !q) return;

        try {
            // Query local database for matching pages
            const localHits = this.dendriteSearch.search(q, 10);

            const results = localHits.map(hit => ({
                url: hit.url,
                title: hit.title,
                snippet: hit.snippet || hit.contentSnippet || '',
                source: 'gmn:peer_realtime'
            }));

            const peer = this.peers.get(fromNodeId);
            if (peer && peer.socket?.readyState === WebSocket.OPEN) {
                this._sendSecure(peer.socket, {
                    type: 'gmn_search_query_reply',
                    reqId,
                    results
                });
            }
        } catch (err) {
            console.error('[GMNConnectivityArbiter] Search Query handler failed:', err);
        }
    }

    _onSearchQueryReply(msg) {
        const { reqId, results } = msg || {};
        if (!reqId || !Array.isArray(results)) return;

        const pending = this._pendingPeerSearches.get(reqId);
        if (pending) {
            // Merge results from this peer
            for (const item of results) {
                // Deduplicate URLs
                if (!pending.results.some(r => r.url.toLowerCase() === item.url.toLowerCase())) {
                    pending.results.push(item);
                }
            }
        }
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
                this._sendSecure(peer.socket, wire);
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
                    this._sendSecure(socket, { type: 'gmn_site_announce', id, announce, hops: 0 });
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
    _handleOutgoingHandshake(socket, data, address, outgoingHandler) {
        let msg;
        try {
            msg = JSON.parse(data);
            const initMessage = socket._gmnInit;
            const verdict = this.handshake.verifyResponse(initMessage, msg);
            if (!verdict.ok) throw new Error(verdict.reason);
            if (!this._rememberHandshake(msg)) throw new Error('handshake_replay');
            if (bannedNodes.isBanned(verdict.nodeId) || bannedNodes.isBanned(msg.publicKey)) throw new Error('node_banned');
            const trust = messageBroker.getArbiter('TrustRegistry')?.instance;
            if (trust && trust.getScore(verdict.nodeId) < 0.2) throw new Error('node_trust_below_threshold');

            socket.removeListener('message', outgoingHandler);
            const finalMessage = this.handshake.createFinal(msg);
            socket.send(JSON.stringify(finalMessage));
            const keys = this.handshake.deriveSessionKeys({
                peerEncPublicKeyHex: msg.encPub,
                initiatorChallenge: initMessage.challenge,
                responderChallenge: msg.challenge,
                initiatorNodeId: initMessage.nodeId,
                responderNodeId: msg.nodeId,
                isInitiator: true
            });
            this._establishSecurePeer(socket, {
                nodeId: msg.nodeId,
                address,
                publicKey: msg.publicKey,
                encPub: msg.encPub,
                keys
            });
            this.peerBook.remember(address, { nodeId: msg.nodeId });
        } catch (error) {
            this.log('error', `🚨 Outbound handshake failed for ${address}: ${error.message}`);
            this._securityReject(socket, address, error.message);
        }
    }

    /**
     * Send a typed message to all verified connected peers
     */
    sendToNetwork(type, data) {
        const msg = JSON.stringify({ type, data });
        for (const [, peer] of this.peers.entries()) {
            if (peer.socket?.readyState === WebSocket.OPEN) {
                this._sendSecure(peer.socket, msg);
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
                const claimed = deriveNodeIdFromPublicKeyHex(data.publicKey);
                const signed = { ...data };
                delete signed.signature;
                const recent = Math.abs(Date.now() - Number(data.timestamp || 0)) <= 30_000;
                const valid = data.type === 'gmn_beacon_v2'
                    && claimed === data.nodeId
                    && recent
                    && this.identity.verify(data.publicKey, Buffer.from(gmnStableStringify(signed), 'utf8'), data.signature);
                if (valid && data.nodeId !== this.identity.getNodeId()) {
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
                this._discoveryTimer = setInterval(() => {
                    const body = {
                        type: 'gmn_beacon_v2',
                        nodeId: this.identity.getNodeId(),
                        publicKey: this.identity.getPublicKeyHex(),
                        port: this.port,
                        timestamp: Date.now()
                    };
                    const beacon = Buffer.from(JSON.stringify({
                        ...body,
                        signature: this.identity.sign(Buffer.from(gmnStableStringify(body), 'utf8'))
                    }));
                    this.udpBeacon.send(beacon, 0, beacon.length, this.discoveryPort, '255.255.255.255');
                }, 30000);
                this._discoveryTimer.unref?.();
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

    getSecurityStatus() {
        const guardianNames = ['TrustRegistry', 'IdolSenturian', 'LocalThalamus', 'GMN-TrustEngine', 'SecurityCouncilArbiter', 'ImmuneCortex'];
        return {
            protocol: 'gmn/2',
            authenticated: 'ed25519',
            keyAgreement: 'x25519-hkdf-sha256',
            recordProtection: 'aes-256-gcm',
            bindAddress: this.bindAddress,
            publicListenExplicitlyEnabled: process.env.GMN_PUBLIC_LISTEN === 'true',
            discoveryEnabled: this.discoveryEnabled,
            limits: {
                maxPayloadBytes: this.maxMessageBytes,
                handshakeTimeoutMs: this.handshakeTimeoutMs,
                connectionsPerMinute: this.maxConnectionsPerMinute,
                messagesPer10Seconds: this.maxMessagesPerWindow,
                maxPeers: this.maxPeers
            },
            securePeers: [...this.peers.values()].filter(peer => peer.encrypted).length,
            guardians: Object.fromEntries(guardianNames.map(name => [name, !!messageBroker.getArbiter(name)?.instance]))
        };
    }

    async onShutdown() {
        if (this._meshTimer) clearInterval(this._meshTimer);
        if (this._discoveryTimer) clearInterval(this._discoveryTimer);
        if (this._reconnectStartupTimer) clearTimeout(this._reconnectStartupTimer);
        if (this._meshStartupTimer) clearTimeout(this._meshStartupTimer);
        for (const peer of this.peers.values()) {
            try { peer.socket.terminate?.(); } catch {}
        }
        this.peers.clear();
        if (this.server) {
            await new Promise(resolve => {
                try { this.server.close(() => resolve()); }
                catch { resolve(); }
            });
        }
        if (this.udpBeacon) {
            try { this.udpBeacon.close(); } catch {}
        }
        if (this._ownsDendriteSearch) {
            try { this.dendriteSearch?.db?.close?.(); } catch {}
        }
        await super.shutdown();
    }
}

export default GMNConnectivityArbiter;
