# Setup Guide

How to add `expo-eyes-app` to **your own** Expo project, so an agent can drive it.

## Three modes

| Mode | Use case | Auth | Tunnel |
|---|---|---|---|
| **LAN-only** (default) | You + agent both on same Wi-Fi | None | None |
| **LAN with token** | Same Wi-Fi, but want auth | Required | None |
| **Tunnel** | Agent is remote (different country, cloud) | Required | cloudflared |

Most users start with **LAN-only**. Switch to **Tunnel** when you want a remote agent (e.g. Claude in another country) to drive your app.

---

## Step 1 — Install the relay on your laptop

### Option A — Tarball (recommended, works today)

```bash
mkdir expo-eyes-relay && cd expo-eyes-relay
npm init -y
npm install https://github.com/imtia33/expo-feedback-Agent/raw/main/releases/expo-eyes-relay-0.1.0.tgz
```

### Option B — Clone the repo

```bash
git clone https://github.com/imtia33/expo-feedback-Agent.git
cd expo-feedback-Agent/packages/expo-eyes-relay
npm install
```

## Step 2 — Start the relay (LAN-only mode)

```bash
# If you used Option A:
npx expo-eyes-relay

# If you used Option B:
npm start
```

You'll see:

```
╔══════════════════════════════════════════════════════════════════╗
║                        expo-eyes-relay                           ║
╠══════════════════════════════════════════════════════════════════╣
║  HTTP (local):  http://0.0.0.0:8765                              ║
║  WS   (phone):  ws://0.0.0.0:8766                                ║
╠══════════════════════════════════════════════════════════════════╣
║  Auth: DISABLED (open relay, LAN-only)                           ║
╚══════════════════════════════════════════════════════════════════╝
```

**Find your laptop's LAN IP:**

```bash
# macOS
ipconfig getifaddr en0

# Linux
ip addr show | grep 'inet ' | grep -v 127.0.0.1

# Windows PowerShell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*'} | Select IPAddress
```

Write this down — call it `YOUR_LAN_IP`.

## Step 3 — Install expo-eyes-app in your Expo project

From inside your Expo project:

```bash
npm install https://github.com/imtia33/expo-feedback-Agent/raw/main/releases/expo-eyes-app-0.1.0.tgz
```

## Step 4 — Wrap your app root in `<EyesProvider>`

One file. One wrapper. That's it.

### Expo Router (default `create-expo-app` template)

```tsx
// src/app/_layout.tsx  (or app/_layout.tsx on older templates)
import { Stack } from 'expo-router';
import { EyesProvider } from 'expo-eyes-app';

export default function RootLayout() {
  return (
    <EyesProvider
      relayUrl="ws://YOUR_LAN_IP:8766"
      token=""   // empty string for LAN-only mode
    >
      <Stack />
    </EyesProvider>
  );
}
```

### Plain App.tsx (blank template)

```tsx
import { EyesProvider } from 'expo-eyes-app';

export default function App() {
  return (
    <EyesProvider relayUrl="ws://YOUR_LAN_IP:8766" token="">
      {/* your app */}
    </EyesProvider>
  );
}
```

### React Navigation (no Expo Router)

```tsx
import { EyesProvider } from 'expo-eyes-app';
import { NavigationContainer } from '@react-navigation/native';

export default function App() {
  return (
    <EyesProvider relayUrl="ws://YOUR_LAN_IP:8766" token="">
      <NavigationContainer>{/* your navigator */}</NavigationContainer>
    </EyesProvider>
  );
}
```

## Step 5 — Run your app

```bash
npx expo start
```

Press `i` (iOS), `a` (Android), or scan the QR with Expo Go.

When the app launches, look for a small badge in the top-right:
- 🟢 **eyes:connected** — relay reached, all good
- 🟡 **eyes:connecting** — wrong IP / firewall / different Wi-Fi
- 🔴 **eyes:disconnected** — auth failed or relay is down

## Step 6 — Verify from the agent side

```bash
# Install the agent (tarball)
npm install -g https://github.com/imtia33/expo-feedback-Agent/raw/main/releases/expo-eyes-agent-0.1.0.tgz

# Set env vars
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
# No token needed in LAN-only mode

# Inspect your real app's tree
expo-eyes-agent inspect
```

You should see YOUR app's components, YOUR testIDs, YOUR text. **That's the loop working.**

---

## Remote agent mode (Tunnel)

When you want an agent in another country (or a cloud LLM) to drive your app:

### Step 1 — Install cloudflared

```bash
# macOS
brew install cloudflared

# Debian/Ubuntu (see https://pkg.cloudflare.com/index.html)
sudo apt install cloudflared

# Windows
winget install --id Cloudflare.cloudflared
```

Verify: `cloudflared --version`

### Step 2 — Start the relay with `--tunnel` and `--token`

