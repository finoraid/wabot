import os from 'node:os';
import sharp from 'sharp';
import { config } from '../config.js';
import { allCommands } from '../registry.js';
import { bannerSvg, detailBox, groupCommands, overviewParts } from '../menu.js';
import { formatUptime } from '../utils.js';

const ORDER = ['Umum', 'Game', 'Media', 'AI', 'Hiburan', 'Alat', 'Grup', 'Owner'];

export default [
  {
    name: 'menu',
    aliases: ['help', 'bantuan'],
    usage: '[kategori]',
    category: 'Umum',
    desc: 'Tampilkan daftar perintah',
    async run({ sock, jid, msg, args, reply, prefix, isOwner }) {
      const groups = groupCommands(allCommands(), { isOwner, order: ORDER });
      const name = msg.pushName || '';
      const ctx = { botName: config.botName, prefix, name, uptime: formatUptime(process.uptime()) };
      const want = (args[0] || '').toLowerCase();

      // Foto banner: gambar buatan sendiri, atau foto milikmu lewat env MENU_IMAGE_URL.
      let photo = null;
      if (config.menuImage) photo = { url: config.menuImage };
      else {
        try {
          const svg = bannerSvg({ botName: config.botName, prefix, categories: groups.map((g) => g.name) });
          photo = await sharp(Buffer.from(svg)).png().toBuffer();
        } catch (e) {
          console.error('[menu] gagal membuat banner, kirim teks saja:', e.message);
        }
      }

      let caption;
      let follow = '';
      if (!want) ({ caption, follow } = overviewParts(ctx, groups));
      else if (want === 'semua' || want === 'all') caption = groups.map((g) => detailBox(g, prefix)).join('\n\n');
      else {
        const g = groups.find((x) => x.name.toLowerCase() === want || x.name.toLowerCase().startsWith(want));
        if (!g) return reply(`Kategori tidak ada. Pilih: ${groups.map((x) => x.name.toLowerCase()).join(', ')}, semua\nContoh: ${prefix}menu media`);
        caption = detailBox(g, prefix);
      }

      // Caption foto dibatasi (~1000 huruf); kalau lebih panjang, foto (caption pendek) dan teks dikirim terpisah.
      if (caption.length > 1000) {
        // Pertahankan daftar ringkas semua fitur; tambahkan caption panjang sebagai bagian terpisah.
        follow = [follow, caption].filter(Boolean).join('\n\n');
        caption = `*${config.botName}*  •  menu lengkap`;
      }
      if (photo) {
        try {
          await sock.sendMessage(jid, { image: photo, caption }, { quoted: msg });
          if (follow) await sock.sendMessage(jid, { text: follow });
          return;
        } catch (e) {
          console.error('[menu] gagal kirim foto:', e.message);
        }
      }
      await reply(follow ? `${caption}\n\n${follow}` : caption);
    },
  },
  {
    name: 'ping',
    aliases: ['uptime', 'status'],
    category: 'Umum',
    desc: 'Cek bot hidup, uptime, dan memori',
    async run({ reply, msg }) {
      const latency = Date.now() - (Number(msg.messageTimestamp) || 0) * 1000;
      const mem = process.memoryUsage().rss / 1048576;
      await reply(
        `🏓 *Pong!*\nLatensi: ~${Math.max(0, latency)} ms\nUptime: ${formatUptime(process.uptime())}\nMemori: ${mem.toFixed(0)} MB\nNode: ${process.version} (${os.platform()})`,
      );
    },
  },
];
