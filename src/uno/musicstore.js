import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { keyMatches, createAttemptLimiter, MUSIC_URL_RE } from './music.js';

// Penyimpanan musik hasil upload (global oleh admin, room oleh owner room).
// Nama file dibuat server (acak) dan tipe dicek dari isi file, bukan dari nama yang dikirim klien.

const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac' };

export function sniffAudio(b) {
  if (b.length < 12) return null;
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (b.toString('latin1', 0, 4) === 'fLaC') return 'flac';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

export function createMusicStore({ dir, maxFileBytes = 50 * 1024 * 1024, maxTotalBytes = 500 * 1024 * 1024, hooks = {}, log = console.log } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const adminLimiter = createAttemptLimiter();
  const ipHits = new Map(); // ip -> [timestamps]
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function rateOk(ip) { const now = Date.now(); const a = (ipHits.get(ip) || []).filter(t => now - t < 600_000); if (a.length >= 15) { ipHits.set(ip, a); return false; } a.push(now); ipHits.set(ip, a); return true; }

  async function prune(need) {
    const files = (await fsp.readdir(dir)).filter(f => MUSIC_URL_RE.test('/uno/music/' + f));
    const stats = await Promise.all(files.map(async f => ({ f, ...(await fsp.stat(path.join(dir, f))) })));
    let total = stats.reduce((s, x) => s + x.size, 0);
    if (total + need <= maxTotalBytes) return true;
    const used = hooks.inUse ? hooks.inUse() : new Set();
    for (const x of stats.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (used.has('/uno/music/' + x.f)) continue;
      await fsp.unlink(path.join(dir, x.f)).catch(() => {}); total -= x.size;
      if (total + need <= maxTotalBytes) return true;
    }
    return false;
  }

  async function upload(req, res, url) {
    try {
      const ip = ipOf(req);
      const scope = url.searchParams.get('scope');
      if (scope === 'global') {
        const expected = process.env.UNO_ADMIN_KEY || '';
        if (!expected) return json(res, 403, { ok: false, error: 'UNO_ADMIN_KEY belum diset di Railway Variables.' });
        if (adminLimiter.blocked(ip)) return json(res, 429, { ok: false, error: 'Terlalu banyak percobaan. Coba lagi 1 menit lagi.' });
        if (!keyMatches(req.headers['x-admin-key'], expected)) { adminLimiter.fail(ip); return json(res, 403, { ok: false, error: 'Admin key salah.' }); }
        adminLimiter.ok(ip);
      } else if (scope === 'room') {
        if (!hooks.isRoomOwner || !hooks.isRoomOwner(url.searchParams.get('sid') || '')) return json(res, 403, { ok: false, error: 'Hanya owner room yang bisa upload musik room.' });
      } else if (scope === 'snakes') {
        if (!hooks.isSnakesRoomOwner || !hooks.isSnakesRoomOwner(url.searchParams.get('sid') || '')) return json(res, 403, { ok: false, error: 'Hanya host Ular Tangga yang bisa upload musik room.' });
      } else return json(res, 400, { ok: false, error: 'Scope tidak valid.' });
      if (!rateOk(ip)) return json(res, 429, { ok: false, error: 'Terlalu banyak upload. Coba lagi beberapa menit lagi.' });

      const declared = Number(req.headers['content-length'] || 0);
      if (!declared) return json(res, 411, { ok: false, error: 'File kosong atau ukuran tidak diketahui.' });
      if (declared > maxFileBytes) return json(res, 413, { ok: false, error: `File terlalu besar (maks ${Math.round(maxFileBytes / 1048576)} MB).` });
      if (!(await prune(declared))) return json(res, 507, { ok: false, error: 'Penyimpanan musik penuh.' });

      const tmp = path.join(dir, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
      let size = 0, aborted = false;
      const out = fs.createWriteStream(tmp);
      req.on('data', (c) => { size += c.length; if (size > maxFileBytes && !aborted) { aborted = true; req.unpipe(out); out.destroy(); req.resume(); } });
      req.pipe(out);
      await new Promise((resolve) => { out.on('close', resolve); out.on('error', resolve); req.on('aborted', () => { aborted = true; out.destroy(); }); });
      if (aborted) { await fsp.unlink(tmp).catch(() => {}); return json(res, 413, { ok: false, error: `File terlalu besar (maks ${Math.round(maxFileBytes / 1048576)} MB).` }); }
      const fh = await fsp.open(tmp, 'r'); const head = Buffer.alloc(12); await fh.read(head, 0, 12, 0); await fh.close();
      const ext = sniffAudio(head);
      if (!ext) { await fsp.unlink(tmp).catch(() => {}); return json(res, 415, { ok: false, error: 'Format tidak didukung. Pakai mp3, ogg, wav, m4a, atau flac.' }); }
      const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
      await fsp.rename(tmp, path.join(dir, name));
      log('[uno] musik diupload:', scope, name, size, 'bytes');
      return json(res, 200, { ok: true, url: '/uno/music/' + name });
    } catch (e) {
      log('[uno] upload gagal:', e.message);
      return json(res, 500, { ok: false, error: 'Upload gagal di server.' });
    }
  }

  async function serve(req, res, pathname) {
    if (!MUSIC_URL_RE.test(pathname)) { res.writeHead(404).end(); return; }
    const file = path.join(dir, path.basename(pathname));
    let st; try { st = await fsp.stat(file); } catch { res.writeHead(404).end(); return; }
    const type = MIME[path.extname(file).slice(1)] || 'application/octet-stream';
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])); let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res); return;
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return { upload, serve };
}
