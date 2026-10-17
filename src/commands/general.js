import os from 'node:os';
import { config } from '../config.js';
import { allCommands } from '../registry.js';
import { formatUptime } from '../utils.js';

const ORDER = ['Umum', 'Media', 'AI', 'Grup'];

export default [
  {
    name: 'menu',
    aliases: ['help', 'bantuan'],
    category: 'Umum',
    desc: 'Tampilkan daftar perintah',
    async run({ reply, prefix }) {
      const groups = {};
      for (const c of allCommands()) {
        if (c.owner) continue;
        (groups[c.category || 'Umum'] ||= []).push(c);
      }
      const cats = [...new Set([...ORDER, ...Object.keys(groups)])].filter((c) => groups[c]);
      const lines = [`🤖 *${config.botName}*`, `Prefix: *${prefix}*`, ''];
      for (const cat of cats) {
        lines.push(`*${cat.toUpperCase()}*`);
        for (const c of groups[cat]) {
          const usage = c.usage ? ` ${c.usage}` : '';
          lines.push(`• ${prefix}${c.name}${usage} — ${c.desc}`);
        }
        lines.push('');
      }
      await reply(lines.join('\n').trim());
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
