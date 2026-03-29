import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import LanguagePicker from '../components/LanguagePicker';
import { usePersistedLanguage } from '../hooks/usePersistedLanguage';

const SERVER_URL = 'wss://voice-translator-production-39cb.up.railway.app';
const SILENCE_THRESHOLD_DB = -45;  // dBFS — below this is silence
const SILENCE_CONSEC_COUNT = 1;    // consecutive silent readings before starting the timer (~150 ms)
const SILENCE_DURATION_MS = 900;   // ms of confirmed silence before sending
const MIN_SPEECH_MS = 400;         // ignore very short noise bursts

export default function CallScreen({ route }) {
  const [targetLanguage, setTargetLanguage] = usePersistedLanguage('@voice_translator_language');
  const [speechLanguage, setSpeechLanguage] = usePersistedLanguage('@voice_translator_speech_language');
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'waiting' | 'call'
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState(route?.params?.code || '');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('');
  const [micState, setMicState] = useState('idle'); // 'idle' | 'listening' | 'speech' | 'sending'
  const [peerSpeaking, setPeerSpeaking] = useState(false);

  const ws = useRef(null);
  const soundRef = useRef(null);
  const scrollRef = useRef(null);
  const roleRef = useRef(null);
  const mountedRef = useRef(true);

  // VAD state
  const recordingRef = useRef(null);
  const meteringIntervalRef = useRef(null);
  const silenceStartRef = useRef(null);
  const speechStartRef = useRef(null);
  const callActiveRef = useRef(false);
  const isPlayingRef = useRef(false);
  const audioQueueRef = useRef([]);
  const peerStatusSentRef = useRef('idle');
  const isPollingRef = useRef(false);
  const silenceCountRef = useRef(0);
  const deepLinkCodeRef = useRef(route?.params?.code || null);
  const roomCodeRef = useRef(null); // survives reconnects
  const reconnectingRef = useRef(false); // true while mid-call reconnect is in progress

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      callActiveRef.current = false;
      stopVAD();
      ws.current?.close();
    };
  }, []);

  useEffect(() => {
    if (ws.current?.readyState === 1) {
      ws.current.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code, speechLanguage: speechLanguage.code }));
    }
  }, [targetLanguage, speechLanguage]);

  // ─── WebSocket ────────────────────────────────────────────────────────────

  function connect() {
    const socket = new WebSocket(SERVER_URL);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'config', targetLanguage: targetLanguage.code, speechLanguage: speechLanguage.code }));
      if (deepLinkCodeRef.current) {
        // Opened via invite link — join the room
        socket.send(JSON.stringify({ type: 'join_room', roomCode: deepLinkCodeRef.current }));
        deepLinkCodeRef.current = null;
      } else if (roomCodeRef.current && roleRef.current === 'host') {
        // Host reconnecting — reclaim the room
        socket.send(JSON.stringify({ type: 'rejoin_host', roomCode: roomCodeRef.current }));
      } else if (roomCodeRef.current && roleRef.current === 'guest') {
        // Guest reconnecting — rejoin the room
        socket.send(JSON.stringify({ type: 'rejoin_guest', roomCode: roomCodeRef.current }));
      }
    };
    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'room_created') {
        setRoomCode(data.roomCode);
        roomCodeRef.current = data.roomCode;
        roleRef.current = 'host';
        if (reconnectingRef.current) {
          // Stay on call screen — server will also send guest_joined if guest is still there
          // If no guest_joined follows, the call effectively ended while we were away
          setStatus('Reconnecting...');
        } else {
          setScreen('waiting');
        }

      } else if (data.type === 'room_joined') {
        setRoomCode(data.roomCode);
        roomCodeRef.current = data.roomCode;
        roleRef.current = 'guest';
        setScreen('call');
        reconnectingRef.current = false;
        setStatus('');
        startVAD();

      } else if (data.type === 'guest_joined') {
        setScreen('call');
        reconnectingRef.current = false;
        setStatus('');
        startVAD();

      } else if (data.type === 'peer_status') {
        setPeerSpeaking(data.status === 'speaking');

      } else if (data.type === 'call_sent') {
        addMessage({ from: 'me', text: data.original, detected: data.detectedLanguage });
        setMicState('listening');

      } else if (data.type === 'call_received') {
        addMessage({ from: 'them', text: data.original, translated: data.translated, detected: data.detectedLanguage });
        audioQueueRef.current.push(data.audio);
        if (!isPlayingRef.current) {
          pauseVAD();
          processAudioQueue();
        }

      } else if (data.type === 'peer_reconnecting') {
        setStatus('Other person reconnecting...');

      } else if (data.type === 'guest_rejoined') {
        setStatus('');
        // Resume listening if VAD was paused while waiting for peer
        if (callActiveRef.current && !isPlayingRef.current && !recordingRef.current) {
          setMicState('listening');
          startNewRecording();
        }

      } else if (data.type === 'call_ended') {
        reconnectingRef.current = false;
        callActiveRef.current = false;
        roomCodeRef.current = null;
        stopVAD();
        setMicState('idle');
        setPeerSpeaking(false);
        setMessages([]);
        setStatus('The other person has left the call.');
        setScreen('lobby');

      } else if (data.type === 'error') {
        // Don't surface "no speech" as an error — it's a normal VAD false-trigger
        if (data.message !== 'No speech detected') setStatus(data.message);
        // If rejoin failed (room expired), go back to lobby
        if (reconnectingRef.current) {
          reconnectingRef.current = false;
          callActiveRef.current = false;
          roomCodeRef.current = null;
          stopVAD();
          setMicState('idle');
          setPeerSpeaking(false);
          setMessages([]);
          setScreen('lobby');
        }
      }
    };
    socket.onclose = () => {
      if (!mountedRef.current) return;
      if (callActiveRef.current) {
        // Mid-call drop — stay on call screen and attempt seamless rejoin
        reconnectingRef.current = true;
        stopVAD();
        setMicState('idle');
        setPeerSpeaking(false);
        setStatus('Reconnecting...');
      }
      // Reconnect (will rejoin room if roomCodeRef is set)
      setTimeout(connect, 3000);
    };
    ws.current = socket;
  }

  function addMessage(msg) {
    setMessages(prev => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  // ─── Audio playback ───────────────────────────────────────────────────────

  async function processAudioQueue() {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      if (callActiveRef.current) {
        setMicState('listening');
        await startNewRecording();
      }
      return;
    }
    isPlayingRef.current = true;
    const audio = audioQueueRef.current.shift();
    await playAudio(audio);
    await new Promise(r => setTimeout(r, 200)); // brief gap between consecutive messages
    processAudioQueue();
  }

  async function playAudio(base64Audio) {
    return new Promise(async (resolve) => {
      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const tmpUri = FileSystem.cacheDirectory + 'call_tts.mp3';
        await FileSystem.writeAsStringAsync(tmpUri, base64Audio, { encoding: 'base64' });
        const { sound } = await Audio.Sound.createAsync(
          { uri: tmpUri },
          { shouldPlay: true },
          (s) => { if (s.didJustFinish || s.error) resolve(); }
        );
        soundRef.current = sound;
      } catch (err) {
        console.error('Playback error:', err.message);
        resolve();
      }
    });
  }

  // ─── VAD ──────────────────────────────────────────────────────────────────

  async function startVAD() {
    callActiveRef.current = true;
    peerStatusSentRef.current = 'idle';
    setMicState('listening');
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { setStatus('Microphone permission denied'); return; }
      await startNewRecording();
    } catch (err) {
      setStatus(`Mic error: ${err.message}`);
    }
  }

  /** Stop current recording without sending — used before playback */
  function pauseVAD() {
    clearInterval(meteringIntervalRef.current);
    const rec = recordingRef.current;
    recordingRef.current = null;
    speechStartRef.current = null;
    silenceStartRef.current = null;
    silenceCountRef.current = 0;
    peerStatusSentRef.current = 'idle';
    setMicState('idle');
    if (rec) rec.stopAndUnloadAsync().catch(() => {});
  }

  /** Full stop — call ended or screen unmounted */
  function stopVAD() {
    clearInterval(meteringIntervalRef.current);
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) rec.stopAndUnloadAsync().catch(() => {});
  }

  async function startNewRecording() {
    if (!callActiveRef.current) return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
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
      speechStartRef.current = null;
      silenceStartRef.current = null;
      silenceCountRef.current = 0;
      isPollingRef.current = false;
      meteringIntervalRef.current = setInterval(pollMetering, 150);
    } catch (err) {
      if (callActiveRef.current) setStatus(`Recording error: ${err.message}`);
    }
  }

  async function pollMetering() {
    if (isPollingRef.current || !recordingRef.current || !callActiveRef.current || isPlayingRef.current) return;
    isPollingRef.current = true;
    try {
      const s = await recordingRef.current.getStatusAsync();
      const db = s.metering ?? -160;
      const now = Date.now();

      if (db > SILENCE_THRESHOLD_DB) {
        // ── Speech ──
        silenceCountRef.current = 0;
        silenceStartRef.current = null;
        if (!speechStartRef.current) {
          speechStartRef.current = now;
          if (peerStatusSentRef.current !== 'speaking') {
            peerStatusSentRef.current = 'speaking';
            ws.current?.send(JSON.stringify({ type: 'peer_status', status: 'speaking' }));
          }
        }
        setMicState('speech');

      } else if (speechStartRef.current) {
        // ── Silence after speech — require SILENCE_CONSEC_COUNT consecutive silent readings
        // before starting the timer, so brief inter-word pauses don't trigger early sends
        silenceCountRef.current += 1;
        if (silenceCountRef.current >= SILENCE_CONSEC_COUNT) {
          if (!silenceStartRef.current) silenceStartRef.current = now;
          const speechDuration = silenceStartRef.current - speechStartRef.current;
          const silenceDuration = now - silenceStartRef.current;
          if (silenceDuration >= SILENCE_DURATION_MS && speechDuration >= MIN_SPEECH_MS) {
            clearInterval(meteringIntervalRef.current);
            isPollingRef.current = false;
            await sendCurrentRecording();
            return;
          }
        }

      } else {
        // ── Ambient silence, nothing detected yet ──
        silenceCountRef.current = 0;
        setMicState('listening');
      }
    } catch {
      // recording may have been stopped externally
    } finally {
      isPollingRef.current = false;
    }
  }

  async function sendCurrentRecording() {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec || !callActiveRef.current) return;
    try {
      setMicState('sending');
      if (peerStatusSentRef.current !== 'idle') {
        peerStatusSentRef.current = 'idle';
        ws.current?.send(JSON.stringify({ type: 'peer_status', status: 'idle' }));
      }
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (uri) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        ws.current?.send(JSON.stringify({ type: 'transcribe_audio', audio: base64, callMode: true }));
      }
    } catch (err) {
      if (callActiveRef.current) setStatus(`Error: ${err.message}`);
    } finally {
      if (callActiveRef.current) await startNewRecording();
    }
  }

  // ─── Room actions ─────────────────────────────────────────────────────────

  function startCall() {
    ws.current?.send(JSON.stringify({ type: 'create_room' }));
  }

  function joinCall() {
    if (!joinCode.trim()) return;
    ws.current?.send(JSON.stringify({ type: 'join_room', roomCode: joinCode.trim() }));
  }

  // ─── Screens ──────────────────────────────────────────────────────────────

  if (screen === 'lobby') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Translated Call</Text>
        <Text style={styles.subtitle}>Each person hears the other in their own language</Text>

        <LanguagePicker selected={speechLanguage} onSelect={setSpeechLanguage} label="I speak" />
        <LanguagePicker selected={targetLanguage} onSelect={setTargetLanguage} label="I hear in" />

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
            message: `Join my Voice Translator call!\nhttps://voice-translator-production-39cb.up.railway.app/join/${roomCode}`,
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

  // ── Active call ────────────────────────────────────────────────────────────
  const MIC_COLOR = { idle: '#2a2a2a', listening: '#1a3a1a', speech: '#2ecc71', sending: '#2a2a4a' };
  const MIC_LABEL = { idle: '...', listening: 'Listening', speech: 'Speaking detected', sending: 'Translating...' };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.callHeader}>
        <View style={styles.connectedBadge}>
          <Text style={styles.connectedDot}>●</Text>
          <Text style={styles.connectedText}>Connected · Room {roomCode}</Text>
        </View>
        <Text style={styles.langLabel}>Speaking: {speechLanguage.label} · Hearing in: {targetLanguage.label}</Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messages.length === 0 && (
          <Text style={styles.emptyMsg}>Just speak — the other person will hear your words translated automatically.</Text>
        )}
        {messages.map((msg, i) => (
          <View key={i} style={[styles.bubble, msg.from === 'me' ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={styles.bubbleLabel}>{msg.from === 'me' ? 'You said' : `They said (${msg.detected || ''})`}</Text>
            <Text style={styles.bubbleText}>{msg.text}</Text>
            {msg.translated && <Text style={styles.bubbleTranslated}>→ {msg.translated}</Text>}
          </View>
        ))}
      </ScrollView>

      {peerSpeaking && (
        <View style={styles.peerBadge}>
          <Text style={styles.peerBadgeText}>● Other person is speaking...</Text>
        </View>
      )}

      <View style={[styles.micIndicator, { backgroundColor: MIC_COLOR[micState] }]}>
        <Text style={styles.micIndicatorText}>{MIC_LABEL[micState]}</Text>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}
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
  status: { color: '#e74c3c', textAlign: 'center', marginTop: 8, fontSize: 13 },
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
  peerBadge: { backgroundColor: '#1e1e1e', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'center', marginBottom: 8 },
  peerBadgeText: { color: '#f39c12', fontSize: 13 },
  micIndicator: { borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 4 },
  micIndicatorText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
