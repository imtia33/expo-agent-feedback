import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Configuration for the expo-eyes relay.
 *
 * Read these from environment variables if possible. Expo Router supports
 * .env files with `EXPO_PUBLIC_*` prefix:
 *   EXPO_PUBLIC_RELAY_URL=ws://192.168.1.5:8766
 *   EXPO_PUBLIC_EYES_TOKEN=your-token
 *
 * For local dev, just hardcode them here.
 */
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'ws://192.168.1.5:8766';
const TOKEN = process.env.EXPO_PUBLIC_EYES_TOKEN || 'REPLACE_WITH_TOKEN';

export default function RootLayout() {
  return (
    <EyesProvider relayUrl={RELAY_URL} token={TOKEN}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
