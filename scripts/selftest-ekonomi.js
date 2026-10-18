// Tes ekonomi virtual + anti-hapus/anti-sekali-lihat (tanpa koneksi WhatsApp): node scripts/selftest-ekonomi.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-eco-'));
process.env.OWNER_NUMBERS = '6281111111111';
const R = new URL('../src/', import.meta.url).href;
const { loadCommands } = await import(R + 'registry.js');
const { handleMessage, _resetCooldowns } = await import(R + 'handler.js');
const eco = await import(R + 'economy.js');
const store = await import(R + 'store.js');
const groupCache = await import(R + 'groupCache.js');
const ad = await import(R + 'antidelete.js');

let n = 0;
const ok = (m) => console.log('  ✓', m) || n++;
await loadCommands();

// ---- logika murni ----
assert.equal(eco.parseAmount('500'), 500);
assert.equal(eco.parseAmount('1.5k'), 1500);
assert.equal(eco.parseAmount('2jt'), 2_000_000);
assert.equal(eco.parseAmount('1.000'), 1000);
assert.equal(eco.parseAmount('all', 777), 777);
assert.equal(eco.parseAmount('abc'), null);
assert.equal(eco.parseAmount('-5'), null);
assert.equal(eco.parseAmount('0'), null);
ok('parseAmount: 500, 1.5k, 2jt, 1.000, all; menolak abc/negatif/nol');

assert.equal(eco.levelOf(0), 0);
assert.equal(eco.levelOf(99), 0);
assert.equal(eco.levelOf(100), 1);
assert.equal(eco.levelOf(400), 2);
assert.equal(eco.progress(250).level, 1);
ok('level = floor(sqrt(xp/100))');

const t0 = 1_800_000_000_000;
let r = eco.claimDaily('u1', t0);
assert.ok(r.ok && r.reward === 500 && r.streak === 1);
assert.equal(eco.claimDaily('u1', t0 + 3600_000).ok, false);
r = eco.claimDaily('u1', t0 + eco.DAY_MS + 1);
assert.ok(r.ok && r.streak === 2 && r.reward === 600);
r = eco.claimDaily('u1', t0 + 4 * eco.DAY_MS); // telat > 2 hari
assert.ok(r.ok && r.streak === 1);
ok('daily: cooldown 24 jam, streak naik, reset kalau telat');

store.updateUser('g1', (u) => void (u.bal = 1000));
assert.equal(eco.gamble('g1', 50, t0).reason, 'min');
assert.equal(eco.gamble('g1', 5000, t0).reason, 'saldo');
assert.equal(eco.gamble('g1', 200_000, t0).reason, 'max');
r = eco.gamble('g1', 100, t0, () => 50); // kalah
assert.ok(r.ok && r.outcome === 'lose' && r.bal === 900);
assert.equal(eco.gamble('g1', 100, t0 + 1000, () => 50).reason, 'cooldown');
r = eco.gamble('g1', 100, t0 + 20_000, () => 10); // menang x2
assert.ok(r.outcome === 'win' && r.bal === 1000);
r = eco.gamble('g1', 100, t0 + 40_000, () => 1); // jackpot x5 (bersih +4x)
assert.ok(r.outcome === 'jackpot' && r.bal === 1400);
store.updateUser('g1', (u) => void (u.charm = 1));
r = eco.gamble('g1', 100, t0 + 60_000, () => 48); // 48 kalah tanpa jimat, menang dengan jimat
assert.ok(r.outcome === 'win' && r.charmed && r.charmLeft === 0);
ok('judi: batas min/max, saldo, cooldown, menang/kalah/jackpot, jimat hoki');

// peluang nyata: harapan sedikit negatif, tidak pernah menciptakan koin tak terbatas
{
  let bal = 0;
  for (let i = 0; i < 20000; i++) {
    store.updateUser('sim', (u) => void ((u.bal = 1000), (u.lastBet = 0)));
    bal += eco.gamble('sim', 1000, t0 + i * 10_000).net;
  }
  const ev = bal / 20000 / 1000;
  assert.ok(ev < 0.03 && ev > -0.12, 'harapan per taruhan di luar dugaan: ' + ev);
}
ok('judi: simulasi 20.000 putaran, harapan nilai sedikit negatif');

store.updateUser('a', (u) => void (u.bal = 1000));
assert.equal(eco.transfer('a', 'a', 100).reason, 'self');
assert.equal(eco.transfer('a', 'b', 50).reason, 'min');
assert.equal(eco.transfer('a', 'b', 1000).reason, 'saldo'); // butuh 1050
r = eco.transfer('a', 'b', 500);
assert.ok(r.ok && r.fee === 25);
assert.equal(store.getUser('a').bal, 475);
assert.equal(store.getUser('b').bal, 500);
ok('transfer: biaya 5% dibakar, saldo pengirim/penerima benar, validasi');

