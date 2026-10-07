import React from 'react';

const formatPayload = (payload) => {
    if (typeof payload === 'string') return `"${payload}"`;
    if (typeof payload === 'object' && payload !== null) {
        // Attempt to create a concise summary
        if (payload.title) {
            return `Node("${payload.title}")`;
        }
        if (payload.goal) {
            const shortGoal = payload.goal.length > 40 ? payload.goal.substring(0, 37) + '...' : payload.goal;
            return `Goal("${shortGoal}")`;
        }
        try {
            return JSON.stringify(payload);
        } catch {
            return '[Object]';
        }
    }
    return String(payload);
}

export const BusMessage = ({ topic, payload }) => {
    return (
        <div className="text-xs font-mono my-1 py-1 border-y border-gray-700/30">
            <span className="text-blue-500 font-bold">[BUS]</span>
            <span className="text-gray-400 mx-2">{topic}:</span>
            <span className="text-blue-300">{formatPayload(payload)}</span>
        </div>
    );
};
