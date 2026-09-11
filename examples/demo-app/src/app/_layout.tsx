import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Relay URL resolution — works for BOTH web preview AND Expo Go on a phone.
 *
 * The key insight: when tunneling through the sandbox gateway, BOTH the app
 * bundle AND the relay WS must be reachable via the public domain. The app
 * bundle comes through `https://<public-host>/` (Expo dev server, proxied).
 * The relay WS comes through `wss://<public-host>/?XTransformPort=8766`
 * (the gateway routes ?XTransformPort=8766 → localhost:8766 = relay WS).
 *
 * Modes:
 *  1. EXPO_PUBLIC_RELAY_URL is an explicit ws://host:port → use it directly
 *     (for real-device LAN testing where the phone is on the same network
 *     as the relay).
 *  2. EXPO_PUBLIC_RELAY_URL is "auto" (recommended for sandbox):
 *     - On web: derive from window.location.host (the browser's public URL).
 *     - On native (Expo Go): use EXPO_PUBLIC_PUBLIC_HOST env var to build
 *       the tunneled WS URL. This is necessary because native has no
 *       window.location — the app doesn't know its own public URL.
 *  3. Fallback: ws://localhost:8766 (only works when the phone is on LAN
 *     with the relay — NOT the sandbox case).
 *
 * REQUIRED ENV VARS for sandbox + Expo Go:
 *   EXPO_PUBLIC_RELAY_URL=auto
 *   EXPO_PUBLIC_PUBLIC_HOST=preview-chat-<chat-id>.space-z.ai
 *   EXPO_PUBLIC_EYES_TOKEN=ultron123
 */
const ENV_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL;
const ENV_PUBLIC_HOST = process.env.EXPO_PUBLIC_PUBLIC_HOST;
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN || 'ultron123';
const RELAY_WS_PORT = 8766;

function resolveRelayUrl(): string {
  // Mode 1: explicit ws:// URL (LAN testing)
  if (ENV_RELAY_URL && ENV_RELAY_URL !== 'auto' && ENV_RELAY_URL.startsWith('ws')) {
    return ENV_RELAY_URL;
  }

  // Mode 2a: web preview — derive from window.location
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const host = window.location.host; // e.g. preview-chat-xxx.space-z.ai
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${host}/?XTransformPort=${RELAY_WS_PORT}`;
  }

  // Mode 2b: native (Expo Go) — use the public host from env, tunnel WS
  // through the gateway via ?XTransformPort=8766.
  if (ENV_PUBLIC_HOST) {
    return `wss://${ENV_PUBLIC_HOST}/?XTransformPort=${RELAY_WS_PORT}`;
  }

  // Mode 3: fallback (LAN only — phone on same network as relay)
  return 'ws://localhost:8766';
}

export default function RootLayout() {
  // On web (sandbox preview), DON'T wrap in EyesProvider — the web preview
  // only exists to keep the preview URL alive and show the public domain.
  // We don't want it connecting to the relay (it would displace Expo Go or
  // add noise). Only native (Expo Go) connects to the relay.
  if (Platform.OS === 'web') {
    return (
      <>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: true }} />
      </>
    );
  }

  const relayUrl = resolveRelayUrl();
  return (
    <EyesProvider relayUrl={relayUrl} token={TOKEN}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
