import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, port, rejectTwo] = process.argv.slice(2);
const { value } = await import(pathToFileURL(path.join(root, 'core/counter.js')));
if (rejectTwo === 'true' && value === 2) throw new Error('Deliberate candidate boot failure');
http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', value, pid: process.pid }));
}).listen(Number(port), '127.0.0.1');
