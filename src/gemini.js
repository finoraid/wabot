import { config } from './config.js';
import { UserError } from './utils.js';

export const DEFAULT_SYSTEM =
  'Kamu adalah asisten WhatsApp berbahasa Indonesia yang ramah, ringkas, dan akurat. Jawab dalam bahasa yang dipakai pengguna. Jangan mengaku punya kemampuan yang tidak kamu miliki. Format WhatsApp: gunakan *tebal* dengan satu tanda bintang, bukan markdown.';


function throwGeminiError(status, data, model) {
  const msg = String(data?.error?.message || '');
  console.error('[gemini]', status, model, msg);
  if (status === 429) throw new UserError('Kuota AI sedang habis. Coba lagi nanti.');
  if (status === 404) throw new UserError(`Model Gemini "${model}" tidak tersedia. Ganti nama model di Variables (mis. GEMINI_MODEL=gemini-3.6-flash).`);
  if (status === 400 && /api key/i.test(msg)) throw new UserError('GEMINI_API_KEY tidak valid. Buat key baru di Google AI Studio.');
  if (status === 403) throw new UserError('GEMINI_API_KEY ditolak (izin/proyek/wilayah). Cek key di Google AI Studio.');
  if (status === 400) throw new UserError('Permintaan ke Gemini ditolak. Cek nama model dan lihat log server.');
  throw new UserError('Layanan AI sedang bermasalah. Coba lagi nanti.');
}

/** Panggil Gemini. contents = [{role, parts}]. Error dijadikan UserError dengan pesan yang jelas. */
export async function askGemini(contents, { system = DEFAULT_SYSTEM, temperature = 0.7, maxOutputTokens = 1200 } = {}) {
  if (!config.geminiKey) throw new UserError('GEMINI_API_KEY belum diisi di server bot.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature, maxOutputTokens },
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new UserError('AI tidak merespons (timeout). Coba lagi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwGeminiError(res.status, data, config.geminiModel);
  if (data.promptFeedback?.blockReason) throw new UserError('Pertanyaan ini ditolak oleh filter keamanan AI.');
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new UserError('AI tidak memberi jawaban. Coba ulangi dengan kalimat lain.');
  return text;
}

/**
 * Teks -> suara lewat Gemini TTS (Interactions API). Mengembalikan Buffer audio mentah (WAV 24 kHz mono, atau PCM s16le kalau tanpa header).
 */
export async function geminiTts(text, voice = config.geminiTtsVoice) {
  if (!config.geminiKey) throw new UserError('GEMINI_API_KEY belum diisi di server bot.');
  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        model: config.geminiTtsModel,
        input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
        response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice }] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new UserError('Layanan suara tidak merespons (timeout). Coba lagi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwGeminiError(res.status, data, config.geminiTtsModel);
  const b64 = findAudioData(data);
  if (!b64) {
    console.error('[gemini-tts] respons tanpa audio:', JSON.stringify(data).slice(0, 300));
    throw new UserError('AI tidak menghasilkan suara. Coba kalimat lain.');
  }
  return Buffer.from(b64, 'base64');
}

/** Cari data audio base64 di respons Interactions (steps[].content[].data), toleran terhadap perubahan bentuk. */
export function findAudioData(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (typeof node.data === 'string' && node.data.length > 100 && /^[A-Za-z0-9+/=]+$/.test(node.data)) return node.data;
  for (const v of Object.values(node)) {
    const r = findAudioData(v, depth + 1);
    if (r) return r;
  }
  return null;
}
