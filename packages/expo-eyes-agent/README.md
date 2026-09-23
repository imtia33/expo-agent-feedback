# expo-eyes-agent

> Everything an AI agent needs to drive an Expo app through an
> [expo-eyes-relay](https://www.npmjs.com/package/expo-eyes-relay): a typed
> TypeScript SDK, an MCP server for Claude Desktop / Cursor, and a CLI —
> all generated from one source of truth (zod schemas in `src/schemas.ts`).

All 26 relay tools are available in every mode: `inspect`, `snapshot`,
`visibleText`, `readScreen`, `find`, `clickables`, `layout`, `screenshot`,
`tap`, `tapText`, `tapXY`, `longPress`, `type`, `fill`, `scrollTo`,
`scrollIntoView`, `swipe`, `pinch`, `navigate`, `back`, `waitFor`,
`waitGone`, `assertVisible`, `assertText`, `assertEnabled`, `expandList`.

## Install

```bash
npm install expo-eyes-agent
# CLI without installing:
npx expo-eyes-agent health
```

Requires a running [expo-eyes-relay](https://www.npmjs.com/package/expo-eyes-relay)
with an [expo-eyes-app](https://www.npmjs.com/package/expo-eyes-app)-enabled
device connected.

## 1. TypeScript SDK

```typescript
import { Eyes } from 'expo-eyes-agent';

const eyes = new Eyes({
  relayUrl: 'http://localhost:8765',       // or https://relay.example.com
  token: process.env.EXPO_EYES_TOKEN!,
});

// What's on screen? (lean inventory: refs, texts, roles, frames)
const { elements } = await eyes.visibleText();

// Prefer composites — no ref hunting:
await eyes.fill({ text: 'hi@example.com', placeholder: 'Email' });
const tap = await eyes.tapText({ text: 'Sign in' });
if (!tap.screenChanged) console.warn('press had no effect', tap);

// Ref-based flow when you want precision:
const { elements: els } = await eyes.find({ testID: 'submit', pressable: true });
await eyes.tap({ ref: els[0].ref });

// Waiting & assertions
await eyes.waitFor({ text: 'Dashboard' });
await eyes.assertVisible({ text: 'Welcome back' });

// Stream phone-side logs and crashes
for await (const evt of eyes.events({ signal: AbortSignal.timeout(60_000) })) {
  if (evt.event === 'error') console.error('[phone]', evt.message);
}
```

Every call is zod-validated **before** the network hop (catches agent
mistakes early), retried once on 503 (phone reconnecting), and timed out at
30 s (configurable). Errors are structured: `EyesError` with `code`
(`NO_PHONE`, `TIMEOUT`, `BAD_ARGS`, `REF_NOT_FOUND`, …), `statusCode`, and
`tool`.

Dynamic tool calls (e.g. an LLM choosing the next tool):

```typescript
const result = await eyes.call('tapText', { text: 'Sign in' }); // typed
```

## 2. MCP server (Claude Desktop, Cursor, Continue.dev…)

```bash
npx expo-eyes-agent mcp --relay-url=http://localhost:8765 --token=YOUR_TOKEN
```

```json
{
  "mcpServers": {
    "expo-eyes": {
      "command": "npx",
      "args": ["expo-eyes-agent", "mcp"],
      "env": {
        "EXPO_EYES_RELAY_URL": "http://localhost:8765",
        "EXPO_EYES_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

All 26 tools are registered automatically from the shared registry — the
model gets descriptions and arg schemas, and every call is validated before
it reaches the relay.

## 3. CLI

```bash
export EXPO_EYES_RELAY_URL=http://localhost:8765
export EXPO_EYES_TOKEN=YOUR_TOKEN

npx expo-eyes-agent health              # relay + phone status
npx expo-eyes-agent tools               # live tool list from the relay
npx expo-eyes-agent list-tools          # offline registry dump
npx expo-eyes-agent visibleText
npx expo-eyes-agent tapText --text "Sign in"
npx expo-eyes-agent fill --text "hi@example.com" --placeholder Email
npx expo-eyes-agent scrollTo --ref r10 --direction down --amount 200
npx expo-eyes-agent assertVisible --text "Welcome"
npx expo-eyes-agent events              # stream phone events (Ctrl-C stops)
```

Flags map 1:1 to tool args (`--durationMs 800`, `--verify false`, …). Exit
codes: `0` success, `1` on `ok:false` results, validation errors, or
transport failures — pipe-friendly for scripts and agent loops.

## API surface

| Export | What |
|---|---|
| `Eyes` | High-level client — one method per tool + `call(tool, args)`, `health()`, `listTools()`, `events()` |
| `EyesClient` | The same surface minus event streaming; use for custom fetch/retry wiring |
| `EyesError` | Structured error (`code`, `statusCode`, `tool`) |
| `TOOLS` | The zod-backed tool registry (name → description, argsSchema, resultSchema) |
| `*Args`, `*Result`, `ToolMap` | Full TypeScript types for every tool |

## License

MIT
