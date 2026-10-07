function getStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: () => null,
    setItem: () => {}
  };
}

function deviceId() {
  const storage = getStorage();
  let value = storage.getItem('studio_device_id');
  if (!value) {
    value = `dev-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    storage.setItem('studio_device_id', value);
  }
  return value;
}

export function ctAuthHeaders(extra = {}) {
  const storage = getStorage();
  const token = storage.getItem('studio_session_token') || storage.getItem('studio_session_v1');
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-studio-device-id': deviceId(),
    'x-studio-device-name': 'SOMA Cognitive Terminal',
    'x-studio-device-type': 'command-ct'
  };
}

