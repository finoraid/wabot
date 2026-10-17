import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { downloadMedia, findMedia, run, UserError, withTmp } from '../utils.js';

const MAX_FRAMES = 150;

async function stickerBuffer({ sock, msg }) {
  const found = findMedia(msg, ['stickerMessage']);
  if (!found) throw new UserError('Reply stiker dengan perintah ini.');
  return { buffer: await downloadMedia(sock, found), animated: !!found.node?.isAnimated };
}

/** Stiker animasi (webp) -> mp4. ffmpeg tidak selalu bisa membaca webp animasi, jadi frame diambil lewat sharp. */
async function animatedWebpToMp4(buffer) {
  const meta = await sharp(buffer, { animated: true }).metadata();
  const pages = Math.min(meta.pages || 1, MAX_FRAMES);
  const delays = meta.delay || [];
  const avg = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 100;
  const fps = Math.min(30, Math.max(5, Math.round(1000 / Math.max(20, avg))));
  return withTmp(async (dir) => {
    for (let i = 0; i < pages; i++) {
      const png = await sharp(buffer, { page: i }).flatten({ background: '#ffffff' }).png().toBuffer();
      await fs.writeFile(path.join(dir, `f${String(i).padStart(4, '0')}.png`), png);
    }
    const out = path.join(dir, 'out.mp4');
    // diulang 3x supaya tidak berhenti terlalu cepat
    await run('ffmpeg', [
      '-y', '-v', 'error', '-stream_loop', '2', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-movflags', '+faststart', out,
    ], { timeout: 90_000 });
    return fs.readFile(out);
  });
}

export default [
  {
    name: 'toimg',
    aliases: ['toimage', 'stikerkegambar'],
    category: 'Media',
    desc: 'Ubah stiker (diam) jadi gambar — reply stikernya',
    async run(ctx) {
      const { buffer, animated } = await stickerBuffer(ctx);
      if (animated) throw new UserError(`Stiker ini beranimasi. Pakai ${ctx.prefix}tovideo.`);
      await ctx.react('⏳');
      const png = await sharp(buffer).png().toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { image: png, caption: '✅ Selesai' }, { quoted: ctx.msg });
      await ctx.react('✅');
    },
  },
  {
    name: 'tovideo',
    aliases: ['togif', 'tomp4'],
    category: 'Media',
    desc: 'Ubah stiker animasi jadi video — reply stikernya',
    async run(ctx) {
      const { buffer, animated } = await stickerBuffer(ctx);
      if (!animated) throw new UserError(`Stiker ini tidak beranimasi. Pakai ${ctx.prefix}toimg.`);
      await ctx.react('⏳');
      const mp4 = await animatedWebpToMp4(buffer);
      await ctx.sock.sendMessage(ctx.jid, { video: mp4, mimetype: 'video/mp4', gifPlayback: true, caption: '✅ Selesai' }, { quoted: ctx.msg });
      await ctx.react('✅');
    },
  },
];
