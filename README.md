# WaBot — Bot WhatsApp (Baileys) untuk Railway

Fitur (Baileys 7.0.0-rc14, mendukung LID): stiker (gambar/video/GIF), downloader (YouTube, TikTok, IG, dll lewat yt-dlp), AI Gemini, dan admin grup (tagall, hidetag, kick, promote/demote, antilink, welcome, buka/tutup grup, link grup).

> ⚠️ Bot ini memakai library **tidak resmi** (Baileys). Ada risiko nomor dibatasi/banned oleh WhatsApp. **Pakai nomor cadangan, jangan nomor utama.**
> ⚠️ Baileys butuh koneksi yang menyala terus, jadi **tidak bisa di Vercel** (serverless). Panduan ini untuk **Railway**.

## Perintah

Prefix default `.` (ubah lewat env `PREFIX`).

| Perintah | Fungsi |
|---|---|
| `.menu` `.ping` | daftar perintah, cek bot |
| `.sticker` (alias `.s`) | kirim/reply gambar, video ≤10 detik, atau GIF |
| `.video <link>` `.mp3 <link>` | unduh video / audio dari link |
| `.play <judul>` | cari lagu di YouTube, kirim MP3 |
| `.ai <pertanyaan>` | tanya Gemini (bisa kirim/reply gambar), `.resetai` hapus ingatan |
| `.tagall` `.hidetag` | mention semua anggota (admin) |
| `.kick` `.promote` `.demote` | kelola anggota, tag orang atau reply pesannya (admin, bot harus admin) |
| `.antilink on/off` | hapus pesan + kick pengirim link grup WhatsApp |
| `.welcome on/off` | sambutan anggota baru / keluar |
| `.grup buka/tutup` `.linkgc` | atur chat grup, ambil link undangan |

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
   - opsional: `PREFIX`, `BOT_NAME`, `GEMINI_MODEL` (default `gemini-3.6-flash`), `FASTSAVER_KEY` (downloader lebih andal untuk YouTube; yt-dlp jadi cadangan)
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
