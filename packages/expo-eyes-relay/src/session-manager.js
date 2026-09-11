/**
 * session-manager.js — tracks connected phones and pending tool calls.
 *
 * One phone per session (v1). The session ID is the phone's hello token's
 * first 8 chars — short, opaque, stable for the connection's lifetime.
 *
 * Tool calls from the agent are routed to the currently-connected phone.
 * If no phone is connected, the call fails immediately with a clear error.
 *
 * Pending calls: Map<callId, { resolve, reject, timer }>
 *  - We keep the agent's HTTP request alive until the phone responds or
 *    the timeout fires.
 */

const config = require('./config');

class SessionManager {
  constructor() {
    /** Currently connected phone WebSocket, or null. */
    this.phoneWs = null;
    /** Phone metadata from hello. */
    this.phoneInfo = null;
    /** Map<callId, { resolve, reject, timer, tool, startedAt }> */
    this.pendingCalls = new Map();
    /** Event log (capped at 1000 entries). */
    this.eventLog = [];
    /** Listeners for state changes (UI / activity panel). */
    this.listeners = new Set();
  }

  onPhoneConnected(ws, hello) {
    this.phoneWs = ws;
    this.phoneInfo = hello;
    this._notifyListeners('phone-connected', { info: hello });
    this._log('phone-connected', { app: hello.app });
  }

  onPhoneDisconnected() {
    // Fail any pending calls
    for (const [callId, entry] of this.pendingCalls.entries()) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error('phone disconnected before responding'), { code: 'PHONE_DISCONNECTED' }));
      this.pendingCalls.delete(callId);
    }
    this.phoneWs = null;
    this.phoneInfo = null;
    // Clear the tool-router's cached state too
    try {
      const { resetSession } = require('./tool-router');
      resetSession();
    } catch (e) { /* tool-router not loaded yet — ignore */ }
    this._notifyListeners('phone-disconnected', {});
    this._log('phone-disconnected', {});
  }

  isPhoneConnected() {
    return this.phoneWs !== null && this.phoneWs.readyState === 1; // WebSocket.OPEN
  }

  /**
   * Send a tool call to the phone and return a Promise that resolves with
   * the phone's result. Rejects on timeout or phone disconnect.
   *
   * This is the LOW-LEVEL primitive call. Agent-facing tools (inspect, tap,
   * etc.) are implemented in tool-router.js, which uses this method.
   */
  callTool(tool, args) {
    return new Promise((resolve, reject) => {
      if (!this.isPhoneConnected()) {
        reject(Object.assign(new Error('No phone connected. Start the app and make sure it can reach the relay.'), { code: 'NO_PHONE' }));
        return;
      }

      const callId = `c${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        if (this.pendingCalls.has(callId)) {
          this.pendingCalls.delete(callId);
          reject(Object.assign(new Error(`Tool "${tool}" timed out after ${config.toolTimeoutMs}ms`), { code: 'TIMEOUT' }));
          this._log('tool-timeout', { callId, tool });
        }
      }, config.toolTimeoutMs);

      this.pendingCalls.set(callId, { resolve, reject, timer, tool, startedAt });

      // Send to phone
      const message = JSON.stringify({ type: 'tool-call', callId, tool, args: args || {} });
      try {
        this.phoneWs.send(message);
      } catch (e) {
        clearTimeout(timer);
        this.pendingCalls.delete(callId);
        reject(Object.assign(new Error(`Failed to send to phone: ${e.message}`), { code: 'WS_SEND_FAILED' }));
        return;
      }

      this._log('tool-call-sent', { callId, tool, args });
    });
  }

  /** Called when a tool-result arrives from the phone. */
  resolveToolResult(message) {
    const { callId, ok, result, error, refsStillValid, durationMs } = message;
    const entry = this.pendingCalls.get(callId);
    if (!entry) {
      // Stale result — phone probably responded after timeout. Log and drop.
      this._log('tool-result-stale', { callId, ok });
      return;
    }
    clearTimeout(entry.timer);
    this.pendingCalls.delete(callId);

    this._log('tool-result-received', { callId, tool: entry.tool, ok, durationMs });

    if (ok) {
      entry.resolve({ ...result, refsStillValid, durationMs });
    } else {
      const e = Object.assign(new Error(error.message), { code: error.code, stack: error.stack });
      entry.reject(e);
    }
  }

  /** Push a phone-emitted event (log/error) into the log buffer. */
  pushEvent(event) {
    this.eventLog.push(event);
    if (this.eventLog.length > 1000) {
      this.eventLog.shift();
    }
    this._notifyListeners('event', event);
  }

  /** Subscribe to state changes. Returns an unsubscribe fn. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    return {
      phoneConnected: this.isPhoneConnected(),
      phoneInfo: this.phoneInfo,
      pendingCalls: this.pendingCalls.size,
      eventLogSize: this.eventLog.length,
    };
  }

  getRecentEvents(count = 100) {
    return this.eventLog.slice(-count);
  }

  _notifyListeners(event, data) {
    for (const listener of this.listeners) {
      try { listener(event, data); } catch {}
    }
  }

  _log(event, data) {
    if (config.verbose) {
      console.log(`[session] ${event}`, data || '');
    }
  }
}

// Singleton — one relay = one session (one phone at a time in v1)
module.exports = new SessionManager();
