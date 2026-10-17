import { askGemini } from '../gemini.js';
import { assertPublicUrl, downloadMedia, findMedia, getQuotedText, isUrl, UserError } from '../utils.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

/** Ambil teks dari halaman web publik. Tiap redirect divalidasi ulang supaya tidak bisa diarahkan ke alamat internal. */
async function fetchPageText(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  let res;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WaBot/1.0)', Accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) throw new UserError('Halaman tidak bisa dibuka (timeout/diblokir).');
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    break;
  }
  if (!res.ok) throw new UserError(`Halaman mengembalikan status ${res.status}.`);
  const type = String(res.headers.get('content-type') || '').toLowerCase();
  if (!/text\/|html|xml/.test(type)) throw new UserError('Tautan ini bukan halaman teks/artikel.');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const html = Buffer.concat(chunks).toString('utf8');
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

async function imagePart(ctx) {
  const found = findMedia(ctx.msg, ['imageMessage']);
  if (!found) return null;
  const bytes = await downloadMedia(ctx.sock, found);
  if (bytes.length > MAX_IMAGE_BYTES) throw new UserError('Gambar terlalu besar (maksimal 8 MB).');
  return { inlineData: { mimeType: found.node?.mimetype || 'image/jpeg', data: bytes.toString('base64') } };
}

export default [
  {
    name: 'ocr',
    aliases: ['bacateks', 'totext'],
    category: 'AI',
    desc: 'Baca teks dari gambar (kirim/reply gambar)',
    async run(ctx) {
      const img = await imagePart(ctx);
      if (!img) throw new UserError(`Kirim atau reply gambar dengan ${ctx.prefix}ocr`);
      await ctx.react('🔎');
      const out = await askGemini(
        [{ role: 'user', parts: [{ text: 'Salin semua teks yang terlihat pada gambar ini apa adanya, urut dari atas ke bawah, tanpa komentar. Jika tidak ada teks, jawab persis: TIDAK ADA TEKS.' }, img] }],
        { system: 'Kamu adalah mesin OCR. Keluarkan hanya teks hasil bacaan.', temperature: 0, maxOutputTokens: 2000 },
      );
      await ctx.reply(out.slice(0, 3800));
      await ctx.react('✅');
    },
  },
  {
    name: 'translate',
    aliases: ['tr', 'terjemah'],
    usage: '<bahasa> <teks> (atau reply pesan)',
    category: 'AI',
    desc: 'Terjemahkan teks, mis. .tr english selamat pagi',
    async run(ctx) {
      const [lang, ...rest] = ctx.args;
      const quoted = getQuotedText(ctx.msg);
      const text = rest.join(' ') || quoted;
      if (!lang || !text) throw new UserError(`Contoh: ${ctx.prefix}tr english selamat pagi\nAtau reply pesan: ${ctx.prefix}tr jepang`);
      await ctx.react('🌐');
      const out = await askGemini(
        [{ role: 'user', parts: [{ text: `Terjemahkan teks berikut ke bahasa: ${lang}.\nBalas hanya dengan hasil terjemahannya.\n\nTeks:\n${text.slice(0, 4000)}` }] }],
        { system: 'Kamu adalah penerjemah profesional. Keluarkan hanya terjemahan, tanpa penjelasan.', temperature: 0.2, maxOutputTokens: 1500 },
      );
      await ctx.reply(out.slice(0, 3800));
      await ctx.react('✅');
    },
  },
  {
    name: 'ringkas',
    aliases: ['summary', 'rangkum'],
    usage: '<link> (atau reply pesan panjang)',
    category: 'AI',
    desc: 'Ringkas pesan yang di-reply atau isi tautan artikel',
    async run(ctx) {
      const link = ctx.args.find(isUrl);
      let source = '';
      if (link) source = await fetchPageText(link);
      else source = getQuotedText(ctx.msg) || ctx.text;
      if (!source || source.length < 40) throw new UserError(`Reply pesan yang panjang, atau kirim tautan: ${ctx.prefix}ringkas https://...`);
      await ctx.react('📝');
      const out = await askGemini(
        [{ role: 'user', parts: [{ text: `Ringkas teks berikut dalam bahasa Indonesia: 1 kalimat inti, lalu 3-6 poin penting (pakai "•"). Jangan menambah informasi yang tidak ada di teks.\n\n${source.slice(0, MAX_TEXT_CHARS)}` }] }],
        { temperature: 0.3, maxOutputTokens: 900 },
      );
      await ctx.reply(out.slice(0, 3800));
      await ctx.react('✅');
    },
  },
];
