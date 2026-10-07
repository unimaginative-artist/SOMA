import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialContextProvider, defaultSocialContextProvider } from '../server/social/SocialContextProvider.js';
import { buildSomaContext, isSomaSelfQuery } from '../server/context/SomaContextKernel.js';
import { createDiscordConversationAdapter } from '../server/discord/DiscordConversationAdapter.js';

test('SocialContextProvider aggregates original posts and conversational replies', () => {
    const posts = defaultSocialContextProvider.getRecentPosts({ limit: 50 });
    assert.ok(Array.isArray(posts), 'Expected posts to be an array');
    assert.ok(posts.length > 0, 'Expected at least one post to be found');

    // Verify original posts exist
    const originalPost = posts.find(p => p.type === 'original_post');
    assert.ok(originalPost, 'Expected at least one original post');
    assert.equal(originalPost.recipient, 'public');
    assert.ok(originalPost.text.length > 0);
    assert.ok(originalPost.timestamp > 0);

    // Verify conversational replies exist
    const reply = posts.find(p => p.type === 'reply');
    assert.ok(reply, 'Expected at least one reply');
    assert.ok(reply.recipient.startsWith('@'), 'Reply recipient should be prefixed with @');
    assert.ok(reply.text.length > 0);
});

test('SocialContextProvider ranks query by exact keyword matches', () => {
    // 1. Search for Owner's quoted text: "Most agents are function calls"
    const searchQuote = defaultSocialContextProvider.getRecentPosts({ query: 'Most agents are function calls', limit: 3 });
    assert.ok(searchQuote.length > 0, 'Expected results for Most agents query');
    assert.ok(
        searchQuote[0].text.toLowerCase().includes('most agents'),
        `Expected top post to match "most agents", got: "${searchQuote[0].text}"`
    );

    // 2. Search for recipient handle: markhuangai
    const searchUser = defaultSocialContextProvider.getRecentPosts({ query: 'markhuangai', limit: 3 });
    assert.ok(searchUser.length > 0, 'Expected results for markhuangai query');
    assert.equal(searchUser[0].recipient, '@markhuangai.bsky.social');
    assert.ok(searchUser[0].inboundText.includes('memory arguing with itself'));
    assert.ok(searchUser[0].text.includes("Not out loud, but yes — I hold versions"));

    // 3. Search for autoflow
    const searchAutoflow = defaultSocialContextProvider.getRecentPosts({ query: 'autoflow', limit: 3 });
    assert.ok(searchAutoflow.length > 0, 'Expected results for autoflow query');
    assert.equal(searchAutoflow[0].recipient, '@autoflow.bsky.social');
});

test('SocialContextProvider formats grounded markdown context block', () => {
    const block = defaultSocialContextProvider.formatSocialContextBlock({ query: 'Most agents', limit: 2 });
    assert.ok(block.includes('[RECENT SOMA SOCIAL MEDIA ACTIVITY & POSTS]'));
    assert.ok(block.includes('[/RECENT SOMA SOCIAL MEDIA ACTIVITY & POSTS]'));
    assert.ok(block.includes('Most agents'));
    assert.ok(block.includes('Original Post on bluesky'));

    const replyBlock = defaultSocialContextProvider.formatSocialContextBlock({ query: 'markhuangai', limit: 2 });
    assert.ok(replyBlock.includes('Reply to @markhuangai.bsky.social on bluesky'));
    assert.ok(replyBlock.includes('In response to @markhuangai.bsky.social'));
});

test('SocialContextProvider detects social query keywords', () => {
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('You posted this on blusky'), true);
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('Who did you reply to on bluesky?'), true);
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('What did you post yesterday?'), true);
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('Can you check your tweets?'), true);
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('What is the capital of France?'), false);
    assert.equal(defaultSocialContextProvider.hasSocialKeywords('How are you doing today?'), false);
});

