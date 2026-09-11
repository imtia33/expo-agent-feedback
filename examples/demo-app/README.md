# Demo App for expo-eyes

A minimal Expo SDK 57 app to test the eyes-and-fingers library against.

Built using the same structure as `npx create-expo-app@4.0.0 --template default`:
- Expo Router (`src/app/` directory)
- React 19.2.3, React Native 0.86.3, Expo 57.0.21
- TypeScript strict mode

## What it tests

| Screen | Tools exercised |
|---|---|
| Home (`/`) | `tap` (counter buttons), `type` (name input), `longPress` (hold-me button), navigation |
| List (`/list`) | `expandList` (2347-item FlatList — only ~10 rendered at a time), `scrollTo` |
| About (`/about`) | Static content, navigation back |

## Setup

See [`docs/SETUP.md`](../../docs/SETUP.md) for the full walkthrough. Quick version:

```bash
# 1. Start the relay (terminal 1)
cd ../../packages/expo-eyes-relay
npm install && npm start
# Note the token from the banner

# 2. Find your laptop LAN IP
ipconfig getifaddr en0   # macOS
# (Linux: ip addr show | grep 'inet ' | grep -v 127.0.0.1)

# 3. Configure the demo
cd ../../examples/demo-app
echo "EXPO_PUBLIC_RELAY_URL=ws://YOUR_LAN_IP:8766" > .env
echo "EXPO_PUBLIC_EYES_TOKEN=YOUR_TOKEN" >> .env

# 4. Run the demo
npm install
npx expo start
# Press i (iOS), a (Android), or scan QR with Expo Go
```

When you see the green "eyes:connected" badge in the top-right, you're ready.

## Quick test from an agent

```bash
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
export EXPO_EYES_TOKEN=YOUR_TOKEN

# Inspect the home screen
npx expo-eyes-agent inspect

# Tap the +1 button (find its ref in the inspect output, e.g. r5)
npx expo-eyes-agent tap --ref r5

# Type into the name input (find its ref, e.g. r7)
npx expo-eyes-agent type --ref r7 --text "World"

# Open the big list
npx expo-eyes-agent tap --ref <ref-of-go-to-list>

# Expand rows 100..110 of the FlatList
npx expo-eyes-agent expandList --listRef <ref-of-flat-list> --from 100 --to 110
```

## Why testIDs matter

Every tappable / typeable element in this demo has a `testID` prop. The agent can find elements by testID after `inspect()` — much more reliable than finding by text or position. **Add testIDs to your own app's key elements** for the best agent experience.

```tsx
<Pressable testID="submit-button" onPress={...}>...</Pressable>
<TextInput testID="email-input" ... />
```

The agent can then say "tap the submit button" → finds the node with `testID: "submit-button"` → uses its `ref` to call `tap`.
