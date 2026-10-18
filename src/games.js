import { addScore } from './store.js';
import { TRIVIA } from './data/trivia.js';

const KUIS_SECONDS = 45;
const ANGKA_MAX_TRIES = 7;

/** jid chat -> permainan yang sedang berjalan */
const games = new Map();

/** Huruf kecil, tanpa tanda baca & spasi ganda, supaya "Tokyo!" sama dengan "tokyo". */
export const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export const getGame = (jid) => games.get(jid) || null;
export const stopGame = (jid) => games.delete(jid);

export function startKuis(jid, rnd = Math.random) {
  const item = TRIVIA[Math.floor(rnd() * TRIVIA.length)];
  const g = { type: 'kuis', q: item.q, answers: item.a.map(normalize), shown: item.a[0], until: Date.now() + KUIS_SECONDS * 1000, id: Math.random() };
  games.set(jid, g);
  return g;
}

export function startAngka(jid, rnd = Math.random) {
  const g = { type: 'angka', target: 1 + Math.floor(rnd() * 100), tries: 0, lo: 1, hi: 100, id: Math.random() };
  games.set(jid, g);
  return g;
}

/**
 * Dipanggil untuk pesan non-perintah. Mengembalikan { text, mentions } kalau pesan ini menjawab permainan, selain itu null.
 * isGroup menentukan apakah skor dicatat.
 */
export function handleGameMessage({ jid, who, body, isGroup, now = Date.now() }) {
  const g = games.get(jid);
  if (!g) return null;
  if (g.type === 'kuis') {
    if (now > g.until) { games.delete(jid); return null; }
    if (!g.answers.includes(normalize(body))) return null;
    games.delete(jid);
    const pts = isGroup ? addScore(jid, who, 1) : null;
    return { text: `✅ @${String(who).split('@')[0].split(':')[0]} benar! Jawabannya *${g.shown}*.${pts ? `\nSkor kamu: ${pts}` : ''}`, mentions: [who] };
  }
  if (g.type === 'angka') {
    const m = String(body).trim().match(/^\d{1,3}$/);
    if (!m) return null;
    const n = Number(m[0]);
    if (n < 1 || n > 100) return null;
    g.tries++;
    const tag = `@${String(who).split('@')[0].split(':')[0]}`;
    if (n === g.target) {
      games.delete(jid);
      const pts = isGroup ? addScore(jid, who, 2) : null;
      return { text: `🎉 ${tag} menebak angka *${n}* dengan benar dalam ${g.tries} percobaan!${pts ? `\n+2 poin (total ${pts})` : ''}`, mentions: [who] };
    }
    if (g.tries >= ANGKA_MAX_TRIES) {
      games.delete(jid);
      return { text: `😅 Kesempatan habis. Angkanya adalah *${g.target}*.`, mentions: [] };
    }
    if (n < g.target) g.lo = Math.max(g.lo, n + 1); else g.hi = Math.min(g.hi, n - 1);
    return { text: `${n < g.target ? '⬆️ Terlalu kecil' : '⬇️ Terlalu besar'}. Rentang: ${g.lo}-${g.hi}. Sisa ${ANGKA_MAX_TRIES - g.tries} kesempatan.`, mentions: [] };
  }
  return null;
}
export const KUIS_TIME = KUIS_SECONDS;
export const ANGKA_TRIES = ANGKA_MAX_TRIES;
