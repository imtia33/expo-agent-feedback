#!/usr/bin/env node
/**
 * MCP server — exposes ALL expo-eyes tools (26) to MCP clients (Claude
 * Desktop, Cursor, Continue.dev, etc.) over stdio.
 *
 * Every tool in TOOLS (schemas.ts) is registered automatically — adding a
 * tool there is all it takes to expose it over MCP.
 *
 * Verified against @modelcontextprotocol/sdk@1.30.x.
 *
 * Usage:
 *   npx expo-eyes-agent mcp --relay-url=http://localhost:8765 --token=...
 *
 * Then in Claude Desktop's mcp config:
 *   {
 *     "mcpServers": {
 *       "expo-eyes": {
 *         "command": "npx",
 *         "args": ["expo-eyes-agent", "mcp"],
 *         "env": {
 *           "EXPO_EYES_RELAY_URL": "http://localhost:8765",
 *           "EXPO_EYES_TOKEN": "your-token"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Eyes } from './eyes.js';
import { TOOLS } from './schemas.js';
import { createRequire } from 'node:module';

function getEnvOrArg(key: string): string | undefined {
  // Check --key=value or --key value patterns
  const argKey = `--${key.toLowerCase().replace(/_/g, '-')}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === argKey && i + 1 < process.argv.length) return process.argv[i + 1];
    if (a.startsWith(`${argKey}=`)) return a.slice(argKey.length + 1);
  }
  return process.env[key];
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return require('../package.json').version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const relayUrl = getEnvOrArg('EXPO_EYES_RELAY_URL');
  const token = getEnvOrArg('EXPO_EYES_TOKEN');

  if (!relayUrl || !token) {
    console.error('Usage: npx expo-eyes-agent mcp --relay-url=URL --token=TOKEN');
    console.error('  or set EXPO_EYES_RELAY_URL and EXPO_EYES_TOKEN env vars');
    process.exit(1);
  }

  const eyes = new Eyes({ relayUrl, token });

  const server = new McpServer({
    name: 'expo-eyes',
    version: packageVersion(),
  });

  // Register every tool from the shared registry. The zod shape is converted
  // to a JSON schema by the MCP SDK. Handlers reuse the typed Eyes client,
  // which validates args client-side before hitting the relay.
  for (const [name, spec] of Object.entries(TOOLS)) {
    server.registerTool(
      name,
      {
        description: spec.description,
        inputSchema: (spec.argsSchema as any).shape ?? {},
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await (eyes as any).call(name, args ?? {});
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }

  // Start the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: don't log to stdout — that's the MCP wire. Log to stderr.
  console.error(`[expo-eyes-agent] MCP server ready on stdio — ${Object.keys(TOOLS).length} tools registered`);
}

main().catch((e) => {
  console.error('[expo-eyes-agent] fatal:', e);
  process.exit(1);
});
