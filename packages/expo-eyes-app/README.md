# expo-eyes-app

> Eyes and fingers for AI agents, inside your Expo app.
> Wrap your root component in `<EyesProvider>` — an agent connected to an
> [expo-eyes-relay](https://www.npmjs.com/package/expo-eyes-relay) can then
> inspect the live React tree and tap, type, and scroll on a real device.

- **Pure JS** — works in **Expo Go**, no dev client, no native module
- **Production-safe** — a strict no-op when `__DEV__` is false
- **Tiny** — a thin client: 18 primitives, no agent logic in your bundle

## Install

```bash
npx expo install expo-eyes-app
```

## Use

```tsx
import { EyesProvider } from 'expo-eyes-app';

export default function App() {
  return (
    <EyesProvider
      relayUrl="ws://192.168.1.5:8766"   // relay's phone-facing WS port
      token="shared-secret"               // must match the relay's --token
    >
      <RealApp />
    </EyesProvider>
  );
}
```

Start a relay ([expo-eyes-relay](https://www.npmjs.com/package/expo-eyes-relay))
and drive your app from any HTTP client:

```bash
npx expo-eyes-relay --token shared-secret
# …open your app in Expo Go, then:
npx expo-eyes-agent visibleText
npx expo-eyes-agent tapText --text "Sign in"
```

## Props

| Prop | Required | Description |
|---|---|---|
| `relayUrl` | yes | Relay WS URL — `ws://<host>:8766` on LAN, `wss://…` behind TLS. The phone dials **out** to the relay, so NATs/tunnels on the relay side just work. |
| `token` | yes | Auth token; empty string for an open (tokenless) relay. |
| `children` | yes | Your app. |
| `showStatus` | no | Small `eyes:connected` badge (default: dev only). |

Environment-driven setup (used by the demo app):

```tsx
<EyesProvider
  relayUrl={process.env.EXPO_PUBLIC_RELAY_URL ?? 'ws://localhost:8766'}
  token={process.env.EXPO_PUBLIC_EYES_TOKEN ?? ''}
>
```

## What it exposes to the relay

18 low-level **primitives** over WebSocket — `listVisibleElements`,
`inspectAtPoint`, `dispatchEvent`, `scroll`, `scrollToIndex`, `swipe`,
`pinch`, `screenshot`, `readScreen`, `layout`, `waitForElement`, `navigate`,
`back`, `assertVisible`, `assertText`, `assertEnabled`, `ping`,
`diagnostics`. All higher-level behavior (26 agent-facing tools, refs,
verification, caching) lives in the relay — see
[ARCHITECTURE.md](https://github.com/imtia33/expo-agent-feedback/blob/main/docs/ARCHITECTURE.md).

The provider also forwards runtime errors and unhandled rejections to the
relay's event stream (`GET /events`), so the agent sees app-side crashes.

## Compatibility

Peer deps: `react ≥ 19`, `react-native ≥ 0.79`, `expo ≥ 57` (verified against
Expo SDK 57 / RN 0.86, New Architecture enabled). Works in Expo Go and dev
clients. The production bundle is unaffected — the provider renders
`children` directly and never opens a socket.

## How it works

1. `EyesProvider` attaches to `__REACT_DEVTOOLS_GLOBAL_HOOK__` (installed by
   RN itself) and captures your root view's host instance.
2. A WebSocket client connects out to the relay with auto-reconnect +
   exponential backoff and an outbound queue (tool results are never lost on
   a blip).
3. Incoming `tool-call` messages dispatch to the primitive handlers; results
   come back with the same `callId`.

Peer identification: each process sends a stable `deviceId` + device name in
its hello, so a relay can hold multiple phones at once (yours, a teammate's,
an emulator, a web preview) without confusing them.

## License

MIT
