# expo-eyes — Eyes & Fingers for AI Agents on Expo Apps

> Give an AI agent **eyes** (inspect the live React Native tree as JSON) and
> **fingers** (tap, type, scroll) on a real Expo app running on a real phone.
> No human in the middle.

**Status: alpha.** The core chain (SDK → relay → agent) is stable and verified
end-to-end; APIs may still shift before 1.0.

## What this is

The "fast feedback loop" for agent-driven mobile development:

```
edit code on the laptop → HMR pushes to phone → agent inspects the result
→ agent taps → agent verifies → agent commits
```

Any HTTP client can drive the phone — Claude, Cursor, Copilot, Claude Desktop
(via MCP), a CLI script, or plain `curl`. Three npm packages, one chain:

| Package | What it is | Where it runs |
|---|---|---|
| [`expo-eyes-app`](packages/expo-eyes-app) | In-app SDK — a `<EyesProvider>` component that exposes 18 low-level primitives over WebSocket. Pure JS, works in **Expo Go**, no native build. | Phone |
| [`expo-eyes-relay`](packages/expo-eyes-relay) | Bridge server — turns 18 primitives into **26 agent-friendly tools** over a bearer-auth HTTP API. Plain Node.js, zero build step. | Laptop / server |
| [`expo-eyes-agent`](packages/expo-eyes-agent) | Agent SDK — typed TypeScript client, **MCP server** (Claude Desktop / Cursor), and CLI for the relay's 26 tools. | Wherever the agent is |

```
Phone (Expo app + expo-eyes-app)
  │  outbound WebSocket (LAN or tunnel)
  ▼
Relay (expo-eyes-relay, Node)          ← the brains: refs, frames, composites
  │  HTTP + Bearer auth (LAN or public)
  ▼
Agent (expo-eyes-agent: SDK / MCP / CLI, or plain curl)
```

## Quickstart

**1. Start the relay** (on the machine the agent can reach):

```bash
npx expo-eyes-relay --token $(openssl rand -hex 12)
```

**2. Wire the SDK into your Expo app** (dev only — it's a no-op in production
builds):

```bash
npx expo install expo-eyes-app
```

```tsx
// App.tsx
import { EyesProvider } from 'expo-eyes-app';

export default function App() {
  return (
    <EyesProvider relayUrl="ws://YOUR_LAN_IP:8766" token="THE_TOKEN_FROM_STEP_1">
      <RealApp />
    </EyesProvider>
  );
}
```

**3. Drive it from the agent:**

```bash
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
export EXPO_EYES_TOKEN=THE_TOKEN_FROM_STEP_1

npx expo-eyes-agent visibleText        # what's on screen? (refs + frames)
npx expo-eyes-agent tapText --text "Sign in"
npx expo-eyes-agent fill --text "hi@example.com" --placeholder Email
npx expo-eyes-agent mcp                # or: expose all 26 tools to Claude Desktop
```

Full walkthrough (including remote agents over tunnels and cloud relays):
**[docs/SETUP.md](docs/SETUP.md)**. How the pieces fit and why the brains live
in the relay: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## The 26 tools

**Eyes** — `inspect`, `snapshot`, `visibleText`, `readScreen`, `find`,
`clickables`, `layout`, `screenshot`

**Fingers** — `tap`, `tapText`, `tapXY`, `longPress`, `type`, `fill`,
`scrollTo`, `scrollIntoView`, `swipe`, `pinch`, `navigate`, `back`

**Waiting & assertions** — `waitFor`, `waitGone`, `assertVisible`,
`assertText`, `assertEnabled`, `expandList`

Every tool is available through the HTTP API (`POST /tool/:name`), the CLI,
the MCP server, and the typed SDK — same names, same args. `GET /tools` on a
running relay returns live schemas.

## Why agents prefer this over screenshots

- **Structured**: real element tree with stable refs, testIDs, accessibility
  roles, and pixel-accurate frames — not pixel guessing.
- **Composable**: `tapText` finds the element, climbs to the pressable
  ancestor, presses, and verifies the screen actually changed.
- **Cheap**: a `visibleText` round trip is a few KB, not a screenshot.
- **Works in Expo Go**: the SDK is pure JS on top of React DevTools' fiber
  hook + RN's own inspector API. No dev client, no native module.

## Repository layout

```
packages/expo-eyes-app     # in-app SDK (TypeScript → dist)
packages/expo-eyes-relay   # bridge server (plain JS, ships as-is)
packages/expo-eyes-agent   # SDK + MCP + CLI (TypeScript → dist)
examples/demo-app          # Expo Router demo with screens to drive
scripts/mock-phone.js      # fake phone: test the whole chain with no device
docs/                      # SETUP.md (scenarios) + ARCHITECTURE.md
```

> **AI agents working in this repo:** read [`AGENTS.md`](AGENTS.md) first —
> it's a compact map of everything above without the full file tree.

## Development

```bash
npm install            # one install for all workspaces (npm workspaces)
npm run build          # build expo-eyes-app + expo-eyes-agent
npm run relay          # start the relay (ports 8765/8766)
npm run mock-phone     # in another terminal: fake phone connects
npx expo-eyes-agent health   # in a third: verify the chain
./scripts/smoke-test.sh      # or run the full 16-check verification
```

## License

MIT — see [LICENSE](LICENSE).
