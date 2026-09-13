/**
 * ws-server.js — phone-facing WebSocket server.
 *
 * Phone connects OUT to this server (LAN, same Wi-Fi as laptop).
 * Protocol: see packages/expo-eyes-app/src/protocol.ts
 *
 * Auth: phone sends { type: 'hello', token, app } as first message.
 * If token matches config.token, we send { type: 'hello-ack', ok: true }.
 * Otherwise we close the connection.
 */

const { WebSocketServer } = require('ws');
const config = require('./config');
const session = require('./session-manager');

// ─── Heartbeat ────────────────────────────────────────────────────────
//
// Protocol-level ping every 30s. If a phone fails to pong within 10s we
// terminate the socket so (a) onPhoneDisconnected fires, (b) the phone's
// auto-reconnect kicks in, and (c) phoneConnected never lies about zombies.
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

function startHeartbeat(wss) {
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.__eyesDead) {
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.__eyesDead = true;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
}

function trackPong(ws) {
  ws.on('pong', () => { ws.__eyesDead = false; });
}

function startWsServer() {
  const wss = new WebSocketServer({
    port: config.wsPort,
    host: config.host,
  });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[ws] phone connecting from ${ip}`);
    trackPong(ws);

    let authenticated = false;
    let helloTimeout = setTimeout(() => {
      if (!authenticated) {
        console.log(`[ws] closing unauthenticated connection from ${ip} (no hello within 5s)`);
        ws.close(4001, 'auth timeout');
      }
    }, 5000);

    // ws 8.x: 'message' callback is (data, isBinary). data is a Buffer when
    // isBinary is true, or a Buffer containing UTF-8 when false.
    // We always expect JSON text — convert and parse.
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        console.warn(`[ws] received binary message from ${ip}, ignoring`);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn(`[ws] received non-JSON message from ${ip}, ignoring`);
        return;
      }

      if (!msg || typeof msg !== 'object') return;

      // First message must be hello
      if (!authenticated) {
        if (msg.type !== 'hello') {
          console.warn(`[ws] first message from ${ip} was not hello (got ${msg.type}), closing`);
          ws.close(4002, 'expected hello');
          return;
        }
        // If config.token is set, enforce auth. If null, skip (open relay, LAN-only).
        if (config.token !== null && msg.token !== config.token) {
          console.warn(`[ws] auth failed from ${ip} — token mismatch`);
          ws.send(JSON.stringify({ type: 'hello-ack', ok: false, reason: 'invalid token' }));
          ws.close(4003, 'invalid token');
          return;
        }
        authenticated = true;
        clearTimeout(helloTimeout);
        ws.send(JSON.stringify({ type: 'hello-ack', ok: true }));
        session.onPhoneConnected(ws, msg);
        console.log(`[ws] phone authenticated: app=${msg.app?.name} sdk=${msg.app?.sdkVersion}`);
        return;
      }

      // Authenticated messages
      if (msg.type === 'tool-result') {
        session.resolveToolResult(msg);
      } else if (msg.type === 'event') {
        // Log errors prominently so the agent can see runtime crashes in the relay log
        if (msg.event === 'error') {
          console.error(`[phone-error] ${msg.message}`);
          if (msg.stack) console.error(`[phone-error-stack] ${msg.stack.split('\n').slice(0, 3).join('\n')}`);
        }
        session.pushEvent(msg);
      } else {
        console.warn(`[ws] unknown message type "${msg.type}" from phone`);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (authenticated) {
        session.onPhoneDisconnected(ws);
        console.log(`[ws] phone disconnected (${ip})`);
      }
    });

    ws.on('error', (e) => {
      console.warn(`[ws] phone socket error from ${ip}:`, e.message);
    });
  });

  wss.on('listening', () => {
    console.log(`[ws] phone-facing server listening on ws://${config.host}:${config.wsPort}`);
    startHeartbeat(wss);
  });

  wss.on('error', (e) => {
    console.error(`[ws] server error:`, e);
    process.exit(1);
  });

  return wss;
}

module.exports = { startWsServer };
