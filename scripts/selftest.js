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

console.log(`\n${passed} tes lulus`);
process.exit(0);
