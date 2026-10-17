import { config } from '../config.js';
import { getQuotedText, num, UserError } from '../utils.js';
import { invalidate } from '../groupCache.js';
import { getGroup, updateGroup } from '../store.js';

const base = { category: 'Grup', group: true };

/** Ambil target dari @mention atau reply. */
function targets({ mentioned, quotedSender }) {
  const set = new Set(mentioned);
  if (quotedSender) set.add(quotedSender);
  return [...set];
}

function protectedIds(ctx) {
  // bot dan owner tidak boleh jadi target kick (admin dicek terpisah)
  return new Set([num(ctx.sock.user?.id), num(ctx.sock.user?.lid), ...config.owners].filter(Boolean));
}

function toggle(key, label) {
  return async ({ jid, args, reply, prefix }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) {
      return reply(`${label}: *${getGroup(jid)[key] ? 'AKTIF' : 'MATI'}*\nPakai: ${prefix}${key} on / off`);
    }
    updateGroup(jid, { [key]: v === 'on' });
    return reply(`✅ ${label} sekarang *${v === 'on' ? 'AKTIF' : 'MATI'}*.`);
  };
}

export default [
  {
    ...base,
    name: 'tagall',
    aliases: ['everyone'],
    usage: '[pesan]',
    desc: 'Mention semua anggota (admin)',
    admin: true,
    async run({ sock, jid, meta, text, reply }) {
      const jids = meta.participants.map((p) => p.id);
      const body = jids.map((j) => `• @${num(j)}`).join('\n');
      await sock.sendMessage(jid, { text: `📢 *${text || 'Perhatian semua anggota'}*\n\n${body}`, mentions: jids });
    },
  },
  {
    ...base,
    name: 'hidetag',
    aliases: ['h', 'pengumuman'],
    usage: '<pesan>',
    desc: 'Kirim pesan yang me-mention semua tanpa menampilkan daftar (admin)',
    admin: true,
    async run({ sock, jid, meta, msg, text }) {
      const message = text || getQuotedText(msg);
      if (!message) throw new UserError('Tulis pesannya, atau reply pesan yang mau diumumkan.');
      await sock.sendMessage(jid, { text: message, mentions: meta.participants.map((p) => p.id) });
    },
  },
  {
    ...base,
    name: 'kick',
    aliases: ['tendang'],
    usage: '@user',
    desc: 'Keluarkan anggota (admin)',
    admin: true,
    botAdmin: true,
    async run(ctx) {
      const { sock, jid, meta, reply, idsOf } = ctx;
      const list = targets(ctx);
      if (!list.length) throw new UserError('Tag orangnya atau reply pesannya.');
      const safe = protectedIds(ctx);
      const adminIds = new Set(meta.participants.filter((p) => p.admin).flatMap(idsOf));
      const final = list.filter((j) => !safe.has(num(j)) && !adminIds.has(num(j)));
      if (!final.length) throw new UserError('Admin dan bot tidak bisa di-kick lewat perintah ini.');
      await sock.groupParticipantsUpdate(jid, final, 'remove');
      invalidate(jid);
      await reply(`✅ ${final.length} anggota dikeluarkan.`);
    },
  },
  {
    ...base,
    name: 'promote',
    usage: '@user',
    desc: 'Jadikan admin (admin)',
    admin: true,
    botAdmin: true,
    async run(ctx) {
      const list = targets(ctx);
      if (!list.length) throw new UserError('Tag orangnya atau reply pesannya.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, list, 'promote');
      invalidate(ctx.jid);
      await ctx.reply('✅ Berhasil dijadikan admin.');
    },
  },
  {
    ...base,
    name: 'demote',
    usage: '@user',
    desc: 'Cabut status admin (admin)',
    admin: true,
    botAdmin: true,
    async run(ctx) {
      const list = targets(ctx);
      if (!list.length) throw new UserError('Tag orangnya atau reply pesannya.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, list, 'demote');
      invalidate(ctx.jid);
      await ctx.reply('✅ Status admin dicabut.');
    },
  },
  {
    ...base,
    name: 'antilink',
    usage: 'on/off',
    desc: 'Hapus + kick pengirim link grup WhatsApp (admin)',
    admin: true,
    botAdmin: true,
    run: toggle('antilink', 'Antilink'),
  },
  {
    ...base,
    name: 'welcome',
    usage: 'on/off',
    desc: 'Sambutan anggota baru / keluar (admin)',
    admin: true,
    run: toggle('welcome', 'Welcome'),
  },
  {
    ...base,
    name: 'grup',
    aliases: ['group'],
    usage: 'buka/tutup',
    desc: 'Buka/tutup chat grup untuk non-admin (admin)',
    admin: true,
    botAdmin: true,
    async run({ sock, jid, args, reply, prefix }) {
      const v = (args[0] || '').toLowerCase();
      if (!['buka', 'open', 'tutup', 'close'].includes(v)) throw new UserError(`Pakai: ${prefix}grup buka / tutup`);
      const open = v === 'buka' || v === 'open';
      await sock.groupSettingUpdate(jid, open ? 'not_announcement' : 'announcement');
      invalidate(jid);
      await reply(open ? '🔓 Grup dibuka, semua anggota bisa chat.' : '🔒 Grup ditutup, hanya admin yang bisa chat.');
    },
  },
  {
    ...base,
    name: 'linkgc',
    aliases: ['linkgrup'],
    desc: 'Ambil link undangan grup (admin)',
    admin: true,
    botAdmin: true,
    async run({ sock, jid, reply }) {
      const code = await sock.groupInviteCode(jid);
      await reply(`🔗 https://chat.whatsapp.com/${code}`);
    },
  },
];
