import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Root layout — wraps the app in EyesProvider so an AI agent connected to
 * the relay can see (inspect) and touch (tap/type/scroll) the app.
 *
 * Configuration (all via env vars, no hardcoded secrets):
 *   EXPO_PUBLIC_RELAY_URL  full relay WS URL, e.g. ws://192.168.1.5:8766
 *                          or wss://my-relay.example.com (tunnel / remote)
 *   EXPO_PUBLIC_EYES_TOKEN auth token — must match the relay's --token flag
 *
 * If EXPO_PUBLIC_RELAY_URL is not set, defaults to ws://localhost:8766
 * (relay running on the same machine; works with an Android emulator using
 * adb reverse, or a device on the same LAN when the relay host is set).
 *
 * On web the WS URL is derived from window.location (same host, ws/wss),
 * which works when the relay sits behind the same reverse proxy.
 */

const ENV_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL;
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN || '';

function resolveRelayUrl(): string {
  if (ENV_RELAY_URL && ENV_RELAY_URL.startsWith('ws')) {
    return ENV_RELAY_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${host}`;
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
