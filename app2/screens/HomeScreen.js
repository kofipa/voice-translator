import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

const MODES = [
  {
    key: 'facetime',
    title: 'Face-to-Face',
    description: 'Translate conversations in real time between two people',
    icon: '🗣️',
    screen: 'FaceToFace',
  },
  {
    key: 'phrase',
    title: 'Phrase Lookup',
    description: 'Learn how to say something in another language',
    icon: '📖',
    screen: 'PhraseLookup',
  },
  {
    key: 'call',
    title: 'Translated Call',
    description: 'Make calls where each person hears their own language',
    icon: '📞',
    screen: 'Call',
    comingSoon: true,
  },
];

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Voice Translator</Text>
      <Text style={styles.subtitle}>Choose a mode to get started</Text>

      <View style={styles.modes}>
        {MODES.map((mode) => (
          <TouchableOpacity
            key={mode.key}
            style={[styles.card, mode.comingSoon && styles.cardDisabled]}
            onPress={() => !mode.comingSoon && navigation.navigate(mode.screen)}
            activeOpacity={mode.comingSoon ? 1 : 0.7}
          >
            <Text style={styles.icon}>{mode.icon}</Text>
            <View style={styles.cardText}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{mode.title}</Text>
                {mode.comingSoon && (
                  <Text style={styles.badge}>Coming Soon</Text>
                )}
              </View>
              <Text style={styles.cardDesc}>{mode.description}</Text>
            </View>
            {!mode.comingSoon && <Text style={styles.arrow}>›</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 20 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 20 },
  subtitle: { color: '#555', fontSize: 15, marginTop: 6, marginBottom: 32 },
  modes: { gap: 12 },
  card: {
    backgroundColor: '#1e1e1e', borderRadius: 14, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  cardDisabled: { opacity: 0.4 },
  icon: { fontSize: 32 },
  cardText: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  badge: {
    backgroundColor: '#2a2a2a', color: '#888', fontSize: 10,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  cardDesc: { color: '#666', fontSize: 13, lineHeight: 18 },
  arrow: { color: '#555', fontSize: 24 },
});
