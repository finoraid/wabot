import fs from 'node:fs/promises';
import path from 'node:path';
import { askGemini, geminiTts } from '../gemini.js';
import { downloadMedia, findMedia, run, UserError, withTmp } from '../utils.js';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 300;
const MAX_TTS_CHARS = 500;

/** Audio mentah dari Gemini (WAV ber-header atau PCM s16le 24 kHz) -> OGG Opus untuk pesan suara WhatsApp. */
async function toVoiceNote(raw) {
  return withTmp(async (dir) => {
    const isWav = raw.subarray(0, 4).toString('latin1') === 'RIFF';
    const input = path.join(dir, isWav ? 'in.wav' : 'in.pcm');
    const output = path.join(dir, 'out.ogg');
    await fs.writeFile(input, raw);
    const args = isWav ? ['-i', input] : ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', input];
    await run('ffmpeg', ['-y', '-v', 'error', ...args, '-c:a', 'libopus', '-b:a', '32k', '-ar', '24000', '-ac', '1', output], { timeout: 60_000 });
    return fs.readFile(output);
  });
}

export default [
  {
    name: 'suara',
    aliases: ['transkrip', 'stt'],
    category: 'AI',
    desc: 'Pesan suara jadi teks (reply voice note)',
    async run(ctx) {
      const found = findMedia(ctx.msg, ['audioMessage']);
      if (!found) throw new UserError(`Reply pesan suara dengan ${ctx.prefix}suara`);
      if ((found.node?.seconds || 0) > MAX_AUDIO_SECONDS) throw new UserError('Pesan suara terlalu panjang (maksimal 5 menit).');
      const bytes = await downloadMedia(ctx.sock, found);
      if (bytes.length > MAX_AUDIO_BYTES) throw new UserError('File suara terlalu besar (maksimal 10 MB).');
      await ctx.react('🎧');
      const mime = String(found.node?.mimetype || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
      const out = await askGemini(
        [{ role: 'user', parts: [{ text: 'Tuliskan isi rekaman suara ini apa adanya (transkripsi) dalam bahasa yang diucapkan. Jangan menambah komentar. Jika tidak ada ucapan yang jelas, jawab: TIDAK TERDENGAR JELAS.' }, { inlineData: { mimeType: mime, data: bytes.toString('base64') } }] }],
        { system: 'Kamu adalah mesin transkripsi. Keluarkan hanya teks hasil transkripsi.', temperature: 0, maxOutputTokens: 2000 },
      );
      await ctx.reply(`🎙️ ${out.slice(0, 3800)}`);
      await ctx.react('✅');
    },
  },
  {
    name: 'tts',
    aliases: ['bicara', 'suarakan'],
    usage: '<teks>',
    category: 'AI',
    desc: 'Teks jadi pesan suara',
    async run(ctx) {
      const text = (ctx.text || '').trim();
      if (!text) throw new UserError(`Contoh: ${ctx.prefix}tts Halo semuanya, selamat pagi`);
      if (text.length > MAX_TTS_CHARS) throw new UserError(`Teks terlalu panjang (maksimal ${MAX_TTS_CHARS} huruf).`);
      await ctx.react('🔊');
      const raw = await geminiTts(text);
      let ogg;
      try {
        ogg = await toVoiceNote(raw);
      } catch (e) {
        console.error('[tts] ffmpeg gagal:', e.stderr || e.message);
        throw new UserError('Gagal mengubah audio. Coba lagi.');
      }
      await ctx.sock.sendMessage(ctx.jid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: ctx.msg });
      await ctx.react('✅');
    },
  },
];
