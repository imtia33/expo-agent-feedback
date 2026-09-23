# expo-eyes Demo App

A minimal Expo SDK 57 app for driving with [expo-eyes](../../README.md) —
several screens' worth of buttons, inputs, and lists for an agent to see and
touch. Works in Expo Go.

| Screen | Tools it exercises |
|---|---|
| Home (`/`) | `tap` (counter buttons), `type` (name input), `longPress`, navigation |
| List (`/list`) | `expandList` (large FlatList, only ~10 items rendered), `scrollTo`, `scrollIntoView` |
| Playground (`/playground`) | free-form widgets for composite tools |
| About (`/about`) | static content, navigation back |

## Run it (from the monorepo)

```bash
# 0. one-time, from the repo root
npm install && npm run build

# 1. relay (terminal 1)
npm run relay

# 2. configure the demo app
cd examples/demo-app
echo "EXPO_PUBLIC_RELAY_URL=ws://YOUR_LAN_IP:8766" > .env
echo "EXPO_PUBLIC_EYES_TOKEN=YOUR_TOKEN" >> .env

# 3. start Expo (terminal 2) — open in Expo Go
npm run demo          # or: npx expo start
```

Then drive it:

```bash
export EXPO_EYES_RELAY_URL=http://YOUR_LAN_IP:8765
export EXPO_EYES_TOKEN=YOUR_TOKEN
npx expo-eyes-agent visibleText
npx expo-eyes-agent tapText --text "Increment"
```

No phone at hand? `npm run mock-phone` (repo root) connects a fake device
that answers every primitive — good enough to exercise the whole tool chain.

## Notes

- `EXPO_PUBLIC_*` env vars are read at bundle time — restart Expo after
  changing `.env`.
- The demo links `expo-eyes-app` through **npm workspaces** (dependency
  `"expo-eyes-app": "*"`), so rebuild the SDK (`npm run build -w
  expo-eyes-app`) after editing it and Expo's Metro picks up the new `dist`.
- `start-expo-polyfilled.js` is an optional launcher that polyfills
  `requestAnimationFrame` for Expo CLI's Node-side SSR pass (use it if your
  app crashes at startup with `requestAnimationFrame is not defined`).

Full scenario guide: [`docs/SETUP.md`](../../docs/SETUP.md).
