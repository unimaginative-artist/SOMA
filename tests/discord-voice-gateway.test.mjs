import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalSpeechPipeline } from '../core/LocalSpeechPipeline.js';
import { DiscordVoiceGateway } from '../core/DiscordVoiceGateway.js';

test('LocalSpeechPipeline: cleans markdown, code blocks, and URLs for spoken audio', () => {
    const pipeline = new LocalSpeechPipeline();
    const raw = `### SOMA Analysis Complete
Here is the code I updated:
\`\`\`javascript
function add(a, b) { return a + b; }
\`\`\`
Check the file at \`core/MaxAgentBridge.js\` or visit https://github.com/owner/soma for details.`;

    const spoken = pipeline.formatForSpeech(raw);

    assert.ok(!spoken.includes('```'));
    assert.ok(!spoken.includes('https://'));
    assert.ok(!spoken.includes('###'));
    assert.ok(spoken.includes('[code omitted, check chat]'));
    assert.ok(spoken.includes('core/MaxAgentBridge.js'));
    assert.ok(spoken.includes('link in chat'));
});

test('DiscordVoiceGateway: connects, disconnects, and manages channel state', async () => {
    const gateway = new DiscordVoiceGateway();
    assert.equal(gateway.isConnected(), false);

    const mockChannel = {
        id: 'voice-channel-123',
        name: 'The Lab',
        guild: { id: 'guild-456', voiceAdapterCreator: {} }
    };

    await gateway.joinChannel(mockChannel);
    assert.equal(gateway.isConnected(), true);
    assert.equal(gateway.activeChannelId, 'voice-channel-123');

    const leaveResult = await gateway.leaveChannel();
    assert.equal(leaveResult.ok, true);
    assert.equal(gateway.isConnected(), false);
    assert.equal(gateway.activeChannelId, null);
});

test('DiscordVoiceGateway: handleUserSpeech dispatches to live agent and synthesizes speech', async () => {
    let turnInput = null;
    const mockLiveAgent = {
        async runTurn(prompt) {
            turnInput = prompt;
            return {
                summary: 'Inspected MAX repository. All 3 tools verified.',
                toolsUsed: ['list_files']
            };
        }
    };

    let sentMessage = null;
    const mockTextChannel = {
        async send(content) {
            sentMessage = content;
        }
    };

    const gateway = new DiscordVoiceGateway({ liveAgent: mockLiveAgent });
    const result = await gateway.handleUserSpeech('Can you inspect MAX repository?', {
        textChannel: mockTextChannel,
        user: { username: 'owner_' }
    });

    assert.equal(turnInput, 'Can you inspect MAX repository?');
    assert.ok(result.reply.includes('Inspected MAX repository'));
    assert.ok(sentMessage.includes('owner_'));
    assert.ok(sentMessage.includes('Inspected MAX repository'));
});
