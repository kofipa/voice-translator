require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const API_KEY = process.env.GOOGLE_API_KEY;

// Active rooms: roomCode -> { host: ws, guest: ws }
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

async function transcribeAudio(base64Audio) {
  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'AMR_WB',
          sampleRateHertz: 16000,
          languageCode: 'en-US',
          alternativeLanguageCodes: ['fr-FR', 'es-ES', 'ar-SA'],
        },
        audio: { content: base64Audio },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function translateText(text, targetLanguage) {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: targetLanguage, format: 'text' }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data.translations[0].translatedText;
}

async function textToSpeechAudio(text, languageCode) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.audioContent;
}

function send(ws, payload) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
}

wss.on('connection', (ws) => {
  let targetLanguage = 'en';
  let roomCode = null;
  let role = null; // 'host' | 'guest'

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      // --- Config ---
      if (data.type === 'config') {
        targetLanguage = data.targetLanguage || 'en';
        return;
      }

      // --- Create room ---
      if (data.type === 'create_room') {
        roomCode = generateRoomCode();
        role = 'host';
        rooms.set(roomCode, { host: ws, guest: null });
        send(ws, { type: 'room_created', roomCode });
        return;
      }

      // --- Join room ---
      if (data.type === 'join_room') {
        const code = data.roomCode?.toString().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
          return;
        }
        if (room.guest) {
          send(ws, { type: 'error', message: 'Room is full.' });
          return;
        }
        room.guest = ws;
        roomCode = code;
        role = 'guest';
        send(ws, { type: 'room_joined', roomCode });
        send(room.host, { type: 'guest_joined' });
        return;
      }

      // --- Text translation (solo modes) ---
      if (data.type === 'translate_text') {
        try {
          const translated = await translateText(data.text, targetLanguage);
          const audio = await textToSpeechAudio(translated, targetLanguage);
          send(ws, { type: 'translation', original: data.text, translated, audio });
        } catch (err) {
          send(ws, { type: 'error', message: err.message });
        }
        return;
      }

      // --- Audio transcription ---
      if (data.type === 'transcribe_audio') {
        try {
          const sttResponse = await transcribeAudio(data.audio);
          const results = sttResponse.results || [];
          const transcript = results.map(r => r.alternatives[0].transcript).join(' ').trim();

          if (!transcript) {
            send(ws, { type: 'error', message: 'No speech detected' });
            return;
          }

          const detectedLanguage = results[0]?.languageCode || 'en-US';

          // If in a room, translate for the OTHER person
          const room = roomCode ? rooms.get(roomCode) : null;
          if (room && data.callMode) {
            const other = role === 'host' ? room.guest : room.host;
            if (!other) {
              send(ws, { type: 'error', message: 'Other person has not joined yet.' });
              return;
            }
            // Send the other person's language (stored on their ws object)
            const otherLanguage = other._targetLanguage || 'en';
            const translated = await translateText(transcript, otherLanguage);
            const audio = await textToSpeechAudio(translated, otherLanguage);
            // Send original back to sender so they see what was said
            send(ws, { type: 'call_sent', original: transcript, detectedLanguage });
            // Send translation to the other person
            send(other, { type: 'call_received', original: transcript, translated, detectedLanguage, audio });
          } else {
            // Solo mode
            const translated = await translateText(transcript, targetLanguage);
            const audio = await textToSpeechAudio(translated, targetLanguage);
            send(ws, { type: 'translation', original: transcript, translated, detectedLanguage, audio });
          }
        } catch (err) {
          console.error('Transcribe error:', err.message);
          send(ws, { type: 'error', message: err.message });
        }
        return;
      }
    } catch {
      // ignore non-JSON
    }
  });

  // Store target language on the ws object for cross-client access
  Object.defineProperty(ws, '_targetLanguage', {
    get: () => targetLanguage,
    configurable: true,
  });

  ws.on('close', () => {
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const other = role === 'host' ? room.guest : room.host;
        send(other, { type: 'call_ended' });
        rooms.delete(roomCode);
      }
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
