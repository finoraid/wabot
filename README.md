# WaBot — Bot WhatsApp (Baileys) untuk Railway

Fitur (Baileys 7.0.0-rc14, mendukung LID): stiker (gambar/video/GIF, teks brat, meme), konversi stiker, downloader (YouTube, TikTok, IG, dll), AI Gemini (tanya, OCR, terjemah, ringkas), hapus latar & perjelas foto, pengingat, serta admin & moderasi grup (antispam, antitoxic, poll, absen, peringkat).

> ⚠️ Bot ini memakai library **tidak resmi** (Baileys). Ada risiko nomor dibatasi/banned oleh WhatsApp. **Pakai nomor cadangan, jangan nomor utama.**
> ⚠️ Baileys butuh koneksi yang menyala terus, jadi **tidak bisa di Vercel** (serverless). Panduan ini untuk **Railway**.

## Perintah

Prefix default `.` (ubah lewat env `PREFIX`).

| Perintah | Fungsi |
|---|---|
| `.menu` `.ping` `.owner` | menu berfoto + teks berkotak; `.menu media` / `ai` / `grup` / `umum` / `semua` untuk penjelasan tiap perintah; cek bot; kontak owner |
| `.sticker` (alias `.s`) | kirim/reply gambar, video ≤10 detik, atau GIF |
| `.brat <teks>` `.smeme atas\|bawah` | stiker teks gaya brat; stiker meme dari gambar |
| `.toimg` `.tovideo` | reply stiker → gambar / video (stiker animasi) |
| `.removebg [stiker]` | hapus latar gambar (model lokal, tanpa API key); hasil PNG transparan |
| `.remini` | perjelas & perbesar foto (AI bila `REPLICATE_API_TOKEN` diisi, kalau tidak penajaman sederhana) |
| `.video <link>` `.mp3 <link>` | unduh video / audio dari link. Urutan: yt-dlp dulu; kalau situsnya tidak didukung, bot membuka halaman di browser (Playwright), memutar video, menangkap URL-nya (mp4/webm/HLS) lalu mengunduhnya |
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
| `.rank` | 10 anggota paling aktif (pesan, level, XP), `.rank reset` (admin) |
| `.daily` `.saldo` `.judi <jumlah\|all>` `.transfer @user <jumlah>` `.toko` | ekonomi virtual: koin harian + streak, dompet/level/XP (`.saldo [@user]`), taruhan (menang x2, jackpot x5), kirim koin (biaya 5%), toko (jimat hoki, booster XP, gelar). XP didapat dari mengobrol di grup, naik level dapat bonus koin |
| `.antihapus on\|owner\|off` | (admin) pesan yang ditarik ("hapus untuk semua") dikirim ulang ke grup atau pribadi ke owner |
| `.antisekali on\|owner\|off` | (admin) foto/video/voice "sekali lihat" diunduh dan dikirim ulang sebagai media biasa |
| `.poll Judul \| A \| B`, `.vote <no>` | pemungutan suara; `.poll hasil`, `.poll selesai` |
| `.absen mulai <judul>`, `.absen` | daftar hadir; `.absen list`, `.absen selesai` |
| `.quotes` `.fakta` `.slot` `.suit` `.jodoh` `.rate` | hiburan ringan (jodoh & rate hanya iseng) |
| `.kuis` `.tebakangka` `.nyerah` `.skor` | game: jawab langsung di chat, skor per grup (`.skor reset` admin) |
| `.cuaca <kota>` | cuaca sekarang + 3 hari (Open-Meteo) |
| `.jadwalsholat <kota>[, negara]` | jadwal sholat hari ini (Aladhan, metode Kemenag untuk Indonesia) |
| `.kurs [jumlah] <dari> [ke]` | kurs mata uang (Frankfurter/ECB, default ke IDR) |
| `.hitung <ekspresi>` `.qr <teks>` `.stopwatch` | kalkulator aman, kode QR, stopwatch |
| `.suara` `.tts <teks>` | pesan suara → teks (reply voice note); teks → pesan suara (Gemini) |
| `.attp <teks>` `.stikerwm Paket \| Pembuat` | stiker teks warna-warni bergerak; ganti nama paket stiker (reply stiker) |
| `.afk [alasan]` | tandai AFK; bot memberi tahu yang men-tag kamu |
| `.catatan` `.rules` | catatan & aturan grup (admin yang mengubah) |
| `.warn @user [alasan]` `.cekwarn` | peringatan anggota, 3x dikeluarkan (admin) |
| `.tagadmin` `.sapa on/off` | panggil admin; sapaan otomatis 06.00 & 21.00 (admin) |
| `.stat` `.broadcast <pesan>` `.ban/.unban/.banlist` (owner) | statistik, pesan ke semua grup (jeda 4 detik/grup), blokir nomor |
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
   - opsional: `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE` (untuk `.tts`), `TIMEZONE` (sapaan, default Asia/Jakarta), `MENU_IMAGE_URL` (foto header `.menu`, tautan https; kosong = banner bawaan), `REPLICATE_API_TOKEN` (`.remini` AI), `TOXIC_WORDS`, `PREFIX`, `BOT_NAME`, `GEMINI_MODEL` (default `gemini-3.6-flash`), `SNIFF` (`0` = matikan cadangan deteksi video via browser)
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
- Tombol (button) asli WhatsApp tidak dipakai: di Baileys butuh tambalan tidak resmi, sering berhenti tampil, dan berisiko untuk nomor. Sebagai gantinya navigasi lewat `.menu <kategori>`.
- `.tts` memakai Gemini TTS (Interactions API). Kalau Google mengganti nama model, ubah `GEMINI_TTS_MODEL`. Gratis di free tier Gemini, tapi data free tier dipakai Google untuk meningkatkan produk.
- `.broadcast` memberi jeda 4 detik antar grup; pesan massal tetap berisiko untuk nomor bot, pakai seperlunya.
- Poll, absen, kuis, AFK hanya di memori (hilang saat bot restart). Catatan, aturan, peringatan, skor, peringkat, statistik, pengingat, dan daftar blokir tersimpan di Volume `/data`.

