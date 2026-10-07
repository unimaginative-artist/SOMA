import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SOMA_ORIGIN = process.env.SOMA_ORIGIN || 'http://127.0.0.1:3001';
const MOBILE_DEV_ORIGIN = process.env.MOBILE_DEV_ORIGIN || 'http://127.0.0.1:8088';

console.log(`[TEST SUITE] Starting Axis & Directs Messaging E2E Tests against ${SOMA_ORIGIN}...`);

async function testAxisAndDirects() {
    const testDeviceId = 'axis-e2e-runner-' + Date.now();
    const commonHeaders = {
        'Content-Type': 'application/json',
        'x-studio-device-id': testDeviceId,
        'x-studio-device-name': 'Axis E2E Tester',
        'x-studio-device-type': 'automated-tester',
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Session Setup & Verified Identity
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[1/6] Bootstrapping Studio & Axis Identity...');
    const bootRes = await fetch(`${SOMA_ORIGIN}/api/studio/identity/bootstrap`, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({ surface: 'axis-e2e-test' })
    });
    assert.equal(bootRes.status, 200, `Bootstrap expected 200, got ${bootRes.status}`);
    const bootData = await bootRes.json();
    assert.ok(bootData.token, 'Must return signed token');
    const u = bootData.user;
    console.log(`  ✓ Bootstrapped as ${u.displayName} (@${u.handle}) [ID: ${u.userId}]`);

    const authHeaders = {
        ...commonHeaders,
        Authorization: `Bearer ${bootData.token}`,
        'x-axis-user-id': u.userId,
        'x-axis-user-name': u.displayName,
        'x-axis-user-color': 'violet',
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Workspaces Lifecycle
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[2/6] Testing Axis Workspaces Hub...');
    const wsListRes = await fetch(`${SOMA_ORIGIN}/api/axis/workspaces`, { headers: authHeaders });
    assert.equal(wsListRes.status, 200, 'Workspaces list expected 200');
    const wsListData = await wsListRes.json();
    assert.equal(wsListData.ok, true);
    assert.ok(Array.isArray(wsListData.workspaces), 'Workspaces must be an array');
    console.log(`  ✓ Retrieved ${wsListData.workspaces.length} workspace(s): [${wsListData.workspaces.map(w => w.name).join(', ')}]`);

    // Create a new test workspace
    const testWsName = `Operations Test [${Date.now()}]`;
    const createWsRes = await fetch(`${SOMA_ORIGIN}/api/axis/workspaces`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            name: testWsName,
            icon: 'engineering',
            color: 'cyan',
            type: 'workspace',
            description: 'Automated test workspace for operational channels.',
        })
    });
    assert.equal(createWsRes.status, 200);
    const createWsData = await createWsRes.json();
    assert.equal(createWsData.ok, true);
    const testWs = createWsData.workspace;
    assert.ok(testWs?.id, 'Created workspace must have an ID');
    assert.equal(testWs.name, testWsName);
    console.log(`  ✓ Created test workspace: "${testWs.name}" (ID: ${testWs.id})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Workspace Channels & Messaging
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[3/6] Testing Channels & Group Messaging...');
    const createChRes = await fetch(`${SOMA_ORIGIN}/api/axis/channels`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            workspaceId: testWs.id,
            name: 'war-room',
            type: 'text',
            description: 'Critical tactical dispatch channel',
        })
    });
    assert.equal(createChRes.status, 200);
    const createChData = await createChRes.json();
    assert.equal(createChData.ok, true);
    const testCh = createChData.channel;
    assert.ok(testCh?.id, 'Created channel must have an ID');
    console.log(`  ✓ Created channel: #${testCh.name} (ID: ${testCh.id})`);

    // List channels in this workspace
    const listChRes = await fetch(`${SOMA_ORIGIN}/api/axis/channels?workspaceId=${encodeURIComponent(testWs.id)}`, { headers: authHeaders });
    const listChData = await listChRes.json();
    assert.ok(listChData.channels?.some(c => c.id === testCh.id), 'Created channel must appear in channels list');
    console.log(`  ✓ Channels verified in workspace: ${listChData.channels.length} channel(s)`);

    // Send a message into the channel
    const testMsgText = `Tactical update signal dispatched at ${Date.now()}`;
    const sendMsgRes = await fetch(`${SOMA_ORIGIN}/api/axis/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            channelId: testCh.id,
            content: testMsgText,
            mode: 'archive',
        })
    });
    assert.equal(sendMsgRes.status, 200);
    const sendMsgData = await sendMsgRes.json();
    assert.equal(sendMsgData.ok, true);
    const msgId = sendMsgData.message?.id;
    assert.ok(msgId, 'Message must have an ID');
    console.log(`  ✓ Sent channel message: ID="${msgId}"`);

    // Fetch messages in the channel
    const getMsgsRes = await fetch(`${SOMA_ORIGIN}/api/axis/messages?channelId=${encodeURIComponent(testCh.id)}`, { headers: authHeaders });
    const getMsgsData = await getMsgsRes.json();
    assert.ok(getMsgsData.messages?.some(m => m.id === msgId && m.content === testMsgText), 'Sent message must be retrieved in channel');
    console.log(`  ✓ Retrieved channel message history (${getMsgsData.messages.length} messages)`);

    // Add reaction to message
    const reactRes = await fetch(`${SOMA_ORIGIN}/api/axis/messages/${encodeURIComponent(msgId)}/react`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ emoji: '⚡', remove: false })
    });
    assert.equal(reactRes.status, 200);
    const reactData = await reactRes.json();
    assert.equal(reactData.ok, true);
    assert.ok(reactData.reactions?.['⚡']?.includes(u.userId), 'Reaction must include current user');
    console.log(`  ✓ Added reaction "⚡" to message ${msgId}`);

    // Clean up test workspace
    await fetch(`${SOMA_ORIGIN}/api/axis/workspaces/${encodeURIComponent(testWs.id)}`, {
        method: 'DELETE',
        headers: authHeaders
    });
    console.log(`  ✓ Cleaned up test workspace ${testWs.id}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Directs Hub (1-on-1 Messages & DMs)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[4/6] Testing Directs (1-on-1 DMs & Contact Sync)...');
    const directsListRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs`, { headers: authHeaders });
    assert.equal(directsListRes.status, 200);
    const directsListData = await directsListRes.json();
    assert.equal(directsListData.ok, true);
    assert.ok(Array.isArray(directsListData.directs), 'Directs must be an array');
    console.log(`  ✓ Directs Hub loaded with ${directsListData.directs.length} existing direct conversation(s).`);

    // Create or ensure a Direct conversation with a target contact
    const targetUserId = `usr-test-peer-${Date.now()}`;
    const targetUserName = 'Athena Vanguard';
    const ensureDirectRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            targetUserId,
            targetUserName,
            targetUserColor: 'emerald',
        })
    });
    assert.equal(ensureDirectRes.status, 200);
    const ensureDirectData = await ensureDirectRes.json();
    assert.equal(ensureDirectData.ok, true);
    const directChannel = ensureDirectData.direct;
    assert.ok(directChannel?.id, 'Direct conversation must have a channel ID');
    console.log(`  ✓ Ensured Direct conversation channel: "${directChannel.title}" (ID: ${directChannel.id})`);

    // Send a Direct Message
    const dmText = `Private encrypted communication ping [${Date.now()}]`;
    const sendDmRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs/${encodeURIComponent(directChannel.id)}/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: dmText })
    });
    assert.equal(sendDmRes.status, 200);
    const sendDmData = await sendDmRes.json();
    assert.equal(sendDmData.ok, true);
    console.log(`  ✓ Dispatched Direct Message to ${directChannel.title}`);

    // Fetch Direct Messages history
    const getDmRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs/${encodeURIComponent(directChannel.id)}/messages`, { headers: authHeaders });
    assert.equal(getDmRes.status, 200);
    const getDmData = await getDmRes.json();
    assert.equal(getDmData.ok, true);
    const foundDm = getDmData.messages?.find(m => m.text === dmText);
    assert.ok(foundDm, 'Direct message must be found in conversation history');
    assert.equal(foundDm.sender, 'user', 'Sender should be current user');
    console.log(`  ✓ Verified Direct Message in conversation history: "${foundDm.text}"`);

    // Search across Directs
    const searchRes = await fetch(`${SOMA_ORIGIN}/api/axis/directs-search?q=${encodeURIComponent('Private encrypted')}`, { headers: authHeaders });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(searchData.results?.some(r => r.matches?.some(m => m.text.includes('Private encrypted'))), 'Search must return the matching direct message');
    console.log(`  ✓ Directs search successfully matched message across conversation threads.`);

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Send Button Character & Entity Cleanliness Check
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[5/6] Verifying Send Button & JSX Entity Integrity...');
    const workspaceViewPath = path.resolve('frontend/apps/command-bridge/panels/Axis/AxisWorkspaceView.jsx');
    const workspaceViewSrc = fs.readFileSync(workspaceViewPath, 'utf8');

    // Assert that raw &nearr; or &nearr: does NOT exist on the send button
    assert.ok(!workspaceViewSrc.includes('&nearr;'), 'AxisWorkspaceView.jsx must not contain literal &nearr;');
    assert.ok(!workspaceViewSrc.includes('&nearr:'), 'AxisWorkspaceView.jsx must not contain literal &nearr:');
    assert.ok(workspaceViewSrc.includes('title="Send"'), 'Chat send button must have proper title');
    assert.ok(workspaceViewSrc.includes('↗'), 'Chat send button must render clean unicode arrow ↗');
    console.log('  ✓ Verified send button renders clean unicode arrow ↗ with no HTML entity leaks.');

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Cross-Surface Client Assets Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[6/6] Verifying Cross-Surface Mobile PWA & Desktop Stage Assets...');
    const mobileAxisRes = await fetch(`${MOBILE_DEV_ORIGIN}/studio-axis.jsx`);
    assert.equal(mobileAxisRes.status, 200, 'studio-axis.jsx must be served');
    const mobileWorkspacesRes = await fetch(`${MOBILE_DEV_ORIGIN}/studio-workspaces.jsx`);
    assert.equal(mobileWorkspacesRes.status, 200, 'studio-workspaces.jsx must be served');
    console.log('  ✓ Mobile PWA Axis & Workspaces client modules accessible (HTTP 200).');

    console.log('\n========================================================================');
    console.log('🎉 ALL AXIS, DIRECTS, AND WORKSPACES TESTS PASSED 100% CLEANLY! 🎉');
    console.log('========================================================================\n');
}

testAxisAndDirects().catch(err => {
    console.error('\n❌ AXIS & DIRECTS TEST FAILED:', err);
    process.exit(1);
});
