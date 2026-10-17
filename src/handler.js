import { config } from './config.js';
import { getGroup } from './store.js';
import { getMeta } from './groupCache.js';
import { findCommand } from './registry.js';
import { getBody, getContextInfo, num } from './utils.js';

const COOLDOWN_MS = 2000;
const lastUsed = new Map(); // sender -> timestamp
/** Hanya untuk tes. */
export const _resetCooldowns = () => lastUsed.clear();
const INVITE_LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;

/** Semua pengenal (nomor/LID) milik satu peserta grup. */
const idsOf = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(num);

function senderIdsOf(msg) {
  const k = msg.key;
  return new Set(
    [k.participant, k.participantAlt, k.participantPn, k.remoteJidAlt, k.remoteJid]
      .filter((j) => j && !String(j).endsWith('@g.us'))
      .map(num),
  );
}

function botIdsOf(sock) {
  return new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(num));
}

const hasAdmin = (meta, ids) =>
  !!meta?.participants?.some((p) => p.admin && idsOf(p).some((i) => ids.has(i)));

export async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  if (!msg.message) return;

  const isGroup = jid.endsWith('@g.us');
  const body = getBody(msg).trim();
  if (!body) return;

  const senderIds = senderIdsOf(msg);
  const isOwner = !!msg.key.fromMe || config.owners.some((o) => senderIds.has(o));

  let meta = null;
  let isAdmin = false;
  let isBotAdmin = false;
  const needsMeta = isGroup;
  if (needsMeta) {
    try {
      meta = await getMeta(sock, jid);
      isAdmin = hasAdmin(meta, senderIds);
      isBotAdmin = hasAdmin(meta, botIdsOf(sock));
    } catch (e) {
      console.error('[handler] gagal ambil metadata grup:', e.message);
    }
  }

  const reply = (text, extra = {}) => sock.sendMessage(jid, { text, ...extra }, { quoted: msg });
  const react = (emoji) => sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }).catch(() => {});

  // ---- Antilink: hapus pesan berisi link undangan grup dari non-admin ----
  if (isGroup && meta && getGroup(jid).antilink && INVITE_LINK.test(body) && !isAdmin && !isOwner && !msg.key.fromMe) {
    if (isBotAdmin) {
      await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
      const target = msg.key.participant;
      if (target) {
        await sock.sendMessage(jid, {
          text: `🚫 @${num(target)} mengirim link grup dan dikeluarkan (antilink aktif).`,
          mentions: [target],
        });
        await sock.groupParticipantsUpdate(jid, [target], 'remove').catch(() => {});
      }
    }
    return;
  }

  // ---- Command ----
  if (!body.startsWith(config.prefix)) return;
  const m = body.slice(config.prefix.length).trim().match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return;
  const cmd = findCommand(m[1]);
  if (!cmd) return;

  const text = m[2].trim();
  const args = text ? text.split(/\s+/) : [];

  if (cmd.owner && !isOwner) return reply('⛔ Perintah ini khusus owner bot.');
  if (cmd.group && !isGroup) return reply('👥 Perintah ini hanya bisa dipakai di grup.');
  if (cmd.admin && !(isAdmin || isOwner)) return reply('⛔ Perintah ini khusus admin grup.');
  if (cmd.botAdmin && !isBotAdmin) return reply('🤖 Jadikan bot sebagai admin grup dulu supaya perintah ini bisa jalan.');

  const who = [...senderIds][0] || jid;
  if (!isOwner) {
    const now = Date.now();
    if (now - (lastUsed.get(who) || 0) < COOLDOWN_MS) return;
    lastUsed.set(who, now);
    if (lastUsed.size > 5000) lastUsed.clear();
  }

  const ctxInfo = getContextInfo(msg);
  const ctx = {
    sock, msg, jid, isGroup, meta, isOwner, isAdmin, isBotAdmin,
    sender: msg.key.participant || jid,
    senderIds, args, text, prefix: config.prefix,
    mentioned: ctxInfo.mentionedJid || [],
    quotedSender: ctxInfo.participant || null,
    reply, react, idsOf,
  };

  try {
    await cmd.run(ctx);
  } catch (e) {
    if (e.userMessage) console.log(`[cmd:${cmd.name}] ${e.userMessage}`);
    else console.error(`[cmd:${cmd.name}]`, e);
    await reply(`❌ ${e.userMessage || 'Terjadi kesalahan di bot. Coba lagi nanti.'}`).catch(() => {});
  }
}
