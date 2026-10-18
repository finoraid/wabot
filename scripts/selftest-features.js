// Tes fitur baru (tanpa koneksi WhatsApp): node scripts/selftest-features.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-t-'));
process.env.OWNER_NUMBERS = '6281111111111';
process.env.GEMINI_API_KEY = 'test-key';
process.env.BROADCAST_DELAY_MS = '0';
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

// --- menu: foto banner + teks berkotak
reset(); await say(M1, '.menu');
{
  const { allCommands } = await import(R + 'registry.js');
  const menu = await import(R + 'menu.js');
  const all = allCommands();
  const groups = menu.groupCommands(all, { isOwner: false });
  const ctx = { botName: 'WaBot', prefix: '.', name: 'Sky', uptime: '1 menit' };
  const { caption: cap0, follow } = menu.overviewParts(ctx, groups);
  const cap = cap0 + '\n' + follow;
  assert.ok(cap0.length <= 1000, 'caption foto terlalu panjang: ' + cap0.length);
  for (const c of ['toimg', 'tovideo', 'ocr', 'translate', 'ringkas', 'brat', 'smeme', 'remind', 'removebg', 'remini', 'antispam', 'antitoxic', 'rank', 'poll', 'absen', 'tt', 'ig', 'ttmp3', 'owner', 'quotes', 'fakta', 'slot', 'suit', 'jodoh', 'rate', 'kuis', 'tebakangka', 'skor', 'cuaca', 'jadwalsholat', 'kurs', 'hitung', 'qr', 'stopwatch', 'suara', 'tts', 'afk', 'catatan', 'rules', 'warn', 'cekwarn', 'tagadmin', 'sapa', 'attp', 'stikerwm'])
    assert.ok(cap.includes('.' + c), 'menu tidak memuat .' + c);
  assert.ok(!cap.includes('.allow') && !cap.includes('.mode') && !cap.includes('.broadcast') && !cap.includes('.ban'), 'command owner harus disembunyikan');
  assert.match(cap0, /╭──「 \*WaBot\* 」/);
  assert.ok(menu.groupCommands(all, { isOwner: true }).some((g) => g.name === 'Owner'));
  for (const c of all) assert.ok(menu.shortDesc(c).length > 0 && menu.shortDesc(c).length <= 40, c.name + ': keterangan terlalu panjang');
  assert.equal(menu.shortDesc(all.find((c) => c.name === 'remind')), 'Pengingat');
  const d = menu.detailBox(groups.find((g) => g.name === 'Media'), '.');
  assert.match(d, /▸ \*\.brat\* _<teks>_\n│    Stiker teks gaya brat/);
  assert.match(menu.bannerSvg({ botName: 'WaBot', prefix: '.', categories: ['Umum', 'Media'] }), /<svg[\s\S]*WaBot/);
  // handler: tanpa sharp asli (stub) jatuh ke teks; dengan sharp asli berupa foto + caption
  const out = sent.map((x) => x.c?.caption || x.c?.text || '').join('\n');
  assert.match(out, /\.remind/); assert.match(out, /╭/);
  reset(); await say(M1, '.menu media'); assert.match(sent.map((x) => x.c?.caption || x.c?.text || '').join('\n'), /\.brat[\s\S]*Stiker teks gaya brat/);
  reset(); await say(M1, '.menu grup'); assert.match((last().c.text || '') + (sent.map((x) => x.c?.caption || x.c?.text || '').join('')), /\.antispam/);
  reset(); await say(M1, '.menu xyz'); assert.match(last().c.text, /Kategori tidak ada/);
  reset(); await say(M1, '.menu semua'); assert.match(sent.map((x) => x.c?.caption || x.c?.text || '').join(''), /\.sticker[\s\S]*\.vote/);
  reset(); await say(OWN, '.menu owner'); assert.match(sent.map((x) => x.c?.caption || x.c?.text || '').join('\n'), /\.allow/);
}
ok('.menu: foto banner + teks berkotak, .menu <kategori> rinci, owner tersembunyi, panjang caption aman');

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


