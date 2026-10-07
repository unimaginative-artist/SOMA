const state = document.getElementById('state');
const replies = document.getElementById('replies');
const source = new EventSource('/api/social/twitch/overlay/events');
source.addEventListener('state', event => {
    try {
        const data = JSON.parse(event.data);
        state.textContent = data.connected ? 'SOMA • Twitch chat connected' : `SOMA • ${data.state || 'offline'}`;
    } catch { state.textContent = 'SOMA • invalid overlay signal'; }
});
source.addEventListener('reply', event => {
    try {
        const data = JSON.parse(event.data);
        if (typeof data.text !== 'string' || !data.text.trim()) return;
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = `SOMA / #${String(data.channel || '').slice(0,25)}`;
        const text = document.createElement('div');
        text.textContent = data.text.slice(0,500); // No HTML from chat/model.
        bubble.append(label, text);
        replies.append(bubble);
        while (replies.children.length > 3) replies.firstChild.remove();
        setTimeout(() => bubble.remove(), 20000);
    } catch { /* ignore malformed public packet */ }
});
source.onerror = () => { state.textContent = 'SOMA • overlay reconnecting'; };
window.addEventListener('pagehide', () => source.close());
