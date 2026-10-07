export async function requestSupervisorRestart({
    service = 'soma',
    baseUrl = process.env.MARIONETTE_URL || 'http://127.0.0.1:9000',
    fetchImpl = fetch,
    timeoutMs = 2500,
    reason = '',
    requestedBy = ''
} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/reset/${encodeURIComponent(service)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // Marionette records these so restarts are attributable (several weren't)
            body: JSON.stringify({ reason: String(reason || ''), requestedBy: String(requestedBy || '') }),
            signal: controller.signal
        });
        let body = {};
        try { body = await response.json(); } catch {}
        return { accepted: response.ok && !body.error, status: response.status, body };
    } catch (error) {
        return { accepted: false, error: error.message };
    } finally {
        clearTimeout(timer);
    }
}

export default requestSupervisorRestart;
