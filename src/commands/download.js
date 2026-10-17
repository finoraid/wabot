import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { assertPublicUrl, formatBytes, isUrl, run, UserError, withTmp } from '../utils.js';

const WA_VIDEO_LIMIT = 16 * 1024 * 1024; // di atas ini dikirim sebagai dokumen
const SKIP_EXT = /\.(txt|part|ytdl|json|jpg|jpeg|png|webp|vtt|srt)$/i;

// ---- batas penggunaan: N unduhan bersamaan, 1 per pengguna ----
let active = 0;
const busyUsers = new Set();

async function acquire(user) {
  if (busyUsers.has(user)) throw new UserError('Unduhanmu yang sebelumnya masih berjalan. Tunggu sampai selesai ya.');
  if (active >= config.maxDownloads) throw new UserError('Server sedang sibuk mengunduh. Coba lagi beberapa saat.');
  busyUsers.add(user);
  active++;
}
function release(user) {
  busyUsers.delete(user);
  active = Math.max(0, active - 1);
}

async function ytdlp(dir, input, mode) {
  const args = [
    '--no-playlist', '--no-warnings', '--restrict-filenames', '--no-exec',
    '--socket-timeout', '20', '--retries', '2',
    '--max-filesize', `${config.maxMediaMB}M`,
    '--print-to-file', '%(title)s', path.join(dir, 'title.txt'),
    '-o', path.join(dir, '%(id)s.%(ext)s'),
  ];
  if (config.ytCookies) args.push('--cookies', config.ytCookies);

  if (mode === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '128K');
  } else {
    args.push(
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b',
      '--merge-output-format', 'mp4',
    );
  }
  args.push('--', input); // "--" mencegah input dibaca sebagai opsi

  try {
    await run(config.ytdlpBin, args, { timeout: 240_000 });
  } catch (e) {
    if (e.code === 'ENOENT') throw new UserError('yt-dlp belum terpasang di server bot.');
    const err = String(e.stderr || '');
    console.error('[yt-dlp]', err.slice(-600));
    if (/Sign in to confirm|not a bot|cookies/i.test(err)) {
      throw new UserError('YouTube meminta verifikasi login untuk IP server ini. Coba tautan dari situs lain, atau pasang cookies (lihat README).');
    }
    if (/Private video|login required|members-only|This video is private/i.test(err)) {
      throw new UserError('Konten ini privat atau butuh login.');
    }
    if (/Unsupported URL/i.test(err)) throw new UserError('Situs/tautan ini belum didukung.');
    throw new UserError('Gagal mengunduh. Tautan mungkin tidak valid atau situs memblokir server.');
  }

  const names = await fs.readdir(dir);
  const media = names.filter((n) => !SKIP_EXT.test(n));
  if (!media.length) {
    throw new UserError(`File kosong atau lebih besar dari ${config.maxMediaMB} MB. Coba video yang lebih pendek.`);
  }
  let title = '';
  try {
    title = (await fs.readFile(path.join(dir, 'title.txt'), 'utf8')).split('\n')[0].trim();
  } catch {}
  return { file: path.join(dir, media[0]), title };
}

async function sendResult({ sock, jid, msg }, { file, title }, mode) {
  const { size } = await fs.stat(file);
  if (size > config.maxMediaMB * 1024 * 1024) throw new UserError(`File ${formatBytes(size)} melebihi batas ${config.maxMediaMB} MB.`);
  const caption = title ? `✅ ${title.slice(0, 200)}` : '✅ Selesai';

  if (mode === 'audio') {
    await sock.sendMessage(jid, { audio: { url: file }, mimetype: 'audio/mpeg' }, { quoted: msg });
    if (title) await sock.sendMessage(jid, { text: `🎵 ${title.slice(0, 200)}` });
  } else if (size <= WA_VIDEO_LIMIT) {
    await sock.sendMessage(jid, { video: { url: file }, mimetype: 'video/mp4', caption }, { quoted: msg });
  } else {
    const name = (title || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + path.extname(file);
    await sock.sendMessage(jid, { document: { url: file }, mimetype: 'video/mp4', fileName: name, caption }, { quoted: msg });
  }
}

async function handle(ctx, input, mode) {
  const user = ctx.sender;
  await acquire(user);
  try {
    await ctx.react('⏳');
    const result = await withTmp(async (dir) => {
      const r = await ytdlp(dir, input, mode);
      await sendResult(ctx, r, mode);
      return r;
    });
    await ctx.react('✅');
    return result;
  } finally {
    release(user);
  }
}

export default [
  {
    name: 'video',
    aliases: ['dl', 'mp4', 'ytmp4'],
    usage: '<link>',
    category: 'Media',
    desc: 'Unduh video dari link (YouTube, TikTok, IG, dll)',
    async run(ctx) {
      const url = ctx.args[0];
      if (!isUrl(url)) throw new UserError(`Contoh: ${ctx.prefix}video https://...`);
      await assertPublicUrl(url);
      await handle(ctx, url, 'video');
    },
  },
  {
    name: 'mp3',
    aliases: ['audio', 'ytmp3'],
    usage: '<link>',
    category: 'Media',
    desc: 'Unduh audio MP3 dari link',
    async run(ctx) {
      const url = ctx.args[0];
      if (!isUrl(url)) throw new UserError(`Contoh: ${ctx.prefix}mp3 https://...`);
      await assertPublicUrl(url);
      await handle(ctx, url, 'audio');
    },
  },
  {
    name: 'play',
    usage: '<judul lagu>',
    category: 'Media',
    desc: 'Cari lagu di YouTube lalu kirim sebagai MP3',
    async run(ctx) {
      const q = ctx.text.replace(/\s+/g, ' ').slice(0, 150);
      if (!q) throw new UserError(`Contoh: ${ctx.prefix}play nama lagu`);
      await handle(ctx, `ytsearch1:${q}`, 'audio');
    },
  },
];
