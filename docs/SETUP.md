# Setup Guide

How to add `expo-eyes-app` to **your own** Expo project, so an agent can drive it.

## Prerequisites

| Requirement | Check |
|---|---|
| Node.js 18+ | `node -v` |
| Expo SDK 57+ | `npx expo --version` |
| React 19+ | see `package.json` |
| React Native 0.86+ | see `package.json` |
| Phone and laptop on same Wi-Fi | (or use simulators) |

If you're on an older Expo SDK, upgrade first:
```bash
npx expo install expo@latest
```

## Step 1 — Start the relay on your laptop

```bash
git clone https://github.com/imtia33/expo-feedback-Agent.git
cd expo-feedback-Agent/packages/expo-eyes-relay
npm install
npm start
```

The banner shows the **token** and the relay's URL. Save both.

```bash
# Verify the relay is up
curl http://localhost:8765/health
# → {"ok":true, "phone":{"phoneConnected":false, ...}}
```

Find your laptop's LAN IP (the phone needs this):

```bash
# macOS
ipconfig getifaddr en0

# Linux
ip addr show | grep 'inet ' | grep -v 127.0.0.1

# Windows PowerShell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*'} | Select IPAddress
```

## Step 2 — Install expo-eyes-app in your project

You have two options:

### Option A — Local file dependency (works today, no publish needed)

From inside your Expo project:

```bash
# If you cloned expo-feedback-Agent to ~/code/expo-feedback-Agent:
npm install ~/code/expo-feedback-Agent/packages/expo-eyes-app
```

Or use a relative path:

```bash
npm install ../expo-feedback-Agent/packages/expo-eyes-app
```

This adds an entry to your `package.json` like:
```json
"expo-eyes-app": "file:../expo-feedback-Agent/packages/expo-eyes-app"
```

### Option B — Pack and install (shareable across machines, no publish)

```bash
# In the expo-eyes-app package
cd expo-feedback-Agent/packages/expo-eyes-app
npm pack
# → creates expo-eyes-app-0.1.0.tgz

# In your project
npm install /path/to/expo-eyes-app-0.1.0.tgz
```

### Option C — Once we publish to npm (later)

```bash
npm install expo-eyes-app
```

