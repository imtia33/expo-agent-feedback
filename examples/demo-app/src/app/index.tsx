import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Alert } from 'react-native';
import { Link } from 'expo-router';
import { useState } from 'react';

export default function HomeScreen() {
  const [count, setCount] = useState(0);
  const [inputText, setInputText] = useState('');

  return (
    <ScrollView testID="home-scroll" contentContainerStyle={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        expo-eyes Demo
      </Text>
      <Text style={styles.subtitle}>
        A tiny app to test the eyes-and-fingers library.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Counter (test tap)</Text>
        <Text style={styles.counterValue} testID="counter-value">
          {count}
        </Text>
        <Pressable
          testID="increment-button"
          accessibilityRole="button"
          accessibilityLabel="Increment counter"
          style={styles.button}
          onPress={() => setCount((c) => c + 1)}
        >
          <Text style={styles.buttonText}>+1</Text>
        </Pressable>
        <Pressable
          testID="reset-button"
          accessibilityRole="button"
          accessibilityLabel="Reset counter"
          style={[styles.button, styles.secondaryButton]}
          onPress={() => setCount(0)}
        >
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Text input (test type)</Text>
        <TextInput
          testID="name-input"
          accessibilityLabel="Name input"
          placeholder="Enter your name"
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
        />
        <Text style={styles.echo} testID="echo-text">
          {inputText ? `Hello, ${inputText}!` : 'Type something above'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Navigation</Text>
        <Link href="/list" asChild>
          <Pressable
            testID="go-to-list"
            accessibilityRole="button"
            accessibilityLabel="Go to list screen"
            style={[styles.button, styles.secondaryButton]}
          >
            <Text style={styles.buttonText}>Open List →</Text>
          </Pressable>
        </Link>
        <Link href="/about" asChild>
          <Pressable
            testID="go-to-about"
            accessibilityRole="button"
            accessibilityLabel="Go to about screen"
            style={[styles.button, styles.secondaryButton]}
          >
            <Text style={styles.buttonText}>About →</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Long press (test longPress)</Text>
        <Pressable
          testID="long-press-target"
          accessibilityRole="button"
          accessibilityLabel="Long press me"
          style={[styles.button, styles.longPressButton]}
          onLongPress={() => Alert.alert('Long pressed!', 'You held it long enough.')}
          delayLongPress={400}
        >
          <Text style={styles.buttonText}>Hold me</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginTop: 16 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 8 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  counterValue: {
    fontSize: 48,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 12,
  },
  button: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButton: { backgroundColor: '#666' },
  longPressButton: { backgroundColor: '#a83232' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  echo: { fontSize: 16, color: '#444', fontStyle: 'italic' },
});
