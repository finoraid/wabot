# WaBot — Bot WhatsApp (Baileys) untuk Railway

Fitur (Baileys 7.0.0-rc14, mendukung LID): stiker (gambar/video/GIF, teks brat, meme), konversi stiker, downloader (YouTube, TikTok, IG, dll), AI Gemini (tanya, OCR, terjemah, ringkas), hapus latar & perjelas foto, pengingat, serta admin & moderasi grup (antispam, antitoxic, poll, absen, peringkat).

> ⚠️ Bot ini memakai library **tidak resmi** (Baileys). Ada risiko nomor dibatasi/banned oleh WhatsApp. **Pakai nomor cadangan, jangan nomor utama.**
> ⚠️ Baileys butuh koneksi yang menyala terus, jadi **tidak bisa di Vercel** (serverless). Panduan ini untuk **Railway**.

## Perintah

Prefix default `.` (ubah lewat env `PREFIX`).

| Perintah | Fungsi |
|---|---|
| `.menu` `.ping` `.owner` | daftar perintah, cek bot, kontak owner |
| `.sticker` (alias `.s`) | kirim/reply gambar, video ≤10 detik, atau GIF |
| `.brat <teks>` `.smeme atas\|bawah` | stiker teks gaya brat; stiker meme dari gambar |
| `.toimg` `.tovideo` | reply stiker → gambar / video (stiker animasi) |
| `.removebg [stiker]` | hapus latar gambar (model lokal, tanpa API key); hasil PNG transparan |
| `.remini` | perjelas & perbesar foto (AI bila `REPLICATE_API_TOKEN` diisi, kalau tidak penajaman sederhana) |
| `.video <link>` `.mp3 <link>` | unduh video / audio dari link |
| `.tt` `.ttmp3` `.ig` | pintasan TikTok (video / MP3) dan Instagram |
| `.play <judul>` | cari lagu di YouTube, kirim MP3 |
| `.ai <pertanyaan>` | tanya Gemini (bisa kirim/reply gambar), `.resetai` hapus ingatan |
| `.ocr` | baca teks dari gambar |
| `.translate <bahasa> <teks>` (`.tr`) | terjemahkan teks atau pesan yang di-reply |
| `.ringkas <link>` | ringkas pesan yang di-reply atau isi artikel dari tautan |
| `.remind <waktu> <pesan>` | pengingat (`10m`, `2j`, `1h30m`; maks 7 hari), `.remind list`, `.remind batal <no>` |
| `.tagall` `.hidetag` | mention semua anggota (admin) |
| `.kick` `.promote` `.demote` | kelola anggota, tag orang atau reply pesannya (admin, bot harus admin) |
| `.antilink on/off` | hapus pesan + kick pengirim link grup WhatsApp |
| `.antispam on/off` | peringatkan pengirim 7 pesan dalam 8 detik; 3x peringatan → kick (admin dikecualikan) |
| `.antitoxic on/off` | hapus kata kasar + peringatan; 3x → kick. Tambah kata lewat env `TOXIC_WORDS` |
| `.welcome on/off` | sambutan anggota baru / keluar |
| `.botoff` `.boton` | matikan/nyalakan bot untuk anggota biasa di grup (admin tetap bisa) |
| `.rank` | 10 anggota paling aktif (hitung pesan sejak bot aktif), `.rank reset` (admin) |
| `.poll Judul \| A \| B`, `.vote <no>` | pemungutan suara; `.poll hasil`, `.poll selesai` |
| `.absen mulai <judul>`, `.absen` | daftar hadir; `.absen list`, `.absen selesai` |
| `.grup buka/tutup` `.linkgc` | atur chat grup, ambil link undangan |
| `.mode public/private` (owner) | mode privat: hanya owner & nomor yang diizinkan |
| `.allow add/del/list <nomor>` (owner) | kelola nomor yang diizinkan saat mode privat |

Data yang bertahan setelah restart (di Volume `/data`): pengaturan grup, mode, daftar izin, pengingat, dan peringkat. Poll dan absen hanya di memori.

