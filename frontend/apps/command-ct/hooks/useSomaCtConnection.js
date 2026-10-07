import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const INITIAL_STATE = Object.freeze({
  http: 'checking',
  realtime: 'connecting',
  approvals: 'connecting'
});

export function useSomaCtConnection({ onApproval, onTrace, onGoalEvent }) {
  const [connection, setConnection] = useState(INITIAL_STATE);
  const [socket, setSocket] = useState(null);
  const callbacks = useRef({ onApproval, onTrace, onGoalEvent });
  callbacks.current = { onApproval, onTrace, onGoalEvent };

  useEffect(() => {
    let mounted = true;
    const socketUrl = import.meta.env?.DEV
      ? undefined
      : `${window.location.protocol}//${window.location.hostname}:${import.meta.env?.VITE_BACKEND_PORT || '3001'}`;
    const client = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000
    });
    setSocket(client);

    const update = (patch) => mounted && setConnection(previous => ({ ...previous, ...patch }));
    client.on('connect', () => update({ realtime: 'online', approvals: 'online' }));
    client.on('disconnect', () => update({ realtime: 'offline', approvals: 'offline' }));
    client.on('connect_error', () => update({ realtime: 'offline', approvals: 'offline' }));
    client.on('approval_required', request => callbacks.current.onApproval?.(request));
    client.on('trace', payload => callbacks.current.onTrace?.(payload));

    for (const eventName of ['goal_created', 'goal_started', 'goal_completed', 'goal_failed']) {
      client.on(eventName, payload => callbacks.current.onGoalEvent?.(eventName, payload));
    }

    const checkHttp = async () => {
      update({ http: 'checking' });
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.timeout(5_000) });
        update({ http: response.ok ? 'online' : 'offline' });
      } catch {
        update({ http: 'offline' });
      }
    };

    checkHttp();
    const healthInterval = setInterval(checkHttp, 30_000);
    return () => {
      mounted = false;
      clearInterval(healthInterval);
      client.disconnect();
    };
  }, []);

  return { socket, connection };
}
