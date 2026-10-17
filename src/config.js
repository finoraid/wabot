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
  // Isi untuk login lewat pairing code. Kosongkan untuk login lewat QR di log.
  pairingNumber: digits(process.env.PAIRING_NUMBER),

  dataDir: path.resolve(process.env.DATA_DIR || './data'),

  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  ytdlpBin: process.env.YTDLP_BIN || 'yt-dlp',
  ytCookies: process.env.YTDLP_COOKIES || '', // path file cookies.txt (opsional)
  maxMediaMB: int(process.env.MAX_MEDIA_MB, 64),
  maxDownloads: int(process.env.MAX_DOWNLOADS, 2),

  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'warn',
};

config.sessionDir = path.join(config.dataDir, 'session');
config.settingsFile = path.join(config.dataDir, 'settings.json');
