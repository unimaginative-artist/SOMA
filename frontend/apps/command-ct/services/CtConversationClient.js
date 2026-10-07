import { ctAuthHeaders } from './CtAuth.js';

async function request(path, options = {}) {
  const response = await fetch(`/api/soma/ct${path}`, {
    ...options,
    headers: ctAuthHeaders({ ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `CT conversation API ${response.status}`);
  return data;
}

export const ctConversations = {
  async list(search = '') {
    const data = await request(`/conversations${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    return data.conversations || [];
  },
  async get(id) {
    const data = await request(`/conversations/${encodeURIComponent(id)}`);
    return data.conversation;
  },
  async save(conversation) {
    const data = await request(`/conversations/${encodeURIComponent(conversation.id)}`, {
      method: 'PUT', body: JSON.stringify(conversation)
    });
    return data.conversation;
  },
  async branch(id, payload = {}) {
    const data = await request(`/conversations/${encodeURIComponent(id)}/branch`, {
      method: 'POST', body: JSON.stringify(payload)
    });
    return data.conversation;
  },
  async delete(id) {
    await request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};

