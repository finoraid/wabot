import { ANGKA_TRIES, getGame, KUIS_TIME, startAngka, startKuis, stopGame } from '../games.js';
import { FACTS, QUOTES } from '../data/trivia.js';
import { getScores, resetScores } from '../store.js';
import { num, UserError } from '../utils.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Hash sederhana & stabil: teks yang sama selalu menghasilkan angka yang sama. */
export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str).toLowerCase().trim()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const SLOT = ['🍒', '🍋', '🍇', '🔔', '⭐', '7️⃣'];
const SUIT = { batu: '✊', gunting: '✌️', kertas: '🖐️' };
const BEATS = { batu: 'gunting', gunting: 'kertas', kertas: 'batu' };

function bar(pct) {
  const n = Math.round(pct / 10);
  return '█'.repeat(n) + '░'.repeat(10 - n);
}

export default [
  { name: 'quotes', aliases: ['quote', 'kata'], category: 'Hiburan', desc: 'Kutipan semangat acak', async run({ reply }) { await reply(`💬 _${pick(QUOTES)}_`); } },
  { name: 'fakta', aliases: ['fact'], category: 'Hiburan', desc: 'Fakta unik acak', async run({ reply }) { await reply(`🧠 *Tahukah kamu?*\n${pick(FACTS)}`); } },
  {
    name: 'slot',
    category: 'Hiburan',
    desc: 'Putar mesin slot',
    async run({ reply }) {
      const r = [pick(SLOT), pick(SLOT), pick(SLOT)];
      const same = new Set(r).size;
      const msg = same === 1 ? '🎉 *JACKPOT!* Tiga sama!' : same === 2 ? '😮 Dua sama, hampir!' : '😅 Belum beruntung, coba lagi.';
      await reply(`🎰 [ ${r.join(' | ')} ]\n${msg}`);
    },
  },
  {
    name: 'suit',
    usage: '<batu|gunting|kertas>',
    category: 'Hiburan',
    desc: 'Suit lawan bot',
    async run({ args, reply, prefix }) {
      const me = (args[0] || '').toLowerCase();
      if (!SUIT[me]) throw new UserError(`Contoh: ${prefix}suit batu  (pilihan: batu, gunting, kertas)`);
      const bot = pick(Object.keys(SUIT));
      const res = me === bot ? '🤝 Seri!' : BEATS[me] === bot ? '🎉 Kamu menang!' : '😎 Bot menang!';
      await reply(`Kamu: ${SUIT[me]} ${me}\nBot: ${SUIT[bot]} ${bot}\n\n${res}`);
    },
  },
  {
    name: 'jodoh',
    usage: '<nama1> <nama2>',
    category: 'Hiburan',
    desc: 'Kecocokan dua nama (iseng)',
    async run({ args, text, mentioned, reply, prefix }) {
      let a;
      let b;
      if (mentioned.length >= 2) [a, b] = mentioned.slice(0, 2).map((j) => `@${num(j)}`);
      else if (text.includes('&') || text.includes('+')) [a, b] = text.split(/[&+]/).map((x) => x.trim());
      else if (args.length >= 2) [a, b] = [args[0], args.slice(1).join(' ')];
      if (!a || !b) throw new UserError(`Contoh: ${prefix}jodoh Budi Sari  atau tag dua orang`);
      const pct = hash([a, b].map((x) => x.toLowerCase()).sort().join('|')) % 101;
      const note = pct >= 80 ? 'Cocok banget! 💞' : pct >= 50 ? 'Lumayan, bisa diusahakan 🙂' : pct >= 25 ? 'Hmm, perlu usaha ekstra 😅' : 'Mungkin lebih baik berteman 😬';
      await reply(`💘 *${a}* + *${b}*\n${bar(pct)} ${pct}%\n${note}\n\n_Hanya untuk seru-seruan._`, { mentions: mentioned.slice(0, 2) });
    },
  },
  {
    name: 'rate',
    usage: '<hal>',
    category: 'Hiburan',
    desc: 'Beri nilai 0-100 untuk apa saja (iseng)',
    async run({ text, reply, prefix }) {
      if (!text) throw new UserError(`Contoh: ${prefix}rate ketampanan Budi`);
      const pct = hash(text) % 101;
      await reply(`📊 *${text.slice(0, 80)}*\n${bar(pct)} ${pct}%\n\n_Hanya untuk seru-seruan._`);
    },
  },
  {
    name: 'kuis',
    aliases: ['quiz', 'tebak'],
    category: 'Hiburan',
    desc: 'Kuis pengetahuan, jawab langsung di chat',
    async run({ sock, jid, reply, prefix }) {
      const cur = getGame(jid);
      if (cur?.type === 'kuis' && Date.now() < cur.until) return reply(`❓ *Soal masih berjalan:*\n${cur.q}\n\nJawab langsung di chat. Menyerah: ${prefix}nyerah`);
      const g = startKuis(jid);
      await reply(`❓ *KUIS* (${KUIS_TIME} detik)\n${g.q}\n\nJawab langsung di chat! Skor: ${prefix}skor`);
      const t = setTimeout(() => {
        if (getGame(jid)?.id === g.id) {
          stopGame(jid);
          sock.sendMessage(jid, { text: `⏰ Waktu habis! Jawabannya: *${g.shown}*` }).catch(() => {});
        }
      }, KUIS_TIME * 1000);
      t.unref?.();
    },
  },
  {
    name: 'tebakangka',
    aliases: ['angka'],
    category: 'Hiburan',
    desc: 'Tebak angka 1-100 dalam 7 kesempatan',
    async run({ jid, reply }) {
      const cur = getGame(jid);
      if (cur?.type === 'angka') return reply(`Permainan masih berjalan. Rentang: ${cur.lo}-${cur.hi}. Kirim angkanya langsung.`);
      startAngka(jid);
      await reply(`🔢 Aku memikirkan angka *1-100*. Tebak dalam ${ANGKA_TRIES} kesempatan, kirim angkanya langsung di chat!`);
    },
  },
  {
    name: 'nyerah',
    aliases: ['menyerah'],
    category: 'Hiburan',
    desc: 'Menyerah dan lihat jawaban',
    async run({ jid, reply }) {
      const g = getGame(jid);
      if (!g) throw new UserError('Tidak ada permainan yang berjalan.');
      stopGame(jid);
      await reply(g.type === 'kuis' ? `🏳️ Jawabannya: *${g.shown}*` : `🏳️ Angkanya adalah *${g.target}*`);
    },
  },
  {
    name: 'skor',
    aliases: ['leaderboard'],
    usage: '[reset]',
    category: 'Hiburan',
    desc: 'Papan skor game di grup ini',
    async run({ sock, jid, isGroup, args, reply, isAdmin, isOwner }) {
      if (!isGroup) throw new UserError('Skor hanya dicatat di grup.');
      if ((args[0] || '').toLowerCase() === 'reset') {
        if (!(isAdmin || isOwner)) throw new UserError('Reset skor khusus admin grup.');
        resetScores(jid);
        return reply('🧹 Skor grup ini direset.');
      }
      const top = Object.entries(getScores(jid)).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!top.length) return reply('Belum ada skor. Main dulu: .kuis atau .tebakangka');
      const medal = ['🥇', '🥈', '🥉'];
      await sock.sendMessage(jid, { text: `🏆 *Papan skor*\n\n${top.map(([w, n], i) => `${medal[i] || `${i + 1}.`} @${num(w)} — ${n}`).join('\n')}`, mentions: top.map(([w]) => w) });
    },
  },
];