// ================= GELOMBANG KEDUA =================
const texts = () => sent.map((x) => x.c?.caption || x.c?.text || '').join('\n');
const realFetch = globalThis.fetch;
const mockFetch = (routes) => { globalThis.fetch = async (url) => { const u = String(url); const hit = Object.entries(routes).find(([k]) => u.includes(k)); if (!hit) throw new Error('fetch tak terduga: ' + u); const [status, body] = typeof hit[1] === 'function' ? hit[1](u) : hit[1]; return { ok: status >= 200 && status < 300, status, json: async () => body }; }; };

// --- hiburan
reset(); await say(M1, '.quotes'); assert.match(last().c.text, /💬/);
await say(M1, '.fakta'); assert.match(last().c.text, /Tahukah kamu/);
await say(M1, '.slot'); assert.match(last().c.text, /🎰/);
await say(M1, '.suit batu'); assert.match(last().c.text, /Kamu:[\s\S]*Bot:/);
await say(M1, '.suit pisau'); assert.match(last().c.text, /Contoh/);
await say(M1, '.jodoh Budi Sari'); const j1 = last().c.text;
await say(M1, '.jodoh Sari Budi'); assert.equal(last().c.text.match(/\d+%/)[0], j1.match(/\d+%/)[0]);
await say(M1, '.rate kegantengan'); const r1 = last().c.text; await say(M1, '.rate kegantengan'); assert.equal(last().c.text, r1);
ok('hiburan: quotes, fakta, slot, suit, jodoh (simetris), rate (stabil)');

// --- kuis & tebak angka
const games = await import(R + 'games.js');
reset(); await say(M1, '.kuis'); assert.match(last().c.text, /KUIS/);
const g = games.getGame(G); assert.equal(g.type, 'kuis');
sent.length = 0; await say(M2, 'jawaban ngawur'); assert.equal(sent.length, 0);
await say(M2, g.shown.toUpperCase() + '!'); assert.match(last().c.text, /benar/); assert.equal(games.getGame(G), null);
await say(M1, '.skor'); assert.match(last().c.text, /Papan skor/); assert.match(last().c.text, /6284444444444/);
await say(ADMIN, '.skor reset'); await say(M1, '.skor'); assert.match(last().c.text, /Belum ada skor/);
await say(M1, '.kuis'); await say(M1, '.nyerah'); assert.match(last().c.text, /Jawabannya/);
ok('kuis: soal, jawaban salah diabaikan, jawaban benar (huruf besar/tanda baca) beri skor, skor & reset, menyerah');

reset(); await say(M1, '.tebakangka'); const ga = games.getGame(G); assert.equal(ga.type, 'angka');
const wrong = ga.target === 50 ? 51 : 50; await say(M1, String(wrong)); assert.match(last().c.text, /Terlalu (kecil|besar)/);
await say(M2, String(ga.target)); assert.match(last().c.text, /menebak angka/);
await say(M1, '.tebakangka'); const gb = games.getGame(G); for (let i = 0; i < 7; i++) await say(M1, String(gb.target === 1 ? 2 : 1)); assert.match(last().c.text, /Kesempatan habis/);
ok('tebak angka: petunjuk, menang beri poin, kalah setelah 7 kesempatan');

// --- alat: hitung, qr, stopwatch
reset(); await say(M1, '.hitung (2+3)*4'); assert.match(last().c.text, /= \*20\*/);
await say(M1, '.hitung 2+'); assert.match(last().c.text, /Tidak bisa dihitung/);
await say(M1, '.hitung process.exit()'); assert.match(last().c.text, /Tidak bisa dihitung/);
await say(M1, '.qr https://contoh.com'); assert.ok(Buffer.isBuffer(last().c.image));
await say(M1, '.stopwatch'); assert.match(last().c.text, /dimulai/); await say(M1, '.stopwatch'); assert.match(last().c.text, /Berhenti/);
ok('alat: hitung (aman), qr, stopwatch');

