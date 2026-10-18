import { levelOf } from '../economy.js';
import { getGroup, getRank, getUser, resetRank, updateGroup } from '../store.js';
import { num, UserError } from '../utils.js';

const base = { category: 'Grup', group: true };

function toggle(key, label, hint) {
  return async ({ jid, args, reply, prefix }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) {
      return reply(`${label}: *${getGroup(jid)[key] ? 'AKTIF' : 'MATI'}*\n${hint}\nPakai: ${prefix}${key} on / off`);
    }
    updateGroup(jid, { [key]: v === 'on' });
    return reply(`✅ ${label} sekarang *${v === 'on' ? 'AKTIF' : 'MATI'}*.`);
  };
}

// ---------- Poll (disimpan di memori; hilang saat bot restart) ----------
/** jid grup -> { title, options: string[], votes: Map<pemilih, indeks>, by } */
const polls = new Map();

function pollText(p, final = false) {
  const total = p.votes.size;
  const counts = p.options.map((_, i) => [...p.votes.values()].filter((v) => v === i).length);
  const lines = [`📊 *${p.title}*${final ? ' (selesai)' : ''}`, ''];
  p.options.forEach((o, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    lines.push(`${i + 1}. ${o}`, `   ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))} ${counts[i]} suara (${pct}%)`);
  });
  lines.push('', `Total: ${total} suara`);
  return lines.join('\n');
}

// ---------- Absen ----------
/** jid grup -> { title, present: Map<sender, jid> } */
const absens = new Map();

