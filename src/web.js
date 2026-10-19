import fs from 'node:fs/promises';
import path from 'node:path';
// Server HTTP kecil: healthcheck di "/" dan halaman QR di "/qr?key=<QR_KEY>".
import crypto from 'node:crypto';
import http from 'node:http';
import QRCode from 'qrcode';
import { createMusicStore } from './uno/musicstore.js';

/** State login yang dibagi antara index.js dan halaman web. */
export const loginState = {
  mode: 'qr', // 'qr' | 'code'
  qr: null, // string QR terbaru (null kalau belum ada / sudah tertaut)
  qrAt: 0,
  pairingCode: null, // dipakai hanya di mode code
  connected: false,
  number: null,
  registered: false, // sesi sudah pernah tertaut (creds.registered)
};

export function setQr(qr) {
  loginState.qr = qr || null;
  loginState.qrAt = qr ? Date.now() : 0;
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Status yang ditampilkan di halaman. Fungsi murni supaya mudah dites. */
export function describeState(st) {
  if (st.connected) return { status: 'connected', text: `✅ Sudah terhubung${st.number ? ` sebagai ${st.number}` : ''}. Halaman ini boleh ditutup.` };
  if (st.mode === 'code') return { status: 'code-mode', text: 'LOGIN_MODE=code: kode pairing ada di log Railway. Untuk memakai QR, set LOGIN_MODE=qr.' };
  if (st.qr) return { status: 'qr', text: 'Scan di WhatsApp ▸ Perangkat tertaut ▸ Tautkan perangkat. QR berganti tiap ±20 detik.' };
  if (st.registered) return { status: 'reconnecting', text: '⏳ Sesi tersimpan, sedang menyambung ulang…' };
  return { status: 'waiting', text: '⏳ Menunggu QR dari WhatsApp…' };
}

const PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Tautkan WaBot</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee}}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:16px;text-align:center}
img{width:min(80vw,340px);height:auto;background:#fff;padding:8px;border-radius:12px}
#t{max-width:340px;line-height:1.4}
</style></head><body>
<h2>Tautkan WaBot</h2>
<img id="q" alt="QR" hidden>
<div id="t">Memuat…</div>
<script>
const key=new URLSearchParams(location.search).get('key')||'';
const q=document.getElementById('q'),t=document.getElementById('t');
async function tick(){
  try{
    const r=await fetch('/qr.json?key='+encodeURIComponent(key),{cache:'no-store'});
    if(!r.ok){t.textContent='Key salah atau QR_KEY belum diset.';q.hidden=true;return}
    const d=await r.json();
    t.textContent=d.text;
    if(d.image){q.src=d.image;q.hidden=false}else{q.hidden=true}
  }catch(e){t.textContent='Gagal memuat, mencoba lagi…'}
}
tick();setInterval(tick,3000);
</script></body></html>`;

export function createWebServer({ qrKey, startedAt = Date.now(), log = console.log, musicDir = path.resolve(process.cwd(), 'data', 'uno-music'), unoHooks = {} } = {}) {
  const musicStore = createMusicStore({ dir: musicDir, hooks: unoHooks, log });
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }

    // UNO ARENA static site, mounted under /uno without replacing WaBot routes.
    // Redirect only the bare path; never redirect /uno/ to itself.
    if (url.pathname === '/uno') {
      res.writeHead(302, { Location: '/uno/' });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/uno/upload') { await musicStore.upload(req, res, url); return; }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/uno/music/')) { await musicStore.serve(req, res, url.pathname); return; }
    if (url.pathname.startsWith('/uno/')) {
      const relative = decodeURIComponent(url.pathname.slice('/uno/'.length) || 'index.html');
      const root = path.resolve(process.cwd(), 'public', 'uno');
      const file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('UNO ARENA file not found');
      }
      return;
    }

    if (url.pathname === '/qr' || url.pathname === '/qr.json') {
      const key = url.searchParams.get('key') || '';
      if (!qrKey || !safeEqual(key, qrKey)) {
        res.writeHead(qrKey ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8', ...noStore });
        res.end(qrKey ? 'Key salah.' : 'QR_KEY belum diset di Variables.');
        return;
      }
      if (url.pathname === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...noStore });
        res.end(PAGE);
        return;
      }
      const d = describeState(loginState);
      let image = null;
      if (d.status === 'qr') {
        try {
          image = await QRCode.toDataURL(loginState.qr, { errorCorrectionLevel: 'M', margin: 2, width: 360 });
        } catch (e) {
          log('[qr] gagal render:', e.message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...noStore });
      res.end(JSON.stringify({ status: d.status, text: d.text, image }));
      return;
    }

    // healthcheck (tidak membocorkan QR / nomor)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, connected: loginState.connected, uptime: Math.floor((Date.now() - startedAt) / 1000) }));
  });
}
