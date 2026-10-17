// Logika antispam & antitoxic (murni, tanpa WhatsApp) supaya mudah dites.

const FLOOD_COUNT = 7; // pesan
const FLOOD_WINDOW_MS = 8000; // dalam 8 detik
const STRIKE_TTL_MS = 30 * 60 * 1000; // peringatan hangus setelah 30 menit
export const MAX_STRIKES = 3;

const BASE_WORDS = [
  'anjing', 'anjir', 'anjink', 'bangsat', 'bajingan', 'kontol', 'memek', 'ngentot', 'jancok', 'jancuk',
  'asu', 'goblok', 'tolol', 'babi', 'kampret', 'brengsek', 'pantek', 'bgst', 'kntl', 'mmk',
];

const collapse = (s) => s.replace(/(.)\1+/g, '$1'); // "anjiiing" -> "anjing"

function buildSet() {
  const extra = String(process.env.TOXIC_WORDS || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  return new Set([...BASE_WORDS, ...extra].map(collapse));
}
const toxic = buildSet();

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

/** True kalau teks memuat kata kasar utuh (bukan potongan kata, jadi "asuransi" aman). */
export function isToxic(text) {
  const norm = String(text || '').toLowerCase().replace(/[01345 7@$!]/g, (c) => (c === ' ' ? ' ' : LEET[c] ?? c));
  for (const token of norm.split(/[^a-z]+/)) {
    if (token && toxic.has(collapse(token))) return true;
  }
  return false;
}

const times = new Map(); // "grup|pengirim" -> [timestamp]
export function isFlood(key, now = Date.now()) {
  const arr = (times.get(key) || []).filter((t) => now - t < FLOOD_WINDOW_MS);
  arr.push(now);
  if (arr.length >= FLOOD_COUNT) {
    times.delete(key);
    return true;
  }
  times.set(key, arr);
  if (times.size > 5000) times.clear();
  return false;
}

const strikes = new Map(); // "grup|pengirim" -> { n, ts }
export function addStrike(key, now = Date.now()) {
  const s = strikes.get(key);
  const n = s && now - s.ts < STRIKE_TTL_MS ? s.n + 1 : 1;
  strikes.set(key, { n, ts: now });
  if (strikes.size > 5000) strikes.clear();
  return n;
}
export const clearStrikes = (key) => strikes.delete(key);

/** Hanya untuk tes. */
export const _reset = () => {
  times.clear();
  strikes.clear();
};
