import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { portHasListener } from '../core/PortOwnership.js';

test('an existing listener is preserved regardless of HTTP responsiveness', async t => {
    const server = net.createServer(socket => socket.destroy());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const address = server.address();
    assert.equal(await portHasListener(address.port), true);
});

test('a refused local port is available for a new listener', async () => {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    assert.equal(await portHasListener(port), false);
});
