import { useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslator } from '../hooks/useTranslator';
import LanguagePicker from '../components/LanguagePicker';
import TextInputMode from '../components/TextInputMode';

export default function FaceToFaceScreen() {
  const [targetLanguage, setTargetLanguage] = useState({ code: 'en', label: 'English' });
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [detectedLanguage, setDetectedLanguage] = useState('');
  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Ready');
  const [mode, setMode] = useState('voice');
  const recordingRef = useRef(null);

  const { sendText, sendAudio } = useTranslator({
    targetLanguage: targetLanguage.code,
    onTranslation: (data) => {
      setTranscript(data.original);
      setDetectedLanguage(data.detectedLanguage || '');
      setTranslation(data.translated);
    },
    onStatus: setStatus,
  });

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
      setTranscript('');
      setTranslation('');
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
      setStatus('Translating...');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      setIsListening(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Face-to-Face</Text>

      <LanguagePicker selected={targetLanguage} onSelect={setTargetLanguage} />

      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'voice' && styles.modeBtnActive]}
          onPress={() => setMode('voice')}
        >
          <Text style={[styles.modeBtnText, mode === 'voice' && styles.modeBtnTextActive]}>Voice</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'text' && styles.modeBtnActive]}
          onPress={() => setMode('text')}
        >
          <Text style={[styles.modeBtnText, mode === 'text' && styles.modeBtnTextActive]}>Text</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.output} contentContainerStyle={styles.outputContent}>
        {transcript ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Original {detectedLanguage ? `(${detectedLanguage})` : ''}</Text>
            <Text style={styles.cardText}>{transcript}</Text>
          </View>
        ) : null}
        {translation ? (
          <View style={[styles.card, styles.cardTranslated]}>
            <Text style={styles.cardLabel}>Translation ({targetLanguage.label})</Text>
            <Text style={styles.cardText}>{translation}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Text style={styles.status}>{status}</Text>

      {mode === 'voice' ? (
        <TouchableOpacity
          style={[styles.micBtn, isListening && styles.micBtnActive]}
          onPress={isListening ? stopListening : startListening}
        >
          <Text style={styles.micBtnText}>{isListening ? 'Stop' : 'Tap to Speak'}</Text>
        </TouchableOpacity>
      ) : (
        <TextInputMode onSend={(text) => {
          setTranscript(text);
          setTranslation('');
          setStatus('Translating...');
          sendText(text);
        }} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  modeToggle: { flexDirection: 'row', backgroundColor: '#1e1e1e', borderRadius: 8, marginBottom: 16 },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  modeBtnActive: { backgroundColor: '#4f9eff' },
  modeBtnText: { color: '#888', fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },
  output: { flex: 1 },
  outputContent: { gap: 12 },
  card: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16 },
  cardTranslated: { backgroundColor: '#1a2e4a' },
  cardLabel: { color: '#888', fontSize: 12, marginBottom: 6 },
  cardText: { color: '#fff', fontSize: 16, lineHeight: 24 },
  status: { color: '#555', textAlign: 'center', marginVertical: 8, fontSize: 12 },
  micBtn: { backgroundColor: '#4f9eff', borderRadius: 50, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  micBtnActive: { backgroundColor: '#e74c3c' },
  micBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
