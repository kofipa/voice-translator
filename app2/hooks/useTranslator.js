import { useEffect, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

const SERVER_URL = 'wss://voice-translator-production-39cb.up.railway.app';

export function useTranslator({ targetLanguage, onTranslation, onError, onStatus }) {
  const ws = useRef(null);
  const soundRef = useRef(null);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, []);

  useEffect(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'config', targetLanguage }));
    }
  }, [targetLanguage]);

  function connect() {
    const socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
      onStatus?.('Connected');
      socket.send(JSON.stringify({ type: 'config', targetLanguage }));
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'translation') {
        onTranslation?.(data);
        await playAudio(data.audio);
        onStatus?.('Ready');
      } else if (data.type === 'error') {
        onError?.(data.message);
        onStatus?.(`Error: ${data.message}`);
      }
    };

    socket.onclose = () => {
      onStatus?.('Disconnected — retrying...');
      setTimeout(connect, 3000);
    };

    socket.onerror = () => onStatus?.('Connection error');
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

  const sendText = useCallback((text) => {
    ws.current?.send(JSON.stringify({ type: 'translate_text', text }));
  }, []);

  const sendAudio = useCallback((base64) => {
    ws.current?.send(JSON.stringify({ type: 'transcribe_audio', audio: base64 }));
  }, []);

  return { sendText, sendAudio };
}
