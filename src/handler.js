import { config } from './config.js';
import { addStrike, clearStrikes, isFlood, isToxic, MAX_STRIKES } from './moderation.js';
import { countMessage, getGlobal, getGroup, recordUse } from './store.js';
import { getMeta } from './groupCache.js';
import { findCommand } from './registry.js';
import { checkAfk } from './afk.js';
import { handleGameMessage } from './games.js';
import { hasActiveQuiz } from './commands/communitygames.js';
import { isUnoWaitingColor, isUnoTurn } from './commands/socialgames.js';
import { addChatXp, fmt } from './economy.js';
import { observeMessage } from './antidelete.js';
import { getBody, getContextInfo, getQuotedText, num } from './utils.js';

const COOLDOWN_MS = 2000;
const lastUsed = new Map(); // sender -> timestamp
/** Hanya untuk tes. */
export const _resetCooldowns = () => lastUsed.clear();
const INVITE_LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;

/**
 * Semua pengenal (nomor/LID) milik satu peserta grup. Di Baileys v7 peserta berupa objek
 * { id, lid?, phoneNumber?, admin } dan `id` bisa LID (@lid) atau nomor (@s.whatsapp.net) tergantung grup.
 * Bentuk string juga diterima.
 */
export const idsOf = (p) =>
  typeof p === 'string' ? [num(p)] : [p?.id, p?.lid, p?.phoneNumber, p?.jid].filter(Boolean).map(num);

function senderIdsOf(msg) {
  const k = msg.key;
  return new Set(
    [k.participant, k.participantAlt, k.participantPn, k.remoteJidAlt, k.remoteJid]
      .filter((j) => j && !String(j).endsWith('@g.us'))
      .map(num),
  );
}

/**
 * Pengirim yang hanya terbaca sebagai LID dicoba dipetakan ke nomor lewat tabel LID<->PN milik Baileys v7
 * (best-effort: kalau API-nya tidak ada / gagal, id tambahan tidak ditambahkan).
 */
async function withMappedPhones(sock, ids, msg) {
  const lids = [msg.key.participant, msg.key.remoteJid, msg.key.participantAlt, msg.key.remoteJidAlt].filter((j) => String(j || '').endsWith('@lid'));
  const get = sock.signalRepository?.lidMapping?.getPNForLID;
  if (!get || !lids.length) return ids;
  for (const lid of lids) {
    try {
      const pn = await get.call(sock.signalRepository.lidMapping, lid);
      if (pn) ids.add(num(pn));
    } catch {
      /* abaikan */
    }
  }
  return ids;
}

function botIdsOf(sock) {
  return new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(num));
}

/** Cari peserta grup dari jid apa pun (LID atau nomor). */
export function findParticipant(meta, jid) {
  const id = num(jid);
  return meta?.participants?.find((p) => idsOf(p).includes(id)) || null;
}

const hasAdmin = (meta, ids) =>
  !!meta?.participants?.some((p) => p.admin && idsOf(p).some((i) => ids.has(i)));

