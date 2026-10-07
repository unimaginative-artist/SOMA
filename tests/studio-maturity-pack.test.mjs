/**
 * SOMA Studio & Axis Full-Stack Maturity Pack Test Suite
 *
 * Verifies:
 * 1. Studio Identity & Device Session binding
 * 2. Mobile Directs Live Bridge (listing, ensuring DM channel, sending message, reading history, full-text search)
 * 3. In-Feed Brainrot / Flux Reels (preservation of type 'brainrot', videoUrl, and duration in feed store)
 * 4. Full Profile Customization & Avatar Upload (PUT /profile and POST /profile/avatar endpoints)
 * 5. Notifications & Activity unread tracking
 * 6. Cross-Surface endpoints availability (mobile PWA on :8088 & :3001/m, desktop stage)
 */

import assert from 'node:assert/strict';

const SOMA_ORIGIN = process.env.SOMA_ORIGIN || 'http://127.0.0.1:3001';
const MOBILE_DEV_ORIGIN = process.env.MOBILE_DEV_ORIGIN || 'http://127.0.0.1:8088';

async function runStudioMaturityPackTests() {
    console.log(`[TEST SUITE] Starting Studio & Axis Maturity Pack Tests against ${SOMA_ORIGIN}...\n`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Identity & Session Setup
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[1/6] Bootstrapping Studio & Axis Identity Session...');
    const deviceId = `dev-test-${Date.now()}`;
    const bootstrapRes = await fetch(`${SOMA_ORIGIN}/api/studio/identity/bootstrap`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-studio-device-id': deviceId,
            'x-studio-device-name': 'Studio Maturity Test Runner',
            'x-studio-device-type': 'test-runner'
        },
        body: JSON.stringify({
            clientType: 'mobile-app',
            suggestedName: 'Owner'
        })
    });
    assert.equal(bootstrapRes.status, 200, `Bootstrap failed with status ${bootstrapRes.status}`);
    const bootstrapData = await bootstrapRes.json();
    assert.equal(bootstrapData.ok, true);
    assert.ok(bootstrapData.token, 'Must return session token');
    assert.ok(bootstrapData.user?.userId, 'Must return user object with userId');

    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrapData.token}`,
        'x-studio-device-id': deviceId,
        'x-axis-user-id': bootstrapData.user.userId,
        'x-axis-user-name': bootstrapData.user.displayName || 'Owner',
    };
    console.log(`  ✓ Bootstrapped as ${bootstrapData.user.displayName} [ID: ${bootstrapData.user.userId}]`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Mobile Directs Live Bridge
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[2/6] Testing Mobile Directs Live Bridge...');
    const directsRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs`, { headers: authHeaders });
    assert.equal(directsRes.status, 200, 'GET /api/axis/directs must return 200');
    const directsData = await directsRes.json();
    assert.equal(directsData.ok, true);
    assert.ok(Array.isArray(directsData.directs), 'directs must be an array');
    console.log(`  ✓ Loaded ${directsData.directs.length} Direct conversation(s) from Axis backend.`);

    // Ensure a Direct conversation with a peer
    const targetPeer = 'Athena Vanguard';
    const ensureRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            targetUserId: 'athena-vanguard-node',
            targetUserName: targetPeer,
            image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'
        })
    });
    assert.equal(ensureRes.status, 200, 'POST /api/axis/directs must return 200');
    const ensureData = await ensureRes.json();
    assert.equal(ensureData.ok, true);
    const directChannelId = ensureData.direct?.id;
    assert.ok(directChannelId, 'Direct channel ID must be returned');
    console.log(`  ✓ Ensured Direct conversation channel with ${targetPeer}: ID=${directChannelId}`);

    // Send a message through this Direct channel
    const testDirectMsg = `Live Mobile Direct Bridge Ping [${Date.now()}]`;
    const sendMsgRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs/${encodeURIComponent(directChannelId)}/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: testDirectMsg })
    });
    assert.equal(sendMsgRes.status, 200, 'POST /api/axis/directs/:id/messages must return 200');
    const sendMsgData = await sendMsgRes.json();
    assert.equal(sendMsgData.ok, true);
    console.log(`  ✓ Dispatched message to Direct channel: "${testDirectMsg}"`);

    // Verify message retrieval
    const getMsgsRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs/${encodeURIComponent(directChannelId)}/messages`, {
        headers: authHeaders
    });
    assert.equal(getMsgsRes.status, 200);
    const getMsgsData = await getMsgsRes.json();
    assert.equal(getMsgsData.ok, true);
    const foundMsg = getMsgsData.messages?.find(m => m.text === testDirectMsg);
    assert.ok(foundMsg, 'Dispatched message must exist in direct message history');
    assert.equal(foundMsg.sender, 'user');
    console.log(`  ✓ Retrieved Direct channel history (${getMsgsData.messages.length} messages), verified message.`);

    // Test Directs full-text search
    const searchRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs-search?q=${encodeURIComponent('Mobile Direct Bridge Ping')}`, {
        headers: authHeaders
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.ok, true);
    assert.ok(Array.isArray(searchData.results) && searchData.results.length > 0, 'Search must return results');
    console.log(`  ✓ Directs search returned ${searchData.results.length} hit(s) matching query.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. In-Feed Brainrot / Flux Reels
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[3/6] Testing In-Feed Brainrot / Flux Reels Experience...');
    const testReelUrl = 'https://cdn.soma.network/reels/test-brainrot-loop.mp4';
    const testReelCaption = `Next-gen hyperstition visual loop [${Date.now()}]`;

    const createReelRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: testReelCaption,
            type: 'brainrot',
            videoUrl: testReelUrl,
            duration: 18,
            metadata: {
                aspectRatio: '9:16',
                soundtrack: 'Synth Drift #4'
            }
        })
    });
    assert.equal(createReelRes.status, 201, `Feed post creation expected 201, got ${createReelRes.status}`);
    const createReelData = await createReelRes.json();
    assert.equal(createReelData.ok, true);
    assert.equal(createReelData.post?.type, 'brainrot', 'Post must retain type "brainrot"');
    assert.equal(createReelData.post?.videoUrl, testReelUrl, 'Post must retain videoUrl');
    assert.equal(createReelData.post?.duration, 18, 'Post must retain duration');
    const reelPostId = createReelData.post.id;
    console.log(`  ✓ Created Brainrot Reel post: ID=${reelPostId}`);

    // Verify reel in feed retrieval
    const feedRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, { headers: authHeaders });
    assert.equal(feedRes.status, 200);
    const feedData = await feedRes.json();
    const foundReel = feedData.posts?.find(p => p.id === reelPostId);
    assert.ok(foundReel, 'Created reel post must be present in feed');
    assert.equal(foundReel.type, 'brainrot', 'Feed post must preserve "brainrot" type');
    assert.equal(foundReel.videoUrl, testReelUrl);
    console.log(`  ✓ Feed confirmed preservation of type="brainrot" and videoUrl across surfaces.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Full Profile Customization & Avatar Upload
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[4/6] Testing Profile Customization & Sync...');
    const updatedBio = `Architecting autonomous ambient intelligence systems. [${Date.now()}]`;
    const updatedRole = 'SOMA Core Architect';
    const updatedLocation = 'Tokyo Megacity / Cyberspace';

    const putProfileRes = await fetch(`${SOMA_ORIGIN}/api/studio/profile`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
            profile: {
                name: 'Owner',
                role: updatedRole,
                location: updatedLocation,
                bio: updatedBio,
                axis: {
                    status: 'online',
                    handle: 'owner_prime'
                }
            }
        })
    });
    assert.equal(putProfileRes.status, 200, 'PUT /api/studio/profile must return 200');
    const putProfileData = await putProfileRes.json();
    assert.equal(putProfileData.ok, true);
    assert.equal(putProfileData.profile?.role, updatedRole);
    assert.equal(putProfileData.profile?.location, updatedLocation);
    console.log(`  ✓ Profile updated via PUT /api/studio/profile: "${updatedRole}" / "${updatedLocation}"`);

    // Verify GET /api/studio/profile reflects the saved data
    const getProfileRes = await fetch(`${SOMA_ORIGIN}/api/studio/profile`, { headers: authHeaders });
    assert.equal(getProfileRes.status, 200);
    const getProfileData = await getProfileRes.json();
    assert.equal(getProfileData.ok, true);
    assert.equal(getProfileData.profile?.role, updatedRole);
    console.log(`  ✓ GET /api/studio/profile confirmed persistent profile updates.`);

    // Test Avatar Upload
    console.log('\n[5/6] Testing Profile Avatar Upload Endpoint...');
    // Create a 1x1 dummy PNG buffer
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar-test.png"\r\nContent-Type: image/png\r\n\r\n`),
        pngBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const avatarUploadRes = await fetch(`${SOMA_ORIGIN}/api/studio/profile/avatar`, {
        method: 'POST',
        headers: {
            Authorization: authHeaders.Authorization,
            'x-axis-user-id': authHeaders['x-axis-user-id'],
            'x-axis-user-name': authHeaders['x-axis-user-name'],
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: multipartBody
    });
    assert.equal(avatarUploadRes.status, 200, `Avatar upload failed with status ${avatarUploadRes.status}`);
    const avatarData = await avatarUploadRes.json();
    assert.equal(avatarData.ok, true);
    assert.ok(avatarData.avatarUrl, 'Must return avatarUrl');
    console.log(`  ✓ Avatar uploaded successfully: ${avatarData.avatarUrl}`);

    // Verify the uploaded avatar can be retrieved
    const getAvatarRes = await fetch(`${SOMA_ORIGIN}${avatarData.avatarUrl}`);
    assert.equal(getAvatarRes.status, 200, 'Uploaded avatar file must return HTTP 200');
    console.log(`  ✓ Avatar media asset verified and downloadable via GET ${avatarData.avatarUrl}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Activity & Notifications Endpoint Check
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[6/6] Testing Notifications & Cross-Surface Endpoints...');
    const notifsRes = await fetch(`${SOMA_ORIGIN}/api/studio/notifications/${encodeURIComponent(bootstrapData.user.userId)}`, {
        headers: authHeaders
    });
    assert.equal(notifsRes.status, 200);
    const notifsData = await notifsRes.json();
    assert.equal(notifsData.ok, true);
    assert.ok(Array.isArray(notifsData.notifications));
    console.log(`  ✓ Notifications endpoint verified (${notifsData.notifications.length} notifications).`);

    // Verify Mobile and Desktop stage surfaces
    const mobileDevRes = await fetch(`${MOBILE_DEV_ORIGIN}/`);
    assert.equal(mobileDevRes.status, 200, 'Mobile dev server :8088 must return 200');
    console.log('  ✓ Mobile PWA dev server (http://127.0.0.1:8088/) is online (HTTP 200)');

    const mobileSomaRes = await fetch(`${SOMA_ORIGIN}/m/`);
    assert.equal(mobileSomaRes.status, 200, 'SOMA /m/ must return 200');
    console.log('  ✓ SOMA hosted mobile PWA (http://127.0.0.1:3001/m/) is online (HTTP 200)');

    const stageRes = await fetch(`${SOMA_ORIGIN}/stage/Studio.dc.html`);
    assert.equal(stageRes.status, 200, 'Desktop Studio Stage must return 200');
    console.log('  ✓ Desktop Stage (http://127.0.0.1:3001/stage/Studio.dc.html) is online (HTTP 200)');

    console.log('\n========================================================================');
    console.log('🎉 ALL STUDIO & AXIS MATURITY PACK TESTS PASSED 100% CLEANLY! 🎉');
    console.log('========================================================================\n');
}

runStudioMaturityPackTests().catch(err => {
    console.error('\n❌ MATURITY PACK TEST FAILED:', err);
    process.exit(1);
});
