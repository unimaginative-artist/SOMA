// Read-only local inference smoke test. No Discord client, goal queue, trades, or outbound messages.
// node scripts/eval-discord-conversation.mjs --live-local
import { createDiscordConversationAdapter } from '../server/discord/DiscordConversationAdapter.js';

if (!process.argv.includes('--live-local')) throw new Error('Pass --live-local to run a bounded local-model conversation evaluation.');
const modelOverride = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : null;
const brain = {
    async reason(prompt, options) {
        const response = await fetch(`${options.localEndpoint}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelOverride || options.localModel, stream: false, keep_alive: '90s',
                messages: [{ role: 'system', content: options.localPersona }, ...options.history, { role: 'user', content: prompt }],
                options: { temperature: options.temperature, num_predict: Math.min(options.maxTokens, 240) } }),
            signal: AbortSignal.timeout(45000)
        });
        if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
        const data = await response.json();
        return { text: data.message?.content, model: data.model };
    }
};
const adapter = createDiscordConversationAdapter({ system: {}, brain });
const cases = [
    { id: 'greeting', input: 'Hows it going', history: [] },
    { id: 'free_choice', input: 'Ok what else would you like to work on', history: [] },
    { id: 'unfinished_idea', input: 'Well no I have nothing planned I think its something thats going to sit above your existing architecture but I have yet to figure that out', history: [{ bot: false, content: 'We want to design toward a more cognitive substrate.' }] },
    { id: 'architecture_followup', input: 'Ok so what can you do about it?', history: [{ bot: false, content: 'If your mixture of experts is not functioning correctly it needs correction.' }] },
    { id: 'relationship_continuity', input: 'We used to have really heartfelt conversations. I miss that.', history: [] },
];
for (const item of cases) {
    const start = Date.now();
    try {
        const result = await adapter.processQuery(item.input, { isAdmin: true, guildId: 'DM', userId: 'eval-owner', runningHistory: item.history });
        console.log(JSON.stringify({ id: item.id, milliseconds: Date.now() - start, response: result.response,
            model: result.metadata.discordConversationModel, repaired: result.metadata.discordConversationRepair,
            recovery: result.metadata.discordConversationDeterministicRecovery, issues: result.metadata.discordConversationIssues }));
        if (result.metadata.discordConversationDeterministicRecovery || !result.metadata.discordConversationQuality?.acceptable) process.exitCode = 1;
    } catch (error) { console.log(JSON.stringify({ id: item.id, milliseconds: Date.now() - start, error: error.message })); process.exitCode = 1; }
}