```bash
npx expo-eyes-relay --tunnel --token=$(openssl rand -hex 24)
```

You'll see:

```
╔══════════════════════════════════════════════════════════════════╗
║                        expo-eyes-relay                           ║
╠══════════════════════════════════════════════════════════════════╣
║  HTTP (local):  http://0.0.0.0:8765                              ║
║  WS   (phone):  ws://0.0.0.0:8766                                ║
║  HTTP (public): https://random-words.trycloudflare.com           ║
╠══════════════════════════════════════════════════════════════════╣
║  Auth: Bearer token required                                      ║
║  a3f8c2e9b1d4f6a7c8e9d0b1a2c3e4f5b6a7c8d9                         ║
╚══════════════════════════════════════════════════════════════════╝
```

**Copy the public URL and the token.** The phone still uses the LAN IP (`ws://YOUR_LAN_IP:8766`) — only the agent uses the public URL.

### Step 3 — Update your app's `EyesProvider`

```tsx
<EyesProvider
  relayUrl="ws://YOUR_LAN_IP:8766"   // still LAN — phone is local
  token="a3f8c2e9b1d4f6a7c8e9d0b1a2c3e4f5b6a7c8d9"  // now required
>
```

### Step 4 — Give the remote agent the public URL + token

```bash
# From anywhere in the world
export EXPO_EYES_RELAY_URL=https://random-words.trycloudflare.com
export EXPO_EYES_TOKEN=a3f8c2e9b1d4f6a7c8e9d0b1a2c3e4f5b6a7c8d9

expo-eyes-agent inspect
```

**Note:** The tunnel URL changes every time you restart the relay. Re-run with `--tunnel --token=...` to get a new one.

---

## Optional: `--app-url` flag (metadata)

If you want the agent to know which Expo app it's driving (useful when you have multiple projects):

```bash
npx expo-eyes-relay --app-url exp://192.168.1.5:8081
```

The relay stores this and exposes it in `/health`:

```bash
curl http://YOUR_LAN_IP:8765/health
# → { "appUrl": "exp://192.168.1.5:8081", ... }
```

Right now this is **metadata only** — the phone still connects OUT to the relay via WS. In the future, when we add relay → phone direct connection (using `react-native-nitro-http-server`), this URL will be how the relay finds the phone.

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "eyes:connecting" never turns green | Phone can't reach relay WS | Check LAN IP, same Wi-Fi, firewall on ports 8765/8766 |
| "eyes:disconnected" red | Wrong token | Compare token in app vs relay banner |
| `EADDRINUSE` on relay start | Port 8765/8766 in use | `EXPO_EYES_HTTP_PORT=18765 EXPO_EYES_WS_PORT=18766 npm start` |
| `NO_PHONE` from agent | Phone not connected | Check green badge in app + relay log |
| App crashes on launch | Wrong React/RN version | `npx expo install expo@latest react@latest react-native@latest` |
| TS errors in your app | IDE caching old types | Restart TS server (Cmd+Shift+P → "TypeScript: Restart TS Server") |
| Tunnel URL changes on restart | Quick tunnels are ephemeral | For stable URL: set up a named tunnel via cloudflared account |
| cloudflared "command not found" | Not installed | `brew install cloudflared` (mac) / `apt install cloudflared` (linux) |
| Tunnel refused to start | `--tunnel` without `--token` | Always pass `--token=...` when using `--tunnel` |

---

## Verifying it really works — a 30-second test

```bash
# 1. Check phone is connected
expo-eyes-agent health

# 2. Inspect the visible tree
expo-eyes-agent inspect > tree.json

# 3. Look at the top
head -30 tree.json

# 4. Find a Pressable with a testID
#    (look for "testID" in the output)

# 5. Tap it (replace r5 with the actual ref, or use tid:your-testID)
expo-eyes-agent tap --ref r5
# OR
expo-eyes-agent tap --ref tid:submit-button

# 6. Inspect again — see if state changed
expo-eyes-agent inspect > tree2.json
diff <(jq '.tree' tree.json) <(jq '.tree' tree2.json) | head -20
```

If the diff shows state changes (like a counter going from `0` to `1`), the loop is real. 🎉

---

## Architecture (one-page summary)

```
Phone (Expo app + expo-eyes-app)
  │ WS (LAN, phone → relay, outbound)
  ▼
Laptop — expo-eyes-relay  ← THE BRAINS
  - All ref allocation, stableId hashing, tree pruning, tap resolution
  - HTTP API for agents (LAN or via --tunnel for remote)
  ▼ HTTP / HTTPS
Agent (Claude / Cursor / curl / CLI)
```

The app SDK is intentionally thin (5 primitives, no computation). All the smart stuff lives in the relay. This is the moat — see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the full reasoning.
