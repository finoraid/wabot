import { config } from './config.js';
import { UserError } from './utils.js';

export const DEFAULT_SYSTEM =
  'Kamu adalah asisten WhatsApp berbahasa Indonesia yang ramah, ringkas, dan akurat. Jawab dalam bahasa yang dipakai pengguna. Jangan mengaku punya kemampuan yang tidak kamu miliki. Format WhatsApp: gunakan *tebal* dengan satu tanda bintang, bukan markdown.';

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
  if (!res.ok) {
    const msg = String(data?.error?.message || '');
    console.error('[gemini]', res.status, config.geminiModel, msg);
    if (res.status === 429) throw new UserError('Kuota AI sedang habis. Coba lagi nanti.');
    if (res.status === 404) throw new UserError(`Model Gemini "${config.geminiModel}" sudah tidak tersedia. Ganti GEMINI_MODEL (mis. gemini-3.6-flash).`);
    if (res.status === 400 && /api key/i.test(msg)) throw new UserError('GEMINI_API_KEY tidak valid. Buat key baru di Google AI Studio.');
    if (res.status === 403) throw new UserError('GEMINI_API_KEY ditolak (izin/proyek/wilayah). Cek key di Google AI Studio.');
    if (res.status === 400) throw new UserError('Permintaan ke Gemini ditolak. Cek GEMINI_MODEL dan lihat log server.');
    throw new UserError('Layanan AI sedang bermasalah. Coba lagi nanti.');
  }
  if (data.promptFeedback?.blockReason) throw new UserError('Pertanyaan ini ditolak oleh filter keamanan AI.');
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new UserError('AI tidak memberi jawaban. Coba ulangi dengan kalimat lain.');
  return text;
}
