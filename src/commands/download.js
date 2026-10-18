import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { config } from '../config.js';
import { assertPublicUrl, formatBytes, isUrl, run, UserError, withTmp } from '../utils.js';

const WA_VIDEO_LIMIT = 16 * 1024 * 1024; // di atas ini dikirim sebagai dokumen
const SKIP_EXT = /\.(txt|part|ytdl|json|jpg|jpeg|png|webp|vtt|srt)$/i;


// FastSaver API: satu endpoint untuk TikTok, Instagram, Facebook, X, Pinterest, Rutube, dan Likee.
async function fastSaverFetch(input) {
  const key = process.env.FASTSAVER_KEY;
  if (!key || /^ytsearch/i.test(input)) return null;
  let host;
  try { host = new URL(input).hostname.toLowerCase(); } catch { return null; }
  // YouTube memakai endpoint format tersendiri; biarkan jalur yt-dlp yang sudah ada menanganinya.
  if (/youtube\.com$|youtu\.be$|youtube-nocookie\.com$/.test(host)) return null;
  const supported = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|pinterest\.com|pin\.it|rutube\.ru|likee\.video|likee\.com)$/i;
  if (!supported.test(host)) return null;
  const endpoint = `https://api.fastsaver.io/v1/fetch?url=${encodeURIComponent(input)}`;
  const res = await fetch(endpoint, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(45_000) });
  let data;
  try { data = await res.json(); } catch { throw new UserError('FastSaver mengirim respons yang tidak valid.'); }
  if (!res.ok || !data?.ok) {
    const detail = String(data?.detail || `HTTP ${res.status}`);
    if (res.status === 401) throw new UserError('FASTSAVER_KEY ditolak. Periksa API key di Railway Variables.');
    if (res.status === 429) throw new UserError('FastSaver sedang membatasi permintaan. Coba lagi sebentar.');
    if (/credit/i.test(detail)) throw new UserError('Kredit FastSaver habis. Periksa saldo API FastSaver.');
    throw new UserError(`FastSaver tidak bisa mengambil media ini (${detail}). Link mungkin privat, sudah dihapus, atau tidak didukung.`);
  }
  return data;
}

async function sendFastSaverResult(ctx, data, mode) {
  const { sock, jid, msg, react } = ctx;
  const label = String(data.caption || data.source || 'FastSaver').slice(0, 180);
  if (mode === 'audio') {
    const audioUrl = data.music_url || data.download_url;
    if (!audioUrl) throw new UserError('Audio tidak tersedia untuk tautan ini.');
    await assertPublicUrl(audioUrl);
    await sock.sendMessage(jid, { audio: { url: audioUrl }, mimetype: /\.mp3(?:\?|$)/i.test(audioUrl) ? 'audio/mpeg' : 'audio/mp4', fileName: 'media-audio' }, { quoted: msg });
    return;
  }
  const items = Array.isArray(data.items) && data.items.length ? data.items : [{ type: data.type, download_url: data.download_url }];
  if (!items[0]?.download_url) throw new UserError('FastSaver tidak mengembalikan tautan file media.');
  // Batasi album agar bot tidak membanjiri grup.
  for (const [i, item] of items.slice(0, 10).entries()) {
    if (!item?.download_url) continue;
    await assertPublicUrl(item.download_url);
    const type = String(item.type || data.type || 'video').toLowerCase();
    const caption = `${type === 'image' ? '🖼️' : '✅'} ${label}${items.length > 1 ? ` (${i + 1}/${Math.min(items.length, 10)})` : ''}`;
    if (type === 'image') await sock.sendMessage(jid, { image: { url: item.download_url }, caption }, { quoted: msg });
    else if (type === 'video' || /video/i.test(type)) await sock.sendMessage(jid, { video: { url: item.download_url }, caption }, { quoted: msg });
    else await sock.sendMessage(jid, { document: { url: item.download_url }, fileName: `media-${i + 1}`, caption }, { quoted: msg });
  }
  if (items.length > 10) await sock.sendMessage(jid, { text: `ℹ️ Album berisi ${items.length} item; 10 item pertama dikirim agar grup tidak dibanjiri pesan.` }, { quoted: msg });
}

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
    const fail = new UserError(/Unsupported URL/i.test(err) ? 'Situs/tautan ini belum didukung.' : 'Gagal mengunduh. Tautan mungkin tidak valid atau situs memblokir server.');
    fail.canSniff = true; // layak dicoba lewat deteksi browser
    throw fail;
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


