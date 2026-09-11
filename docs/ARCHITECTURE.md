# Architecture

> Why the brains live in the relay, not the app SDK.

## The three-package split

```
┌─────────────────────────────────────────────────────────────────────┐
│ Phone (Expo app)                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ expo-eyes-app  ← THIN CLIENT                                │   │
│  │   5 primitives:                                             │   │
│  │     getTree          → raw fiber tree (no refs/stableIds)   │   │
│  │     dispatchEvent    → fire onPress/onChangeText/etc.       │   │
│  │     readLayout       → x/y/width/height for one fiber      │   │
│  │     scroll           → scrollTo on a scrollable fiber      │   │
│  │     scrollToIndex    → scrollToIndex on a list fiber       │   │
│  │   NO computation, NO pruning, NO ref allocation             │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │ WS (LAN, phone → relay)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Laptop — expo-eyes-relay  ← THE BRAINS                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ tool-router.js — implements 7 agent-facing tools:           │   │
│  │   inspect, snapshot, tap, longPress,                        │   │
│  │   type, scrollTo, expandList                                │   │
│  │                                                              │   │
│  │ All computation lives here:                                 │   │
│  │   - ref allocation (r0, r1, ...)                            │   │
│  │   - stableId hashing (tid:xxx, h:xxxxxx)                    │   │
│  │   - tree pruning (cap depth, skip wrappers)                 │   │
│  │   - snapshot drill-in                                        │   │
│  │   - tap resolution (find pressable ancestor)                │   │
│  │   - scrollable ancestor search                              │   │
│  │   - virtualization detection                                │   │
│  │   - tree caching (1s TTL)                                   │   │
│  │   - ref → fid resolution                                    │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │ HTTP / HTTPS (LAN or via --tunnel)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Agent (Claude / Cursor / curl / CLI)                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ expo-eyes-agent — typed SDK + MCP server + CLI              │   │
│  │   Talks to relay via HTTP. Doesn't know about primitives.   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Why this split (the moat)

**If the brains lived in the app SDK:**
- Anyone can read the open-source app SDK + agent SDK
- They'd see all the tree-walking, ref allocation, stableId hashing
- A weekend of work to replicate the relay with a basic Express server
- We'd have no defensible IP

**With brains in the relay:**
- The app SDK is useless alone — it just sends raw fibers
- The agent SDK is useless alone — it just calls HTTP endpoints
- Only the relay knows how to turn raw fibers into agent-friendly trees
- Replicating the relay requires reading our closed-source `tool-router.js` and reimplementing it
- We can iterate on the relay's intelligence (better pruning, smarter stableIds, snapshot diffs) without touching the app SDK or breaking any installed app

## What's in each package

### expo-eyes-app (phone, pure JS, ~12KB)
- `EyesProvider` React component
- `ws-client` — auto-reconnect WS
- `devtools-hook` — attaches to `__REACT_DEVTOOLS_GLOBAL_HOOK__`
- `raw-tree` — walks fibers, reads layouts (parallel)
- `primitives` — 5 functions exposed over WS

That's it. ~600 lines of code total. Nothing here is "secret sauce".

### expo-eyes-relay (laptop, Node, ~15KB)
- `http-server` — Express 5, exposes /tool/:name to agents
- `ws-server` — accepts phone WS connections
- `session-manager` — tracks phone state, multiplexes tool calls
- `tool-router` — **THE BRAINS** (ref allocation, stableId, pruning, snapshot, tap resolution, virtualization, tree caching, ref→fid resolution)
- `tunnel` — spawns cloudflared/ngrok/localtunnel for remote agents
- `config` — env-var + CLI flag parsing

~1200 lines total. The tool-router alone is ~400 lines of the smart stuff.

### expo-eyes-agent (anywhere, ~30KB)
- `client` — typed HTTP client with retry + zod validation
- `eyes` — high-level API (inspect, tap, type, etc.)
- `mcp-server` — exposes tools to LLM clients via MCP
- `cli` — `npx expo-eyes-agent <tool>`
- `schemas` — zod schemas (single source of truth for tool args/results)

~800 lines total. Useful without a relay, but only as a typed HTTP client — it doesn't know anything about React or fibers.

## The agent's view

The agent (or any HTTP client) sees 7 tools:

| Tool | Args | Returns |
|---|---|---|
| `inspect` | — | pruned tree with `ref` + `stableId` per node |
| `snapshot` | `ref` | deep subtree of one element |
| `tap` | `ref` | ok |
| `longPress` | `ref`, `durationMs?` | ok |
| `type` | `ref`, `text`, `append?` | ok, newValue |
| `scrollTo` | `ref`, `x?`, `y?`, `direction?`, `amount?` | ok, scrolledTo |
| `expandList` | `listRef`, `from?`, `to?` | items, renderedRange, itemCount |

Refs can be:
- `r5` — positional (fast, but invalidates on re-render)
- `tid:saveBtn` — testID-based (stable, set by dev)
- `h:7a3b2` — structural hash (stable, computed by relay)

## The phone's view

The phone sees only 5 primitives. It has no concept of refs, stableIds, or pruning. It just sends raw fibers and dispatches events.

This means:
- **The app SDK never needs updating** when we add new agent-facing tools
- **The app SDK is tiny** — ~12KB tarball
- **The app SDK works in Expo Go** — no native modules
- **Adding features (like `scrollPosition` or `visibleNodes`)** only requires changes to the relay

## Connection topology

```
Phone ←──── WS (LAN) ────→ Relay ←──── HTTP/HTTPS ────→ Agent
        phone connects OUT       agent calls in
        to relay                  (or via --tunnel for remote)
```

- Phone → Relay: WS on LAN (or future: tunnel for remote phones)
- Agent → Relay: HTTP, optionally via cloudflared tunnel for cross-region

The `--app-url exp://192.168.1.5:8081` flag is metadata — the relay stores it and exposes it in `/health` so the agent knows which app it's driving. It doesn't affect the actual connection (which is still phone → relay WS).

In the future, when we want relay → phone direct connection (e.g. for relay-less mode), we'll use `react-native-nitro-http-server` (dev build only — see `docs/libraries/rn-http-server-summary.md`).
