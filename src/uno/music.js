import crypto from 'node:crypto';

// State musik tersinkron. Dipakai untuk Global Music (satu per server) dan Room Music (satu per room).
// Server hanya menyimpan: url, status, dan posisi. Posisi saat ini dihitung dari waktu server,
// jadi pemain yang baru masuk langsung mengikuti posisi yang sama.

export function createMusic() {
  return { url: '', status: 'stopped', pos: 0, at: Date.now(), rev: 0 };
}

export function currentPos(m, now = Date.now()) {
  return m.status === 'playing' ? m.pos + (now - m.at) / 1000 : m.pos;
}

export function snapshot(m, now = Date.now()) {
  return { url: m.url, status: m.status, pos: Math.round(currentPos(m, now) * 1000) / 1000, rev: m.rev };
}

export function validateUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  if (url.length > 500) throw new Error('URL terlalu panjang (maks 500 karakter).');
  let u;
  try { u = new URL(url); } catch { throw new Error('URL musik tidak valid.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('URL harus diawali http:// atau https://');
  if (u.username || u.password) throw new Error('URL tidak boleh berisi username/password.');
  return u.toString();
}

/** action: set | play | pause | stop. Mengubah state in-place dan mengembalikannya. */
export function applyAction(m, action, rawUrl, now = Date.now()) {
  switch (action) {
    case 'set': {
      m.url = validateUrl(rawUrl); m.status = 'stopped'; m.pos = 0; m.at = now; break;
    }
    case 'play': {
      if (!m.url) throw new Error('Pasang URL musik dulu.');
      if (m.status === 'playing') return m;
      if (m.status === 'stopped') m.pos = 0;
      m.status = 'playing'; m.at = now; break;
    }
    case 'pause': {
      if (m.status !== 'playing') return m;
      m.pos = currentPos(m, now); m.status = 'paused'; m.at = now; break;
    }
    case 'stop': {
      m.status = 'stopped'; m.pos = 0; m.at = now; break;
    }
    default: throw new Error('Aksi musik tidak dikenal.');
  }
  m.rev++;
  return m;
}

const sha = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
export function keyMatches(given, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(sha(given), sha(expected));
}

/** Pembatas percobaan key salah per socket: 5 kali gagal -> diblok 60 detik. */
export function createAttemptLimiter({ max = 5, windowMs = 60_000 } = {}) {
  const fails = new Map();
  return {
    blocked(id, now = Date.now()) {
      const f = fails.get(id);
      return !!f && f.count >= max && now - f.first < windowMs;
    },
    fail(id, now = Date.now()) {
      const f = fails.get(id);
      if (!f || now - f.first >= windowMs) fails.set(id, { count: 1, first: now });
      else f.count++;
    },
    ok(id) { fails.delete(id); },
    forget(id) { fails.delete(id); },
  };
}
