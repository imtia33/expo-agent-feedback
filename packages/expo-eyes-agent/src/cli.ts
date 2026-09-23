#!/usr/bin/env node
/**
 * CLI — `npx expo-eyes-agent <tool> [args]`
 *
 * Supports ALL relay tools (26) plus the special commands health/tools/events.
 * Args are passed as --key value pairs and coerced/validated against the
 * same zod schemas the SDK and MCP server use.
 *
 * Env vars (or flags):
 *   EXPO_EYES_RELAY_URL  (default http://localhost:8765)
 *   EXPO_EYES_TOKEN      (required unless the relay runs open)
 *
 * Output: pretty-printed JSON to stdout. Errors go to stderr with exit code 1.
 */

import { parseArgs } from 'node:util';
import { Eyes, EyesError } from './eyes.js';
import { TOOLS } from './schemas.js';

function getEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function printError(message: string): void {
  console.error(`Error: ${message}`);
}

/** Flags that must be coerced from CLI strings to numbers. */
const NUMERIC_FLAGS = new Set([
  'durationMs', 'x', 'y', 'amount', 'from', 'to', 'timeoutMs', 'intervalMs',
  'index', 'limit', 'maxSwipes', 'swipeDistance', 'scale', 'steps', 'dx', 'dy',
]);

/** Flags that must be coerced from CLI strings to booleans. */
const BOOLEAN_FLAGS = new Set(['append', 'animated', 'verify', 'refresh', 'pressable']);

/**
 * Build a tool args object from parsed CLI values.
 * Numbers/booleans are coerced per the flag tables above; everything else
 * stays a string and is validated by the zod schema inside the client.
 */
