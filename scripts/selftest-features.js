// Tes fitur baru (tanpa koneksi WhatsApp): node scripts/selftest-features.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-t-'));
process.env.OWNER_NUMBERS = '6281111111111';
const R = new URL('../src/', import.meta.url).href;
const { loadCommands } = await import(R + 'registry.js');
const { handleMessage, _resetCooldowns } = await import(R + 'handler.js');
const store = await import(R + 'store.js');
const groupCache = await import(R + 'groupCache.js');
const mod = await import(R + 'moderation.js');
const rem = await import(R + 'reminders.js');

let n = 0; const ok = (m) => console.log('  ✓', m) || n++;
console.log('commands:', await loadCommands());

assert.equal(rem.parseDuration('10m'), 600); assert.equal(rem.parseDuration('1h30m'), 5400);
assert.equal(rem.parseDuration('abc'), null); assert.equal(rem.parseDuration('90'), null);
ok('parseDuration');

const G = '120363000000000000@g.us';
const sent = [];
const sock = {
  user: { id: '6280000000000:1@s.whatsapp.net', lid: '999:1@lid' },
  sendMessage: async (jid, c, o) => (sent.push({ jid, c, o }), {}),
  groupMetadata: async () => ({ subject: 'T', participants: [
    { id: '6280000000000@s.whatsapp.net', admin: 'admin' },
    { id: '6281222222222@s.whatsapp.net', admin: 'admin' },
    { id: '6283333333333@s.whatsapp.net', admin: null },
    { id: '6284444444444@s.whatsapp.net', admin: null },
  ] }),
  groupParticipantsUpdate: async (...a) => (sent.push({ kick: a }), []),
};
const ADMIN = '6281222222222@s.whatsapp.net', M1 = '6283333333333@s.whatsapp.net', M2 = '6284444444444@s.whatsapp.net', OWN = '6281111111111@s.whatsapp.net';
const mk = (from, text, jid = G, extra = {}) => ({
  key: { remoteJid: jid, participant: jid === G ? from : undefined, id: 'X' + Math.random(), fromMe: false },
  message: { extendedTextMessage: { text, ...extra } }, messageTimestamp: Math.floor(Date.now() / 1000),
});
const last = () => sent.at(-1);
const reset = () => { sent.length = 0; groupCache.invalidate(G); _resetCooldowns(); mod._reset(); };
const say = async (from, t, jid) => { _resetCooldowns(); await handleMessage(sock, mk(from, t, jid)); };

// --- menu memuat command baru
reset(); await say(M1, '.menu');
for (const c of ['toimg', 'tovideo', 'ocr', 'translate', 'ringkas', 'brat', 'smeme', 'remind', 'removebg', 'remini', 'antispam', 'antitoxic', 'rank', 'poll', 'absen', 'tt', 'ig', 'ttmp3', 'owner'])
  assert.match(last().c.text, new RegExp('\\.' + c + '\\b'), c);
assert.doesNotMatch(last().c.text, /\.allow|\.mode/);
ok('.menu memuat semua command baru, command owner disembunyikan');

// --- mode privat
reset(); await say(OWN, '.mode private'); assert.match(last().c.text, /PRIVAT/);
sent.length = 0; await say(M1, '.ping'); assert.equal(sent.length, 0);
await say(OWN, '.allow add 6283333333333'); assert.match(last().c.text, /diizinkan/);
sent.length = 0; await say(M1, '.ping'); assert.match(last().c.text, /Pong/);
sent.length = 0; await say(M2, '.ping'); assert.equal(sent.length, 0);
await say(OWN, '.allow list'); assert.match(last().c.text, /6283333333333/);
await say(OWN, '.allow del 6283333333333'); sent.length = 0; await say(M1, '.ping'); assert.equal(sent.length, 0);
await say(OWN, '.mode public'); sent.length = 0; await say(M2, '.ping'); assert.match(last().c.text, /Pong/);
ok('mode privat + .allow add/list/del + kembali ke publik');

reset(); await say(M1, '.mode private'); assert.match(last().c.text, /khusus owner/);
ok('member biasa tidak bisa .mode');

// --- botoff / boton
reset(); await say(ADMIN, '.botoff'); assert.equal(store.getGroup(G).muted, true);
sent.length = 0; await say(M1, '.ping'); assert.equal(sent.length, 0);
sent.length = 0; await say(ADMIN, '.ping'); assert.match(last().c.text, /Pong/);
await say(ADMIN, '.boton'); sent.length = 0; await say(M1, '.ping'); assert.match(last().c.text, /Pong/);
ok('.botoff membisukan non-admin, admin tetap bisa, .boton memulihkan');

// --- antitoxic
reset(); await say(ADMIN, '.antitoxic on'); assert.equal(store.getGroup(G).antitoxic, true);
sent.length = 0; await say(M1, 'dasar anjing lu');
assert.ok(sent.some((s) => s.c?.delete)); assert.match(last().c.text, /1\/3/);
await say(M1, 'goblok'); assert.match(last().c.text, /2\/3/);
await say(M1, 'tolol'); assert.ok(sent.some((s) => s.kick?.[2] === 'remove')); 
sent.length = 0; await say(M2, 'asuransi mobil'); assert.equal(sent.length, 0);
sent.length = 0; await say(ADMIN, 'anjing'); assert.equal(sent.length, 0);
ok('antitoxic: hapus+peringatan 1..3 lalu kick; kata utuh saja; admin dikecualikan');

