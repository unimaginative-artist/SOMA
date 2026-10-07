const { URL } = require('url');

const endpoint = 'http://192.168.1.250:11434';
const url = new URL('/api/generate', endpoint);

console.log('Endpoint:', endpoint);
console.log('URL object:', url);
console.log('hostname:', url.hostname);
console.log('port:', url.port);
console.log('path:', url.pathname);
console.log('Full URL:', url.href);
