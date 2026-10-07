import React, { useEffect, useState } from 'react';
import { BRAINS } from '../constants.js';

/**
 * FloatingActivityOverlay - Minimal floating text that drifts and fades
 * Shows brain activity during web learning with no box/container
 * Text flows top → bottom with gradient fade
 */
export const FloatingActivityOverlay = ({ activities = [] }) => {
    const [displayActivities, setDisplayActivities] = useState([]);

    // Update display activities with animation tracking
    useEffect(() => {
        if (activities.length > 0) {
            const latest = activities[activities.length - 1];

            // Add new activity at top
            setDisplayActivities(prev => {
                const newActivities = [{ ...latest, age: 0 }, ...prev];
                // Keep only last 5 activities
                return newActivities.slice(0, 5);
            });
        }
    }, [activities]);

    // Age activities for fade effect
    useEffect(() => {
        const interval = setInterval(() => {
            setDisplayActivities(prev => {
                return prev
                    .map(act => ({ ...act, age: act.age + 1 }))
                    .filter(act => act.age < 15); // Remove after 15 ticks (3 seconds)
            });
        }, 200);

        return () => clearInterval(interval);
    }, []);

    const getBrainColor = (brainType) => {
        const brain = BRAINS[brainType];
        return brain?.color || '#64ffda';
    };

    const getBrainGlow = (brainType) => {
        const brain = BRAINS[brainType];
        return brain?.color || '#64ffda';
    };

    return (
        <div className="absolute top-20 left-8 pointer-events-none z-40 w-96">
            <div className="relative">
                {displayActivities.map((activity, index) => {
                    const opacity = Math.max(0, 1 - (activity.age * 0.08));
                    const yOffset = activity.age * 4; // Drift down 4px per tick (slower)
                    const scale = 1 - (activity.age * 0.01);

                    return (
                        <div
                            key={activity.id}
                            className="text-left text-sm font-mono mb-2 transition-all duration-200 ease-out absolute w-full"
                            style={{
                                opacity: opacity,
                                transform: `translateY(${yOffset}px) scale(${scale})`,
                                color: getBrainColor(activity.brain),
                                textShadow: `0 0 20px ${getBrainGlow(activity.brain)}80, 0 0 40px ${getBrainGlow(activity.brain)}40`,
                                fontWeight: 500,
                                letterSpacing: '0.05em'
                            }}
                        >
                            → {activity.brain}: {activity.action}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
