import { Stack } from 'expo-router';
import { EyesProvider } from 'expo-eyes-app';
import { Platform } from 'react-native';

// Replace with your laptop's LAN IP and the token printed by `expo-eyes-relay`
const RELAY_URL = Platform.select({
  // Default to localhost for emulator; replace with your laptop IP for real device
  default: 'ws://192.168.1.5:8766',
});

const TOKEN = 'REPLACE_WITH_TOKEN_FROM_RELAY';

export default function RootLayout() {
  return (
    <EyesProvider relayUrl={RELAY_URL!} token={TOKEN}>
      <Stack screenOptions={{ headerShown: true }} />
    </EyesProvider>
  );
}
