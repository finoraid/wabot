import { UserError, num } from '../utils.js';

// Lightweight social competition games. State is in-memory; active rounds reset on process restart.
const quizzes = new Map();
const clans = new Map();
const memberships = new Map();
const portfolios = new Map();
const market = { BTC: 65000, ETH: 3200, SOL: 145, XRP: 0.55 };
const fmt = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const tag = jid => `@${num(jid)}`;
const needGroup = isGroup => { if (!isGroup) throw new UserError('Game ini hanya bisa digunakan di grup.'); };
const questions = [
  { q: 'Planet terbesar di Tata Surya?', opts: ['Bumi', 'Jupiter', 'Saturnus', 'Mars'], a: 1 },
  { q: 'Hasil 12 × 8?', opts: ['86', '92', '96', '108'], a: 2 },
  { q: 'Organ utama untuk memompa darah?', opts: ['Paru-paru', 'Hati', 'Ginjal', 'Jantung'], a: 3 },
  { q: 'Ibu kota Jepang?', opts: ['Kyoto', 'Tokyo', 'Osaka', 'Nagoya'], a: 1 },
  { q: 'Gas yang diserap tumbuhan saat fotosintesis?', opts: ['Oksigen', 'Nitrogen', 'Karbon dioksida', 'Hidrogen'], a: 2 },
  { q: 'Berapa sisi pada segi enam?', opts: ['5', '6', '7', '8'], a: 1 },
  { q: 'Bahasa yang umum dipakai untuk styling web?', opts: ['CSS', 'SQL', 'Bash', 'Rust'], a: 0 },
  { q: 'Benua terbesar di dunia?', opts: ['Afrika', 'Eropa', 'Asia', 'Amerika Selatan'], a: 2 },
];
function portfolio(jid) { if (!portfolios.has(jid)) portfolios.set(jid, { cash: 10000, holdings: {} }); return portfolios.get(jid); }

// Dipakai handler untuk menerima jawaban A/B/C/D langsung saat ronde aktif.
export function hasActiveQuiz(jid) { const g = quizzes.get(jid); return !!g && Date.now() - g.at <= 25000; }

