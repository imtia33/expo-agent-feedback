/**
 * tunnel.js — exposes the relay's HTTP port via a public URL.
 *
 * Strategy (priority order):
 *   1. ngrok if NGROK_AUTHTOKEN env var is set
 *      (globally routed — same URL works from anywhere, including China)
 *   2. cloudflared if installed
 *      (anonymous, no account, but quick tunnels are edge-locked — requests
 *       from other Cloudflare edges get 404. Works locally, may fail cross-region.)
 *   3. localtunnel via npx (no install needed, last resort)
 *
 * The tunnel is ONLY for the HTTP port (agent → relay).
 * The phone → relay WS connection stays on LAN.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TRYCLOUDFLARE_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function config_provider() {
  try { return require('./config').tunnelProvider || 'auto'; } catch { return 'auto'; }
}

function hasNgrokConfig() {
  if (process.env.NGROK_AUTHTOKEN) return true;
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Local', 'ngrok', 'ngrok.yml'),
    path.join(home, '.config', 'ngrok', 'ngrok.yml'),
    path.join(home, '.ngrok2', 'ngrok.yml'),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

function startTunnel(httpPort) {
  const provider = config_provider();

  if (provider === 'cloudflare') {
    return tryCloudflared(httpPort);
  }
  if (provider === 'ngrok') {
    return tryNgrok(httpPort);
  }
  if (provider === 'localtunnel') {
    return tryLocaltunnel(httpPort);
  }

  // 'auto' mode: try ngrok if token or config exists, then cloudflared, then localtunnel
  if (hasNgrokConfig()) {
    return tryNgrok(httpPort)
      .catch((e) => {
        console.warn(`[tunnel] ngrok failed: ${e.message}`);
        return tryCloudflared(httpPort);
      })
      .catch((e) => {
        console.warn(`[tunnel] cloudflared failed: ${e.message}`);
        return tryLocaltunnel(httpPort);
      })
      .catch((e) => {
        console.error(`[tunnel] all providers failed: ${e.message}`);
        throw new Error('No tunnel provider available');
      });
  }

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
      throw new Error('No tunnel provider available');
    });
}

// ─── cloudflared ──────────────────────────────────────────────────────

function tryCloudflared(httpPort) {
  return new Promise((resolve, reject) => {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const args = [
      'tunnel',
      '--config', nullDevice,
      '--url', `http://localhost:${httpPort}`,
      '--http-host-header', `localhost:${httpPort}`,
      '--no-autoupdate',
    ];
    const child = spawn('cloudflared', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        killChild(child);
        reject(new Error('cloudflared took >30s to provide URL'));
      }
    }, 30000);

    const onData = (chunk) => {
      const text = chunk.toString();
      if (config_verbose()) process.stderr.write(`[cloudflared] ${text}`);
      const match = text.match(TRYCLOUDFLARE_REGEX);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[tunnel] cloudflared: ${match[0]}`);
        registerCleanup(child);
        resolve(match[0]);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        if (e.code === 'ENOENT') reject(new Error('cloudflared not installed'));
        else reject(e);
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

// ─── ngrok ────────────────────────────────────────────────────────────

function tryNgrok(httpPort) {
  const authtoken = process.env.NGROK_AUTHTOKEN;
  const args = ['http', String(httpPort), '--log=stdout'];
  if (authtoken) {
    args.push('--authtoken', authtoken);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('ngrok', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        killChild(child);
        reject(new Error('ngrok took >20s to provide URL'));
      }
    }, 20000);

    // Poll ngrok's local API at localhost:4040/api/tunnels every 500ms.
    const pollInterval = setInterval(async () => {
      if (resolved) return;
      try {
        const resp = await fetch('http://localhost:4040/api/tunnels');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.tunnels && data.tunnels.length > 0 && data.tunnels[0].public_url) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(pollInterval);
          console.log(`[tunnel] ngrok: ${data.tunnels[0].public_url}`);
          registerCleanup(child);
          resolve(data.tunnels[0].public_url);
        }
      } catch {}
    }, 500);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (config_verbose()) process.stderr.write(`[ngrok] ${text}`);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (config_verbose()) process.stderr.write(`[ngrok:err] ${text}`);
    });

    child.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        clearInterval(pollInterval);
        if (e.code === 'ENOENT') reject(new Error('ngrok not installed (run: npm install -g ngrok)'));
        else reject(e);
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        clearInterval(pollInterval);
        reject(new Error(`ngrok exited with code ${code} before providing URL`));
      }
    });
  });
}

// ─── localtunnel (last resort) ────────────────────────────────────────

function tryLocaltunnel(httpPort) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'localtunnel', '--port', String(httpPort)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        killChild(child);
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

function killChild(child) {
  try {
    if (child.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    }
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function killAll() {
  for (const child of spawnedChildren) {
    killChild(child);
  }
  spawnedChildren.length = 0;
}

process.on('SIGINT', () => { killAll(); });
process.on('SIGTERM', () => { killAll(); });
process.on('exit', () => { killAll(); });

function config_verbose() {
  try { return require('./config').verbose; } catch { return false; }
}

module.exports = { startTunnel, killAll };