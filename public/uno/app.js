(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();
  let myName = '', roomCode = '', state = null, lobby = null, previousHandCount = 0, audioCtx = null, toastTimer = null, chosenCardIndex = null, isOwner = false;
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
  $('backHome').addEventListener('click', () => { socket.emit('room:leave'); resetRoomLocal(); showScreen('homeScreen'); });
  $('copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); toast('Kode room disalin!'); } catch (_) { toast('Kode room: ' + roomCode); } });
  $('startGame').addEventListener('click', () => socket.emit('room:start'));
  $('leaveGame').addEventListener('click', () => { if (confirm('Keluar dari pertandingan?')) { socket.emit('room:leave'); resetRoomLocal(); showScreen('homeScreen'); } });
  $('drawPile').addEventListener('click', () => { if (state) { playSfx('draw'); socket.emit('game:draw'); } });
  $('drawButton').addEventListener('click', () => { if (state) { playSfx('draw'); socket.emit('game:draw'); } });
  $('unoButton').addEventListener('click', () => { playSfx('uno'); sayUno(); toast('UNO! 🔥'); socket.emit('game:uno'); });
  function sayUno() { try { if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance('UNO!'); u.lang = 'en-US'; u.rate = .82; u.pitch = 1.35; u.volume = Math.max(.2, Number($('sfxVolume')?.value ?? 70)/100); window.speechSynthesis.speak(u); } } catch (_) {} }
  $('fullscreenBtn').addEventListener('click', async () => { try { if (!document.fullscreenElement) await (document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.()); else await (document.exitFullscreen?.() || document.webkitExitFullscreen?.()); } catch (_) { toast('Mode layar penuh tidak didukung browser ini.'); } });
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const input = $('chatInput'); const message = input.value.trim(); if (!message) return; socket.emit('game:chat', { message }); input.value = ''; });
  document.querySelectorAll('[data-reaction]').forEach(b => b.addEventListener('click', () => socket.emit('game:chat', { message: b.dataset.reaction, reaction: true })));
  const stickerList = [['ez','EZ'],['capek','CAPEK BET'],['santai','SANTAI DULU'],['serius','SERIUS?!'],['kzl','KZL!'],['wkwk','WKWKWK'],['sedih','SEDIH BANGET'],['gas','GASSS!!'],['skip','SKIP DULU'],['awww','AWWW'],['mantap','MANTAP JIWA!'],['clown','BADUT']];
  const tray = $('stickerTray'); if (tray) { tray.innerHTML = stickerList.map(([id,label]) => `<button class="sticker-tile" data-sticker="${id}" aria-label="${label}"><img src="/stickers/${id}.svg" alt="${label}"><small>${label}</small></button>`).join(''); $('openStickerTray').onclick=()=>tray.classList.toggle('hidden'); tray.querySelectorAll('[data-sticker]').forEach(b=>b.onclick=()=>{socket.emit('game:chat',{message:b.dataset.sticker,reaction:true,stickerId:b.dataset.sticker});tray.classList.add('hidden')}); }
  socket.on('game:chat', item => { const box = $('chatMessages'); const empty = box.querySelector('.chat-empty'); if (empty) empty.remove(); const row = document.createElement('div'); row.className = 'chat-message' + (item.reaction ? ' chat-reaction' : ''); const who = document.createElement('b'); who.textContent = item.name; row.append(who); if(item.stickerId){const img=document.createElement('img');img.className='chat-sticker';img.src='/stickers/'+item.stickerId+'.svg';img.alt='Sticker '+item.stickerId;row.append(img)}else{const msg = document.createElement('span'); msg.textContent = item.message; row.append(msg)} box.appendChild(row); while (box.children.length > 60) box.firstElementChild.remove(); box.scrollTop = box.scrollHeight; });
  $('playAgain').addEventListener('click', () => socket.emit('game:restart'));
  $('endHome').addEventListener('click', () => { socket.emit('room:leave'); resetRoomLocal(); showScreen('homeScreen'); });
  $('audioSettings').addEventListener('click', openAudio); $('openMusic').addEventListener('click', openAudio); $('closeAudio').addEventListener('click', () => $('audioModal').classList.add('hidden'));
  $('sfxVolume').addEventListener('input', e => $('sfxValue').textContent = e.target.value + '%');
  function openAudio() { $('audioModal').classList.remove('hidden'); updateMusicUI(); playSfx('click'); }

  // ===== MUSIC =====
  // Dua sumber tersinkron dari server: global (admin) dan room (owner). Di dalam room, musik room
  // menggantikan global selama owner sudah memasang URL. Volume/mute hanya lokal.
  const music = { global: null, room: null };
  let musicVol = 0.35, musicMuted = false;
  try { const v = parseFloat(localStorage.getItem('uno.musicVol')); if (!isNaN(v)) musicVol = Math.min(1, Math.max(0, v)); musicMuted = localStorage.getItem('uno.musicMuted') === '1'; } catch (_) {}
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const effVol = () => musicMuted ? 0 : musicVol;
  const ytId = (url) => { const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i); return m ? m[1] : null; };
  const targetPos = (s) => s.status === 'playing' ? s.pos + (Date.now() - s.at) / 1000 : s.pos;
  const dock = $('ytDock');

  // -- engine: <audio> untuk URL langsung
  const A = {
    url: '', blocked: false, pending: null,
    seek(pos, tol) { const go = () => { const d = audio.duration; const t = isFinite(d) && d > 0 ? pos % d : pos; if (Math.abs(audio.currentTime - t) > tol) { try { audio.currentTime = t; } catch (_) {} } }; if (audio.readyState >= 1) { this.pending = null; go(); } else this.pending = go; },
    load(url) { if (this.url !== url) { this.url = url; audio.src = url; audio.load(); } },
    play(getPos) { this.seek(getPos(), 1.5); audio.play().then(() => { this.blocked = false; updateMusicUI(); }).catch(err => { if (err && err.name === 'NotAllowedError') { this.blocked = true; updateMusicUI(); } }); },
    pause(pos) { audio.pause(); this.blocked = false; this.seek(pos, .3); },
    clear() { if (!this.url) return; audio.pause(); this.url = ''; this.blocked = false; this.pending = null; audio.removeAttribute('src'); audio.load(); },
  };
  audio.addEventListener('loadedmetadata', () => { if (A.pending) { const f = A.pending; A.pending = null; f(); } });
  audio.addEventListener('error', () => { if (A.url) toast('Musik tidak bisa diputar. Pastikan URL langsung ke file audio (mp3/ogg) atau link YouTube.'); });

  // -- engine: YouTube IFrame API
  let ytApiQueue = null;
  function loadYtApi(cb) {
    if (window.YT && window.YT.Player) return cb();
    if (ytApiQueue) return ytApiQueue.push(cb);
    ytApiQueue = [cb]; window.onYouTubeIframeAPIReady = () => { const q = ytApiQueue; ytApiQueue = null; q.forEach(f => f()); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { ytApiQueue = null; toast('Player YouTube gagal dimuat.'); }; document.head.appendChild(s);
  }
  const Y = {
    p: null, ready: false, vid: '', mode: null, getPos: null,
    load(vid) {
      if (this.vid === vid && this.p) return;
      this.destroy(); this.vid = vid; dock.innerHTML = '<div id="ytHost"></div>'; dock.classList.remove('hidden');
      loadYtApi(() => {
        if (this.vid !== vid) return;
        this.p = new window.YT.Player('ytHost', { width: '100%', height: '100%', videoId: vid, playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, disablekb: 1 }, events: {
          onReady: () => { this.ready = true; this.p.setVolume(effVol() * 100); this.flush(); updateMusicUI(); },
          onStateChange: (e) => { if (e.data === 0 && this.mode === 'play') { this.p.seekTo(0, true); this.p.playVideo(); } updateMusicUI(); },
          onError: () => toast('Video YouTube tidak bisa diputar (mungkin embed dinonaktifkan).'),
        } });
      });
    },
    set(mode, getPos) { this.mode = mode; this.getPos = getPos; this.flush(); },
    flush() {
      if (!this.ready || !this.mode) return;
      const pos = this.getPos(), d = this.p.getDuration ? this.p.getDuration() : 0, t = d > 0 ? pos % d : pos, cur = this.p.getCurrentTime ? this.p.getCurrentTime() : 0;
      if (this.mode === 'play') { if (Math.abs(cur - t) > 1.5) this.p.seekTo(t, true); this.p.playVideo(); } else { this.p.seekTo(t, true); this.p.pauseVideo(); }
    },
    playing() { return !!(this.ready && this.p.getPlayerState && [1, 3].includes(this.p.getPlayerState())); },
    destroy() { try { if (this.p && this.p.destroy) this.p.destroy(); } catch (_) {} this.p = null; this.ready = false; this.vid = ''; this.mode = null; dock.classList.add('hidden'); dock.innerHTML = ''; },
  };

  function effective() { return roomCode && music.room && music.room.url && music.room.code === roomCode ? { scope: 'room', s: music.room } : { scope: 'global', s: music.global }; }
  function needsTap() { const s = effective().s; return !!(s && s.url && s.status === 'playing' && (A.blocked || (Y.mode === 'play' && Y.ready && !Y.playing()))); }
  function applyVolume() { audio.volume = effVol(); if (Y.ready && Y.p.setVolume) Y.p.setVolume(effVol() * 100); }
  function applyMusic() {
    const s = effective().s; applyVolume();
    if (!s || !s.url || s.status === 'stopped') { A.clear(); Y.destroy(); return updateMusicUI(); }
    const vid = ytId(s.url);
    if (vid) { A.clear(); Y.load(vid); Y.set(s.status === 'playing' ? 'play' : 'pause', () => targetPos(s)); }
    else { Y.destroy(); A.load(s.url); if (s.status === 'playing') A.play(() => targetPos(s)); else A.pause(s.pos); }
    updateMusicUI();
  }
  function updateMusicUI() {
    const { scope, s } = effective(), has = !!(s && s.url);
    const word = !has ? 'OFF' : s.status === 'playing' ? (needsTap() ? 'TAP' : 'ON') : s.status === 'paused' ? 'PAUSED' : 'OFF';
    $('musicStatus').textContent = word;
    $('nowSource').textContent = !has ? 'Tidak ada musik' : scope === 'room' ? '👑 Room music' : '🌐 Global music';
    let host = ''; if (has) { try { host = new URL(s.url).hostname; } catch (_) {} }
    $('nowInfo').textContent = !has ? 'Belum ada musik yang dipasang.' : ({ playing: needsTap() ? 'Sentuh layar untuk memulai' : 'Sedang diputar', paused: 'Dijeda', stopped: 'Berhenti — tekan PLAY di panel kontrol' }[s.status]) + ' · ' + host;
    $('roomMusicBox').classList.toggle('hidden', !roomCode);
    $('roomControls').classList.toggle('hidden', !isOwner);
    $('roomMusicNote').textContent = isOwner ? 'Kamu owner room. Musik ini tersinkron ke semua pemain di room dan menggantikan musik global.' : 'Hanya owner room yang bisa mengatur musik ini. Kamu mengikuti otomatis.';
    $('muteMusic').textContent = musicMuted ? '🔈 UNMUTE' : '🔇 MUTE FOR ME';
    $('musicVolume').value = Math.round(musicVol * 100); $('volumeValue').textContent = musicMuted ? 'MUTED' : Math.round(musicVol * 100) + '%';
  }
  function sendMusic(scope, action) {
    const g = scope === 'global';
    const payload = g ? { key: $('gKey').value, action, url: $('gUrl').value.trim() } : { action, url: $('rUrl').value.trim() };
    if (g && !payload.key) return toast('Isi admin key dulu.');
    socket.emit(g ? 'music:global' : 'music:room', payload, res => { if (!res || !res.ok) toast((res && res.error) || 'Gagal mengatur musik.'); });
  }
  [['g', 'global'], ['r', 'room']].forEach(([pre, scope]) => ['Set', 'Play', 'Pause', 'Stop'].forEach(a => $(pre + a).addEventListener('click', () => { playSfx('click'); sendMusic(scope, a.toLowerCase()); })));
  // Upload file musik (disimpan di server, dipakai semua pemain lewat URL /uno/music/...).
  function uploadTrack(scope, file, input) {
    const pre = scope === 'global' ? 'g' : 'r', status = $(pre + 'UpStatus');
    if (!file) return;
    if (scope === 'global' && !$('gKey').value) { input.value = ''; return toast('Isi admin key dulu.'); }
    if (file.size > 20 * 1024 * 1024) { input.value = ''; return toast('File maksimal 20 MB.'); }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/uno/upload?scope=${scope}&sid=${encodeURIComponent(socket.id || '')}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (scope === 'global') xhr.setRequestHeader('x-admin-key', $('gKey').value);
    const done = (msg) => { status.textContent = msg || ''; input.value = ''; input.disabled = false; };
    input.disabled = true; status.textContent = 'Mengupload… 0%';
    xhr.upload.onprogress = e => { if (e.lengthComputable) status.textContent = `Mengupload… ${Math.round(e.loaded / e.total * 100)}%`; };
    xhr.onerror = () => { done(''); toast('Upload gagal. Cek koneksi.'); };
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 200 && r.ok) { $(pre + 'Url').value = r.url; done('Terupload ✓ — tekan PLAY'); sendMusic(scope, 'set'); }
      else { done(''); toast(r.error || 'Upload gagal.'); }
    };
    xhr.send(file);
  }
  ['g', 'r'].forEach(pre => $(pre + 'File').addEventListener('change', e => uploadTrack(pre === 'g' ? 'global' : 'room', e.target.files && e.target.files[0], e.target)));
  $('musicVolume').addEventListener('input', e => { musicVol = Number(e.target.value) / 100; if (musicVol > 0) musicMuted = false; store('uno.musicVol', musicVol); store('uno.musicMuted', musicMuted ? '1' : '0'); applyVolume(); updateMusicUI(); });
  $('muteMusic').addEventListener('click', () => { musicMuted = !musicMuted; store('uno.musicMuted', musicMuted ? '1' : '0'); applyVolume(); updateMusicUI(); });
  // Browser memblokir autoplay sampai ada sentuhan: coba lagi pada interaksi berikutnya.
  ['click', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (needsTap()) applyMusic(); }, { capture: true, passive: true }));
  socket.on('music:state', ({ scope, code, state } = {}) => {
    if (!state) return;
    if (scope === 'global') music.global = { ...state, at: Date.now() };
    else if (scope === 'room') music.room = { ...state, code, at: Date.now() };
    else return;
    applyMusic();
  });
  function resetRoomLocal() { state = null; lobby = null; roomCode = ''; isOwner = false; music.room = null; applyMusic(); }
  function renderLobby(data) {
    lobby = data; roomCode = data.code || roomCode; isOwner = !!data.isOwner; $('roomCode').textContent = roomCode; $('lobbyPlayers').innerHTML = '';
    data.players.forEach((p, i) => { const el = document.createElement('div'); el.className = 'lobby-player'; el.innerHTML = `<span class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(p.name)}</strong><small>${i === 0 ? 'ROOM HOST' : p.isAI ? 'AI PLAYER' : 'PLAYER'}</small></div>`; $('lobbyPlayers').appendChild(el); });
    const canStart = !!data.canStart; $('startGame').classList.toggle('hidden', !canStart); $('lobbyHint').textContent = canStart ? 'All set. Start when everyone is ready.' : 'Waiting for the host to start…';
  }
  function cardLabel(card) { return card.color === 'wild' ? (card.value === '+4' ? '+4' : 'WILD') : card.value === 'skip' ? '⊘' : card.value === 'reverse' ? '↻' : card.value; }
  function cardNode(card, index, playable = false) {
    const el = document.createElement('button'); el.type = 'button'; el.className = `uno-card card-enter ${CARD_COLORS[card.color] || 'color-wild'}`; el.style.setProperty('--rot', `${Math.max(-8, Math.min(8, (index - 3) * 1.5))}deg`); el.setAttribute('aria-label', `${card.color} ${card.value}`);
    el.innerHTML = `<span class="card-mini">${escapeHtml(cardLabel(card))}</span><span class="card-value">${escapeHtml(cardLabel(card))}</span><span class="card-mini bottom">${escapeHtml(cardLabel(card))}</span>`;
    if (playable) el.addEventListener('click', () => { chosenCardIndex = index; document.querySelectorAll('.player-hand .uno-card').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); playSfx('click'); const c = state.hand[index]; if (c.color === 'wild' && c.value === 'wild') { $('colorPicker').classList.remove('hidden'); $('handTip').textContent = 'Choose a color above'; } else if (c.value === '+4' && state.penalty > 0) { socket.emit('game:play', { index }); } else socket.emit('game:play', { index }); });
    return el;
  }
  function renderGame(s) {
    state = s; isOwner = !!s.isOwner; showScreen('gameScreen'); $('roomPill').textContent = 'ROOM ' + s.code; $('opponents').innerHTML = '';
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
  socket.on('room:created', data => { roomCode = data.code; $('roomCode').textContent = roomCode; showScreen('lobbyScreen'); applyMusic(); });
  socket.on('room:state', data => { roomCode = data.code; renderLobby(data); showScreen('lobbyScreen'); applyMusic(); });
  socket.on('game:state', s => { renderGame(s); if (s.hand.length < previousHandCount) playSfx('play'); previousHandCount = s.hand.length; });
  socket.on('game:notice', message => { $('gameMessage').textContent = message; if (/menang/i.test(message)) playSfx('win'); });
  socket.on('app:error', message => toast(message));
  socket.on('room:left', () => { resetRoomLocal(); showScreen('homeScreen'); });
  updateMusicUI();
})();
