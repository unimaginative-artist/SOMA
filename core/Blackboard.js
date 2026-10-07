/**
 * core/Blackboard.js
 * 
 * Shared state for MAX Swarm coordination.
 * Allows workers to post insights, risks, and targets in real-time.
 */

import { EventEmitter } from 'events';

class Blackboard extends EventEmitter {
    constructor(config = {}) {
        super();
        this.data = {
            insights: [],
            codeTargets: [],
            risks: [],
            dependencies: [],
            openQuestions: [],
            status: 'idle'
        };
        this.activeTask = null;
    }

    /**
     * Clear the blackboard for a new task
     */
    reset(taskId) {
        this.activeTask = taskId;
        this.data = {
            insights: [],
            codeTargets: [],
            risks: [],
            dependencies: [],
            openQuestions: [],
            status: 'processing'
        };
        this.emit('reset', taskId);
    }

    /**
     * Update a specific category on the blackboard
     */
    post(category, item) {
        if (!this.data[category]) {
            this.data[category] = [];
        }
        
        const entry = {
            ...item,
            timestamp: Date.now()
        };

        this.data[category].push(entry);
        this.emit('posted', { category, entry });
        this.emit(`posted:${category}`, entry);
    }

    /**
     * Get the full state of the blackboard
     */
    getState() {
        return { ...this.data, taskId: this.activeTask };
    }

    /**
     * Get items in a specific category
     */
    get(category) {
        return this.data[category] || [];
    }
}

const blackboard = new Blackboard();
export default blackboard;