Menambah perintah baru: buat file di `src/commands/` yang mengekspor `{ name, aliases, category, desc, run(ctx) }`. Otomatis muncul di `.menu`.

## Deploy ke Railway

1. **Buat repo GitHub** dan upload isi folder ini (tanpa `node_modules` dan `.env`, sudah diatur di `.gitignore`).
2. Di [railway.com](https://railway.com): **New Project → Deploy from GitHub repo**, pilih repo-nya. Railway otomatis memakai `Dockerfile` (lihat `railway.json`).
3. **Pasang Volume** (wajib, kalau tidak sesi login hilang tiap deploy): buka service → **Settings → Volumes → Add Volume**, mount path `/data`.
4. Buka tab **Variables**, isi:
   - `LOGIN_MODE` = `qr` (default; lihat bagian "Login")
   - `QR_KEY` — string acak panjang (≥ 20 karakter), kunci halaman `/qr`
   - `OWNER_NUMBERS` — nomor owner (boleh beberapa, pisah koma)
   - `GEMINI_API_KEY` — dari [Google AI Studio](https://aistudio.google.com/apikey)
   - `DATA_DIR` = `/data`
   - opsional: `REPLICATE_API_TOKEN` (`.remini` AI), `TOXIC_WORDS`, `PREFIX`, `BOT_NAME`, `GEMINI_MODEL` (default `gemini-3.6-flash`), `FASTSAVER_KEY` (downloader lebih andal untuk YouTube; yt-dlp jadi cadangan)
5. Deploy. Buka `https://<domain-railway-kamu>/qr?key=<QR_KEY>` di browser.
6. Di HP nomor bot: **WhatsApp → Perangkat tertaut → Tautkan perangkat**, scan QR di halaman itu.
7. Halaman berubah jadi **"Sudah terhubung"** dan log menampilkan `✅ Terhubung`. Kirim `.menu` ke nomor bot.

Setelah tertaut, sesi tersimpan di Volume. Bot tidak minta pairing lagi saat restart atau deploy ulang.

Railway berbayar berbasis pemakaian dan paket gratisnya terbatas; cek halaman harga Railway saat ini sebelum memakai untuk jangka panjang. Jangan jalankan lebih dari satu replika dengan sesi yang sama.

## Login (QR atau pairing code)

Sejak akhir Juli 2026 WhatsApp mengubah alur penautan perangkat dan Baileys belum merilis perbaikannya
([Baileys#2737](https://github.com/WhiskeySockets/Baileys/issues/2737), PR #2765 masih open). Karena itu:

- **`LOGIN_MODE=qr` (default)**: QR tampil sebagai gambar di `/qr?key=<QR_KEY>` (bukan teks di log, karena log Railway merusak QR).
  Halaman refresh otomatis dan berubah jadi "Sudah terhubung" setelah tertaut. Tanpa `QR_KEY`, halaman `/qr` mati.
- **`LOGIN_MODE=code`**: pairing code di log (butuh `PAIRING_NUMBER`). Per laporan upstream, jalur ini **mungkin masih gagal**
  walau QR sudah diperbaiki (server menolak permintaan kode di tahap awal). Pakai hanya kalau QR tidak bisa.

`src/companionRefresh.js` meniru logika PR #2765 di level aplikasi (tanpa patch-package, tanpa mengubah `node_modules`):
saat server mengirim `companion_reg_refresh` ke bot yang belum tertaut, bot membuat adv secret baru (32 byte acak),
menyimpannya, dan QR di layar diganti dengan secret baru tanpa menghabiskan ref. Sesi yang sudah tertaut tidak disentuh.
Hapus file ini dan pemanggilnya di `src/index.js` begitu Baileys merilis perbaikan resminya.

> Keamanan: halaman `/qr` memberi akses login ke nomor bot. Pakai `QR_KEY` yang panjang dan acak, jangan dibagikan,
> dan ganti setelah tertaut. Jangan pasang fork Baileys pihak ketiga yang tidak kamu review (sudah ada paket tiruan
> berbahaya bernama mirip, misalnya `@viertechjs/baileys`); pakai hanya `@whiskeysockets/baileys`.

## Lockfile

Repo ini dikirim **tanpa `package-lock.json`** (tidak bisa dibuat tanpa akses npm). Dockerfile otomatis memakai
`npm install` kalau lockfile tidak ada dan `npm ci` kalau ada. Untuk build yang bisa diulang persis, buat lockfile
sekali dengan `npm install --package-lock-only` lalu commit.

## Jalankan lokal / Termux (untuk tes)

```bash
pkg install nodejs git ffmpeg python -y        # Termux
pip install -U "yt-dlp[default]"
npm install
cp .env.example .env                           # lalu isi
npm start
```

Tes mandiri tanpa WhatsApp: `npm run check` (tidak menguji koneksi/pairing asli ke server WhatsApp).

## Troubleshooting

- **`/qr` bilang "QR_KEY belum diset"**: isi `QR_KEY` di Variables lalu redeploy.
- **`/qr` bilang "Key salah"**: key di URL harus persis sama dengan `QR_KEY`.
- **QR muncul tapi HP bilang gagal tautkan**: lihat log, harus ada baris `companion_reg_refresh diterima`. Kalau tidak ada, laporkan ke developer beserta log.
- **Tidak muncul kode pairing**: hanya untuk `LOGIN_MODE=code`; pastikan `PAIRING_NUMBER` diisi angka saja.
- **Setiap deploy minta pairing lagi**: Volume belum dipasang atau `DATA_DIR` bukan `/data`.
- **Log "Sesi di-logout"**: perangkat dihapus dari HP. Bot menghapus sesi lama dan menampilkan QR baru.
- **Log "connection replaced"**: sesi yang sama aktif di tempat lain (misalnya masih jalan di Termux). Matikan salah satunya.
- **YouTube: "meminta verifikasi login"**: IP datacenter sering dicurigai YouTube. Situs lain (TikTok, IG, dll) biasanya aman. Untuk YouTube, ekspor `cookies.txt` dari browser, taruh di Volume (mis. `/data/cookies.txt`), lalu set `YTDLP_COOKIES=/data/cookies.txt`. Cookies setara akses akun, jadi pakai akun cadangan dan jangan commit ke GitHub.
- **Perintah admin tidak jalan**: bot harus dijadikan admin grup.
- **AI "API key ditolak"**: cek `GEMINI_API_KEY` dan `GEMINI_MODEL`.
- **File besar**: video ≤16 MB dikirim sebagai video, di atasnya sebagai dokumen sampai `MAX_MEDIA_MB` (default 64).

## Catatan keamanan

- Link yang diunduh divalidasi: alamat lokal/privat ditolak. Ini perlindungan dasar, bukan jaminan penuh.
- Satu unduhan per pengguna, maksimal `MAX_DOWNLOADS` bersamaan (default 2), dan cooldown 2 detik per pengguna.
- Jangan commit `.env`, `data/`, atau `cookies.txt`.


## Catatan fitur baru

- `.removebg` memakai paket `@imgly/background-removal-node` (opsional, terpasang otomatis). Pemakaian memori cukup besar saat memproses (sekitar beberapa ratus MB) dan pemakaian pertama bisa lambat. Kalau paket gagal terpasang, bot tetap jalan dan `.removebg` membalas pesan error.
- `.remini` dengan `REPLICATE_API_TOKEN` memanggil model `nightmareai/real-esrgan` di Replicate (berbayar per pemakaian). Kalau gagal, bot jatuh ke mode lokal.
- `.brat`/`.smeme` butuh font di server; `Dockerfile` sudah memasang `fonts-dejavu-core` (emoji tidak tampil di stiker teks).
- Jalankan `npm run check` untuk tes mandiri (tanpa koneksi WhatsApp).
