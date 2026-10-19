import { UserError, num } from '../utils.js';

// Social games MVP. Game state is intentionally in-memory; use Railway Volume for existing data,
// but active lobbies reset when the Node process restarts.
const lobbies = new Map();
const playerTag = (jid) => `@${num(jid)}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
const COLORS = ['🔴', '🟡', '🟢', '🔵'];
const WORDS = [
  ['Kucing', 'Hewan peliharaan'], ['Pizza', 'Makanan'], ['Bali', 'Tempat wisata'],
  ['Sepak bola', 'Olahraga'], ['Pocong', 'Hantu'], ['Es krim', 'Makanan dingin'],
  ['Pesawat', 'Kendaraan'], ['Sekolah', 'Tempat belajar'], ['Kopi', 'Minuman'],
  ['WhatsApp', 'Aplikasi'], ['Gunung', 'Bentang alam'], ['Dokter', 'Profesi'],
];
const TRUTH = [
  'Apa hal paling memalukan yang pernah kamu alami?', 'Siapa anggota grup yang paling sering bikin kamu ketawa?',
  'Apa kebiasaan aneh yang jarang orang tahu?', 'Apa first impression kamu tentang orang di grup ini?',
  'Apa skill yang ingin kamu kuasai?', 'Pernah salah kirim chat? Ceritakan versi aman-nya 😭',
];
const DARE = [
  'Kirim 3 emoji yang menggambarkan mood kamu sekarang.', 'Puji satu anggota grup dengan tulus.',
  'Ketik kalimat “aku adalah legenda grup ini” dengan penuh percaya diri.',
  'Gunakan status “sedang menjalani misi rahasia” selama 10 menit (opsional).',
  'Ceritakan lelucon paling receh yang kamu tahu.', 'Kirim GIF/stiker paling random yang kamu punya.',
];

function needGroup(isGroup) { if (!isGroup) throw new UserError('Game ini hanya bisa dimainkan di grup.'); }
function getLobby(jid, type) { const g = lobbies.get(jid); if (!g || (type && g.type !== type)) throw new UserError('Belum ada game ini. Mulai dulu lewat perintah game.'); return g; }
function mentionsText(jids) { return jids.map(playerTag).join(' '); }

// Membolehkan balasan warna langsung saat pemain sedang memilih warna UNO.
export function isUnoWaitingColor(jid, sender) { const g = lobbies.get(jid); return !!g && g.type === 'uno' && g.phase === 'playing' && g.pendingColor?.player === sender; }
export function isUnoTurn(jid, sender) { const g = lobbies.get(jid); return !!g && g.type === 'uno' && g.phase === 'playing' && !g.pendingColor && g.players[g.turn] === sender; }

export default [
  {
    name: 'gamehub', aliases: ['games','game'], category: 'Game', desc: 'Menu permainan multiplayer grup',
    async run({ reply, prefix }) {
      await reply(`🎮 *WABOT GAME HUB*\nGame multiplayer & kompetitif yang tersedia:\n\n🕵️ *IMPOSTOR*\n${prefix}impostor start — buat lobby\n${prefix}impostor join — gabung\n${prefix}impostor begin — mulai (min. 3 pemain)\n${prefix}impostor hint <petunjuk> — beri petunjuk\n${prefix}impostor vote @orang — voting\n${prefix}impostor end — akhiri game\n\n🃏 *UNO MINI*\n${prefix}uno start — buat lobby\n${prefix}uno join — gabung\n${prefix}uno begin — mulai (2–6 pemain)\n${prefix}uno hand — lihat kartu pribadi\n${prefix}uno play <kartu> — mainkan kartu\nPilih warna dari menu; jika menu tidak muncul, ketik merah/kuning/hijau/biru\n${prefix}uno draw — ambil kartu\n${prefix}uno end — akhiri game\n\n🧠 *QUIZ BATTLE*\n${prefix}quizbattle start — mulai ronde kuis\nKetik A/B/C/D langsung saat pertanyaan muncul — jawab cepat\n${prefix}quizbattle score — lihat skor ronde\n\n🛡️ *CLAN & CLAN WAR*\n${prefix}clan create <nama> — buat clan\n${prefix}clan join <nama> — gabung clan\n${prefix}clan info — info clan kamu\n${prefix}clan rank — ranking clan\n${prefix}clan war <nama> — simulasi perang clan\n${prefix}clan leave — keluar clan\n\n📈 *VIRTUAL MARKET*\n${prefix}market prices — cek harga aset virtual\n${prefix}market portfolio — cek saldo/aset\n${prefix}market buy BTC 1000 — beli pakai koin virtual\n${prefix}market sell BTC 0.01 — jual unit aset\n${prefix}market tick 3 — ubah harga simulasi\n\n⚔️ *BATTLE*\n${prefix}battle @orang — duel cepat\n\n🎭 *PARTY*\n${prefix}truth — pertanyaan truth acak\n${prefix}dare — tantangan dare acak\n\n🏆 Skor game lama: ${prefix}skor\n💡 AI ringan: ${prefix}ai <pertanyaan>\n\nCatatan: data/lobby game masih disimpan di memori proses, jadi bisa reset saat bot restart. Market dan Clan War adalah simulasi, bukan transaksi uang asli atau pertarungan real-time.`);;
    },
  },
  {
    name: 'impostor', category: 'Game', usage: 'start|join|begin|hint <teks>|vote @orang|end', desc: 'Game tebak penyusup multiplayer',
    async run({ jid, sender, isGroup, args, text, mentioned, sock, reply, prefix }) {
      needGroup(isGroup);
      const sub = (args[0] || 'help').toLowerCase();
      if (sub === 'start') {
        if (lobbies.has(jid)) throw new UserError('Sudah ada game aktif di grup ini. Selesaikan dulu atau gunakan .impostor end.');
        lobbies.set(jid, { type: 'impostor', phase: 'lobby', host: sender, players: [sender], hints: [], votes: {}, created: Date.now() });
        return reply(`🕵️ *IMPOSTOR LOBBY DIBUKA!*\nHost: ${playerTag(sender)}\nAnggota lain ketik *${prefix}impostor join*\nMinimal 3 pemain. Host mulai dengan *${prefix}impostor begin*.`, { mentions: [sender] });
      }
      const g = getLobby(jid, 'impostor');
      if (sub === 'join') {
        if (g.phase !== 'lobby') throw new UserError('Game sudah dimulai.');
        if (g.players.includes(sender)) throw new UserError('Kamu sudah bergabung.');
        if (g.players.length >= 15) throw new UserError('Maksimal 15 pemain.');
        g.players.push(sender);
        return reply(`✅ ${playerTag(sender)} bergabung! Pemain: ${g.players.length}/15`, { mentions: [sender] });
      }
      if (sub === 'begin' || sub === 'startnow') {
        if (sender !== g.host) throw new UserError('Hanya host yang bisa memulai.');
        if (g.phase !== 'lobby') throw new UserError('Game sudah dimulai.');
        if (g.players.length < 3) throw new UserError('Minimal 3 pemain.');
        const [word, category] = pick(WORDS); g.word = word; g.category = category; g.impostor = pick(g.players); g.phase = 'playing';
        const failed = [];
        for (const p of g.players) {
          try { await sock.sendMessage(p, { text: p === g.impostor ? `🕵️ *KAMU IMPOSTOR!*\nKategori: ${category}\nKamu tidak tahu kata rahasia. Berpura-puralah tahu dan jangan ketahuan!` : `🔐 *KATA RAHASIA*\nKata: *${word}*\nKategori: ${category}\nBerikan petunjuk tanpa menyebut kata secara langsung.` }); }
          catch { failed.push(p); }
        }
        if (failed.length) return reply(`⚠️ Game dibuat, tetapi ${failed.length} pemain tidak bisa menerima DM. Minta mereka membuka chat pribadi bot, lalu host bisa mengakhiri game dan mulai ulang.`, { mentions: failed });
        return reply(`🕵️ *IMPOSTOR DIMULAI!*\nPemain: ${g.players.length}\nSetiap pemain kirim petunjuk dengan *${prefix}impostor hint <petunjuk>*.\nSetelah diskusi, gunakan *${prefix}impostor vote @orang*. Voting terbanyak membuka identitas impostor. Jangan menyebut kata rahasia!`);
      }
      if (sub === 'hint') {
        if (g.phase !== 'playing') throw new UserError('Game belum dimulai.');
        if (!g.players.includes(sender)) throw new UserError('Kamu bukan pemain.');
        const hint = text.slice(text.indexOf(' ') + 1).trim();
        if (!hint || hint.length > 100) throw new UserError(`Format: ${prefix}impostor hint petunjukmu (maks. 100 karakter).`);
        if (g.hints.some((h) => h.player === sender)) throw new UserError('Kamu sudah memberi petunjuk.');
        g.hints.push({ player: sender, hint });
        await sock.sendMessage(jid, { text: `💬 Petunjuk ${playerTag(sender)}: “${hint}” (${g.hints.length}/${g.players.length})`, mentions: [sender] });
        if (g.hints.length === g.players.length) await sock.sendMessage(jid, { text: `🗳️ Semua petunjuk terkumpul! Diskusikan lalu voting: ${prefix}impostor vote @orang` });
        return;
      }
      if (sub === 'vote') {
        if (g.phase !== 'playing') throw new UserError('Game belum dimulai.');
        const target = mentioned.find((p) => g.players.includes(p));
        if (!g.players.includes(sender)) throw new UserError('Kamu bukan pemain.');
        if (!target || target === sender) throw new UserError(`Tag pemain yang ingin kamu vote. Contoh: ${prefix}impostor vote @anggota`);
        g.votes[sender] = target;
        const cast = Object.keys(g.votes).length;
        if (cast < g.players.length) return reply(`🗳️ Vote diterima (${cast}/${g.players.length}).`);
        const tally = {}; for (const p of Object.values(g.votes)) tally[p] = (tally[p] || 0) + 1;
        const max = Math.max(...Object.values(tally)); const top = Object.keys(tally).filter((p) => tally[p] === max);
        const outcome = top.length === 1 && top[0] === g.impostor ? `🎉 Benar! ${playerTag(g.impostor)} adalah IMPOSTOR.` : `😈 Impostor berhasil mengelabui kalian! Impostornya ${playerTag(g.impostor)}.`;
        const result = `🏁 *IMPOSTOR SELESAI*\n${outcome}\nKata rahasia: *${g.word}*\n\n🗳️ Hasil vote:\n${Object.entries(tally).map(([p,n]) => `${playerTag(p)} — ${n} vote`).join('\n')}`;
        lobbies.delete(jid); return sock.sendMessage(jid, { text: result, mentions: [...new Set([...Object.keys(tally), g.impostor])] });
      }
      if (sub === 'end') { if (sender !== g.host) throw new UserError('Hanya host yang bisa mengakhiri game.'); lobbies.delete(jid); return reply('🛑 Game Impostor diakhiri host.'); }
      throw new UserError(`Gunakan: ${prefix}impostor start|join|begin|hint <teks>|vote @orang|end`);
    },
  },
  {
    name: 'uno', category: 'Game', usage: 'start|join|begin|hand|play <kartu>|draw|end', desc: 'UNO mini multiplayer berbasis chat',
    async run({ jid, sender, isGroup, args, mentioned, reply, sock, prefix }) {
      needGroup(isGroup); const sub = (args[0] || 'help').toLowerCase();
      if (sub === 'start') {
        if (lobbies.has(jid)) throw new UserError('Ada game aktif. Selesaikan dulu.');
        lobbies.set(jid, { type: 'uno', phase: 'lobby', host: sender, players: [sender] });
        return reply(`🃏 *UNO LOBBY*\nKetik ${prefix}uno join untuk bergabung (maks. 6 pemain). Host mulai: ${prefix}uno begin`);
      }
      const g = getLobby(jid, 'uno');
      if (sub === 'join') { if (g.phase !== 'lobby') throw new UserError('UNO sudah dimulai.'); if (g.players.includes(sender)) throw new UserError('Kamu sudah bergabung.'); if (g.players.length >= 6) throw new UserError('Maksimal 6 pemain.'); g.players.push(sender); return reply(`🃏 ${playerTag(sender)} bergabung! ${g.players.length}/6`, { mentions: [sender] }); }
      if (sub === 'begin') {
        if (sender !== g.host) throw new UserError('Hanya host yang bisa memulai.'); if (g.phase !== 'lobby') throw new UserError('UNO sudah dimulai.'); if (g.players.length < 2) throw new UserError('Minimal 2 pemain.');
        const deck = shuffle(COLORS.flatMap((c) => Array.from({length: 10}, (_,i) => `${c}${i}`).concat([`${c}Skip`, `${c}Reverse`, `${c}+2`])) .concat(Array.from({length:4},()=>['🌈Wild','🌈+4']).flat()));
        g.hands = Object.fromEntries(g.players.map(p => [p, deck.splice(0,7)])); g.deck = deck; g.top = g.deck.pop(); while (g.top.startsWith('🌈')) { g.deck.unshift(g.top); g.top = g.deck.pop(); } g.turn = 0; g.direction = 1; g.phase = 'playing'; g.pendingColor = null; g.drawPenalty = 0;
        const failed=[]; for (const p of g.players) { try { await sock.sendMessage(p,{text:`🃏 UNO dimulai!\nKartu kamu: ${g.hands[p].join(' | ')}\nKartu atas: ${g.top}\nKirim kartu langsung di grup (contoh 🟢2), atau ketik *ambil*. Kartu juga bisa dimainkan dengan ${prefix}uno play <kartu>.`}); } catch { failed.push(p); } }
        return reply(`🃏 *UNO DIMULAI!*\nKartu atas: ${g.top}\nGiliran: ${playerTag(g.players[g.turn])}\nPemain menerima kartu lewat chat pribadi.`, { mentions: [g.players[g.turn], ...failed] });
      }
      if (g.phase !== 'playing') throw new UserError('UNO belum dimulai.');
      if (sub === 'color') {
        if (!g.pendingColor || g.pendingColor.player !== sender) throw new UserError('Kamu tidak sedang memilih warna.');
        const colorMap = { red: '🔴', merah: '🔴', yellow: '🟡', kuning: '🟡', green: '🟢', hijau: '🟢', blue: '🔵', biru: '🔵', '🔴':'🔴', '🟡':'🟡', '🟢':'🟢', '🔵':'🔵' };
        const chosen = colorMap[(args[1] || '').toLowerCase()];
        if (!chosen) throw new UserError(`Pilih warna: merah, kuning, hijau, atau biru.`);
        g.top = `${chosen}${g.pendingColor.card === '🌈+4' ? '+4' : 'Wild'}`;
        const wasPlusFour = g.pendingColor.card === '🌈+4';
        g.pendingColor = null;
        if (wasPlusFour) { const target = g.players[(g.turn + g.direction + g.players.length) % g.players.length]; for (let i=0;i<4;i++) { if (!g.deck.length) g.deck = shuffle(g.players.flatMap(p => p === target ? [] : g.hands[p])); const c = g.deck.pop(); if (c) g.hands[target].push(c); } g.turn = (g.turn + 2*g.direction + g.players.length*2) % g.players.length; }
        else g.turn = (g.turn + g.direction + g.players.length) % g.players.length;
        return sock.sendMessage(jid, { text: `🎨 ${playerTag(sender)} memilih warna ${chosen}${wasPlusFour ? '\n➕4: pemain berikutnya mengambil 4 kartu dan kehilangan giliran.' : ''}\nKartu atas: ${g.top}\nGiliran: ${playerTag(g.players[g.turn])}`, mentions: [sender, g.players[g.turn]] });
      }
      if (sub === 'hand') return sock.sendMessage(sender,{text:`🃏 Kartu kamu:\n${(g.hands[sender]||[]).join(' | ') || '(kosong)'}`});
      if (sub === 'draw') {
        if (g.players[g.turn] !== sender) throw new UserError(`Belum giliranmu. Giliran ${playerTag(g.players[g.turn])}.`);
        if (!g.deck.length) g.deck = shuffle(g.players.flatMap(p => g.hands[p]));
        const card = g.deck.pop(); g.hands[sender].push(card); const old = g.turn; g.turn = (g.turn+1)%g.players.length;
        await sock.sendMessage(sender,{text:`Kamu mengambil ${card}. Kartu kamu: ${g.hands[sender].join(' | ')}`});
        return sock.sendMessage(jid,{text:`➕ ${playerTag(sender)} mengambil kartu. Kartu atas: ${g.top}\nGiliran: ${playerTag(g.players[g.turn])}`,mentions:[sender,g.players[g.turn]]});
      }
      if (sub === 'play') {
        if (g.players[g.turn] !== sender) throw new UserError(`Belum giliranmu. Giliran ${playerTag(g.players[g.turn])}.`);
        const card = args.slice(1).join('').replace(/\s/g, ''); const hand = g.hands[sender]; const actual = hand?.find(c => c.toLowerCase() === card.toLowerCase() || c.replace(/\s/g,'').toLowerCase() === card.toLowerCase());
        if (!actual) throw new UserError(`Kartu tidak ditemukan. Lihat ${prefix}uno hand.`);
        const colorOf = c => COLORS.find(x => c.startsWith(x));
        const actionOf = c => c.endsWith('+2') ? '+2' : /Skip$/i.test(c) ? 'Skip' : /Reverse$/i.test(c) ? 'Reverse' : c === '🌈Wild' || c.endsWith('Wild') ? 'Wild' : c === '🌈+4' || c.endsWith('+4') ? '+4' : null;
        const sameAction = actionOf(actual) && actionOf(actual) === actionOf(g.top);
        const sameNumber = /^\D*\d$/.test(actual) && actual.replace(/^\D+/, '') === g.top.replace(/^\D+/, '');
        if (!(actual.startsWith('🌈') || g.top.startsWith('🌈') || actual === g.top || (colorOf(actual) && colorOf(actual) === colorOf(g.top)) || sameNumber || sameAction)) throw new UserError(`Kartu ${actual} tidak cocok dengan kartu atas ${g.top}.`);
        hand.splice(hand.indexOf(actual),1);
        if (actual.startsWith('🌈')) {
          g.pendingColor = { player: sender, card: actual };
          const sections = [{ title: 'Pilih warna', rows: [
            { title: '🔴 Merah', rowId: `${prefix}uno color red`, description: 'Lanjut dengan warna merah' },
            { title: '🟡 Kuning', rowId: `${prefix}uno color yellow`, description: 'Lanjut dengan warna kuning' },
            { title: '🟢 Hijau', rowId: `${prefix}uno color green`, description: 'Lanjut dengan warna hijau' },
            { title: '🔵 Biru', rowId: `${prefix}uno color blue`, description: 'Lanjut dengan warna biru' },
          ] }];
          g.top = actual;
          return sock.sendMessage(jid, { text: `🎨 ${playerTag(sender)} memainkan ${actual}. Pilih warna berikutnya dari menu di bawah (atau ketik merah/kuning/hijau/biru):`, footer: 'UNO Mini', title: 'UNO — Pilih Warna', buttonText: 'PILIH WARNA', sections, mentions: [sender] });
        }
        g.top=actual;
        if (!hand.length) { lobbies.delete(jid); return sock.sendMessage(jid,{text:`🏆 *UNO SELESAI!*\n${playerTag(sender)} menang!`,mentions:[sender]}); }
        let step = 1;
        if (/Reverse$/.test(actual)) { g.direction *= -1; if (g.players.length === 2) step = 2; }
        if (/Skip$/.test(actual)) step = 2;
        if (actual.endsWith('+2')) { const target = g.players[(g.turn + g.direction + g.players.length) % g.players.length]; for (let i=0;i<2;i++) { if (!g.deck.length) g.deck = shuffle(g.players.flatMap(p => p === target ? [] : g.hands[p])); const c = g.deck.pop(); if (c) g.hands[target].push(c); } step = 2; }
        g.turn=(g.turn+step*g.direction+g.players.length*2)%g.players.length;
        for (const p of g.players) if (p !== sender) sock.sendMessage(p,{text:`🃏 ${playerTag(sender)} memainkan ${actual}. Kartu atas sekarang ${g.top}. ${playerTag(g.players[g.turn])} mendapat giliran.`,mentions:[sender,g.players[g.turn]]}).catch(()=>{});
        return sock.sendMessage(jid,{text:`🃏 ${playerTag(sender)} memainkan ${actual}${hand.length===1?' — *UNO!*':''}\nKartu atas: ${g.top}\nGiliran: ${playerTag(g.players[g.turn])}`,mentions:[sender,g.players[g.turn]]});
      }
      if (sub === 'end') { if (sender !== g.host) throw new UserError('Hanya host.'); lobbies.delete(jid); return reply('🛑 UNO diakhiri host.'); }
      throw new UserError(`Gunakan ${prefix}uno start|join|begin|hand|play <kartu>|color <warna>|draw|end. Saat giliranmu, kartu bisa dikirim langsung di grup atau ketik ambil.`);
    },
  },
  {
    name: 'battle', aliases: ['duel'], category: 'Game', usage: '@anggota', desc: 'Duel karakter singkat dengan anggota grup',
    async run({ jid, isGroup, sender, mentioned, reply, prefix }) {
      needGroup(isGroup); const target = mentioned[0]; if (!target) throw new UserError(`Tag lawan. Contoh: ${prefix}battle @anggota`); if (target === sender) throw new UserError('Tidak bisa menantang diri sendiri.');
      const a = { hp: 100, atk: 15 + Math.floor(Math.random()*26) }, b = { hp: 100, atk: 15 + Math.floor(Math.random()*26) };
      const log=[]; let turn=0; while(a.hp>0 && b.hp>0 && turn<8) { const dmg=10+Math.floor(Math.random()*26); if(turn%2===0){b.hp=Math.max(0,b.hp-dmg);log.push(`⚔️ ${playerTag(sender)} menyerang ${playerTag(target)} (-${dmg} HP)`);}else{a.hp=Math.max(0,a.hp-dmg);log.push(`🛡️ ${playerTag(target)} membalas (-${dmg} HP)`);}turn++; }
      const winner = a.hp===b.hp ? null : a.hp>b.hp ? sender : target;
      return reply(`⚔️ *BATTLE ARENA*\n${playerTag(sender)} VS ${playerTag(target)}\n\n${log.join('\n')}\n\n❤️ ${playerTag(sender)}: ${a.hp} HP\n❤️ ${playerTag(target)}: ${b.hp} HP\n\n${winner ? `🏆 Pemenang: ${playerTag(winner)}!` : '🤝 Seri!'}`,{mentions:[sender,target,...(winner?[winner]:[])]});
    },
  },
  { name: 'truth', category: 'Game', desc: 'Pertanyaan truth acak untuk grup', async run({ isGroup, reply, sender }) { needGroup(isGroup); await reply(`🎭 *TRUTH TIME*\nGiliran: ${playerTag(sender)}\n${pick(TRUTH)}\n\nJawab jujur, tetap saling menghormati 😄`, { mentions:[sender] }); } },
  { name: 'dare', category: 'Game', desc: 'Tantangan dare acak untuk grup', async run({ isGroup, reply, sender }) { needGroup(isGroup); await reply(`🔥 *DARE TIME*\nGiliran: ${playerTag(sender)}\n${pick(DARE)}\n\nBoleh skip kalau tidak nyaman.`, { mentions:[sender] }); } },
];
