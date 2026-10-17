import { config } from '../config.js';
import { getGlobal, updateGlobal } from '../store.js';
import { UserError } from '../utils.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

export default [
  {
    name: 'owner',
    aliases: ['creator'],
    category: 'Umum',
    desc: 'Kontak owner bot',
    async run({ reply }) {
      if (!config.owners.length) return reply('Owner belum diatur.');
      await reply(`👤 *Owner ${config.botName}*\n${config.owners.map((n) => `• wa.me/${n}`).join('\n')}`);
    },
  },
  {
    name: 'mode',
    category: 'Owner',
    owner: true,
    usage: 'public/private',
    desc: 'Atur siapa yang boleh memakai bot (owner)',
    async run({ args, reply, prefix }) {
      const v = (args[0] || '').toLowerCase();
      const map = { public: 'public', publik: 'public', private: 'private', privat: 'private', self: 'private' };
      if (!map[v]) {
        const g = getGlobal();
        return reply(`Mode sekarang: *${g.mode === 'private' ? 'PRIVAT' : 'PUBLIK'}*\nNomor diizinkan: ${g.allowed.length}\nPakai: ${prefix}mode public / private`);
      }
      updateGlobal({ mode: map[v] });
      await reply(
        map[v] === 'private'
          ? '🔒 Mode *PRIVAT*: hanya owner dan nomor yang diizinkan (.allow) yang dilayani bot.'
          : '🌐 Mode *PUBLIK*: semua orang bisa memakai bot.',
      );
    },
  },
  {
    name: 'allow',
    category: 'Owner',
    owner: true,
    usage: 'add/del/list <nomor>',
    desc: 'Kelola nomor yang boleh memakai bot saat mode privat (owner)',
    async run({ args, reply, prefix, mentioned, quotedSender }) {
      const sub = (args[0] || '').toLowerCase();
      const g = getGlobal();
      if (sub === 'list' || !sub) {
        return reply(g.allowed.length ? `✅ *Nomor diizinkan:*\n${g.allowed.map((n) => `• ${n}`).join('\n')}` : `Belum ada nomor yang diizinkan.\nPakai: ${prefix}allow add 628xxxxxxxxxx`);
      }
      if (!['add', 'del', 'hapus'].includes(sub)) throw new UserError(`Pakai: ${prefix}allow add/del/list <nomor>`);
      const cands = [args[1], ...mentioned, quotedSender].filter(Boolean).map((x) => digits(String(x).split('@')[0]));
      const n = cands.find((x) => x.length >= 8);
      if (!n) throw new UserError('Tulis nomornya (format internasional, mis. 628123456789), atau tag/reply orangnya.');
      if (sub === 'add') {
        updateGlobal({ allowed: [...new Set([...g.allowed, n])] });
        return reply(`✅ ${n} diizinkan memakai bot.`);
      }
      updateGlobal({ allowed: g.allowed.filter((x) => x !== n) });
      await reply(`🗑️ ${n} dihapus dari daftar izin.`);
    },
  },
];
