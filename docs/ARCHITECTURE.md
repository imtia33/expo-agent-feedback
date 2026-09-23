# Architecture

> Why the brains live in the relay, not the app SDK.

## The three-package split

```
┌─────────────────────────────────────────────────────────────────────┐
│ Phone (Expo app)                                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ expo-eyes-app  ← THIN CLIENT                                │   │
│  │   18 primitives (over WS, JSON):                            │   │
│  │     listVisibleElements  → flat list w/ frames + props      │   │
│  │     inspectAtPoint       → element at (x, y)                │   │
│  │     dispatchEvent        → fire onPress/onChangeText/etc.   │   │
│  │     scroll / scrollToIndex / swipe / pinch                  │   │
│  │     screenshot / readScreen / layout / waitForElement       │   │
│  │     navigate / back / assert* / ping / diagnostics          │   │
│  │   NO computation, NO pruning, NO ref allocation             │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │ WS (phone dials OUT — LAN, or via reverse proxy)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Relay — expo-eyes-relay  ← THE BRAINS (Node)                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ tool-router.js — composes 26 agent-facing tools:            │   │
│  │   eyes:      inspect, snapshot, visibleText, readScreen,    │   │
│  │              find, clickables, layout, screenshot           │   │
│  │   fingers:   tap, tapText, tapXY, longPress, type, fill,    │   │
│  │              scrollTo, scrollIntoView, swipe, pinch,        │   │
│  │              navigate, back                                  │   │
│  │   waiting:   waitFor, waitGone, assertVisible/Text/Enabled, │   │
│  │              expandList                                      │   │
│  │                                                              │   │
│  │ All computation lives here:                                 │   │
│  │   - ref allocation (r0, r1, …) + ref→viewTag resolution     │   │
│  │   - element cache (2s TTL, per-session)                     │   │
│  │   - composite tools (tapText: find → ancestor climb →       │   │
│  │     press → screen-fingerprint verify)                      │   │
│  │   - scrollable-ancestor search, delta scrolling             │   │
│  │   - virtualization handling, overflow audits                │   │
│  │                                                              │   │
│  │ session-manager.js — multi-phone: sessions keyed by         │   │
│  │   platform + deviceId, native-over-web preference,          │   │
│  │   pending-call correlation, /ping full-chain probe          │   │
│  │ ws-server.js — hello/token handshake, heartbeat 30s/10s     │   │
│  │ http-server.js — Express 5 API, bearer auth, CORS           │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │ HTTP / HTTPS (LAN, tunnel, or public host)
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Agent (Claude / Cursor / Claude Desktop / CLI / curl)               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ expo-eyes-agent — typed SDK + MCP server + CLI              │   │
│  │   Zod-validated args, retry on 503, 30s timeouts.           │   │
│  │   Talks HTTP to the relay. Knows nothing about fibers.      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Why this split (engineering, not aesthetics)

**If the brains lived in the app SDK:**
- Every app embedding the SDK would ship all the tree-walking, ref
  allocation, and composite-tool logic into the bundle.
- Adding or fixing anything would require every consuming app to upgrade and
  reload the SDK.
- The SDK would grow past what you want injected into someone else's app.

**With the brains in the relay:**
- The app SDK is a thin, auditable client — 18 primitives, a WS client, a
  DevTools-hook attachment. Easy to trust, easy to no-op in production.
- The relay's intelligence (smarter composites, better caching, new tools)
  improves **without touching any installed app** — upgrade the relay, the
  phone keeps working.
- The agent SDK is a plain typed HTTP client; it works with any relay, and
  the relay works with any HTTP client.

## How elements become refs

1. The relay asks the phone for `listVisibleElements` — a flat array of
   `{ viewTag, name, frame, hierarchy, props }` produced by RN's own
   inspector API (`getInspectorDataForViewAtPoint`) and fiber walking.
2. The relay caches this list per session (2 s TTL) and assigns positional
   refs: `r0`, `r1`, … Each element also carries a stable `tid:<testID>` when
   the developer set a testID.
3. A tool arg `ref` resolves to a `viewTag`: `r5` → index 5, `tid:save` →
   testID match, otherwise a name substring match. If the screen changed, the
   cache is invalidated and the element list re-scanned.

## The agent's view (26 tools)

| Group | Tools |
|---|---|
| Eyes | `inspect`, `snapshot`, `visibleText`, `readScreen`, `find`, `clickables`, `layout`, `screenshot` |
| Fingers | `tap`, `tapText`, `tapXY`, `longPress`, `type`, `fill`, `scrollTo`, `scrollIntoView`, `swipe`, `pinch`, `navigate`, `back` |
| Waiting & assertions | `waitFor`, `waitGone`, `assertVisible`, `assertText`, `assertEnabled`, `expandList` |

Composite tools "fail softly": when `tapText` finds no match it returns
`{ ok: false, error }` rather than an HTTP error, so agent loops can branch
on a normal payload. The CLI maps `ok:false` to exit code 1.

`GET /tools` returns live descriptions and arg docs for all of them — the
same list the MCP server exposes and the CLI understands.

## The phone's view (18 primitives)

The phone knows nothing about refs, frames verification, or composite
behavior. It dispatches events, reads layouts, and answers probes. That is
what keeps the SDK Expo-Go-compatible (pure JS over the DevTools hook) and
production-safe (the provider is a no-op when `__DEV__` is false).

## Connection topology

```
Phone ──WS dials OUT──▶ Relay ◀──HTTP/HTTPS── Agent
        (LAN, or wss://        (LAN, or --tunnel,
         reverse proxy)         or public host)
```

- **Phone → relay** is always an *outbound* WS connection from the phone.
  This is what makes NAT, tunnels, and reverse proxies work: the relay never
  needs to reach the phone.
- **Agent → relay** is HTTP with `Authorization: Bearer <token>` (exempt:
  `/`, `/health`, `/status`, `/ping`, `/diagnostics`).
- **`--tunnel`** spawns cloudflared (or ngrok/localtunnel) to publish the
  HTTP port. The relay *refuses to start* a tunnel without a token — a
  public, unauthenticated phone controller would be a remote-access Trojan.
- **Multi-phone**: sessions are keyed `platform:deviceId`; reconnects replace
  their own session, tool calls default to the newest native phone, and
  `?session=<id>` targets a specific one.
- **Liveness**: `GET /ping` measures the full round trip (relay → WS → phone
  primitive → back) and returns actionable hints when a link is broken.

## Message flow

```
Agent                    Relay                     Phone
  │ POST /tool/tapText     │                          │
  │───────────────────────▶│ listVisibleElements      │
  │                        │─────────────────────────▶│
  │                        │       elements[]         │
  │                        │◀──────────────────────── │
  │                        │ dispatchEvent(press)     │
  │                        │─────────────────────────▶│  onPress fires,
  │                        │ listVisibleElements      │  screen changes
  │                        │─────────────────────────▶│
  │        result          │       fingerprint ≠      │
  │◀───────────────────────│◀──────────────────────── │
  │  { ok, screenChanged } │                          │
```
