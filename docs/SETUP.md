# Setup Guide

Every way to run expo-eyes, from "same Wi-Fi in 5 minutes" to a cloud relay
driving phones in the field. Pick the scenario that matches your setup:

| # | Scenario | The agent is… | The relay is… | Go to |
|---|---|---|---|---|
| A | **Local workspace + local agent** | your laptop | your laptop | [§A](#a--local-workspace--local-agent-lan) |
| B | **Local workspace + remote agent** | cloud (Claude, CI…) | your laptop, via tunnel | [§B](#b--local-workspace--remote-agent-tunnel) |
| C | **Remote workspace + remote agent** | cloud | cloud (public host) | [§C](#c--remote-workspace--remote-agent-cloud-relay) |
| D | **Contributor: this monorepo** | your laptop | your laptop, from source | [§D](#d--contributor--this-monorepo) |

Prerequisites for all scenarios: **Node ≥ 18** on the relay machine and the
Expo SDK **≥ 57** in the app. No native build required anywhere — the SDK
works in Expo Go.

---

## A — Local workspace + local agent (LAN)

The classic loop: app on your phone, relay + agent on your laptop, same Wi-Fi.

### 1. Install & start the relay

```bash
npm install expo-eyes-relay        # anywhere on the laptop
npx expo-eyes-relay --token $(openssl rand -hex 12)
```

You'll see the banner with the HTTP port (8765, agent-facing) and the WS port
(8766, phone-facing). No token → open relay on the LAN (fine for quick dev,
shown as `Auth: DISABLED`); a token is required for tunnels and recommended
otherwise.

Find your LAN IP:

```bash
ipconfig getifaddr en0        # macOS
ip addr show | grep 'inet ' | grep -v 127.0.0.1   # Linux
```

### 2. Add the SDK to your Expo app

```bash
npx expo install expo-eyes-app
```

```tsx
// App.tsx — dev only; the provider is a no-op in production builds
import { EyesProvider } from 'expo-eyes-app';

export default function App() {
  return (
    <EyesProvider
      relayUrl="ws://YOUR_LAN_IP:8766"
      token="THE_TOKEN_YOU_GENERATED"   // '' for an open relay
    >
      <RealApp />
    </EyesProvider>
  );
}
```

Prefer env vars? Set `EXPO_PUBLIC_RELAY_URL` and `EXPO_PUBLIC_EYES_TOKEN`
(the demo app does exactly this).

### 3. Open the app

`npx expo start`, open in **Expo Go**. The provider connects out to the relay
(look for the `eyes:connected` badge on screen). Verify the full chain:

```bash
curl http://YOUR_LAN_IP:8765/ping
# → { "ok": true, "phoneReplied": true, "roundTripMs": 190, ... }
```

### 4. Drive it

```bash
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
export EXPO_EYES_TOKEN=THE_TOKEN_YOU_GENERATED

npx expo-eyes-agent visibleText
npx expo-eyes-agent tapText --text "Sign in"
npx expo-eyes-agent fill --text "hi@example.com" --placeholder Email
```

Or plain curl: `curl -X POST $EXPO_EYES_RELAY_URL/tool/tapText
-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
-d '{"text":"Sign in"}'`

---

## B — Local workspace + remote agent (tunnel)

The app and relay stay on your laptop; the *agent* runs somewhere else
(Claude in another region, a cloud CI, a teammate's machine).

```bash
npx expo-eyes-relay --tunnel --token $(openssl rand -hex 12)
```

The relay publishes its HTTP port through **cloudflared** (fallbacks: ngrok,
localtunnel) and prints the public URL. Auth is mandatory with `--tunnel` —
the relay refuses to expose an unauthenticated controller of your phone.

Point the agent at the public URL; everything else is identical to §A:

```bash
export EXPO_EYES_RELAY_URL=https://your-tunnel.trycloudflare.com
export EXPO_EYES_TOKEN=THE_TOKEN_YOU_GENERATED
npx expo-eyes-agent visibleText
```

The phone still connects over your LAN (it dials *out* to the relay) — a
tunnel publishes the **agent-facing** side only.

**Prefer your own reverse proxy?** Any TLS terminator works — see
[`packages/expo-eyes-relay/nginx.conf.example`](../packages/expo-eyes-relay/nginx.conf.example).
Relay env vars accept `EXPO_EYES_TUNNEL_PROVIDER=cloudflare|ngrok|localtunnel`.

---

## C — Remote workspace + remote agent (cloud relay)

Run the relay on a public host (VPS, container) so *both* the phone and the
agent can reach it from anywhere — e.g. driving a test device at the office
from an agent in the cloud.

### 1. Relay on the public host

```bash
npm install expo-eyes-relay
EXPO_EYES_HOST=0.0.0.0 npx expo-eyes-relay --token $(openssl rand -hex 12)
```

Behind nginx/Caddy, terminate TLS on :8766 too (wss://) — see the nginx
example. If the agent side must be browser-callable, keep CORS enabled
(default; `EXPO_EYES_CORS=false` to disable).

### 2. Phone (any network, mobile data included)

```tsx
<EyesProvider relayUrl="wss://relay.yourdomain.com:8766"
              token="THE_TOKEN_YOU_GENERATED">
```

### 3. Agent (anywhere)

```bash
export EXPO_EYES_RELAY_URL=https://relay.yourdomain.com:8765
export EXPO_EYES_TOKEN=THE_TOKEN_YOU_GENERATED
npx expo-eyes-agent health
```

**Claude Desktop / Cursor via MCP** (works in every scenario):

```json
{
  "mcpServers": {
    "expo-eyes": {
      "command": "npx",
      "args": ["expo-eyes-agent", "mcp"],
      "env": {
        "EXPO_EYES_RELAY_URL": "https://relay.yourdomain.com:8765",
        "EXPO_EYES_TOKEN": "THE_TOKEN_YOU_GENERATED"
      }
    }
  }
}
```

### Multi-phone

Plug in a second device (different owner account, kiosk, teammate's phone) —
each connects as its own session. `GET /health` lists them
(`phones[].sessionId`); target one explicitly:

```bash
curl -X POST "$URL/tool/tapText?session=android-MyApp-d1e2-f3a4" ...
```

Default routing prefers the newest *native* (ios/android) phone over a web
preview.

---

## D — Contributor: this monorepo

```bash
git clone https://github.com/imtia33/expo-agent-feedback.git
cd expo-agent-feedback
npm install                 # one install for all workspaces (single lockfile)
npm run build               # tsc for expo-eyes-app + expo-eyes-agent
```

Try the whole chain **without a phone** — the mock device answers all 18
primitives, toggles its button label on press (so `tapText --verify` has
something real to check), and the repo ships a 16-check smoke test:

```bash
./scripts/smoke-test.sh     # boots relay + mock phone, drives CLI + MCP
# or manually:
npm run relay               # terminal 1
npm run mock-phone          # terminal 2
npx expo-eyes-agent visibleText   # terminal 3 (EXPO_EYES_TOKEN=x for tokened relay)
```

Run the demo app (Expo Router, several driver-friendly screens):

```bash
npm run demo                # then: npx expo-eyes-agent visibleText
```

### Workspace map

| Location | What |
|---|---|
| `packages/expo-eyes-app` | in-app SDK (`npm run dev -w expo-eyes-app` to watch-build) |
| `packages/expo-eyes-relay` | bridge server — plain JS, no build |
| `packages/expo-eyes-agent` | SDK + MCP + CLI |
| `examples/demo-app` | demo Expo app, links `expo-eyes-app` via workspace |
| `scripts/mock-phone.js` | fake phone (`npm run mock-phone`) |
| `scripts/smoke-test.sh` | full-chain verification (16 checks) |

### Releasing (maintainers)

Versions are `0.x-alpha.N` + the npm `alpha` dist-tag. `prepublishOnly`
builds each package; tarballs contain only `dist/` + README (see the `files`
field in each package.json). Check what would ship:

```bash
npm pack --dry-run -w expo-eyes-agent
npm publish --tag alpha -w expo-eyes-agent   # -w expo-eyes-relay / expo-eyes-app
```

---

## Configuration reference (relay)

| Env var / flag | Default | Meaning |
|---|---|---|
| `EXPO_EYES_HTTP_PORT` / `--http-port` | `8765` | agent-facing HTTP port |
| `EXPO_EYES_WS_PORT` / `--ws-port` | `8766` | phone-facing WS port |
| `EXPO_EYES_HOST` / `--host` | `0.0.0.0` | bind address |
| `EXPO_EYES_TOKEN` / `--token` | *(none)* | bearer token; unset = open relay (LAN-only) |
| `EXPO_EYES_TUNNEL` / `--tunnel` | off | publish HTTP via tunnel (**requires token**) |
| `EXPO_EYES_TUNNEL_PROVIDER` | `auto` | `cloudflare` \| `ngrok` \| `localtunnel` |
| `EXPO_EYES_TOOL_TIMEOUT_MS` | `30000` | per-tool-call timeout (HTTP 504 after this) |
| `EXPO_EYES_CORS` | on | `false` disables CORS headers |
| `EXPO_EYES_VERBOSE` / `--verbose` | off | session + tool-call logging |

## Troubleshooting

`GET /ping` is the single source of truth — its `hint` field names the broken
link. The common cases:

| Symptom | Likely cause | Fix |
|---|---|---|
| `phoneConnected: false`, never connected | relayUrl/token mismatch, wrong LAN IP, different Wi-Fi | check the phone's `relayUrl`; phone and relay must share a network unless tunneled |
| `phoneConnected: false`, recent `lastDisconnect` | app backgrounded / device slept | bring the app to foreground; the WS client auto-reconnects |
| `phoneReplied: false` but connected | app frozen, or SDK older than the `ping` primitive | reload the app in Expo Go |
| zombie entries in `/health` | dead sockets | heartbeat prunes within 30 s; or restart the relay |
| `tunnel requires --token` error | by design | generate a token: `openssl rand -hex 12` |
| Android emulator can't reach `ws://localhost:8766` | emulator networking | run `adb reverse tcp:8766 tcp:8766` (and `8765` for the agent side) |
