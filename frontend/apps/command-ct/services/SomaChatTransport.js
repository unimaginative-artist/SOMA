import { ctAuthHeaders } from './CtAuth.js';

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutError() {
  const error = new Error('Request timed out - SOMA may be busy or temporarily unavailable');
  error.name = 'TimeoutError';
  return error;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
  const externalSignal = options.signal;
  const signal = externalSignal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([controller.signal, externalSignal])
    : externalSignal || controller.signal;

  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a Server-Sent Events body without assuming network chunks align to lines.
 * Malformed JSON is surfaced instead of silently dropping part of SOMA's answer.
 */
export async function* parseSseJsonStream(body) {
  if (!body?.getReader) throw new Error('Streaming response body is unavailable');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];

  const decodeEvent = () => {
    if (dataLines.length === 0) return null;
    const raw = dataLines.join('\n').trim();
    dataLines = [];
    if (!raw || raw === '[DONE]') return null;
    try {
      return JSON.parse(raw);
    } catch (cause) {
      const error = new Error(`Invalid SSE JSON frame: ${raw.slice(0, 160)}`);
      error.cause = cause;
      throw error;
    }
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') return decodeEvent();
    if (line.startsWith(':')) return null;
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const event = processLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const event = processLine(buffer);
      if (event) yield event;
    }
    const finalEvent = decodeEvent();
    if (finalEvent) yield finalEvent;
  } finally {
    reader.releaseLock?.();
  }
}

export class SomaChatTransport {
  constructor({ baseUrl = '/api', sessionId }) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
    this.activeController = null;
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  cancel(reason = 'Cancelled by user') {
    const error = new Error(reason);
    error.name = 'AbortError';
    this.activeController?.abort(error);
    this.activeController = null;
  }

  completeRequest(controller) {
    if (this.activeController === controller) this.activeController = null;
  }

  async fetchHistory(limit = 30) {
    const url = `${this.baseUrl}/soma/history?sessionId=${encodeURIComponent(this.sessionId)}&limit=${encodeURIComponent(limit)}`;
    const response = await fetchWithTimeout(url, { method: 'GET', headers: ctAuthHeaders() }, 10_000);
    if (!response.ok) throw new Error(`History API ${response.status}`);
    const data = await response.json();
    return data.messages || data.history || [];
  }

  async request({ message, deepThinking = false, contextFiles = [] }) {
    this.cancel('Superseded by a newer request');
    this.activeController = new AbortController();
    const controller = this.activeController;

    const response = await fetchWithTimeout(`${this.baseUrl}/soma/chat`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        signal: controller.signal,
        body: JSON.stringify({
          message,
          deepThinking,
          stream: !deepThinking,
          sessionId: this.sessionId,
          contextFiles
        })
      }, deepThinking ? 120_000 : 60_000);

    if (!response.ok) {
      this.completeRequest(controller);
      const detail = await response.text().catch(() => '');
      throw new Error(`Chat API ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return { response, controller };
  }
}
