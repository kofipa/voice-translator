import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import LanguagePicker from '../components/LanguagePicker';

const SERVER_URL = 'wss://voice-translator-production-39cb.up.railway.app';

export default function CallScreen() {
  const [targetLanguage, setTargetLanguage] = useState({ code: 'en', label: 'English' });
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'waiting' | 'call'
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('');
  const [guestJoined, setGuestJoined] = useState(false);

  const ws = useRef(null);
  const recordingRef = useRef(null);
  const soundRef = useRef(null);
  const scrollRef = useRef(null);
  const roleRef = useRef(null);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, []);

  useEffect(() => {
    if (ws.current?.readyState === 1) {
      ws.current.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code }));
    }
  }, [targetLanguage]);

  function connect() {
    const socket = new WebSocket(SERVER_URL);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code }));
    };
    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'room_created') {
        setRoomCode(data.roomCode);
        setScreen('waiting');
        roleRef.current = 'host';
      } else if (data.type === 'room_joined') {
        setRoomCode(data.roomCode);
        setScreen('call');
        roleRef.current = 'guest';
        setStatus('Connected! You can now speak.');
      } else if (data.type === 'guest_joined') {
        setGuestJoined(true);
        setScreen('call');
        setStatus('Connected! You can now speak.');
      } else if (data.type === 'call_sent') {
        addMessage({ from: 'me', text: data.original, detected: data.detectedLanguage });
      } else if (data.type === 'call_received') {
        addMessage({ from: 'them', text: data.original, translated: data.translated, detected: data.detectedLanguage });
        await playAudio(data.audio);
      } else if (data.type === 'call_ended') {
        setStatus('The other person has left the call.');
        setScreen('lobby');
        setMessages([]);
      } else if (data.type === 'error') {
        setStatus(data.message);
      }
    };
    socket.onclose = () => setTimeout(connect, 3000);
    ws.current = socket;
  }

  function addMessage(msg) {
    setMessages(prev => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function playAudio(base64Audio) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const tmpUri = FileSystem.cacheDirectory + 'call_tts.mp3';
      await FileSystem.writeAsStringAsync(tmpUri, base64Audio, { encoding: 'base64' });
      const { sound } = await Audio.Sound.createAsync({ uri: tmpUri }, { shouldPlay: true });
      soundRef.current = sound;
    } catch (err) {
      console.error('Playback error:', err.message);
    }
  }

  function startCall() {
    ws.current?.send(JSON.stringify({ type: 'create_room' }));
  }

  function joinCall() {
    if (!joinCode.trim()) return;
    ws.current?.send(JSON.stringify({ type: 'join_room', roomCode: joinCode.trim() }));
  }

  async function startListening() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { setStatus('Microphone permission denied'); return; }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const { recording } = await Audio.Recording.createAsync({
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
      recordingRef.current = recording;
      setIsListening(true);
      setStatus('Listening...');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function stopListening() {
    try {
      await recordingRef.current?.stopAndUnloadAsync();
      const uri = recordingRef.current?.getURI();
      recordingRef.current = null;
      setIsListening(false);
      setStatus('Sending...');

      if (!uri) return;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      ws.current?.send(JSON.stringify({ type: 'transcribe_audio', audio: base64, callMode: true }));
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      setIsListening(false);
    }
  }

  // LOBBY
  if (screen === 'lobby') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Translated Call</Text>
        <Text style={styles.subtitle}>Each person hears the other in their own language</Text>

        <LanguagePicker selected={targetLanguage} onSelect={setTargetLanguage} />

        <TouchableOpacity style={styles.primaryBtn} onPress={startCall}>
          <Text style={styles.primaryBtnText}>Start a Call</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or join one</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.joinRow}>
          <TextInput
            style={styles.codeInput}
            placeholder="Enter room code"
            placeholderTextColor="#555"
            value={joinCode}
            onChangeText={setJoinCode}
            keyboardType="number-pad"
            maxLength={4}
          />
          <TouchableOpacity style={styles.joinBtn} onPress={joinCall}>
            <Text style={styles.joinBtnText}>Join</Text>
          </TouchableOpacity>
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}
      </SafeAreaView>
    );
  }

  // WAITING FOR GUEST
  if (screen === 'waiting') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Waiting for the other person</Text>
        <Text style={styles.subtitle}>Share this code with them</Text>

        <View style={styles.codeDisplay}>
          <Text style={styles.codeText}>{roomCode}</Text>
        </View>

        <TouchableOpacity
          style={styles.shareBtn}
          onPress={() => Share.share({
            message: `Join my Voice Translator call! Open the app, tap "Translated Call" and enter code: ${roomCode}`,
          })}
        >
          <Text style={styles.shareBtnText}>Share Code via...</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>Or ask them to open the app, tap "Translated Call" and enter the code above</Text>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => setScreen('lobby')}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ACTIVE CALL
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.callHeader}>
        <View style={styles.connectedBadge}>
          <Text style={styles.connectedDot}>●</Text>
          <Text style={styles.connectedText}>Connected · Room {roomCode}</Text>
        </View>
        <Text style={styles.langLabel}>Your language: {targetLanguage.label}</Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messages.length === 0 && (
          <Text style={styles.emptyMsg}>Tap and hold the button to speak. The other person will hear your translation.</Text>
        )}
        {messages.map((msg, i) => (
          <View key={i} style={[styles.bubble, msg.from === 'me' ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={styles.bubbleLabel}>{msg.from === 'me' ? 'You said' : `They said (${msg.detected || ''})`}</Text>
            <Text style={styles.bubbleText}>{msg.text}</Text>
            {msg.translated && <Text style={styles.bubbleTranslated}>→ {msg.translated}</Text>}
          </View>
        ))}
      </ScrollView>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <TouchableOpacity
        style={[styles.micBtn, isListening && styles.micBtnActive]}
        onPress={isListening ? stopListening : startListening}
      >
        <Text style={styles.micBtnText}>{isListening ? 'Stop' : 'Tap to Speak'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { color: '#555', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  primaryBtn: { backgroundColor: '#4f9eff', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 24 },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2a2a2a' },
  dividerText: { color: '#555', fontSize: 13 },
  joinRow: { flexDirection: 'row', gap: 8 },
  codeInput: { flex: 1, backgroundColor: '#1e1e1e', borderRadius: 10, color: '#fff', padding: 14, fontSize: 18, textAlign: 'center', letterSpacing: 6 },
  joinBtn: { backgroundColor: '#4f9eff', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  status: { color: '#e74c3c', textAlign: 'center', marginTop: 16, fontSize: 13 },
  codeDisplay: { backgroundColor: '#1e1e1e', borderRadius: 20, padding: 40, alignItems: 'center', marginVertical: 24 },
  codeText: { color: '#4f9eff', fontSize: 56, fontWeight: '800', letterSpacing: 12 },
  shareBtn: { backgroundColor: '#4f9eff', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  shareBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: '#555', textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 32 },
  cancelBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#888', fontSize: 15 },
  callHeader: { marginBottom: 12 },
  connectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  connectedDot: { color: '#2ecc71', fontSize: 10 },
  connectedText: { color: '#2ecc71', fontSize: 13, fontWeight: '600' },
  langLabel: { color: '#555', fontSize: 12 },
  messages: { flex: 1 },
  messagesContent: { gap: 10, paddingBottom: 8 },
  emptyMsg: { color: '#444', textAlign: 'center', marginTop: 40, fontSize: 14, lineHeight: 22 },
  bubble: { borderRadius: 12, padding: 14, maxWidth: '85%' },
  bubbleMe: { backgroundColor: '#1a2e4a', alignSelf: 'flex-end' },
  bubbleThem: { backgroundColor: '#1e1e1e', alignSelf: 'flex-start' },
  bubbleLabel: { color: '#888', fontSize: 11, marginBottom: 4 },
  bubbleText: { color: '#fff', fontSize: 15 },
  bubbleTranslated: { color: '#4f9eff', fontSize: 13, marginTop: 6 },
  micBtn: { backgroundColor: '#4f9eff', borderRadius: 50, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  micBtnActive: { backgroundColor: '#e74c3c' },
  micBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
