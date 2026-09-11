import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { EyesProvider } from 'expo-eyes-app';

/**
 * Configuration for the expo-eyes relay.
 *
 * Set these in a .env file (Expo CLI reads it automatically):
 *   EXPO_PUBLIC_RELAY_URL=ws://192.168.1.5:8766
 *   EXPO_PUBLIC_EYES_TOKEN=your-token-here   (omit for LAN-only / no-auth mode)
 *
 * In LAN-only mode (relay started without --token), just set RELAY_URL
 * and leave TOKEN empty.
 */
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL!;
const TOKEN = "ultron123";

export default function RootLayout() {
  return (
    <EyesProvider relayUrl={RELAY_URL} token={TOKEN}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
