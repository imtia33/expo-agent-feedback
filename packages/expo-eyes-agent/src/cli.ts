#!/usr/bin/env node
/**
 * CLI — `npx expo-eyes-agent <tool> [args]`
 *
 * Usage:
 *   npx expo-eyes-agent inspect
 *   npx expo-eyes-agent snapshot --ref r5
 *   npx expo-eyes-agent tap --ref r5
 *   npx expo-eyes-agent longPress --ref r5 --durationMs 800
 *   npx expo-eyes-agent type --ref r7 --text "hello"
 *   npx expo-eyes-agent scrollTo --ref r10 --y 500
 *   npx expo-eyes-agent expandList --listRef r10 --from 100 --to 110
 *   npx expo-eyes-agent health
 *   npx expo-eyes-agent events
 *
 * Env vars (or flags):
 *   EXPO_EYES_RELAY_URL  (default http://localhost:8765)
 *   EXPO_EYES_TOKEN      (required)
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

  // Parse remaining args as --key value pairs
  const restArgs = args.slice(1);
  const { values, positionals } = parseArgs({
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
      append: { type: 'boolean', default: false },
      animated: { type: 'boolean', default: true },
      'relay-url': { type: 'string' },
      token: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const relayUrl = String(values['relay-url'] || '') || getEnv('EXPO_EYES_RELAY_URL', 'http://localhost:8765')!;
  const token = String(values.token || '') || getEnv('EXPO_EYES_TOKEN');

  if (!token) {
    printError('Token required. Set EXPO_EYES_TOKEN env var or pass --token.');
    process.exit(1);
  }

  const eyes = new Eyes({ relayUrl, token });

  try {
    switch (tool) {
      case 'health': {
        const result = await eyes.health();
        printJson(result);
        return;
      }
      case 'tools': {
        const result = await eyes.listTools();
        printJson(result);
        return;
      }
      case 'events': {
        for await (const evt of eyes.events()) {
          printJson(evt);
        }
        return;
      }
      case 'inspect': {
        const result = await eyes.inspect({});
        printJson(result);
        return;
      }
      case 'snapshot': {
        const ref = String(values.ref || '');
        if (!ref) throw new EyesError('--ref is required', 'BAD_ARGS');
        const result = await eyes.snapshot({ ref });
        printJson(result);
        return;
      }
      case 'tap': {
        const ref = String(values.ref || '');
        if (!ref) throw new EyesError('--ref is required', 'BAD_ARGS');
        const result = await eyes.tap({ ref });
        printJson(result);
        return;
      }
      case 'longPress': {
        const ref = String(values.ref || '');
        if (!ref) throw new EyesError('--ref is required', 'BAD_ARGS');
        const durationMsStr = String(values.durationMs || '');
        const result = await eyes.longPress({
          ref,
          durationMs: durationMsStr ? parseInt(durationMsStr, 10) : undefined,
        });
        printJson(result);
        return;
      }
      case 'type': {
        const ref = String(values.ref || '');
        if (!ref) throw new EyesError('--ref is required', 'BAD_ARGS');
        const text = String(values.text || '');
        if (!text && text !== '') throw new EyesError('--text is required', 'BAD_ARGS');
        const result = await eyes.type({
          ref,
          text,
          append: values.append === true,
        });
        printJson(result);
        return;
      }
      case 'scrollTo': {
        const ref = String(values.ref || '');
        if (!ref) throw new EyesError('--ref is required', 'BAD_ARGS');
        const xStr = String(values.x || '');
        const yStr = String(values.y || '');
        const amountStr = String(values.amount || '');
        const result = await eyes.scrollTo({
          ref,
          x: xStr ? parseInt(xStr, 10) : undefined,
          y: yStr ? parseInt(yStr, 10) : undefined,
          animated: values.animated !== false,
          direction: String(values.direction || '') as any || undefined,
          amount: amountStr ? parseInt(amountStr, 10) : undefined,
        });
        printJson(result);
        return;
      }
      case 'expandList': {
        const listRef = String(values.listRef || '');
        if (!listRef) throw new EyesError('--listRef is required', 'BAD_ARGS');
        const fromStr = String(values.from || '');
        const toStr = String(values.to || '');
        const result = await eyes.expandList({
          listRef,
          from: fromStr ? parseInt(fromStr, 10) : undefined,
          to: toStr ? parseInt(toStr, 10) : undefined,
        });
        printJson(result);
        return;
      }
      default:
        printError(`Unknown tool: ${tool}`);
        printUsage();
        process.exit(1);
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
  npx expo-eyes-agent mcp                # start MCP server on stdio
  npx expo-eyes-agent health             # relay + phone status
  npx expo-eyes-agent tools              # list available tools
  npx expo-eyes-agent events             # stream phone events (Ctrl-C to stop)

Tools:
  inspect                                # return the visible tree
  snapshot      --ref <id>               # drill into one element
  tap           --ref <id>               # tap an element
  longPress     --ref <id> [--durationMs N]
  type          --ref <id> --text "..." [--append]
  scrollTo      --ref <id> [--x N] [--y N] [--direction up|down|left|right] [--amount N]
  expandList    --listRef <id> [--from N] [--to N]

Options:
  --relay-url URL    relay base URL (default: $EXPO_EYES_RELAY_URL or http://localhost:8765)
  --token TOKEN      auth token (default: $EXPO_EYES_TOKEN)

Examples:
  EXPO_EYES_TOKEN=abc npx expo-eyes-agent inspect
  npx expo-eyes-agent tap --ref r5 --token abc
  npx expo-eyes-agent scrollTo --ref r10 --direction down --amount 200
  npx expo-eyes-agent mcp    # for Claude Desktop / Cursor
`);
}

main();