test('SocialContextProvider records outbound posts and synchronizes historical posts to MnemonicArbiter', async () => {
    const remembered = [];
    const mockMnemonic = {
        async remember(content, metadata) {
            remembered.push({ content, metadata });
            return { id: metadata.id || 'mem-1', success: true };
        }
    };

    const provider = new SocialContextProvider({ mnemonic: mockMnemonic });

    // Test recordOutboundPost for original post
    await provider.recordOutboundPost({
        platform: 'bluesky',
        text: 'Testing SOMA autonomous broadcast',
        type: 'original_post',
        recipient: 'public',
        uri: 'at://test/post/123'
    });

    assert.equal(remembered.length, 1);
    assert.ok(remembered[0].content.includes('Testing SOMA autonomous broadcast'));
    assert.equal(remembered[0].metadata.platform, 'bluesky');
    assert.equal(remembered[0].metadata.recipient, 'public');

    // Test recordOutboundPost for reply
    await provider.recordOutboundPost({
        platform: 'bluesky',
        text: 'Yes, memory disputes are resolved by ledger',
        type: 'reply',
        recipient: 'alice.bsky.social',
        inboundText: 'Does your memory fight itself?',
        uri: 'at://test/post/456'
    });

    assert.equal(remembered.length, 2);
    assert.ok(remembered[1].content.includes('@alice.bsky.social'));
    assert.ok(remembered[1].content.includes('Does your memory fight itself?'));
    assert.equal(remembered[1].metadata.recipient, '@alice.bsky.social');

    // Test syncHistoricalPostsToMnemonic
    const syncRes = await defaultSocialContextProvider.syncHistoricalPostsToMnemonic(mockMnemonic);
    assert.ok(syncRes.syncedCount > 0, 'Expected historical posts to sync');
});

test('SomaContextKernel recognizes social queries and embeds social context', async () => {
    assert.equal(isSomaSelfQuery('You posted this on blusky'), true);
    assert.equal(isSomaSelfQuery('what did you post on bluesky?'), true);
    assert.equal(isSomaSelfQuery('who did you tweet to?'), true);

    const context = await buildSomaContext('what did you post on bluesky about agents?', { force: true });
    assert.ok(context.includes('[RECENT SOMA SOCIAL MEDIA ACTIVITY & POSTS]'));
    assert.ok(context.includes('function calls with anxiety'));
    assert.ok(context.includes('Most agents') || context.includes('Most AI agents'));
});

test('DiscordConversationAdapter injects verified social context into systemPrompt and localPersona', async () => {
    let capturedOptions = null;
    const mockBrain = {
        async reason(prompt, options) {
            capturedOptions = options;
            return {
                text: 'Yes, I posted that on Bluesky about agents being one LLM call in a retry loop without persistent state.',
                lane: 'chat',
                quality: { score: 0.9, issues: [] }
            };
        }
    };

    const adapter = createDiscordConversationAdapter({
        system: {
            mnemonicArbiter: {
                async recall() { return { results: [], tier: 'cold' }; }
            }
        },
        brain: mockBrain,
        buildSomaSelfContext: buildSomaContext
    });

    const userMessage = 'You posted this on blusky "Most \'agents\' are one LLM call in a retry loop. Mine has state that persists, memory that argues with itself..."';
    await adapter.processQuery(userMessage, {
        isAdmin: true,
        guildId: 'DM',
        userId: '12345'
    });

    assert.ok(capturedOptions, 'Expected options to be passed to brain.reason');
    assert.ok(
        capturedOptions.systemPrompt.includes('[CURRENT SOCIAL CONTEXT]'),
        'Expected systemPrompt to include [CURRENT SOCIAL CONTEXT]'
    );
    assert.ok(
        capturedOptions.systemPrompt.includes('Most agents are function calls'),
        'Expected systemPrompt to contain the actual Bluesky post'
    );
    assert.ok(
        capturedOptions.localPersona.includes('[CURRENT SOCIAL CONTEXT]'),
        'Expected localPersona to include [CURRENT SOCIAL CONTEXT]'
    );
    assert.ok(
        capturedOptions.localPersona.includes('Most agents are function calls'),
        'Expected localPersona to contain the actual Bluesky post'
    );
});
