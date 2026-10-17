import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Penyimpanan pengaturan per-grup sederhana (JSON) di DATA_DIR.
let data = { groups: {} };

try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(config.settingsFile)) {
    const parsed = JSON.parse(fs.readFileSync(config.settingsFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.groups) data = parsed;
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

const defaults = () => ({ antilink: false, welcome: false });

export function getGroup(jid) {
  return { ...defaults(), ...(data.groups[jid] || {}) };
}

export function updateGroup(jid, patch) {
  data.groups[jid] = { ...getGroup(jid), ...patch };
  scheduleSave();
  return data.groups[jid];
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
