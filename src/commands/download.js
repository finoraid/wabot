import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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


// ---- FastSaver (opsional, sama seperti media_bot): dipakai dulu kalau FASTSAVER_KEY diisi ----
const FS_BASE = 'https://api.fastsaver.io/v1';
const isYoutube = (u) => /^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(u);

async function fsCall(pathname, { method = 'GET', body, query } = {}) {
  const url = `${FS_BASE}${pathname}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-Api-Key': config.fastsaverKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    throw new Error(`FastSaver HTTP ${res.status}: ${data?.detail || data?.message || 'tanpa pesan'}`);
  }
  return data;
}

async function fetchToFile(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`unduh file HTTP ${res.status}`);
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/json')) throw new Error('URL hasil bukan file media');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > config.maxMediaMB * 1024 * 1024) throw new UserError(`File ${formatBytes(len)} melebihi batas ${config.maxMediaMB} MB.`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function toMp3(dir, input) {
  const out = path.join(dir, 'audio.mp3');
  await run('ffmpeg', ['-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', out], { timeout: 180_000 });
  return out;
}

async function fastsaver(dir, input, mode) {
  let title = '';
  let dlUrl;
  let musicUrl = null;
  if (isYoutube(input)) {
    const info = await fsCall('/youtube/info', { query: { url: input } });
    title = info.title || info.data?.title || '';
    const formats = info.formats || info.data?.formats || [];
    let format = 'audio';
    if (mode === 'video') {
      const score = (x) => Number(String(x?.quality || x?.format || '').match(/(\d{3,4})p/i)?.[1] || 0);
      const vids = formats.filter((x) => String(x?.format || x?.type || '').toLowerCase() !== 'audio' && score(x) > 0 && score(x) <= 720);
      const best = vids.sort((a, b) => score(b) - score(a))[0];
      format = best?.format || best?.itag || '720p';
    }
    const d = await fsCall('/youtube/download', { method: 'POST', body: { url: input, format } });
    dlUrl = d.download_url;
  } else {
    const d = await fsCall('/fetch', { query: { url: input } });
    title = d.title || d.caption || d.description || '';
    dlUrl = d.download_url || d.url;
    musicUrl = d.music_url || d.audio_url || null;
  }
  if (!dlUrl && !(mode === 'audio' && musicUrl)) throw new Error('FastSaver tidak memberi link unduhan');

  if (mode === 'audio') {
    const src = path.join(dir, 'src.bin');
    await fetchToFile(musicUrl || dlUrl, src);
    return { file: await toMp3(dir, src), title };
  }
  const file = path.join(dir, 'video.mp4');
  await fetchToFile(dlUrl, file);
  return { file, title };
}

async function getMedia(dir, input, mode) {
  if (config.fastsaverKey && !input.startsWith('ytsearch')) {
    try {
      return await fastsaver(dir, input, mode);
    } catch (e) {
      if (e instanceof UserError) throw e;
      console.error('[fastsaver]', e.message, '-> fallback yt-dlp');
      // bersihkan sisa file sebelum yt-dlp
      for (const n of await fs.readdir(dir).catch(() => [])) await fs.rm(path.join(dir, n), { force: true });
    }
  }
  return ytdlp(dir, input, mode);
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
      const r = await getMedia(dir, input, mode);
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
