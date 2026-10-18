import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { fit } from '../textlayout.js';
import { buildExif, withExif } from '../webpexif.js';
import { downloadMedia, findMedia, run, UserError, withTmp } from '../utils.js';

const ANIMATED_MAX = 500 * 1024;
const PALETTE = ['#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#0A84FF', '#BF5AF2'];
const FONT = "'DejaVu Sans','Liberation Sans','Arial',sans-serif";
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Satu bingkai ATTP: teks berwarna dengan garis tepi hitam di latar transparan. */
export function attpFrameSvg(text, color) {
  const W = 512;
  const { size, lines } = fit(text, W - 40, W - 40, 120, 28, 1.1, 0.75);
  const total = lines.length * size * 1.1;
  const y0 = (W - total) / 2;
  const tspans = lines.map((l, i) => `<text x="${W / 2}" y="${y0 + size * 0.85 + i * size * 1.1}" font-size="${size}" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><g font-family="${FONT}" font-weight="700" fill="${color}" stroke="#000" stroke-width="${Math.max(4, Math.round(size / 12))}" stroke-linejoin="round" paint-order="stroke fill">${tspans}</g></svg>`;
}

async function attpWebp(text) {
  return withTmp(async (dir) => {
    for (let i = 0; i < PALETTE.length; i++) {
      const png = await sharp(Buffer.from(attpFrameSvg(text, PALETTE[i]))).png().toBuffer();
      await fs.writeFile(path.join(dir, `f${i}.png`), png);
    }
    const out = path.join(dir, 'out.webp');
    for (const q of [60, 40, 25]) {
      await run('ffmpeg', [
        '-y', '-v', 'error', '-framerate', '6', '-i', path.join(dir, 'f%d.png'),
        '-vf', 'format=rgba', '-vcodec', 'libwebp', '-lossless', '0', '-q:v', String(q), '-loop', '0', '-an', out,
      ], { timeout: 60_000 });
      const buf = await fs.readFile(out);
      if (buf.length <= ANIMATED_MAX) return buf;
    }
    throw new UserError('Teksnya terlalu rumit untuk stiker. Coba lebih pendek.');
  });
}

export default [
  {
    name: 'attp',
    usage: '<teks>',
    category: 'Media',
    desc: 'Stiker teks warna-warni bergerak',
    async run({ sock, msg, jid, text, prefix, react }) {
      const t = text.trim().slice(0, 80);
      if (!t) throw new UserError(`Contoh: ${prefix}attp halo semua`);
      await react('⏳');
      await sock.sendMessage(jid, { sticker: await attpWebp(t) }, { quoted: msg });
      await react('✅');
    },
  },
  {
    name: 'stikerwm',
    aliases: ['wm', 'take'],
    usage: '<nama paket> | <pembuat> (reply stiker)',
    category: 'Media',
    desc: 'Ganti nama paket & pembuat stiker',
    async run({ sock, msg, jid, text, prefix, react, pushName }) {
      const found = findMedia(msg, ['stickerMessage']);
      if (!found) throw new UserError(`Reply stiker: ${prefix}stikerwm Nama Paket | Pembuat`);
      const [pack, author] = text.split('|').map((x) => x.trim());
      if (!pack) throw new UserError(`Contoh: ${prefix}stikerwm Koleksiku | ${pushName || 'Aku'}`);
      await react('⏳');
      const src = await downloadMedia(sock, found);
      let out;
      try {
        out = withExif(src, buildExif(pack, author || config.botName));
      } catch (e) {
        console.error('[stikerwm]', e.message);
        throw new UserError('Stiker ini tidak bisa diubah (format tidak didukung).');
      }
      await sock.sendMessage(jid, { sticker: out }, { quoted: msg });
      await react('✅');
    },
  },
];
