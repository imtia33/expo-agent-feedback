/**
 * session-manager.js — tracks connected phones and pending tool calls.
 *
 * Multi-phone support (v2): tracks a Map of connected phones keyed by a
 * session ID. When the agent calls a tool, the call is routed to the
 * "active" phone — which prefers native (ios/android) over web. This is
 * critical for the sandbox: the web preview's EyesProvider and Expo Go on
 * a phone both connect, but tool calls should go to the native app.
 *
 * Phone preference order:
 *   1. ios / android (Expo Go on a real device or simulator)
 *   2. web (browser preview — useful for development but not the target)
 *
 * Pending calls: Map<callId, { resolve, reject, timer, tool, startedAt }>
 *  - We keep the agent's HTTP request alive until the phone responds or
 *    the timeout fires.
 */

const config = require('./config');

class SessionManager {
  constructor() {
    /**
     * Map<sessionId, { ws, hello, platform }> of all connected phones.
     * sessionId is derived from the hello (token prefix + random).
     */
    this.phones = new Map();
    /** Map<callId, { resolve, reject, timer, tool, startedAt, sessionId }> */
    this.pendingCalls = new Map();
    /** Event log (capped at 1000 entries). */
    this.eventLog = [];
    /** Listeners for state changes (UI / activity panel). */
    this.listeners = new Set();
  }

  /** Generate a session ID from the hello message. */
  _sessionId(hello) {
    const app = hello?.app?.name || 'unknown';
    const platform = this._platformFromHello(hello);
    // Include a random suffix so two phones with the same app name don't collide
    const rand = Math.random().toString(36).slice(2, 8);
    return `${platform}-${app}-${rand}`;
  }

  /** Determine the platform from the hello message. */
  _platformFromHello(hello) {
    const name = hello?.app?.name || '';
    // Expo Go on iOS sends app.name = 'ios', Android = 'android'
    if (name === 'ios' || name === 'android') return name;
    // Some versions send 'host.exp.exponent' or the app slug
    if (name.includes('exponent') || name.includes('expo')) {
      // Can't easily tell ios vs android from the name alone — check sdkVersion?
      return 'native';
    }
    return name; // 'web', 'test-native', etc.
  }

  onPhoneConnected(ws, hello) {
    const sessionId = this._sessionId(hello);
    const platform = this._platformFromHello(hello);

    // Dedupe by platform: if a phone of the same platform is already
    // connected, close the old connection. This prevents zombie buildup
    // from Expo Go reconnecting (HMR, reload) or the web preview re-opening.
    // We keep only the LATEST connection per platform.
    for (const [existingId, entry] of this.phones.entries()) {
      if (entry.platform === platform && entry.ws !== ws) {
        try { entry.ws.close(4000, 'replaced by newer connection'); } catch {}
        this.phones.delete(existingId);
        this._log('phone-replaced', { oldSession: existingId, newSession: sessionId, platform });
      }
    }

    this.phones.set(sessionId, { ws, hello, platform, connectedAt: Date.now() });
    this._notifyListeners('phone-connected', { info: hello, sessionId, platform });
    this._log('phone-connected', { sessionId, platform, app: hello.app });
    return sessionId;
  }

  onPhoneDisconnected(ws) {
    // Find the session(s) matching this ws (a ws could only be in one session)
    let disconnected = null;
    for (const [sessionId, entry] of this.phones.entries()) {
      if (entry.ws === ws) {
        disconnected = sessionId;
        // Fail any pending calls from this phone
        for (const [callId, call] of this.pendingCalls.entries()) {
          if (call.sessionId === sessionId) {
            clearTimeout(call.timer);
            call.reject(Object.assign(
              new Error('phone disconnected before responding'),
              { code: 'PHONE_DISCONNECTED' }
            ));
            this.pendingCalls.delete(callId);
          }
        }
        this.phones.delete(sessionId);
        break;
      }
    }
    // Clear the tool-router's cached state (elements cache is per-active-phone)
    try {
      const { resetSession } = require('./tool-router');
      resetSession();
    } catch (e) { /* tool-router not loaded yet — ignore */ }
    if (disconnected) {
      this._notifyListeners('phone-disconnected', { sessionId: disconnected });
      this._log('phone-disconnected', { sessionId: disconnected });
    }
  }