// --- alat: cuaca, sholat, kurs (fetch dipalsukan)
mockFetch({
  'geocoding-api.open-meteo.com': (u) => (u.includes('Zzzz') ? [200, {}] : [200, { results: [{ name: 'Kota Bandung', latitude: -6.9, longitude: 107.6, admin1: 'Jawa Barat' }] }]),
  'api.open-meteo.com/v1/forecast': [200, { current: { temperature_2m: 24.6, apparent_temperature: 26.1, relative_humidity_2m: 80, weather_code: 3, wind_speed_10m: 7.2 }, daily: { time: ['2026-10-18', '2026-10-19', '2026-10-20'], weather_code: [61, 2, 0], temperature_2m_max: [28, 29, 30], temperature_2m_min: [20, 21, 21], precipitation_probability_max: [80, 30, 10] } }],
  'api.aladhan.com': (u) => (u.includes('Nowhere') ? [400, { code: 400 }] : [200, { data: { timings: { Imsak: '04:02', Fajr: '04:12', Sunrise: '05:30', Dhuhr: '11:38', Asr: '14:47', Maghrib: '17:45', Isha: '18:56' }, date: { readable: '18 Oct 2026' }, meta: { timezone: 'Asia/Jakarta', method: { name: 'Kementerian Agama Republik Indonesia' } } } }]),
  'api.frankfurter.dev': (u) => (u.includes('XXX') ? [404, {}] : [200, { amount: 100, base: 'USD', date: '2026-10-16', rates: { IDR: 1803100 } }]),
});
reset(); await say(M1, '.cuaca Bandung'); assert.match(last().c.text, /Kota Bandung, Jawa Barat/); assert.match(last().c.text, /25°C/); assert.match(last().c.text, /Hujan, 20-28°C, hujan 80%/);
await say(M1, '.cuaca Zzzz'); assert.match(last().c.text, /tidak ditemukan/);
await say(M1, '.jadwalsholat Jakarta'); assert.match(last().c.text, /Subuh\s+: \*04:12\*/); assert.match(last().c.text, /Isya\s+: \*18:56\*/);
await say(M1, '.jadwalsholat Nowhere'); assert.match(last().c.text, /tidak ditemukan/);
await say(M1, '.kurs 100 usd idr'); assert.match(last().c.text, /100 USD\* = \*1\.803\.100 IDR/);
await say(M1, '.kurs 5 xxx'); assert.match(last().c.text, /tidak didukung/);
await say(M1, '.kurs'); assert.match(last().c.text, /Contoh/);
globalThis.fetch = realFetch;
ok('cuaca, jadwal sholat, kurs: parsing respons API + pesan error');

// --- TTS: parsing respons & konversi
{
  const { findAudioData, geminiTts } = await import(R + 'gemini.js');
  const b64 = Buffer.alloc(300, 1).toString('base64');
  assert.equal(findAudioData({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: b64 }] }] }), b64);
  assert.equal(findAudioData({ steps: [{ content: [{ type: 'text', text: 'halo' }] }] }), null);
  mockFetch({ 'v1beta/interactions': [200, { steps: [{ content: [{ type: 'audio', data: b64 }] }] }] });
  assert.equal((await geminiTts('halo')).length, 300);
  mockFetch({ 'v1beta/interactions': [404, { error: { message: 'model gone' } }] });
  await assert.rejects(() => geminiTts('halo'), /tidak tersedia/);
  globalThis.fetch = realFetch;
}
ok('TTS: ambil audio dari respons, error model hilang jelas');

