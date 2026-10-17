import { getReminders, removeReminders } from './store.js';

const UNITS = { s: 1, dtk: 1, detik: 1, m: 60, mnt: 60, menit: 60, j: 3600, h: 3600, jam: 3600, d: 86400, hr: 86400, hari: 86400 };
export const MAX_SECONDS = 7 * 86400;
export const MIN_SECONDS = 10;
export const MAX_PER_USER = 20;

/** "10m", "2j", "1h30m", "1 jam" -> detik; null kalau tidak valid. */
export function parseDuration(input) {
  const s = String(input || '').toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const re = /(\d+)([a-z]+)/g;
  let total = 0;
  let consumed = 0;
  for (const m of s.matchAll(re)) {
    const unit = UNITS[m[2]];
    if (!unit) return null;
    total += Number(m[1]) * unit;
    consumed += m[0].length;
  }
  return consumed === s.length && total > 0 ? total : null;
}

export function formatDuration(sec) {
  const parts = [];
  for (const [label, size] of [['hari', 86400], ['jam', 3600], ['menit', 60], ['detik', 1]]) {
    const n = Math.floor(sec / size);
    if (n) { parts.push(`${n} ${label}`); sec -= n * size; }
  }
  return parts.join(' ') || '0 detik';
}

let timer = null;
let sending = false;

/** Cek pengingat jatuh tempo tiap 15 detik dan kirim. Aman dipanggil ulang saat reconnect. */
export function startReminders(sock, log = console.log) {
  if (timer) clearInterval(timer);
  const tick = async () => {
    if (sending) return;
    sending = true;
    try {
      const now = Date.now();
      const due = getReminders().filter((r) => r.at <= now);
      for (const r of due) {
        try {
          await sock.sendMessage(r.jid, { text: `⏰ *Pengingat* untuk @${String(r.who).split('@')[0].split(':')[0]}:\n${r.text}`, mentions: [r.who] });
          removeReminders((x) => x.id === r.id);
        } catch (e) {
          // gagal kirim (mis. koneksi putus): coba lagi, tapi buang kalau sudah telat lebih dari 1 jam
          if (now - r.at > 3600_000) removeReminders((x) => x.id === r.id);
          log('[remind] gagal kirim:', e.message);
        }
      }
    } finally {
      sending = false;
    }
  };
  timer = setInterval(tick, 15_000);
  timer.unref?.();
  tick();
}
