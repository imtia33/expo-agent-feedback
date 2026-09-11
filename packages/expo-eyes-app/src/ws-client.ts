/**
 * WS client — connects OUT to the relay server.
 *
 * Auto-reconnect with exponential backoff. Survives brief network drops
 * (e.g. phone switching from cell to Wi-Fi). Keeps a queue of pending
 * outbound messages during reconnect so tool results are never lost.
 *
 * Wire protocol: see ./protocol.ts
 */

import { Platform } from 'react-native';

const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000, 30000];

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;
  private outboundQueue: string[] = [];
  private ready = false;

  /** Called when a tool call arrives from the relay. */
  onToolCall: ((msg: any) => void) | null = null;
  /** Called when the connection is established (or re-established). */
  onReady: (() => void) | null = null;
  /** Called when the connection drops. */
  onClose: (() => void) | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect() {
    if (this.isClosed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Send hello with auth token
      this.rawSend(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          app: {
            name: Platform.OS,
            sdkVersion: 'unknown',
          },
        }),
      );
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    this.ws.onerror = (_e: any) => {
      // Errors usually precede close; we'll reconnect on close.
    };

    this.ws.onclose = (_e: CloseEvent) => {
      this.ready = false;
      if (this.onClose) this.onClose();
      this.scheduleReconnect();
    };
  }

  private handleMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello-ack') {
      if (msg.ok) {
        this.ready = true;
        // Flush any queued outbound messages
        while (this.outboundQueue.length > 0) {
          const data = this.outboundQueue.shift()!;
          try {
            this.ws?.send(data);
          } catch {
            // Put it back and try later
            this.outboundQueue.unshift(data);
            break;
          }
        }
        if (this.onReady) this.onReady();
      } else {
        // Auth failed — stop trying
        console.warn('[expo-eyes] relay rejected connection:', msg.reason);
        this.close();
      }
    } else if (msg.type === 'tool-call') {
      if (this.onToolCall) this.onToolCall(msg);
    }
  }

  /** Send a message to the relay. Queues if not yet connected. */
  send(message: any) {
    const data = JSON.stringify(message);
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
        return;
      } catch {
        // fall through to queue
      }
    }
    this.outboundQueue.push(data);
  }

  private rawSend(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
      } catch {
        this.outboundQueue.push(data);
      }
    } else {
      this.outboundQueue.push(data);
    }
  }

  private scheduleReconnect() {
    if (this.isClosed) return;
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  get isConnected() {
    return this.ready;
  }

  close() {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}
