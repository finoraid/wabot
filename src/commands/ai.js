import { config } from '../config.js';
import { askGemini, DEFAULT_SYSTEM } from '../gemini.js';
import { downloadMedia, findMedia, getQuotedText, UserError } from '../utils.js';

const SYSTEM = DEFAULT_SYSTEM;
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
      const answer = await askGemini([...recall(jid), { role: 'user', parts }], { system: SYSTEM });
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
