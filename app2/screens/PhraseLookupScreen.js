import { useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslator } from '../hooks/useTranslator';
import LanguagePicker from '../components/LanguagePicker';

export default function PhraseLookupScreen() {
  const [targetLanguage, setTargetLanguage] = useState({ code: 'fr', label: 'French' });
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('Enter a phrase to translate');
  const [isListening, setIsListening] = useState(false);
  const recordingRef = useRef(null);

  const { sendText, sendAudio } = useTranslator({
    targetLanguage: targetLanguage.code,
    onTranslation: (data) => {
      setResult({ original: data.original, translated: data.translated });
      setStatus('Tap the translation to hear it again');
    },
    onStatus: (s) => {
      if (s !== 'Ready' && s !== 'Connected') setStatus(s);
    },
  });

  async function handleLookup() {
    if (!phrase.trim()) return;
    setResult(null);
    setStatus('Looking up...');
    sendText(phrase.trim());
  }

  async function startListening() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { setStatus('Microphone permission denied'); return; }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const { recording: rec } = await Audio.Recording.createAsync({
        android: {
          extension: '.amr',
          outputFormat: Audio.AndroidOutputFormat.AMR_WB,
          audioEncoder: Audio.AndroidAudioEncoder.AMR_WB,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 23850,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      });
      recordingRef.current = rec;
      setIsListening(true);
      setStatus('Listening... tap Stop when done');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function stopListening() {
    try {
      setStatus('Processing...');
      await recordingRef.current?.stopAndUnloadAsync();
      const uri = recordingRef.current?.getURI();
      recordingRef.current = null;
      setIsListening(false);
      if (!uri) { setStatus('Error: no audio recorded'); return; }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      sendAudio(base64);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      setIsListening(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Phrase Lookup</Text>
      <Text style={styles.subtitle}>How do you say it in...</Text>

      <LanguagePicker selected={targetLanguage} onSelect={setTargetLanguage} />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a phrase..."
          placeholderTextColor="#555"
          value={phrase}
          onChangeText={setPhrase}
          onSubmitEditing={handleLookup}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup}>
          <Text style={styles.lookupBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or speak</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        style={[styles.micBtn, isListening && styles.micBtnActive]}
        onPress={isListening ? stopListening : startListening}
      >
        <Text style={styles.micBtnText}>{isListening ? 'Stop' : 'Tap to Speak'}</Text>
      </TouchableOpacity>

      <Text style={styles.status}>{status}</Text>

      {result ? (
        <ScrollView style={styles.result}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>You said</Text>
            <Text style={styles.cardText}>{result.original}</Text>
          </View>
          <View style={[styles.card, styles.cardTranslated]}>
            <Text style={styles.cardLabel}>In {targetLanguage.label}</Text>
            <Text style={styles.cardTranslatedText}>{result.translated}</Text>
            <Text style={styles.cardHint}>Audio played automatically</Text>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  subtitle: { color: '#555', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  input: {
    flex: 1, backgroundColor: '#1e1e1e', borderRadius: 10,
    color: '#fff', padding: 14, fontSize: 15,
  },
  lookupBtn: { backgroundColor: '#4f9eff', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  lookupBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2a2a2a' },
  dividerText: { color: '#555', fontSize: 13 },
  micBtn: { backgroundColor: '#1e1e1e', borderRadius: 50, paddingVertical: 16, alignItems: 'center' },
  micBtnActive: { backgroundColor: '#e74c3c' },
  micBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  status: { color: '#555', textAlign: 'center', marginVertical: 12, fontSize: 12 },
  result: { flex: 1 },
  card: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTranslated: { backgroundColor: '#1a2e4a' },
  cardLabel: { color: '#888', fontSize: 12, marginBottom: 6 },
  cardText: { color: '#fff', fontSize: 16 },
  cardTranslatedText: { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 32 },
  cardHint: { color: '#4f9eff', fontSize: 11, marginTop: 8 },
});
