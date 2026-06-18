// Local play: vs AI and pass-&-play. Ported from the original prototype,
// unchanged in rules/behavior — just namespaced and wired to shared-ui.js.
const Local = (function () {
  let C = { np: 3, mode: 'solo', diff: 'med', name: 'You' };
  let G = {};
  let TOTALS = [];

  function setSeg(k, v, btn) {
    C[k] = v;
    btn.closest('.seg').querySelectorAll('.sb').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    if (k === 'mode') document.getElementById('diff-seg').style.opacity = v === 'pass' ? '.35' : '1';
  }

  function mkDeck() { let d = []; for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s }); d.push({ rank: 'JOKER', suit: '★' }, { rank: 'JOKER', suit: '★' }); return d; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ~~(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function startGame() {
    C.name = document.getElementById('pname').value.trim() || 'You';
    Screens.show('game');
    if (TOTALS.length === 0) TOTALS = Array(C.np).fill(0);
    initRound();
  }

  function initRound() {
    let deck = shuffle(mkDeck());
    let n = C.np;
    let names = [C.name];
    for (let i = 1; i < n; i++) names.push(C.mode === 'pass' ? `P${i + 1}` : `AI ${i}`);
    let players = names.map((nm, i) => ({
      name: nm, isHuman: i === 0 || (C.mode === 'pass'),
      cards: deck.splice(0, 4).map((c) => ({ ...c, known: false, aiKnown: false })),
      matchUsed: false, skip: false,
    }));
    let discard = [deck.pop()];
    players[0].cards[0].known = true;
    players[0].cards[1].known = true;
    for (let i = 1; i < n; i++) { players[i].cards[2].aiKnown = true; players[i].cards[3].aiKnown = true; }
    G = {
      deck, discard, players, turn: 0, phase: 'play', drawnCard: null, swapSeen: false, swapPick1: null,
      peekOppWho: null, caboBy: -1, caboLeft: 0, round: G.round || 1, log: 'Game started — you peeked at your first two cards.',
    };
    if (C.mode === 'pass') showPassPeek(0, () => render());
    else render();
  }

  function showPassPeek(pi, cb) {
    let p = G.players[pi];
    showOv(`${p.name}'s Turn`,
      `<div style="margin-bottom:.8rem">Pass the device to <b style="color:var(--gold)">${p.name}</b>.</div>`,
      [{ t: 'Peek My Cards', c: 'ab pri', fn: () => {
        closeOv();
        p.cards[0].known = true; p.cards[1].known = true;
        showOv(`${p.name} — Your Cards`, buildPeekHTML(pi),
          [{ t: 'Done — Hide', c: 'ab pri', fn: () => {
            if (pi !== 0) { p.cards[0].known = false; p.cards[1].known = false; }
            closeOv(); cb();
          } }]);
      } }]);
  }
  function buildPeekHTML(pi) {
    let p = G.players[pi];
    let h = '<div style="display:flex;gap:10px;justify-content:center;margin:.5rem 0">';
    for (let i = 0; i < 2; i++) {
      let c = p.cards[i], isJ = c.rank === 'JOKER', isR = RED.has(c.suit);
      let bg = isJ ? 'linear-gradient(155deg,#12022a,#2a0d52)' : '#fdf8f0';
      let col = isJ ? '#d4a843' : (isR ? '#c0392b' : '#1a1008');
      h += `<div style="width:68px;height:96px;border-radius:10px;background:${bg};border:1.5px solid rgba(255,255,255,.2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
        <span style="font-family:'Playfair Display',serif;font-size:1.35rem;font-weight:700;color:${col}">${c.rank}</span>
        <span style="font-size:.84rem;color:${col}">${c.suit}</span></div>`;
    }
    return h + '</div><div style="font-size:.72rem;color:#888">Cards 1 &amp; 2</div>';
  }

  function render() {
    renderOpps();
    renderHuman();
    renderCenter();
    renderActions();
    document.getElementById('rbadge').textContent = `ROUND ${G.round}`;
    document.getElementById('cabo-btn').disabled = G.caboBy !== -1 || G.turn !== 0 || G.phase !== 'play';
    if (G.log) document.getElementById('glog').textContent = G.log;
    renderScoreboard();
  }
  function scoreOf(i) { return G.players[i].cards.reduce((s, c) => s + cv(c.rank), 0); }

  function renderOpps() {
    let row = document.getElementById('opps'); row.innerHTML = '';
    for (let i = 1; i < G.players.length; i++) {
      let p = G.players[i];
      let z = document.createElement('div'); z.className = 'opz'; z.id = `opz-${i}`;
      let nm = document.createElement('div'); nm.className = 'pnm';
      if (G.turn === i) { let d = document.createElement('div'); d.className = 'tdot'; nm.appendChild(d); }
      let ns = document.createElement('span'); ns.textContent = p.name; nm.appendChild(ns);
      if (G.caboBy === i) { let t = document.createElement('span'); t.className = 'ctag'; t.textContent = 'CABO'; nm.appendChild(t); }
      let sp = document.createElement('span'); sp.className = 'spip'; sp.textContent = G.phase === 'reveal' ? scoreOf(i) : '?'; nm.appendChild(sp);
      z.appendChild(nm);
      let cr = document.createElement('div'); cr.className = 'crow'; cr.id = `crow-${i}`;
      p.cards.forEach((c, idx) => {
        let faceUp = G.phase === 'reveal';
        let hl = '', clickable = false;
        if (G.turn === 0) {
          if (G.phase === 'spec-peek-opp-pick' && G.peekOppWho === i) { hl = 'peek'; clickable = true; }
          if (G.phase === 'spec-swap2') { hl = 'swap'; clickable = true; }
        }
        if (C.mode === 'pass' && G.turn === i && G.phase !== 'reveal') faceUp = c.known;
        let w = document.createElement('div'); w.className = 'cwrap'; w.id = `cw-${i}-${idx}`;
        let card = mkCard(c, faceUp, { clickable, hl });
        card.id = `card-${i}-${idx}`;
        if (clickable) card.onclick = () => oppClick(i, idx);
        w.appendChild(card);
        let li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
        w.appendChild(li);
        cr.appendChild(w);
      });
      z.appendChild(cr);
      row.appendChild(z);
    }
  }

  function renderHuman() {
    let p = G.players[0];
    let row = document.getElementById('ycards'); row.innerHTML = '';
    document.getElementById('ydot').style.display = G.turn === 0 ? 'block' : 'none';
    let lbl = document.getElementById('ylbl');
    lbl.textContent = (G.players[0].name + (G.caboBy === 0 ? ' · CABO' : '')).toUpperCase();
    let known = p.cards.filter((c) => c.known);
    let ksum = known.reduce((s, c) => s + cv(c.rank), 0);
    let pip = document.getElementById('ypip');
    pip.textContent = G.phase === 'reveal' ? scoreOf(0) : (known.length === p.cards.length ? ksum : ksum + '+' + (p.cards.length - known.length) + '?');
    p.cards.forEach((c, idx) => {
      let faceUp = c.known || G.phase === 'reveal';
      let hl = '', sel = false, clickable = false;
      if (G.turn === 0) {
        if (G.phase === 'drawn') { clickable = true; hl = 'discard'; }
        if (G.phase === 'spec-peek-own') { clickable = true; hl = 'peek'; }
        if (G.phase === 'spec-swap1') { clickable = true; hl = 'swap'; }
        if (G.phase === 'spec-swap2' && G.swapPick1 && G.swapPick1.owner === 0 && G.swapPick1.idx === idx) sel = true;
        if (G.phase === 'match-pick') { clickable = true; hl = 'discard'; }
      }
      let w = document.createElement('div'); w.className = 'cwrap'; w.id = `cw-0-${idx}`;
      let card = mkCard(c, faceUp, { clickable, hl, sel, knownG: c.known && G.phase !== 'reveal' });
      card.id = `card-0-${idx}`;
      if (clickable) card.onclick = () => youClick(idx);
      w.appendChild(card);
      let li = document.createElement('div'); li.className = 'cidx'; li.textContent = idx + 1;
      w.appendChild(li);
      row.appendChild(w);
    });
  }

  function renderCenter() {
    let de = document.getElementById('deck-el'); de.innerHTML = '';
    if (G.deck.length > 0) {
      let wrap = document.createElement('div'); wrap.className = 'deck-stack';
      if (G.deck.length > 2) { let s2 = document.createElement('div'); s2.className = 'ds2'; wrap.appendChild(s2); }
      if (G.deck.length > 1) { let s1 = document.createElement('div'); s1.className = 'ds1'; wrap.appendChild(s1); }
      let card = mkCard(null, false, { clickable: G.turn === 0 && G.phase === 'play' });
      if (G.turn === 0 && G.phase === 'play') card.onclick = drawDeck;
      wrap.appendChild(card);
      de.appendChild(wrap);
    } else {
      let ep = document.createElement('div'); ep.className = 'empty-pile'; ep.textContent = '0'; de.appendChild(ep);
    }
    document.getElementById('deck-cnt').textContent = G.deck.length + ' left';

    let dz = document.getElementById('dz');
    let dzCard = document.getElementById('dz-card');
    let dzActs = document.getElementById('dz-acts');
    dzCard.innerHTML = ''; dzActs.innerHTML = '';
    let myTurn = (G.turn === 0) || (C.mode === 'pass' && G.players[G.turn] && G.players[G.turn].isHuman);
    if (G.drawnCard && myTurn) {
      dz.classList.add('active');
      let card = mkCard(G.drawnCard, true);
      card.classList.add('deal-anim');
      dzCard.appendChild(card);
      if (G.phase === 'drawn') {
        dzActs.appendChild(mkBtn('Discard', 'ab dng', doDiscardDrawn));
        dzActs.appendChild(mkBtn('Swap a Card', 'ab pri', () => setMsg('Click <span class="hl">one of your cards</span> to swap.')));
        if (isSpec(G.drawnCard.rank)) dzActs.appendChild(mkBtn(specLbl(G.drawnCard.rank), 'ab sec', useSpecial));
      }
    } else {
      dz.classList.remove('active');
      dzCard.innerHTML = '<div class="dz-empty">+</div>';
    }

    let dse = document.getElementById('disc-el'); dse.innerHTML = '';
    if (G.discard.length > 0) {
      let wrap = document.createElement('div'); wrap.className = 'disc-stack';
      if (G.discard.length > 1) { let sh = document.createElement('div'); sh.className = 'dsh'; wrap.appendChild(sh); }
      let top = G.discard[G.discard.length - 1];
      let canTake = G.turn === 0 && G.phase === 'play';
      let card = mkCard(top, true, { clickable: canTake });
      if (canTake) card.onclick = drawDiscard;
      wrap.appendChild(card);
      dse.appendChild(wrap);
    } else {
      let ep = document.createElement('div'); ep.className = 'empty-pile'; ep.textContent = '+'; dse.appendChild(ep);
    }
    document.getElementById('disc-cnt').textContent = G.discard.length + ' cards';
  }

  function renderActions() {
    let msg = document.getElementById('amsg');
    let br = document.getElementById('brow'); br.innerHTML = '';
    let p = G.players[G.turn];
    if (!p || G.phase === 'reveal' || G.phase === 'pass-peek') { msg.innerHTML = '&nbsp;'; return; }
    let myTurn = (G.turn === 0) || (C.mode === 'pass' && p.isHuman);
    if (!myTurn) { msg.innerHTML = `<span class="hl">${p.name}</span> <span class="dim">is thinking...</span>`; return; }
    if (G.phase === 'play') {
      let x = G.caboBy !== -1 && G.caboBy !== G.turn ? ' <span class="dim">· Last turn!</span>' : '';
      msg.innerHTML = `Draw from <span class="hl">deck</span> or take top <span class="hl">discard</span>.${x}`;
    }
    if (G.phase === 'drawn') msg.innerHTML = `<span class="hl">Drawn card shown above</span> — Discard, Swap, or use Special.`;
    if (G.phase === 'spec-peek-own') {
      msg.innerHTML = `Click one of <span class="hl">your cards</span> to peek.`;
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-peek-opp-who') {
      msg.innerHTML = `Choose <span class="hl">which opponent</span> to peek at.`;
      for (let i = 1; i < G.players.length; i++) {
        let ii = i; br.appendChild(mkBtn(G.players[i].name, 'ab', () => { G.peekOppWho = ii; G.phase = 'spec-peek-opp-pick'; render(); }));
      }
      br.appendChild(mkBtn('Cancel', 'ab', cancelSpec));
    }
    if (G.phase === 'spec-peek-opp-pick') {
      msg.innerHTML = `Click a card from <span class="hl">${G.players[G.peekOppWho].name}</span>.`;
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
      br.appendChild(mkBtn('Skip', 'ab', () => { G.phase = 'play'; G.log = 'Match bonus skipped.'; endTurn(); }));
    }
  }

  function drawDeck() {
    if (!G.deck.length) { bnr('Deck empty!', 'warn'); return; }
    G.drawnCard = G.deck.pop(); G.phase = 'drawn'; sfx('draw'); render();
  }
  function drawDiscard() {
    if (!G.discard.length) return;
    G.drawnCard = G.discard.pop(); G.phase = 'drawn'; sfx('draw'); render();
  }
  function doDiscardDrawn() {
    let card = G.drawnCard;
    G.discard.push(card); G.drawnCard = null; sfx('discard');
    let matched = checkMatch(card);
    if (!matched) { G.phase = 'play'; endTurn(); } else render();
  }
  function checkMatch(card) {
    if (G.discard.length < 2 || G.players[G.turn].matchUsed) return false;
    let prev = G.discard[G.discard.length - 2];
    if (prev && prev.rank === card.rank) {
      G.phase = 'match-pick'; bnr('Match! Discard a card for free!', 'good'); sfx('match'); return true;
    }
    return false;
  }
  function youClick(idx) {
    let p = G.players[0];
    if (G.phase === 'drawn') {
      let old = p.cards[idx];
      p.cards[idx] = { ...G.drawnCard, known: true };
      G.discard.push(old); G.drawnCard = null; sfx('swap');
      G.log = `You swapped card ${idx + 1}.`;
      let m = checkMatch(old);
      if (!m) { G.phase = 'play'; endTurn(); } else render();
      return;
    }
    if (G.phase === 'spec-peek-own') {
      p.cards[idx].known = true;
      G.log = `You peeked your card ${idx + 1}.`;
      G.discard.push(G.drawnCard); G.drawnCard = null; G.phase = 'play';
      flashCard(0, idx, 'reveal', 'You peeked!');
      setTimeout(endTurn, 1450);
      return;
    }
    if (G.phase === 'spec-swap1') {
      G.swapPick1 = { owner: 0, idx };
      if (G.swapSeen) bnr(`Your card ${idx + 1}: ${p.cards[idx].rank}${p.cards[idx].suit}`, 'info');
      G.phase = 'spec-swap2'; render(); return;
    }
    if (G.phase === 'match-pick') {
      let disc = p.cards.splice(idx, 1)[0];
      G.discard.push(disc); p.matchUsed = true; sfx('discard');
      bnr('Match bonus used!', 'good'); G.log = `You discarded card ${idx + 1} as bonus.`;
      G.phase = 'play'; endTurn(); return;
    }
  }
  function oppClick(oi, idx) {
    if (G.phase === 'spec-peek-opp-pick' && G.peekOppWho === oi) {
      G.log = `You peeked ${G.players[oi].name}'s card ${idx + 1}.`;
      G.discard.push(G.drawnCard); G.drawnCard = null; G.phase = 'play';
      flashCard(oi, idx, 'reveal', `${G.players[oi].name}'s card`);
      setTimeout(endTurn, 1450);
      return;
    }
    if (G.phase === 'spec-swap2' && G.swapPick1) {
      let p1 = G.swapPick1;
      let c1 = { ...G.players[p1.owner].cards[p1.idx] };
      let c2 = { ...G.players[oi].cards[idx] };
      if (G.swapSeen) bnr(`Swapped! They had ${c2.rank}${c2.suit}`, 'info');
      else bnr('Blind swap done!', 'info');
      G.players[p1.owner].cards[p1.idx] = { ...c2, known: G.swapSeen, aiKnown: false };
      G.players[oi].cards[idx] = { ...c1, known: false, aiKnown: false };
      sfx('swap'); G.log = `You swapped with ${G.players[oi].name}'s card ${idx + 1}.`;
      G.swapPick1 = null; G.swapSeen = false;
      G.discard.push(G.drawnCard); G.drawnCard = null; G.phase = 'play'; endTurn(); return;
    }
  }
  function useSpecial() {
    let r = G.drawnCard.rank;
    if (r === '7' || r === '8') { G.phase = 'spec-peek-own'; render(); return; }
    if (r === '9' || r === '10') {
      G.peekOppWho = null;
      G.phase = G.players.length > 2 ? 'spec-peek-opp-who' : 'spec-peek-opp-pick';
      if (G.players.length === 2) G.peekOppWho = 1;
      render(); return;
    }
    if (r === 'J') {
      let next = (G.turn + 1) % G.players.length;
      G.players[next].skip = true;
      bnr(`${G.players[next].name}'s turn skipped!`, 'warn');
      G.log = `${G.players[G.turn].name} played J — skipped ${G.players[next].name}.`;
      G.discard.push(G.drawnCard); G.drawnCard = null; G.phase = 'play'; sfx('special'); endTurn(); return;
    }
    if (r === 'Q') { G.swapSeen = false; G.swapPick1 = null; G.phase = 'spec-swap1'; render(); return; }
    if (r === 'K') { G.swapSeen = true; G.swapPick1 = null; G.phase = 'spec-swap1'; render(); return; }
  }
  function cancelSpec() { G.phase = 'drawn'; G.swapPick1 = null; G.swapSeen = false; G.peekOppWho = null; render(); }
  function callCabo() {
    if (G.caboBy !== -1 || G.phase !== 'play' || G.turn !== 0) return;
    G.caboBy = 0; G.caboLeft = G.players.length - 1;
    bnr('CABO! Everyone gets one final turn.', 'cabo'); sfx('cabo');
    G.log = 'You called Cabo!'; endTurn();
  }

  function endTurn() {
    G.drawnCard = null; G.swapPick1 = null; G.swapSeen = false; G.peekOppWho = null; G.phase = 'play';
    if (G.caboBy !== -1) { G.caboLeft--; if (G.caboLeft <= 0) { revealAll(); return; } }
    let next = (G.turn + 1) % G.players.length;
    let safety = 0;
    while (G.players[next].skip && safety < G.players.length) {
      bnr(`${G.players[next].name} is skipped!`, 'warn');
      G.players[next].skip = false; next = (next + 1) % G.players.length; safety++;
    }
    if (next <= G.turn) G.round++;
    G.turn = next;
    if (C.mode === 'pass') {
      render(); setTimeout(() => showPassPeek(next, () => { render(); if (!G.players[next].isHuman) setTimeout(aiTurn, 800); }), 300);
    } else {
      render();
      if (!G.players[G.turn].isHuman) setTimeout(aiTurn, 900);
    }
  }

  function aiTurn() {
    if (G.phase === 'reveal') return;
    let ai = G.players[G.turn], ai_i = G.turn;
    if (G.caboBy === -1 && aiShouldCabo(ai_i)) {
      G.caboBy = ai_i; G.caboLeft = G.players.length - 1;
      bnr(`${ai.name} calls CABO!`, 'cabo'); G.log = `${ai.name} called Cabo!`;
      endTurn(); return;
    }
    if (!G.deck.length) { endTurn(); return; }
    G.drawnCard = G.deck.pop();
    let drawn = G.drawnCard;
    setTimeout(() => {
      if (isSpec(drawn.rank) && C.diff !== 'easy') aiSpec(drawn, ai_i);
      else {
        let worst = -1, worstV = -99;
        ai.cards.forEach((c, i) => { if (c.aiKnown && cv(c.rank) > worstV) { worstV = cv(c.rank); worst = i; } });
        if (worst !== -1 && worstV > cv(drawn.rank)) {
          G.discard.push(ai.cards[worst]);
          ai.cards[worst] = { ...drawn, aiKnown: true, known: false };
          G.log = `${ai.name} swapped a card.`;
        } else {
          G.discard.push(drawn); G.log = `${ai.name} discarded.`;
        }
        G.drawnCard = null; G.phase = 'play'; endTurn();
      }
    }, 550);
  }

  function aiShouldCabo(i) {
    let ai = G.players[i];
    let ksum = ai.cards.reduce((s, c) => c.aiKnown ? s + cv(c.rank) : s, 0);
    let kn = ai.cards.filter((c) => c.aiKnown).length;
    if (!kn) return false;
    let est = ksum + (4 - kn) * 6;
    let thr = C.diff === 'easy' ? 4 : C.diff === 'med' ? 9 : 13;
    return est <= thr && Math.random() > .35;
  }

  function aiSpec(card, ai_i) {
    let ai = G.players[ai_i], r = card.rank;
    if (r === '7' || r === '8') {
      let unk = ai.cards.findIndex((c) => !c.aiKnown);
      if (unk !== -1) {
        ai.cards[unk].aiKnown = true;
        G.log = `${ai.name} peeked their own card ${unk + 1}.`;
        bnr(`${ai.name} peeked their own card ${unk + 1}!`, 'info');
        setTimeout(() => { flashCard(ai_i, unk, 'peek', null); }, 200);
      }
      setTimeout(() => { G.discard.push(card); G.drawnCard = null; G.phase = 'play'; endTurn(); }, 1200);
      return;
    }
    if (r === '9' || r === '10') {
      let tgtOwner = 0;
      let tgtIdx = ~~(Math.random() * G.players[tgtOwner].cards.length);
      G.log = `${ai.name} peeked your card ${tgtIdx + 1}!`;
      bnr(`${ai.name} peeked your card ${tgtIdx + 1}!`, 'warn');
      setTimeout(() => { flashCard(tgtOwner, tgtIdx, 'peek', ai.name + ' peeked!'); }, 200);
      setTimeout(() => { G.discard.push(card); G.drawnCard = null; G.phase = 'play'; endTurn(); }, 1600);
      return;
    }
    if (r === 'J') {
      let next = (ai_i + 1) % G.players.length;
      G.players[next].skip = true;
      bnr(`${ai.name} plays J — ${G.players[next].name} skipped!`, 'warn');
      G.log = `${ai.name} skipped ${G.players[next].name}.`;
      G.discard.push(card); G.drawnCard = null; G.phase = 'play'; sfx('special');
      endTurn(); return;
    }
    if (r === 'Q' || r === 'K') {
      let worstI = -1, worstV = -99;
      ai.cards.forEach((c, i) => { if (c.aiKnown && cv(c.rank) > worstV) { worstV = cv(c.rank); worstI = i; } });
      let bestH = -1, bestHV = 99;
      G.players[0].cards.forEach((c, i) => { if (cv(c.rank) < bestHV) { bestHV = cv(c.rank); bestH = i; } });
      if (worstI !== -1 && bestH !== -1 && worstV > bestHV + 2) {
        let seenSwap = r === 'K';
        let c1 = { ...ai.cards[worstI] };
        let c2 = { ...G.players[0].cards[bestH] };
        G.log = `${ai.name} ${seenSwap ? 'seen' : 'blind'} swapped card ${worstI + 1} with your card ${bestH + 1}!`;
        if (seenSwap) bnr(`${ai.name} seen-swapped with your card ${bestH + 1}! (${c2.rank}${c2.suit})`, 'warn');
        else bnr(`${ai.name} blind-swapped their card ${worstI + 1} with your card ${bestH + 1}!`, 'warn');
        setTimeout(() => {
          animateSwap(ai_i, worstI, 0, bestH, () => {
            ai.cards[worstI] = { ...c2, aiKnown: true, known: false };
            G.players[0].cards[bestH] = { ...c1, known: false, aiKnown: false };
            G.discard.push(card); G.drawnCard = null; G.phase = 'play';
            sfx('swap'); render(); endTurn();
          });
        }, 200);
      } else {
        G.discard.push(card); G.drawnCard = null; G.phase = 'play'; endTurn();
      }
      return;
    }
    G.discard.push(card); G.drawnCard = null; G.phase = 'play'; endTurn();
  }

  function flashCard(ownerIdx, cardIdx, type, label) {
    render();
    if (type === 'peek') flashPeekBlur(`card-${ownerIdx}-${cardIdx}`, G.players[ownerIdx].cards[cardIdx], label, render);
    if (type === 'reveal') flashPeekReveal(`card-${ownerIdx}-${cardIdx}`, G.players[ownerIdx].cards[cardIdx], label, render);
    if (type === 'swap') flashSwapGlow(`card-${ownerIdx}-${cardIdx}`);
  }

  function animateSwap(owner1, idx1, owner2, idx2, callback) {
    render();
    let el1 = document.getElementById(`card-${owner1}-${idx1}`);
    let el2 = document.getElementById(`card-${owner2}-${idx2}`);
    if (!el1 || !el2) { callback(); return; }
    let r1 = el1.getBoundingClientRect();
    let r2 = el2.getBoundingClientRect();
    el1.classList.add('ai-swap-flash');
    el2.classList.add('ai-swap-flash');
    sfx('swap');
    let c1 = G.players[owner1].cards[idx1];
    let c2 = G.players[owner2].cards[idx2];
    let fly1 = createFlyingCard(c1, r1.left, r1.top, r1.width, r1.height);
    let fly2 = createFlyingCard(c2, r2.left, r2.top, r2.width, r2.height);
    document.body.appendChild(fly1);
    document.body.appendChild(fly2);
    el1.style.opacity = '0';
    el2.style.opacity = '0';
    let dur = 500, start = null;
    function step(ts) {
      if (!start) start = ts;
      let p = Math.min((ts - start) / dur, 1);
      let ep = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      fly1.style.left = (r1.left + (r2.left - r1.left) * ep) + 'px'; fly1.style.top = (r1.top + (r2.top - r1.top) * ep) + 'px';
      fly2.style.left = (r2.left + (r1.left - r2.left) * ep) + 'px'; fly2.style.top = (r2.top + (r1.top - r2.top) * ep) + 'px';
      if (p < 1) requestAnimationFrame(step);
      else { fly1.remove(); fly2.remove(); el1.style.opacity = ''; el2.style.opacity = ''; callback(); }
    }
    requestAnimationFrame(step);
  }
  function createFlyingCard(c, x, y, w, h) {
    let div = document.createElement('div');
    div.className = 'flying-card';
    div.style.left = x + 'px'; div.style.top = y + 'px';
    div.style.width = w + 'px'; div.style.height = h + 'px';
    div.style.boxShadow = '0 8px 32px rgba(0,0,0,.6)';
    let isJ = c.rank === 'JOKER', isR = RED.has(c.suit);
    let bg = isJ ? 'linear-gradient(155deg,#12022a,#2a0d52)' : '#fdf8f0';
    let col = isJ ? '#d4a843' : (isR ? '#c0392b' : '#1a1008');
    div.style.background = bg;
    div.style.border = '1.5px solid rgba(255,255,255,.3)';
    div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'center';
    div.style.flexDirection = 'column'; div.style.borderRadius = '10px';
    div.innerHTML = `<span style="font-family:'Playfair Display',serif;font-size:1.2rem;font-weight:700;color:${col}">${c.rank}</span><span style="font-size:.8rem;color:${col}">${c.suit}</span>`;
    return div;
  }

  function revealAll() {
    G.phase = 'reveal';
    G.players.forEach((p) => p.cards.forEach((c) => { c.known = true; }));
    sfx('reveal'); render();
    let scores = G.players.map((p, i) => ({ i, n: p.name, s: scoreOf(i) }));
    let min = Math.min(...scores.map((x) => x.s));
    let wi = scores.findIndex((x) => x.s === min);
    let caboLost = G.caboBy !== -1 && scores[G.caboBy].s !== min;
    scores.forEach((x) => { TOTALS[x.i] = (TOTALS[x.i] || 0) + x.s + (caboLost && x.i === G.caboBy ? 5 : 0); });
    let rows = scores.map((x) => {
      let pen = caboLost && x.i === G.caboBy ? ' +5' : '';
      return `<tr class="${x.s === min ? 'win' : ''}"><td>${x.n}${x.i === G.caboBy ? ' ★' : ''}</td><td class="scc">${x.s}${pen}</td><td class="scc" style="color:#7a6e5a">${TOTALS[x.i]}</td></tr>`;
    }).join('');
    let extra = caboLost ? `<div style="color:#e07070;font-size:.76rem;margin-bottom:.5rem">${G.players[G.caboBy].name} called Cabo but didn't win — +5 penalty!</div>` : '';
    setTimeout(() => {
      showOv('Round Over',
        `${extra}<table class="sct"><thead><tr><th style="text-align:left;color:var(--gold)">Player</th><th style="color:var(--gold)">Round</th><th style="color:var(--gold)">Total</th></tr></thead><tbody>${rows}</tbody></table><br>Winner: <b style="color:var(--gold2)">${G.players[wi].name}</b>`,
        [{ t: 'Next Round', c: 'ab pri', fn: () => { closeOv(); G.round++; initRound(); } },
         { t: 'New Game', c: 'ab', fn: () => { closeOv(); TOTALS = []; G.round = 1; initRound(); } },
         { t: 'Main Menu', c: 'ab', fn: toMenu }]);
    }, 500);
  }

  function renderScoreboard() {
    let sb = document.getElementById('scoreboard');
    if (!sb.classList.contains('show')) return;
    sb.innerHTML = '';
    if (!G.players) return;
    G.players.forEach((p, i) => {
      let r = document.createElement('div'); r.className = 'sc-row' + (i === 0 ? ' you' : '');
      r.innerHTML = `<span>${p.name}</span><b>${TOTALS[i] || 0}</b>`;
      sb.appendChild(r);
    });
  }
  function toggleScores() { document.getElementById('scoreboard').classList.toggle('show'); renderScoreboard(); }

  function openMenu() {
    showOv('Menu', '',
      [{ t: 'Restart Round', c: 'ab pri', fn: () => { closeOv(); initRound(); } },
       { t: 'New Game', c: 'ab', fn: () => { closeOv(); TOTALS = []; G.round = 1; initRound(); } },
       { t: 'Main Menu', c: 'ab', fn: toMenu }]);
  }
  function toMenu() { closeOv(); Screens.show('setup'); TOTALS = []; G = {}; }

  return { setSeg, startGame, callCabo, toggleScores, openMenu, toMenu, config: C };
})();