store.updateUser('s', (u) => void (u.bal = 30_000));
assert.equal(eco.buy('s', eco.findItem('jimat'), 2).ok, true);
assert.equal(store.getUser('s').charm, 10);
assert.equal(eco.buy('s', eco.findItem('2')).ok, true); // nomor 2 = booster
assert.ok(store.getUser('s').boostUntil > Date.now());
assert.equal(eco.buy('s', eco.findItem('juragan')).ok, true);
assert.equal(eco.buy('s', eco.findItem('juragan')).reason, 'owned');
assert.equal(eco.buy('s', eco.findItem('sultan')).reason, 'saldo');
ok('toko: jimat, booster, gelar; tidak bisa beli gelar dua kali / saldo kurang');

const xp = eco.addChatXp('x1', t0);
assert.ok(xp.gained >= 8 && xp.gained <= 20);
assert.equal(eco.addChatXp('x1', t0 + 1000), null);
assert.ok(eco.addChatXp('x1', t0 + 60_000));
store.updateUser('x2', (u) => void ((u.xp = 95), (u.lastXp = 0)));
const lv = eco.addChatXp('x2', t0);
assert.ok(lv.leveledUp && lv.level === 1 && lv.bonus === 200);
ok('XP chat: jeda 45 detik, naik level memberi bonus koin');

// ---- lewat handler (seperti pesan WhatsApp asli) ----
const G = '120363000000000000@g.us';
const sent = [];
const sock = {
  user: { id: '6280000000000:1@s.whatsapp.net', lid: '999:1@lid' },
  sendMessage: async (jid, c, o) => (sent.push({ jid, c, o }), {}),
  groupMetadata: async () => ({ subject: 'Grup Tes', participants: [
    { id: '6280000000000@s.whatsapp.net', admin: 'admin' },
    { id: '6281222222222@s.whatsapp.net', admin: 'admin' },
    { id: '6283333333333@s.whatsapp.net', admin: null },
    { id: '6284444444444@s.whatsapp.net', admin: null },
  ] }),
  groupParticipantsUpdate: async () => [],
};
const ADMIN = '6281222222222@s.whatsapp.net', M1 = '6283333333333@s.whatsapp.net', M2 = '6284444444444@s.whatsapp.net';
const OWNER_JID = '6281111111111@s.whatsapp.net';
const mk = (from, text, extra = {}) => ({
  key: { remoteJid: G, participant: from, id: 'X' + Math.random().toString(36).slice(2), fromMe: false },
  message: { extendedTextMessage: { text, ...extra } }, messageTimestamp: Math.floor(Date.now() / 1000),
});
const say = async (from, text, extra) => { _resetCooldowns(); sent.length = 0; await handleMessage(sock, mk(from, text, extra)); };
const txt = () => sent.map((s) => s.c.text || '').join('\n');

groupCache.invalidate(G);
await say(M1, '.daily');
assert.match(txt(), /Hadiah harian[\s\S]*\+500 koin/);
await say(M1, '.daily');
assert.match(txt(), /sudah diambil/);
await say(M1, '.saldo');
assert.match(txt(), /Koin: \*5\d\d\*|Koin: \*[\d.]+\*/);
assert.match(txt(), /Level/);
ok('.daily & .saldo lewat handler');

store.updateUser('6283333333333', (u) => void ((u.bal = 5000), (u.lastBet = 0)));
await say(M1, '.judi 1k');
assert.match(txt(), /Taruhan 1\.000/);
await say(M1, '.judi abc');
assert.match(txt(), /Contoh: \.judi/);
await say(M1, '.toko');
assert.match(txt(), /Jimat Hoki[\s\S]*Booster XP[\s\S]*Gelar Raja/);
await say(M1, '.toko beli jimat');
assert.match(txt(), /Berhasil beli/);
ok('.judi & .toko lewat handler');

store.updateUser('6283333333333', (u) => void (u.bal = 2000));
store.updateUser('6284444444444', (u) => void (u.bal = 0));
await say(M1, '.transfer @6284444444444 1000', { contextInfo: { mentionedJid: [M2] } });
assert.match(txt(), /Transfer 1\.000 koin ke @6284444444444 berhasil/);
assert.equal(store.getUser('6284444444444').bal, 1000);
assert.equal(store.getUser('6283333333333').bal, 950);
await say(M1, '.transfer 1000');
assert.match(txt(), /Contoh: \.transfer/);
ok('.transfer: mention, saldo pindah, biaya, pesan bantuan');

await say(M1, 'halo semua');
await say(M2, '.rank');
assert.match(txt(), /Lv \d+/);
ok('.rank menampilkan level & XP');

