import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Penyimpanan pengaturan per-grup sederhana (JSON) di DATA_DIR.
let data = { groups: {}, global: {}, reminders: [], rank: {}, scores: {}, eco: {}, stats: { since: Date.now(), cmds: {}, users: {} } };

try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(config.settingsFile)) {
    const parsed = JSON.parse(fs.readFileSync(config.settingsFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.groups) data = { ...data, ...parsed };
  }
} catch (e) {
  console.error('[store] gagal membaca settings.json, mulai dari kosong:', e.message);
}

let timer = null;
function scheduleSave() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      const tmp = config.settingsFile + '.tmp';
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, config.settingsFile);
    } catch (e) {
      console.error('[store] gagal menyimpan settings:', e.message);
    }
  }, 500);
}

const defaults = () => ({ antilink: false, welcome: false, antispam: false, antitoxic: false, muted: false, sapa: false, rules: '', notes: {}, warns: {}, antihapus: '', antisekali: '' });

export function getGroup(jid) {
  return { ...defaults(), ...(data.groups[jid] || {}) };
}

export const allGroups = () => Object.entries(data.groups).map(([jid, g]) => [jid, { ...defaults(), ...g }]);

export function updateGroup(jid, patch) {
  data.groups[jid] = { ...getGroup(jid), ...patch };
  scheduleSave();
  return data.groups[jid];
}

// ---- pengaturan global bot: mode publik/privat + daftar nomor yang diizinkan ----
const globalDefaults = () => ({ mode: 'public', allowed: [], banned: [] });

export function getGlobal() {
  return { ...globalDefaults(), ...(data.global || {}) };
}

export function updateGlobal(patch) {
  data.global = { ...getGlobal(), ...patch };
  scheduleSave();
  return data.global;
}

// ---- pengingat (.remind) ----
export const getReminders = () => data.reminders;

export function addReminder(r) {
  data.reminders.push(r);
  scheduleSave();
}

export function removeReminders(pred) {
  const before = data.reminders.length;
  data.reminders = data.reminders.filter((r) => !pred(r));
  if (data.reminders.length !== before) scheduleSave();
  return before - data.reminders.length;
}

// ---- peringkat keaktifan anggota grup (.rank): jumlah pesan per orang ----
export function countMessage(groupJid, who) {
  const g = (data.rank[groupJid] ||= {});
  g[who] = (g[who] || 0) + 1;
  scheduleSave();
}

export const getRank = (groupJid) => data.rank[groupJid] || {};

export function resetRank(groupJid) {
  delete data.rank[groupJid];
  scheduleSave();
}

// ---- skor game grup (.kuis, .tebakangka) ----
export function addScore(groupJid, who, pts = 1) {
  const g = (data.scores[groupJid] ||= {});
  g[who] = (g[who] || 0) + pts;
  scheduleSave();
  return g[who];
}
export const getScores = (groupJid) => data.scores[groupJid] || {};
export function resetScores(groupJid) {
  delete data.scores[groupJid];
  scheduleSave();
}

// ---- statistik pemakaian perintah (.stat, khusus owner) ----
export function recordUse(cmdName, who) {
  const st = (data.stats ||= { since: Date.now(), cmds: {}, users: {} });
  st.cmds[cmdName] = (st.cmds[cmdName] || 0) + 1;
  if (who) st.users[who] = (st.users[who] || 0) + 1;
  scheduleSave();
}
export const getStats = () => data.stats || { since: Date.now(), cmds: {}, users: {} };

// ---- ekonomi virtual (.daily .saldo .judi .transfer .toko): satu dompet per pengguna, berlaku di semua grup ----
const ecoDefaults = () => ({ bal: 0, xp: 0, lastDaily: 0, streak: 0, lastXp: 0, boostUntil: 0, charm: 0, title: '', lastBet: 0 });
export const getUser = (id) => ({ ...ecoDefaults(), ...(data.eco[id] || {}) });
export const allUsers = () => data.eco;

/** Ubah data pengguna secara sinkron (aman dari balapan karena tidak ada await di antaranya). */
export function updateUser(id, fn) {
  const u = getUser(id);
  const r = fn(u);
  data.eco[id] = u;
  scheduleSave();
  return r === undefined ? u : r;
}

export function flushStore() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    fs.writeFileSync(config.settingsFile, JSON.stringify(data, null, 2));
  } catch {}
}