  /**
   * Pick the "active" phone — prefer native (ios/android) over web.
   * Returns { sessionId, ws, hello, platform } or null.
   *
   * Also prunes dead connections (readyState != OPEN) as it scans.
   */
  getActivePhone() {
    if (this.phones.size === 0) return null;

    // Prune dead connections first
    const dead = [];
    for (const [sessionId, entry] of this.phones.entries()) {
      if (entry.ws.readyState !== 1) { // not OPEN
        dead.push(sessionId);
      }
    }
    for (const id of dead) {
      this.phones.delete(id);
      this._log('phone-pruned-dead', { sessionId: id });
    }

    if (this.phones.size === 0) return null;

    // Preference order: ios, android, native, then anything else (web last)
    const PREFERENCE = ['ios', 'android', 'native'];
    for (const pref of PREFERENCE) {
      for (const [sessionId, entry] of this.phones.entries()) {
        if (entry.platform === pref && entry.ws.readyState === 1) {
          return { sessionId, ...entry };
        }
      }
    }
    // Fallback: first connected phone (web or other)
    for (const [sessionId, entry] of this.phones.entries()) {
      if (entry.ws.readyState === 1) {
        return { sessionId, ...entry };
      }
    }
    return null;
  }

  /** Backward-compat: the active phone's ws (or null). */
  get phoneWs() {
    const active = this.getActivePhone();
    return active ? active.ws : null;
  }

  /** Backward-compat: the active phone's hello (or null). */
  get phoneInfo() {
    const active = this.getActivePhone();
    return active ? active.hello : null;
  }

  isPhoneConnected() {
    return this.getActivePhone() !== null;
  }

  /**
   * Send a tool call to the active phone and return a Promise that resolves
   * with the phone's result. Rejects on timeout or phone disconnect.
   */
  callTool(tool, args) {
    return new Promise((resolve, reject) => {
      const active = this.getActivePhone();
      if (!active) {
        reject(Object.assign(
          new Error('No phone connected. Start the app and make sure it can reach the relay.'),
          { code: 'NO_PHONE' }
        ));
        return;
      }

      const { ws, sessionId, platform } = active;
      const callId = `c${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        if (this.pendingCalls.has(callId)) {
          this.pendingCalls.delete(callId);
          reject(Object.assign(
            new Error(`Tool "${tool}" timed out after ${config.toolTimeoutMs}ms`),
            { code: 'TIMEOUT' }
          ));
          this._log('tool-timeout', { callId, tool });
        }
      }, config.toolTimeoutMs);

      this.pendingCalls.set(callId, { resolve, reject, timer, tool, startedAt, sessionId });

      // Send to phone
      const message = JSON.stringify({ type: 'tool-call', callId, tool, args: args || {} });
      try {
        ws.send(message);
      } catch (e) {
        clearTimeout(timer);
        this.pendingCalls.delete(callId);
        reject(Object.assign(
          new Error(`Failed to send to phone: ${e.message}`),
          { code: 'WS_SEND_FAILED' }
        ));
        return;
      }

      this._log('tool-call-sent', { callId, tool, sessionId, platform, args });
    });
  }

  /** Called when a tool-result arrives from the phone. */
  resolveToolResult(message) {
    const { callId, ok, result, error, refsStillValid, durationMs } = message;
    const entry = this.pendingCalls.get(callId);
    if (!entry) {
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
    const active = this.getActivePhone();
    return {
      phoneConnected: !!active,
      phoneInfo: active ? active.hello : null,
      activePlatform: active ? active.platform : null,
      activeSessionId: active ? active.sessionId : null,
      phonesConnected: this.phones.size,
      phones: Array.from(this.phones.entries()).map(([id, e]) => ({
        sessionId: id,
        platform: e.platform,
        app: e.hello?.app?.name,
      })),
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

// Singleton — one relay = one session manager (supports multiple phones)
module.exports = new SessionManager();
