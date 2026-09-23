#!/usr/bin/env node
/**
 * expo-eyes-relay — CLI entry point.
 *
 * Usage:
 *   npx expo-eyes-relay [--token TOKEN] [--tunnel] [--app-url EXP_URL]
 *                       [--http-port PORT] [--ws-port PORT] [--host ADDR] [--verbose]
 *
 * Token behavior:
 *   - No --tunnel, no --token → open relay, no auth (easy local dev on LAN)
 *   - --tunnel, no --token    → refuse to start (security: tunnel is public)
 *   - --token TOKEN           → enforce auth on WS + HTTP
 *
 * --app-url: metadata only. The phone still connects OUT to the relay via WS.
 *   Useful for the agent to know which app it's driving (e.g. exp://192.168.1.5:8081).
 *   In the future, this URL may be used for relay → phone direct connection.
 *
 * --tunnel: spawns cloudflared (or ngrok/localtunnel fallback) to expose the
 *   HTTP port publicly. The phone WS connection stays on LAN.
 *
 * Pattern verified against:
 *   - ws 8.21.3 (phone-facing WebSocket server)
 *   - express 5.2.1 (agent-facing HTTP API)
 *   - cloudflared / ngrok / localtunnel (optional --tunnel providers)
 */

const config = require('./config');
const { startWsServer } = require('./ws-server');
const { startHttpServer } = require('./http-server');
const { startTunnel, killAll } = require('./tunnel');
const session = require('./session-manager');

function argValue(name) {
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) return process.argv[i + 1];
    if (process.argv[i].startsWith(`${flag}=`)) return process.argv[i].slice(flag.length + 1);
  }
  return process.env[`EXPO_EYES_${name.toUpperCase().replace(/-/g, '_')}`];
}

function printBanner(token, tunnelUrl, appUrl) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                        expo-eyes-relay                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP (local):  http://${config.host}:${config.httpPort}`.padEnd(67) + '║');
  console.log(`║  WS   (phone):  ws://${config.host}:${config.wsPort}`.padEnd(67) + '║');
  if (tunnelUrl) {
    console.log(`║  HTTP (public): ${tunnelUrl}`.padEnd(67) + '║');
  }
  if (appUrl) {
    console.log(`║  App URL:       ${appUrl}`.padEnd(67) + '║');
  }
  console.log('╠══════════════════════════════════════════════════════════════════╣');

  if (token) {
    console.log('║  Auth: Bearer token required                                      ║');
    console.log('║  ' + token.padEnd(63) + '║');
  } else {
    console.log('║  Auth: DISABLED (open relay, LAN-only)                           ║');
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
  const baseUrl = tunnelUrl || `http://YOUR_LAN_IP:${config.httpPort}`;
  if (token) {
    console.log(`  curl -H "Authorization: Bearer ${token}" ${baseUrl}/health`);
  } else {
    console.log(`  curl ${baseUrl}/health`);
  }
  if (tunnelUrl) {
    console.log('');
    console.log('🌐 Tunnel is public — anyone with this URL can call the relay.');
    console.log('   Use the token. Don\'t share the URL publicly.');
  }
  console.log('');
}

async function main() {
  // Validate: --tunnel requires --token
  if (config.tunnel && !config.token) {
    console.error('[relay] ERROR: --tunnel requires --token.');
    console.error('[relay] The tunnel exposes the relay publicly; without a token,');
    console.error('[relay] anyone with the URL could control your phone.');
    console.error('[relay] Run again with: --tunnel --token=$(openssl rand -hex 24)');
    process.exit(1);
  }

  const token = config.token;
  const appUrl = argValue('app-url');

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

  // Start tunnel if requested
  let tunnelUrl = null;
  if (config.tunnel) {
    console.log('[relay] starting tunnel...');
    try {
      tunnelUrl = await startTunnel(config.httpPort);
    } catch (e) {
      console.error(`[relay] tunnel failed: ${e.message}`);
      process.exit(1);
    }
  }

  printBanner(token, tunnelUrl, appUrl);

  // Store appUrl in session for /health endpoint
  if (appUrl) {
    session.appUrl = appUrl;
  }

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[relay] ${signal} received, shutting down...`);
    // Close all connected phones
    if (session.phones instanceof Map) {
      for (const [, entry] of session.phones.entries()) {
        try { entry.ws.close(1001, 'server shutdown'); } catch {}
      }
    }
    killAll(); // kill tunnel processes
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