// --- antispam
reset(); await say(ADMIN, '.antispam on');
sent.length = 0;
for (let i = 0; i < 7; i++) await say(M2, 'p' + i);
assert.match(last().c.text, /spam.*1\/3/);
ok('antispam: 7 pesan beruntun memicu peringatan');
await say(ADMIN, '.antispam off'); await say(ADMIN, '.antitoxic off');

// --- rank
reset(); const before = Object.keys(store.getRank(G)).length;
await say(M1, 'a'); await say(M1, 'b'); await say(M2, 'c'); sent.length = 0; await say(M1, '.rank');
assert.match(last().c.text, /Anggota paling aktif/); assert.match(last().c.text, /@6283333333333/);
assert.ok(last().c.mentions.includes(M1));
ok('.rank menampilkan anggota teraktif dengan mention');
await say(M1, '.rank reset'); assert.match(last().c.text, /khusus admin/);
await say(ADMIN, '.rank reset'); assert.match(last().c.text, /direset/); assert.equal(Object.keys(store.getRank(G)).length, 0);
ok('.rank reset hanya admin');

// --- poll
reset(); await say(M1, '.poll Makan apa? | Bakso | Nasi goreng'); assert.match(last().c.text, /1\. Bakso/);
await say(M1, '.vote 2'); assert.match(last().c.text, /Nasi goreng/);
await say(M2, '.vote 2'); await say(ADMIN, '.vote 1'); await say(M1, '.poll hasil');
assert.match(last().c.text, /1 suara \(33%\)/); assert.match(last().c.text, /2 suara \(67%\)/);
await say(M2, '.poll selesai'); assert.match(last().c.text, /khusus|Hanya pembuat/);
await say(M1, '.poll selesai'); assert.match(last().c.text, /selesai/);
await say(M1, '.vote 1'); assert.match(last().c.text, /Tidak ada poll/);
ok('poll: buat, vote, ubah suara, hasil, hak mengakhiri');

// --- absen
reset(); await say(M1, '.absen mulai Rapat'); assert.match(last().c.text, /khusus|Hanya admin/);
await say(ADMIN, '.absen mulai Rapat Mingguan'); assert.match(last().c.text, /Rapat Mingguan/);
await say(M1, '.absen'); assert.match(last().c.text, /hadir \(1\)/);
await say(M1, '.absen'); assert.match(last().c.text, /sudah tercatat/);
await say(M2, '.hadir'); await say(M1, '.absen list'); assert.match(last().c.text, /Total hadir: 2/);
await say(ADMIN, '.absen selesai'); assert.match(last().c.text, /ditutup/);
await say(M1, '.absen'); assert.match(last().c.text, /Tidak ada absen/);
ok('absen: mulai (admin), hadir, duplikat, list, selesai');

// --- remind
reset(); await say(M1, '.remind 10m minum obat'); assert.match(last().c.text, /10 menit/);
await say(M1, '.remind 1 jam 30 menit rapat'); assert.match(last().c.text, /1 jam 30 menit/);
await say(M1, '.remind list'); assert.match(last().c.text, /minum obat/); assert.match(last().c.text, /rapat/);
await say(M1, '.remind batal 1'); assert.match(last().c.text, /dibatalkan/);
await say(M1, '.remind 2s tes'); assert.match(last().c.text, /Minimal/);
await say(M1, '.remind 30d tes'); assert.match(last().c.text, /Maksimal 7 hari/);
await say(M1, '.remind sepuluh menit tes'); assert.match(last().c.text, /Contoh/);
// jatuh tempo: scheduler mengirim
store.addReminder({ id: 'z', jid: G, who: M1, text: 'jatuh tempo', at: Date.now() - 1000 });
rem.startReminders(sock, () => {}); await new Promise((r) => setTimeout(r, 100));
assert.ok(sent.some((s) => /Pengingat/.test(s.c?.text || '') && /jatuh tempo/.test(s.c.text)));
assert.ok(!store.getReminders().some((r) => r.id === 'z'));
ok('remind: parse, list, batal, batas, dan pengiriman saat jatuh tempo');

// --- owner
reset(); await say(M1, '.owner'); assert.match(last().c.text, /wa\.me\/6281111111111/);
ok('.owner');

// --- tanpa API key
for (const [cmd, re] of [['.ocr', /gambar/], ['.translate english halo', /GEMINI_API_KEY/], ['.ringkas', /Reply pesan|tautan/], ['.brat', /Contoh/], ['.smeme a|b', /gambar/], ['.toimg', /Reply stiker/], ['.tovideo', /Reply stiker/], ['.removebg', /gambar/], ['.remini', /gambar/], ['.tt', /Contoh/], ['.ig', /Contoh/], ['.ttmp3', /Contoh/]]) {
  reset(); await say(M1, cmd); assert.match(last().c.text, re, cmd);
}
ok('semua command baru membalas pesan bantuan yang jelas saat input kurang');

console.log(`\n${n} blok tes lolos`);
process.exit(0);
