# Demo App for expo-eyes

A minimal Expo SDK 57 app to test the eyes-and-fingers library against.

## Setup

1. **Start the relay** (on your laptop):
   ```bash
   cd ../../packages/expo-eyes-relay
   npm install && npm start
   # Note the token printed in the banner
   ```

2. **Find your laptop's LAN IP** (e.g. `ipconfig getifaddr en0` on macOS, `ip addr` on Linux)

3. **Update `app/_layout.tsx`** with your IP and the token:
   ```tsx
   const RELAY_URL = 'ws://192.168.1.5:8766';
   const TOKEN = 'PASTE_TOKEN_HERE';
   ```

4. **Install and run the demo app**:
   ```bash
   npm install
   npx expo start
   # Press 'i' for iOS simulator, 'a' for Android emulator,
   # or scan the QR code with Expo Go on your phone
   ```

5. **Verify the connection** — you should see `[relay] ✓ phone connected` in the relay console, and a small green "eyes:connected" badge in the top-right of the app.

## What's in the demo

| Screen | What it tests |
|---|---|
| Home (`/`) | `tap` (counter buttons), `type` (name input), `longPress` (hold-me button), navigation |
| List (`/list`) | `expandList` (2347-item FlatList — only ~10 rendered at a time) |
| About (`/about`) | Static content, navigation back |

## Quick test from an agent (curl)

```bash
TOKEN="your-token"
RELAY="http://localhost:8765"

# Inspect the visible tree
curl -X POST -H "Authorization: Bearer $TOKEN" $RELAY/tool/inspect | jq '.result.tree.children[].children[] | {type, testID, text}'

# Tap the increment button
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"ref":"r5"}' $RELAY/tool/tap

# Type into the name input
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"ref":"r7","text":"World"}' $RELAY/tool/type

# Inspect the list, then expand rows 100..110
curl -X POST -H "Authorization: Bearer $TOKEN" \
     -d '{"listRef":"r10","from":100,"to":110}' $RELAY/tool/expandList
```

(Replace `r5`, `r7`, `r10` with the actual ref IDs from `inspect`.)
