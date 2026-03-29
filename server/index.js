require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Keep-alive: ping every 25 s so Railway doesn't close idle WebSocket connections
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(pingInterval));

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) console.error('WARNING: GOOGLE_API_KEY is not set — all Google API calls will fail');

// Map short language codes to BCP-47 locale codes for Speech-to-Text
const SPEECH_LOCALE = {
  en: 'en-US', el: 'el-GR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE',
  it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL', pl: 'pl-PL', ru: 'ru-RU',
  ar: 'ar-SA', zh: 'zh-CN', 'zh-TW': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR',
  hi: 'hi-IN', bn: 'bn-BD', tr: 'tr-TR', vi: 'vi-VN', th: 'th-TH',
  sw: 'sw-KE', fa: 'fa-IR', ur: 'ur-PK', id: 'id-ID', ms: 'ms-MY',
  uk: 'uk-UA', ro: 'ro-RO', sv: 'sv-SE', no: 'no-NO', fi: 'fi-FI',
  da: 'da-DK', cs: 'cs-CZ', hu: 'hu-HU', he: 'he-IL',
};
function toSpeechLocale(code) {
  return SPEECH_LOCALE[code] || 'en-US';
}

// Active rooms: roomCode -> { host: ws, guest: ws }
const rooms = new Map();
// Pending deletion timeouts for rooms whose host disconnected while waiting
const roomGraceTimeouts = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

