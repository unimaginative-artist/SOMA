import { SelfRepairArbiter } from "../arbiters/SelfRepairArbiter.js";
import EventEmitter from "events";

class MockToolRegistry {
    getTool(name) {
        if (name === "request_self_restart") {
            return {
                execute: async (args) => {
                    console.log("✅ SUCCESS: request_self_restart tool was executed with args:", args);
                    return "Mock restart initiated";
                }
            };
        }
        return null;
    }
}

class MockMessageBroker extends EventEmitter {
    subscribeByLobe(lobe, event, callback) {
        console.log(`Subscribed to ${event} on lobe ${lobe}`);
        this.on(event, callback);
    }
}

async function runTest() {
    console.log("Initializing SelfRepairArbiter test...");
    const broker = new MockMessageBroker();
    const registry = new MockToolRegistry();

    const arbiter = new SelfRepairArbiter();
    await arbiter.initialize({
        messageBroker: broker,
        toolRegistry: registry
    });

    console.log("Simulating a completed self-repair engineering goal...");
    broker.emit("soma.goal.completed", {
        payload: {
            goal: {
                title: "Fix random typo in README",
                category: "engineering",
                metadata: {
                    self_repair: true
                }
            }
        }
    });

    await new Promise(resolve => setTimeout(resolve, 500));
    console.log("Test complete.");
}

runTest().catch(console.error);
