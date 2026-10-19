(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();
  let myName = '', roomCode = '', state = null, lobby = null, previousHandCount = 0, audioCtx = null, toastTimer = null, chosenCardIndex = null, localObjectUrl = null;
  const audio = $('musicAudio');
  const COLOR_NAMES = { red: 'RED', yellow: 'YELLOW', green: 'GREEN', blue: 'BLUE' };
  const CARD_COLORS = { red: 'color-red', yellow: 'color-yellow', green: 'color-green', blue: 'color-blue', wild: 'color-wild' };
  function showScreen(id) { document.querySelectorAll('.screen').forEach(x => x.classList.remove('active')); $(id).classList.add('active'); }
  function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2800); }
  function nameValue() { const n = $('playerName').value.trim().replace(/[<>]/g, '').slice(0, 18); if (!n) { toast('Masukkan nama pemain dulu ya.'); $('playerName').focus(); return null; } myName = n; return n; }
  function playSfx(type) {
    const volume = Number($('sfxVolume')?.value ?? 70) / 100; if (!volume) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime; const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
      const presets = { play: [420, 210, .11], draw: [230, 150, .13], wild: [380, 720, .3], win: [520, 880, .4], lose: [240, 90, .35], uno: [600, 950, .22], click: [300, 380, .045] };
      const p = presets[type] || presets.click; osc.type = type === 'wild' || type === 'win' || type === 'uno' ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(p[0], now); osc.frequency.exponentialRampToValueAtTime(Math.max(40, p[1]), now + p[2]);
      filter.type = 'lowpass'; filter.frequency.value = 2200; gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, .15 * volume), now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + p[2]); osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination); osc.start(now); osc.stop(now + p[2] + .02);
    } catch (_) {}
  }
  function setConnection(ok) { $('connectionLabel').textContent = ok ? 'Online' : 'Reconnecting…'; document.querySelector('.online-dot').style.background = ok ? '#57e8a6' : '#ffb84d'; }
  function emitRoom(action) { const name = nameValue(); if (!name) return false; socket.emit(action, { name }); return true; }
  $('quickMatch').addEventListener('click', () => { playSfx('click'); emitRoom('room:quick'); });
  $('createRoom').addEventListener('click', () => { playSfx('click'); emitRoom('room:create'); });
  $('joinRoom').addEventListener('click', () => { const name = nameValue(); if (!name) return; const code = $('roomCodeInput').value.trim().toUpperCase(); if (!code) return toast('Masukkan kode room.'); socket.emit('room:join', { name, code }); });
  $('roomCodeInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  $('playAI').addEventListener('click', () => {
    const name = nameValue(); if (!name) return;
    const difficulty = prompt('Pilih tingkat AI: easy, normal, atau hard', 'normal'); if (difficulty === null) return;
    const d = ['easy','normal','hard'].includes(difficulty.trim().toLowerCase()) ? difficulty.trim().toLowerCase() : 'normal';
    socket.emit('room:ai', { name, difficulty: d });
  });
  $('backHome').addEventListener('click', () => { socket.emit('room:leave'); roomCode = ''; lobby = null; showScreen('homeScreen'); });
  $('copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); toast('Kode room disalin!'); } catch (_) { toast('Kode room: ' + roomCode); } });
  $('startGame').addEventListener('click', () => socket.emit('room:start'));
  $('leaveGame').addEventListener('click', () => { if (confirm('Keluar dari pertandingan?')) { socket.emit('room:leave'); state = null; lobby = null; roomCode = ''; showScreen('homeScreen'); } });
  $('drawPile').addEventListener('click', () => { if (state) { playSfx('draw'); socket.emit('game:draw'); } });
  $('drawButton').addEventListener('click', () => { if (state) { playSfx('draw'); socket.emit('game:draw'); } });
  $('unoButton').addEventListener('click', () => { playSfx('uno'); toast('UNO! 🔥'); socket.emit('game:uno'); });
  $('playAgain').addEventListener('click', () => socket.emit('game:restart'));
  $('endHome').addEventListener('click', () => { socket.emit('room:leave'); state = null; lobby = null; roomCode = ''; showScreen('homeScreen'); });
  $('audioSettings').addEventListener('click', openAudio); $('openMusic').addEventListener('click', openAudio); $('closeAudio').addEventListener('click', () => $('audioModal').classList.add('hidden'));
  $('musicFile').addEventListener('change', e => { const f = e.target.files?.[0]; if (!f) return; if (localObjectUrl) URL.revokeObjectURL(localObjectUrl); localObjectUrl = URL.createObjectURL(f); audio.src = localObjectUrl; audio.play().then(() => { $('toggleMusic').textContent = 'Ⅱ PAUSE MUSIC'; $('musicStatus').textContent = 'ON'; }).catch(() => toast('Tekan Play Music untuk mulai.')); });
  $('useMusicUrl').addEventListener('click', () => { const url = $('musicUrl').value.trim(); if (!/^https?:\/\//i.test(url)) return toast('Masukkan URL audio yang valid.'); audio.src = url; audio.play().then(() => { $('toggleMusic').textContent = 'Ⅱ PAUSE MUSIC'; $('musicStatus').textContent = 'ON'; toast('Musik diputar.'); }).catch(() => toast('Audio tidak bisa diputar. Pastikan URL langsung ke file audio dan mendukung CORS.')); });
  $('toggleMusic').addEventListener('click', async () => { if (!audio.src) { toast('Upload musik atau masukkan URL audio dulu.'); return; } if (audio.paused) { try { await audio.play(); $('toggleMusic').textContent = 'Ⅱ PAUSE MUSIC'; $('musicStatus').textContent = 'ON'; } catch (_) { toast('Browser tidak bisa memutar sumber audio ini.'); } } else { audio.pause(); $('toggleMusic').textContent = '▶ PLAY MUSIC'; $('musicStatus').textContent = 'PAUSED'; } });
  $('stopMusic').addEventListener('click', () => { audio.pause(); audio.currentTime = 0; $('toggleMusic').textContent = '▶ PLAY MUSIC'; $('musicStatus').textContent = 'OFF'; });
  $('musicVolume').addEventListener('input', e => { audio.volume = Number(e.target.value) / 100; $('volumeValue').textContent = e.target.value + '%'; }); audio.volume = .35;
  $('sfxVolume').addEventListener('input', e => $('sfxValue').textContent = e.target.value + '%');
  $('usePlatform').addEventListener('click', () => {
    const url = $('platformUrl').value.trim(); if (!url) return toast('Tempel link YouTube atau Spotify.');
    let embed = '';
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
    const sp = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/i);
    if (yt) { embed = `<iframe title="YouTube music player" src="https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&enablejsapi=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; $('platformPlayer').innerHTML = embed; $('platformPlayer').classList.remove('hidden'); $('musicStatus').textContent = 'PLAYER'; toast('Player YouTube siap. Tekan Play di player jika autoplay diblokir.'); }
    else if (sp) { window.open(`https://open.spotify.com/${sp[1]}/${sp[2]}`, '_blank', 'noopener'); toast('Spotify dibuka di tab baru.'); }
    else toast('Link belum didukung. Coba link YouTube atau Spotify.');
  });
  function openAudio() { $('audioModal').classList.remove('hidden'); playSfx('click'); }
  function renderLobby(data) {
    lobby = data; roomCode = data.code || roomCode; $('roomCode').textContent = roomCode; $('lobbyPlayers').innerHTML = '';
    data.players.forEach((p, i) => { const el = document.createElement('div'); el.className = 'lobby-player'; el.innerHTML = `<span class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(p.name)}</strong><small>${i === 0 ? 'ROOM HOST' : p.isAI ? 'AI PLAYER' : 'PLAYER'}</small></div>`; $('lobbyPlayers').appendChild(el); });
    const canStart = !!data.canStart; $('startGame').classList.toggle('hidden', !canStart); $('lobbyHint').textContent = canStart ? 'All set. Start when everyone is ready.' : 'Waiting for the host to start…';
  }
  function cardLabel(card) { return card.color === 'wild' ? (card.value === '+4' ? '+4' : 'WILD') : card.value === 'skip' ? '⊘' : card.value === 'reverse' ? '↻' : card.value; }
  function cardNode(card, index, playable = false) {
    const el = document.createElement('button'); el.type = 'button'; el.className = `uno-card ${CARD_COLORS[card.color] || 'color-wild'}`; el.style.setProperty('--rot', `${Math.max(-8, Math.min(8, (index - 3) * 1.5))}deg`); el.setAttribute('aria-label', `${card.color} ${card.value}`);
    el.innerHTML = `<span class="card-mini">${escapeHtml(cardLabel(card))}</span><span class="card-value">${escapeHtml(cardLabel(card))}</span><span class="card-mini bottom">${escapeHtml(cardLabel(card))}</span>`;
    if (playable) el.addEventListener('click', () => { chosenCardIndex = index; document.querySelectorAll('.player-hand .uno-card').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); playSfx('click'); const c = state.hand[index]; if (c.color === 'wild' && c.value === 'wild') { $('colorPicker').classList.remove('hidden'); $('handTip').textContent = 'Choose a color above'; } else if (c.value === '+4' && state.penalty > 0) { socket.emit('game:play', { index }); } else socket.emit('game:play', { index }); });
    return el;
  }
  function renderGame(s) {
    state = s; showScreen('gameScreen'); $('roomPill').textContent = 'ROOM ' + s.code; $('opponents').innerHTML = '';
    s.players.filter(p => p.id !== socket.id).forEach(p => { const el = document.createElement('div'); el.className = 'opponent' + (p.turn ? ' active-turn' : ''); el.innerHTML = `<span class="avatar">${p.isAI ? '🤖' : escapeHtml(p.name.slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(p.name)}</strong><small>${p.count} CARDS</small></div><div class="mini-cards">${Array.from({length:Math.min(p.count,5)},()=>'<span class="mini-card"></span>').join('')}</div>`; $('opponents').appendChild(el); });
    const top = s.top; $('discardStack').innerHTML = ''; if (top) $('discardStack').appendChild(cardNode(top, 0, false)); $('colorIndicator').textContent = COLOR_EMOJI(s.chosenColor || top?.color || 'red'); $('colorIndicator').style.color = s.chosenColor || top?.color || 'red';
    const myTurn = s.turnPlayerId === socket.id; $('turnBanner').textContent = s.status === 'finished' ? 'MATCH FINISHED' : myTurn ? '✦ YOUR TURN' : `${s.players.find(p=>p.id===s.turnPlayerId)?.name || 'Opponent'}’S TURN`;
    $('penaltyBanner').classList.toggle('hidden', !(s.penalty > 0)); $('penaltyBanner').textContent = s.penalty > 0 ? `${s.stackType} STACK • ${s.penalty} CARDS PENALTY` : '';
    $('playerHand').innerHTML = ''; s.hand.forEach((c, i) => { const node = cardNode(c, i, myTurn); node.style.animation = `deal .25s ease both`; node.style.animationDelay = `${Math.min(i*25, 250)}ms`; $('playerHand').appendChild(node); }); $('handCount').textContent = s.hand.length;
    $('drawButton').disabled = !myTurn; $('drawPile').disabled = !myTurn; $('unoButton').disabled = s.hand.length !== 2 || !myTurn; $('drawButton').style.opacity = myTurn ? '1' : '.55'; $('drawPile').style.opacity = myTurn ? '1' : '.55';
    $('colorPicker').classList.toggle('hidden', !(s.pendingColor && s.pendingColor.playerId === socket.id)); $('handTip').textContent = myTurn ? (s.penalty ? `Stack ${s.stackType} or draw ${s.penalty}` : 'Tap a card to play') : 'Waiting for your turn';
    $('gameMessage').textContent = s.message || 'Let’s play!'; if (s.status === 'finished' && s.winner) { $('endPanel').classList.remove('hidden'); const won = s.winner === socket.id; $('endTitle').textContent = won ? 'YOU WIN!' : 'MATCH OVER'; $('endText').textContent = won ? 'Beautiful play. You are the champion.' : `${s.players.find(p=>p.id===s.winner)?.name || 'Someone'} won this round.`; playSfx(won ? 'win' : 'lose'); } else $('endPanel').classList.add('hidden');
  }
  function COLOR_EMOJI(color) { return { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' }[color] || '🌈'; }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  document.querySelectorAll('.color-picker button').forEach(btn => btn.addEventListener('click', () => { socket.emit('game:color', { color: btn.dataset.color }); $('colorPicker').classList.add('hidden'); playSfx('wild'); }));
  socket.on('connect', () => setConnection(true)); socket.on('disconnect', () => setConnection(false));
  socket.on('room:created', data => { roomCode = data.code; $('roomCode').textContent = roomCode; showScreen('lobbyScreen'); });
  socket.on('room:state', data => { roomCode = data.code; renderLobby(data); showScreen('lobbyScreen'); });
  socket.on('game:state', s => { renderGame(s); if (s.hand.length < previousHandCount) playSfx('play'); previousHandCount = s.hand.length; });
  socket.on('game:notice', message => { $('gameMessage').textContent = message; if (/menang/i.test(message)) playSfx('win'); });
  socket.on('app:error', message => toast(message));
  socket.on('room:left', () => { state = null; lobby = null; roomCode = ''; showScreen('homeScreen'); });
  $('musicStatus').textContent = 'OFF';
})();