## Downloader, ekonomi, anti-hapus (v1.2)

- **Downloader** tidak lagi memakai FastSaver. Alurnya mengikuti `botdownloader`: yt-dlp, lalu cadangan deteksi video lewat browser. Cadangan itu memakai `playwright-core` + Chromium (dipasang `Dockerfile`, menambah ±400 MB image dan memori saat dipakai; hanya satu deteksi berjalan sekali waktu). Matikan dengan `SNIFF=0`. Tanpa Chromium, bot tetap jalan dan hanya memakai yt-dlp. Untuk memakai Chromium yang sudah ada: `CHROMIUM_PATH=/path/chrome`. Video yang DRM, butuh login, atau YouTube yang meminta verifikasi tetap tidak bisa diunduh.
- **Ekonomi**: dompet berlaku di semua grup, tersimpan di `settings.json` (Volume `/data`). Satu dompet per ID pengirim; kalau WhatsApp memberi ID berbeda untuk chat pribadi dan grup, dompetnya terpisah.
- **Anti-hapus / anti-sekali-lihat** hanya bekerja di grup, hanya untuk pesan yang masuk saat bot aktif (pesan disimpan di memori maksimal 2 jam, media ≤ 8 MB). Pesan yang dihapus admin dari anggota lain, penghapusan oleh bot sendiri, dan kata kasar/link yang sedang diberantas antitoxic/antilink tidak dikirim ulang ke grup. Beri tahu anggota grup kalau fitur ini aktif, terutama mode `owner`, karena isi pribadi mereka diteruskan.

## Game Hub Multiplayer (v1.3 test)

Fitur tambahan pada `src/commands/socialgames.js`:
- `.gamehub` — menu game grup.
- `.impostor start|join|begin|hint <teks>|vote @orang|end` — social deduction dengan role rahasia lewat DM.
- `.uno start|join|begin|hand|play <kartu>|draw|end` — UNO mini 2–6 pemain.
- `.battle @orang` / `.duel @orang` — duel cepat.
- `.truth` dan `.dare` — party prompts.
- `.ai <pertanyaan>` — tetap memakai fitur Gemini yang sudah ada.

Catatan tes: lobby dan progres game multiplayer saat ini disimpan di memori proses, sehingga akan reset saat Railway restart/deploy. Untuk Impostor dan UNO, pemain perlu membuka chat pribadi bot agar bot bisa mengirim role/kartu. UNO merupakan versi mini berbasis chat; aturan khusus dan efek kartu masih disederhanakan.


## WaBot v1.3 Game Hub

- `.menu` menampilkan kategori dan daftar ringkas seluruh fitur yang terdaftar.
- `.menu semua` menampilkan perintah lengkap beserta deskripsinya.
- `.menu game` menampilkan perintah Game Hub.
- `.gamehub` menampilkan petunjuk permainan multiplayer.
- Game baru: Impostor, UNO, Battle Arena, Truth, dan Dare.
- AI ringan tetap memakai command AI yang sudah ada di project.

Catatan: game aktif disimpan di memori proses dan akan reset jika bot restart. Uji di grup kecil sebelum dipakai ramai-ramai.


## UNO ARENA (website game)

UNO ARENA is integrated into the same HTTP server as WaBot and is available at `/uno/` on the Railway domain. Its Socket.IO game events share the existing HTTP server; no second server or second Railway service is started.

The game frontend is in `public/uno/`, and its game logic is in `src/uno/game.js`. `socket.io` is an added runtime dependency. The Docker image copies `public/` so the game files are included in deployment.

If applying this integration over an existing checkout, remove the old lockfile before committing because the new `socket.io` dependency is intentionally resolved during the Docker build:
`rm package-lock.json`
Then run `npm install --package-lock-only` when internet access is available, or leave the lockfile absent so the Dockerfile uses `npm install`.
