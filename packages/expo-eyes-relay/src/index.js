#!/usr/bin/env node
/**
 * expo-eyes-relay — CLI entry point.
 *
 * Usage:
 *   npx expo-eyes-relay [--token TOKEN] [--http-port PORT] [--ws-port PORT]
 *                       [--host ADDR] [--verbose]
 *
 * If --token is not provided, a random token is generated, printed, and
 * saved to ~/.expo-eyes-token so subsequent runs reuse it.
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
  // Try to load from file
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (saved) return saved;
    }
  } catch {}
  // Generate new
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    console.log(`[relay] token saved to ${TOKEN_FILE} (mode 600)`);
  } catch (e) {
    console.warn(`[relay] could not save token to ${TOKEN_FILE}: ${e.message}`);
  }
  return token;
}

function printBanner(token) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                        expo-eyes-relay                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP (agent):  http://${config.host}:${config.httpPort}`.padEnd(67) + '║');
  console.log(`║  WS   (phone):  ws://${config.host}:${config.wsPort}`.padEnd(67) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  Auth token (use in Authorization: Bearer <token>):              ║');
  console.log('║                                                                  ║');
  console.log('║  ' + token.padEnd(63) + '║');
  console.log('║                                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('In your Expo app:');
  console.log(`  <EyesProvider relayUrl="ws://YOUR_LAPTOP_IP:${config.wsPort}" token="${token}">`);
  console.log('');
  console.log('From an agent (curl):');
  console.log(`  curl -H "Authorization: Bearer ${token}" \\`);
  console.log(`       http://YOUR_LAPTOP_IP:${config.httpPort}/health`);
  console.log('');
}

function main() {
  // Ensure we have a token
  const token = loadOrCreateToken();
  config.token = token;

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
