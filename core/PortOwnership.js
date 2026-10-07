import net from 'node:net';

// A slow HTTP handler is not evidence that its process is dead. The launcher
// only needs to know whether another process owns the local listener; recovery
// of an unresponsive owner belongs to Marionette's supervised lifecycle.
export function portHasListener(port, { host = '127.0.0.1', timeoutMs = 1500 } = {}) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port });
        let settled = false;
        const finish = occupied => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(occupied);
        };
        socket.setTimeout(timeoutMs, () => finish(true));
        socket.once('connect', () => finish(true));
        socket.once('error', error => finish(error?.code !== 'ECONNREFUSED'));
    });
}
