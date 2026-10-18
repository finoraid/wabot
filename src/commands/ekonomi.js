import { buy, claimDaily, STREAK_BONUS, bar, findItem, fmt, gamble, MAX_BET, MIN_BET, MIN_TRANSFER, parseAmount, progress, SHOP, transfer, TRANSFER_FEE } from '../economy.js';
import { getUser } from '../store.js';
import { num, UserError } from '../utils.js';

const base = { category: 'Hiburan' };
const me = (ctx) => num(ctx.sender);

function duration(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} jam ${m} menit` : m ? `${m} menit ${s % 60} detik` : `${s} detik`;
}

/** Target dari @mention atau reply (jid mentah dari WhatsApp). */
const targetJid = (ctx) => ctx.mentioned[0] || ctx.quotedSender || null;

export default [
  {
    ...base,
    name: 'daily',
    aliases: ['harian', 'klaim'],
    desc: 'Klaim koin harian (makin banyak kalau beruntun)',
    async run(ctx) {
      const r = claimDaily(me(ctx));
      if (!r.ok) throw new UserError(`⏳ Hadiah harian sudah diambil. Ambil lagi ${duration(r.wait)} lagi.`);
      await ctx.reply(
        `🎁 *Hadiah harian*\n+${fmt(r.reward)} koin${r.bonus ? ` (termasuk bonus beruntun ${fmt(r.bonus)})` : ''}\n+${r.xp} XP\n🔥 Beruntun: ${r.streak} hari\n💰 Saldo: *${fmt(r.bal)}*\n\n_Datang tiap hari: bonus naik ${fmt(STREAK_BONUS)} per hari, sampai 7 hari. Telat lebih dari 2 hari, beruntun mulai dari awal._`,
      );
    },
  },
  {
    ...base,
    name: 'saldo',
    aliases: ['dompet', 'bal', 'profil', 'level', 'lvl'],
    usage: '[@user]',
    desc: 'Cek koin, level, dan XP',
    async run(ctx) {
      const jid = targetJid(ctx) || ctx.sender;
      const id = num(jid);
      const u = getUser(id);
      const p = progress(u.xp);
      const now = Date.now();
      const extra = [
        u.charm > 0 && `🍀 Jimat: ${u.charm}x judi`,
        u.boostUntil > now && `⚡ Booster XP: ${duration(u.boostUntil - now)} lagi`,
      ].filter(Boolean);
      const dailyReady = u.lastDaily + 86_400_000 <= now;
      const text = [
        `👤 @${id}${u.title ? `  ${u.title}` : ''}`,
        `💰 Koin: *${fmt(u.bal)}*`,
        `⭐ Level: *${p.level}*`,
        `✨ XP: ${fmt(p.into)}/${fmt(p.need)}  ${bar(p.pct)}`,
        ...extra,
        id === me(ctx) ? (dailyReady ? `🎁 Hadiah harian siap: ${ctx.prefix}daily` : `🎁 Hadiah harian berikutnya ${duration(u.lastDaily + 86_400_000 - now)} lagi`) : '',
      ].filter(Boolean).join('\n');
      await ctx.sock.sendMessage(ctx.jid, { text, mentions: [jid] }, { quoted: ctx.msg });
    },
  },
  {
    ...base,
    name: 'judi',
    aliases: ['bet', 'gamble'],
    usage: '<jumlah|all>',
    desc: 'Taruhan koin: menang x2, jackpot x5',
    async run(ctx) {
      const id = me(ctx);
      const bal = getUser(id).bal;
      let amount = parseAmount(ctx.args[0], bal);
      if (!amount) throw new UserError(`Contoh: ${ctx.prefix}judi 500  (atau 1k, 2jt, all)\nTaruhan ${fmt(MIN_BET)}–${fmt(MAX_BET)} koin.`);
      if (/^(all|semua|allin)$/i.test(ctx.args[0])) amount = Math.min(amount, MAX_BET);
      const r = gamble(id, amount);
      if (!r.ok) {
        if (r.reason === 'cooldown') throw new UserError(`⏳ Tunggu ${duration(r.wait)} sebelum taruhan lagi.`);
        if (r.reason === 'min') throw new UserError(`Taruhan minimal ${fmt(MIN_BET)} koin.`);
        if (r.reason === 'max') throw new UserError(`Taruhan maksimal ${fmt(MAX_BET)} koin.`);
        throw new UserError(`Koinmu kurang. Saldo: ${fmt(r.bal)}. Ambil ${ctx.prefix}daily dulu.`);
      }
      const head = { jackpot: '🎰 *JACKPOT x5!*', win: '🎉 *Menang!*', lose: '💸 *Kalah...*' }[r.outcome];
      const delta = r.net > 0 ? `+${fmt(r.net)}` : `-${fmt(-r.net)}`;
      await ctx.reply(`${head}\nTaruhan ${fmt(amount)} → ${delta} koin${r.charmed ? ` (🍀 sisa ${r.charmLeft}x)` : ''}\n💰 Saldo: *${fmt(r.bal)}*`);
    },
  },
  {
    ...base,
    name: 'transfer',
    aliases: ['tf', 'kirimkoin'],
    usage: '@user <jumlah>',
    desc: 'Kirim koin ke anggota lain (biaya 5%)',
    group: true,
    async run(ctx) {
      const jid = targetJid(ctx);
      const usage = `Contoh: ${ctx.prefix}transfer @orang 1000  (atau reply pesannya)\nMinimal ${fmt(MIN_TRANSFER)}, biaya ${TRANSFER_FEE * 100}% ditanggung pengirim.`;
      if (!jid) throw new UserError(usage);
      const raw = ctx.args.find((a) => !a.startsWith('@') && parseAmount(a, getUser(me(ctx)).bal));
      const amount = parseAmount(raw, getUser(me(ctx)).bal);
      if (!amount) throw new UserError(usage);
      const botIds = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map(num);
      if (botIds.includes(num(jid))) throw new UserError('Bot tidak butuh koin 😄');
      const r = transfer(me(ctx), num(jid), amount);
      if (!r.ok) {
        if (r.reason === 'self') throw new UserError('Tidak bisa transfer ke diri sendiri.');
        if (r.reason === 'min') throw new UserError(`Transfer minimal ${fmt(MIN_TRANSFER)} koin.`);
        throw new UserError(`Koinmu kurang. Butuh ${fmt(r.need)} (termasuk biaya), saldo ${fmt(r.bal)}.`);
      }
      await ctx.sock.sendMessage(ctx.jid, { text: `✅ Transfer ${fmt(amount)} koin ke @${num(jid)} berhasil.\nBiaya: ${fmt(r.fee)}\n💰 Sisa saldo: *${fmt(r.bal)}*`, mentions: [jid] }, { quoted: ctx.msg });
    },
  },
  {
    ...base,
    name: 'toko',
    aliases: ['shop'],
    usage: '[beli <item> [jumlah]]',
    desc: 'Toko: jimat hoki, booster XP, gelar',
    async run(ctx) {
      const sub = (ctx.args[0] || '').toLowerCase();
      if (sub === 'beli' || sub === 'buy') {
        const item = findItem(ctx.args[1]);
        if (!item) throw new UserError(`Item tidak ditemukan. Lihat daftar: ${ctx.prefix}toko`);
        const qty = Math.min(Math.max(parseInt(ctx.args[2], 10) || 1, 1), 20);
        const r = buy(me(ctx), item, qty);
        if (!r.ok) {
          if (r.reason === 'owned') throw new UserError('Kamu sudah memakai gelar ini.');
          if (r.reason === 'qty') throw new UserError('Gelar hanya bisa dibeli satu.');
          throw new UserError(`Koinmu kurang. Butuh ${fmt(r.total)}, saldo ${fmt(r.bal)}.`);
        }
        return ctx.reply(`🛒 Berhasil beli *${item.name}*${qty > 1 ? ` x${qty}` : ''} (-${fmt(r.total)}).\n💰 Saldo: *${fmt(r.bal)}*`);
      }
      const lines = SHOP.map((i, n) => `${n + 1}. ${i.name} — *${fmt(i.price)}*\n   ${i.desc}`);
      await ctx.reply(`🏬 *Toko*\n\n${lines.join('\n')}\n\nBeli: *${ctx.prefix}toko beli <nomor/nama> [jumlah]*\nContoh: ${ctx.prefix}toko beli jimat 2\n💰 Saldomu: ${fmt(getUser(me(ctx)).bal)}`);
    },
  },
];
