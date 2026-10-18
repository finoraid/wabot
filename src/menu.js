// Pembuat menu: banner (SVG -> PNG lewat sharp) + teks berkotak. Murni, mudah dites.

const FONT = "'DejaVu Sans','Liberation Sans','Arial',sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Keterangan singkat (1 baris) untuk tiap perintah. */
export const SHORT = {
  menu: 'Daftar perintah', ping: 'Cek bot hidup', owner: 'Kontak owner', remind: 'Pengingat',
  sticker: 'Gambar/video jadi stiker', brat: 'Stiker teks gaya brat', smeme: 'Stiker meme atas/bawah',
  toimg: 'Stiker jadi gambar', tovideo: 'Stiker animasi jadi video', removebg: 'Hapus latar gambar', remini: 'Perjelas foto',
  video: 'Unduh video dari link', mp3: 'Unduh audio dari link', tt: 'Unduh video TikTok', ttmp3: 'Unduh MP3 TikTok',
  ig: 'Unduh video Instagram', play: 'Cari lagu, kirim MP3',
  ai: 'Tanya AI', resetai: 'Hapus ingatan AI', ocr: 'Baca teks dari gambar', translate: 'Terjemahkan teks', ringkas: 'Ringkas pesan/link',
  tagall: 'Mention semua anggota', hidetag: 'Mention tersembunyi', kick: 'Keluarkan anggota', promote: 'Jadikan admin', demote: 'Cabut admin',
  antilink: 'Blokir link grup WA', antispam: 'Cegah spam', antitoxic: 'Cegah kata kasar', welcome: 'Sambutan anggota baru',
  botoff: 'Matikan bot di grup', boton: 'Nyalakan bot di grup', rank: 'Anggota paling aktif', poll: 'Buat voting', vote: 'Beri suara',
  absen: 'Daftar hadir', grup: 'Buka/tutup grup', linkgc: 'Link undangan grup',
  mode: 'Atur bot publik/privat', allow: 'Izinkan nomor (mode privat)',
  quotes: 'Kutipan semangat', fakta: 'Fakta unik', slot: 'Mesin slot', suit: 'Suit lawan bot', jodoh: 'Kecocokan dua nama',
  rate: 'Nilai 0-100 (iseng)', kuis: 'Kuis pengetahuan', tebakangka: 'Tebak angka 1-100', nyerah: 'Menyerah, lihat jawaban', skor: 'Papan skor game',
  cuaca: 'Cuaca + 3 hari', jadwalsholat: 'Jadwal sholat', kurs: 'Kurs mata uang', hitung: 'Kalkulator', qr: 'Buat kode QR', stopwatch: 'Stopwatch',
  suara: 'Suara jadi teks', tts: 'Teks jadi suara',
  afk: 'Tandai kamu AFK', catatan: 'Catatan grup', rules: 'Aturan grup', warn: 'Peringatan anggota', cekwarn: 'Cek peringatan',
  tagadmin: 'Panggil admin', sapa: 'Sapaan otomatis',
  attp: 'Stiker teks warna-warni', stikerwm: 'Ganti nama paket stiker',
  antihapus: 'Teruskan pesan ditarik', antisekali: 'Teruskan media sekali lihat',
  daily: 'Koin harian', saldo: 'Koin, level, XP', judi: 'Taruhan koin', transfer: 'Kirim koin', toko: 'Toko koin',
  stat: 'Statistik bot', broadcast: 'Pesan ke semua grup', ban: 'Blokir nomor', unban: 'Buka blokir', banlist: 'Daftar diblokir',
};

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
export const shortDesc = (c) => SHORT[c.name] || clip(String(c.desc || '').split(/[(.—]/)[0].trim(), 38);

const ICON = { Umum: '✦', Media: '🎨', AI: '🤖', Hiburan: '🎮', Alat: '🧰', Grup: '👥', Owner: '👑' };
const LINE = '──────────────';

/** Kelompokkan command menurut kategori, berurutan; command owner hanya muncul untuk owner. */
export function groupCommands(cmds, { isOwner = false, order = ['Umum', 'Media', 'AI', 'Hiburan', 'Alat', 'Grup'] } = {}) {
  const by = {};
  for (const c of cmds) {
    if (c.owner && !isOwner) continue;
    (by[c.category || 'Umum'] ||= []).push(c);
  }
  const names = [...new Set([...order, ...Object.keys(by)])].filter((n) => by[n]);
  return names.map((name) => ({ name, cmds: by[name] }));
}

export function headerBox({ botName, prefix, name, uptime, total }) {
  return [
    `╭──「 *${botName}* 」`,
    `│ Halo, *${name || 'kamu'}*! 👋`,
    '│',
    `│ ◦ Prefix   : *${prefix}*`,
    `│ ◦ Perintah : *${total}*`,
    `│ ◦ Aktif    : *${uptime}*`,
    `╰${LINE}`,
  ].join('\n');
}

/** Kotak ringkas: hanya nama perintah (muat di caption foto). */
export function compactBox(group, prefix) {
  const names = group.cmds.map((c) => `${prefix}${c.name}`);
  const rows = [];
  let row = '';
  for (const n of names) {
    if ((row + ' ' + n).trim().length > 34) { rows.push(row); row = n; } else row = (row + ' ' + n).trim();
  }
  if (row) rows.push(row);
  return [`╭──「 ${ICON[group.name] || '•'} *${group.name.toUpperCase()}* 」`, ...rows.map((r) => `│ ${r}`), `╰${LINE}`].join('\n');
}

/** Kotak rinci: nama perintah + argumen + keterangan. */
export function detailBox(group, prefix) {
  const lines = [`╭──「 ${ICON[group.name] || '•'} *${group.name.toUpperCase()}* 」`, '│'];
  for (const c of group.cmds) {
    const arg = c.usage ? ` _${c.usage}_` : '';
    lines.push(`│ ▸ *${prefix}${c.name}*${arg}`, `│    ${shortDesc(c)}`);
  }
  lines.push('│', `╰${LINE}`);
  return lines.join('\n');
}

/** .menu: caption foto (ringkas) + teks lanjutan berisi kotak-kotak perintah. */
export function overviewParts(ctx, groups) {
  const total = groups.reduce((n, g) => n + g.cmds.length, 0);
  const caption = [
    headerBox({ ...ctx, total }),
    '',
    ...groups.map((g) => `${ICON[g.name] || '•'} *${g.name}* — ${g.cmds.length} perintah`),
    '',
    `Detail tiap perintah: *${ctx.prefix}menu <kategori>*`,
    `Contoh: *${ctx.prefix}menu ${groups[1]?.name.toLowerCase() || 'media'}*`,
  ].join('\n');
  return { caption, follow: groups.map((g) => compactBox(g, ctx.prefix)).join('\n') };
}

/** Banner foto untuk .menu. */
export function bannerSvg({ botName, prefix, categories }) {
  const W = 1200;
  const H = 520;
  const pills = categories
    .map((c, i) => {
      const w = 40 + c.length * 20;
      const x = 70 + categories.slice(0, i).reduce((a, k) => a + 40 + k.length * 20 + 18, 0);
      return `<rect x="${x}" y="360" width="${w}" height="52" rx="26" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.35"/><text x="${x + w / 2}" y="394" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${esc(c.toUpperCase())}</text>`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${FONT}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F1115"/><stop offset="0.55" stop-color="#1B2250"/><stop offset="1" stop-color="#3B1E6B"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="1040" cy="110" r="190" fill="#7C5CFF" fill-opacity="0.25"/><circle cx="1130" cy="400" r="120" fill="#22D3EE" fill-opacity="0.18"/><circle cx="880" cy="470" r="70" fill="#F472B6" fill-opacity="0.2"/>` +
    `<rect x="70" y="86" width="12" height="190" rx="6" fill="#22D3EE"/>` +
    `<text x="108" y="170" font-size="40" fill="#9AA3B2" letter-spacing="6">MENU</text>` +
    `<text x="108" y="260" font-size="96" font-weight="700" fill="#FFFFFF">${esc(clip(botName, 16))}</text>` +
    `<text x="70" y="330" font-size="26" fill="#C7CDDA">Awali perintah dengan  ${esc(prefix)}   •   ketik ${esc(prefix)}menu &lt;kategori&gt;</text>` +
    pills +
    `</svg>`
  );
}
