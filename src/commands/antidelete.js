import { getGroup, updateGroup } from '../store.js';

const base = { category: 'Grup', group: true, admin: true };

const label = (v) => (v === 'owner' ? 'AKTIF (dikirim ke owner)' : v ? 'AKTIF (dikirim ke grup)' : 'MATI');

function toggle(key, title, what) {
  return async ({ jid, args, reply, prefix }) => {
    const cmd = key;
    const v = (args[0] || '').toLowerCase();
    if (!['on', 'off', 'owner'].includes(v)) {
      return reply(`${title}: *${label(getGroup(jid)[key])}*\n${what}\n\nPakai:\n• ${prefix}${cmd} on — kirim ulang di grup\n• ${prefix}${cmd} owner — kirim pribadi ke owner\n• ${prefix}${cmd} off — matikan`);
    }
    updateGroup(jid, { [key]: v === 'off' ? '' : v === 'owner' ? 'owner' : 'grup' });
    await reply(`${v === 'off' ? '🔕' : '✅'} ${title}: *${label(getGroup(jid)[key])}*`);
  };
}

export default [
  {
    ...base,
    name: 'antihapus',
    aliases: ['antidelete'],
    usage: 'on | owner | off',
    desc: 'Teruskan pesan yang ditarik (hapus untuk semua) — ke grup atau owner',
    run: toggle('antihapus', 'Anti-hapus', 'Pesan yang ditarik anggota dikirim ulang. Bot hanya bisa menangkap pesan yang masuk saat bot aktif (disimpan 2 jam).'),
  },
  {
    ...base,
    name: 'antisekali',
    aliases: ['antiviewonce', 'antivo'],
    usage: 'on | owner | off',
    desc: 'Teruskan foto/video/suara "sekali lihat" — ke grup atau owner',
    run: toggle('antisekali', 'Anti-sekali-lihat', 'Foto/video/voice note "sekali lihat" diunduh dan dikirim ulang sebagai media biasa.'),
  },
];
