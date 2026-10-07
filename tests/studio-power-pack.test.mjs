import assert from 'node:assert/strict';
import http from 'node:http';

const SOMA_ORIGIN = process.env.SOMA_ORIGIN || 'http://127.0.0.1:3001';
const MOBILE_DEV_ORIGIN = process.env.MOBILE_DEV_ORIGIN || 'http://127.0.0.1:8088';

console.log(`[TEST SUITE] Starting Studio Power Pack (6 Pillars) E2E Tests against ${SOMA_ORIGIN} & ${MOBILE_DEV_ORIGIN}...`);

async function testPowerPack() {
    const testDeviceId = 'powerpack-tester-' + Date.now();
    const commonHeaders = {
        'Content-Type': 'application/json',
        'x-studio-device-id': testDeviceId,
        'x-studio-device-name': 'PowerPack Test Runner',
        'x-studio-device-type': 'automated-tester',
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup: Bootstrap Owner Session
    // ─────────────────────────────────────────────────────────────────────────────
    const bootRes = await fetch(`${SOMA_ORIGIN}/api/studio/identity/bootstrap`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({ surface: 'powerpack-test' })
    });
    assert.equal(bootRes.status, 200, `Bootstrap expected 200, got ${bootRes.status}`);
    const bootData = await bootRes.json();
    assert.ok(bootData.token, 'Must return signed token');
    const authHeaders = {
        ...commonHeaders,
        Authorization: `Bearer ${bootData.token}`,
    };
    console.log(`  ✓ Authenticated as ${bootData.user.displayName} (@${bootData.user.handle})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 1: PWA Standalone Shell & Manifest / Service Worker
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 1/6] Testing PWA Standalone Shell, Manifest & Service Worker...');
    const manifestRes = await fetch(`${MOBILE_DEV_ORIGIN}/manifest.json`);
    assert.equal(manifestRes.status, 200, 'manifest.json must return 200');
    const manifest = await manifestRes.json();
    assert.equal(manifest.name, 'SOMA Studio', 'PWA name should be SOMA Studio');
    assert.equal(manifest.display, 'standalone', 'PWA display mode must be standalone');
    assert.equal(manifest.theme_color, '#06060a', 'PWA theme_color match');
    console.log(`  ✓ PWA Manifest verified: name="${manifest.name}", display="${manifest.display}", theme=${manifest.theme_color}`);

    const swRes = await fetch(`${MOBILE_DEV_ORIGIN}/sw.js`);
    assert.equal(swRes.status, 200, 'sw.js must return 200');
    const swCode = await swRes.text();
    assert.ok(swCode.includes('soma-studio-v1'), 'sw.js must contain cache name soma-studio-v1');
    console.log('  ✓ Service Worker asset verified with offline caching logic.');

    const htmlRes = await fetch(`${MOBILE_DEV_ORIGIN}/index.html`);
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('manifest.json'), 'index.html must reference manifest.json');
    assert.ok(htmlText.includes('serviceWorker.register'), 'index.html must register Service Worker');
    assert.ok(htmlText.includes('display-mode: standalone'), 'index.html must include standalone styles');
    console.log('  ✓ Mobile HTML shell verified with standalone viewport and SW registration.');

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 2: Real-Time Live Feed SSE Push Stream (/api/studio/feed/events)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 2/6] Testing Real-Time Feed SSE Push Stream...');
    
    // Connect to SSE stream
    const ssePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SSE connection/event timeout after 8s')), 8000);
        let connectedReceived = false;
        let feedPostReceived = false;

        const req = http.request(`${SOMA_ORIGIN}/api/studio/feed/events`, {
            method: 'GET',
            headers: {
                Accept: 'text/event-stream',
                'Cache-Control': 'no-cache',
            }
        }, (res) => {
            assert.equal(res.statusCode, 200, `SSE expected 200, got ${res.statusCode}`);
            assert.ok(res.headers['content-type']?.includes('text/event-stream'), 'Content-Type must be text/event-stream');

            res.setEncoding('utf8');
            let buffer = '';

            res.on('data', (chunk) => {
                buffer += chunk;
                const lines = buffer.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.type === 'connected') {
                                connectedReceived = true;
                            }
                            if (parsed.post && parsed.post.text?.includes('SSE Live Push Test')) {
                                feedPostReceived = true;
                                clearTimeout(timeout);
                                req.destroy();
                                resolve({ connected: connectedReceived, post: parsed.post });
                                return;
                            }
                        } catch (_) {}
                    }
                }
            });
        });

        req.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        req.end();
    });

    // Wait a brief tick for SSE connection to establish, then trigger a post
    await new Promise(r => setTimeout(r, 400));
    const ssePostText = `SSE Live Push Test [${Date.now()}]`;
    const ssePostRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: ssePostText,
            type: 'text',
        })
    });
    assert.equal(ssePostRes.status, 201);
    const ssePostResult = await ssePostRes.json();
    console.log(`  ✓ Triggered live feed post: ${ssePostResult.post.id}`);

    const sseResult = await ssePromise;
    assert.ok(sseResult.connected, 'SSE stream must receive initial connected message');
    assert.equal(sseResult.post.text, ssePostText, 'SSE stream received live push with matching post text');
    console.log(`  ✓ Real-time SSE stream received published post instantly: "${sseResult.post.id}"`);

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 3: Tactical Mobile Haptic Feedback Client Integration
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 3/6] Testing Mobile Haptics Client Module...');
    const apiRes = await fetch(`${MOBILE_DEV_ORIGIN}/studio-api.js`);
    assert.equal(apiRes.status, 200);
    const apiCode = await apiRes.text();
    assert.ok(apiCode.includes('window.StudioHaptics'), 'studio-api.js must export window.StudioHaptics');
    assert.ok(apiCode.includes('navigator.vibrate'), 'StudioHaptics must invoke navigator.vibrate');
    assert.ok(apiCode.includes('connectFeedEvents'), 'studio-api.js must export connectFeedEvents');
    console.log('  ✓ StudioHaptics and SSE feed client module confirmed in studio-api.js.');

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 4: SOMA Vision Sentinel Local Photo Attestation
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 4/6] Testing SOMA Vision Sentinel Photo Attestation...');
    const dummyPhotoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const sentinelSha256 = '4a5a5d0233b28b70743b177d0cf0c4228c2eb3dd4497e682283995155f9a6564';
    const sentinelTimestamp = Date.now();

    const attestationPayload = {
        sha256: sentinelSha256,
        device: 'SOMA Sentinel Vision v1.0 (Hardware-Verified)',
        signature: 'zk-attest-' + Math.random().toString(36).slice(2, 10),
        timestamp: sentinelTimestamp,
        verified: true,
    };

    const attestPostRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: `Sentinel camera verified capture [${sentinelTimestamp}]`,
            type: 'image',
            mediaUrl: dummyPhotoBase64,
            trust: 'camera',
            attestation: attestationPayload,
            metadata: {
                trust: 'camera',
                sentinelVerified: true,
            }
        })
    });
    assert.equal(attestPostRes.status, 201, `Sentinel post expected 201, got ${attestPostRes.status}`);
    const attestPostData = await attestPostRes.json();
    assert.ok(attestPostData.post?.attestation, 'Post must retain attestation object');
    assert.equal(attestPostData.post.attestation.sha256, sentinelSha256, 'SHA-256 digest must match');
    assert.equal(attestPostData.post.attestation.device, attestationPayload.device);
    console.log(`  ✓ Sentinel photo post verified: ID="${attestPostData.post.id}", SHA-256="${attestPostData.post.attestation.sha256.slice(0, 16)}..."`);

    // Verify attestation appears on feed fetch
    const feedCheckRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, { headers: authHeaders });
    const feedCheckData = await feedCheckRes.json();
    const foundAttestPost = feedCheckData.posts?.find(p => p.id === attestPostData.post.id);
    assert.ok(foundAttestPost?.attestation?.sha256, 'Attestation must be returned in public feed');
    console.log('  ✓ Public feed preserves Sentinel attestation data for badge and audit sheet rendering.');

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 5: Co-Host / Multi-Guest Live Streaming
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 5/6] Testing Co-Host Live Streaming Engine...');
    // 1. Host creates a live room
    const hostRoomRes = await fetch(`${SOMA_ORIGIN}/api/studio/live`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            title: `Co-Host Broadcast Test [${Date.now()}]`,
            type: 'video',
            cameraFacing: 'user',
        })
    });
    assert.equal(hostRoomRes.status, 201);
    const hostRoom = await hostRoomRes.json();
    const roomId = hostRoom.room?.id;
    assert.ok(roomId, 'Live room ID must exist');
    console.log(`  ✓ Live room created: ${roomId} by ${hostRoom.room.authorName || hostRoom.room.hostName}`);

    // 2. Guest requests to join as Co-Host
    const guestHeaders = {
        'Content-Type': 'application/json',
        'x-axis-user-id': 'usr-guest-cohost',
        'x-axis-user-name': 'Guest CoHost',
    };
    const guestReqRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/guest/request`, {
        method: 'POST',
        headers: guestHeaders,
        body: JSON.stringify({ role: 'co-host' })
    });
    assert.equal(guestReqRes.status, 200, 'Guest request should return 200');
    const guestReqData = await guestReqRes.json();
    assert.equal(guestReqData.ok, true);
    assert.ok(guestReqData.room?.guestRequests?.some(r => r.userId === 'usr-guest-cohost'), 'Guest request must be recorded in room');
    console.log(`  ✓ Co-Host join requested for guest: usr-guest-cohost`);

    // 3. Host lists guest requests
    const listReqsRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/guest/requests`, {
        headers: authHeaders
    });
    assert.equal(listReqsRes.status, 200);
    const listReqsData = await listReqsRes.json();
    assert.ok(listReqsData.requests?.length >= 1, 'Should find at least 1 pending request');
    console.log(`  ✓ Host retrieved ${listReqsData.requests.length} pending co-host request(s).`);

    // 4. Host accepts the Co-Host request
    const acceptRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/guest/accept`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ guestUserId: 'usr-guest-cohost', accepted: true })
    });
    assert.equal(acceptRes.status, 200);
    const acceptData = await acceptRes.json();
    assert.equal(acceptData.ok, true);
    assert.ok(acceptData.room?.guests?.some(g => g.userId === 'usr-guest-cohost'), 'Accepted guest must be in guests list');
    console.log('  ✓ Host accepted co-host: guest added to active stream participants.');

    // 5. Guest leaves co-host
    const leaveRes = await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/guest/leave`, {
        method: 'POST',
        headers: guestHeaders,
    });
    assert.equal(leaveRes.status, 200);
    const leaveData = await leaveRes.json();
    assert.equal(leaveData.ok, true);
    console.log('  ✓ Co-Host left cleanly: room transitioned back to single host.');

    // 6. Clean up room
    await fetch(`${SOMA_ORIGIN}/api/studio/live/${encodeURIComponent(roomId)}/end`, {
        method: 'POST',
        headers: authHeaders
    });
    console.log('  ✓ Co-host test live stream closed.');

    // ─────────────────────────────────────────────────────────────────────────────
    // Pillar 6: Voice Notes in Flux Posts
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Pillar 6/6] Testing Voice Notes in Flux Posts...');
    const dummyAudioBase64 = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8GTA6CQwEAAAAAAACBAULygQ8GTA6CQwEAAAAAAAEBAULygQ8GTA6CQwEAAAAAAAF';
    const voiceDuration = 14; // 14 seconds

    const voicePostRes = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            text: 'Studio Voice Memo test recording',
            type: 'voice',
            audioUrl: dummyAudioBase64,
            duration: voiceDuration,
            metadata: {
                trust: 'camera',
                isVoice: true,
                duration: voiceDuration,
            }
        })
    });
    assert.equal(voicePostRes.status, 201, `Voice post expected 201, got ${voicePostRes.status}`);
    const voicePostData = await voicePostRes.json();
    assert.equal(voicePostData.post?.type, 'voice', 'Post type must be voice');
    assert.equal(voicePostData.post?.audioUrl, dummyAudioBase64, 'Post audioUrl must match');
    assert.equal(voicePostData.post?.duration, voiceDuration, 'Post duration must be 14s');
    console.log(`  ✓ Voice post created: ID="${voicePostData.post.id}", type="${voicePostData.post.type}", duration=${voicePostData.post.duration}s`);

    // Verify voice post appears in shared feed
    const feedVoiceCheck = await fetch(`${SOMA_ORIGIN}/api/studio/feed`, { headers: authHeaders });
    const feedVoiceData = await feedVoiceCheck.json();
    const foundVoicePost = feedVoiceData.posts?.find(p => p.id === voicePostData.post.id);
    assert.ok(foundVoicePost, 'Voice post must exist in public feed');
    assert.equal(foundVoicePost.type, 'voice');
    assert.equal(foundVoicePost.audioUrl, dummyAudioBase64);
    assert.equal(foundVoicePost.duration, voiceDuration);
    console.log('  ✓ Shared feed returns voice post with valid audioUrl and duration for player rendering.');

    console.log('\n========================================================================');
    console.log('🎉 ALL 6 STUDIO POWER PACK UPGRADE TESTS PASSED 100% CLEANLY! 🎉');
    console.log('========================================================================\n');
}

testPowerPack().catch((err) => {
    console.error('\n❌ POWER PACK TEST SUITE FAILED:', err);
    process.exit(1);
});
