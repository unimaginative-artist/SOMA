import { ChatMessage, ChatSession } from '../types';

/* ============================================================================
   Secure directs — the "Pathway" (sealed + ephemeral) mode of a Direct (GMN 7c).
   Web mirror of the Studio mobile StudioAPI.{resolveNode,loadSecure,sendSecure,
   openSecure}. A message is end-to-end SEALED (X25519+AES-GCM) through the GMN
   engine, addressed to the recipient's home node, separated from other threads
   on that node by `convo` = the chat id. Same-origin fetch (SOMA serves us).
   ========================================================================== */

interface NodeRef { nodeId: string; encPub: string; local: boolean; }

const nodeCache: Record<string, NodeRef> = {};

async function j(path: string, init?: RequestInit): Promise<any> {
  try {
    const r = await fetch(path, init);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Resolve a Studio friend/chat → the gmn node identity that hosts them. */
export async function resolveNode(userId: string): Promise<NodeRef | null> {
  if (nodeCache[userId]) return nodeCache[userId];
  const r = await j(`/api/gmn/resolve/${encodeURIComponent(userId)}`);
  if (r && r.success && r.nodeId && r.encPub) {
    const ref: NodeRef = { nodeId: r.nodeId, encPub: r.encPub, local: !!r.local };
    nodeCache[userId] = ref;
    return ref;
  }
  return null;
}

const stamp = (ts: number) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Load the sealed thread for a direct, mapped into ChatMessage (secure: true). */
export async function loadSecureMessages(chat: ChatSession): Promise<ChatMessage[]> {
  const convo = String(chat.id);
  const node = await resolveNode(convo);
  if (!node) return [];
  const r = await j(`/api/gmn/dm/${encodeURIComponent(node.nodeId)}?convo=${encodeURIComponent(convo)}`);
  const list: any[] = (r && Array.isArray(r.messages)) ? r.messages : [];
  return list.map(m => ({
    id: m.id,
    msgId: m.id,
    text: m.text || '',
    sender: (m.dir === 'out' ? 'user' : 'other') as 'user' | 'other',
    timestamp: stamp(m.createdAt),
    ts: m.createdAt || 0,
    secure: true,
    ttl: m.ttl || 0,
    viewOnce: !!m.viewOnce,
    locked: !!m.locked,
    expiresAt: m.expiresAt || null,
    media: m.media || null,
    mediaType: m.mediaType || null,
    deliveredAt: m.deliveredAt || null,
    readAt: m.readAt || null,
    screenshot: !!m.screenshot,
    status: m.status || 'sent',
  }));
}

/** Seal + send a message on the Pathway (secure) lane. */
export async function sendSecureMessage(
  chat: ChatSession,
  text: string,
  opts: { ttl?: number; viewOnce?: boolean; media?: string | null; mediaType?: string | null } = {},
): Promise<boolean> {
  const convo = String(chat.id);
  const node = await resolveNode(convo);
  if (!node) return false;
  const r = await j(`/api/gmn/dm/${encodeURIComponent(node.nodeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      encPub: node.encPub,
      convo,
      ttl: opts.ttl || 0,
      viewOnce: !!opts.viewOnce,
      burnOnReadMs: opts.viewOnce ? 12000 : 0,
      media: opts.media || null,
      mediaType: opts.mediaType || null,
    }),
  });
  return !!(r && r.success);
}

/** Report a screenshot of a sealed message → the sender is notified. */
export async function screenshotSecureMessage(chat: ChatSession, msgId: string): Promise<boolean> {
  const node = await resolveNode(String(chat.id));
  if (!node) return false;
  const r = await j(`/api/gmn/dm/${encodeURIComponent(node.nodeId)}/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgId }),
  });
  return !!(r && r.success);
}

/** Open a sealed message (reveals view-once, starts burn-on-read). */
export async function openSecureMessage(chat: ChatSession, msgId: string): Promise<boolean> {
  const node = await resolveNode(String(chat.id));
  if (!node) return false;
  const r = await j(`/api/gmn/dm/${encodeURIComponent(node.nodeId)}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgId }),
  });
  return !!(r && r.success);
}
