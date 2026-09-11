# expo-eyes-agent

> Typed SDK, MCP server, and CLI for the expo-eyes relay.
> Three usage modes, one source of truth (zod schemas in `src/schemas.ts`).

## Install

```bash
npm install expo-eyes-agent
```

## Three ways to use it

### 1. TypeScript SDK (for code agents)

```typescript
import { Eyes } from 'expo-eyes-agent';

const eyes = new Eyes({
  relayUrl: 'http://localhost:8765',
  token: process.env.EXPO_EYES_TOKEN!,
});

// Inspect the visible tree
const { tree, totalNodes } = await eyes.inspect();
console.log(`Saw ${totalNodes} nodes`);

// Find a button by testID and tap it
const button = findByTestId(tree, 'submit-button');
if (button) {
  await eyes.tap({ ref: button.ref });
}

// Type into an input
const input = findByTestId(tree, 'email-input');
if (input) {
  await eyes.type({ ref: input.ref, text: 'user@example.com' });
}

// Scroll a list to row 100, get the rendered items
const list = findByTestId(tree, 'big-list');
if (list) {
  const { items, renderedRange } = await eyes.expandList({
    listRef: list.ref,
    from: 100,
    to: 110,
  });
  console.log(`Got items ${renderedRange[0]}..${renderedRange[1]}`);
}
```

TypeScript catches mistakes before runtime:
```ts
eyes.tap({ elementId: 5 });        // ❌ 'elementId' does not exist
eyes.tap({});                       // ❌ 'ref' is required
eyes.scrollTo({ ref: 'r10', direction: 'bottom' });  // ❌ 'bottom' not assignable
```

### 2. MCP server (for Claude Desktop, Cursor, etc.)

```bash
npx expo-eyes-agent mcp --relay-url=http://localhost:8765 --token=YOUR_TOKEN
```

Or via env vars:

```bash
EXPO_EYES_RELAY_URL=http://localhost:8765 EXPO_EYES_TOKEN=YOUR_TOKEN \
  npx expo-eyes-agent mcp
```

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "expo-eyes": {
      "command": "npx",
      "args": ["expo-eyes-agent", "mcp"],
      "env": {
        "EXPO_EYES_RELAY_URL": "http://localhost:8765",
        "EXPO_EYES_TOKEN": "your-token-here"
      }
    }
  }
}
```

The LLM sees all 7 tools with their JSON schemas (auto-generated from zod). It cannot hallucinate invalid args — the schema enforces types, required fields, and enums.

### 3. CLI (for shell scripts and debugging)

```bash
# Set env vars once
export EXPO_EYES_RELAY_URL=http://localhost:8765
export EXPO_EYES_TOKEN=your-token

# Inspect the visible tree
npx expo-eyes-agent inspect

# Tap a button
npx expo-eyes-agent tap --ref r5

# Type into an input
npx expo-eyes-agent type --ref r7 --text "hello@example.com"

# Long press
npx expo-eyes-agent longPress --ref r5 --durationMs 800

# Scroll down 200 pixels
npx expo-eyes-agent scrollTo --ref r10 --direction down --amount 200

# Expand rows 100..110 of a FlatList
npx expo-eyes-agent expandList --listRef r10 --from 100 --to 110

# Stream phone events (Ctrl-C to stop)
npx expo-eyes-agent events

# Check relay + phone status
npx expo-eyes-agent health
```

## Tools

| Tool | Args | Returns |
|---|---|---|
| `inspect` | `since?` | `{ tree, totalNodes, prunedNodes, renderTimeMs }` |
| `snapshot` | `ref` (required) | `{ element, renderTimeMs }` |
| `tap` | `ref` (required) | `{ ok, refsStillValid }` |
| `longPress` | `ref` (required), `durationMs?` | `{ ok, refsStillValid }` |
| `type` | `ref` (required), `text` (required), `append?` | `{ ok, newValue, refsStillValid }` |
| `scrollTo` | `ref` (required), `x?`, `y?`, `animated?`, `direction?`, `amount?` | `{ ok, scrolledTo, refsStillValid }` |
| `expandList` | `listRef` (required), `from?`, `to?` | `{ items, renderedRange, itemCount, renderTimeMs }` |

All `ref` values come from a prior `inspect()` call. They're stable within a session but invalidated by re-renders / navigation — when `refsStillValid: false`, call `inspect()` again.

## How hallucination is prevented

1. **TypeScript SDK**: compiler catches arg shape mistakes before runtime.
2. **MCP server**: LLM sees JSON schema for each tool. It can't pass `elementId` because the schema doesn't allow it. It can't pass `direction: 'bottom'` because the schema restricts to `up|down|left|right`.
3. **CLI**: zod parses args before sending. `tap` with no `--ref` → clear error, exit 1.
4. **Result validation**: even if the relay/phone returns a malformed response, the SDK catches it via `safeParse` and throws a structured `EyesError` instead of passing garbage to your code.

## Error handling

All errors are `EyesError` instances with structured fields:

```typescript
import { Eyes, EyesError } from 'expo-eyes-agent';

try {
  await eyes.tap({ ref: 'r99' });
} catch (e) {
  if (e instanceof EyesError) {
    console.error('code:', e.code);        // 'REF_NOT_FOUND' | 'NO_PHONE' | 'BAD_ARGS' | 'TIMEOUT' | ...
    console.error('statusCode:', e.statusCode);  // 410 | 503 | 400 | 504 | ...
    console.error('tool:', e.tool);        // 'tap'
    console.error('message:', e.message);  // 'ref "r99" not found — call inspect() to refresh.'
  }
}
```

Common error codes:
- `BAD_ARGS` — invalid args (client-side validation failed)
- `BAD_CONFIG` — missing relayUrl or token
- `NO_PHONE` — no phone connected to relay (503)
- `TIMEOUT` — phone didn't respond in time (504)
- `REF_NOT_FOUND` — ref ID is stale or invalid (410)
- `MALFORMED_RESULT` — relay returned bad data
- `UNKNOWN_TOOL` — tool name not in the registry

## Auto-retry

By default, the SDK retries once on `NO_PHONE` / 503 (1 second delay). Tune via:

```typescript
const eyes = new Eyes({
  relayUrl, token,
  maxRetries: 3,        // default 1
  retryDelayMs: 2000,   // default 1000
});
```

## Events stream

```typescript
const ac = new AbortController();
setTimeout(() => ac.abort(), 60000); // stop after 1 min

for await (const evt of eyes.events({ signal: ac.signal })) {
  if (evt.event === 'log' && evt.level === 'error') {
    console.error('Phone error:', evt.args);
  }
}
```

Events include phone `console.log` / `error` / `warn` output and uncaught exceptions. Useful for "did my action cause a JS error on the phone?" diagnostics.

## Verified dependencies

This package uses:
- [`zod@4.6.1`](../../docs/libraries/zod-API-summary.md) — schema validation
- [`@modelcontextprotocol/sdk@1.30.0`](../../docs/libraries/mcp-sdk-API-summary.md) — MCP server

No 2023 assumptions. Every API used was verified against current docs.

## Development

```bash
cd packages/expo-eyes-agent
npm install
npm run build      # tsc
npm run dev        # tsc --watch
```

## License

MIT
