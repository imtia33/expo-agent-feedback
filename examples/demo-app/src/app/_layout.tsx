import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Root layout.
 *
 * The web preview is stubbed by the public-host-proxy (returns a minimal HTML
 * page for browser requests, never hits Expo's SSR renderer). So Expo runs in
 * native-only mode — no web SSR, no crashes from native-only modules.
 *
 * EyesProvider wraps the app on ALL platforms, but on web the proxy stubs
 * the request before it reaches Expo, so the web bundle never actually runs.
 * Only native (Expo Go) connects to the relay.
 */

const ENV_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL;
const ENV_PUBLIC_HOST = process.env.EXPO_PUBLIC_PUBLIC_HOST;
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN || 'ultron123';
const RELAY_WS_PORT = 8766;

function resolveRelayUrl(): string {
  if (ENV_RELAY_URL && ENV_RELAY_URL !== 'auto' && ENV_RELAY_URL.startsWith('ws')) {
    return ENV_RELAY_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${host}/?XTransformPort=${RELAY_WS_PORT}`;
  }
  if (ENV_PUBLIC_HOST) {
    return `wss://${ENV_PUBLIC_HOST}/?XTransformPort=${RELAY_WS_PORT}`;
  }
  return 'ws://localhost:8766';
}

export default function RootLayout() {
  return (
    <EyesProvider relayUrl={resolveRelayUrl()} token={TOKEN}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
