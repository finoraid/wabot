import { num } from './utils.js';
import { formatDuration } from './reminders.js';

/** nomor utama -> { ids:Set<string>, reason, since }  (hanya di memori) */
const afk = new Map();

export function setAfk(senderIds, reason) {
  const ids = new Set(senderIds);
  const key = [...ids][0];
  afk.set(key, { ids, reason: String(reason || '').slice(0, 100), since: Date.now() });
  if (afk.size > 2000) afk.delete(afk.keys().next().value);
}

const findEntry = (id) => {
  for (const [key, e] of afk) if (e.ids.has(id)) return [key, e];
  return null;
};

/**
 * Dipanggil untuk tiap pesan grup. Mengembalikan daftar pesan yang perlu dikirim:
 * - pengirim yang sedang AFK dianggap kembali
 * - orang yang di-mention/di-reply dan sedang AFK diberi tahu
 */
export function checkAfk({ senderIds, senderJid = '', mentioned = [], quotedSender = null, isAfkCommand = false, now = Date.now() }) {
  const out = [];
  if (!isAfkCommand) {
    for (const id of senderIds) {
      const hit = findEntry(id);
      if (hit) {
        afk.delete(hit[0]);
        out.push({ text: `👋 Selamat datang kembali, @${num(senderJid)}! Kamu AFK selama ${formatDuration(Math.max(1, Math.round((now - hit[1].since) / 1000)))}.`, mentions: senderJid ? [senderJid] : [] });
        break;
      }
    }
  }
  const seen = new Set();
  for (const j of [...mentioned, quotedSender].filter(Boolean)) {
    const hit = findEntry(num(j));
    if (!hit || seen.has(hit[0]) || senderIds.has(hit[0])) continue;
    seen.add(hit[0]);
    const e = hit[1];
    out.push({ text: `💤 @${num(j)} sedang AFK${e.reason ? `: ${e.reason}` : ''} (${formatDuration(Math.max(1, Math.round((now - e.since) / 1000)))} lalu).`, mentions: [j] });
  }
  return out;
}

export const _reset = () => afk.clear();
