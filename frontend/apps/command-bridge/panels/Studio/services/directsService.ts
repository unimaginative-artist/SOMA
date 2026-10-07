import { ChatMessage, ChatSession } from '../types';

export const axisHeaders = () => {
  let axisUser: any = null;
  try { axisUser = JSON.parse(localStorage.getItem('axis_user_v2') || 'null'); } catch {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-axis-user-id': axisUser?.id || 'studio-user',
    'x-axis-user-name': axisUser?.name || 'Studio User',
    'x-axis-user-color': axisUser?.color || 'violet',
  };
  try {
    const token = localStorage.getItem('studio_session_v1');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {}
  return headers;
};

export async function getDirects() {
  const response = await fetch('/api/axis/directs', { headers: axisHeaders() });
  if (!response.ok) throw new Error('Axis Directs unavailable');
  return response.json();
}

export async function startDirect(target: { id?: string; name?: string; title?: string; image?: string; avatar?: string; color?: string }) {
  const targetName = target.name || target.title || target.id || 'Direct';
  const targetUserId = target.id || `direct-${String(targetName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const response = await fetch('/api/axis/directs', {
    method: 'POST',
    headers: axisHeaders(),
    body: JSON.stringify({
      targetUserId,
      targetUserName: targetName,
      targetUserColor: target.color,
      image: target.image || target.avatar,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Unable to start Direct');
  return data.direct as ChatSession;
}

export async function getDirectMessages(chat: ChatSession) {
  const axisChat = chat.axisSource === 'axis' ? chat : await startDirect({
    id: chat.id,
    name: chat.title,
    image: chat.image,
    color: (chat as any).color,
  });
  const endpoint = `/api/axis/directs/${axisChat.id}/messages`;
  const response = await fetch(endpoint, { headers: axisHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Direct messages unavailable');
  return data.messages as ChatMessage[];
}

export async function sendDirectMessage(chat: ChatSession, text: string, avatar?: string) {
  const axisChat = chat.axisSource === 'axis' ? chat : await startDirect({
    id: chat.id,
    name: chat.title,
    image: chat.image,
    color: (chat as any).color,
  });
  const endpoint = `/api/axis/directs/${axisChat.id}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: axisHeaders(),
    body: JSON.stringify({ text, avatar }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Direct send failed');
  return data.messages as ChatMessage[];
}

export async function searchDirectMessages(chat: ChatSession, query: string) {
  if (!query.trim()) return [];
  const axisChat = chat.axisSource === 'axis' ? chat : await startDirect({
    id: chat.id,
    name: chat.title,
    image: chat.image,
    color: (chat as any).color,
  });
  const params = new URLSearchParams({ q: query.trim() });
  const response = await fetch(`/api/axis/directs/${axisChat.id}/search?${params}`, { headers: axisHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) return [];
  return data.results || [];
}
