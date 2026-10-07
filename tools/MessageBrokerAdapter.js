// MessageBrokerAdapter.js
// Bridges ToolRegistry ↔ MessageBroker arbiters

const { MessageBroker } = require('../core/MessageBroker.cjs');

class MessageBrokerAdapter {
    constructor() {
        this.name = 'messageBroker';
        this.description = 'Route tool calls to SOMA arbiters via MessageBroker';
        this.broker = null;
        this.actions = {
            // Generic RPC call to any arbiter
            call: async (params) => {
                const { arbiter, method, args = [] } = params;
                if (!arbiter || !method) {
                    throw new Error('Missing arbiter or method');
                }
                
                const topic = `arbiter.${arbiter}.${method}`;
                try {
                    const response = await this.broker.request(topic, { args }, 10000);
                    return { success: true, data: response };
                } catch (err) {
                    return { success: false, error: err.message };
                }
            },
            
            // Direct tool mapping: file:read → EngineeringSwarmArbiter.handleFileRead
            file_read: async (params) => {
                return await this.actions.call({
                    arbiter: 'engineering-swarm',
                    method: 'handleFileRead',
                    args: [params]
                });
            },
            
            file_write: async (params) => {
                return await this.actions.call({
                    arbiter: 'engineering-swarm',
                    method: 'handleFileWrite',
                    args: [params]
                });
            },
            
            shell_run: async (params) => {
                return await this.actions.call({
                    arbiter: 'engineering-swarm',
                    method: 'handleShellRun',
                    args: [params]
                });
            },
            
            // Add more mappings as needed
        };
    }
    
    async initialize() {
        this.broker = new MessageBroker();
        await this.broker.initialize();
        console.log('[MessageBrokerAdapter] Initialized');
    }
}

module.exports = MessageBrokerAdapter;