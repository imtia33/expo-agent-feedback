/**
 * tunnel.js — exposes the relay's HTTP port via a public URL.
 *
 * Verified against cloudflared docs (see docs/libraries/cloudflared-API-summary.md).
 *
 * Strategy:
 *   1. If cloudflared is installed → use it (anonymous, no account)
 *   2. Else if NGROK_AUTHTOKEN env var set → use ngrok
 *   3. Else if localtunnel available → npx localtunnel (no install)
 *   4. Else → print install instructions and exit
 *
 * The tunnel is ONLY for the HTTP port (agent → relay).
 * The phone → relay WS connection stays on LAN.
 */

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const TRYCLOUDFLARE_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Start a tunnel for the given HTTP port.
 * Returns a Promise that resolves with the public URL.
 */
function startTunnel(httpPort) {
  return tryCloudflared(httpPort)
    .catch((e) => {
      console.warn(`[tunnel] cloudflared failed: ${e.message}`);
      return tryNgrok(httpPort);
    })
    .catch((e) => {
      console.warn(`[tunnel] ngrok failed: ${e.message}`);
      return tryLocaltunnel(httpPort);
    })
    .catch((e) => {
      console.error(`[tunnel] all providers failed: ${e.message}`);
      console.error('');
      console.error('Install one of:');
      console.error('  brew install cloudflared       (macOS, recommended)');
      console.error('  apt install cloudflared         (Debian/Ubuntu)');
      console.error('  winget install Cloudflare.cloudflared  (Windows)');
      console.error('  npm install -g ngrok            (requires authtoken)');
      console.error('');
      throw new Error('No tunnel provider available');
    });
}

function tryCloudflared(httpPort) {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', [
      'tunnel', '--url', `http://localhost:${httpPort}`, '--no-autoupdate',
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let resolved = false;
    let stderrBuffer = '';

    const timeout = setTimeout(() => {
      if (!resolved) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        reject(new Error('cloudflared took >15s to provide URL'));
      }
    }, 15000);

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      if (config_verbose()) process.stderr.write(`[cloudflared] ${text}`);

      const match = text.match(TRYCLOUDFLARE_REGEX);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[tunnel] cloudflared: ${match[0]}`);
        // Register cleanup
        registerCleanup(child);
        resolve(match[0]);
      }
    });

    child.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        if (e.code === 'ENOENT') {
          reject(new Error('cloudflared not installed'));
        } else {
          reject(e);
        }
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before providing URL`));
      }
    });
  });
}

function tryNgrok(httpPort) {
  const authtoken = process.env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    return Promise.reject(new Error('NGROK_AUTHTOKEN not set'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('ngrok', ['http', String(httpPort), '--authtoken', authtoken], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        reject(new Error('ngrok took >15s'));
      }
    }, 15000);

    child.stdout.on('data', async (chunk) => {
      const text = chunk.toString();
      if (config_verbose()) process.stderr.write(`[ngrok] ${text}`);

      // Try fetching the URL from ngrok's local API
      if (!resolved) {
        try {
          const resp = await fetch('http://localhost:4040/api/tunnels');
          const data = await resp.json();
          if (data.tunnels && data.tunnels[0] && data.tunnels[0].public_url) {
            resolved = true;
            clearTimeout(timeout);
            console.log(`[tunnel] ngrok: ${data.tunnels[0].public_url}`);
            registerCleanup(child);
            resolve(data.tunnels[0].public_url);
          }
        } catch {}
      }
    });

    child.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        if (e.code === 'ENOENT') reject(new Error('ngrok not installed'));
        else reject(e);
      }
    });
  });
}

function tryLocaltunnel(httpPort) {
  return new Promise((resolve, reject) => {
    // localtunnel is a node package — we spawn npx
    const child = spawn('npx', ['--yes', 'localtunnel', '--port', String(httpPort)], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        reject(new Error('localtunnel took >20s'));
      }
    }, 20000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (config_verbose()) process.stderr.write(`[localtunnel] ${text}`);
      const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[tunnel] localtunnel: ${match[0]}`);
        registerCleanup(child);
        resolve(match[0]);
      }
    });

    child.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────

const spawnedChildren = [];

function registerCleanup(child) {
  spawnedChildren.push(child);
}

function killAll() {
  for (const child of spawnedChildren) {
    try {
      // Kill the process group (negative PID) to get children too
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch (e) {
      // Group kill failed — try direct
      try { child.kill('SIGTERM'); } catch {}
    }
  }
  // Escalate to SIGKILL after 3s
  setTimeout(() => {
    for (const child of spawnedChildren) {
      try { if (child.pid && !child.killed) process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }, 3000).unref();
  spawnedChildren.length = 0;
}

process.on('SIGINT', () => { killAll(); });
process.on('SIGTERM', () => { killAll(); });
process.on('exit', () => { killAll(); });

function config_verbose() {
  try { return require('./config').verbose; } catch { return false; }
}

module.exports = { startTunnel, killAll };
