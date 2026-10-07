import assert from 'node:assert/strict';

const SOMA_ORIGIN = process.env.SOMA_ORIGIN || 'http://localhost:3001';
const MOBILE_DEV_ORIGIN = process.env.MOBILE_DEV_ORIGIN || 'http://localhost:8088';

console.log(`[TEST SUITE] Starting Unified Studio Social Platform E2E Tests against ${SOMA_ORIGIN}...`);

async function testUnifiedPlatform() {
    const testDeviceId = 'dev-test-runner-' + Date.now();
    const commonHeaders = {
        'Content-Type': 'application/json',
        'x-studio-device-id': testDeviceId,
        'x-studio-device-name': 'E2E Test Runner',
        'x-studio-device-type': 'automated-tester',
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Zero-Friction Bootstrap & Verified Identity
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[1/7] Testing POST /api/studio/identity/bootstrap...');
    const bootRes = await fetch(`${SOMA_ORIGIN}/api/studio/identity/bootstrap`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({ surface: 'automated-test' })
    });
    assert.equal(bootRes.status, 200, `Bootstrap expected 200, got ${bootRes.status}`);
    const bootData = await bootRes.json();
    assert.equal(bootData.ok, true, 'Bootstrap returned ok: false');
    assert.ok(bootData.token, 'Bootstrap must return signed session token');
    assert.equal(bootData.user?.displayName, 'Owner', `Expected displayName Owner, got ${bootData.user?.displayName}`);
    assert.ok(['calm_harbor_7431', 'owner_prime'].includes(bootData.user?.handle), `Expected handle calm_harbor_7431 or owner_prime, got ${bootData.user?.handle}`);
    assert.ok(['HUMAN_VERIFIED_MATURE', 'ADULT_VERIFIED'].includes(bootData.user?.trustTier), `Expected trustTier HUMAN_VERIFIED_MATURE or ADULT_VERIFIED, got ${bootData.user?.trustTier}`);
    assert.ok(['mature_adult', 'core_adult'].includes(bootData.user?.ageBand), `Expected ageBand mature_adult or core_adult, got ${bootData.user?.ageBand}`);
    console.log(`  ✓ Bootstrapped identity: ${bootData.user.displayName} (@${bootData.user.handle}) [${bootData.user.trustTier} / ${bootData.user.ageBand}]`);

    const authHeaders = {
        ...commonHeaders,
        Authorization: `Bearer ${bootData.token}`,
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Session Verification & Device Binding
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[2/7] Testing GET /api/studio/identity/session...');
    const sessionRes = await fetch(`${SOMA_ORIGIN}/api/studio/identity/session`, {
        headers: authHeaders
    });
    assert.equal(sessionRes.status, 200, `Session check expected 200, got ${sessionRes.status}`);
    const sessionData = await sessionRes.json();
    assert.equal(sessionData.ok, true, 'Session check ok: false');
    assert.ok(['calm_harbor_7431', 'owner_prime'].includes(sessionData.user?.handle));
    assert.ok(['HUMAN_VERIFIED_MATURE', 'ADULT_VERIFIED'].includes(sessionData.user?.trustTier));
    console.log('  ✓ Session active and verified with device binding.');

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Feed & Post Creation (Both Text and Image attachments)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[3/7] Testing Post Creation (Text & Image) on shared feed...');
    const testPostText = `Unified platform test post [${Date.now()}]`;
    const postRes1 = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: testPostText,
            type: 'text',
            metadata: {
                trust: 'camera',
                audience: 'public',
                source: 'mobile-app'
            }
        })
    });
    assert.equal(postRes1.status, 201, `Post creation expected 201, got ${postRes1.status}`);
    const postData1 = await postRes1.json();
    assert.equal(postData1.ok, true);
    assert.equal(postData1.post?.text, testPostText);
    assert.equal(postData1.post?.authorName, 'Owner');
    const textPostId = postData1.post.id;
    console.log(`  ✓ Text post created: ${textPostId}`);

    const imagePostText = `Verified photo capture test [${Date.now()}]`;
    const dummyImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const postRes2 = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: imagePostText,
            type: 'image',
            mediaUrl: dummyImageBase64,
            metadata: {
                trust: 'camera',
                aiGenerated: false,
                audience: 'public',
                source: 'command-stage'
            }
        })
    });
    assert.equal(postRes2.status, 201);
    const postData2 = await postRes2.json();
    assert.equal(postData2.post?.type, 'image');
    assert.ok(postData2.post?.mediaUrl, 'Image post must retain mediaUrl');
    const imagePostId = postData2.post.id;
    console.log(`  ✓ Image post created: ${imagePostId}`);

    const feedRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, { headers: authHeaders });
    assert.equal(feedRes.status, 200);
    const feedData = await feedRes.json();
    const foundTextPost = feedData.posts?.find(p => p.id === textPostId);
    const foundImagePost = feedData.posts?.find(p => p.id === imagePostId);
    assert.ok(foundTextPost, 'Created text post must be present in feed');
    assert.ok(foundImagePost, 'Created image post must be present in feed');
    console.log(`  ✓ Shared feed loaded with ${feedData.posts.length} posts, containing both test posts.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Interactive Likes & Dislikes
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[4/7] Testing Likes on Feed Posts...');
    const initialLikes = Number(foundTextPost.likes || 0);
    const likeRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed/${encodeURIComponent(textPostId)}/like`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ delta: 1 })
    });
    assert.equal(likeRes.status, 200);
    const likeData = await likeRes.json();
    assert.equal(likeData.ok, true);
    assert.equal(likeData.post?.likes, initialLikes + 1, 'Like count should increment by 1');
    console.log(`  ✓ Liked post: count increased to ${likeData.post.likes}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Interactive Threaded Comments
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[5/7] Testing Threaded Comments on Posts...');
    const commentText = `E2E automated comment [${Date.now()}]`;
    const addCmRes = await fetch(`${SOMA_ORIGIN}/api/studio/posts/${encodeURIComponent(textPostId)}/comments`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: commentText })
    });
    assert.equal(addCmRes.status, 200);
    const addCmData = await addCmRes.json();
    assert.equal(addCmData.ok, true);
    assert.equal(addCmData.comment?.text, commentText);
    assert.equal(addCmData.comment?.name, 'Owner');
    const commentId = addCmData.comment.id;
    console.log(`  ✓ Created comment: ${commentId} by ${addCmData.comment.name}`);

    const getCmRes = await fetch(`${SOMA_ORIGIN}/api/studio/posts/${encodeURIComponent(textPostId)}/comments`, {
        headers: authHeaders
    });
    assert.equal(getCmRes.status, 200);
    const getCmData = await getCmRes.json();
    const foundComment = getCmData.comments?.find(c => c.id === commentId);
    assert.ok(foundComment, 'Added comment must be in comments list');
    console.log(`  ✓ Fetched comments list (${getCmData.comments.length} comments), comment verified.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Live Streaming Broadcast & Interaction
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[6/7] Testing Live Streaming (Start room, Chat, Reaction, End room)...');
    const liveTitle = `Studio Premiere Broadcast [${Date.now()}]`;
    const startLiveRes = await fetch(`${SOMA_ORIGIN}/api/studio/live`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            title: liveTitle,
            category: 'Creative Technology',
            mode: 'signal',
            options: { hd: true, subchat: false }
        })
    });
    assert.equal(startLiveRes.status, 201);
    const startLiveData = await startLiveRes.json();
    assert.equal(startLiveData.ok, true);
    assert.equal(startLiveData.room?.title, liveTitle);
    assert.equal(startLiveData.room?.authorName, 'Owner');
    assert.equal(startLiveData.room?.status, 'live');
    const roomId = startLiveData.room.id;
    console.log(`  ✓ Started live broadcast room: ${roomId} ("${liveTitle}")`);

    const liveListRes = await fetch(`${SOMA_ORIGIN}/api/studio/live?status=live`, { headers: authHeaders });
    assert.equal(liveListRes.status, 200);
    const liveListData = await liveListRes.json();
    const foundRoom = liveListData.rooms?.find(r => r.id === roomId);
    assert.ok(foundRoom, 'Live room must appear in active rooms list');
    console.log(`  ✓ Live room discovery confirmed across surfaces.`);

    const liveChatRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/chat`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Hello from the audience!' })
    });
    assert.equal(liveChatRes.status, 200);
    const liveChatData = await liveChatRes.json();
    assert.equal(liveChatData.ok, true);
    assert.ok(liveChatData.room?.chat?.some(c => c.text === 'Hello from the audience!'), 'Live chat message not found in room');
    console.log(`  ✓ Live chat message delivered in real-time.`);

    const reactRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/react`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ kind: 'bolt' })
    });
    assert.equal(reactRes.status, 200);
    console.log(`  ✓ Live floating reaction (⚡ bolt) registered.`);

    const endLiveRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/end`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
    });
    assert.equal(endLiveRes.status, 200);
    const endLiveData = await endLiveRes.json();
    assert.equal(endLiveData.ok, true);
    assert.equal(endLiveData.room?.status, 'ended');
    console.log(`  ✓ Live broadcast room ${roomId} ended cleanly.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. Surface Availability Checks
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[7/7] Testing Web App Surface Endpoints...');
    const mobileSomaRes = await fetch(`${SOMA_ORIGIN}/m/`);
    assert.equal(mobileSomaRes.status, 200, 'Mobile Studio on SOMA :3001/m/ must return 200');
    console.log('  ✓ Mobile app on SOMA (http://localhost:3001/m/) is accessible (HTTP 200)');

    const mobileDevRes = await fetch(`${MOBILE_DEV_ORIGIN}/`);
    assert.equal(mobileDevRes.status, 200, 'Mobile Studio on python dev :8088 must return 200');
    console.log('  ✓ Mobile app dev server (http://localhost:8088/) is accessible (HTTP 200)');

    const stageRes = await fetch(`${SOMA_ORIGIN}/stage/Studio.dc.html`);
    assert.equal(stageRes.status, 200, 'Desktop Studio Stage must return 200');
    console.log('  ✓ Desktop Command Bridge stage (http://localhost:3001/stage/Studio.dc.html) is accessible (HTTP 200)');

    console.log('\n========================================================================');
    console.log('🎉 ALL 7 UNIFIED STUDIO SOCIAL PLATFORM TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('========================================================================\n');
}

testUnifiedPlatform().catch(err => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
});
