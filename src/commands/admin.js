import { config } from '../config.js';
import { getGlobal, getStats, updateGlobal } from '../store.js';
import { formatDuration } from '../reminders.js';
import { sleep, UserError } from '../utils.js';

const digits = (s) => String(s || '').replace(/\D/g, '');
const base = { category: 'Owner', owner: true };
const MAX_BROADCAST_GROUPS = 100;

function numberFrom({ args, mentioned, quotedSender }) {
  const cands = [args[0], ...mentioned, quotedSender].filter(Boolean).map((x) => digits(String(x).split('@')[0]));
  return cands.find((x) => x.length >= 8) || null;
}

let broadcasting = false;

export default [
  {
    ...base,
    name: 'stat',
    aliases: ['statistik'],
    desc: 'Statistik pemakaian bot (owner)',
    async run({ sock, reply }) {
      const st = getStats();
      const cmds = Object.entries(st.cmds).sort((a, b) => b[1] - a[1]);
      const users = Object.entries(st.users).sort((a, b) => b[1] - a[1]);
      const total = cmds.reduce((n, [, c]) => n + c, 0);
      const days = Math.max(1, Math.round((Date.now() - st.since) / 86_400_000));
      const lines = [
        '📈 *Statistik bot*',
        `Sejak ${days} hari lalu  •  total perintah: *${total}*  •  pengguna unik: *${users.length}*`,
        '',
        '*Perintah terpopuler*',
        ...(cmds.slice(0, 8).map(([n, c], i) => `${i + 1}. .${n} — ${c}x`)),
        ...(cmds.length ? [] : ['(belum ada data)']),
        '',
        '*Pengguna paling aktif*',
        ...(users.slice(0, 5).map(([n, c], i) => `${i + 1}. wa.me/${n} — ${c}x`)),
        ...(users.length ? [] : ['(belum ada data)']),
      ];
      let groups = '-';
      try {
        groups = Object.keys(await sock.groupFetchAllParticipating()).length;
      } catch {}
      lines.push('', `Grup yang diikuti bot: *${groups}*  •  Aktif: ${formatDuration(Math.round(process.uptime()))}`);
      await reply(lines.join('\n'));
    },
  },
  {
    ...base,
    name: 'broadcast',
    aliases: ['bc'],
    usage: '<pesan>',
    desc: 'Kirim pesan ke semua grup bot (owner)',
    async run({ sock, text, reply, prefix }) {
      const body = text.trim();
      if (!body) throw new UserError(`Contoh: ${prefix}broadcast Besok bot maintenance jam 10.00`);
      if (body.length > 1000) throw new UserError('Pesan terlalu panjang (maksimal 1000 huruf).');
      if (broadcasting) throw new UserError('Broadcast sebelumnya masih berjalan.');
      broadcasting = true;
      try {
        const jids = Object.keys(await sock.groupFetchAllParticipating()).slice(0, MAX_BROADCAST_GROUPS);
        if (!jids.length) throw new UserError('Bot belum ada di grup mana pun.');
        await reply(`📣 Mengirim ke ${jids.length} grup (jeda 4 detik per grup, perkiraan ${formatDuration(jids.length * 4)})...`);
        let ok = 0;
        for (const j of jids) {
          try {
            await sock.sendMessage(j, { text: `📣 *Pengumuman*\n\n${body}` });
            ok++;
          } catch (e) {
            console.error('[broadcast]', j, e.message);
          }
          await sleep(Number(process.env.BROADCAST_DELAY_MS ?? 4000)); // jeda agar tidak terlihat seperti spam
        }
        await reply(`✅ Broadcast selesai: ${ok}/${jids.length} grup.`);
      } finally {
        broadcasting = false;
      }
    },
  },
  {
    ...base,
    name: 'ban',
    usage: '<nomor> (atau tag/reply)',
    desc: 'Blokir nomor dari bot (owner)',
    async run(ctx) {
      const n = numberFrom(ctx);
      if (!n) throw new UserError(`Contoh: ${ctx.prefix}ban 628123456789 (atau tag/reply orangnya)`);
      if (config.owners.includes(n)) throw new UserError('Owner tidak bisa diblokir.');
      const g = getGlobal();
      updateGlobal({ banned: [...new Set([...g.banned, n])] });
      await ctx.reply(`🚫 ${n} diblokir dari bot.`);
    },
  },
  {
    ...base,
    name: 'unban',
    usage: '<nomor> (atau tag/reply)',
    desc: 'Buka blokir nomor (owner)',
    async run(ctx) {
      const n = numberFrom(ctx);
      if (!n) throw new UserError(`Contoh: ${ctx.prefix}unban 628123456789`);
      const g = getGlobal();
      updateGlobal({ banned: g.banned.filter((x) => x !== n) });
      await ctx.reply(`✅ ${n} tidak lagi diblokir.`);
    },
  },
  {
    ...base,
    name: 'banlist',
    desc: 'Daftar nomor yang diblokir (owner)',
    async run({ reply }) {
      const b = getGlobal().banned;
      await reply(b.length ? `🚫 *Diblokir*\n${b.map((n) => `• ${n}`).join('\n')}` : 'Tidak ada nomor yang diblokir.');
    },
  },
];