(Not yet — package isn't published.)

## Step 3 — Wrap your app root in `<EyesProvider>`

This is the only code change you need. **One file.**

### If you use Expo Router (default for `create-expo-app`)

Find your root layout. It's usually at:
- `app/_layout.tsx` (top-level layout in app router)
- `src/app/_layout.tsx` (newer template)

Wrap it:

```tsx
// app/_layout.tsx (or src/app/_layout.tsx)
import { Stack } from 'expo-router';
import { EyesProvider } from 'expo-eyes-app';

export default function RootLayout() {
  return (
    <EyesProvider
      relayUrl="ws://YOUR_LAN_IP:8766"
      token="YOUR_TOKEN"
    >
      <Stack />
    </EyesProvider>
  );
}
```

### If you don't use Expo Router (blank template, App.js entry)

Find your `App.js` (or `App.tsx`):

```tsx
// App.tsx
import { EyesProvider } from 'expo-eyes-app';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <EyesProvider
      relayUrl="ws://YOUR_LAN_IP:8766"
      token="YOUR_TOKEN"
    >
      <View style={styles.container}>
        <Text>Your app here</Text>
        <StatusBar style="auto" />
      </View>
    </EyesProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});
```

### If you use React Navigation directly (no Expo Router)

Same pattern — wrap your root navigator:

```tsx
import { EyesProvider } from 'expo-eyes-app';
import { NavigationContainer } from '@react-navigation/native';

export default function App() {
  return (
    <EyesProvider relayUrl="ws://YOUR_LAN_IP:8766" token="YOUR_TOKEN">
      <NavigationContainer>
        {/* your Stack / Tab / Drawer navigator */}
      </NavigationContainer>
    </EyesProvider>
  );
}
```

## Step 4 — Don't hardcode the token (optional but recommended)

Use Expo's `EXPO_PUBLIC_*` env vars so you don't commit your token:

```bash
# .env (gitignored)
EXPO_PUBLIC_RELAY_URL=ws://192.168.1.5:8766
EXPO_PUBLIC_EYES_TOKEN=your-token-here
```

Then in your layout:

```tsx
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL!;
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN!;

<EyesProvider relayUrl={RELAY_URL} token={TOKEN}>
  {/* ... */}
</EyesProvider>
```

`.env` is read automatically by Expo CLI. Add `.env` to `.gitignore`.

## Step 5 — Start your app

```bash
npx expo start
```

Press `i` (iOS simulator), `a` (Android emulator), or scan the QR with Expo Go on your phone.

You should see a small badge in the top-right corner:

| Badge | Meaning |
|---|---|
| 🟢 **eyes:connected** | Phone is talking to the relay ✓ |
| 🟡 **eyes:connecting** | Still trying (or wrong IP/token) |
| 🔴 **eyes:disconnected** | Auth failed, or relay is down |

Check the relay console — you should see:
```
[ws] phone connecting from 192.168.1.42
[ws] phone authenticated: app=ios sdk=unknown
[relay] ✓ phone connected: app=ios
```

## Step 6 — Test from an agent

From your laptop (or anywhere with the token):

```bash
# Set env vars
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
export EXPO_EYES_TOKEN=YOUR_TOKEN

# Inspect your real app's tree!
npx expo-eyes-agent inspect
```

You should see YOUR app's components, YOUR testIDs, YOUR text content. **That's the loop working.**

## Troubleshooting

### "eyes:connecting" never turns green

1. **Same Wi-Fi?** Phone and laptop must be on the same network. Public Wi-Fi often blocks device-to-device traffic — use home Wi-Fi or a hotspot.
2. **Firewall?** macOS: System Settings → Network → Firewall → allow Node on ports 8765/8766. Windows: same idea.
3. **Right IP?** Run `curl http://YOUR_LAN_IP:8765/health` from another device — if it fails, the IP is wrong or firewall is blocking.
4. **Right token?** Compare the token in your `EyesProvider` to what the relay printed. They must match exactly.

### App crashes immediately on launch

Most common cause: `expo-eyes-app` peer deps don't match. Check:
- `react`: must be 19.x
- `react-native`: must be 0.86.x
- `expo`: must be 57.x

If your app is older, upgrade:
```bash
npx expo install expo@latest react@latest react-native@latest
```

### TypeScript errors in your project after install

If you see errors like "Cannot find module 'expo-eyes-app'" in your IDE:

```bash
# Restart the TS server (in VS Code: Cmd+Shift+P → "TypeScript: Restart TS Server")
# Or just restart your editor
```

### `NO_PHONE` from agent

The agent can't find the phone. Check:
1. Is the app running? (Green badge visible?)
2. Is the relay console showing "phone connected"?
3. Same token on both sides?

### Connection drops when app goes to background

iOS aggressively suspends WebSocket connections when the app is backgrounded. Either:
- Keep the app in the foreground while testing
- Or run on a simulator (simulators don't suspend)

This is iOS behavior, not a bug in expo-eyes. The connection auto-reconnects when the app returns to foreground.

## Verifying it really works — a 30-second test

Once everything is set up, run this from your laptop:

```bash
# 1. Check phone is connected
npx expo-eyes-agent health

# 2. Inspect the visible tree
npx expo-eyes-agent inspect > tree.json

# 3. Look at the top of the tree
head -30 tree.json

# 4. Find any Pressable / Button with a testID
#    (look for "testID" in the output)

# 5. Tap it (replace r5 with the actual ref)
npx expo-eyes-agent tap --ref r5

# 6. Inspect again — see if state changed
npx expo-eyes-agent inspect > tree2.json
diff <(jq '.tree' tree.json) <(jq '.tree' tree2.json) | head -20
```

If the diff shows state changes (like `counterValue` going from `0` to `1`), the loop is real. 🎉

## What's next

Once setup is done, tell me what you'd like to add:
- **Scroll position + visible-nodes tools** (v1.1 — fixes the nested scroll question)
- **Code editing tools** (readFile/editFile/grep + HMR wait)
- **VS Code extension** with a live activity panel
- **Real-device test together** — paste your `inspect` output and I'll show you how I'd reason over it
