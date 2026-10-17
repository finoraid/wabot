# WaBot — Bot WhatsApp (Baileys) untuk Railway

Fitur: stiker (gambar/video/GIF), downloader (YouTube, TikTok, IG, dll lewat yt-dlp), AI Gemini, dan admin grup (tagall, hidetag, kick, promote/demote, antilink, welcome, buka/tutup grup, link grup).

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
   - `PAIRING_NUMBER` — nomor WhatsApp **bot** (contoh `628123456789`, tanpa `+`)
   - `OWNER_NUMBERS` — nomor owner (boleh beberapa, pisah koma)
   - `GEMINI_API_KEY` — dari [Google AI Studio](https://aistudio.google.com/apikey)
   - `DATA_DIR` = `/data`
   - opsional: `PREFIX`, `BOT_NAME`, `GEMINI_MODEL`
5. Deploy. Buka tab **Logs**, tunggu tulisan **KODE PAIRING: XXXX-XXXX**.
6. Di HP nomor bot: **WhatsApp → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon**, masukkan kodenya.
7. Log akan menampilkan `✅ Terhubung`. Kirim `.menu` ke nomor bot.

Setelah tertaut, sesi tersimpan di Volume. Bot tidak minta pairing lagi saat restart atau deploy ulang.

Railway berbayar berbasis pemakaian dan paket gratisnya terbatas; cek halaman harga Railway saat ini sebelum memakai untuk jangka panjang. Jangan jalankan lebih dari satu replika dengan sesi yang sama.

## Jalankan lokal / Termux (untuk tes)

```bash
pkg install nodejs git ffmpeg python -y        # Termux
pip install -U "yt-dlp[default]"
npm install
cp .env.example .env                           # lalu isi
npm start
```

Tes mandiri tanpa WhatsApp: `npm run check`.

## Troubleshooting

- **Tidak muncul kode pairing**: pastikan `PAIRING_NUMBER` diisi angka saja. Kalau kosong, bot menampilkan QR di log.
- **Setiap deploy minta pairing lagi**: Volume belum dipasang atau `DATA_DIR` bukan `/data`.
- **Log "Sesi di-logout"**: perangkat dihapus dari HP. Bot menghapus sesi lama dan meminta pairing baru.
- **Log "connection replaced"**: sesi yang sama aktif di tempat lain (misalnya masih jalan di Termux). Matikan salah satunya.
- **YouTube: "meminta verifikasi login"**: IP datacenter sering dicurigai YouTube. Situs lain (TikTok, IG, dll) biasanya aman. Untuk YouTube, ekspor `cookies.txt` dari browser, taruh di Volume (mis. `/data/cookies.txt`), lalu set `YTDLP_COOKIES=/data/cookies.txt`. Cookies setara akses akun, jadi pakai akun cadangan dan jangan commit ke GitHub.
- **Perintah admin tidak jalan**: bot harus dijadikan admin grup.
- **AI "API key ditolak"**: cek `GEMINI_API_KEY` dan `GEMINI_MODEL`.
- **File besar**: video ≤16 MB dikirim sebagai video, di atasnya sebagai dokumen sampai `MAX_MEDIA_MB` (default 64).

## Catatan keamanan

- Link yang diunduh divalidasi: alamat lokal/privat ditolak. Ini perlindungan dasar, bukan jaminan penuh.
- Satu unduhan per pengguna, maksimal `MAX_DOWNLOADS` bersamaan (default 2), dan cooldown 2 detik per pengguna.
- Jangan commit `.env`, `data/`, atau `cookies.txt`.
