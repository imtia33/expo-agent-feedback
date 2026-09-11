import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Relay URL resolution.
 *
 * Three modes:
 *  1. EXPO_PUBLIC_RELAY_URL is an explicit ws://host:port → use it directly
 *     (for real-device testing on LAN).
 *  2. EXPO_PUBLIC_RELAY_URL is "auto" or unset → derive from window.location
 *     so the WS goes through the sandbox gateway (Caddy) using the
 *     ?XTransformPort=<port> query. This makes the relay reachable from the
 *     preview panel without any third-party tunnel.
 *  3. On native (Expo Go on a phone) with no env → fall back to
 *     ws://localhost:8766 (developer's machine on LAN — override via env).
 */
const ENV_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL;
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN || 'ultron123';

function resolveRelayUrl(): string {
  // Mode 1: explicit URL
  if (ENV_RELAY_URL && ENV_RELAY_URL !== 'auto' && ENV_RELAY_URL.startsWith('ws')) {
    return ENV_RELAY_URL;
  }

  // Mode 3: native fallback
  if (Platform.OS !== 'web') {
    return ENV_RELAY_URL && ENV_RELAY_URL !== 'auto'
      ? ENV_RELAY_URL
      : 'ws://localhost:8766';
  }

  // Mode 2: web — derive from window.location, route WS through the gateway
  // using ?XTransformPort=8766 (the sandbox Caddy reverse-proxy).
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.host; // e.g. preview.example.com:81
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // The Caddy gateway routes ws://host/?XTransformPort=8766 → localhost:8766
    return `${proto}://${host}/?XTransformPort=8766`;
  }

  return 'ws://localhost:8766';
}

export default function RootLayout() {
  const relayUrl = resolveRelayUrl();
  return (
    <EyesProvider relayUrl={relayUrl} token={TOKEN}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
