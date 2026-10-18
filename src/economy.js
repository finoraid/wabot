// Ekonomi virtual: koin, XP & level. Murni logika (tanpa WhatsApp) supaya mudah dites.
import { randomInt } from 'node:crypto';
import { getUser, updateUser } from './store.js';

export const DAILY_BASE = 500;
export const STREAK_BONUS = 100; // per hari beruntun, maks 7
export const MIN_BET = 100;
export const MAX_BET = 100_000;
export const BET_COOLDOWN_MS = 8000;
export const TRANSFER_FEE = 0.05; // dibakar (bukan ke siapa-siapa), supaya koin tidak bisa digandakan lewat akun kedua
export const MIN_TRANSFER = 100;
export const XP_COOLDOWN_MS = 45_000;
export const DAY_MS = 86_400_000;

export const fmt = (n) => Number(n).toLocaleString('id-ID');

/** XP total untuk mencapai level n = 100 * n^2. */
export const xpForLevel = (n) => 100 * n * n;
export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100));

export function progress(xp) {
  const lv = levelOf(xp);
  const from = xpForLevel(lv);
  const to = xpForLevel(lv + 1);
  return { level: lv, into: xp - from, need: to - from, pct: Math.min(1, (xp - from) / (to - from)) };
}

export function bar(pct, width = 10) {
  const full = Math.round(pct * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

export const SHOP = [
  { id: 'jimat', name: '🍀 Jimat Hoki', price: 3000, desc: '+7% peluang menang untuk 5 judi berikutnya (bisa ditumpuk)' },
  { id: 'booster', name: '⚡ Booster XP', price: 2500, desc: 'XP x2 selama 1 jam (bisa diperpanjang)' },
  { id: 'juragan', name: '🏪 Gelar Juragan', price: 20_000, desc: 'Gelar tampil di .saldo dan .rank', title: '🏪 Juragan' },
  { id: 'sultan', name: '💎 Gelar Sultan', price: 100_000, desc: 'Gelar tampil di .saldo dan .rank', title: '💎 Sultan' },
  { id: 'raja', name: '👑 Gelar Raja', price: 500_000, desc: 'Gelar tertinggi', title: '👑 Raja' },
];
export const findItem = (q) => {
  const k = String(q || '').toLowerCase().replace(/^\d+$/, (d) => SHOP[Number(d) - 1]?.id || d);
  return SHOP.find((i) => i.id === k || i.name.toLowerCase().includes(k)) || null;
};

/** "1500", "1.5k", "2jt", "all" -> angka (atau null kalau tidak valid). */
export function parseAmount(raw, balance = 0) {
  const t = String(raw || '').toLowerCase().replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.').trim();
  if (['all', 'semua', 'allin'].includes(t)) return balance;
  const m = t.match(/^(\d+(?:\.\d+)?)(k|rb|jt|m)?$/);
  if (!m) return null;
  const mult = { k: 1e3, rb: 1e3, jt: 1e6, m: 1e6 }[m[2]] || 1;
  const n = Math.floor(Number(m[1]) * mult);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** XP dari mengobrol (ada jeda per orang). Mengembalikan { gained, leveledUp, level } atau null. */
export function addChatXp(id, now = Date.now()) {
  const u = getUser(id);
  if (now - u.lastXp < XP_COOLDOWN_MS) return null;
  return updateUser(id, (x) => {
    const before = levelOf(x.xp);
    const gained = randomInt(8, 21) * (x.boostUntil > now ? 2 : 1);
    x.xp += gained;
    x.lastXp = now;
    const after = levelOf(x.xp);
    let bonus = 0;
    for (let l = before + 1; l <= after; l++) bonus += l * 200; // hadiah naik level
    x.bal += bonus;
    return { gained, leveledUp: after > before, level: after, bonus };
  });
}

export function claimDaily(id, now = Date.now()) {
  const u = getUser(id);
  const wait = u.lastDaily + DAY_MS - now;
  if (wait > 0) return { ok: false, wait };
  return updateUser(id, (x) => {
    x.streak = x.lastDaily && now - x.lastDaily < 2 * DAY_MS ? x.streak + 1 : 1;
    const bonus = Math.min(x.streak - 1, 7) * STREAK_BONUS;
    const reward = DAILY_BASE + bonus;
    const xp = 20 * (x.boostUntil > now ? 2 : 1);
    x.bal += reward;
    x.xp += xp;
    x.lastDaily = now;
    return { ok: true, reward, bonus, xp, streak: x.streak, bal: x.bal };
  });
}

/** Satu putaran judi. Peluang: 2% jackpot x5, 43% menang x2, sisanya kalah (harapan sedikit negatif). */
export function gamble(id, amount, now = Date.now(), roll = () => randomInt(0, 100)) {
  const u = getUser(id);
  if (now - u.lastBet < BET_COOLDOWN_MS) return { ok: false, reason: 'cooldown', wait: BET_COOLDOWN_MS - (now - u.lastBet) };
  if (amount < MIN_BET) return { ok: false, reason: 'min' };
  if (amount > MAX_BET) return { ok: false, reason: 'max' };
  if (amount > u.bal) return { ok: false, reason: 'saldo', bal: u.bal };
  return updateUser(id, (x) => {
    const charmed = x.charm > 0;
    if (charmed) x.charm--;
    const r = roll();
    const winLine = 2 + 43 + (charmed ? 7 : 0);
    let outcome = 'lose';
    if (r < 2) outcome = 'jackpot';
    else if (r < winLine) outcome = 'win';
    const net = outcome === 'jackpot' ? amount * 4 : outcome === 'win' ? amount : -amount;
    x.bal += net;
    x.lastBet = now;
    return { ok: true, outcome, net, bal: x.bal, charmed, charmLeft: x.charm };
  });
}

export function transfer(fromId, toId, amount) {
  if (fromId === toId) return { ok: false, reason: 'self' };
  if (amount < MIN_TRANSFER) return { ok: false, reason: 'min' };
  const fee = Math.ceil(amount * TRANSFER_FEE);
  const total = amount + fee;
  if (getUser(fromId).bal < total) return { ok: false, reason: 'saldo', need: total, bal: getUser(fromId).bal };
  updateUser(fromId, (x) => void (x.bal -= total));
  updateUser(toId, (x) => void (x.bal += amount));
  return { ok: true, fee, total, bal: getUser(fromId).bal };
}

export function buy(id, item, qty = 1, now = Date.now()) {
  const total = item.price * qty;
  const u = getUser(id);
  if (item.title && qty !== 1) return { ok: false, reason: 'qty' };
  if (item.title && u.title === item.title) return { ok: false, reason: 'owned' };
  if (u.bal < total) return { ok: false, reason: 'saldo', total, bal: u.bal };
  return updateUser(id, (x) => {
    x.bal -= total;
    if (item.id === 'jimat') x.charm += 5 * qty;
    else if (item.id === 'booster') x.boostUntil = Math.max(x.boostUntil, now) + 3_600_000 * qty;
    else if (item.title) x.title = item.title;
    return { ok: true, total, bal: x.bal };
  });
}
