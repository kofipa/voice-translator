import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LanguagePicker from '../components/LanguagePicker';
import { usePersistedLanguage } from '../hooks/usePersistedLanguage';

const SERVER_URL = 'wss://voice-translator-production-39cb.up.railway.app';
const AUTO_PLAY_KEY = '@visual_translator_autoplay';

export default function VisualTranslatorScreen() {
  const [targetLanguage, setTargetLanguage] = usePersistedLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState('camera'); // 'camera' | 'text'
  const [autoPlay, setAutoPlay] = useState(true);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { original, translated, audio }
  const [textInput, setTextInput] = useState('');

  const cameraRef = useRef(null);
  const ws = useRef(null);
  const soundRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    AsyncStorage.getItem(AUTO_PLAY_KEY)
      .then(val => { if (val !== null) setAutoPlay(val === 'true'); })
      .catch(() => {});
    connect();
    return () => {
      mountedRef.current = false;
      ws.current?.close();
    };
  }, []);

  useEffect(() => {
    if (ws.current?.readyState === 1) {
      ws.current.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code }));
    }
  }, [targetLanguage]);

  function toggleAutoPlay(val) {
    setAutoPlay(val);
    AsyncStorage.setItem(AUTO_PLAY_KEY, String(val)).catch(() => {});
  }

  function connect() {
    const socket = new WebSocket(SERVER_URL);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code }));
    };
    socket.onmessage = async (event) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(event.data);
      if (data.type === 'vision_result' || data.type === 'translation') {
        const next = { original: data.original, translated: data.translated, audio: data.audio };
        setResult(next);
        setStatus('');
        setLoading(false);
        if (autoPlayRef.current && data.audio) await playAudio(data.audio);
      } else if (data.type === 'error') {
        setStatus(data.message);
        setLoading(false);
      }
    };
    socket.onclose = () => {
      if (!mountedRef.current) return;
      setTimeout(connect, 3000);
    };
    ws.current = socket;
  }

  // Keep a ref so the onmessage closure always sees the current value
  const autoPlayRef = useRef(autoPlay);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);

  async function playAudio(base64Audio) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const tmpUri = FileSystem.cacheDirectory + 'vision_tts.mp3';
      await FileSystem.writeAsStringAsync(tmpUri, base64Audio, { encoding: 'base64' });
      const { sound } = await Audio.Sound.createAsync({ uri: tmpUri }, { shouldPlay: true });
      soundRef.current = sound;
    } catch (err) {
      console.error('Playback error:', err.message);
    }
  }

  async function capture() {
    if (!cameraRef.current || loading) return;
    try {
      setLoading(true);
      setStatus('Scanning...');
      setResult(null);

      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: false });
      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      setStatus('Reading text...');
      ws.current?.send(JSON.stringify({ type: 'detect_text', image: manipulated.base64 }));
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      setLoading(false);
    }
  }

  function translateText() {
    const text = textInput.trim();
    if (!text || loading) return;
    setLoading(true);
    setStatus('Translating...');
    setResult(null);
    ws.current?.send(JSON.stringify({ type: 'translate_text', text }));
  }

  if (!permission) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Visual Translator</Text>
        <Text style={styles.permText}>Camera access is needed to scan text.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Language + audio toggle row */}
      <View style={styles.topRow}>
        <View style={styles.pickerWrapper}>
          <LanguagePicker selected={targetLanguage} onSelect={setTargetLanguage} label="Translate to" />
        </View>
        <View style={styles.toggleBox}>
          <Text style={styles.toggleLabel}>Audio</Text>
          <Switch
            value={autoPlay}
            onValueChange={toggleAutoPlay}
            trackColor={{ false: '#333', true: '#4f9eff' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Mode tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, mode === 'camera' && styles.tabActive]}
          onPress={() => setMode('camera')}
        >
          <Text style={[styles.tabText, mode === 'camera' && styles.tabTextActive]}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'text' && styles.tabActive]}
          onPress={() => setMode('text')}
        >
          <Text style={[styles.tabText, mode === 'text' && styles.tabTextActive]}>Text</Text>
        </TouchableOpacity>
      </View>

      {mode === 'camera' ? (
        <>
          <View style={styles.cameraWrapper}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <View style={styles.overlay}>
              <View style={styles.corner} />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
            onPress={capture}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.actionBtnText}>Scan Text</Text>
            }
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.textInputArea}>
          <TextInput
            style={styles.input}
            placeholder="Type text to translate..."
            placeholderTextColor="#555"
            value={textInput}
            onChangeText={setTextInput}
            multiline
            onSubmitEditing={translateText}
          />
          <TouchableOpacity
            style={[styles.actionBtn, (loading || !textInput.trim()) && styles.actionBtnDisabled]}
            onPress={translateText}
            disabled={loading || !textInput.trim()}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.actionBtnText}>Translate</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {result && (
        <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultContent}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Detected text</Text>
            <Text style={styles.cardText}>{result.original}</Text>
          </View>
          <View style={[styles.card, styles.cardTranslated]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>Translation ({targetLanguage.label})</Text>
              {result.audio && (
                <TouchableOpacity style={styles.playBtn} onPress={() => playAudio(result.audio)}>
                  <Text style={styles.playBtnText}>▶ Play</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.cardText}>{result.translated}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  permText: { color: '#888', textAlign: 'center', marginBottom: 24, fontSize: 15 },
  primaryBtn: { backgroundColor: '#4f9eff', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  pickerWrapper: { flex: 1 },
  toggleBox: { alignItems: 'center', gap: 2 },
  toggleLabel: { color: '#888', fontSize: 11 },

  tabs: { flexDirection: 'row', backgroundColor: '#1e1e1e', borderRadius: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#4f9eff' },
  tabText: { color: '#888', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#fff' },

  cameraWrapper: { borderRadius: 16, overflow: 'hidden', aspectRatio: 4 / 3, marginBottom: 10 },
  camera: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  corner: { width: '80%', aspectRatio: 1, borderWidth: 2, borderColor: 'rgba(79,158,255,0.6)', borderRadius: 8 },

  textInputArea: { gap: 10, marginBottom: 4 },
  input: {
    backgroundColor: '#1e1e1e', borderRadius: 12, color: '#fff',
    padding: 14, fontSize: 15, minHeight: 100, textAlignVertical: 'top',
  },

  actionBtn: { backgroundColor: '#4f9eff', borderRadius: 50, paddingVertical: 16, alignItems: 'center' },
  actionBtnDisabled: { backgroundColor: '#2a5a8a' },
  actionBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  status: { color: '#e74c3c', textAlign: 'center', marginVertical: 6, fontSize: 13 },

  resultScroll: { flex: 1, marginTop: 8 },
  resultContent: { gap: 12 },
  card: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16 },
  cardTranslated: { backgroundColor: '#1a2e4a' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardLabel: { color: '#888', fontSize: 12 },
  cardText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  playBtn: { backgroundColor: '#4f9eff', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  playBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
