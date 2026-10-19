import crypto from 'node:crypto';
import { createMusic, snapshot, applyAction, keyMatches, createAttemptLimiter } from './music.js';

export function attachUno(io, hooks = {}) {
const rooms = new Map();
const globalMusic = createMusic();
const adminLimiter = createAttemptLimiter();
// Room selalu dibuat lewat sini supaya semua field wajib (hands, music) ada.
const newRoom = (code, extra = {}) => ({ code, players: [], hands: {}, status: 'lobby', message: '', music: createMusic(), ...extra });
const isOwner = (room, id) => room.players[0]?.id === id;
// Dipakai server HTTP (upload musik): siapa owner room, dan file mana yang sedang dipakai.
hooks.isRoomOwner = (sid) => { const room = rooms.get(io.sockets.sockets.get(sid)?.data?.roomCode); return !!room && isOwner(room, sid); };
hooks.inUse = () => new Set([globalMusic.url, ...[...rooms.values()].map(r => r.music.url)].filter(Boolean));
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_EMOJI = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' };
const ACTIONS = ['skip', 'reverse', '+2'];
const uid = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const shuffled = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
function makeDeck() {
  const d = [];
  for (const color of COLORS) {
    d.push({ color, value: '0' });
    for (let n = 1; n <= 9; n++) { d.push({ color, value: String(n) }, { color, value: String(n) }); }
    for (const a of ACTIONS) d.push({ color, value: a }, { color, value: a });
  }
  for (let i = 0; i < 4; i++) d.push({ color: 'wild', value: 'wild' }, { color: 'wild', value: '+4' });
  return shuffled(d);
}
function refill(g) {
  if (g.deck.length) return;
  const top = g.discard.pop();
  g.deck = shuffled(g.discard);
  g.discard = top ? [top] : [];
}
function drawCards(g, player, count) {
  for (let i = 0; i < count; i++) { refill(g); if (g.deck.length) g.hands[player.id].push(g.deck.pop()); }
}
function nextIndex(g, from = g.turn) { return (from + g.direction + g.players.length) % g.players.length; }
function playerAt(g, i) { return g.players[(i + g.players.length) % g.players.length]; }
function canPlay(card, top, chosenColor) {
  if (!card || !top) return false;
  if (card.color === 'wild') return true;
  const activeColor = chosenColor || top.color;
  return card.color === activeColor || card.value === top.value;
}
function startGame(room) {
  room.deck = makeDeck(); room.discard = []; room.hands = {}; room.turn = 0; room.direction = 1;
  room.stackType = null; room.penalty = 0; room.pendingColor = null; room.stackLastPlayerId = null; room.winner = null; room.status = 'playing'; room.chosenColor = null;
  for (const p of room.players) { room.hands[p.id] = []; drawCards(room, p, 7); }
  let first = room.deck.pop(); while (first && first.color === 'wild') { room.deck.unshift(first); first = room.deck.pop(); }
  room.discard.push(first || { color: 'red', value: '0' });
  room.chosenColor = room.discard[0].color;
  if (room.discard[0].value === 'reverse' && room.players.length === 2) room.direction = -1;
  if (room.discard[0].value === 'skip') room.turn = 1 % room.players.length;
  if (room.discard[0].value === '+2') { drawCards(room, room.players[room.turn], 2); room.turn = nextIndex(room); }
  broadcast(room, 'Game dimulai! Kartu pertama: ' + cardText(room.discard[room.discard.length - 1]));
  emitState(room);
  scheduleAI(room);
}
function cardText(c) { return c.color === 'wild' ? (c.value === '+4' ? '🌈 +4' : '🌈 Wild') : `${COLOR_EMOJI[c.color]} ${c.value}`; }
function publicState(room, viewerId) {
  return {
    code: room.code, status: room.status, players: room.players.map((p, i) => ({ id: p.id, name: p.name, isAI: !!p.isAI, count: (room.hands[p.id] || []).length, turn: i === room.turn })),
    hand: room.hands[viewerId] || [], top: room.discard[room.discard.length - 1], chosenColor: room.chosenColor,
    turnPlayerId: room.players[room.turn]?.id, direction: room.direction, penalty: room.penalty, stackType: room.stackType,
    pendingColor: room.pendingColor ? { playerId: room.pendingColor.playerId } : null, winner: room.winner,
    deckCount: room.deck.length, message: room.message || '', canDraw: room.players[room.turn]?.id === viewerId, isOwner: isOwner(room, viewerId)
  };
}
function emitState(room) { for (const p of room.players) if (!p.isAI) io.to(p.id).emit('game:state', publicState(room, p.id)); }
function broadcast(room, message) { room.message = message; for (const p of room.players) if (!p.isAI) io.to(p.id).emit('game:notice', message); }
function finishIfWon(room, player) {
  if (room.hands[player.id]?.length === 0) { room.status = 'finished'; room.winner = player.id; broadcast(room, `${player.name} menang! 🏆`); emitState(room); return true; }
  return false;
}
function advance(room, steps = 1) { for (let i = 0; i < steps; i++) room.turn = nextIndex(room); }
function playCard(room, player, cardIndex, chosenColor) {
  if (room.status !== 'playing') throw new Error('Game belum berjalan.');
  if (room.players[room.turn]?.id !== player.id) throw new Error('Belum giliran kamu.');
  if (room.pendingColor && room.pendingColor.playerId !== player.id) throw new Error('Tunggu pilihan warna diselesaikan.');
  const hand = room.hands[player.id]; const card = hand?.[cardIndex];
  if (!card) throw new Error('Kartu tidak ditemukan.');
  if (room.penalty > 0 && card.value !== room.stackType) throw new Error(`Kamu harus menumpuk ${room.stackType} atau mengambil ${room.penalty} kartu.`);
  if (!canPlay(card, room.discard[room.discard.length - 1], room.chosenColor)) throw new Error('Kartu itu belum bisa dimainkan.');
  if (card.color === 'wild' && !chosenColor && card.value === 'wild' && room.penalty === 0) { /* choose after removing below */ }
  hand.splice(cardIndex, 1); room.discard.push(card);
  if (card.value === '+2' || card.value === '+4') {
    if (room.penalty > 0 && room.stackType !== card.value) throw new Error('Jenis kartu penalti harus sama.');
    room.stackType = card.value; room.penalty += card.value === '+2' ? 2 : 4;
    room.stackLastPlayerId = player.id; room.chosenColor = card.color === 'wild' ? null : card.color;
    advance(room);
    broadcast(room, `${player.name} memainkan ${cardText(card)}. Pemain berikutnya bisa menumpuk ${card.value}, atau mengambil ${room.penalty} kartu.`);
    if (finishIfWon(room, player)) return;
  } else if (card.color === 'wild') {
    if (!chosenColor || !COLORS.includes(chosenColor)) {
      hand.splice(cardIndex, 0, card); room.discard.pop(); room.pendingColor = { playerId: player.id, cardIndex };
      broadcast(room, `${player.name} harus memilih warna.`); emitState(room); return;
    }
    room.chosenColor = chosenColor; room.pendingColor = null; advance(room);
    broadcast(room, `${player.name} memilih ${chosenColor}.`);
    if (finishIfWon(room, player)) return;
  } else {
    room.chosenColor = card.color; room.stackType = null; room.penalty = 0; room.pendingColor = null;
    if (card.value === 'reverse') { room.direction *= -1; if (room.players.length === 2) advance(room, 2); else advance(room); }
    else if (card.value === 'skip') advance(room, 2);
    else advance(room);
    broadcast(room, `${player.name} memainkan ${cardText(card)}.`);
    if (finishIfWon(room, player)) return;
  }
  emitState(room); scheduleAI(room);
}
function chooseColor(room, player, color) {
  if (!room.pendingColor || room.pendingColor.playerId !== player.id) throw new Error('Tidak sedang menunggu pilihan warna kamu.');
  if (!COLORS.includes(color)) throw new Error('Warna tidak valid.');
  if (room.pendingColor.mode === 'stack') { room.chosenColor = color; room.pendingColor = null; room.stackType = null; room.stackLastPlayerId = null; broadcast(room, `${player.name} memilih warna ${color} setelah stack +4.`); emitState(room); scheduleAI(room); return; }
  const hand = room.hands[player.id]; const card = hand.splice(room.pendingColor.cardIndex, 1)[0];
  room.discard.push(card); room.chosenColor = color; room.pendingColor = null;
  broadcast(room, `${player.name} memilih ${color}.`);
  if (finishIfWon(room, player)) return;
  advance(room); emitState(room); scheduleAI(room);
}
function drawTurn(room, player) {
  if (room.status !== 'playing' || room.players[room.turn]?.id !== player.id) throw new Error('Belum giliran kamu.');
  if (room.pendingColor) throw new Error('Pilih warna terlebih dahulu.');
  if (room.penalty > 0) {
    const amount = room.penalty; const endedStack = room.stackType; const colorPickerId = room.stackLastPlayerId; drawCards(room, player, amount); room.penalty = 0;
    broadcast(room, `${player.name} mengambil ${amount} kartu penalti.`); advance(room);
    if (endedStack === '+4' && colorPickerId) { room.pendingColor = { playerId: colorPickerId, mode: 'stack' }; const chooser = room.players.find(p => p.id === colorPickerId); if (chooser?.isAI) { room.chosenColor = COLORS[Math.floor(Math.random()*COLORS.length)]; room.pendingColor = null; room.stackType = null; room.stackLastPlayerId = null; } else broadcast(room, `Stack +4 berakhir. ${chooser?.name || 'Pemain terakhir'} pilih warna.`); } else { room.stackType = null; room.stackLastPlayerId = null; }
    emitState(room); scheduleAI(room); return;
  }
  drawCards(room, player, 1);
  const hand = room.hands[player.id]; const drawn = hand[hand.length - 1];
  if (canPlay(drawn, room.discard[room.discard.length - 1], room.chosenColor)) broadcast(room, `${player.name} mengambil satu kartu. Bisa dimainkan jika cocok.`);
  else { broadcast(room, `${player.name} mengambil satu kartu dan melewatkan giliran.`); advance(room); }
  emitState(room); scheduleAI(room);
}
function aiMove(room, ai) {
  if (room.status !== 'playing' || room.players[room.turn]?.id !== ai.id || room.pendingColor) return;
  const hand = room.hands[ai.id] || [];
  if (room.penalty > 0) {
    const idx = hand.findIndex(c => c.value === room.stackType);
    if (idx >= 0) return playCard(room, ai, idx, room.stackType === '+4' ? COLORS[Math.floor(Math.random() * 4)] : undefined);
    return drawTurn(room, ai);
  }
  const valid = hand.map((c, i) => ({ c, i })).filter(x => canPlay(x.c, room.discard[room.discard.length - 1], room.chosenColor));
  if (!valid.length) return drawTurn(room, ai);
  const level = room.aiDifficulty || 'normal';
  valid.sort((a, b) => {
    const score = x => (x.c.value === '+4' ? (level === 'hard' ? 7 : 3) : x.c.value === '+2' ? 5 : ['skip','reverse'].includes(x.c.value) ? 3 : 0) + (x.c.color === room.chosenColor ? -1 : 0);
    return score(b) - score(a);
  });
  const chosen = level === 'easy' ? valid[Math.floor(Math.random() * valid.length)] : valid[0];
  const color = chosen.c.color === 'wild' ? COLORS.sort((a,b) => hand.filter(c=>c.color===b).length - hand.filter(c=>c.color===a).length)[0] : undefined;
  playCard(room, ai, chosen.i, color);
}
function scheduleAI(room) {
  if (room.status !== 'playing') return;
  const p = room.players[room.turn];
  if (p?.isAI) setTimeout(() => { if (rooms.get(room.code) === room) aiMove(room, p); }, 700 + Math.random() * 700);
}
function safeRoom(code) { const room = rooms.get(String(code || '').toUpperCase()); if (!room) throw new Error('Room tidak ditemukan.'); return room; }
function joinRoom(socket, room, name) {
  if (room.status !== 'lobby') throw new Error('Game sudah dimulai.');
  if (room.players.length >= 4) throw new Error('Room sudah penuh (maksimal 4 pemain).');
  if (room.players.some(p => p.id === socket.id)) return;
  const player = { id: socket.id, name: String(name || 'Player').trim().slice(0, 18) || 'Player', isAI: false };
  room.players.push(player); room.hands[player.id] = []; socket.join(room.code); socket.data.roomCode = room.code;
  socket.emit('music:state', { scope: 'room', code: room.code, state: snapshot(room.music) });
  broadcast(room, `${player.name} bergabung ke room.`); emitLobby(room);
}
function emitLobby(room) {
  for (const p of room.players) if (!p.isAI) io.to(p.id).emit('room:state', { code: room.code, players: room.players.map(x => ({ name: x.name, isAI: x.isAI })), canStart: isOwner(room, p.id) && room.players.length >= 2, isOwner: isOwner(room, p.id) });
}
function findRoomForSocket(socket) { return safeRoom(socket.data.roomCode); }
function replyError(socket, err) { socket.emit('app:error', err.message || 'Terjadi kesalahan.'); }
function removePlayer(socket) {
  const code = socket.data.roomCode; socket.data.roomCode = null;
  if (!code) return;
  socket.leave(code);
  const room = rooms.get(code); if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id); delete room.hands[socket.id];
  if (!room.players.some(p => !p.isAI)) { rooms.delete(code); return; }
  if (room.status === 'playing') { room.status = 'finished'; broadcast(room, 'Pemain keluar. Pertandingan dihentikan.'); emitState(room); }
  else if (room.status === 'lobby') emitLobby(room);
  else emitState(room);
}
function reply(cb, payload) { if (typeof cb === 'function') cb(payload); }
io.on('connection', socket => {
  socket.emit('music:state', { scope: 'global', state: snapshot(globalMusic) });
  socket.on('room:create', ({ name } = {}) => {
    try { removePlayer(socket); const code = uid(); const room = newRoom(code); rooms.set(code, room); joinRoom(socket, room, name); socket.emit('room:created', { code }); }
    catch (e) { replyError(socket, e); }
  });
  socket.on('room:join', ({ code, name } = {}) => { try { const room = safeRoom(code); if (socket.data.roomCode !== room.code) removePlayer(socket); joinRoom(socket, room, name); } catch (e) { replyError(socket, e); } });
  socket.on('room:ai', ({ name, difficulty } = {}) => {
    try { removePlayer(socket); const code = uid(); const room = newRoom(code, { aiDifficulty: ['easy','normal','hard'].includes(difficulty) ? difficulty : 'normal' }); rooms.set(code, room); joinRoom(socket, room, name); for (let i = 1; i <= 3; i++) room.players.push({ id: `AI-${code}-${i}`, name: ['Nova','Pixel','Rex'][i-1], isAI: true }); socket.emit('room:created', { code }); startGame(room); } catch (e) { replyError(socket, e); }
  });
  socket.on('room:quick', ({ name } = {}) => {
    try { const current = rooms.get(socket.data.roomCode); if (!current || current.status !== 'lobby') removePlayer(socket); let room = current && current.status === 'lobby' ? current : [...rooms.values()].find(r => r.status === 'lobby' && r.players.length < 4 && r.players.some(p => !p.isAI)); if (!room) { const code = uid(); room = newRoom(code); rooms.set(code, room); } joinRoom(socket, room, name); socket.emit('room:created', { code: room.code }); }
    catch (e) { replyError(socket, e); }
  });
  socket.on('room:leave', () => { removePlayer(socket); socket.emit('room:left'); });
  socket.on('game:uno', () => { try { const room = findRoomForSocket(socket); const p = room.players.find(x => x.id === socket.id); if (p && room.hands[p.id]?.length === 2) broadcast(room, `${p.name} memanggil UNO!`); } catch (_) {} });
  socket.on('game:chat', ({ message, reaction = false, stickerId } = {}) => { try { const room = findRoomForSocket(socket); const p = room.players.find(x => x.id === socket.id && !x.isAI); if (!p || !['playing','lobby'].includes(room.status)) return; const allowedStickers = new Set(['ez','capek','santai','serius','kzl','wkwk','sedih','gas','skip','awww','mantap','clown']); const safeSticker = allowedStickers.has(String(stickerId || '')) ? String(stickerId) : null; const clean = String(message || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180); if (!clean && !safeSticker) return; const item = { name: String(p.name).slice(0,18), message: clean, reaction: !!reaction, ...(safeSticker ? { stickerId: safeSticker } : {}), at: Date.now() }; for (const player of room.players) if (!player.isAI) io.to(player.id).emit('game:chat', item); } catch (_) {} });
  socket.on('room:start', () => { try { const room = findRoomForSocket(socket); if (room.players[0]?.id !== socket.id) throw new Error('Hanya pembuat room yang bisa memulai.'); if (room.players.length < 2) throw new Error('Butuh minimal 2 pemain.'); startGame(room); } catch (e) { replyError(socket, e); } });
  socket.on('game:play', ({ index, color } = {}) => { try { const room = findRoomForSocket(socket); playCard(room, room.players.find(p => p.id === socket.id), Number(index), color); } catch (e) { replyError(socket, e); } });
  socket.on('game:color', ({ color } = {}) => { try { const room = findRoomForSocket(socket); chooseColor(room, room.players.find(p => p.id === socket.id), color); } catch (e) { replyError(socket, e); } });
  socket.on('game:draw', () => { try { const room = findRoomForSocket(socket); drawTurn(room, room.players.find(p => p.id === socket.id)); } catch (e) { replyError(socket, e); } });
  socket.on('game:restart', () => { try { const room = findRoomForSocket(socket); if (room.players[0]?.id !== socket.id) throw new Error('Hanya pembuat room yang bisa memulai ulang.'); startGame(room); } catch (e) { replyError(socket, e); } });

  // ---- Musik ----
  // Global: hanya admin (UNO_ADMIN_KEY di Railway Variables). Berlaku untuk semua pengunjung.
  socket.on('music:global', ({ key, action, url } = {}, cb) => {
    try {
      const expected = process.env.UNO_ADMIN_KEY || '';
      if (!expected) throw new Error('UNO_ADMIN_KEY belum diset di Railway Variables.');
      if (adminLimiter.blocked(socket.id)) throw new Error('Terlalu banyak percobaan. Coba lagi 1 menit lagi.');
      if (!keyMatches(key, expected)) { adminLimiter.fail(socket.id); throw new Error('Admin key salah.'); }
      adminLimiter.ok(socket.id);
      if (action !== 'auth') { applyAction(globalMusic, action, url); io.emit('music:state', { scope: 'global', state: snapshot(globalMusic) }); }
      reply(cb, { ok: true });
    } catch (e) { reply(cb, { ok: false, error: e.message || 'Gagal.' }); }
  });
  // Room: hanya pemilik room (pemain pertama). Pemain lain hanya mengikuti.
  socket.on('music:room', ({ action, url } = {}, cb) => {
    try {
      const room = findRoomForSocket(socket);
      if (!isOwner(room, socket.id)) throw new Error('Hanya owner room yang bisa mengatur musik room.');
      applyAction(room.music, action, url);
      io.to(room.code).emit('music:state', { scope: 'room', code: room.code, state: snapshot(room.music) });
      reply(cb, { ok: true });
    } catch (e) { reply(cb, { ok: false, error: e.message || 'Gagal.' }); }
  });

  socket.on('disconnect', () => { adminLimiter.forget(socket.id); removePlayer(socket); });
});

}