// --- AFK
reset(); await say(M1, '.afk tidur'); assert.match(last().c.text, /AFK: tidur/);
sent.length = 0; _resetCooldowns(); await handleMessage(sock, mk(M2, 'woi @M1', G, { contextInfo: { mentionedJid: [M1] } }));
assert.match(texts(), /sedang AFK: tidur/);
sent.length = 0; await say(M1, 'aku balik'); assert.match(texts(), /Selamat datang kembali/);
sent.length = 0; _resetCooldowns(); await handleMessage(sock, mk(M2, 'halo @M1', G, { contextInfo: { mentionedJid: [M1] } })); assert.doesNotMatch(texts(), /AFK/);
ok('AFK: ditandai, pemberitahuan saat di-tag, kembali saat menulis');

// --- catatan & rules
reset(); await say(M1, '.catatan simpan wifi | pass 123'); assert.match(last().c.text, /khusus admin/);
await say(ADMIN, '.catatan simpan wifi | pass 123'); assert.match(last().c.text, /disimpan/);
await say(M1, '.catatan wifi'); assert.match(last().c.text, /pass 123/);
await say(M1, '.catatan'); assert.match(last().c.text, /• wifi/);
await say(M1, '.catatan hapus wifi'); assert.match(last().c.text, /khusus admin/);
await say(ADMIN, '.catatan hapus wifi'); assert.match(last().c.text, /dihapus/);
await say(M1, '.catatan wifi'); assert.match(last().c.text, /tidak ada/);
await say(M1, '.rules'); assert.match(last().c.text, /Belum ada aturan/);
await say(M1, '.rules set 1. sopan'); assert.match(last().c.text, /khusus admin/);
await say(ADMIN, '.rules set 1. Sopan\n2. Tanpa spam'); assert.match(last().c.text, /disimpan/);
await say(M1, '.rules'); assert.match(last().c.text, /Tanpa spam/);
ok('catatan & rules: hanya admin yang mengubah, semua bisa membaca');

// --- warn
reset(); const withM2 = { contextInfo: { mentionedJid: [M2] } };
const sayX = async (from, t, extra) => { _resetCooldowns(); await handleMessage(sock, mk(from, t, G, extra)); };
await sayX(M1, '.warn @x', withM2); assert.match(last().c.text, /khusus admin/);
await sayX(ADMIN, '.warn @x spam', withM2); assert.match(last().c.text, /1\/3/); assert.match(last().c.text, /Alasan: spam/);
await sayX(M1, '.cekwarn @x', withM2); assert.match(last().c.text, /1\/3/);
await sayX(ADMIN, '.warn @x', withM2); await sayX(ADMIN, '.warn @x', withM2);
assert.ok(sent.some((s) => s.kick?.[2] === 'remove'), 'kick pada peringatan ke-3');
await sayX(ADMIN, '.warn @x', { contextInfo: { mentionedJid: [ADMIN] } }); assert.match(last().c.text, /tidak bisa diberi peringatan/);
ok('warn: hanya admin, hitung, cekwarn, kick di peringatan ke-3, admin dilindungi');

// --- tagadmin & sapa
reset(); await say(M1, '.tagadmin tolong'); assert.ok(last().c.mentions.includes(ADMIN)); assert.match(last().c.text, /tolong/);
sent.length = 0; _resetCooldowns(); await handleMessage(sock, mk(M1, '.tagadmin lagi')); assert.match(last().c.text, /Tunggu semenit/);
await say(ADMIN, '.sapa on'); assert.equal(store.getGroup(G).sapa, true); await say(ADMIN, '.sapa off'); assert.equal(store.getGroup(G).sapa, false);
{ const { localParts } = await import(R + 'greetings.js'); assert.deepEqual(localParts(new Date('2026-10-17T23:00:00Z'), 'Asia/Jakarta'), { day: '2026-10-18', time: '06:00' }); }
ok('tagadmin (dengan cooldown), sapa on/off, jam lokal Asia/Jakarta');

