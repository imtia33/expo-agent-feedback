import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';

export default function AboutScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          testID="back-button"
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">About</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.paragraph}>
          This is a demo app for expo-eyes, an agent eyes-and-fingers library
          for Expo apps.
        </Text>
        <Text style={styles.paragraph}>
          An AI agent can inspect the visible tree, tap buttons, type into
          inputs, scroll lists, and verify the results — all over HTTP,
          without ever touching the device.
        </Text>
        <Pressable
          testID="docs-link"
          accessibilityRole="link"
          accessibilityLabel="Open expo-eyes on GitHub"
          style={styles.linkButton}
          onPress={() => Linking.openURL('https://github.com/imtia33/expo-feedback-Agent')}
        >
          <Text style={styles.linkText}>View on GitHub →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: { paddingVertical: 6, paddingHorizontal: 10 },
  backText: { color: '#0a7ea4', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: 'bold' },
  content: { padding: 20, gap: 16 },
  paragraph: { fontSize: 15, lineHeight: 22, color: '#333' },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#0a7ea4',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  linkText: { color: 'white', fontWeight: '600' },
});
