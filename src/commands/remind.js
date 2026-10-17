import { addReminder, getReminders, removeReminders } from '../store.js';
import { formatDuration, MAX_PER_USER, MAX_SECONDS, MIN_SECONDS, parseDuration } from '../reminders.js';
import { UserError } from '../utils.js';

export default {
  name: 'remind',
  aliases: ['ingatkan', 'pengingat'],
  usage: '<waktu> <pesan> | list | batal <no>',
  category: 'Umum',
  desc: 'Pengingat, mis. .remind 10m minum obat (s/m/j/h, maks 7 hari)',
  async run({ jid, sender, args, text, reply, prefix }) {
    const mine = () => getReminders().filter((r) => r.who === sender && r.jid === jid).sort((a, b) => a.at - b.at);
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'list' || sub === 'daftar') {
      const list = mine();
      if (!list.length) return reply('Kamu belum punya pengingat di chat ini.');
      const now = Date.now();
      return reply(`⏰ *Pengingatmu*\n${list.map((r, i) => `${i + 1}. ${r.text.slice(0, 60)} — ${formatDuration(Math.max(0, Math.round((r.at - now) / 1000)))} lagi`).join('\n')}\n\nBatalkan: ${prefix}remind batal <no>`);
    }
    if (sub === 'batal' || sub === 'hapus') {
      const n = Number.parseInt(args[1], 10);
      const target = mine()[n - 1];
      if (!target) throw new UserError(`Nomor tidak ditemukan. Lihat ${prefix}remind list`);
      removeReminders((r) => r.id === target.id);
      return reply('🗑️ Pengingat dibatalkan.');
    }

    // Durasi bisa ditulis "1h30m" atau terpisah "1 jam 30 menit"; ambil token awal selama masih berupa durasi.
    let used = 0;
    let secs = null;
    for (let i = 1; i <= Math.min(args.length - 1, 4); i++) {
      const d = parseDuration(args.slice(0, i).join(''));
      if (d) { secs = d; used = i; }
    }
    const note = args.slice(used).join(' ').trim();
    if (!secs || !note) throw new UserError(`Contoh: ${prefix}remind 10m minum obat\nSatuan: s/detik, m/menit, j/jam, h/hari`);
    if (secs < MIN_SECONDS) throw new UserError(`Minimal ${MIN_SECONDS} detik.`);
    if (secs > MAX_SECONDS) throw new UserError('Maksimal 7 hari.');
    if (mine().length >= MAX_PER_USER) throw new UserError(`Maksimal ${MAX_PER_USER} pengingat aktif.`);

    addReminder({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, jid, who: sender, text: note.slice(0, 300), at: Date.now() + secs * 1000 });
    await reply(`✅ Oke, saya ingatkan *${formatDuration(secs)}* lagi:\n${note.slice(0, 300)}`);
  },
};