// ---- Cadangan: deteksi video lewat browser (Playwright) untuk situs yang tidak didukung yt-dlp ----
// Alur sama seperti botdownloader: yt-dlp dulu -> kalau gagal, buka halaman, putar video, tangkap URL video
// dari lalu lintas jaringan -> unduh langsung (mp4/webm) atau lewat ffmpeg (m3u8/HLS).
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const VIDEO_URL_RE = /\.(mp4|webm|m3u8|mov)(\?|$)/i;
const SEGMENT_RE = /\.(ts|m4s|aac)(\?|$)/i;
const SNIFF_SECONDS = 15;
let sniffing = 0; // browser berat: satu deteksi dalam satu waktu

async function toMp3(dir, input) {
  const out = path.join(dir, 'audio.mp3');
  await run('ffmpeg', ['-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', out], { timeout: 180_000 });
  return out;
}

/** fetch yang memeriksa tiap lompatan redirect (cegah redirect ke alamat privat). */
async function safeFetch(url, headers) {
  let cur = url;
  const origin = new URL(url).host;
  for (let i = 0; i < 5; i++) {
    await assertPublicUrl(cur);
    const h = { ...headers };
    if (new URL(cur).host !== origin) delete h.Cookie;
    const res = await fetch(cur, { headers: h, redirect: 'manual', signal: AbortSignal.timeout(180_000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      cur = new URL(loc, cur).toString();
      continue;
    }
    return res;
  }
  throw new Error('terlalu banyak redirect');
}

async function downloadDirect(url, headers, dest) {
  const res = await safeFetch(url, headers);
  if (!res.ok || !res.body) throw new Error(`unduh file HTTP ${res.status}`);
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/json')) throw new Error('URL hasil bukan file media');
  const max = config.maxMediaMB * 1024 * 1024;
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new UserError(`File ${formatBytes(len)} melebihi batas ${config.maxMediaMB} MB.`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > max) return cb(new UserError(`File melebihi batas ${config.maxMediaMB} MB.`));
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), limiter, createWriteStream(dest));
  return ct;
}

