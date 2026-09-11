/**
 * config.js — env-var-driven configuration for the relay.
 *
 * Pattern borrowed from upload/config.js (the existing relay).
 */

const env = process.env;

module.exports = {
  /** Port for agent-facing HTTP server. */
  httpPort: Number(env.EXPO_EYES_HTTP_PORT || 8765),

  /** Port for phone-facing WebSocket server. */
  wsPort: Number(env.EXPO_EYES_WS_PORT || 8766),

  /** Bind address. Use 0.0.0.0 to allow remote (via nginx). */
  host: env.EXPO_EYES_HOST || '0.0.0.0',

  /** Auth token. Both phone and agent must present this.
   *  Generated on first run if not set; printed to console + saved to ~/.expo-eyes-token */
  token: env.EXPO_EYES_TOKEN || null,

  /** Per-tool-call timeout (ms). Agent's HTTP request will 504 if exceeded. */
  toolTimeoutMs: Number(env.EXPO_EYES_TOOL_TIMEOUT_MS || 30000),

  /** Verbose logging. */
  verbose: env.EXPO_EYES_VERBOSE === 'true' || process.argv.includes('--verbose'),

  /** Allow CORS from any origin (useful if agent runs in browser). */
  corsEnabled: env.EXPO_EYES_CORS !== 'false',
};
