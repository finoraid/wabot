// Anti-hapus & anti-sekali-lihat (per grup). Dipanggil dari handler untuk setiap pesan masuk.
//  - anti-hapus: pesan grup disimpan sebentar di memori; kalau ditarik ("hapus untuk semua"), isinya diteruskan.
//  - anti-sekali-lihat: foto/video/voice "sekali lihat" langsung diunduh dan diteruskan.
// Tujuan: 'grup' (kirim ulang di grup itu) atau 'owner' (kirim pribadi ke owner). Kosong = mati.
import { downloadMediaMessage, getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from './config.js';
import { getMeta } from './groupCache.js';
import { isToxic } from './moderation.js';
import { getGroup } from './store.js';
import { getBody, num } from './utils.js';

const silent = pino({ level: 'silent' });
const MAX_ENTRIES = 4000;
const MAX_BYTES = 80 * 1024 * 1024; // total media yang ditahan di memori
const PREFETCH_MAX = 8 * 1024 * 1024; // media lebih besar dari ini tidak diunduh duluan
const VIEWONCE_MAX = 40 * 1024 * 1024;
const TTL_MS = 2 * 60 * 60 * 1000;
const MEDIA = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const INVITE_LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage'];

/** id pesan -> { msg, ts, type, promise, buf, bytes } (urutan sisip = urutan usia) */
const cache = new Map();
const handled = new Set();
let totalBytes = 0;

/** Hanya untuk tes. */
export const _reset = () => {
  cache.clear();
  handled.clear();
  totalBytes = 0;
};
export const _cacheSize = () => cache.size;

function drop(id) {
  const e = cache.get(id);
  if (e) totalBytes -= e.bytes || 0;
  cache.delete(id);
}
function evict() {
  const now = Date.now();
  for (const [id, e] of cache) {
    if (cache.size <= MAX_ENTRIES && totalBytes <= MAX_BYTES && now - e.ts <= TTL_MS) break;
    drop(id);
  }
  if (handled.size > 5000) handled.clear();
}

const download = (sock, msg) => downloadMediaMessage(msg, 'buffer', {}, { logger: silent, reuploadRequest: sock.updateMediaMessage });

/** Buka pembungkus (ephemeral, viewOnce, ...) sambil mencatat apakah ada pembungkus sekali-lihat. */
function unwrap(message) {
  let cur = message;
  let viewOnce = false;
  for (let i = 0; i < 6 && cur; i++) {
    const w = WRAPPERS.find((k) => cur[k]?.message);
    if (!w) break;
    if (w.startsWith('viewOnce')) viewOnce = true;
    cur = cur[w].message;
  }
  return { content: cur || {}, viewOnce };
}

export function viewOnceInfo(msg) {
  const { content, viewOnce } = unwrap(msg.message);
  const type = getContentType(content);
  if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return null;
  if (!viewOnce && !content[type]?.viewOnce) return null;
  return { type, node: content[type] };
}

const idSet = (key) => new Set([key?.participant, key?.participantAlt, key?.participantPn].filter(Boolean).map(num));
const sizeOf = (node) => Number(node?.fileLength?.low ?? node?.fileLength ?? 0);

async function destinations(sock, jid, mode) {
  if (mode !== 'owner') return [jid];
  const list = config.owners.length ? config.owners : [num(sock.user?.id)];
  return list.filter(Boolean).map((n) => `${n}@s.whatsapp.net`);
}

async function groupName(sock, jid) {
  try {
    return (await getMeta(sock, jid))?.subject || '';
  } catch {
    return '';
  }
}

async function sendMedia(sock, to, type, node, buf, caption, mentions) {
  if (type === 'imageMessage') return sock.sendMessage(to, { image: buf, caption, mentions });
  if (type === 'videoMessage') return sock.sendMessage(to, { video: buf, caption, mentions, gifPlayback: !!node.gifPlayback });
  if (type === 'audioMessage') {
    await sock.sendMessage(to, { audio: buf, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: !!node.ptt });
    return sock.sendMessage(to, { text: caption, mentions });
  }
  if (type === 'stickerMessage') {
    await sock.sendMessage(to, { sticker: buf });
    return sock.sendMessage(to, { text: caption, mentions });
  }
  if (type === 'documentMessage') {
    await sock.sendMessage(to, { document: buf, mimetype: node.mimetype || 'application/octet-stream', fileName: node.fileName || 'file', caption, mentions });
  }
}

async function forwardViewOnce(sock, msg, info) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant;
  if (sizeOf(info.node) > VIEWONCE_MAX) return;
  const buf = await download(sock, msg);
  const mode = getGroup(jid).antisekali;
  const where = mode === 'owner' ? ` di *${await groupName(sock, jid)}*` : '';
  const orig = info.node.caption ? `\n\n${info.node.caption}` : '';
  const caption = `👁️ *Sekali lihat* dari @${num(sender)}${where}${orig}`;
  for (const to of await destinations(sock, jid, mode)) {
    await sendMedia(sock, to, info.type, info.node, buf, caption, sender ? [sender] : []).catch((e) => console.error('[antisekali] kirim gagal:', e.message));
  }
}