// languageCode: specific locale (e.g. 'el-GR') when known, null to fall back to auto-detect pool
async function transcribeAudio(base64Audio, languageCode = null) {
  const sttConfig = languageCode
    ? { encoding: 'AMR_WB', sampleRateHertz: 16000, languageCode }
    : { encoding: 'AMR_WB', sampleRateHertz: 16000, languageCode: 'en-US', alternativeLanguageCodes: ['el-GR', 'fr-FR', 'es-ES'] };
  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: sttConfig,
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let targetLanguage = 'en';
  let roomCode = null;
  let role = null; // 'host' | 'guest'

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      // --- Config ---
      if (data.type === 'config') {
        targetLanguage = data.targetLanguage || 'en';
        ws._targetLanguage = targetLanguage;
        ws._speechLanguage = data.speechLanguage ? toSpeechLocale(data.speechLanguage) : null;
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

      // --- Guest rejoining after reconnect ---
      if (data.type === 'rejoin_guest') {
        const code = data.roomCode?.toString().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: 'Call no longer available.' });
          return;
        }
        const t = roomGraceTimeouts.get(code + '_guest');
        if (t) { clearTimeout(t); roomGraceTimeouts.delete(code + '_guest'); }
        room.guest = ws;
        roomCode = code;
        role = 'guest';
        ws._targetLanguage = targetLanguage;
        send(ws, { type: 'room_joined', roomCode: code });
        send(room.host, { type: 'guest_rejoined' });
        return;
      }

      // --- Host rejoining after reconnect ---
      if (data.type === 'rejoin_host') {
        const code = data.roomCode?.toString().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: 'Room expired. Please start a new call.' });
          return;
        }
        // Cancel the grace-period deletion
        const t = roomGraceTimeouts.get(code);
        if (t) { clearTimeout(t); roomGraceTimeouts.delete(code); }
        room.host = ws;
        roomCode = code;
        role = 'host';
        ws._targetLanguage = targetLanguage;
        send(ws, { type: 'room_created', roomCode: code });
        // If guest already joined while host was away, tell host immediately
        if (room.guest) send(ws, { type: 'guest_joined' });
        return;
      }

      // --- Peer status relay (speaking / idle) ---
      if (data.type === 'peer_status') {
        const room = roomCode ? rooms.get(roomCode) : null;
        if (room) {
          const other = role === 'host' ? room.guest : room.host;
          send(other, { type: 'peer_status', status: data.status });
        }
        return;
      }

      // --- Detect text in image (Vision API) ---
      if (data.type === 'detect_text') {
        try {
          const res = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requests: [{
                  image: { content: data.image },
                  features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
                }],
              }),
            }
          );
          const visionData = await res.json();
          if (visionData.error) throw new Error(visionData.error.message);
          const annotation = visionData.responses?.[0]?.fullTextAnnotation;
          if (!annotation?.text) {
            send(ws, { type: 'error', message: 'No text detected in image' });
            return;
          }
          const extractedText = annotation.text.trim();
          const translated = await translateText(extractedText, targetLanguage);
          const audio = await textToSpeechAudio(translated, targetLanguage);
          send(ws, { type: 'vision_result', original: extractedText, translated, audio });
        } catch (err) {
          send(ws, { type: 'error', message: err.message });
        }
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
          // In call mode, use the sender's configured speech language for best accuracy
          const sttLang = (data.callMode && ws._speechLanguage) ? ws._speechLanguage : null;
          const sttResponse = await transcribeAudio(data.audio, sttLang);
          const results = sttResponse.results || [];
          const transcript = results
            .filter(r => r.alternatives?.length > 0)
            .map(r => r.alternatives[0].transcript)
            .join(' ')
            .trim();

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

  // Set default so it's readable before the first config message arrives
  ws._targetLanguage = 'en';

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      if (room.guest) {
        // Active call — give 15 s grace for host to reconnect
        send(room.guest, { type: 'peer_reconnecting' });
        room.host = null;
        const t = setTimeout(() => {
          const r = rooms.get(roomCode);
          if (r) { send(r.guest, { type: 'call_ended' }); rooms.delete(roomCode); }
          roomGraceTimeouts.delete(roomCode);
        }, 15000);
        roomGraceTimeouts.set(roomCode, t);
      } else {
        // Still waiting for guest — give 30 s grace for host to reconnect
        room.host = null;
        const t = setTimeout(() => {
          rooms.delete(roomCode);
          roomGraceTimeouts.delete(roomCode);
        }, 30000);
        roomGraceTimeouts.set(roomCode, t);
      }
    } else if (role === 'guest') {
      // Give 15 s grace for guest to reconnect
      send(room.host, { type: 'peer_reconnecting' });
      room.guest = null;
      const t = setTimeout(() => {
        const r = rooms.get(roomCode);
        if (r) { send(r.host, { type: 'call_ended' }); rooms.delete(roomCode); }
        roomGraceTimeouts.delete(roomCode + '_guest');
      }, 15000);
      roomGraceTimeouts.set(roomCode + '_guest', t);
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/join/:code', (req, res) => {
  const code = req.params.code.replace(/[^0-9]/g, '').slice(0, 4);
  if (!code) return res.status(400).send('Invalid code');
  const deepLink = `voicetranslator://join?code=${code}`;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Join Voice Translator Call</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f0f0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{text-align:center;max-width:360px;width:100%}
    h1{font-size:22px;font-weight:700;margin-bottom:8px}
    .sub{color:#666;font-size:14px;margin-bottom:36px;line-height:1.5}
    .code-box{background:#1e1e1e;border-radius:20px;padding:32px 24px;margin-bottom:32px}
    .code{font-size:64px;font-weight:800;letter-spacing:14px;color:#4f9eff}
    .label{color:#555;font-size:12px;margin-top:8px;letter-spacing:0}
    .btn{display:block;background:#4f9eff;color:#fff;text-decoration:none;border-radius:14px;padding:18px;font-size:17px;font-weight:700;margin-bottom:16px}
    .btn:active{opacity:.85}
    .hint{color:#555;font-size:13px;line-height:1.6}
    .hint strong{color:#888}
  </style>
</head>
<body>
  <div class="card">
    <h1>Voice Translator Call</h1>
    <p class="sub">Someone has invited you to a translated call.<br/>Each person hears the other in their own language.</p>
    <div class="code-box">
      <div class="code">${code}</div>
      <div class="label">Room code</div>
    </div>
    <a class="btn" href="${deepLink}" id="openBtn">Open in App</a>
    <p class="hint">
      Don't have the app installed yet?<br/>
      Open <strong>Voice Translator</strong>, tap <strong>Translated Call</strong>,<br/>
      and enter the code above.
    </p>
  </div>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
