# expo-eyes — Agent Eyes & Fingers for Expo Apps

> ⚠️ **Work in progress.** This is a research-driven build. Every external library
> used is verified against current docs (2026), with the source docs saved in
> `docs/libraries/`. No 2023 assumptions.

## What this is

A library that gives an AI agent **eyes** (inspect the React Native tree as JSON)
and **fingers** (tap, type, scroll) on a real Expo app running on a real phone.

The agent (any HTTP client — Claude, Cursor, Copilot, or a CLI script) calls
simple HTTP endpoints; the relay forwards tool calls over WebSocket to the phone;
the phone executes them against the live React Native app and returns structured
results.

This is the "fast feedback loop" Shopify wrote about, but for agents:
edit code on the laptop → HMR pushes to phone → agent inspects the result →
agent taps → agent verifies → agent commits. No human in the middle.

## Architecture (v1 — eyes + fingers only)

```
Phone (Expo app + expo-eyes-app, pure JS)
  │ outbound WS (LAN)
  ▼
Laptop — expo-eyes-relay (Node CLI)
  │ HTTP API (auth: bearer token)
  ▼
Agent (curl, or any HTTP client)
```

## Status (v1)

### Done
- ✅ `expo-eyes-app` — EyesProvider React component
- ✅ WS client with auto-reconnect
- ✅ React DevTools hook attachment (verified against react-devtools-core@8.0.0)
- ✅ Fiber tree walker (via `hook.getFiberRoots()` + pointer traversal)
- ✅ Tree serializer with smart pruning, stable ref IDs, virtualization detection
- ✅ Tool implementations: `inspect`, `snapshot`, `tap`, `longPress`, `type`, `scrollTo`, `expandList`

### In progress
- 🚧 `expo-eyes-relay` — phone-facing WS server done, HTTP server next

### Not in v1
- Code editing tools (readFile, editFile, grep)
- VS Code extension
- Copilot integration
- HMR signal subscription
- Multi-phone support (one phone per relay in v1)

## Documentation

All third-party library docs are saved in `docs/libraries/` — these are the
sources we verified against before writing any code.

- [`ws-API-summary.md`](docs/libraries/ws-API-summary.md) — WebSocket server (relay phone-facing)
- [`express-API-summary.md`](docs/libraries/express-API-summary.md) — HTTP server (relay agent-facing)
- [`rn-devtools-hook-API.md`](docs/libraries/rn-devtools-hook-API.md) — React Native fiber tree access

## Quick start (when v1 is complete)

```bash
# On the laptop
cd packages/expo-eyes-relay
npm install
npm start -- --token YOUR_SECRET

# In your Expo app
npm install expo-eyes-app
# Wrap your app:
# <EyesProvider relayUrl="ws://YOUR_LAPTOP_IP:8766" token="YOUR_SECRET">
#   <App />
# </EyesProvider>

# From anywhere (agent)
curl -X POST http://YOUR_LAPTOP_IP:8765/tool/inspect \
  -H "Authorization: Bearer YOUR_SECRET"
```

## License

MIT
