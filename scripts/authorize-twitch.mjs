import fs from 'node:fs/promises';
import path from 'node:path';
import { TwitchDeviceAuth, TwitchProtectedStore } from '../server/social/TwitchDeviceAuth.js';

// Operator-only local helper, not an LLM tool. Outputs no credential values.
const directory = path.join(process.cwd(), '.soma');
await fs.mkdir(directory, { recursive: true });
const lockPath = path.join(directory, 'twitch-auth.lock');
let lock;
try {
    lock = await fs.open(lockPath, 'wx', 0o600);
    const store = new TwitchProtectedStore(directory);
    const [action, clientId, username] = process.argv.slice(2);
    const polls = action?.startsWith('polls-');
    const channel = action === 'polls-start' ? username : clientId;
    const auth = new TwitchDeviceAuth({ store, ...(polls ? { purpose: 'polls', username: channel } : {}) });
    let result;
    if (action === 'start') result = await auth.start(clientId, username);
    else if (action === 'polls-start') result = await auth.start(clientId, channel);
    else if (action === 'polls-finish') result = await auth.finish();
    else if (action === 'polls-cancel') { await store.clear(auth.slot('device-session')); result = { state: 'cancelled', connected: false }; }
    else if (action === 'finish') result = await auth.finish();
    else if (action === 'cancel') { await store.clear('device-session'); result = { state: 'cancelled', connected: false }; }
    else throw new Error('Usage: start CLIENT_ID BOT_USERNAME | finish | cancel | polls-start CLIENT_ID CHANNEL | polls-finish CHANNEL | polls-cancel CHANNEL');
    console.log(JSON.stringify(result));
} catch (err) {
    console.error(err.code === 'EEXIST' ? 'Another Twitch authorization operation is active; retry after it finishes' : err.message);
    process.exitCode = 1;
} finally {
    if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }); }
}
