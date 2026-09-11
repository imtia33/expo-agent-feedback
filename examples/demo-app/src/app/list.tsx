import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';

const DATA = Array.from({ length: 2347 }, (_, i) => ({
  id: `${i}`,
  title: `Item ${i + 1}`,
  subtitle: `This is row number ${i + 1} of ${2347}`,
}));

export default function ListScreen() {
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
        <Text style={styles.title} accessibilityRole="header">Big List (2347 items)</Text>
      </View>

      <FlatList
        testID="big-flat-list"
        data={DATA}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Pressable
            testID={`list-item-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Item ${index + 1}`}
            style={({ pressed }) => pressed ? styles.itemPressed : styles.item}
            onPress={() => Alert.alert('Tapped', item.title)}
          >
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
          </Pressable>
        )}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={7}
      />
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
  item: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemPressed: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#f5f5f5' },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  itemSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
});
