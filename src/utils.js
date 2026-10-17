import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage, getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';

const silent = pino({ level: 'silent' });

/** Error yang pesannya aman ditampilkan ke pengguna WhatsApp. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}

/** "628123:5@s.whatsapp.net" -> "628123" */
export const num = (jid) => String(jid || '').split('@')[0].split(':')[0];

/** Ambil isi pesan yang sudah dinormalisasi (membuka ephemeral/viewOnce dll). */
export function getContent(msg) {
  return normalizeMessageContent(msg.message) || {};
}

export function getBody(msg) {
  const c = getContent(msg);
  const t = getContentType(c);
  if (!t) return '';
  const m = c[t];
  if (t === 'conversation') return m || '';
  return m?.text || m?.caption || '';
}

export function getContextInfo(msg) {
  const c = getContent(msg);
  const t = getContentType(c);
  return (t && c[t]?.contextInfo) || {};
}

/** Cari media (di pesan itu sendiri, atau pesan yang di-reply). */
export function findMedia(msg, kinds = ['imageMessage', 'videoMessage']) {
  const c = getContent(msg);
  const t = getContentType(c);
  if (kinds.includes(t)) return { type: t, msg, node: c[t] };

  const ctx = getContextInfo(msg);
  if (ctx.quotedMessage) {
    const qc = normalizeMessageContent(ctx.quotedMessage) || {};
    const qt = getContentType(qc);
    if (kinds.includes(qt)) {
      return {
        type: qt,
        node: qc[qt],
        msg: {
          key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
          message: ctx.quotedMessage,
        },
      };
    }
  }
  return null;
}

export function getQuotedText(msg) {
  const ctx = getContextInfo(msg);
  if (!ctx.quotedMessage) return '';
  const qc = normalizeMessageContent(ctx.quotedMessage) || {};
  const qt = getContentType(qc);
  if (!qt) return '';
  const m = qc[qt];
  return qt === 'conversation' ? m || '' : m?.text || m?.caption || '';
}

export async function downloadMedia(sock, found) {
  return downloadMediaMessage(found.msg, 'buffer', {}, { logger: silent, reuploadRequest: sock.updateMediaMessage });
}

/** Jalankan program (tanpa shell, jadi aman dari injeksi argumen). */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180_000, maxBuffer: 20 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Folder sementara yang otomatis dihapus setelah selesai. */
export async function withTmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-'));
  try {
    return await fn(dir);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Validasi URL publik (cegah akses ke jaringan internal/SSRF dasar) ----------
const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (!v) return true;
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new UserError('Tautan tidak valid.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UserError('Hanya tautan http/https yang didukung.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UserError('Tautan mengarah ke alamat privat.');
  }
  let ips;
  try {
    ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  } catch {
    throw new UserError('Domain pada tautan tidak ditemukan.');
  }
  if (!ips.length || ips.some(isPrivateIp)) throw new UserError('Tautan mengarah ke alamat privat.');
  return u.toString();
}

export const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [d && `${d}h`, h && `${h}j`, m && `${m}m`, `${s}d`].filter(Boolean).join(' ');
}

export const formatBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
