import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { downloadMedia, findMedia, run, UserError, withTmp } from '../utils.js';

const STATIC_MAX = 100 * 1024; // target stiker diam ≤ 100 KB
const ANIMATED_MAX = 500 * 1024; // stiker animasi ≤ 500 KB
const MAX_VIDEO_SECONDS = 10;

export async function imageToWebp(buffer) {
  for (const quality of [85, 70, 55, 40, 25]) {
    const out = await sharp(buffer, { animated: false })
      .rotate()
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality })
      .toBuffer();
    if (out.length <= STATIC_MAX || quality === 25) return out;
  }
}

export async function videoToWebp(buffer) {
  return withTmp(async (dir) => {
    const input = path.join(dir, 'in.bin');
    const output = path.join(dir, 'out.webp');
    await fs.writeFile(input, buffer);

    const vf = (fps) =>
      `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;

    let last;
    for (const { fps, q } of [{ fps: 12, q: 45 }, { fps: 10, q: 32 }, { fps: 8, q: 22 }]) {
      await run('ffmpeg', [
        '-y', '-v', 'error', '-i', input, '-t', String(MAX_VIDEO_SECONDS),
        '-vf', vf(fps), '-an', '-vcodec', 'libwebp', '-lossless', '0',
        '-compression_level', '6', '-q:v', String(q), '-loop', '0', '-preset', 'default', output,
      ], { timeout: 90_000 });
      last = await fs.readFile(output);
      if (last.length <= ANIMATED_MAX) return last;
    }
    throw new UserError('Video terlalu rumit untuk dijadikan stiker (hasil > 500 KB). Coba video yang lebih pendek.');
  });
}

export default {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'Media',
  desc: 'Ubah gambar/video/GIF jadi stiker (kirim atau reply media)',
  async run({ sock, msg, jid, reply, react }) {
    const found = findMedia(msg);
    if (!found) throw new UserError('Kirim atau reply gambar/video/GIF dengan perintah ini.');

    if (found.type === 'videoMessage' && (found.node?.seconds || 0) > MAX_VIDEO_SECONDS + 2) {
      throw new UserError(`Video maksimal ${MAX_VIDEO_SECONDS} detik.`);
    }

    await react('⏳');
    const buffer = await downloadMedia(sock, found);
    const webp = found.type === 'imageMessage' ? await imageToWebp(buffer) : await videoToWebp(buffer);
    await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
    await react('✅');
  },
};
