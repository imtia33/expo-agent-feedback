import { View, Text, Pressable, ScrollView, StyleSheet, Image } from 'react-native';
import { useState, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
// The reanimated babel plugin is configured in babel.config.js.
// The proxy stubs browser requests, so Expo never runs web SSR — no crash.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

const SAMPLE_IMAGE = 'https://picsum.photos/seed/expoeyes/400/300';

export default function PlaygroundScreen() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [swipeCount, setSwipeCount] = useState(0);
  const [selectedColor, setSelectedColor] = useState(0);
  const sheetRef = useRef<BottomSheet>(null);
  const colors = ['#0a7ea4', '#22c55e', '#a83232', '#f59e0b', '#8b5cf6'];

  const handleHaptic = async (type: 'light' | 'medium' | 'heavy' | 'success' | 'error') => {
    try {
      switch (type) {
        case 'light': await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
        case 'medium': await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
        case 'heavy': await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
        case 'success': await Haptics.notificationAsync(Haptics.NotificationType.Success); break;
        case 'error': await Haptics.notificationAsync(Haptics.NotificationType.Error); break;
      }
    } catch {}
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ScrollView testID="playground-scroll" contentContainerStyle={styles.container}>
        <Text style={styles.title} accessibilityRole="header">Agent Playground</Text>
        <Text style={styles.subtitle}>Tests expo-image, expo-blur, expo-haptics, gradients, bottom sheet, swipe</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Counter (tap test)</Text>
          <Text style={styles.counterValue} testID="counter-value">{count}</Text>
          <View style={styles.row}>
            <Pressable
              testID="increment-button"
              accessibilityRole="button"
              accessibilityLabel="Increment"
              style={[styles.button, { backgroundColor: '#0a7ea4' }]}
              onPress={() => { setCount((c) => c + 1); handleHaptic('light'); }}
            >
              <Text style={styles.buttonText}>+1</Text>
            </Pressable>
            <Pressable
              testID="decrement-button"
              accessibilityRole="button"
              accessibilityLabel="Decrement"
              style={[styles.button, { backgroundColor: '#a83232' }]}
              onPress={() => { setCount((c) => c - 1); handleHaptic('medium'); }}
            >
              <Text style={styles.buttonText}>-1</Text>
            </Pressable>
            <Pressable
              testID="reset-button"
              accessibilityRole="button"
              accessibilityLabel="Reset"
              style={[styles.button, { backgroundColor: '#666' }]}
              onPress={() => { setCount(0); handleHaptic('heavy'); }}
            >
              <Text style={styles.buttonText}>Reset</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>expo-image (network)</Text>
          <ExpoImage
            testID="network-image"
            source={{ uri: SAMPLE_IMAGE }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            accessible
            accessibilityLabel="Sample network image"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>expo-blur (blur overlay)</Text>
          <View style={styles.blurContainer}>
            <Image source={{ uri: SAMPLE_IMAGE }} style={styles.image} />
            <BlurView intensity={50} tint="dark" style={styles.blurOverlay}>
              <Text style={styles.blurText} testID="blur-text">I'm behind blur</Text>
            </BlurView>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>expo-linear-gradient</Text>
          <LinearGradient
            testID="gradient"
            colors={['#0a7ea4', '#8b5cf6', '#f59e0b']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            <Text style={styles.gradientText} testID="gradient-text">Gradient!</Text>
          </LinearGradient>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>expo-haptics</Text>
          <View style={styles.row}>
            <Pressable testID="haptic-light" style={[styles.button, { backgroundColor: '#22c55e' }]} onPress={() => handleHaptic('light')}>
              <Text style={styles.buttonText}>Light</Text>
            </Pressable>
            <Pressable testID="haptic-success" style={[styles.button, { backgroundColor: '#22c55e' }]} onPress={() => handleHaptic('success')}>
              <Text style={styles.buttonText}>Success</Text>
            </Pressable>
            <Pressable testID="haptic-error" style={[styles.button, { backgroundColor: '#a83232' }]} onPress={() => handleHaptic('error')}>
              <Text style={styles.buttonText}>Error</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Swipe test (change color)</Text>
          <Text style={styles.swipeCount} testID="swipe-count">Swipes: {swipeCount}</Text>
          <Pressable
            testID="swipe-target"
            accessibilityRole="button"
            accessibilityLabel="Swipe me left or right"
            style={[styles.swipeBox, { backgroundColor: colors[selectedColor] }]}
          >
            <Text style={styles.swipeText} testID="swipe-label">
              {selectedColor === 0 ? 'Swipe me →' : `Color ${selectedColor + 1}/5`}
            </Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable testID="swipe-left" style={[styles.button, { backgroundColor: '#666' }]} onPress={() => { setSelectedColor((c) => (c + 4) % 5); setSwipeCount((s) => s + 1); }}>
              <Text style={styles.buttonText}>← Prev</Text>
            </Pressable>
            <Pressable testID="swipe-right" style={[styles.button, { backgroundColor: '#666' }]} onPress={() => { setSelectedColor((c) => (c + 1) % 5); setSwipeCount((s) => s + 1); }}>
              <Text style={styles.buttonText}>Next →</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>@gorhom/bottom-sheet</Text>
          <Pressable
            testID="open-sheet"
            accessibilityRole="button"
            accessibilityLabel="Open bottom sheet"
            style={[styles.button, { backgroundColor: '#8b5cf6' }]}
            onPress={() => sheetRef.current?.expand()}
          >
            <Text style={styles.buttonText}>Open Bottom Sheet</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Pressable
            testID="back-home"
            accessibilityRole="button"
            accessibilityLabel="Back to home"
            style={[styles.button, { backgroundColor: '#666' }]}
            onPress={() => router.push('/')}
          >
            <Text style={styles.buttonText}>← Back to Home</Text>
          </Pressable>
        </View>

        <View style={{ height: 200 }} />
      </ScrollView>

      <BottomSheet
        ref={sheetRef}
        snapPoints={['25%', '50%', '90%']}
        enablePanDownToClose
        testID="bottom-sheet"
      >
        <BottomSheetView style={styles.sheetContent}>
          <Text style={styles.sheetTitle} testID="sheet-title">Bottom Sheet Open!</Text>
          <Text style={styles.sheetSubtitle}>Drag me down to close</Text>
          <Pressable
            testID="close-sheet"
            accessibilityRole="button"
            accessibilityLabel="Close bottom sheet"
            style={[styles.button, { backgroundColor: '#0a7ea4', marginTop: 20 }]}
            onPress={() => sheetRef.current?.close()}
          >
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheet>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: 'bold', marginTop: 16 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 8 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  counterValue: { fontSize: 48, fontWeight: 'bold', textAlign: 'center', marginVertical: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  button: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', minWidth: 80 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  image: { width: '100%', height: 200, borderRadius: 12 },
  blurContainer: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  blurOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  blurText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  gradient: { height: 120, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  gradientText: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  swipeBox: { height: 120, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  swipeText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  swipeCount: { fontSize: 16, color: '#444', textAlign: 'center' },
  sheetContent: { flex: 1, padding: 20, alignItems: 'center' },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  sheetSubtitle: { fontSize: 14, color: '#666' },
});
