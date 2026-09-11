/**
 * config.js — env-var-driven configuration for the relay.
 *
 * Pattern borrowed from upload/config.js (the existing relay).
 */

const env = process.env;

/** Parse --flag value or --flag=value from argv. */
function argValue(name) {
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) return process.argv[i + 1];
    if (process.argv[i].startsWith(`${flag}=`)) return process.argv[i].slice(flag.length + 1);
  }
  return undefined;
}

/** Check if a boolean --flag is present in argv. */
function argBool(name) {
  return process.argv.includes(`--${name}`);
}

const tunnelEnabled = argBool('tunnel') || env.EXPO_EYES_TUNNEL === 'true';
const userToken = env.EXPO_EYES_TOKEN || argValue('token');

module.exports = {
  /** Port for agent-facing HTTP server. */
  httpPort: Number(env.EXPO_EYES_HTTP_PORT || 8765),

  /** Port for phone-facing WebSocket server. */
  wsPort: Number(env.EXPO_EYES_WS_PORT || 8766),

  /** Bind address. Use 0.0.0.0 to allow remote (via nginx or tunnel). */
  host: env.EXPO_EYES_HOST || '0.0.0.0',

  /**
   * Auth token. Both phone and agent must present this.
   *
   * Behavior:
   *   - If --tunnel is set and no token provided → refuse to start (security).
   *   - If --tunnel is NOT set and no token provided → open relay, no auth (easy local dev).
   *   - If token is set → auth enforced on both WS and HTTP.
   */
  token: userToken || null,

  /** True if --tunnel flag or EXPO_EYES_TUNNEL=true. */
  tunnel: tunnelEnabled,

  /** Per-tool-call timeout (ms). Agent's HTTP request will 504 if exceeded. */
  toolTimeoutMs: Number(env.EXPO_EYES_TOOL_TIMEOUT_MS || 30000),

  /** Verbose logging. */
  verbose: env.EXPO_EYES_VERBOSE === 'true' || argBool('verbose'),

  /** Allow CORS from any origin (useful if agent runs in browser). */
  corsEnabled: env.EXPO_EYES_CORS !== 'false',
};
