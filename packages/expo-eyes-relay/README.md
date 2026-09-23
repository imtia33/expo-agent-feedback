# expo-eyes-relay

> The bridge between agents and phones. Exposes 26 agent-friendly tools over
> a bearer-auth HTTP API; phones connect in over WebSocket. Plain Node.js —
> no build step, two dependencies (express, ws).

Part of [expo-eyes](https://github.com/imtia33/expo-agent-feedback) — pairs
with [expo-eyes-app](https://www.npmjs.com/package/expo-eyes-app) (in the
phone) and [expo-eyes-agent](https://www.npmjs.com/package/expo-eyes-agent)
(agent side: SDK / MCP / CLI), or drive it with plain `curl`.

## Quick start

```bash
npm install expo-eyes-relay
npx expo-eyes-relay --token $(openssl rand -hex 12)
```

```
╔══════════════════════════════════════════════════════════════════╗
║                        expo-eyes-relay                           ║
╠══════════════════════════════════════════════════════════════════╣
║  HTTP (local):  http://0.0.0.0:8765                              ║
║  WS   (phone):  ws://0.0.0.0:8766                                ║
╠══════════════════════════════════════════════════════════════════╣
║  Auth: Bearer token required                                     ║
╚══════════════════════════════════════════════════════════════════╝
```

Add `<EyesProvider>` to your Expo app (see
[expo-eyes-app](https://www.npmjs.com/package/expo-eyes-app)) and verify the
full chain:

```bash
curl http://localhost:8765/ping
# → { "ok": true, "phoneReplied": true, "roundTripMs": 195, "hint": null }
```

## Token behavior (read this)

| Flags | Behavior |
|---|---|
| *(no token)* | Open relay, no auth — fine for quick LAN dev |
| `--token X` | Bearer auth enforced on WS (phone) + HTTP (agent) |
| `--tunnel` without token | **Refused at startup** — a public, unauthenticated phone controller is a remote-access Trojan |

## Configuration

Flags and env vars are interchangeable (`--http-port 9000` ≡
`EXPO_EYES_HTTP_PORT=9000`):

| Env var / flag | Default | Description |
|---|---|---|
| `EXPO_EYES_HTTP_PORT` | `8765` | Agent-facing HTTP port |
| `EXPO_EYES_WS_PORT` | `8766` | Phone-facing WebSocket port |
| `EXPO_EYES_HOST` | `0.0.0.0` | Bind address |
| `EXPO_EYES_TOKEN` | *(none)* | Bearer token (phone **and** agent) |
| `EXPO_EYES_TUNNEL` | off | Publish the HTTP port via tunnel |
| `EXPO_EYES_TUNNEL_PROVIDER` | `auto` | `cloudflare` \| `ngrok` \| `localtunnel` |
| `EXPO_EYES_TOOL_TIMEOUT_MS` | `30000` | Per-tool-call timeout (→ HTTP 504) |
| `EXPO_EYES_CORS` | on | CORS headers for browser agents |
| `EXPO_EYES_VERBOSE` | off | Session/tool-call logging |

`--app-url exp://192.168.1.5:8081` is optional metadata exposed in `/health`
so the agent knows which app it's driving.

## HTTP API

| Endpoint | Auth | Description |
|---|---|---|
| `GET /` `GET /health` | no | Relay + phone status, endpoint list |
| `GET /ping[?timeout=ms]` | no | **Full-chain liveness**: relay → WS → phone primitive → back, with an actionable `hint` when a link is broken |
| `GET /status` | no | Session detail (multi-phone list, pending calls) |
| `GET /diagnostics` | no | Phone runtime diagnostics dump |
| `GET /tools` | yes | All 26 tools with descriptions + arg docs |
| `POST /tool/:name` | yes | Invoke a tool; body = args JSON |
| `GET /events?since=N` | yes | Phone event stream (logs, errors, crashes) |

Tool names + args are documented live by `GET /tools`. Highlights:
`inspect`, `visibleText`, `find`, `clickables`, `layout`, `screenshot` (eyes);
`tap`, `tapText`, `tapXY`, `longPress`, `type`, `fill`, `scrollTo`,
`scrollIntoView`, `swipe`, `pinch`, `navigate`, `back` (fingers); `waitFor`,
`waitGone`, `assertVisible`, `assertText`, `assertEnabled`, `expandList`
(waiting/assertions).

```bash
curl -X POST http://localhost:8765/tool/tapText \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Sign in"}'
```

Error codes map to HTTP status: `NO_PHONE` → 503, `TIMEOUT` → 504,
`REF_NOT_FOUND` → 410, `BAD_ARGS` → 400.

## Multi-phone

Every phone connects as its own session (platform + deviceId). Reconnects
replace their own session; different devices coexist. Routing defaults to the
newest native (ios/android) phone — a web preview never steals tool calls —
and `POST /tool/:name?session=<sessionId>` targets a specific one. `GET
/health` lists every connected session.

## Remote agents (tunnel)

```bash
npx expo-eyes-relay --tunnel --token $(openssl rand -hex 12)
```

Publishes the HTTP port via cloudflared (fallbacks: ngrok → localtunnel) and
prints the public URL. The phone-facing WS stays on your LAN — the phone
dials out, so it needs nothing public. For a permanent public deployment, put
nginx/Caddy in front instead — see
[`nginx.conf.example`](./nginx.conf.example).

## Under the hood

```
src/index.js           CLI entry, banner, graceful shutdown
src/config.js          env/flag parsing
src/ws-server.js       phone-facing WS: hello/token handshake, heartbeat
src/session-manager.js multi-phone sessions, pending-call correlation, /ping
src/tool-router.js     26 tools composed from 18 phone primitives (the brains)
src/http-server.js     Express 5 API for agents
src/tunnel.js          cloudflared / ngrok / localtunnel lifecycle
```

## License

MIT