function remember(sock, msg) {
  const id = msg.key.id;
  if (!id || cache.has(id)) return;
  const { content } = unwrap(msg.message);
  const type = getContentType(content);
  if (!type || type === 'protocolMessage' || type === 'senderKeyDistributionMessage' || type === 'reactionMessage') return;
  const entry = { msg, ts: Date.now(), type, node: content[type], bytes: 0, promise: null, buf: null };
  if (MEDIA.includes(type) && sizeOf(entry.node) <= PREFETCH_MAX) {
    // unduh sekarang selagi masih ada di server WhatsApp; setelah ditarik, kadang sudah tidak bisa diambil
    entry.promise = download(sock, msg)
      .then((buf) => {
        if (!cache.has(id)) return null;
        entry.buf = buf;
        entry.bytes = buf.length;
        totalBytes += buf.length;
        evict();
        return buf;
      })
      .catch(() => null);
  }
  cache.set(id, entry);
  evict();
}

async function handleRevoke(sock, revokeMsg, origKey) {
  const jid = revokeMsg.key.remoteJid;
  const id = origKey?.id;
  const g = getGroup(jid);
  if (!id || !g.antihapus || handled.has(id)) return;
  const botIds = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(num));
  const deleter = revokeMsg.key.participant;
  if (revokeMsg.key.fromMe || (deleter && botIds.has(num(deleter)))) return; // penghapusan oleh bot sendiri (moderasi)
  const e = cache.get(id);
  if (!e) return;
  handled.add(id);
  drop(id);

  const sender = e.msg.key.participant;
  const text = getBody(e.msg).trim();
  const toGroup = g.antihapus !== 'owner';
  const a = idSet(revokeMsg.key);
  const b = idSet(e.msg.key);
  const byOtherUser = a.size > 0 && ![...a].some((x) => b.has(x));
  if (toGroup) {
    // Admin yang menghapus pesan orang lain = moderasi, jangan dikembalikan ke grup.
    if (byOtherUser) return;
    // Pesan yang memang diberantas antitoxic/antilink juga tidak dipajang ulang.
    if (g.antitoxic && text && isToxic(text)) return;
    if (g.antilink && INVITE_LINK.test(text)) return;
  }

  const who = `@${num(sender)}`;
  const byOther = byOtherUser && deleter ? ` (dihapus oleh @${num(deleter)})` : '';
  const mentions = [sender, byOther && deleter].filter(Boolean);
  const place = !toGroup ? ` di *${await groupName(sock, jid)}*` : '';
  const head = `🗑️ *Pesan dihapus* dari ${who}${byOther}${place}`;

  for (const to of await destinations(sock, jid, g.antihapus)) {
    try {
      if (MEDIA.includes(e.type)) {
        const buf = e.buf || (e.promise ? await e.promise : null) || (await download(sock, e.msg).catch(() => null));
        if (!buf) {
          await sock.sendMessage(to, { text: `${head}\n\n_(media tidak bisa diambil lagi)_${e.node?.caption ? `\n${e.node.caption}` : ''}`, mentions });
        } else {
          await sendMedia(sock, to, e.type, e.node, buf, `${head}${e.node?.caption ? `\n\n${e.node.caption}` : ''}`, mentions);
        }
      } else if (text) {
        await sock.sendMessage(to, { text: `${head}\n\n${text}`, mentions });
      } else {
        await sock.sendMessage(to, { text: `${head}\n\n_(jenis pesan: ${e.type.replace(/Message$/, '')})_`, mentions });
      }
    } catch (err) {
      console.error('[antihapus] kirim gagal:', err.message);
    }
  }
}

/** Dipanggil handler untuk setiap pesan masuk (sebelum filter teks). */
export async function observeMessage(sock, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid?.endsWith('@g.us') || !msg.message) return;

  const { content } = unwrap(msg.message);
  const proto = content.protocolMessage;
  if (proto) {
    if (proto.type === 0 || proto.type === 'REVOKE') await handleRevoke(sock, msg, proto.key);
    return;
  }
  if (msg.key.fromMe) return;

  const g = getGroup(jid);
  if (g.antisekali) {
    const vo = viewOnceInfo(msg);
    if (vo) {
      await forwardViewOnce(sock, msg, vo).catch((e) => console.error('[antisekali]', e.message));
      return;
    }
  }
  if (g.antihapus) remember(sock, msg);
}
