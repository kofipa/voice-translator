import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import LanguagePicker from './components/LanguagePicker';
import TextInputMode from './components/TextInputMode';

const SERVER_URL = 'ws://192.168.0.245:3000';

export default function App() {
  const [targetLanguage, setTargetLanguage] = useState({ code: 'en', label: 'English' });
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [detectedLanguage, setDetectedLanguage] = useState('');
  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Ready');
  const [mode, setMode] = useState('voice');

  const ws = useRef(null);
  const recording = useRef(null);
  const soundRef = useRef(null);

  useEffect(() => {
    connectWebSocket();
    return () => ws.current?.close();
  }, []);


  useEffect(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'config',
        targetLanguage: targetLanguage.code,
      }));
    }
  }, [targetLanguage]);

  function connectWebSocket() {
    const socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
      setStatus('Connected');
      socket.send(JSON.stringify({
        type: 'config',
        targetLanguage: targetLanguage.code,
      }));
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'interim') {
        setTranscript(data.transcript);
      } else if (data.type === 'translation') {
        setTranscript(data.original);
        setDetectedLanguage(data.detectedLanguage || '');
        setTranslation(data.translated);
        setStatus('Ready');
        await playAudio(data.audio);
      } else if (data.type === 'error') {
        setStatus(`Error: ${data.message}`);
      }
    };

    socket.onclose = () => {
      setStatus('Disconnected — retrying...');
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = () => setStatus('Connection error');
    ws.current = socket;
  }

  async function playAudio(base64Audio) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const tmpUri = FileSystem.cacheDirectory + 'tts_output.mp3';
      await FileSystem.writeAsStringAsync(tmpUri, base64Audio, { encoding: 'base64' });
      const { sound } = await Audio.Sound.createAsync({ uri: tmpUri }, { shouldPlay: true });
      soundRef.current = sound;
    } catch (err) {
      console.error('Audio playback error:', err.message);
    }
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
      recording.current = rec;
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
      await recording.current?.stopAndUnloadAsync();
      const uri = recording.current?.getURI();
      recording.current = null;

      setIsListening(false);

      if (!uri) { setStatus('Error: no audio recorded'); return; }
      if (ws.current?.readyState !== WebSocket.OPEN) { setStatus('Error: not connected'); return; }

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

      ws.current.send(JSON.stringify({ type: 'transcribe_audio', audio: base64 }));
      setStatus('Translating...');
    } catch (err) {
      console.error('stopListening error:', err);
      setStatus(`Error: ${err.message}`);
      setIsListening(false);
    }
  }

  async function sendText(text) {
    if (!text.trim()) return;
    setTranscript(text);
    setTranslation('');
    setStatus('Translating...');
    ws.current?.send(JSON.stringify({ type: 'translate_text', text }));
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Voice Translator</Text>

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
        <TextInputMode onSend={sendText} />
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
