/**
 * loaders/plugins.js - PRODUCTION READY
 */

import { MoltbookArbiter } from '../../arbiters/MoltbookArbiter.js';
import FinanceAgentArbiter from '../../arbiters/FinanceAgentArbiter.js';
import EngineeringSwarmArbiter from '../../arbiters/EngineeringSwarmArbiter.js';
import { XArbiter } from '../../arbiters/XArbiter.js';
import { GMNConnectivityArbiter } from '../../arbiters/GMNConnectivityArbiter.js';
import { CONFIG } from '../../core/SomaConfig.js';

export async function loadPlugins(systemContext = {}) {
    console.log('\n[Loader] 🔌 Initializing Production Plugins...');

    const { messageBroker, securityCouncil, quadBrain } = systemContext;
    const plugins = {};

    // 0. GMN (The Gray Matter Network) - MUST LOAD EARLY FOR SYNC
    const gmn = new GMNConnectivityArbiter({
        name: 'GMN-Connectivity-Main',
        port: CONFIG.clusterPort || 7777,
        messageBroker,
        lobe: 'EXTERNAL',
        classification: 'NETWORK',
        tags: ['p2p', 'sync', 'gossip']
    });
    gmn.initialize().then(() => {
        console.log('      ✅ GMN Connectivity active (512-bit P2P)');
    }).catch(e => console.warn('      ⚠️ GMN init warning:', e.message));
    plugins.gmnConnectivity = gmn;

    // 1. Moltbook (Social Network)
    const moltbookArbiter = new MoltbookArbiter({ 
        name: 'MoltbookArbiter-Main', 
        messageBroker, 
        securityCouncil,
        lobe: 'EXTERNAL',
        classification: 'SOCIAL',
        tags: ['posting', 'monitoring', 'threat-detection']
    });
    // Non-blocking init
    moltbookArbiter.initialize().then(() => {
        console.log('      ✅ MoltbookArbiter active');
    }).catch(e => console.warn('      ⚠️ Moltbook init warning:', e.message));
    plugins.moltbookArbiter = moltbookArbiter;

    // 1.5 X (Twitter)
    const xArbiter = new XArbiter({
        name: 'XArbiter-Main',
        messageBroker,
        securityCouncil,
        quadBrain,
        lobe: 'EXTERNAL',
        classification: 'SOCIAL',
        tags: ['twitter', 'posting', 'mentions']
    });
    xArbiter.initialize().then(() => {
        console.log('      ✅ XArbiter active');
    }).catch(e => console.warn('      ⚠️ XArbiter init warning:', e.message));
    plugins.xArbiter = xArbiter;

    // 2. Finance System
    const financeAgent = new FinanceAgentArbiter({
        name: 'FinanceAgent-Main',
        messageBroker,
        lobe: 'EXECUTIVE',
        classification: 'FINANCE',
        tags: ['trading', 'analysis', 'portfolio']
    });
    financeAgent.initialize().then(() => {
        console.log('      ✅ Finance Module active');
    }).catch(e => console.warn('      ⚠️ Finance init warning:', e.message));
    plugins.finance = financeAgent;

    // 3. Engineering Swarm
    const engineeringSwarm = new EngineeringSwarmArbiter({
        name: 'EngineeringSwarm-Main',
        messageBroker,
        lobe: 'EXECUTIVE',
        classification: 'ENGINEERING',
        tags: ['coding', 'optimization', 'review']
    });
    engineeringSwarm.initialize().then(() => {
        console.log('      ✅ Engineering Swarm active');
    }).catch(e => console.warn('      ⚠️ Engineering Swarm init warning:', e.message));
    plugins.engineeringSwarm = engineeringSwarm;

    return plugins;
}