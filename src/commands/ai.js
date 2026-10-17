import { config } from '../config.js';
import { downloadMedia, findMedia, getQuotedText, UserError } from '../utils.js';

const SYSTEM = 'Kamu adalah asisten WhatsApp berbahasa Indonesia yang ramah, ringkas, dan akurat. Jawab dalam bahasa yang dipakai pengguna. Jangan mengaku punya kemampuan yang tidak kamu miliki. Format WhatsApp: gunakan *tebal* dengan satu tanda bintang, bukan markdown.';
const MAX_TURNS = 8; // pasangan tanya-jawab yang diingat per chat
const TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** chatId -> { turns: [{role, parts}], ts } (hanya di memori; hilang saat bot restart) */
const memory = new Map();

function recall(chat) {
  const m = memory.get(chat);
  if (!m || Date.now() - m.ts > TTL_MS) {
    memory.delete(chat);
    return [];
  }
  return m.turns;
}

function remember(chat, userParts, answer) {
  const turns = [...recall(chat), { role: 'user', parts: userParts }, { role: 'model', parts: [{ text: answer }] }];
  memory.set(chat, { turns: turns.slice(-MAX_TURNS * 2), ts: Date.now() });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
}

async function askGemini(contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
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

export default [
  {
    name: 'ai',
    aliases: ['gemini', 'tanya'],
    usage: '<pertanyaan>',
    category: 'AI',
    desc: 'Tanya Gemini (bisa kirim/reply gambar)',
    async run({ sock, msg, jid, text, reply, react, prefix }) {
      if (!config.geminiKey) throw new UserError('GEMINI_API_KEY belum diisi di server bot.');

      const found = findMedia(msg, ['imageMessage']);
      const quoted = getQuotedText(msg);
      const question = text || (found ? 'Jelaskan isi gambar ini.' : '');
      if (!question) throw new UserError(`Contoh: ${prefix}ai apa itu black hole?`);

      const parts = [{ text: quoted && text ? `Konteks (pesan yang di-reply):\n${quoted}\n\nPertanyaan: ${question}` : question }];
      if (found) {
        const bytes = await downloadMedia(sock, found);
        if (bytes.length > MAX_IMAGE_BYTES) throw new UserError('Gambar terlalu besar (maksimal 8 MB).');
        parts.push({ inlineData: { mimeType: found.node?.mimetype || 'image/jpeg', data: bytes.toString('base64') } });
      }

      await react('🤔');
      const answer = await askGemini([...recall(jid), { role: 'user', parts }]);
      // Gambar tidak disimpan di memori supaya hemat; teksnya saja.
      remember(jid, [parts[0]], answer);
      await reply(answer.slice(0, 3800));
      await react('✅');
    },
  },
  {
    name: 'resetai',
    aliases: ['aireset'],
    category: 'AI',
    desc: 'Hapus ingatan percakapan AI di chat ini',
    async run({ jid, reply }) {
      memory.delete(jid);
      await reply('🧹 Ingatan percakapan AI untuk chat ini sudah dihapus.');
    },
  },
];