// --- owner: ban, stat, broadcast
reset(); await say(OWN, '.ban 6283333333333'); assert.match(last().c.text, /diblokir/);
sent.length = 0; await say(M1, '.ping'); assert.equal(sent.length, 0);
await say(OWN, '.banlist'); assert.match(last().c.text, /6283333333333/);
await say(OWN, '.ban 6281111111111'); assert.match(last().c.text, /Owner tidak bisa/);
await say(OWN, '.unban 6283333333333'); sent.length = 0; await say(M1, '.ping'); assert.match(last().c.text, /Pong/);
await say(OWN, '.stat'); assert.match(last().c.text, /Statistik bot/); assert.match(last().c.text, /\.ping — /);
await say(M1, '.stat'); assert.match(last().c.text, /khusus owner/);
const bcSock = { ...sock, groupFetchAllParticipating: async () => ({ 'a@g.us': {}, 'b@g.us': {} }) };
sent.length = 0; _resetCooldowns(); await handleMessage(bcSock, mk(OWN, '.broadcast Halo semua'));
assert.equal(sent.filter((s) => /Pengumuman/.test(s.c?.text || '')).length, 2); assert.match(last().c.text, /2\/2 grup/);
ok('owner: ban/unban/banlist, stat, broadcast ke semua grup');

// --- stiker: sisipan EXIF WebP & bingkai ATTP
{
  const { withExif, buildExif } = await import(R + 'webpexif.js');
  const { attpFrameSvg } = await import(R + 'commands/stickerx.js').catch(() => ({}));
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const f = path.join(process.env.DATA_DIR, 'p.webp');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x128:rate=1:duration=1', '-frames:v', '1', '-vcodec', 'libwebp', f]);
    const out = withExif(fs.readFileSync(f), buildExif('Paket', 'Sky'));
    assert.equal(out.toString('latin1', 0, 4), 'RIFF'); assert.equal(out.readUInt32LE(4), out.length - 8);
    assert.ok(out.includes(Buffer.from('EXIF')) && out.includes(Buffer.from('sticker-pack-name')) && out.includes(Buffer.from('Paket')));
    assert.equal(out.toString('latin1', 12, 16), 'VP8X');
    assert.throws(() => withExif(Buffer.from('bukan webp'), buildExif('a', 'b')), /bukan berkas WebP/);
    ok('stikerwm: EXIF tersisip ke WebP (RIFF valid, VP8X, nama paket terbaca)');
  } catch (e) { if (e.code === 'ENOENT') console.log('  - ffmpeg tidak ada, tes EXIF dilewati'); else throw e; }
  if (attpFrameSvg) { const svg = attpFrameSvg('halo dunia', '#FF3B30'); assert.ok(svg.includes('halo') && svg.includes('dunia') && svg.includes('#FF3B30')); ok('attp: bingkai SVG memuat teks & warna'); }
}

// --- input kurang / error API
mockFetch({ generativelanguage: [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }] });

for (const [cmd, re] of [['.ocr', /gambar/], ['.translate english halo', /GEMINI_API_KEY tidak valid/], ['.ringkas', /Reply pesan|tautan/], ['.brat', /Contoh/], ['.smeme a|b', /gambar/], ['.toimg', /Reply stiker/], ['.tovideo', /Reply stiker/], ['.removebg', /gambar/], ['.remini', /gambar/], ['.tt', /Contoh/], ['.ig', /Contoh/], ['.ttmp3', /Contoh/], ['.suara', /Reply pesan suara/], ['.tts', /Contoh/], ['.attp', /Contoh/], ['.stikerwm', /Reply stiker/]]) {
  reset(); await say(M1, cmd); assert.match(last().c.text, re, cmd);
}
ok('semua command baru membalas pesan bantuan yang jelas saat input kurang');

globalThis.fetch = realFetch;
console.log(`\n${n} blok tes lolos`);
process.exit(0);