export async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  if (!msg.message) return;

  const isGroup = jid.endsWith('@g.us');
  if (isGroup && msg.key.participant && !msg.key.fromMe) {
    countMessage(jid, msg.key.participant); // untuk .rank
    const xp = addChatXp(num(msg.key.participant)); // XP & level (ada jeda per orang)
    if (xp?.leveledUp) {
      sock.sendMessage(jid, { text: `🎉 @${num(msg.key.participant)} naik ke *level ${xp.level}*! Bonus ${fmt(xp.bonus)} koin.`, mentions: [msg.key.participant] }).catch(() => {});
    }
  }
  // Anti-hapus & anti-sekali-lihat: catat pesan masuk, tangkap pesan yang ditarik, teruskan media sekali lihat.
  await observeMessage(sock, msg).catch((e) => console.error('[antidelete]', e.message));
  let body = getBody(msg).trim();
  if (!body) return;

  // Input langsung untuk game aktif: jawaban kuis A-D dan pilihan warna UNO tanpa prefix.
  if (!msg.key.fromMe && jid.endsWith('@g.us') && !body.startsWith(config.prefix)) {
    const senderForGame = msg.key.participant || jid;
    if (/^[a-d]$/i.test(body) && hasActiveQuiz(jid)) body = `${config.prefix}quizbattle jawab ${body.toUpperCase()}`;
    else if (isUnoWaitingColor(jid, senderForGame)) {
      const colors = { merah: 'red', kuning: 'yellow', hijau: 'green', biru: 'blue', red: 'red', yellow: 'yellow', green: 'green', blue: 'blue', '🔴': 'red', '🟡': 'yellow', '🟢': 'green', '🔵': 'blue' };
      const chosen = colors[body.toLowerCase()];
      if (chosen) body = `${config.prefix}uno color ${chosen}`;
    } else if (isUnoTurn(jid, senderForGame)) {
      if (/^(ambil|draw)$/i.test(body)) body = `${config.prefix}uno draw`;
      else if (/^(?:🔴|🟡|🟢|🔵)\s*(?:\d|skip|reverse|\+2)$/i.test(body) || /^(?:🌈\s*(?:wild|\+4))$/i.test(body)) body = `${config.prefix}uno play ${body.replace(/\s+/g, '')}`;
      else if (/^(?:red|yellow|green|blue|merah|kuning|hijau|biru)$/i.test(body)) return;
    }
  }

  const senderIds = await withMappedPhones(sock, senderIdsOf(msg), msg);
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

  // ---- Antitoxic & antispam: hanya untuk non-admin ----
  if (isGroup && meta && !isAdmin && !isOwner && !msg.key.fromMe) {
    const g = getGroup(jid);
    const target = msg.key.participant;
    const key = `${jid}|${target}`;
    const punish = async (why) => {
      const n = addStrike(key);
      if (n >= MAX_STRIKES) {
        clearStrikes(key);
        if (isBotAdmin && target) {
          await sock.sendMessage(jid, { text: `🚫 @${num(target)} dikeluarkan: ${why} (${MAX_STRIKES}x peringatan).`, mentions: [target] });
          await sock.groupParticipantsUpdate(jid, [target], 'remove').catch(() => {});
        } else {
          await sock.sendMessage(jid, { text: `🚫 @${num(target)} sudah ${MAX_STRIKES}x melanggar (${why}). Jadikan bot admin supaya bisa mengeluarkan.`, mentions: [target] });
        }
      } else {
        await sock.sendMessage(jid, { text: `⚠️ @${num(target)} ${why}. Peringatan ${n}/${MAX_STRIKES}.`, mentions: [target] });
      }
    };
    if (g.antitoxic && isToxic(body)) {
      if (isBotAdmin) await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
      await punish('dilarang berkata kasar');
      return;
    }
    if (g.antispam && isFlood(key)) {
      await punish('jangan spam');
      return;
    }
  }

  // ---- AFK: pengirim yang AFK kembali; orang yang di-tag/di-reply dan sedang AFK diberi tahu ----
  if (isGroup && !msg.key.fromMe) {
    const ci = getContextInfo(msg);
    const isAfkCmd = body.toLowerCase().startsWith(`${config.prefix}afk`);
    for (const n of checkAfk({ senderIds, senderJid: msg.key.participant || '', mentioned: ci.mentionedJid || [], quotedSender: ci.participant || null, isAfkCommand: isAfkCmd })) {
      await sock.sendMessage(jid, { text: n.text, mentions: n.mentions || [] }, { quoted: msg }).catch(() => {});
    }
  }

  // ---- Permainan (.kuis, .tebakangka): jawaban berupa pesan biasa ----
  if (!body.startsWith(config.prefix) && !msg.key.fromMe) {
    const r = handleGameMessage({ jid, who: msg.key.participant || jid, body, isGroup });
    if (r) {
      await sock.sendMessage(jid, { text: r.text, mentions: r.mentions }, { quoted: msg }).catch(() => {});
      return;
    }
  }

  // ---- Command ----
  if (!body.startsWith(config.prefix)) return;
  const m = body.slice(config.prefix.length).trim().match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return;
  const cmd = findCommand(m[1]);
  if (!cmd) return;

  const text = m[2].trim();
  const args = text ? text.split(/\s+/) : [];

  // Mode privat: hanya owner & nomor yang diizinkan (.allow) yang dilayani. Grup yang di-mute: hanya admin/owner.
  if (!isOwner) {
    const gl = getGlobal();
    if (gl.banned.some((n) => senderIds.has(n))) return;
    if (gl.mode === 'private' && !gl.allowed.some((n) => senderIds.has(n))) return;
    if (isGroup && getGroup(jid).muted && !isAdmin) return;
  }

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
    pushName: msg.pushName || '', quotedText: getQuotedText(msg),
    reply, react, idsOf, findParticipant: (j) => findParticipant(meta, j),
  };

  try {
    await cmd.run(ctx);
    recordUse(cmd.name, [...senderIds][0] || '');
  } catch (e) {
    if (e.userMessage) console.log(`[cmd:${cmd.name}] ${e.userMessage}`);
    else console.error(`[cmd:${cmd.name}]`, e);
    await reply(`❌ ${e.userMessage || 'Terjadi kesalahan di bot. Coba lagi nanti.'}`).catch(() => {});
  }
}
