// Local play: vs AI and pass-&-play. Same rules as the server engine
// (server/cabo.js): final-turn tracking for Cabo, deck reshuffle, first-lap
// Cabo lock, 100-point game end. Rendering is drawn from the perspective of
// `viewer()` so Pass & Play works for every seat, not just seat 0.
const Local = (function () {
  const TARGET = 100;
  let C = { np: 3, mode: 'solo', diff: 'med', name: 'You' };
  let G = {};
  let TOTALS = [];
  let flyQ = [];

  function setSeg(k, v, btn) {
    C[k] = v;
    btn.closest('.seg').querySelectorAll('.sb').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    if (k === 'mode') document.getElementById('diff-seg').style.opacity = v === 'pass' ? '.35' : '1';
  }

  function mkDeck() { let d = []; for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s }); d.push({ rank: 'JOKER', suit: '★' }, { rank: 'JOKER', suit: '★' }); return d; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ~~(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ── perspective helpers ──
  function viewer() { return C.mode === 'pass' ? G.viewer : 0; }
  function myTurn() { return !G.handoff && G.phase !== 'reveal' && G.turn === viewer() && G.players[G.turn].isHuman; }
  function canCallCabo() { return G.caboBy === -1 && G.phase === 'play' && G.turnsTaken >= G.players.length; }
  function isMemorizing() { return G.memorizeSeat === viewer() && Date.now() < (G.memorizeUntil || 0); }
  function queueFly(target, from, opts) { if (from) flyQ.push({ target, from, opts }); }
  function slotId(seat, idx) { return `card-${seat}-${idx}`; }

  function startGame() {
    C.name = (document.getElementById('pname').value.trim() || 'You').slice(0, 12);
    Settings.set('name', C.name);
    Screens.show('game');
    TOTALS = Array(C.np).fill(0);
    G = { round: 1 };
    initRound();
  }

  function initRound() {
    let deck = shuffle(mkDeck());
    let n = C.np;
    let names = [C.name];
    for (let i = 1; i < n; i++) names.push(C.mode === 'pass' ? `P${i + 1}` : `AI ${i}`);
    let players = names.map((nm, i) => ({
      name: nm, isHuman: i === 0 || C.mode === 'pass',
      cards: deck.splice(0, 4).map((c) => ({ ...c, known: false, aiKnown: false })),
      matchUsed: false, skip: false, memorized: false,
    }));
    let discard = [deck.pop()];
    // every owner starts knowing their first two cards
    players.forEach((p) => { p.cards[0].known = true; p.cards[1].known = true; });
    for (let i = 1; i < n; i++) if (!players[i].isHuman) { players[i].cards[0].aiKnown = true; players[i].cards[1].aiKnown = true; }
    G = {
      deck, discard, players, turn: 0, viewer: 0, phase: 'play', drawnCard: null, swapSeen: false, swapPick1: null,
      peekOppWho: null, caboBy: -1, finalPending: [], turnsTaken: 0, round: G.round || 1,
      log: 'New hand — memorize your first two cards!', handoff: false, memorizeUntil: 0,
    };
    closeOv();
    if (C.mode === 'pass') handoff(0, () => {});
    else { beginMemorize(0); render(); dealAnimation(); }
  }

  function beginMemorize(seat) {
    let p = G.players[seat];
    if (p.memorized) return;
    p.memorized = true;
    G.memorizeSeat = seat;
    G.memorizeUntil = Date.now() + MEMORIZE_MS;
    setTimeout(() => { if (G.players === undefined) return; render(); }, MEMORIZE_MS + 30);
  }

  // Pass & Play: hide the table behind an opaque screen until the next
  // player confirms they have the device.
  function handoff(seat, cb) {
    G.handoff = true;
    let p = G.players[seat];
    showOv(`Pass to ${p.name}`,
      `<div style="margin-bottom:.4rem">Hand the device to <b style="color:var(--gold)">${esc(p.name)}</b>.</div>` +
      (p.memorized ? '' : '<div class="dim-note">You\'ll get a few seconds to memorize your first two cards.</div>'),
      [{ t: `I'm ${p.name} — Show my table`, c: 'ab pri', fn: () => {
        closeOv();
        G.handoff = false; G.viewer = seat;
        let first = !p.memorized;
        beginMemorize(seat);
        render();
        if (first && G.turnsTaken < G.players.length) dealAnimation();
        cb();
      } }], { solid: true });
  }

  // ── rendering ──
  function render() {
    if (!G.players) return;
    renderOpps();
    renderHuman();
    renderCenter();
    renderActions();
    document.getElementById('rbadge').textContent = `ROUND ${G.round}`;
    let cb = document.getElementById('cabo-btn');
    cb.disabled = !(myTurn() && canCallCabo());
    cb.title = G.caboBy !== -1 ? 'Cabo already called' : (G.turnsTaken < G.players.length ? 'Available after everyone has had a turn' : 'End the hand: everyone else gets one final turn');
    if (G.log) document.getElementById('glog').textContent = G.log;
    renderScoreboard();
    let q = flyQ; flyQ = [];
    q.forEach((f) => flyFrom(f.target, f.from, f.opts));
  }
  function scoreOf(i) { return G.players[i].cards.reduce((s, c) => s + cv(c.rank), 0); }

  function seatOrder() {
    let n = G.players.length, v = viewer(), out = [];
    for (let k = 1; k < n; k++) out.push((v + k) % n);
    return out;
  }

  function nameTags(nm, seat) {
    if (G.caboBy === seat) { let t = document.createElement('span'); t.className = 'ctag'; t.textContent = 'CABO'; nm.appendChild(t); }
    if (G.finalPending.includes(seat)) { let t = document.createElement('span'); t.className = 'ltag'; t.textContent = 'LAST TURN'; nm.appendChild(t); }
  }

  function renderOpps() {
    let row = document.getElementById('opps'); row.innerHTML = '';
    let mine = myTurn();
    seatOrder().forEach((i) => {
      let p = G.players[i];
      let z = document.createElement('div'); z.className = 'opz' + (G.turn === i && G.phase !== 'reveal' ? ' active' : ''); z.id = `opz-${i}`;
      let nm = document.createElement('div'); nm.className = 'pnm';
      if (G.turn === i) { let d = document.createElement('div'); d.className = 'tdot'; nm.appendChild(d); }
      let ns = document.createElement('span'); ns.textContent = p.name; nm.appendChild(ns);
      nameTags(nm, i);
      let sp = document.createElement('span'); sp.className = 'spip'; sp.textContent = G.phase === 'reveal' ? scoreOf(i) : '?'; nm.appendChild(sp);
      z.appendChild(nm);
      let cr = document.createElement('div'); cr.className = 'crow';
      p.cards.forEach((c, idx) => {
        let faceUp = G.phase === 'reveal';
        let hl = '', clickable = false;
        if (mine) {
          if (G.phase === 'spec-peek-opp-pick' && G.peekOppWho === i) { hl = 'peek'; clickable = true; }
          if (G.phase === 'spec-swap2') { hl = 'swap'; clickable = true; }
        }
        let w = document.createElement('div'); w.className = 'cwrap';
        let card = mkCard(c, faceUp, { clickable, hl });
        card.id = slotId(i, idx);
        if (clickable) card.onclick = () => oppClick(i, idx);
        w.appendChild(card);
        let li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
        w.appendChild(li);
        cr.appendChild(w);
      });
      z.appendChild(cr);
      row.appendChild(z);
    });
  }

  function renderHuman() {
    let v = viewer();
    let p = G.players[v];
    let row = document.getElementById('ycards'); row.innerHTML = '';
    let mine = myTurn();
    document.querySelector('.hz').classList.toggle('active', G.turn === v && G.phase !== 'reveal');
    document.getElementById('ydot').style.display = G.turn === v ? 'block' : 'none';
    let lbl = document.getElementById('ylbl');
    lbl.textContent = (p.name + (G.caboBy === v ? ' · CABO' : '') + (G.finalPending.includes(v) ? ' · LAST TURN' : '')).toUpperCase();
    let memo = isMemorizing();
    let aid = Settings.get('memoryAid');
    let known = p.cards.filter((c) => c.known);
    let ksum = known.reduce((s, c) => s + cv(c.rank), 0);
    let pip = document.getElementById('ypip');
    if (G.phase === 'reveal') pip.textContent = scoreOf(v);
    else if (aid) pip.textContent = known.length === p.cards.length ? ksum : ksum + '+' + (p.cards.length - known.length) + '?';
    else pip.textContent = '?';
    p.cards.forEach((c, idx) => {
      let faceUp = G.phase === 'reveal' || (c.known && (aid || memo));
      let hl = '', sel = false, clickable = false;
      if (mine) {
        if (G.phase === 'drawn') { clickable = true; hl = 'swap'; }
        if (G.phase === 'spec-peek-own') { clickable = true; hl = 'peek'; }
        if (G.phase === 'spec-swap1') { clickable = true; hl = 'swap'; }
        if (G.phase === 'spec-swap2' && G.swapPick1 && G.swapPick1.owner === v && G.swapPick1.idx === idx) sel = true;
        if (G.phase === 'match-pick') { clickable = true; hl = 'discard'; }
      }
      let w = document.createElement('div'); w.className = 'cwrap';
      let card = mkCard(c, faceUp, { clickable, hl, sel, knownG: c.known && aid && G.phase !== 'reveal' });
      if (memo && c.known && !aid && G.phase !== 'reveal') card.classList.add('memorize');
      card.id = slotId(v, idx);
      if (clickable) card.onclick = () => youClick(idx);
      w.appendChild(card);
      let li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
      w.appendChild(li);
      row.appendChild(w);
    });
  }

  function renderCenter() {
    let mine = myTurn();
    let de = document.getElementById('deck-el'); de.innerHTML = '';
    if (G.deck.length > 0) {
      let wrap = document.createElement('div'); wrap.className = 'deck-stack';
      if (G.deck.length > 2) { let s2 = document.createElement('div'); s2.className = 'ds2'; wrap.appendChild(s2); }
      if (G.deck.length > 1) { let s1 = document.createElement('div'); s1.className = 'ds1'; wrap.appendChild(s1); }
      let canDraw = mine && G.phase === 'play';
      let card = mkCard(null, false, { clickable: canDraw });
      card.id = 'deck-top';
      if (canDraw) card.onclick = drawDeck;
      wrap.appendChild(card);
      de.appendChild(wrap);
    } else {
      let ep = document.createElement('div'); ep.className = 'empty-pile'; ep.id = 'deck-top'; ep.textContent = '0'; de.appendChild(ep);
    }
    document.getElementById('deck-cnt').textContent = G.deck.length + ' left';

    let dz = document.getElementById('dz');
    let dzCard = document.getElementById('dz-card');
    let dzActs = document.getElementById('dz-acts');
    dzCard.innerHTML = ''; dzActs.innerHTML = '';
    if (G.drawnCard && mine) {
      dz.classList.add('active');
      let card = mkCard(G.drawnCard, true);
      card.id = 'dz-top';
      dzCard.appendChild(card);
      if (G.phase === 'drawn') {
        dzActs.appendChild(mkBtn('Discard', 'ab dng', doDiscardDrawn));
        let sw = mkBtn('Swap a Card', 'ab pri', () => setMsg('Click <span class="hl">one of your cards</span> (blue glow) to swap it out.'));
        sw.title = 'Click one of your cards to replace it with the drawn card';
        dzActs.appendChild(sw);
        if (isSpec(G.drawnCard.rank)) { let b = mkBtn(specLbl(G.drawnCard.rank), 'ab sec', useSpecial); b.title = specDesc(G.drawnCard.rank); dzActs.appendChild(b); }
      }
    } else {
      dz.classList.remove('active');
      dzCard.innerHTML = `<div class="dz-empty" id="dz-top">${G.drawnCard ? '…' : '+'}</div>`;
    }

    let dse = document.getElementById('disc-el'); dse.innerHTML = '';
    if (G.discard.length > 0) {
      let wrap = document.createElement('div'); wrap.className = 'disc-stack';
      if (G.discard.length > 1) { let sh = document.createElement('div'); sh.className = 'dsh'; wrap.appendChild(sh); }
      let top = G.discard[G.discard.length - 1];
      let canTake = mine && G.phase === 'play';
      let card = mkCard(top, true, { clickable: canTake });
      card.id = 'disc-top';
      if (canTake) card.onclick = drawDiscard;
      wrap.appendChild(card);
      dse.appendChild(wrap);
    } else {
      let ep = document.createElement('div'); ep.className = 'empty-pile'; ep.id = 'disc-top'; ep.textContent = '+'; dse.appendChild(ep);
    }
    document.getElementById('disc-cnt').textContent = G.discard.length + ' cards';
  }

  function renderActions() {
    let msg = document.getElementById('amsg');
    let br = document.getElementById('brow'); br.innerHTML = '';
    let p = G.players[G.turn];
    if (!p || G.phase === 'reveal' || G.handoff) { msg.innerHTML = '&nbsp;'; return; }
    if (!myTurn()) { msg.innerHTML = `<span class="hl">${esc(p.name)}</span> <span class="dim thinking">is thinking</span>`; return; }
    if (G.phase === 'play') {
      let x = G.caboBy !== -1 ? ' <span class="dim">· Last turn!</span>' : '';
      let m = isMemorizing() && !Settings.get('memoryAid') ? '<span class="hl">Memorize your cards!</span> Then d' : 'D';
      msg.innerHTML = `${m}raw from <span class="hl">deck</span> or take top <span class="hl">discard</span>.${x}`;
    }
    if (G.phase === 'drawn') msg.innerHTML = `<span class="hl">Drawn card shown above</span> — Discard, Swap, or use Special.`;
    if (G.phase === 'spec-peek-own') {
      msg.innerHTML = `Click one of <span class="hl">your cards</span> to peek.`;
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-peek-opp-who') {
      msg.innerHTML = `Choose <span class="hl">which opponent</span> to peek at.`;
      seatOrder().forEach((i) => br.appendChild(mkBtn(G.players[i].name, 'ab', () => { G.peekOppWho = i; G.phase = 'spec-peek-opp-pick'; render(); })));
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-peek-opp-pick') {
      msg.innerHTML = `Click a card from <span class="hl">${esc(G.players[G.peekOppWho].name)}</span>.`;
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-swap1') {
      msg.innerHTML = `<span class="hl">Click YOUR card</span> first${G.swapSeen ? " (you'll peek it)" : ' (blind)'}.`;
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-swap2') {
      msg.innerHTML = `Now click an <span class="hl">opponent's card</span> to complete the swap.`;
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'match-pick') {
      msg.innerHTML = `<span class="hl">Match bonus!</span> Click one of your cards to discard it free.`;
      br.appendChild(mkBtn('Skip', 'ab', () => { G.log = 'Match bonus skipped.'; endTurn(); }));
    }
  }

  // ── deck helpers ──
  function ensureDeck() {
    if (G.deck.length) return true;
    if (G.discard.length < 2) return false;
    let top = G.discard.pop();
    G.deck = shuffle(G.discard);
    G.discard = [top];
    bnr('Deck reshuffled from the discard pile.', 'info');
    return true;
  }
  // moves the drawn card to the discard pile (with animation from the drawn zone)
  function discardDrawnCard(fromRect) {
    queueFly('disc-top', fromRect || rectOf('dz-top'));
    G.discard.push(G.drawnCard); G.drawnCard = null;
  }

  // ── human actions ──
  function drawDeck() {
    if (!ensureDeck()) { bnr('Deck empty!', 'warn'); return; }
    queueFly('dz-top', rectOf('deck-top'), { flip: true });
    G.drawnCard = G.deck.pop(); G.phase = 'drawn'; sfx('draw'); render();
  }
  function drawDiscard() {
    if (!G.discard.length) return;
    queueFly('dz-top', rectOf('disc-top'));
    G.drawnCard = G.discard.pop(); G.phase = 'drawn'; sfx('draw'); render();
  }
  function doDiscardDrawn() {
    let card = G.drawnCard;
    discardDrawnCard(); sfx('discard');
    G.log = `${G.players[G.turn].name} discarded ${card.rank}${card.suit}.`;
    if (!checkMatch(card)) endTurn(); else render();
  }
  function checkMatch(card) {
    if (G.discard.length < 2 || G.players[G.turn].matchUsed) return false;
    let prev = G.discard[G.discard.length - 2];
    if (prev && prev.rank === card.rank) {
      G.phase = 'match-pick';
      if (G.players[G.turn].isHuman) { bnr('Match! Discard a card for free!', 'good'); sfx('match'); }
      return true;
    }
    return false;
  }
  function youClick(idx) {
    if (!myTurn()) return;
    let v = viewer();
    let p = G.players[v];
    if (G.phase === 'drawn') {
      queueFly(slotId(v, idx), rectOf('dz-top'));
      queueFly('disc-top', rectOf(slotId(v, idx)));
      let old = p.cards[idx];
      p.cards[idx] = { ...G.drawnCard, known: true };
      G.discard.push(old); G.drawnCard = null; sfx('swap');
      G.log = `${p.name} swapped card ${idx + 1}.`;
      if (!checkMatch(old)) endTurn(); else render();
      return;
    }
    if (G.phase === 'spec-peek-own') {
      p.cards[idx].known = true;
      G.log = `${p.name} peeked their card ${idx + 1}.`;
      discardDrawnCard(); G.phase = 'play';
      flashCard(v, idx, 'reveal', 'You peeked!');
      setTimeout(endTurn, 2000);
      return;
    }
    if (G.phase === 'spec-swap1') {
      G.swapPick1 = { owner: v, idx };
      if (G.swapSeen) bnr(`Your card ${idx + 1}: ${p.cards[idx].rank}${p.cards[idx].suit}`, 'info');
      G.phase = 'spec-swap2'; render(); return;
    }
    if (G.phase === 'match-pick') {
      queueFly('disc-top', rectOf(slotId(v, idx)));
      let disc = p.cards.splice(idx, 1)[0];
      G.discard.push(disc); p.matchUsed = true; sfx('discard');
      bnr('Match bonus used!', 'good'); G.log = `${p.name} discarded card ${idx + 1} as bonus.`;
      endTurn(); return;
    }
  }
  function oppClick(oi, idx) {
    if (!myTurn()) return;
    if (G.phase === 'spec-peek-opp-pick' && G.peekOppWho === oi) {
      G.log = `${G.players[G.turn].name} peeked ${G.players[oi].name}'s card ${idx + 1}.`;
      discardDrawnCard(); G.phase = 'play';
      flashCard(oi, idx, 'reveal', `${G.players[oi].name}'s card`);
      setTimeout(endTurn, 2000);
      return;
    }
    if (G.phase === 'spec-swap2' && G.swapPick1) {
      let p1 = G.swapPick1;
      let c1 = { ...G.players[p1.owner].cards[p1.idx] };
      let c2 = { ...G.players[oi].cards[idx] };
      if (G.swapSeen) bnr(`Swapped! They had ${c2.rank}${c2.suit}`, 'info');
      else bnr('Blind swap done!', 'info');
      queueFly(slotId(p1.owner, p1.idx), rectOf(slotId(oi, idx)));
      queueFly(slotId(oi, idx), rectOf(slotId(p1.owner, p1.idx)));
      G.players[p1.owner].cards[p1.idx] = { ...c2, known: G.swapSeen, aiKnown: false, peekedBy: [] };
      G.players[oi].cards[idx] = { ...c1, known: false, aiKnown: false, peekedBy: [] };
      sfx('swap'); G.log = `${G.players[G.turn].name} swapped with ${G.players[oi].name}'s card ${idx + 1}.`;
      G.swapPick1 = null; G.swapSeen = false;
      discardDrawnCard(); endTurn(); return;
    }
  }
  function useSpecial() {
    let r = G.drawnCard.rank;
    if (r === '7' || r === '8') { G.phase = 'spec-peek-own'; render(); return; }
    if (r === '9' || r === '10') {
      G.peekOppWho = null;
      G.phase = G.players.length > 2 ? 'spec-peek-opp-who' : 'spec-peek-opp-pick';
      if (G.players.length === 2) G.peekOppWho = (G.turn + 1) % 2;
      render(); return;
    }
    if (r === 'J') {
      let next = (G.turn + 1) % G.players.length;
      G.players[next].skip = true;
      bnr(`${G.players[next].name}'s turn skipped!`, 'warn');
      G.log = `${G.players[G.turn].name} played J — skipped ${G.players[next].name}.`;
      discardDrawnCard(); sfx('special'); endTurn(); return;
    }
    if (r === 'Q') { G.swapSeen = false; G.swapPick1 = null; G.phase = 'spec-swap1'; render(); return; }
    if (r === 'K') { G.swapSeen = true; G.swapPick1 = null; G.phase = 'spec-swap1'; render(); return; }
  }
  function cancelSpec() { G.phase = 'drawn'; G.swapPick1 = null; G.swapSeen = false; G.peekOppWho = null; render(); }
  function callCabo() {
    if (!myTurn() || !canCallCabo()) return;
    G.caboBy = G.turn;
    G.finalPending = G.players.map((_, i) => i).filter((i) => i !== G.turn);
    bnr(`${G.players[G.turn].name} calls CABO! Everyone gets one final turn.`, 'cabo'); sfx('cabo');
    G.log = `${G.players[G.turn].name} called Cabo!`; endTurn();
  }

  // ── turn flow ──
  function endTurn() {
    if (G.phase === 'reveal') return;
    G.drawnCard = null; G.swapPick1 = null; G.swapSeen = false; G.peekOppWho = null; G.phase = 'play';
    G.turnsTaken++;
    let n = G.players.length, cabo = G.caboBy !== -1;
    if (cabo) G.finalPending = G.finalPending.filter((s) => s !== G.turn);
    let next = (G.turn + 1) % n;
    for (let guard = 0; guard < n * 2; guard++) {
      let p = G.players[next];
      if (p.skip) {
        bnr(`${p.name} is skipped!`, 'warn');
        p.skip = false;
        if (cabo) G.finalPending = G.finalPending.filter((s) => s !== next);
        next = (next + 1) % n; continue;
      }
      if (cabo && !G.finalPending.includes(next)) { next = (next + 1) % n; continue; }
      break;
    }
    if (cabo && G.finalPending.length === 0) { revealAll(); return; }
    if (!ensureDeck()) { bnr('No cards left — revealing!', 'warn'); revealAll(); return; }
    G.turn = next;
    let p = G.players[next];
    if (C.mode === 'pass') {
      render();
      setTimeout(() => handoff(next, () => {}), 450);
    } else {
      render();
      if (!p.isHuman) setTimeout(aiTurn, 900);
    }
  }

  // ── AI ──
  // AIs only use information they could legitimately have: their own
  // peeked cards (aiKnown) and opponent cards they peeked (peekedBy).
  function aiKnownOpp(ai_i) {
    let out = [];
    G.players.forEach((p, s) => {
      if (s === ai_i) return;
      p.cards.forEach((c, idx) => { if ((c.peekedBy || []).includes(ai_i)) out.push({ s, idx, v: cv(c.rank) }); });
    });
    return out;
  }
  function aiWorst(ai) {
    let worst = -1, worstV = -99;
    ai.cards.forEach((c, i) => { if (c.aiKnown && cv(c.rank) > worstV) { worstV = cv(c.rank); worst = i; } });
    return { worst, worstV };
  }
  function randomOpp(ai_i) {
    let opts = G.players.map((_, i) => i).filter((i) => i !== ai_i && G.players[i].cards.length);
    return opts[~~(Math.random() * opts.length)];
  }

  function aiTurn() {
    if (G.phase === 'reveal') return;
    let ai = G.players[G.turn], ai_i = G.turn;
    if (aiShouldCabo(ai_i)) {
      G.caboBy = ai_i; G.finalPending = G.players.map((_, i) => i).filter((i) => i !== ai_i);
      bnr(`${ai.name} calls CABO!`, 'cabo'); sfx('cabo'); G.log = `${ai.name} called Cabo!`;
      endTurn(); return;
    }
    let { worst, worstV } = aiWorst(ai);
    let top = G.discard[G.discard.length - 1];
    // grab a low discard if it clearly improves a known card
    if (top && C.diff !== 'easy' && worst !== -1 && cv(top.rank) <= 3 && worstV > cv(top.rank) + 2) {
      queueFly(slotId(ai_i, worst), rectOf('disc-top'));
      G.discard.pop();
      let old = ai.cards[worst];
      ai.cards[worst] = { ...top, aiKnown: true, known: false };
      setTimeout(() => {
        queueFly('disc-top', rectOf(slotId(ai_i, worst)));
        G.discard.push(old); sfx('swap');
        G.log = `${ai.name} took the ${top.rank}${top.suit} and swapped card ${worst + 1}.`;
        endTurn();
      }, 500);
      render();
      return;
    }
    if (!ensureDeck()) { endTurn(); return; }
    G.drawnCard = G.deck.pop();
    let drawn = G.drawnCard;
    sfx('draw');
    render();
    setTimeout(() => {
      if (isSpec(drawn.rank) && C.diff !== 'easy' && !(cv(drawn.rank) <= 0)) aiSpec(drawn, ai_i);
      else aiPlace(ai, ai_i, drawn);
    }, 550);
  }

  function aiPlace(ai, ai_i, drawn) {
    let { worst, worstV } = aiWorst(ai);
    let unknown = ai.cards.findIndex((c) => !c.aiKnown);
    let tgt = -1;
    if (worst !== -1 && worstV > cv(drawn.rank)) tgt = worst;
    else if (unknown !== -1 && cv(drawn.rank) <= 2) tgt = unknown; // a very low card beats an unknown
    let discarded;
    if (tgt !== -1) {
      queueFly(slotId(ai_i, tgt), rectOf('deck-top'), { flip: true });
      queueFly('disc-top', rectOf(slotId(ai_i, tgt)));
      discarded = ai.cards[tgt];
      G.discard.push(discarded);
      ai.cards[tgt] = { ...drawn, aiKnown: true, known: false };
      G.log = `${ai.name} swapped card ${tgt + 1}.`; sfx('swap');
    } else {
      queueFly('disc-top', rectOf('deck-top'), { flip: true });
      discarded = drawn;
      G.discard.push(drawn); G.log = `${ai.name} discarded ${drawn.rank}${drawn.suit}.`; sfx('discard');
    }
    G.drawnCard = null;
    if (checkMatch(discarded)) {
      let w = aiWorst(ai);
      if (w.worst !== -1 && w.worstV > 3) {
        render();
        setTimeout(() => {
          queueFly('disc-top', rectOf(slotId(ai_i, w.worst)));
          G.discard.push(ai.cards.splice(w.worst, 1)[0]); ai.matchUsed = true;
          bnr(`${ai.name} used the match bonus!`, 'good');
          endTurn();
        }, 600);
        return;
      }
    }
    endTurn();
  }

  function aiShouldCabo(i) {
    if (!canCallCabo()) return false;
    let ai = G.players[i];
    let ksum = ai.cards.reduce((s, c) => c.aiKnown ? s + cv(c.rank) : s, 0);
    let kn = ai.cards.filter((c) => c.aiKnown).length;
    if (!kn) return false;
    let est = ksum + (ai.cards.length - kn) * 6;
    let thr = C.diff === 'easy' ? 4 : C.diff === 'med' ? 9 : 13;
    return est <= thr && Math.random() > .35;
  }

  function aiSpec(card, ai_i) {
    let ai = G.players[ai_i], r = card.rank;
    let finish = (delay) => setTimeout(() => { discardDrawnCard(rectOf('deck-top')); endTurn(); }, delay);
    if (r === '7' || r === '8') {
      let unk = ai.cards.findIndex((c) => !c.aiKnown);
      if (unk === -1) { aiPlace(ai, ai_i, card); return; }
      ai.cards[unk].aiKnown = true;
      G.log = `${ai.name} peeked their own card ${unk + 1}.`;
      bnr(`${ai.name} peeked their own card ${unk + 1}!`, 'info');
      setTimeout(() => flashCard(ai_i, unk, 'peek', `${ai.name} peeked!`), 200);
      finish(1600); return;
    }
    if (r === '9' || r === '10') {
      let s = randomOpp(ai_i);
      let cands = G.players[s].cards.map((c, i) => i).filter((i) => !(G.players[s].cards[i].peekedBy || []).includes(ai_i));
      if (!cands.length) { aiPlace(ai, ai_i, card); return; }
      let idx = cands[~~(Math.random() * cands.length)];
      let c = G.players[s].cards[idx];
      c.peekedBy = [...(c.peekedBy || []), ai_i];
      let who = s === viewer() ? 'your' : `${G.players[s].name}'s`;
      G.log = `${ai.name} peeked ${who} card ${idx + 1}.`;
      bnr(`${ai.name} peeked ${who} card ${idx + 1}!`, 'warn');
      setTimeout(() => flashCard(s, idx, 'peek', `${ai.name} peeked!`), 200);
      finish(1800); return;
    }
    if (r === 'J') {
      let next = (ai_i + 1) % G.players.length;
      G.players[next].skip = true;
      bnr(`${ai.name} plays J — ${G.players[next].name} skipped!`, 'warn');
      G.log = `${ai.name} skipped ${G.players[next].name}.`;
      sfx('special'); discardDrawnCard(rectOf('deck-top')); endTurn(); return;
    }
    if (r === 'Q' || r === 'K') {
      let { worst, worstV } = aiWorst(ai);
      if (worst === -1) { finish(200); return; }
      let target = null;
      let known = aiKnownOpp(ai_i).sort((a, b) => a.v - b.v)[0];
      if (known && worstV > known.v + 2) target = known;
      else if (r === 'K') {
        // seen swap: the AI may look at a random opponent card first
        let s = randomOpp(ai_i), idx = ~~(Math.random() * G.players[s].cards.length);
        let v = cv(G.players[s].cards[idx].rank);
        if (worstV > v + 1) target = { s, idx, v };
      } else if (worstV >= 10 && C.diff === 'hard') {
        let s = randomOpp(ai_i); target = { s, idx: ~~(Math.random() * G.players[s].cards.length) };
      }
      if (!target) { finish(200); return; }
      let seen = r === 'K' || target.v !== undefined;
      let c1 = { ...ai.cards[worst] };
      let c2 = { ...G.players[target.s].cards[target.idx] };
      let who = target.s === viewer() ? 'your' : `${G.players[target.s].name}'s`;
      G.log = `${ai.name} ${r === 'K' ? 'seen' : 'blind'}-swapped card ${worst + 1} with ${who} card ${target.idx + 1}!`;
      bnr(G.log, 'warn');
      setTimeout(() => {
        animateSwap(ai_i, worst, target.s, target.idx, () => {
          ai.cards[worst] = { ...c2, aiKnown: seen, known: false, peekedBy: [] };
          G.players[target.s].cards[target.idx] = { ...c1, known: false, aiKnown: false, peekedBy: [ai_i] };
          discardDrawnCard(rectOf('deck-top')); endTurn();
        });
      }, 200);
      return;
    }
    finish(200);
  }

  function flashCard(ownerIdx, cardIdx, type, label) {
    render();
    let id = slotId(ownerIdx, cardIdx);
    if (type === 'peek') flashPeekBlur(id, G.players[ownerIdx].cards[cardIdx], label, render);
    if (type === 'reveal') flashPeekReveal(id, G.players[ownerIdx].cards[cardIdx], label, render);
    if (type === 'swap') flashSwapGlow(id);
  }

  function animateSwap(owner1, idx1, owner2, idx2, callback) {
    render();
    let el1 = document.getElementById(slotId(owner1, idx1));
    let el2 = document.getElementById(slotId(owner2, idx2));
    if (!el1 || !el2 || REDUCED_MOTION) { callback(); return; }
    let r1 = el1.getBoundingClientRect();
    let r2 = el2.getBoundingClientRect();
    el1.classList.add('ai-swap-flash');
    el2.classList.add('ai-swap-flash');
    sfx('swap');
    let fly1 = createFlyingCard(r1), fly2 = createFlyingCard(r2);
    document.body.appendChild(fly1);
    document.body.appendChild(fly2);
    el1.style.opacity = '0';
    el2.style.opacity = '0';
    let dur = 550, start = null;
    function step(ts) {
      if (!start) start = ts;
      let p = Math.min((ts - start) / dur, 1);
      let ep = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      let lift = Math.sin(p * Math.PI) * 30;
      fly1.style.left = (r1.left + (r2.left - r1.left) * ep) + 'px'; fly1.style.top = (r1.top + (r2.top - r1.top) * ep - lift) + 'px';
      fly2.style.left = (r2.left + (r1.left - r2.left) * ep) + 'px'; fly2.style.top = (r2.top + (r1.top - r2.top) * ep + lift) + 'px';
      if (p < 1) requestAnimationFrame(step);
      else { fly1.remove(); fly2.remove(); el1.style.opacity = ''; el2.style.opacity = ''; callback(); }
    }
    requestAnimationFrame(step);
  }
  // swaps move face-down cards — never reveal the faces in flight
  function createFlyingCard(r) {
    let div = mkCard(null, false);
    div.classList.add('flying-card');
    div.style.left = r.left + 'px'; div.style.top = r.top + 'px';
    div.style.width = r.width + 'px'; div.style.height = r.height + 'px';
    div.style.boxShadow = '0 8px 32px rgba(0,0,0,.6)';
    return div;
  }

  function revealAll() {
    G.phase = 'reveal';
    G.finalPending = [];
    G.players.forEach((p) => p.cards.forEach((c) => { c.known = true; }));
    sfx('reveal'); render();
    let delay = revealAnimation();
    let scores = G.players.map((p, i) => ({ i, n: p.name, s: scoreOf(i) }));
    let min = Math.min(...scores.map((x) => x.s));
    let winners = scores.filter((x) => x.s === min).map((x) => x.i);
    let caboLost = G.caboBy !== -1 && scores[G.caboBy].s !== min;
    let resets = [];
    scores.forEach((x) => {
      let t = (TOTALS[x.i] || 0) + x.s + (caboLost && x.i === G.caboBy ? 5 : 0);
      if (t === TARGET) { t = 50; resets.push(x.n); }
      TOTALS[x.i] = t;
    });
    let gameOver = TOTALS.some((t) => t > TARGET);
    setTimeout(() => showRoundResult({
      names: G.players.map((p) => p.name), roundScores: scores.map((x) => x.s), totals: TOTALS.slice(),
      winners, caboBy: G.caboBy, caboLost, resets, gameOver, you: viewer(),
    }, gameOver
      ? [{ t: 'New Game', c: 'ab pri', fn: () => { closeOv(); TOTALS = Array(C.np).fill(0); G.round = 1; initRound(); } },
         { t: 'Main Menu', c: 'ab', fn: toMenu }]
      : [{ t: 'Next Round', c: 'ab pri', fn: () => { closeOv(); G.round++; initRound(); } },
         { t: 'New Game', c: 'ab', fn: () => { closeOv(); TOTALS = Array(C.np).fill(0); G.round = 1; initRound(); } },
         { t: 'Main Menu', c: 'ab', fn: toMenu }]), delay + 400);
  }

  function renderScoreboard() {
    let sb = document.getElementById('scoreboard');
    if (!sb.classList.contains('show')) return;
    sb.innerHTML = '';
    if (!G.players) return;
    G.players.forEach((p, i) => {
      let r = document.createElement('div'); r.className = 'sc-row' + (i === viewer() ? ' you' : '');
      r.innerHTML = `<span>${esc(p.name)}</span><b>${TOTALS[i] || 0}</b>`;
      sb.appendChild(r);
    });
    let t = document.createElement('div'); t.className = 'sc-target'; t.textContent = `Game ends past ${TARGET}`; sb.appendChild(t);
  }
  function toggleScores() { document.getElementById('scoreboard').classList.toggle('show'); renderScoreboard(); }

  function openMenu() {
    showOv('Menu', settingsHTML(),
      [{ t: 'Restart Round', c: 'ab pri', fn: () => { closeOv(); initRound(); } },
       { t: 'New Game', c: 'ab', fn: () => { closeOv(); TOTALS = Array(C.np).fill(0); G.round = 1; initRound(); } },
       { t: 'Main Menu', c: 'ab', fn: toMenu },
       { t: 'Close', c: 'ab', fn: closeOv }]);
    bindSettings(render);
  }
  function toMenu() { closeOv(); Screens.show('setup'); TOTALS = []; G = {}; }

  return { setSeg, startGame, callCabo, toggleScores, openMenu, toMenu, rerender: render, config: C };
})();
