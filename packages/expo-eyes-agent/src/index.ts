/**
 * expo-eyes-agent — typed SDK + MCP server + CLI for the expo-eyes relay.
 *
 * Three usage modes:
 *
 * 1. TypeScript SDK (for code agents like Cursor, Aider, Claude Code):
 *    import { Eyes } from 'expo-eyes-agent';
 *    const eyes = new Eyes({ relayUrl, token });
 *    const { tree } = await eyes.inspect();
 *
 * 2. MCP server (for Claude Desktop, Continue.dev, etc.):
 *    npx expo-eyes-agent mcp --relay-url=... --token=...
 *
 * 3. CLI (for shell scripts / debugging):
 *    npx expo-eyes-agent inspect
 *    npx expo-eyes-agent tap --ref r5
 *
 * All three share the same zod schemas — single source of truth in schemas.ts.
 */

export { Eyes, EyesError } from './eyes.js';
export type { EyesClientOptions, EventsOptions } from './eyes.js';
export * from './types.js';
export { TOOLS } from './schemas.js';