export default [
 { name:'quizbattle', aliases:['qbattle'], category:'Game', usage:'start | jawab <A-D> | score', desc:'Kuis kompetitif grup dengan skor', async run({jid,isGroup,sender,args,reply,prefix}) {
   needGroup(isGroup); const sub=(args[0]||'help').toLowerCase();
   if(sub==='start') { const q=questions[Math.floor(Math.random()*questions.length)]; const old=quizzes.get(jid); if(old && Date.now()-old.at<25000) throw new UserError('Ronde masih aktif. Tunggu 25 detik atau cek .quizbattle score.'); quizzes.set(jid,{q,at:Date.now(),scores:old?.scores||{}}); return reply(`🧠 *QUIZ BATTLE*\n${q.q}\n\nA) ${q.opts[0]}\nB) ${q.opts[1]}\nC) ${q.opts[2]}\nD) ${q.opts[3]}\n\nJawab cukup ketik *A*, *B*, *C*, atau *D* (tanpa command).\nRonde berakhir dalam 25 detik.`); }
   if(sub==='jawab') { const g=quizzes.get(jid); if(!g || Date.now()-g.at>25000) throw new UserError(`Belum ada ronde aktif. Ketik ${prefix}quizbattle start.`); const choice=(args[1]||'').toUpperCase(); if(!['A','B','C','D'].includes(choice)) throw new UserError(`Format: ${prefix}quizbattle jawab A`); if(g.scores[sender]?.round===g.at) throw new UserError('Kamu sudah menjawab ronde ini.'); const correct='ABCD'[g.q.a]===choice; g.scores[sender]={points:(g.scores[sender]?.points||0)+(correct?10:0),round:g.at}; if(correct) return reply(`✅ Benar, ${tag(sender)}! +10 poin.`,{mentions:[sender]}); return reply(`❌ Belum tepat, ${tag(sender)}.`,{mentions:[sender]}); }
   if(sub==='score') { const g=quizzes.get(jid); if(!g) throw new UserError('Belum ada skor. Mulai dengan .quizbattle start.'); const rows=Object.entries(g.scores).sort((a,b)=>b[1].points-a[1].points).slice(0,10); return reply(`🏆 *QUIZ BATTLE SCORE*\n${rows.length?rows.map(([p,v],i)=>`${i+1}. ${tag(p)} — ${v.points} poin`).join('\n'):'Belum ada jawaban.'}`,{mentions:rows.map(([p])=>p)}); }
   throw new UserError(`Gunakan ${prefix}quizbattle start|jawab A|score`);
 }},
 { name:'clan', category:'Game', usage:'create <nama> | join <nama> | leave | info | rank | war <nama>', desc:'Buat clan dan kompetisi antaranggota', async run({jid,isGroup,sender,args,reply,prefix}) {
   needGroup(isGroup); const sub=(args[0]||'help').toLowerCase(); const name=args.slice(1).join(' ').trim();
   if(sub==='create') { if(!name || name.length>20) throw new UserError(`Format: ${prefix}clan create <nama> (maks. 20 karakter).`); if(memberships.has(sender)) throw new UserError('Kamu sudah bergabung dengan clan. Keluar dulu dengan .clan leave.'); const key=name.toLowerCase(); if(clans.has(key)) throw new UserError('Nama clan sudah dipakai.'); clans.set(key,{name,leader:sender,members:[sender],points:0}); memberships.set(sender,key); return reply(`🛡️ Clan *${name}* berhasil dibuat!\nAnggota: ${tag(sender)}\nUndang teman: ${prefix}clan join ${name}`,{mentions:[sender]}); }
   if(sub==='join') { if(!name) throw new UserError(`Format: ${prefix}clan join <nama>`); if(memberships.has(sender)) throw new UserError('Kamu sudah punya clan.'); const key=name.toLowerCase(), c=clans.get(key); if(!c) throw new UserError('Clan tidak ditemukan.'); c.members.push(sender); memberships.set(sender,key); return reply(`🤝 ${tag(sender)} bergabung dengan *${c.name}*!`,{mentions:[sender]}); }
   if(sub==='leave') { const key=memberships.get(sender); if(!key) throw new UserError('Kamu belum punya clan.'); const c=clans.get(key); if(c.leader===sender && c.members.length>1) throw new UserError('Leader harus memindahkan kepemimpinan sebelum keluar.'); c.members=c.members.filter(p=>p!==sender); memberships.delete(sender); if(!c.members.length) clans.delete(key); return reply('Kamu sudah keluar dari clan.'); }
   if(sub==='info') { const key=memberships.get(sender); const c=key&&clans.get(key); if(!c) throw new UserError('Kamu belum punya clan. Gunakan .clan create <nama>.'); return reply(`🛡️ *${c.name}*\nLeader: ${tag(c.leader)}\nAnggota (${c.members.length}): ${c.members.map(tag).join(', ')}\nGlory: ${c.points}`,{mentions:c.members}); }
   if(sub==='rank') { const rows=[...clans.values()].sort((a,b)=>b.points-a.points).slice(0,10); return reply(`🏆 *CLAN RANKING*\n${rows.length?rows.map((c,i)=>`${i+1}. ${c.name} — ${c.points} glory (${c.members.length} anggota)`).join('\n'):'Belum ada clan.'}`); }
   if(sub==='war') { const mine=memberships.get(sender), a=mine&&clans.get(mine), b=clans.get(name.toLowerCase()); if(!a) throw new UserError('Buat atau bergabung dengan clan dulu.'); if(!b) throw new UserError('Clan lawan tidak ditemukan.'); if(a===b) throw new UserError('Clan tidak bisa menantang dirinya sendiri.'); const ap=a.members.length, bp=b.members.length; const aw=Math.random()*ap/(ap+bp)>.5; const winner=aw?a:b; winner.points+=10; return reply(`⚔️ *CLAN WAR*\n${a.name} (${ap} anggota) VS ${b.name} (${bp} anggota)\n🏆 Pemenang simulasi: *${winner.name}*\n+10 Glory\n\nCatatan: hasil ini simulasi acak sederhana, belum duel anggota secara langsung.`); }
   throw new UserError(`Gunakan ${prefix}clan create <nama>|join <nama>|leave|info|rank|war <nama>`);
 }},
 { name:'market', aliases:['stock'], category:'Game', usage:'prices | portfolio | buy <aset> <jumlah> | sell <aset> <jumlah>', desc:'Simulasi bursa aset dengan uang virtual', async run({isGroup,sender,args,reply,prefix}) {
   needGroup(isGroup); const sub=(args[0]||'prices').toLowerCase(), p=portfolio(sender);
   if(sub==='prices') return reply(`📈 *VIRTUAL MARKET*\n${Object.entries(market).map(([s,v])=>`${s}: ${fmt(v)} koin`).join('\n')}\n\nModal awal: 10.000 koin virtual\n${prefix}market buy BTC 1000`);
   if(sub==='portfolio') return reply(`💼 *PORTOFOLIO*\nCash: ${fmt(p.cash)}\n${Object.entries(p.holdings).map(([s,q])=>`${s}: ${fmt(q)} unit (nilai ${fmt(q*market[s])})`).join('\n')||'Belum punya aset.'}\nTotal aset: ${fmt(p.cash+Object.entries(p.holdings).reduce((n,[s,q])=>n+q*market[s],0))}`);
   if(sub==='buy'||sub==='sell') { const symbol=(args[1]||'').toUpperCase(), amount=Number(args[2]); if(!(symbol in market)) throw new UserError('Aset tersedia: BTC, ETH, SOL, XRP.'); if(!Number.isFinite(amount)||amount<=0) throw new UserError(`Format: ${prefix}market ${sub} BTC 1000 (jumlah dalam koin virtual).`); if(sub==='buy') { if(amount>p.cash) throw new UserError('Saldo koin virtual tidak cukup.'); p.cash-=amount; p.holdings[symbol]=(p.holdings[symbol]||0)+amount/market[symbol]; return reply(`🟢 Pembelian simulasi berhasil: ${fmt(amount/market[symbol])} ${symbol}\nBiaya: ${fmt(amount)} koin\nSisa saldo: ${fmt(p.cash)}`); } const units=amount; if(units>(p.holdings[symbol]||0)) throw new UserError('Unit aset tidak cukup. Cek .market portfolio.'); p.holdings[symbol]-=units; const proceeds=units*market[symbol]; p.cash+=proceeds; return reply(`🔴 Penjualan simulasi: ${fmt(units)} ${symbol}\nHasil: ${fmt(proceeds)} koin virtual\nSaldo: ${fmt(p.cash)}`); }
   if(sub==='tick') { if(!args[1] || !Number.isFinite(Number(args[1]))) throw new UserError('Format: .market tick <persen>, misalnya .market tick 3'); const pct=Math.max(-20,Math.min(20,Number(args[1])))/100; for(const s of Object.keys(market)) market[s]=Math.max(.01,market[s]*(1+pct*(Math.random()*.8+.6))); return reply('📊 Harga simulasi diperbarui. Ketik .market prices untuk melihat harga baru.'); }
   throw new UserError(`Gunakan ${prefix}market prices|portfolio|buy BTC 1000|sell BTC 0.01`);
 }}
];
