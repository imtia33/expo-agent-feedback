# expo-eyes-relay

> Bridges agent HTTP calls to phone WebSocket connections.
> Verified against `ws@8.21.3` and `express@5.2.1` (see `../../docs/libraries/`).

## Quick start

```bash
cd packages/expo-eyes-relay
npm install
npm start
```

On first run, a random auth token is generated and saved to `~/.expo-eyes-token`. The relay prints:

```
╔══════════════════════════════════════════════════════════════════╗
║                        expo-eyes-relay                           ║
╠══════════════════════════════════════════════════════════════════╣
║  HTTP (agent):  http://0.0.0.0:8765                              ║
║  WS   (phone):  ws://0.0.0.0:8766                                ║
╠══════════════════════════════════════════════════════════════════╣
║  Auth token:  <hex string>                                       ║
╚══════════════════════════════════════════════════════════════════╝
```

## Configuration (env vars)

| Var | Default | Description |
|---|---|---|
| `EXPO_EYES_HTTP_PORT` | `8765` | Agent-facing HTTP port |
| `EXPO_EYES_WS_PORT` | `8766` | Phone-facing WebSocket port |
| `EXPO_EYES_HOST` | `0.0.0.0` | Bind address |
| `EXPO_EYES_TOKEN` | (generated) | Auth token (both phone and agent must present this) |
| `EXPO_EYES_TOOL_TIMEOUT_MS` | `30000` | Per-tool-call timeout |
| `EXPO_EYES_VERBOSE` | `false` | Verbose logging |
| `EXPO_EYES_CORS` | `true` | Allow CORS (useful if agent runs in browser) |

## API

### `GET /health`
No auth. Returns relay + phone status.

### `GET /tools`
Returns the list of available tools and their arg schemas.

### `POST /tool/:name`
Invoke a tool. Body = JSON object of args. Requires `Authorization: Bearer <token>`.

```bash
# Inspect the visible tree
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8765/tool/inspect

# Tap a button (ref from inspect)
curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"ref":"r2"}' \
     http://localhost:8765/tool/tap
```

### `GET /events?since=TIMESTAMP&count=N`
Returns recent phone events (logs, errors). Optional `since` filters by timestamp.

## Tools available in v1

| Tool | Args | Returns |
|---|---|---|
| `inspect` | — | `{ tree, totalNodes, prunedNodes, renderTimeMs }` |
| `snapshot` | `ref` | `{ element, renderTimeMs }` |
| `tap` | `ref` | `{ ok, refsStillValid }` |
| `longPress` | `ref`, `durationMs?` | `{ ok, refsStillValid }` |
| `type` | `ref`, `text`, `append?` | `{ ok, refsStillValid, newValue }` |
| `scrollTo` | `ref`, `x?`, `y?`, `animated?`, `direction?`, `amount?` | `{ ok, scrolledTo, refsStillValid }` |
| `expandList` | `listRef`, `from?`, `to?` | `{ items, renderedRange, itemCount, renderTimeMs }` |

## Exposing over HTTPS (for remote agents)

If your agent runs on a remote machine (e.g. in the cloud), expose the relay via nginx. See [`nginx.conf.example`](./nginx.conf.example).

The phone should still connect to the relay on the local network — both phone and laptop on the same Wi-Fi. The HTTPS URL is for the agent only.

## Auth model

- Both the phone (WS hello) and the agent (HTTP `Authorization` header) must present the same token.
- Token is generated on first run if not set via env var.
- Token file: `~/.expo-eyes-token` (mode 600).
- To rotate: `rm ~/.expo-eyes-token && npm start`.

## Development

```bash
npm install
npm run dev   # verbose mode
```

## License

MIT
