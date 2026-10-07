const describeEndpoint = (input) => {
  if (typeof input === 'string') return input;
  return input?.url || 'API request';
};

export async function readJsonResponse(response, label = 'API request') {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    const returnedHtml = /^\s*<!doctype html|^\s*<html/i.test(body);
    throw new Error(
      returnedHtml
        ? `${label} reached a web page instead of its API route (${response.status})`
        : `${label} returned ${contentType || 'a non-JSON response'} (${response.status})`,
    );
  }

  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`${label} returned malformed JSON (${response.status})`);
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `${label} failed (${response.status})`);
  }

  return data;
}

export async function jsonRequest(input, init) {
  const response = await fetch(input, init);
  return readJsonResponse(response, describeEndpoint(input));
}
