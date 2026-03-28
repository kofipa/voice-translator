require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const API_KEY = process.env.GOOGLE_API_KEY;

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
      body: JSON.stringify({
        q: text,
        target: targetLanguage,
        format: 'text',
      }),
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

wss.on('connection', (ws) => {
  console.log('Client connected');
  let targetLanguage = 'en';

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'config') {
        targetLanguage = data.targetLanguage || 'en';
        return;
      }

      if (data.type === 'translate_text') {
        try {
          const translated = await translateText(data.text, targetLanguage);
          const audio = await textToSpeechAudio(translated, targetLanguage);
          ws.send(JSON.stringify({ type: 'translation', original: data.text, translated, audio }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        return;
      }

      if (data.type === 'transcribe_audio') {
        try {
          const sttResponse = await transcribeAudio(data.audio);
          const results = sttResponse.results || [];
          const transcript = results.map(r => r.alternatives[0].transcript).join(' ').trim();

          if (!transcript) {
            ws.send(JSON.stringify({ type: 'error', message: 'No speech detected' }));
            return;
          }

          const detectedLanguage = results[0]?.languageCode || 'en-US';
          const translated = await translateText(transcript, targetLanguage);
          const audio = await textToSpeechAudio(translated, targetLanguage);
          ws.send(JSON.stringify({ type: 'translation', original: transcript, translated, detectedLanguage, audio }));
        } catch (err) {
          console.error('Transcribe error:', err.message);
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        return;
      }
    } catch {
      // ignore non-JSON
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
