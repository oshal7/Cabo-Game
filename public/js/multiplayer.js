// Online multiplayer: create/join small rooms (server caps at 3 concurrent
// rooms), then play a server-authoritative game using the same card UI as
// local play. The server sends each client a redacted view of game state —
// this module just renders whatever it's given and forwards clicks as
// socket actions.
const MP = (function () {
  let socket = null;
  let session = { code: null, token: null, seat: null, name: '', maxPlayers: 3 };
  let lastRoomSummary = null;
  let lastView = null;
  let revealShownForRound = -1;

  function ensureSocket() {
    if (socket) return;
    socket = window.CABO_SERVER_URL ? io(window.CABO_SERVER_URL) : io();
    socket.on('rooms_list', renderRoomsList);
    socket.on('room_update', (room) => { lastRoomSummary = room; renderRoomScreen(room); });
    socket.on('game_state', onGameState);
    socket.on('banner', (b) => bnr(b.text, b.level));
    socket.on('flashes', onFlashes);
    socket.on('connect', tryAutoRejoin);
    socket.on('disconnect', () => bnr('Connection lost — reconnecting…', 'warn'));
  }

  function tryAutoRejoin() {
    let saved = sessionStorage.getItem('cabo_mp_session');
    if (!saved) return;
    let parsed;
    try { parsed = JSON.parse(saved); } catch (e) { sessionStorage.removeItem('cabo_mp_session'); return; }
    socket.emit('rejoin', parsed, (res) => {
      if (!res.ok) { sessionStorage.removeItem('cabo_mp_session'); return; }
      session.code = res.code; session.token = res.token; session.seat = res.seat;
      lastRoomSummary = res.room;
      if (res.status === 'playing') Screens.show('game');
      else { renderRoomScreen(res.room); Screens.show('mp-room'); }
    });
  }
  function persistSession() { sessionStorage.setItem('cabo_mp_session', JSON.stringify({ code: session.code, token: session.token })); }
  function clearSession() { sessionStorage.removeItem('cabo_mp_session'); session = { code: null, token: null, seat: null, name: session.name, maxPlayers: 3 }; }

  function setMaxPlayers(n) { session.maxPlayers = n; }

  function createRoom(name) {
    ensureSocket();
    session.name = name;
    socket.emit('create_room', { name, maxPlayers: session.maxPlayers }, (res) => {
      if (!res.ok) return showMpErr(res.error);
      session.code = res.code; session.token = res.token; session.seat = res.seat;
      persistSession();
      lastRoomSummary = res.room;
      renderRoomScreen(res.room);
      Screens.show('mp-room');
      showMpErr('');
    });
  }
  function joinRoom(code, name) {
    ensureSocket();
    session.name = name;
    socket.emit('join_room', { code: code.toUpperCase(), name }, (res) => {
      if (!res.ok) return showMpErr(res.error);
      session.code = res.code; session.token = res.token; session.seat = res.seat;
      persistSession();
      lastRoomSummary = res.room;
      renderRoomScreen(res.room);
      Screens.show('mp-room');
      showMpErr('');
    });
  }
  function refreshRoomsList() { ensureSocket(); socket.emit('list_rooms'); }
  function showMpErr(msg) { const el = document.getElementById('mp-err'); if (el) el.textContent = msg || ''; }
  function showRoomErr(msg) { const el = document.getElementById('mp-room-err'); if (el) el.textContent = msg || ''; }

  function startGame() {
    socket.emit('start_game', {}, (res) => { if (!res.ok) showRoomErr(res.error); });
  }
  function leaveRoom() {
    if (socket) socket.emit('leave_room');
    clearSession();
    revealShownForRound = -1;
    Screens.show('setup');
  }

  function renderRoomsList(list) {
    const el = document.getElementById('mp-rooms-list');
    if (!el) return;
    const open = (list || []).filter((r) => r.status === 'lobby');
    el.innerHTML = '';
    if (!open.length) { el.innerHTML = '<div class="mp-empty">No open rooms right now.</div>'; return; }
    open.forEach((r) => {
      const row = document.createElement('div'); row.className = 'mp-room-row';
      row.innerHTML = `<span class="code">${r.code}</span><span class="cnt">${r.players.length}/${r.maxPlayers} players</span>`;
      row.onclick = () => { document.getElementById('mp-code').value = r.code; };
      el.appendChild(row);
    });
  }

  function renderRoomScreen(room) {
    if (!room) return;
    document.getElementById('mp-room-code-big').textContent = room.code;
    document.getElementById('mp-room-count').textContent = room.players.length;
    document.getElementById('mp-room-max').textContent = room.maxPlayers;
    const seatsEl = document.getElementById('mp-seats'); seatsEl.innerHTML = '';
    for (let i = 0; i < room.maxPlayers; i++) {
      const p = room.players[i];
      const row = document.createElement('div');
      if (p) {
        row.className = 'mp-seat';
        const dotStyle = p.connected ? '' : ' style="background:#5a5142;box-shadow:none"';
        row.innerHTML = `<div class="dot"${dotStyle}></div><span>${p.name}${i === session.seat ? ' (you)' : ''}${p.connected ? '' : ' — offline'}</span>` + (p.isHost ? '<span class="host-tag">HOST</span>' : '');
      } else {
        row.className = 'mp-seat empty';
        row.textContent = 'Waiting for player…';
      }
      seatsEl.appendChild(row);
    }
    const me = room.players[session.seat];
    const amHost = me && me.isHost;
    const startBtn = document.getElementById('mp-start-btn');
    startBtn.style.display = amHost ? 'block' : 'none';
    startBtn.disabled = room.players.length < 2;
  }

  function action(type, payload) {
    socket.emit('action', { type, payload: payload || {} }, (res) => { if (res && res.ok === false) bnr(res.error, 'warn'); });
  }

  function onFlashes(flashes) {
    (flashes || []).forEach((f) => {
      if (f.kind === 'peek') flashPeekBlur(`card-${f.seat}-${f.idx}`, null, f.label, () => { if (lastView) renderGame(lastView); });
      if (f.kind === 'swap') flashSwapGlow(`card-${f.seat}-${f.idx}`);
    });
  }

  function onGameState(view) {
    lastView = view;
    Screens.show('game');
    renderGame(view);
    if (view.phase === 'reveal' && revealShownForRound !== view.round) {
      revealShownForRound = view.round;
      setTimeout(() => showRevealOverlay(view), 500);
    }
  }

  // ── render ──
  function renderGame(view) {
    document.getElementById('rbadge').textContent = `ROUND ${view.round}`;
    document.getElementById('cabo-btn').disabled = view.caboBy !== -1 || view.turn !== view.you || view.phase !== 'play';
    document.getElementById('glog').textContent = view.log || ' ';
    renderOpps(view);
    renderYou(view);
    renderCenter(view);
    renderActions(view);
    renderScoreboard(view);
  }

  function renderOpps(view) {
    const row = document.getElementById('opps'); row.innerHTML = '';
    view.players.forEach((p, i) => {
      if (i === view.you) return;
      const z = document.createElement('div'); z.className = 'opz';
      const nm = document.createElement('div'); nm.className = 'pnm';
      if (view.turn === i) { const d = document.createElement('div'); d.className = 'tdot'; nm.appendChild(d); }
      const ns = document.createElement('span'); ns.textContent = p.name; nm.appendChild(ns);
      if (view.caboBy === i) { const t = document.createElement('span'); t.className = 'ctag'; t.textContent = 'CABO'; nm.appendChild(t); }
      const sp = document.createElement('span'); sp.className = 'spip';
      sp.textContent = view.phase === 'reveal' ? p.cards.reduce((s, c) => s + (c.known ? cv(c.rank) : 0), 0) : '?';
      nm.appendChild(sp);
      z.appendChild(nm);
      const cr = document.createElement('div'); cr.className = 'crow';
      p.cards.forEach((c, idx) => {
        const faceUp = c.known && view.phase === 'reveal';
        let hl = '', clickable = false;
        if (view.turn === view.you) {
          if (view.phase === 'spec-peek-opp-pick' && view.peekOppWho === i) { hl = 'peek'; clickable = true; }
          if (view.phase === 'spec-swap2') { hl = 'swap'; clickable = true; }
        }
        const w = document.createElement('div'); w.className = 'cwrap';
        const card = mkCard(faceUp ? c : { rank: '?', suit: '' }, faceUp, { clickable, hl });
        card.id = `card-${i}-${idx}`;
        if (clickable) card.onclick = () => oppClick(i, idx, view);
        w.appendChild(card);
        const li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
        w.appendChild(li);
        cr.appendChild(w);
      });
      z.appendChild(cr);
      row.appendChild(z);
    });
  }

  function renderYou(view) {
    const p = view.players[view.you];
    const row = document.getElementById('ycards'); row.innerHTML = '';
    document.getElementById('ydot').style.display = view.turn === view.you ? 'block' : 'none';
    document.getElementById('ylbl').textContent = (p.name + (view.caboBy === view.you ? ' · CABO' : '')).toUpperCase();
    const known = p.cards.filter((c) => c.known);
    const ksum = known.reduce((s, c) => s + cv(c.rank), 0);
    document.getElementById('ypip').textContent = known.length === p.cards.length ? ksum : ksum + '+' + (p.cards.length - known.length) + '?';
    p.cards.forEach((c, idx) => {
      const faceUp = c.known;
      let hl = '', sel = false, clickable = false;
      if (view.turn === view.you) {
        if (view.phase === 'drawn') { clickable = true; hl = 'discard'; }
        if (view.phase === 'spec-peek-own') { clickable = true; hl = 'peek'; }
        if (view.phase === 'spec-swap1') { clickable = true; hl = 'swap'; }
        if (view.phase === 'spec-swap2' && view.swapPick1 && view.swapPick1.idx === idx) sel = true;
        if (view.phase === 'match-pick') { clickable = true; hl = 'discard'; }
      }
      const w = document.createElement('div'); w.className = 'cwrap';
      const card = mkCard(faceUp ? c : { rank: '?', suit: '' }, faceUp, { clickable, hl, sel, knownG: c.known && view.phase !== 'reveal' });
      card.id = `card-${view.you}-${idx}`;
      if (clickable) card.onclick = () => youClick(idx, view);
      w.appendChild(card);
      const li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
      w.appendChild(li);
      row.appendChild(w);
    });
  }

  function renderCenter(view) {
    const de = document.getElementById('deck-el'); de.innerHTML = '';
    const myTurn = view.turn === view.you;
    if (view.deckCount > 0) {
      const wrap = document.createElement('div'); wrap.className = 'deck-stack';
      if (view.deckCount > 2) { const s2 = document.createElement('div'); s2.className = 'ds2'; wrap.appendChild(s2); }
      if (view.deckCount > 1) { const s1 = document.createElement('div'); s1.className = 'ds1'; wrap.appendChild(s1); }
      const clickable = myTurn && view.phase === 'play';
      const card = mkCard(null, false, { clickable });
      if (clickable) card.onclick = () => action('draw_deck');
      wrap.appendChild(card);
      de.appendChild(wrap);
    } else {
      const ep = document.createElement('div'); ep.className = 'empty-pile'; ep.textContent = '0'; de.appendChild(ep);
    }
    document.getElementById('deck-cnt').textContent = view.deckCount + ' left';

    const dz = document.getElementById('dz');
    const dzCard = document.getElementById('dz-card');
    const dzActs = document.getElementById('dz-acts');
    dzCard.innerHTML = ''; dzActs.innerHTML = '';
    if (view.drawnCard && myTurn) {
      dz.classList.add('active');
      const card = mkCard(view.drawnCard, true); card.classList.add('deal-anim');
      dzCard.appendChild(card);
      if (view.phase === 'drawn') {
        dzActs.appendChild(mkBtn('Discard', 'ab dng', () => action('discard_drawn')));
        dzActs.appendChild(mkBtn('Swap a Card', 'ab pri', () => setMsg('Click <span class="hl">one of your cards</span> to swap.')));
        if (isSpec(view.drawnCard.rank)) dzActs.appendChild(mkBtn(specLbl(view.drawnCard.rank), 'ab sec', () => action('use_special')));
      }
    } else {
      dz.classList.remove('active');
      dzCard.innerHTML = view.someoneHasDrawn ? '<div class="dz-empty">…</div>' : '<div class="dz-empty">+</div>';
    }

    const dse = document.getElementById('disc-el'); dse.innerHTML = '';
    if (view.discardCount > 0 && view.discardTop) {
      const wrap = document.createElement('div'); wrap.className = 'disc-stack';
      if (view.discardCount > 1) { const sh = document.createElement('div'); sh.className = 'dsh'; wrap.appendChild(sh); }
      const canTake = myTurn && view.phase === 'play';
      const card = mkCard(view.discardTop, true, { clickable: canTake });
      if (canTake) card.onclick = () => action('draw_discard');
      wrap.appendChild(card);
      dse.appendChild(wrap);
    } else {
      const ep = document.createElement('div'); ep.className = 'empty-pile'; ep.textContent = '+'; dse.appendChild(ep);
    }
    document.getElementById('disc-cnt').textContent = view.discardCount + ' cards';
  }

  function renderActions(view) {
    const msg = document.getElementById('amsg');
    const br = document.getElementById('brow'); br.innerHTML = '';
    if (view.phase === 'reveal') { msg.innerHTML = '&nbsp;'; return; }
    const turnP = view.players[view.turn];
    if (view.turn !== view.you) { msg.innerHTML = `<span class="hl">${turnP.name}</span> <span class="dim">is thinking...</span>`; return; }
    if (view.phase === 'play') {
      const x = view.caboBy !== -1 && view.caboBy !== view.turn ? ' <span class="dim">· Last turn!</span>' : '';
      msg.innerHTML = `Draw from <span class="hl">deck</span> or take top <span class="hl">discard</span>.${x}`;
    }
    if (view.phase === 'drawn') msg.innerHTML = `<span class="hl">Drawn card shown above</span> — Discard, Swap, or use Special.`;
    if (view.phase === 'spec-peek-own') {
      msg.innerHTML = `Click one of <span class="hl">your cards</span> to peek.`;
      br.appendChild(mkBtn('Cancel', 'ab', () => action('cancel_special')));
    }
    if (view.phase === 'spec-peek-opp-who') {
      msg.innerHTML = `Choose <span class="hl">which opponent</span> to peek at.`;
      view.players.forEach((p, i) => { if (i !== view.you) br.appendChild(mkBtn(p.name, 'ab', () => action('choose_peek_opp', { oppSeat: i }))); });
      br.appendChild(mkBtn('Cancel', 'ab', () => action('cancel_special')));
    }
    if (view.phase === 'spec-peek-opp-pick') {
      msg.innerHTML = `Click a card from <span class="hl">${view.players[view.peekOppWho].name}</span>.`;
      br.appendChild(mkBtn('Cancel', 'ab', () => action('cancel_special')));
    }
    if (view.phase === 'spec-swap1') {
      msg.innerHTML = `<span class="hl">Click YOUR card</span> first.`;
      br.appendChild(mkBtn('Cancel', 'ab', () => action('cancel_special')));
    }
    if (view.phase === 'spec-swap2') {
      msg.innerHTML = `Now click an <span class="hl">opponent's card</span> to complete the swap.`;
      br.appendChild(mkBtn('Cancel', 'ab', () => action('cancel_special')));
    }
    if (view.phase === 'match-pick') {
      msg.innerHTML = `<span class="hl">Match bonus!</span> Click one of your cards to discard it free.`;
      br.appendChild(mkBtn('Skip', 'ab', () => action('match_skip')));
    }
  }

  function youClick(idx, view) {
    if (view.turn !== view.you) return;
    if (view.phase === 'drawn') return action('swap_card', { idx });
    if (view.phase === 'spec-peek-own') return action('peek_own', { idx });
    if (view.phase === 'spec-swap1') return action('swap_pick1', { idx });
    if (view.phase === 'match-pick') return action('match_pick', { idx });
  }
  function oppClick(oppSeat, idx, view) {
    if (view.turn !== view.you) return;
    if (view.phase === 'spec-peek-opp-pick' && view.peekOppWho === oppSeat) return action('peek_opp_pick', { idx });
    if (view.phase === 'spec-swap2') return action('swap_pick2', { oppSeat, idx });
  }

  function renderScoreboard(view) {
    const sb = document.getElementById('scoreboard');
    if (!sb.classList.contains('show')) return;
    sb.innerHTML = '';
    view.players.forEach((p, i) => {
      const r = document.createElement('div'); r.className = 'sc-row' + (i === view.you ? ' you' : '');
      r.innerHTML = `<span>${p.name}</span><b>${(view.totals && view.totals[i]) || 0}</b>`;
      sb.appendChild(r);
    });
  }
  function toggleScores() { document.getElementById('scoreboard').classList.toggle('show'); if (lastView) renderScoreboard(lastView); }
  function callCabo() { action('call_cabo'); }

  function showRevealOverlay(view) {
    sfx('reveal');
    const caboLost = view.caboLost;
    const rows = view.players.map((p, i) => {
      const s = (view.roundScores && view.roundScores[i]) ?? 0;
      const pen = caboLost && i === view.caboBy ? ' +5' : '';
      const isWin = i === view.winnerSeat;
      return `<tr class="${isWin ? 'win' : ''}"><td>${p.name}${i === view.caboBy ? ' ★' : ''}</td><td class="scc">${s}${pen}</td><td class="scc" style="color:#7a6e5a">${(view.totals && view.totals[i]) || 0}</td></tr>`;
    }).join('');
    const extra = caboLost ? `<div style="color:#e07070;font-size:.76rem;margin-bottom:.5rem">${view.players[view.caboBy].name} called Cabo but didn't win — +5 penalty!</div>` : '';
    const winnerName = view.players[view.winnerSeat] ? view.players[view.winnerSeat].name : '?';
    const me = lastRoomSummary && lastRoomSummary.players[session.seat];
    const amHost = me && me.isHost;
    const btns = [];
    if (amHost) {
      btns.push({ t: 'Next Round', c: 'ab pri', fn: () => { closeOv(); socket.emit('next_round', {}, (res) => { if (!res.ok) bnr(res.error, 'warn'); }); } });
      btns.push({ t: 'New Game', c: 'ab', fn: () => { closeOv(); socket.emit('new_game', {}, (res) => { if (!res.ok) bnr(res.error, 'warn'); }); } });
    } else {
      btns.push({ t: 'Waiting for host…', c: 'ab', fn: () => {} });
    }
    btns.push({ t: 'Leave Room', c: 'ab dng', fn: () => { closeOv(); leaveRoom(); } });
    showOv('Round Over',
      `${extra}<table class="sct"><thead><tr><th style="text-align:left;color:var(--gold)">Player</th><th style="color:var(--gold)">Round</th><th style="color:var(--gold)">Total</th></tr></thead><tbody>${rows}</tbody></table><br>Winner: <b style="color:var(--gold2)">${winnerName}</b>`,
      btns);
  }

  function openMenu() {
    showOv('Menu', '', [
      { t: 'Leave Room', c: 'ab dng', fn: () => { closeOv(); leaveRoom(); } },
      { t: 'Close', c: 'ab', fn: closeOv },
    ]);
  }

  return { ensureSocket, createRoom, joinRoom, refreshRoomsList, setMaxPlayers, startGame, leaveRoom, toggleScores, openMenu, callCabo };
})();