async function downloadHls(url, headers, dest) {
  const headerStr = Object.entries(headers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]+/g, ' ')}\r\n`)
    .join('');
  await run(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-protocol_whitelist', 'http,https,tcp,tls,crypto', // playlist jahat tidak boleh membaca file lokal
      '-headers', headerStr,
      '-i', url,
      '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
      '-fs', String(config.maxMediaMB * 1024 * 1024),
      dest,
    ],
    { timeout: 600_000 },
  );
}

/** Pastikan hasilnya mp4 yang bisa diputar WhatsApp (webm/mov dikonversi). */
async function ensureMp4(dir, file, hint) {
  if (/mp4/i.test(hint)) return file;
  const out = path.join(dir, 'converted.mp4');
  await run(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-movflags', '+faststart', out],
    { timeout: 300_000 },
  );
  return out;
}

async function sniffVideo(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('playwright-core belum terpasang');
  }
  const found = [];
  const hostCache = new Map();
  const hostOk = (u) => {
    let origin;
    try {
      origin = new URL(u).origin;
    } catch {
      return Promise.resolve(false);
    }
    if (!hostCache.has(origin)) hostCache.set(origin, assertPublicUrl(origin).then(() => true, () => false));
    return hostCache.get(origin);
  };

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), // opsional: pakai Chromium yang sudah ada
  });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 412, height: 915 } });
    // Tidak boleh menyentuh jaringan internal, dan gambar/font tidak perlu (hemat memori & waktu).
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const u = req.url();
      if (!/^https?:/i.test(u)) return route.continue();
      if (['image', 'font'].includes(req.resourceType())) return route.abort();
      return (await hostOk(u)) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    page.on('response', (resp) => {
      const u = resp.url();
      const ct = String(resp.headers()['content-type'] || '').toLowerCase();
      if (SEGMENT_RE.test(u)) return;
      if ((VIDEO_URL_RE.test(u) || ct.startsWith('video/') || ct.includes('mpegurl')) && !found.includes(u)) found.push(u);
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});

    const playJs = "document.querySelectorAll('video').forEach(v=>{v.muted=true;v.play().catch(()=>{})})";
    for (let i = 0; i < SNIFF_SECONDS && !found.length; i++) {
      await page.evaluate(playJs).catch(() => {});
      await page.mouse.click(206, 450).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!found.length) {
      const srcs = await page
        .evaluate("[...document.querySelectorAll('video,source')].map(e=>e.currentSrc||e.src).filter(Boolean)")
        .catch(() => []);
      found.push(...srcs.filter((s) => /^https?:/i.test(s)));
    }
    if (!found.length) throw new Error('tidak ada video terdeteksi di halaman');

    found.sort((a, b) => (/\.m3u8/i.test(a) ? 1 : 0) - (/\.m3u8/i.test(b) ? 1 : 0)); // mp4/webm langsung dulu, HLS belakangan
    const cookies = await ctx.cookies();
    const title = (await page.title().catch(() => '')) || '';
    return {
      videoUrl: found[0],
      title: title.trim(),
      headers: { 'User-Agent': UA, Referer: url, Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function sniffDownload(dir, input, mode) {
  if (!config.sniffEnabled) throw new Error('sniff dimatikan');
  if (sniffing) throw new UserError('Pendeteksi video sedang dipakai orang lain. Coba lagi sebentar.');
  sniffing++;
  try {
    const { videoUrl, headers, title } = await sniffVideo(input);
    await assertPublicUrl(videoUrl);
    console.log('[sniff] terdeteksi:', videoUrl.slice(0, 160));
    const raw = path.join(dir, 'sniffed.bin');
    let hint = 'mp4';
    if (/\.m3u8(\?|$)/i.test(videoUrl)) {
      await downloadHls(videoUrl, headers, raw);
    } else {
      const ct = await downloadDirect(videoUrl, headers, raw);
      hint = `${ct} ${new URL(videoUrl).pathname}`;
    }
    if (mode === 'audio') return { file: await toMp3(dir, raw), title };
    return { file: await ensureMp4(dir, raw, hint), title };
  } finally {
    sniffing--;
  }
}

async function getMedia(dir, input, mode) {
  try {
    return await ytdlp(dir, input, mode);
  } catch (e) {
    if (!e.canSniff || input.startsWith('ytsearch')) throw e;
    console.error('[download] yt-dlp gagal, coba deteksi lewat browser:', input.slice(0, 120));
    for (const n of await fs.readdir(dir).catch(() => [])) await fs.rm(path.join(dir, n), { recursive: true, force: true });
    try {
      return await sniffDownload(dir, input, mode);
    } catch (e2) {
      if (e2 instanceof UserError) throw e2;
      console.error('[sniff]', e2.message);
      throw new UserError('Video tidak ditemukan di tautan ini (mungkin DRM, butuh login, atau situsnya memblokir server).');
    }
  }
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
    let usedFastSaver = false;
    const result = await withTmp(async (dir) => {
      try {
        const data = await fastSaverFetch(input);
        if (data) {
          await sendFastSaverResult(ctx, data, mode);
          usedFastSaver = true;
          return data;
        }
      } catch (e) {
        // Bila API key tersedia dan host didukung, tampilkan error API secara jelas;
        // jangan diam-diam menghabiskan resource lewat browser fallback.
        if (process.env.FASTSAVER_KEY && !/^ytsearch/i.test(input)) throw e;
      }
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

export const _sniffVideo = sniffVideo;

export default [
  {
    name: 'media',
    aliases: ['med', 'downloader'],
    usage: '<link>',
    category: 'Media',
    desc: 'Unduh media dari TikTok, Instagram, Facebook, X, Pinterest, dan situs yang didukung',
    async run(ctx) {
      const url = ctx.args[0];
      if (!isUrl(url)) throw new UserError(`Contoh: ${ctx.prefix}media https://...`);
      await assertPublicUrl(url);
      await handle(ctx, url, 'video');
    },
  },
  {
    name: 'video',
    aliases: ['dl', 'mp4', 'ytmp4'],
    usage: '<link>',
    category: 'Media',
    desc: 'Unduh video; FastSaver dipakai lebih dulu untuk platform yang didukung',
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
  ...[
    { name: 'tt', aliases: ['tiktok'], host: /tiktok\.com$/i, mode: 'video', desc: 'Unduh video TikTok', label: 'TikTok' },
    { name: 'ttmp3', aliases: ['tiktokmp3'], host: /tiktok\.com$/i, mode: 'audio', desc: 'Unduh audio MP3 dari TikTok', label: 'TikTok' },
    { name: 'ig', aliases: ['instagram', 'reels'], host: /instagram\.com$/i, mode: 'video', desc: 'Unduh video/reels Instagram', label: 'Instagram' },
  ].map((c) => ({
    name: c.name,
    aliases: c.aliases,
    usage: '<link>',
    category: 'Media',
    desc: c.desc,
    async run(ctx) {
      const url = ctx.args[0];
      if (!isUrl(url)) throw new UserError(`Contoh: ${ctx.prefix}${c.name} https://...`);
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^(www|vm|vt|m)\./i, '');
      } catch {}
      if (!c.host.test(host)) throw new UserError(`Perintah ini khusus tautan ${c.label}. Untuk situs lain pakai ${ctx.prefix}${c.mode === 'audio' ? 'mp3' : 'video'}.`);
      await assertPublicUrl(url);
      await handle(ctx, url, c.mode);
    },
  })),
];
