import sharp from 'sharp';
import { bratSvg, memeSvg } from '../textlayout.js';
import { downloadMedia, findMedia, getQuotedText, UserError } from '../utils.js';
import { imageToWebp } from './sticker.js';

export default [
  {
    name: 'brat',
    usage: '<teks>',
    category: 'Media',
    desc: 'Stiker teks gaya brat (hijau, huruf kecil)',
    async run({ sock, msg, jid, text, prefix, react }) {
      const t = (text || getQuotedText(msg)).trim();
      if (!t) throw new UserError(`Contoh: ${prefix}brat halo semuanya`);
      await react('⏳');
      const png = await sharp(Buffer.from(bratSvg(t))).blur(1.1).png().toBuffer();
      await sock.sendMessage(jid, { sticker: await imageToWebp(png) }, { quoted: msg });
      await react('✅');
    },
  },
  {
    name: 'smeme',
    aliases: ['stikermeme'],
    usage: '<atas>|<bawah> (kirim/reply gambar)',
    category: 'Media',
    desc: 'Stiker meme: teks atas/bawah di gambar',
    async run({ sock, msg, jid, text, prefix, react }) {
      const found = findMedia(msg, ['imageMessage']);
      if (!found) throw new UserError(`Kirim atau reply gambar: ${prefix}smeme teks atas|teks bawah`);
      const [top = '', bottom = ''] = text.split('|').map((x) => x.trim());
      if (!top && !bottom) throw new UserError(`Contoh: ${prefix}smeme ketika kamu|lupa bawa dompet`);
      await react('⏳');
      const src = await downloadMedia(sock, found);
      const { data, info } = await sharp(src).rotate().resize(512, 512, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
      const svg = memeSvg(info.width, info.height, top.slice(0, 120), bottom.slice(0, 120));
      const png = await sharp(data).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
      await sock.sendMessage(jid, { sticker: await imageToWebp(png) }, { quoted: msg });
      await react('✅');
    },
  },
];