// ---- anti-hapus ----
const revoke = (by, origId, origFrom) => ({
  key: { remoteJid: G, participant: by, id: 'R' + Math.random().toString(36).slice(2), fromMe: false },
  message: { protocolMessage: { type: 0, key: { remoteJid: G, id: origId, participant: origFrom, fromMe: false } } },
  messageTimestamp: Math.floor(Date.now() / 1000),
});
const post = async (from, text) => { const m = mk(from, text); await handleMessage(sock, m); return m; };

// default mati
sent.length = 0;
let m = await post(M1, 'rahasia pertama');
await handleMessage(sock, revoke(M1, m.key.id, M1));
assert.equal(sent.length, 0);
ok('anti-hapus mati secara default');

await say(M1, '.antihapus on');
assert.match(txt(), /khusus admin/);
await say(ADMIN, '.antihapus on');
assert.match(txt(), /AKTIF \(dikirim ke grup\)/);
assert.equal(store.getGroup(G).antihapus, 'grup');

sent.length = 0;
m = await post(M1, 'pesan yang akan ditarik');
await handleMessage(sock, revoke(M1, m.key.id, M1));
assert.equal(sent.length, 1);
assert.equal(sent[0].jid, G);
assert.match(sent[0].c.text, /Pesan dihapus[\s\S]*@6283333333333[\s\S]*pesan yang akan ditarik/);
assert.deepEqual(sent[0].c.mentions, [M1]);
await handleMessage(sock, revoke(M1, m.key.id, M1)); // duplikat
assert.equal(sent.length, 1);
ok('anti-hapus: teks yang ditarik dikirim ulang ke grup, tanpa duplikat');

sent.length = 0;
m = await post(M1, 'ditarik admin');
await handleMessage(sock, revoke(ADMIN, m.key.id, M1));
assert.equal(sent.length, 0);
ok('anti-hapus: admin menghapus pesan orang lain (moderasi) tidak dipajang ulang');

sent.length = 0;
m = await post(M1, 'dihapus bot');
const botRevoke = revoke('6280000000000@s.whatsapp.net', m.key.id, M1);
await handleMessage(sock, botRevoke);
assert.equal(sent.length, 0);
ok('anti-hapus: penghapusan oleh bot sendiri diabaikan');

await say(ADMIN, '.antitoxic on');
sent.length = 0;
m = await post(M1, 'dasar anjing kamu');
await handleMessage(sock, revoke(M1, m.key.id, M1));
assert.ok(!sent.some((s) => /Pesan dihapus/.test(s.c.text || '')), 'kata kasar tidak boleh dipajang ulang');
ok('anti-hapus: kata kasar (antitoxic aktif) tidak dipajang ulang ke grup');
await say(ADMIN, '.antitoxic off');

await say(ADMIN, '.antihapus owner');
assert.match(txt(), /dikirim ke owner/);
sent.length = 0;
m = await post(M1, 'rahasia buat owner');
await handleMessage(sock, revoke(ADMIN, m.key.id, M1)); // oleh admin pun tetap dikirim ke owner
assert.equal(sent.length, 1);
assert.equal(sent[0].jid, OWNER_JID);
assert.match(sent[0].c.text, /dihapus oleh @6281222222222[\s\S]*Grup Tes[\s\S]*rahasia buat owner/);
ok('anti-hapus mode owner: dikirim pribadi ke owner, menyebut grup & penghapus');

await say(ADMIN, '.antihapus off');
assert.equal(store.getGroup(G).antihapus, '');
ok('.antihapus off');

// ---- anti-sekali-lihat ----
const voMsg = (type = 'imageMessage') => ({
  key: { remoteJid: G, participant: M1, id: 'V' + Math.random().toString(36).slice(2), fromMe: false },
  message: { viewOnceMessageV2: { message: { [type]: { caption: 'lihat ini', mimetype: 'image/jpeg', fileLength: 1000, viewOnce: true } } } },
  messageTimestamp: Math.floor(Date.now() / 1000),
});
assert.ok(ad.viewOnceInfo(voMsg()));
assert.equal(ad.viewOnceInfo({ key: {}, message: { imageMessage: { caption: 'biasa' } } }), null);
assert.ok(ad.viewOnceInfo({ key: {}, message: { ephemeralMessage: { message: { viewOnceMessage: { message: { videoMessage: {} } } } } } }));
ok('deteksi sekali-lihat: V2, ephemeral+V1, dan media biasa tidak terdeteksi');

// tanpa media nyata, unduhan gagal dengan rapi (tidak menjatuhkan bot, tidak mengirim apa pun)
sent.length = 0;
await say(ADMIN, '.antisekali on');
assert.match(txt(), /AKTIF \(dikirim ke grup\)/);
await handleMessage(sock, voMsg());
ok('anti-sekali-lihat: gagal unduh tidak membuat handler error');

// unduhan dipalsukan lewat sock.updateMediaMessage tidak diperlukan; uji jalur kirim ulang dengan modul sendMedia via cache
console.log(`\n${n} blok tes lolos`);
