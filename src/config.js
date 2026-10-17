import 'dotenv/config';
import path from 'node:path';

const digits = (s) => String(s || '').replace(/\D/g, '');
const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  botName: process.env.BOT_NAME || 'WaBot',
  prefix: process.env.PREFIX || '.',
  // Nomor owner, pisahkan dengan koma, format internasional tanpa + (contoh: 628123456789)
  owners: (process.env.OWNER_NUMBERS || '').split(',').map(digits).filter(Boolean),
  // Cara login: 'qr' (halaman web /qr?key=QR_KEY, default) atau 'code' (pairing code di log, butuh PAIRING_NUMBER).
  loginMode: String(process.env.LOGIN_MODE || 'qr').toLowerCase() === 'code' ? 'code' : 'qr',
  pairingNumber: digits(process.env.PAIRING_NUMBER),
  // Kunci akses halaman /qr. Kosong = halaman QR dimatikan.
  qrKey: process.env.QR_KEY || '',

  dataDir: path.resolve(process.env.DATA_DIR || './data'),

  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',

  // Opsional: kunci FastSaver (https://fastsaver.io). Kalau diisi, .video/.mp3 memakai FastSaver dulu, yt-dlp jadi cadangan.
  fastsaverKey: process.env.FASTSAVER_KEY || '',

  ytdlpBin: process.env.YTDLP_BIN || 'yt-dlp',
  ytCookies: process.env.YTDLP_COOKIES || '', // path file cookies.txt (opsional)
  maxMediaMB: int(process.env.MAX_MEDIA_MB, 64),
  maxDownloads: int(process.env.MAX_DOWNLOADS, 2),

  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'warn',
};

config.sessionDir = path.join(config.dataDir, 'session');
config.settingsFile = path.join(config.dataDir, 'settings.json');
