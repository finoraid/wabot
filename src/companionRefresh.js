// Penanganan <notification type="companion_reg_refresh"> saat bot belum tertaut.
//
// Latar belakang (WhiskeySockets/Baileys#2737, PR #2765): sejak akhir Juli 2026 server WhatsApp
// mengirim notifikasi ini ke perangkat yang belum tertaut untuk "mencabut" adv secret yang sedang
// dipakai QR. Baileys hanya meng-ack lalu membuangnya, jadi QR di layar memuat secret yang sudah
// dicabut, HP melapor gagal tautkan, dan pair-success tidak pernah datang.
//
// Ini versi tingkat-aplikasi (tanpa patch-package, tanpa mengubah file di node_modules) dengan
// logika yang sama dengan PR #2765:
//   1. terima notifikasi hanya jika punya anak `companion_reg_refresh` atau `pair-device-rotate-qr`
//   2. abaikan jika sesi sudah punya creds.me (sudah tertaut / sedang pairing code)
//   3. buat adv secret baru (32 byte acak, base64), simpan lewat creds.update
//   4. QR yang tampil diganti dengan secret baru, ref TIDAK dihabiskan
//
// Modul ini sengaja tidak meng-import Baileys supaya mudah dites.
import { randomBytes } from 'node:crypto';

export const REFRESH_CHILDREN = ['companion_reg_refresh', 'pair-device-rotate-qr'];

export function hasRefreshChild(node) {
  return Array.isArray(node?.content) && node.content.some((c) => REFRESH_CHILDREN.includes(c?.tag));
}

/** @returns {'rotated'|'ignored_malformed'|'ignored_registered'} */
export function rotateAdvSecret(node, creds, emitCredsUpdate) {
  if (!hasRefreshChild(node)) return 'ignored_malformed';
  if (creds.me) return 'ignored_registered'; // secret ini dipakai verifikasi pairing yang sedang/sudah jalan
  creds.advSecretKey = randomBytes(32).toString('base64');
  emitCredsUpdate({ advSecretKey: creds.advSecretKey });
  return 'rotated';
}

/**
 * Format QR Baileys (rc14): https://wa.me/settings/linked_devices#ref,noiseKey,identityKey,advSecret,platformId
 * Ganti field adv secret dengan nilai terbaru. Format tak dikenal -> dikembalikan apa adanya.
 */
export function withAdvSecret(qr, advSecretKey) {
  if (typeof qr !== 'string' || !advSecretKey) return qr;
  const hash = qr.indexOf('#');
  const prefix = hash >= 0 ? qr.slice(0, hash + 1) : '';
  const parts = qr.slice(hash + 1).split(',');
  if (parts.length < 5) return qr;
  parts[3] = advSecretKey;
  return prefix + parts.join(',');
}

/**
 * Pasang handler ke socket. `onQr(qr)` dipanggil dengan QR yang sudah disesuaikan.
 * @returns {{ patchQr: (qr:string)=>string }} patchQr dipakai untuk setiap QR dari event connection.update.
 */
export function attachCompanionRefresh(sock, { onQr, log = console.log } = {}) {
  let lastQr = null;

  const patchQr = (qr) => {
    const fixed = sock.authState.creds.me ? qr : withAdvSecret(qr, sock.authState.creds.advSecretKey);
    lastQr = fixed;
    return fixed;
  };

  try {
    sock.ws.on('CB:notification,type:companion_reg_refresh', (node) => {
      try {
        const outcome = rotateAdvSecret(node, sock.authState.creds, (u) => sock.ev.emit('creds.update', u));
        if (outcome === 'rotated') {
          log('companion_reg_refresh diterima: adv secret diganti, QR diperbarui');
          if (lastQr) onQr?.(withAdvSecret(lastQr, sock.authState.creds.advSecretKey));
        } else {
          log(`companion_reg_refresh diabaikan (${outcome})`);
        }
      } catch (e) {
        console.error('[companion_reg_refresh]', e);
      }
    });
  } catch (e) {
    console.error('[companion_reg_refresh] gagal memasang handler:', e.message);
  }
  return { patchQr };
}
