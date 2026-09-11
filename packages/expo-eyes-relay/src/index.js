#!/usr/bin/env node
/**
 * expo-eyes-relay — CLI entry point.
 *
 * Usage:
 *   npx expo-eyes-relay [--token TOKEN] [--tunnel] [--http-port PORT]
 *                       [--ws-port PORT] [--host ADDR] [--verbose]
 *
 * Token behavior:
 *   - No --tunnel, no --token → open relay, no auth (easy local dev on LAN)
 *   - --tunnel, no --token    → refuse to start (security: tunnel is public)
 *   - --token TOKEN           → enforce auth on WS + HTTP
 *
 * Pattern verified against:
 *   - ws 8.21.3        (docs/libraries/ws-API-summary.md)
 *   - express 5.2.1    (docs/libraries/express-API-summary.md)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { startWsServer } = require('./ws-server');
const { startHttpServer } = require('./http-server');
const session = require('./session-manager');

const TOKEN_FILE = path.join(os.homedir(), '.expo-eyes-token');

function loadOrCreateToken() {
  if (config.token) return config.token;
  // If tunneling, we MUST have a token — refuse to start without one.
  if (config.tunnel) {
    return null;
  }
  // No token + no tunnel → return null (open relay, LAN-only).
  return null;
}

function printBanner(token) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                        expo-eyes-relay                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP (agent):  http://${config.host}:${config.httpPort}`.padEnd(67) + '║');
  console.log(`║  WS   (phone):  ws://${config.host}:${config.wsPort}`.padEnd(67) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');

  if (token) {
    console.log('║  Auth: Bearer token required (Authorization: Bearer <token>)     ║');
    console.log('║                                                                  ║');
    console.log('║  ' + token.padEnd(63) + '║');
    console.log('║                                                                  ║');
  } else {
    console.log('║  Auth: DISABLED (open relay, LAN-only)                           ║');
    console.log('║  ⚠️  Do not use this mode with --tunnel. Anyone with the URL     ║');
    console.log('║     could control your phone.                                    ║');
  }

  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('In your Expo app (replace YOUR_LAN_IP):');
  if (token) {
    console.log(`  <EyesProvider relayUrl="ws://YOUR_LAN_IP:${config.wsPort}" token="${token}">`);
  } else {
    console.log(`  <EyesProvider relayUrl="ws://YOUR_LAN_IP:${config.wsPort}" token="">>`);
  }
  console.log('');
  console.log('From an agent (curl):');
  if (token) {
    console.log(`  curl -H "Authorization: Bearer ${token}" \\`);
    console.log(`       http://YOUR_LAN_IP:${config.httpPort}/health`);
  } else {
    console.log(`  curl http://YOUR_LAN_IP:${config.httpPort}/health`);
  }
  console.log('');
}

function main() {
  // Validate: --tunnel requires --token
  if (config.tunnel && !config.token) {
    console.error('[relay] ERROR: --tunnel requires --token.');
    console.error('[relay] The tunnel exposes the relay publicly; without a token,');
    console.error('[relay] anyone with the URL could control your phone.');
    console.error('[relay] Run again with: --tunnel --token=$(openssl rand -hex 24)');
    process.exit(1);
  }

  const token = loadOrCreateToken();
  config.token = token; // could be null

  // Subscribe session events to log
  session.subscribe((event, data) => {
    if (event === 'phone-connected') {
      console.log(`[relay] ✓ phone connected: app=${data.info?.app?.name || 'unknown'}`);
    } else if (event === 'phone-disconnected') {
      console.log(`[relay] ✗ phone disconnected`);
    }
  });

  // Start both servers
  startWsServer();
  startHttpServer();

  printBanner(token);

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[relay] ${signal} received, shutting down...`);
    if (session.phoneWs) {
      try { session.phoneWs.close(1001, 'server shutdown'); } catch {}
    }
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