function buildArgs(toolName: string, values: Record<string, unknown>): Record<string, unknown> {
  const spec = TOOLS[toolName];
  const args: Record<string, unknown> = {};
  const shape: Record<string, unknown> | undefined = spec ? (spec.argsSchema as any).shape : undefined;
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined) continue;
    if (NUMERIC_FLAGS.has(key)) {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new EyesError(`--${key} must be a number (got "${raw}")`, 'BAD_ARGS');
      args[key] = n;
    } else if (BOOLEAN_FLAGS.has(key)) {
      if (typeof raw === 'boolean') args[key] = raw;
      else if (raw === 'true') args[key] = true;
      else if (raw === 'false') args[key] = false;
      else throw new EyesError(`--${key} must be true or false (got "${raw}")`, 'BAD_ARGS');
    } else if (shape && key in shape) {
      args[key] = raw;
    }
  }
  return args;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const tool = args[0];

  // Special commands
  if (tool === 'help' || tool === '--help' || tool === '-h') {
    printUsage();
    return;
  }

  if (tool === 'mcp') {
    // Hand off to the MCP server entry point
    await import('./mcp-server.js');
    return;
  }

  if (tool === 'list-tools') {
    // Offline: print the built-in tool registry (no relay needed)
    for (const [name, spec] of Object.entries(TOOLS)) {
      console.log(`${name.padEnd(16)} ${spec.description}`);
    }
    return;
  }

  // Parse remaining args as --key value pairs. strict:false lets the CLI
  // accept any tool's flags without a hand-maintained options list.
  const restArgs = args.slice(1);
  const { values } = parseArgs({
    args: restArgs,
    options: {
      ref: { type: 'string' },
      listRef: { type: 'string' },
      text: { type: 'string' },
      x: { type: 'string' },
      y: { type: 'string' },
      amount: { type: 'string' },
      direction: { type: 'string' },
      durationMs: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      contains: { type: 'string' },
      placeholder: { type: 'string' },
      value: { type: 'string' },
      index: { type: 'string' },
      role: { type: 'string' },
      testID: { type: 'string' },
      name: { type: 'string' },
      limit: { type: 'string' },
      route: { type: 'string' },
      params: { type: 'string' },
      timeoutMs: { type: 'string' },
      intervalMs: { type: 'string' },
      maxSwipes: { type: 'string' },
      swipeDistance: { type: 'string' },
      scale: { type: 'string' },
      steps: { type: 'string' },
      dx: { type: 'string' },
      dy: { type: 'string' },
      append: { type: 'boolean', default: false },
      animated: { type: 'boolean', default: true },
      verify: { type: 'string' },
      refresh: { type: 'string' },
      pressable: { type: 'string' },
      'relay-url': { type: 'string' },
      token: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const relayUrl = String(values['relay-url'] || '') || getEnv('EXPO_EYES_RELAY_URL', 'http://localhost:8765')!;
  const token = String(values.token || '') || getEnv('EXPO_EYES_TOKEN', '')!;

  if (!token && relayUrl.startsWith('http')) {
    // Open relays (no auth) are supported — empty token is fine there.
    // We still warn so silent auth failures are easier to debug.
    console.error('[cli] no token set (EXPO_EYES_TOKEN or --token). Continuing — open relays need no auth.');
  }

  const eyes = new Eyes({ relayUrl, token });

  try {
    switch (tool) {
      case 'health': {
        printJson(await eyes.health());
        return;
      }
      case 'tools': {
        printJson(await eyes.listTools());
        return;
      }
      case 'events': {
        for await (const evt of eyes.events()) {
          printJson(evt);
        }
        return;
      }
      default: {
        if (!TOOLS[tool]) {
          printError(`Unknown tool: ${tool}. Run "npx expo-eyes-agent list-tools" for the full list.`);
          process.exit(1);
        }
        const toolArgs = buildArgs(tool, values as Record<string, unknown>);
        const result = await (eyes as any).call(tool, toolArgs);
        printJson(result);
        // Composite tools report failures as ok:false (not exceptions) —
        // surface that in the exit code so scripts and agent loops react.
        if (result && typeof result === 'object' && (result as any).ok === false) {
          process.exit(1);
        }
        return;
      }
    }
  } catch (e: any) {
    if (e instanceof EyesError) {
      printError(`[${e.code}] ${e.message}${e.tool ? ` (tool: ${e.tool})` : ''}`);
    } else {
      printError(e.message || String(e));
    }
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
expo-eyes-agent — agent SDK + MCP server + CLI for the expo-eyes relay

Usage:
  npx expo-eyes-agent <tool> [options]
  npx expo-eyes-agent mcp                # start MCP server on stdio (all 26 tools)
  npx expo-eyes-agent health             # relay + phone status
  npx expo-eyes-agent tools              # list tools from the RELAY (live)
  npx expo-eyes-agent list-tools         # list tools from the built-in registry (offline)
  npx expo-eyes-agent events             # stream phone events (Ctrl-C to stop)

Core tools:
  inspect                                # return the visible tree
  snapshot      --ref <id>               # drill into one element
  tap           --ref <id>               # tap an element
  longPress     --ref <id> [--durationMs N]
  type          --ref <id> --text "..." [--append]
  scrollTo      --ref <id> [--x N] [--y N] [--direction up|down|left|right] [--amount N]
  expandList    --listRef <id> [--from N] [--to N]

Composite tools (no ref hunting — agents: prefer these):
  visibleText                            # lean on-screen inventory with frames
  tapText       --text "Sign in"         # find + press by text (verified)
  tapXY         --x 100 --y 500          # press at a screen point
  clickables                             # inventory of tappable elements
  fill          --text "hi@example.com" --placeholder "Email"
  find          --text "Save" [--pressable]
  scrollIntoView --text "footer"         # swipe until visible
  waitGone      --text "Loading..."      # poll until gone
  waitFor       --text "Dashboard"       # poll until appears
  navigate      --route "/playground"    # expo-router deep link
  back                                   # go back
  assertVisible --text "Welcome"         # throws if absent
  assertText    --testID t_title --text "Home"
  assertEnabled --testID t_submit
  swipe         --ref <id> --dx 0 --dy -400
  pinch         --ref <id> --direction out
  screenshot    [--ref <id>]
  readScreen                             # flat text list
  layout        [--ref <id>]             # measurement + overflow audit

Options:
  --relay-url URL    relay base URL (default: $EXPO_EYES_RELAY_URL or http://localhost:8765)
  --token TOKEN      auth token (default: $EXPO_EYES_TOKEN)

Examples:
  EXPO_EYES_TOKEN=abc npx expo-eyes-agent visibleText
  npx expo-eyes-agent tapText --text "Sign in" --token abc
  npx expo-eyes-agent fill --text "hi@example.com" --placeholder Email
  npx expo-eyes-agent scrollTo --ref r10 --direction down --amount 200
  npx expo-eyes-agent mcp    # for Claude Desktop / Cursor
`);
}

main();
