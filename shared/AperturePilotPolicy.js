// Shared by the planner and UI executor. A model decision is a proposal, not authority.
export const PILOT_APPS = ['terminal', 'notes', 'files', 'tasks', 'status', 'swarm', 'processes', 'portal'];
export const PILOT_READ_COMMANDS = ['help', 'uname', 'uname -a', 'uptime', 'ps', 'mem', 'mount', 'dmesg', 'tool list'];
export const PILOT_ACTIONS = ['idle', 'launch_app', 'terminal_exec', 'note_create', 'file_browse', 'portal_navigate', 'soma_status', 'tile_windows', 'toggle_galaxy', 'open_spotlight'];

export function validatePilotDecision(decision, { observation, settings = {}, userDirective = '', now = Date.now() } = {}) {
    const fail = error => ({ valid: false, error });
    if (!decision || !PILOT_ACTIONS.includes(decision.action)) return fail('Unsupported pilot action');
    if (decision.action === 'idle') return { valid: true, decision: { action: 'idle', params: {}, intent: String(decision.intent || 'Standing by.').slice(0, 300) } };
    if (observation?.surface !== 'aperture' || !Array.isArray(observation.windows) || typeof observation.signature !== 'string' || !observation.id || !Number.isFinite(observation.observedAt) || now - observation.observedAt > 30000 || observation.observedAt > now + 1000) return fail('A fresh Aperture observation is required');
    if (decision.observationId && decision.observationId !== observation.id) return fail('Decision targets a different observation');
    if (settings.enabled === false || settings.locked === true) return fail('Pilot is stopped or the desktop is locked');
    if (!userDirective && Number(settings.autonomyLevel ?? 2) === 1) return fail('On-Demand mode requires a user directive');
    const permissions = settings.permissions || {};
    const p = decision.params || {};
    let params = {};
    switch (decision.action) {
        case 'tile_windows':
        case 'toggle_galaxy':
        case 'open_spotlight':
            if (!userDirective) return fail('Workspace layout changes require a user directive');
            break;
        case 'launch_app':
            if (!PILOT_APPS.includes(p.appId)) return fail('Unknown application');
            params = { appId: p.appId };
            break;
        case 'terminal_exec':
            if (!PILOT_READ_COMMANDS.includes(p.cmd)) return fail('Pilot terminal execution is limited to inspected read-only built-ins');
            params = { cmd: p.cmd };
            break;
        case 'note_create':
            if (permissions.memoryWrite === false) return fail('Memory writing is disabled');
            if (!/\b(create|write|save|record)\b[\s\S]*\b(note|reflection)\b/i.test(userDirective)) return fail('Creating a note requires an explicit note-writing directive');
            if (typeof p.content !== 'string' || !p.content.trim() || p.content.length > 12000) return fail('Note content is required (maximum 12000 characters)');
            params = { title: String(p.title || 'SOMA note').slice(0, 160), content: p.content };
            break;
        case 'file_browse':
            if (permissions.fileRead === false) return fail('File reading is disabled');
            if (typeof p.path !== 'string' || !p.path || p.path.length > 300 || /(^[\\/]|:|\x00|(^|[\\/])\.\.([\\/]|$))/.test(p.path)) return fail('Use a workspace-relative directory path');
            params = { path: p.path };
            break;
        case 'portal_navigate':
            if (permissions.networkAccess === false) return fail('Network access is disabled');
            if (typeof p.query !== 'string' || !p.query.trim() || p.query.length > 1000) return fail('A bounded research query or URL is required');
            params = { query: p.query.trim() };
            break;
    }
    return { valid: true, decision: { action: decision.action, params, intent: String(decision.intent || decision.action).slice(0, 300), observationId: observation.id } };
}

export function fallbackPilotDecision(userDirective = '', recentActions = []) {
    const q = String(userDirective).trim();
    const idle = intent => ({ action: 'idle', params: {}, intent });
    if (!q) {
        // One useful initial inspection, then wait for a goal. Window churn is not work.
        return recentActions.length ? idle('Standing by: no new desktop objective. Your workspace is unchanged.')
            : { action: 'soma_status', params: {}, intent: 'Inspecting available SOMA status; no health result assumed.' };
    }
    const cmd = q.replace(/^(run|execute|audit)\s+/i, '');
    if (PILOT_READ_COMMANDS.includes(cmd)) return { action: 'terminal_exec', params: { cmd }, intent: `Running Aperture built-in: ${cmd}` };
    const app = q.match(/^(?:open|launch)\s+(terminal|notes|files|tasks|status|swarm|processes|portal)$/i)?.[1]?.toLowerCase();
    if (app) return { action: 'launch_app', params: { appId: app }, intent: `Opening ${app}.` };
    const query = q.match(/^(?:search|research|browse)\s+(.+)$/i)?.[1];
    if (query) return { action: 'portal_navigate', params: { query }, intent: 'Opening the requested research in Portal.' };
    return idle('I could not map that directive to a verified desktop action. Try “open files”, “run ps”, or “search <topic>”.');
}
