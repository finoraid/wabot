import { setAfk } from '../afk.js';
import { config } from '../config.js';
import { getGroup, updateGroup } from '../store.js';
import { num, UserError } from '../utils.js';

const base = { category: 'Grup', group: true };
const MAX_WARN = 3;
const MAX_NOTES = 50;

/** Target dari @mention atau reply, dicocokkan ke peserta grup. */
function target(ctx) {
  const set = new Set([...ctx.mentioned, ctx.quotedSender].filter(Boolean));
  for (const j of set) {
    const p = ctx.findParticipant(j);
    if (p) return p;
  }
  throw new UserError('Tag orangnya atau reply pesannya (harus anggota grup ini).');
}

const tagadminCooldown = new Map();

export default [
  {
    category: 'Umum',
    name: 'afk',
    usage: '[alasan]',
    desc: 'Tandai kamu sedang AFK (di grup)',
    group: true,
    async run({ senderIds, text, reply }) {
      setAfk(senderIds, text);
      await reply(`💤 Kamu sekarang AFK${text ? `: ${text.slice(0, 100)}` : ''}. Aku kabari yang mencarimu.`);
    },
  },
  {
    ...base,
    name: 'catatan',
    aliases: ['note', 'notes'],
    usage: '[nama] | simpan <nama> | <isi> | hapus <nama>',
    desc: 'Catatan grup: simpan & panggil teks',
    async run(ctx) {
      const { jid, args, text, reply, prefix, isAdmin, isOwner, quotedText } = ctx;
      const g = getGroup(jid);
      const notes = g.notes || {};
      const sub = (args[0] || '').toLowerCase();

      if (!sub) {
        const names = Object.keys(notes);
        return reply(names.length ? `📒 *Catatan grup*\n${names.map((n) => `• ${n}`).join('\n')}\n\nBuka: ${prefix}catatan <nama>` : `Belum ada catatan.\nAdmin bisa menyimpan: ${prefix}catatan simpan aturan | isi catatan`);
      }
      if (sub === 'simpan' || sub === 'save' || sub === 'hapus' || sub === 'del') {
        if (!(isAdmin || isOwner)) throw new UserError('Menyimpan/menghapus catatan khusus admin grup.');
      }
      if (sub === 'simpan' || sub === 'save') {
        const rest = text.replace(/^\S+\s*/, '');
        const [namePart, ...bodyParts] = rest.split('|');
        const name = (namePart || '').trim().toLowerCase().slice(0, 30);
        const body = (bodyParts.join('|').trim() || quotedText || '').slice(0, 1000);
        if (!name || !body) throw new UserError(`Contoh: ${prefix}catatan simpan wifi | password: 12345\n(atau reply pesan: ${prefix}catatan simpan wifi)`);
        if (!(name in notes) && Object.keys(notes).length >= MAX_NOTES) throw new UserError(`Maksimal ${MAX_NOTES} catatan per grup.`);
        updateGroup(jid, { notes: { ...notes, [name]: body } });
        return reply(`✅ Catatan *${name}* disimpan.`);
      }
      if (sub === 'hapus' || sub === 'del') {
        const name = args.slice(1).join(' ').toLowerCase();
        if (!(name in notes)) throw new UserError('Catatan tidak ditemukan.');
        const { [name]: _gone, ...rest } = notes;
        updateGroup(jid, { notes: rest });
        return reply(`🗑️ Catatan *${name}* dihapus.`);
      }
      const name = text.toLowerCase();
      if (!(name in notes)) throw new UserError(`Catatan "${name.slice(0, 30)}" tidak ada. Lihat daftar: ${prefix}catatan`);
      await reply(`📒 *${name}*\n\n${notes[name]}`);
    },
  },
  {
    ...base,
    name: 'rules',
    aliases: ['aturan'],
    usage: '[set <teks> | hapus]',
    desc: 'Aturan grup',
    async run({ jid, args, text, reply, prefix, isAdmin, isOwner }) {
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'set' || sub === 'hapus') {
        if (!(isAdmin || isOwner)) throw new UserError('Mengatur aturan khusus admin grup.');
        if (sub === 'hapus') {
          updateGroup(jid, { rules: '' });
          return reply('🗑️ Aturan grup dihapus.');
        }
        const body = text.replace(/^\S+\s*/, '').trim().slice(0, 1500);
        if (!body) throw new UserError(`Contoh: ${prefix}rules set 1. Sopan\n2. Dilarang spam`);
        updateGroup(jid, { rules: body });
        return reply('✅ Aturan grup disimpan.');
      }
      const rules = getGroup(jid).rules;
      await reply(rules ? `📜 *Aturan grup*\n\n${rules}` : `Belum ada aturan.\nAdmin bisa mengatur: ${prefix}rules set <teks>`);
    },
  },
  {
    ...base,
    name: 'warn',
    aliases: ['peringatan'],
    usage: '@user [alasan] | reset @user',
    desc: 'Beri peringatan ke anggota, 3x dikeluarkan (admin)',
    admin: true,
    async run(ctx) {
      const { sock, jid, args, text, reply, prefix, isBotAdmin } = ctx;
      const reset = (args[0] || '').toLowerCase() === 'reset';
      const p = target(ctx);
      const protectedIds = new Set([num(sock.user?.id), num(sock.user?.lid), ...config.owners].filter(Boolean));
      if (p.admin || ctx.idsOf(p).some((i) => protectedIds.has(i))) throw new UserError('Admin, owner, dan bot tidak bisa diberi peringatan.');
      const warns = { ...(getGroup(jid).warns || {}) };
      const tag = `@${num(p.id)}`;
      if (reset) {
        delete warns[p.id];
        updateGroup(jid, { warns });
        return sock.sendMessage(jid, { text: `✅ Peringatan ${tag} direset.`, mentions: [p.id] });
      }
      const reason = text.replace(/@\S+/g, '').trim().slice(0, 100);
      warns[p.id] = (warns[p.id] || 0) + 1;
      updateGroup(jid, { warns });
      if (warns[p.id] >= MAX_WARN) {
        if (!isBotAdmin) return sock.sendMessage(jid, { text: `⚠️ ${tag} sudah ${MAX_WARN}x diperingatkan. Jadikan bot admin untuk mengeluarkannya.`, mentions: [p.id] });
        delete warns[p.id];
        updateGroup(jid, { warns });
        await sock.sendMessage(jid, { text: `🚫 ${tag} dikeluarkan (${MAX_WARN}x peringatan).`, mentions: [p.id] });
        return sock.groupParticipantsUpdate(jid, [p.id], 'remove').catch(() => {});
      }
      await sock.sendMessage(jid, { text: `⚠️ ${tag} diperingatkan (${warns[p.id]}/${MAX_WARN})${reason ? `\nAlasan: ${reason}` : ''}\nReset: ${prefix}warn reset @user`, mentions: [p.id] });
    },
  },
  {
    ...base,
    name: 'cekwarn',
    usage: '[@user]',
    desc: 'Lihat jumlah peringatan',
    async run(ctx) {
      const { sock, jid, sender, reply } = ctx;
      let p;
      try {
        p = target(ctx);
      } catch {
        p = ctx.findParticipant(sender);
      }
      if (!p) return reply('Tag orangnya atau reply pesannya.');
      const n = (getGroup(jid).warns || {})[p.id] || 0;
      await sock.sendMessage(jid, { text: `📋 @${num(p.id)}: *${n}/${MAX_WARN}* peringatan.`, mentions: [p.id] });
    },
  },
  {
    ...base,
    name: 'tagadmin',
    aliases: ['admins', 'panggiladmin'],
    usage: '[pesan]',
    desc: 'Panggil semua admin grup',
    async run({ sock, jid, meta, text, sender, reply }) {
      const key = `${jid}|${sender}`;
      const last = tagadminCooldown.get(key) || 0;
      if (Date.now() - last < 60_000) throw new UserError('Tunggu semenit sebelum memanggil admin lagi.');
      tagadminCooldown.set(key, Date.now());
      if (tagadminCooldown.size > 2000) tagadminCooldown.clear();
      const admins = (meta?.participants || []).filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return reply('Tidak ada admin yang terdeteksi.');
      await sock.sendMessage(jid, { text: `🛎️ *Panggilan untuk admin*${text ? `\n${text.slice(0, 200)}` : ''}\n\n${admins.map((j) => `@${num(j)}`).join(' ')}`, mentions: admins });
    },
  },
  {
    ...base,
    name: 'sapa',
    usage: 'on/off',
    desc: 'Sapaan otomatis pagi (06.00) & malam (21.00) (admin)',
    admin: true,
    async run({ jid, args, reply, prefix }) {
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) return reply(`Sapaan otomatis: *${getGroup(jid).sapa ? 'AKTIF' : 'MATI'}*\nPakai: ${prefix}sapa on / off`);
      updateGroup(jid, { sapa: v === 'on' });
      await reply(`✅ Sapaan otomatis sekarang *${v === 'on' ? 'AKTIF' : 'MATI'}* (jam 06.00 dan 21.00).`);
    },
  },
];
