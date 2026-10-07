export interface StudioActor {
  userId: string;
  displayName: string;
  avatar?: string;
}

function ensureDeviceId() {
  let deviceId = localStorage.getItem('studio_device_id');
  if (!deviceId) {
    deviceId = `dev-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    localStorage.setItem('studio_device_id', deviceId);
  }
  return deviceId;
}

export function studioActor(): StudioActor | null {
  try {
    const user = JSON.parse(localStorage.getItem('studio_user_v2') || 'null');
    if (user?.userId || user?.id) {
      return {
        userId: user.userId || user.id,
        displayName: user.displayName || user.name || user.handle || 'Studio User',
        avatar: user.avatar || '',
      };
    }
  } catch {}
  try {
    const user = JSON.parse(localStorage.getItem('axis_user_v2') || 'null');
    if (user?.id) {
      return { userId: user.id, displayName: user.name || user.handle || 'Studio User', avatar: user.avatar || '' };
    }
  } catch {}
  return null;
}

export function studioHeaders(json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  try {
    const token = localStorage.getItem('studio_session_token') || localStorage.getItem('studio_session_v1');
    if (token) headers.Authorization = `Bearer ${token}`;
    headers['x-studio-device-id'] = ensureDeviceId();
    headers['x-studio-device-name'] = 'Command Studio';
    headers['x-studio-device-type'] = 'command-bridge';
  } catch {}
  return headers;
}

export async function studioRequest<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: init.method && init.method !== 'GET' ? undefined : 'no-store',
    ...init,
    headers: { ...studioHeaders(init.body !== undefined), ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Studio request failed (${response.status})`);
  }
  return payload as T;
}

export function studioMutationBody(body: Record<string, unknown> = {}) {
  const actor = studioActor();
  return JSON.stringify({ ...(actor || {}), ...body });
}
