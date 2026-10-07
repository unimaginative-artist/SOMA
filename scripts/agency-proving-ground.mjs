const base = String(process.env.SOMA_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const [command = 'list', argument] = process.argv.slice(2);

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || body.success === false) throw new Error(body.error || body.run?.error || `HTTP ${response.status}`);
  return body;
}

let result;
if (command === 'start') {
  result = await request('/api/agency-proving-ground/runs', {
    method: 'POST',
    body: JSON.stringify({ trialId: argument || 'computer-search-and-report', requestedBy: 'agency-proving-ground-cli' })
  });
} else if (command === 'status') {
  if (!argument) throw new Error('Usage: npm run agency:prove -- status <run-id>');
  result = await request(`/api/agency-proving-ground/runs/${encodeURIComponent(argument)}`);
} else if (command === 'trials') {
  result = await request('/api/agency-proving-ground/trials');
} else if (command === 'list') {
  result = await request('/api/agency-proving-ground/runs');
} else {
  throw new Error(`Unknown command: ${command}`);
}

console.log(JSON.stringify(result, null, 2));
