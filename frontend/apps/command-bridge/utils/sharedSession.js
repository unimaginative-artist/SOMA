/**
 * Shared persistent session ID — all SOMA surfaces (CT, FloatingChat, Orb) use the same key
 * so conversation context flows seamlessly across tabs and page refreshes.
 */
export function getSharedSessionId() {
    let id = localStorage.getItem('soma_session_id');
    if (!id) {
        id = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem('soma_session_id', id);
    }
    return id;
}
