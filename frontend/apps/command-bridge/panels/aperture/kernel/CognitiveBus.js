/**
 * CognitiveBus — Cross-App Drag-and-Drop & Cognitive Event Bus for ApertureOS
 * Enables dragging artifacts (files, errors, tasks, memory nodes) across windows
 * and piping them directly into receiving apps.
 */

class CognitiveBus {
  constructor() {
    this.activePayload = null;
    this.listeners = new Set();
  }

  startDrag(type, data) {
    this.activePayload = { type, data, timestamp: Date.now() };
    this._notify('drag-start', this.activePayload);
  }

  endDrag() {
    const prev = this.activePayload;
    this.activePayload = null;
    this._notify('drag-end', prev);
  }

  getPayload() {
    return this.activePayload;
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify(event, payload) {
    for (const fn of this.listeners) {
      try {
        fn(event, payload);
      } catch (err) {
        console.error('[CognitiveBus] listener error:', err);
      }
    }
  }

  pipeToApp(appId, targetAction, payload) {
    window.dispatchEvent(new CustomEvent('aperture:cognitive-pipe', {
      detail: { appId, targetAction, payload: payload || this.activePayload }
    }));
  }
}

const cognitiveBus = new CognitiveBus();
export default cognitiveBus;
