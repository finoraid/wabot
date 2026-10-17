// Tes mandiri tanpa koneksi WhatsApp: node scripts/selftest.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-selftest-'));
process.env.OWNER_NUMBERS = '6281111111111';
process.env.PREFIX = '.';

const { loadCommands, allCommands } = await import('../src/registry.js');
const { handleMessage, _resetCooldowns } = await import('../src/handler.js');
const { imageToWebp, videoToWebp } = await import('../src/commands/sticker.js');
const { assertPublicUrl, isPrivateIp } = await import('../src/utils.js');
const { updateGroup, getGroup } = await import('../src/store.js');
const groupCache = await import('../src/groupCache.js');

let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`) || passed++;

// ---- 1. command terdaftar tanpa nama ganda ----
const n = await loadCommands();
assert.ok(n >= 15, `command terlalu sedikit: ${n}`);
ok(`${n} command termuat, tanpa nama ganda`);

// ---- 2. validasi URL ----
for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://169.254.169.254/latest', 'http://[::1]/', 'ftp://example.com', 'bukan url']) {
  await assert.rejects(() => assertPublicUrl(bad), `harus ditolak: ${bad}`);
}
assert.equal(isPrivateIp('8.8.8.8'), false);
assert.equal(isPrivateIp('192.168.1.1'), true);
ok('URL privat/internal ditolak');

// ---- 3. stiker gambar ----
const img = await sharp({ create: { width: 900, height: 400, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();
const webp = await imageToWebp(img);
const meta = await sharp(webp).metadata();
assert.equal(meta.format, 'webp');
assert.equal(meta.width, 512);
assert.equal(meta.height, 512);
assert.ok(webp.length <= 100 * 1024);
ok(`stiker gambar 512x512 webp (${Math.ceil(webp.length / 1024)} KB)`);

// ---- 4. stiker animasi (butuh ffmpeg) ----
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const vid = path.join(process.env.DATA_DIR, 'test.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=3', '-pix_fmt', 'yuv420p', vid]);
  const anim = await videoToWebp(fs.readFileSync(vid));
  const am = await sharp(anim, { animated: true }).metadata();
  assert.equal(am.format, 'webp');
  assert.ok((am.pages || 1) > 1, 'harus animasi');
  assert.ok(anim.length <= 500 * 1024);
  ok(`stiker animasi (${am.pages} frame, ${Math.ceil(anim.length / 1024)} KB)`);
} catch (e) {
  if (e.code === 'ENOENT') console.log('  - ffmpeg tidak ada, tes stiker animasi dilewati');
  else throw e;
}

// ---- 5. handler dengan socket palsu ----
const GROUP = '120363000000000000@g.us';
const sent = [];
const sock = {
  user: { id: '6280000000000:1@s.whatsapp.net', lid: '999:1@lid' },
  sendMessage: async (jid, content, opts) => (sent.push({ jid, content, opts }), {}),
  groupMetadata: async () => ({
    subject: 'Grup Tes',
    participants: [
      { id: '6280000000000@s.whatsapp.net', admin: 'admin' }, // bot
      { id: '6281222222222@s.whatsapp.net', admin: 'admin' }, // admin
      { id: '6283333333333@s.whatsapp.net', admin: null }, // member
      { id: '6284444444444@s.whatsapp.net', admin: null }, // member
    ],
  }),
  groupParticipantsUpdate: async (...a) => (sent.push({ kick: a }), []),
};
const mk = (from, text, extra = {}) => ({
  key: { remoteJid: GROUP, participant: from, id: 'X' + Math.random(), fromMe: false },
  message: { extendedTextMessage: { text, ...extra } },
  messageTimestamp: Math.floor(Date.now() / 1000),
});
const last = () => sent[sent.length - 1];
const reset = () => { sent.length = 0; groupCache.invalidate(GROUP); _resetCooldowns(); };

reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.menu'));
assert.match(last().content.text, /\.sticker/);
assert.match(last().content.text, /\.kick/);
ok('.menu menampilkan daftar command');

reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.ping'));
assert.match(last().content.text, /Pong/);
ok('.ping membalas');

reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.kick @6284444444444', { contextInfo: { mentionedJid: ['6284444444444@s.whatsapp.net'] } }));
assert.match(last().content.text, /khusus admin/);
assert.ok(!sent.some((s) => s.kick));
ok('member biasa tidak bisa .kick');

// cooldown: pengirim sama langsung kirim lagi harus diabaikan
reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.ping'));
sent.length = 0;
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.ping'));
assert.equal(sent.length, 0);
ok('cooldown 2 detik berlaku');

reset();
await handleMessage(sock, mk('6281222222222@s.whatsapp.net', '.kick @6284444444444', { contextInfo: { mentionedJid: ['6284444444444@s.whatsapp.net'] } }));
assert.deepEqual(sent.find((s) => s.kick).kick, [GROUP, ['6284444444444@s.whatsapp.net'], 'remove']);
ok('admin bisa .kick member');

reset();
await handleMessage(sock, mk('6281111111111@s.whatsapp.net', '.kick @6281222222222', { contextInfo: { mentionedJid: ['6281222222222@s.whatsapp.net'] } }));
assert.ok(!sent.some((s) => s.kick), 'admin tidak boleh di-kick');
assert.match(last().content.text, /tidak bisa di-kick/);
ok('admin/bot tidak bisa di-kick');

reset();
await handleMessage(sock, mk('6281222222222@s.whatsapp.net', '.antilink on'));
assert.equal(getGroup(GROUP).antilink, true);
ok('.antilink on tersimpan');

reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', 'join https://chat.whatsapp.com/ABCDEFGHIJKLMN'));
assert.ok(sent.some((s) => s.content?.delete), 'pesan harus dihapus');
assert.ok(sent.some((s) => s.kick?.[2] === 'remove'), 'pengirim harus di-kick');
ok('antilink menghapus pesan dan mengeluarkan member');

reset();
await handleMessage(sock, mk('6281222222222@s.whatsapp.net', 'ini link https://chat.whatsapp.com/ABCDEFGHIJKLMN'));
assert.equal(sent.length, 0);
ok('admin boleh kirim link grup');

reset();
await handleMessage(sock, mk('6283333333333@s.whatsapp.net', '.ai halo'));
// tanpa GEMINI_API_KEY harus membalas pesan ramah, bukan crash
assert.match(last().content.text, /GEMINI_API_KEY/);
ok('.ai tanpa API key membalas dengan pesan jelas');

reset();
await handleMessage(sock, mk('6281222222222@s.whatsapp.net', '.video bukan-link'));
assert.match(last().content.text, /Contoh/);
ok('.video tanpa link membalas contoh pemakaian');


// ---- 6. grup berbasis LID (Baileys v7): admin/owner/kick tetap benar ----
{
  const LGROUP = '120363111111111111@g.us';
  const lidSent = [];
  const lidSock = {
    user: { id: '6280000000000:1@s.whatsapp.net', lid: '999:1@lid' },
    sendMessage: async (jid, content, opts) => (lidSent.push({ jid, content, opts }), {}),
    groupMetadata: async () => ({
      subject: 'Grup LID',
      addressingMode: 'lid',
      participants: [
        { id: '999@lid', admin: 'admin' }, // bot (hanya LID)
        { id: '111@lid', phoneNumber: '6281222222222@s.whatsapp.net', admin: 'admin' }, // admin
        { id: '222@lid', phoneNumber: '6283333333333@s.whatsapp.net', admin: null }, // member
        { id: '333@lid', phoneNumber: '6284444444444@s.whatsapp.net', admin: null }, // member target
        { id: '444@lid', phoneNumber: '6281111111111@s.whatsapp.net', admin: null }, // owner (member biasa)
      ],
    }),
    groupParticipantsUpdate: async (...a) => (lidSent.push({ kick: a }), []),
  };
  const lk = (participant, text, extra = {}, keyExtra = {}) => ({
    key: { remoteJid: LGROUP, participant, id: 'L' + Math.random(), fromMe: false, ...keyExtra },
    message: { extendedTextMessage: { text, ...extra } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  const lreset = () => { lidSent.length = 0; groupCache.invalidate(LGROUP); _resetCooldowns(); };
  const mention = (...j) => ({ contextInfo: { mentionedJid: j } });

  lreset();
  await handleMessage(lidSock, lk('222@lid', '.kick @333', mention('333@lid'), { participantAlt: '6283333333333@s.whatsapp.net' }));
  assert.match(lidSent.at(-1).content.text, /khusus admin/);
  ok('LID: member biasa tidak bisa .kick');

  lreset();
  await handleMessage(lidSock, lk('111@lid', '.kick @333', mention('333@lid')));
  assert.deepEqual(lidSent.find((x) => x.kick).kick, [LGROUP, ['333@lid'], 'remove']);
  ok('LID: admin (dikenali lewat LID) bisa .kick, aksi pakai id LID peserta');

  lreset();
  await handleMessage(lidSock, lk('111@lid', '.kick @6284444444444', mention('6284444444444@s.whatsapp.net')));
  assert.deepEqual(lidSent.find((x) => x.kick).kick, [LGROUP, ['333@lid'], 'remove']);
  ok('LID: target berupa nomor dipetakan ke id LID peserta');

  lreset();
  await handleMessage(lidSock, lk('111@lid', '.kick @444 @111 @999', mention('444@lid', '111@lid', '999@lid')));
  assert.ok(!lidSent.some((x) => x.kick), 'owner/admin/bot tidak boleh di-kick');
  ok('LID: owner (lewat nomor), admin, dan bot (LID) dilindungi dari .kick');

  lreset();
  await handleMessage(lidSock, lk('444@lid', '.antilink on', {}, { participantAlt: '6281111111111@s.whatsapp.net' }));
  assert.match(lidSent.at(-1).content.text, /AKTIF/);
  ok('LID: owner (LID + participantAlt nomor) lolos cek admin');

  lreset();
  await handleMessage(lidSock, lk('222@lid', 'join https://chat.whatsapp.com/ABCDEFGHIJKLMN'));
  assert.ok(lidSent.some((x) => x.kick?.[1]?.[0] === '222@lid' && x.kick[2] === 'remove'));
  ok('LID: antilink mengeluarkan pengirim berdasarkan id LID');

  lreset();
  const mapped = { ...lidSock, signalRepository: { lidMapping: { getPNForLID: async (l) => (l === '222@lid' ? '6281111111111@s.whatsapp.net' : null) } } };
  await handleMessage(mapped, lk('222@lid', '.antilink off'));
  assert.match(lidSent.at(-1).content.text, /MATI/);
  ok('LID: pengirim LID dipetakan ke nomor owner lewat lidMapping');
}

// ---- 7. companion_reg_refresh (PR #2765, versi tingkat-aplikasi) ----
{
  const { rotateAdvSecret, withAdvSecret, hasRefreshChild, attachCompanionRefresh } = await import('../src/companionRefresh.js');
  const note = (tag) => ({ tag: 'notification', attrs: { type: 'companion_reg_refresh', id: '1' }, content: tag ? [{ tag, attrs: {} }] : [] });

  assert.equal(hasRefreshChild(note('companion_reg_refresh')), true);
  assert.equal(hasRefreshChild(note('pair-device-rotate-qr')), true);
  assert.equal(hasRefreshChild(note('lain')), false);
  assert.equal(hasRefreshChild({ tag: 'notification', attrs: {} }), false);
  ok('companion_reg_refresh: hanya anak companion_reg_refresh / pair-device-rotate-qr yang diterima');

  const emitted = [];
  const creds = { advSecretKey: 'LAMA', me: undefined };
  assert.equal(rotateAdvSecret(note('lain'), creds, (u) => emitted.push(u)), 'ignored_malformed');
  assert.equal(creds.advSecretKey, 'LAMA');
  assert.equal(rotateAdvSecret(note('companion_reg_refresh'), { ...creds, me: { id: 'x' } }, (u) => emitted.push(u)), 'ignored_registered');
  assert.equal(emitted.length, 0);
  ok('companion_reg_refresh: notifikasi cacat & sesi yang sudah punya creds.me diabaikan');

  assert.equal(rotateAdvSecret(note('pair-device-rotate-qr'), creds, (u) => emitted.push(u)), 'rotated');
  assert.notEqual(creds.advSecretKey, 'LAMA');
  assert.equal(Buffer.from(creds.advSecretKey, 'base64').length, 32);
  assert.deepEqual(emitted, [{ advSecretKey: creds.advSecretKey }]);
  const first = creds.advSecretKey;
  rotateAdvSecret(note('companion_reg_refresh'), creds, () => {});
  assert.notEqual(creds.advSecretKey, first);
  ok('companion_reg_refresh: adv secret baru 32 byte acak, disimpan lewat creds.update');

  const qr = 'https://wa.me/settings/linked_devices#REF1,NOISE,IDENT,LAMA,5';
  assert.equal(withAdvSecret(qr, 'BARU+/='), 'https://wa.me/settings/linked_devices#REF1,NOISE,IDENT,BARU+/=,5');
  assert.equal(withAdvSecret('bukan,qr', 'X'), 'bukan,qr');
  ok('QR: field adv secret diganti, ref & field lain tetap, format asing dibiarkan');

  // socket palsu: alur penuh (QR tampil -> notifikasi -> QR baru dengan ref sama, secret beda)
  const listeners = {};
  const evs = [];
  const fakeSock = {
    authState: { creds: { advSecretKey: 'LAMA', me: undefined } },
    ws: { on: (n, f) => (listeners[n] = f) },
    ev: { emit: (n, u) => evs.push([n, u]) },
  };
  const seen = [];
  const { patchQr } = attachCompanionRefresh(fakeSock, { onQr: (q) => seen.push(q), log: () => {} });
  assert.equal(patchQr(qr), qr); // belum ada refresh: QR tidak berubah
  listeners['CB:notification,type:companion_reg_refresh'](note('companion_reg_refresh'));
  assert.equal(seen.length, 1);
  assert.match(seen[0], /#REF1,NOISE,IDENT,/);
  assert.ok(!seen[0].includes(',LAMA,'));
  assert.equal(evs[0][0], 'creds.update');
  // QR berikutnya dari library (masih membawa secret lama di closure-nya) harus ikut dikoreksi
  const next = patchQr('https://wa.me/settings/linked_devices#REF2,NOISE,IDENT,LAMA,5');
  assert.ok(next.includes(fakeSock.authState.creds.advSecretKey) && next.includes('#REF2,'));
  ok('companion_reg_refresh: QR di layar diperbarui (ref sama), QR berikutnya ikut memakai secret baru');
}

// ---- 8. halaman QR web ----
{
  const { createWebServer, loginState, setQr, describeState } = await import('../src/web.js');
  const KEY = 'kunci-rahasia-tes-1234567890';
  const srv = createWebServer({ qrKey: KEY, log: () => {} });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (u) => { const r = await fetch(base + u); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; };

  assert.equal((await get('/qr')).status, 403);
  assert.equal((await get('/qr?key=salah')).status, 403);
  assert.equal((await get('/qr.json?key=salah')).status, 403);
  const page = await get(`/qr?key=${KEY}`);
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  ok('/qr menolak key salah / kosong, menerima key benar');

  let j = JSON.parse((await get(`/qr.json?key=${KEY}`)).body);
  assert.equal(j.status, 'waiting');
  assert.equal(j.image, null);
  setQr('https://wa.me/settings/linked_devices#R,N,I,A,5');
  j = JSON.parse((await get(`/qr.json?key=${KEY}`)).body);
  assert.equal(j.status, 'qr');
  assert.match(j.image, /^data:image\/png;base64,/);
  ok('/qr.json: menunggu -> QR dirender ke gambar PNG');

  Object.assign(loginState, { connected: true, number: '6280000000000' });
  setQr(null);
  j = JSON.parse((await get(`/qr.json?key=${KEY}`)).body);
  assert.equal(j.status, 'connected');
  assert.match(j.text, /Sudah terhubung/);
  assert.equal(j.image, null);
  ok('setelah tertaut halaman bilang "Sudah terhubung" dan tidak memberi QR');

  const health = JSON.parse((await get('/')).body);
  assert.equal(health.ok, true);
  assert.ok(!JSON.stringify(health).includes('6280000000000'));
  ok('healthcheck "/" tetap jalan dan tidak membocorkan nomor/QR');

  assert.equal(describeState({ mode: 'code', connected: false }).status, 'code-mode');
  assert.equal(describeState({ mode: 'qr', connected: false, registered: true }).status, 'reconnecting');
  const off = createWebServer({ qrKey: '', log: () => {} });
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  const offRes = await fetch(`http://127.0.0.1:${off.address().port}/qr?key=`);
  assert.equal(offRes.status, 404);
  off.close();
  srv.close();
  ok('QR_KEY kosong = halaman QR mati (404)');
}

console.log(`\n${passed} tes lulus`);
process.exit(0);
