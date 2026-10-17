import sharp from 'sharp';
import { config } from '../config.js';
import { downloadMedia, findMedia, UserError } from '../utils.js';
import { imageToWebp } from './sticker.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Proses berat: satu per satu supaya memori server tidak melonjak.
let busy = false;
async function exclusive(fn) {
  if (busy) throw new UserError('Server sedang memproses gambar lain. Coba lagi sebentar.');
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

async function getImage(ctx) {
  const found = findMedia(ctx.msg, ['imageMessage']);
  if (!found) throw new UserError(`Kirim atau reply gambar dengan ${ctx.prefix}${ctx.cmdName || 'perintah ini'}`);
  const bytes = await downloadMedia(ctx.sock, found);
  if (bytes.length > MAX_IMAGE_BYTES) throw new UserError('Gambar terlalu besar (maksimal 8 MB).');
  return bytes;
}

// ---------- removebg: model lokal (@imgly/background-removal-node), tanpa API key ----------
async function loadRemover() {
  try {
    return await import('@imgly/background-removal-node');
  } catch {
    throw new UserError('Fitur hapus latar belum terpasang di server (paket @imgly/background-removal-node gagal terpasang).');
  }
}

async function removeBg(bytes) {
  const lib = await loadRemover();
  // kecilkan dulu: lebih cepat dan hemat memori
  const input = await sharp(bytes).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const blob = await lib.removeBackground(new Blob([input], { type: 'image/png' }), { output: { format: 'image/png' } });
  return Buffer.from(await blob.arrayBuffer());
}

// ---------- remini: Real-ESRGAN lewat Replicate (opsional) atau penajaman lokal ----------
async function replicateEnhance(bytes) {
  const headers = { Authorization: `Bearer ${config.replicateToken}`, 'Content-Type': 'application/json' };
  const small = await sharp(bytes).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const model = await fetch('https://api.replicate.com/v1/models/nightmareai/real-esrgan', { headers, signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  const version = model?.latest_version?.id;
  if (!version) throw new Error('versi model Replicate tidak ditemukan');

  let p = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...headers, Prefer: 'wait=60' },
    body: JSON.stringify({ version, input: { image: `data:image/jpeg;base64,${small.toString('base64')}`, scale: 2, face_enhance: true } }),
    signal: AbortSignal.timeout(75_000),
  }).then((r) => r.json());

  const deadline = Date.now() + 120_000;
  while (p && !['succeeded', 'failed', 'canceled'].includes(p.status) && p.urls?.get && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    p = await fetch(p.urls.get, { headers, signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  }
  if (p?.status !== 'succeeded') throw new Error(`Replicate: ${p?.status || 'tanpa status'} ${p?.error || p?.detail || ''}`);
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  if (typeof url !== 'string' || !/^https:\/\/([\w-]+\.)*replicate\.delivery\//.test(url)) throw new Error('keluaran Replicate tidak dikenal');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`unduh hasil HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function localEnhance(bytes) {
  const meta = await sharp(bytes).rotate().metadata();
  const w = meta.width || 512;
  const h = meta.height || 512;
  const k = Math.min(2, 2048 / Math.max(w, h));
  return sharp(bytes)
    .rotate()
    .resize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), { kernel: 'lanczos3' })
    .sharpen({ sigma: 1.2 })
    .modulate({ saturation: 1.05 })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export default [
  {
    name: 'removebg',
    aliases: ['rbg', 'nobg', 'hapuslatar'],
    usage: '[stiker] (kirim/reply gambar)',
    category: 'Media',
    desc: 'Hapus latar belakang gambar (hasil PNG transparan)',
    async run(ctx) {
      ctx.cmdName = 'removebg';
      const bytes = await getImage(ctx);
      await ctx.react('⏳');
      const png = await exclusive(() => removeBg(bytes));
      if (/^(s|stiker|sticker)$/i.test(ctx.args[0] || '')) {
        await ctx.sock.sendMessage(ctx.jid, { sticker: await imageToWebp(png) }, { quoted: ctx.msg });
      } else {
        // dikirim sebagai dokumen supaya transparansinya tidak hilang (gambar biasa dikompres jadi JPG)
        await ctx.sock.sendMessage(ctx.jid, { document: png, mimetype: 'image/png', fileName: 'removebg.png', caption: `✅ Latar dihapus. Mau stiker? ${ctx.prefix}removebg stiker` }, { quoted: ctx.msg });
      }
      await ctx.react('✅');
    },
  },
  {
    name: 'remini',
    aliases: ['hd', 'enhance', 'upscale'],
    usage: '(kirim/reply gambar)',
    category: 'Media',
    desc: 'Perjelas & perbesar foto',
    async run(ctx) {
      ctx.cmdName = 'remini';
      const bytes = await getImage(ctx);
      await ctx.react('⏳');
      const { out, mode } = await exclusive(async () => {
        if (config.replicateToken) {
          try {
            return { out: await replicateEnhance(bytes), mode: 'AI' };
          } catch (e) {
            console.error('[remini] Replicate gagal, pakai mode lokal:', e.message);
          }
        }
        return { out: await localEnhance(bytes), mode: 'lokal' };
      });
      await ctx.sock.sendMessage(ctx.jid, { image: out, caption: mode === 'AI' ? '✅ Diperjelas dengan AI (Real-ESRGAN)' : '✅ Diperbesar & dipertajam (mode sederhana, bukan AI)' }, { quoted: ctx.msg });
      await ctx.react('✅');
    },
  },
];
