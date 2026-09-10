#!/usr/bin/env node
/**
 * MCP server — exposes all expo-eyes tools to MCP clients (Claude Desktop,
 * Cursor, Continue.dev, etc.) over stdio.
 *
 * Verified against @modelcontextprotocol/sdk@1.30.0
 * (see docs/libraries/mcp-sdk-API-summary.md).
 *
 * Key API specifics:
 *   - Server class: McpServer from '@modelcontextprotocol/sdk/server/mcp.js'
 *   - Tool registration: server.registerTool(name, config, cb)
 *   - Schemas: zod shapes (the SDK converts them to JSON schemas internally)
 *   - Handler returns: { content: [{ type: 'text', text: '...' }] }
 *   - Transport: StdioServerTransport from '@modelcontextprotocol/sdk/server/stdio.js'
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
import { TOOLS, InspectArgsSchema, SnapshotArgsSchema, TapArgsSchema, LongPressArgsSchema, TypeArgsSchema, ScrollToArgsSchema, ExpandListArgsSchema } from './schemas.js';

function getEnvOrArg(key: string, args: string[]): string | undefined {
  // Check --key=value or --key value patterns
  const argKey = `--${key.toLowerCase().replace(/_/g, '-')}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === argKey && i + 1 < process.argv.length) return process.argv[i + 1];
    if (a.startsWith(`${argKey}=`)) return a.slice(argKey.length + 1);
  }
  return process.env[key];
}

async function main() {
  const relayUrl = getEnvOrArg('EXPO_EYES_RELAY_URL', process.argv);
  const token = getEnvOrArg('EXPO_EYES_TOKEN', process.argv);

  if (!relayUrl || !token) {
    console.error('Usage: npx expo-eyes-agent mcp --relay-url=URL --token=TOKEN');
    console.error('  or set EXPO_EYES_RELAY_URL and EXPO_EYES_TOKEN env vars');
    process.exit(1);
  }

  const eyes = new Eyes({ relayUrl, token });

  const server = new McpServer({
    name: 'expo-eyes',
    version: '0.1.0',
  });

  // Register each tool. The schema is the zod shape (the SDK converts to JSON schema).
  // Handler calls eyes[tool](args) and returns the result as JSON text.

  server.registerTool(
    'inspect',
    {
      description: TOOLS.inspect.description,
      inputSchema: InspectArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.inspect(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'snapshot',
    {
      description: TOOLS.snapshot.description,
      inputSchema: SnapshotArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.snapshot(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'tap',
    {
      description: TOOLS.tap.description,
      inputSchema: TapArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.tap(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'longPress',
    {
      description: TOOLS.longPress.description,
      inputSchema: LongPressArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.longPress(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'type',
    {
      description: TOOLS.type.description,
      inputSchema: TypeArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.type(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'scrollTo',
    {
      description: TOOLS.scrollTo.description,
      inputSchema: ScrollToArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.scrollTo(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'expandList',
    {
      description: TOOLS.expandList.description,
      inputSchema: ExpandListArgsSchema.shape,
    },
    async (args) => {
      try {
        const result = await eyes.expandList(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    },
  );

  // Start the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: don't log to stdout — that's the MCP wire. Log to stderr.
  console.error('[expo-eyes-agent] MCP server ready on stdio');
}

main().catch((e) => {
  console.error('[expo-eyes-agent] fatal:', e);
  process.exit(1);
});
