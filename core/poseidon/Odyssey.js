/**
 * ODYSSEY: The Journey (Strategic Navigation)
 * 
 * Manages the long voyage from abstract goal to technical completion.
 * Uses Directed Acyclic Graphs (DAG) to ensure prerequisites are met.
 */
export class Odyssey {
    constructor() {
        this.voyages = new Map();
    }

    /**
     * Map the technical voyage
     */
    async chart(brain, goal, description) {
        const prompt = `Chart a technical ODYSSEY for this goal.
PROJECT: ${goal}
DESCRIPTION: ${description}

Break the journey into a DAG of milestones.
Each milestone is a prerequisite for the next.

Return ONLY JSON:
{
  "voyageId": "slug",
  "title": "...",
  "milestones": [ { "id": "m1", "label": "...", "task": "..." } ],
  "dependencies": [ { "from": "m1", "to": "m2" } ]
}`;

        try {
            const result = await brain.think(prompt, { temperature: 0.2 });
            const voyage = JSON.parse(result.text.match(/\{[\s\S]*\}/)[0]);
            voyage.milestones = voyage.milestones.map(m => ({ ...m, status: 'docked' }));
            this.voyages.set(voyage.voyageId, voyage);
            return voyage;
        } catch (err) {
            return { error: "Charting failed" };
        }
    }
}
