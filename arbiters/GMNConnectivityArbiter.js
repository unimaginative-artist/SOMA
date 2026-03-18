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

        // Reconnect to saved peers (cross-internet manual connections)
        setTimeout(() => this._reconnectSavedPeers(), 5000);

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
                    this.peers.set(nodeId, { socket, address, status: 'online', publicKey: nextMsg.publicKey, connectedAt: Date.now() });
                    this._notifyPeerChanged();

                    // Cleanup this listener
                    socket.removeListener('message', responseHandler);

                    socket.on('close', () => {
                        this.log('warn', `Node ${nodeId} disconnected.`);
                        this.peers.delete(nodeId);
                        this._notifyPeerChanged();
                    });
                } else {
                    this.log('error', `🚨 Verification FAILED for node ${nodeId}. Closing connection.`);
                    socket.close();
                }
            }
        };

        socket.on('message', responseHandler);
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
        if (this.server) this.server.close();
        if (this.udpBeacon) this.udpBeacon.close();
        for (const peer of this.peers.values()) {
            peer.socket.close();
        }
    }
}

export default GMNConnectivityArbiter;