export default [
  {
    ...base,
    name: 'antispam',
    usage: 'on/off',
    desc: 'Peringatkan pengirim pesan beruntun, 3x lalu kick (admin)',
    admin: true,
    run: toggle('antispam', 'Antispam', 'Batas: 7 pesan dalam 8 detik. Admin tidak kena.'),
  },
  {
    ...base,
    name: 'antitoxic',
    usage: 'on/off',
    desc: 'Hapus kata kasar + peringatan, 3x lalu kick (admin)',
    admin: true,
    run: toggle('antitoxic', 'Antitoxic', 'Bot perlu jadi admin supaya bisa menghapus pesan & mengeluarkan.'),
  },
  {
    ...base,
    name: 'botoff',
    aliases: ['mute'],
    desc: 'Matikan bot di grup ini untuk non-admin (admin)',
    admin: true,
    async run({ jid, reply, prefix }) {
      updateGroup(jid, { muted: true });
      await reply(`🔇 Bot dimatikan untuk anggota biasa di grup ini. Admin masih bisa memakai bot. Nyalakan lagi: ${prefix}boton`);
    },
  },
  {
    ...base,
    name: 'boton',
    aliases: ['unmute'],
    desc: 'Nyalakan bot lagi di grup ini (admin)',
    admin: true,
    async run({ jid, reply }) {
      updateGroup(jid, { muted: false });
      await reply('🔊 Bot dinyalakan lagi untuk semua anggota.');
    },
  },
  {
    ...base,
    name: 'rank',
    aliases: ['top', 'aktif'],
    usage: '[reset]',
    desc: 'Peringkat 10 anggota paling aktif (pesan, level, XP)',
    async run({ sock, jid, args, reply, isAdmin, isOwner }) {
      if ((args[0] || '').toLowerCase() === 'reset') {
        if (!(isAdmin || isOwner)) throw new UserError('Reset peringkat khusus admin grup.');
        resetRank(jid);
        return reply('🧹 Peringkat grup ini direset.');
      }
      const top = Object.entries(getRank(jid)).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!top.length) return reply('Belum ada data. Peringkat dihitung dari pesan sejak bot aktif.');
      const medal = ['🥇', '🥈', '🥉'];
      const lines = top.map(([who, n], i) => {
        const u = getUser(num(who));
        return `${medal[i] || `${i + 1}.`} @${num(who)}${u.title ? ` ${u.title}` : ''} — ${n} pesan • Lv ${levelOf(u.xp)} (${u.xp} XP)`;
      });
      await sock.sendMessage(jid, { text: `🏆 *Anggota paling aktif*\n\n${lines.join('\n')}`, mentions: top.map(([w]) => w) });
    },
  },
  {
    ...base,
    name: 'poll',
    aliases: ['polling'],
    usage: 'Judul | opsi1 | opsi2 ... | hasil | selesai',
    desc: 'Buat pemungutan suara (vote dengan .vote <nomor>)',
    async run({ jid, text, reply, prefix, isAdmin, isOwner, sender }) {
      const cur = polls.get(jid);
      const sub = text.trim().toLowerCase();
      if (sub === 'hasil' || sub === 'result') {
        if (!cur) throw new UserError('Belum ada poll aktif.');
        return reply(pollText(cur));
      }
      if (sub === 'selesai' || sub === 'end') {
        if (!cur) throw new UserError('Belum ada poll aktif.');
        if (!(isAdmin || isOwner || cur.by === sender)) throw new UserError('Hanya pembuat poll atau admin yang bisa mengakhiri.');
        polls.delete(jid);
        return reply(pollText(cur, true));
      }
      const parts = text.split('|').map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) throw new UserError(`Contoh: ${prefix}poll Makan apa? | Bakso | Nasi goreng | Mie ayam`);
      if (parts.length > 11) throw new UserError('Maksimal 10 opsi.');
      if (cur) throw new UserError(`Masih ada poll aktif. Akhiri dulu dengan ${prefix}poll selesai`);
      const p = { title: parts[0].slice(0, 150), options: parts.slice(1).map((o) => o.slice(0, 80)), votes: new Map(), by: sender };
      polls.set(jid, p);
      if (polls.size > 500) polls.delete(polls.keys().next().value);
      await reply(`${pollText(p)}\n\nVote: *${prefix}vote <nomor>*`);
    },
  },
  {
    ...base,
    name: 'vote',
    usage: '<nomor>',
    desc: 'Beri suara di poll yang aktif',
    async run({ jid, args, reply, sender }) {
      const p = polls.get(jid);
      if (!p) throw new UserError('Tidak ada poll aktif.');
      const n = Number.parseInt(args[0], 10);
      if (!Number.isInteger(n) || n < 1 || n > p.options.length) throw new UserError(`Pilih nomor 1-${p.options.length}.`);
      const changed = p.votes.has(sender);
      p.votes.set(sender, n - 1);
      await reply(`${changed ? '🔄 Suaramu diubah' : '✅ Suaramu dicatat'}: *${p.options[n - 1]}*`);
    },
  },
  {
    ...base,
    name: 'absen',
    aliases: ['hadir'],
    usage: 'mulai <judul> | list | selesai',
    desc: 'Daftar hadir: admin buka, anggota kirim .absen',
    async run({ sock, jid, args, text, reply, prefix, isAdmin, isOwner, sender }) {
      const sub = (args[0] || '').toLowerCase();
      const cur = absens.get(jid);
      const show = async (a, head) => {
        const jids = [...a.present.values()];
        const body = jids.length ? jids.map((j, i) => `${i + 1}. @${num(j)}`).join('\n') : '(belum ada yang hadir)';
        await sock.sendMessage(jid, { text: `📋 *${a.title}*${head}\n\n${body}\n\nTotal hadir: ${jids.length}`, mentions: jids });
      };

      if (sub === 'mulai' || sub === 'start') {
        if (!(isAdmin || isOwner)) throw new UserError('Hanya admin yang bisa membuka absen.');
        if (cur) throw new UserError(`Absen masih terbuka. Akhiri dulu dengan ${prefix}absen selesai`);
        const title = text.replace(/^\S+\s*/, '').slice(0, 100) || 'Daftar Hadir';
        absens.set(jid, { title, present: new Map() });
        if (absens.size > 500) absens.delete(absens.keys().next().value);
        return reply(`📋 Absen *${title}* dibuka!\nKirim *${prefix}absen* untuk hadir.`);
      }
      if (sub === 'list' || sub === 'daftar') {
        if (!cur) throw new UserError('Tidak ada absen yang terbuka.');
        return show(cur, '');
      }
      if (sub === 'selesai' || sub === 'stop' || sub === 'end') {
        if (!(isAdmin || isOwner)) throw new UserError('Hanya admin yang bisa menutup absen.');
        if (!cur) throw new UserError('Tidak ada absen yang terbuka.');
        absens.delete(jid);
        return show(cur, ' (ditutup)');
      }
      if (!cur) throw new UserError(`Tidak ada absen yang terbuka. Admin bisa membuka dengan ${prefix}absen mulai <judul>`);
      if (cur.present.has(sender)) return reply('✅ Kamu sudah tercatat hadir.');
      cur.present.set(sender, sender);
      await reply(`✅ @${num(sender)} hadir (${cur.present.size}).`, { mentions: [sender] });
    },
  },
];
