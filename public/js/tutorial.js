// How to Play: animated lessons (one short scene per rule) followed by a
// scripted, guided practice round against a bot. Self-contained — it never
// touches the real game state — and reuses mkCard() so cards look identical.

const Tutorial = (() => {
  let tok = 0;          // bumps on every scene change; stale animations stop
  let mode = 'lessons';
  let li = 0;           // current lesson index
  let root, stage, dots, nav;

  // ── tiny helpers ──
  const C = (rank, suit) => ({ rank, suit });
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = (t) => t === tok;
  // wait, then report whether this scene is still the active one
  const w = async (ms, t) => { await sleep(ms); return alive(t); };

  function mk(c, up, cls) {
    const e = mkCard(c || { rank: '?', suit: '' }, up);
    if (cls) cls.split(' ').forEach((k) => k && e.classList.add(k));
    return e;
  }
  // Slide an element from a previous on-screen rect into its current spot.
  function slide(el, from, dur = 480) {
    if (!el || !from || REDUCED_MOTION || !el.animate) return Promise.resolve();
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left, dy = from.top - to.top;
    const s = to.width ? from.width / to.width : 1;
    return el.animate([
      { transform: `translate(${dx}px,${dy}px) scale(${s})`, zIndex: 50, boxShadow: '0 16px 34px rgba(0,0,0,.6)' },
      { transform: 'none', zIndex: 50 },
    ], { duration: dur, easing: 'cubic-bezier(.2,.75,.3,1)' }).finished.catch(() => {});
  }
  // Flip a card element over to show/hide `c`. Returns the new element.
  async function flip(el, c, up, cls) {
    if (!el) return null;
    if (!REDUCED_MOTION && el.animate) {
      await el.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: 170, easing: 'ease-in' }).finished.catch(() => {});
    }
    const n = mk(c, up, cls);
    el.replaceWith(n);
    if (!REDUCED_MOTION && n.animate) {
      await n.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0)' }], { duration: 190, easing: 'ease-out' }).finished.catch(() => {});
    }
    return n;
  }
  // Put a card onto a pile, flying from `from`, then drop what was under it.
  async function toPile(pile, cardEl, from, dur) {
    pile.appendChild(cardEl);
    await slide(cardEl, from, dur);
    [...pile.querySelectorAll('.card')].slice(0, -1).forEach((x) => x.remove());
  }
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  function deckStack() {
    const d = h('div', 'deck-stack');
    d.append(h('div', 'ds2'), h('div', 'ds1'), mk(null, false));
    return d;
  }
  function pop(el, delay = 0) {
    if (REDUCED_MOTION || !el.animate) return;
    el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.85)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, delay, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'backwards' });
  }
  function bump(el) {
    if (REDUCED_MOTION || !el || !el.animate) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' });
  }
  function shake(el) {
    if (REDUCED_MOTION || !el || !el.animate) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 380 });
  }
  // A small value chip under a card ("+12", "−2" …)
  function chip(txt, kind) { return h('div', 'tl-chip' + (kind ? ' ' + kind : ''), txt); }
  const valTxt = (v) => (v < 0 ? '−' + Math.abs(v) : String(v));
  const valKind = (v) => (v <= 1 ? 'good' : v >= 10 ? 'bad' : 'mid');
  // 2×2 hand slots. bottom=true puts cards 1–2 in the row nearest the player.
  function handGrid(n, bottom, cls) {
    const g = h('div', 'tl-hand' + (cls ? ' ' + cls : ''));
    const slots = [];
    for (let i = 0; i < n; i++) {
      const s = h('div', 'tl-slot');
      if (bottom) s.style.order = i < 2 ? 1 : 0;
      slots.push(s); g.appendChild(s);
    }
    return { g, slots };
  }

  // ════════════════════════ LESSONS ════════════════════════
  // Each lesson: title, short text, and run(vis, cap, t) — an animation that
  // builds into `vis` and narrates through `cap(text)`.
  const LESSONS = [
    {
      t: 'The goal',
      d: 'Every card is worth points. Have the <b>lowest total</b> when the round ends and you win it.',
      async run(vis, cap, t) {
        const rows = [
          { name: 'You', cards: [C('A', '♠'), C('3', '♥'), C('K', '♦'), C('2', '♣')] },
          { name: 'Rival', cards: [C('9', '♣'), C('Q', '♥'), C('4', '♠'), C('7', '♦')] },
        ];
        const els = rows.map((r) => {
          const row = h('div', 'tl-row');
          const nm = h('div', 'tl-rname', r.name);
          const cards = h('div', 'tl-cards');
          const sum = h('div', 'tl-sum', '0');
          row.append(nm, cards, sum); vis.appendChild(row);
          return { row, cards, sum, r };
        });
        cap('Each player has 4 cards…');
        for (const e of els) {
          e.r.cards.forEach((c, i) => { const cw = h('div', 'tl-cw'); cw.appendChild(mk(c, true)); e.cards.appendChild(cw); pop(cw, i * 90); });
        }
        if (!(await w(900, t))) return;
        cap('…add up their points…');
        for (const e of els) {
          let s = 0;
          for (let i = 0; i < e.r.cards.length; i++) {
            const v = cv(e.r.cards[i].rank); s += v;
            const ch = chip(valTxt(v), valKind(v)); e.cards.children[i].appendChild(ch); pop(ch);
            e.sum.textContent = s; bump(e.sum);
            if (!(await w(380, t))) return;
          }
        }
        cap('…and the <b>lowest total wins</b> the round. 👑');
        els[0].row.classList.add('win');
        const crown = h('div', 'tl-crown', '👑'); els[0].row.appendChild(crown); pop(crown);
      },
    },
    {
      t: 'Card values',
      d: 'Low cards are good, high cards are bad. Kings and Jokers are the best cards in the deck.',
      async run(vis, cap, t) {
        const list = [
          [C('JOKER', '★'), '−2', 'good'], [C('K', '♠'), '0', 'good'], [C('A', '♥'), '1', 'good'],
          [C('5', '♣'), '2–10', 'mid', 'number on the card'], [C('J', '♦'), '11', 'bad'], [C('Q', '♠'), '12', 'bad'],
        ];
        const row = h('div', 'tl-vals'); vis.appendChild(row);
        cap('What each card is worth:');
        list.forEach(([c, v, k, note], i) => {
          const cw = h('div', 'tl-cw');
          cw.append(mk(c, true), chip(v, k));
          if (note) cw.appendChild(h('div', 'tl-note', note));
          row.appendChild(cw); pop(cw, i * 160);
        });
        if (!(await w(1300, t))) return;
        const bar = h('div', 'tl-scale', '<span>BEST</span><i></i><span>WORST</span>');
        vis.appendChild(bar); pop(bar);
        if (!(await w(500, t))) return;
        cap('Keep <b>Kings (0)</b> and <b>Jokers (−2)</b>. Get rid of <b>Jacks (11)</b> and <b>Queens (12)</b>.');
      },
    },
    {
      t: 'Your hand',
      d: 'You get 4 cards face down. At the start you peek at the <b>2 nearest you</b>, just once. After that, you play from memory.',
      async run(vis, cap, t) {
        const deck = deckStack(); const top = h('div', 'tl-center'); top.appendChild(deck); vis.appendChild(top);
        const { g, slots } = handGrid(4, true); vis.appendChild(g);
        const lbl = h('div', 'tl-you', 'YOUR HAND'); vis.appendChild(lbl);
        cap('Everyone is dealt 4 cards, face down.');
        if (!(await w(400, t))) return;
        const from = rect(deck);
        const order = [2, 3, 0, 1];
        for (const i of order) {
          const c = mk(null, false); slots[i].appendChild(c); slide(c, from, 420); sfx('draw');
          slots[i].appendChild(h('div', 'tl-idx', i + 1));
          if (!(await w(200, t))) return;
        }
        if (!(await w(700, t))) return;
        cap('Peek at your <b>2 nearest cards</b> — memorize them!');
        const known = [C('4', '♥'), C('J', '♣')];
        const ups = [];
        for (const i of [0, 1]) ups.push(await flip(slots[i].querySelector('.card'), known[i], true, 'memorize'));
        if (!alive(t)) return;
        const timer = h('div', 'tl-timer', '<i></i>'); vis.insertBefore(timer, lbl);
        if (!(await w(2800, t))) return;
        for (const i of [0, 1]) await flip(slots[i].querySelector('.card'), null, false, 'known-g');
        timer.remove();
        if (!alive(t)) return;
        cap('Now they\'re hidden. You know card 1 is a <b>4</b>, card 2 is a <b>J</b>, and 3 & 4 are a mystery.');
        [[0, '4'], [1, 'J'], [2, '?'], [3, '?']].forEach(([i, v]) => { const m = h('div', 'tl-mem' + (v === '?' ? ' q' : ''), v); slots[i].appendChild(m); pop(m, i * 120); });
      },
    },
    {
      t: 'Your turn',
      d: 'Draw a card from the deck. Then <b>keep it</b> (swap it for one of yours) or <b>throw it away</b>.',
      async run(vis, cap, t) {
        const center = h('div', 'tl-center');
        const deck = deckStack();
        const drawn = h('div', 'tl-pile tl-drawn');
        const disc = h('div', 'tl-pile');
        disc.appendChild(mk(C('6', '♠'), true));
        const col = (lab, el) => { const c = h('div', 'tl-col'); c.append(h('div', 'plbl', lab), el); return c; };
        center.append(col('DECK', deck), col('DRAWN', drawn), col('DISCARD', disc));
        vis.appendChild(center);
        const { g, slots } = handGrid(4, true); vis.appendChild(g);
        const hand = [C('J', '♣'), C('4', '♥'), null, null];
        hand.forEach((c, i) => { slots[i].appendChild(mk(c, !!c, c ? 'known-g' : '')); slots[i].appendChild(h('div', 'tl-idx', i + 1)); });
        cap('<b>Step 1:</b> draw the top card of the deck.');
        deck.classList.add('tl-point');
        if (!(await w(1100, t))) return;
        deck.classList.remove('tl-point');
        let d = mk(null, false); drawn.appendChild(d); sfx('draw'); await slide(d, rect(deck));
        if (!alive(t)) return;
        d = await flip(d, C('2', '♠'), true);
        if (!(await w(700, t))) return;
        cap('<b>Keep it:</b> swap it with a card in your hand. Your J (11) is bad — swap it!');
        slots[0].firstChild.classList.add('tl-glow');
        if (!(await w(1500, t))) return;
        const rJ = rect(slots[0].firstChild), rD = rect(d);
        const oldJ = slots[0].firstChild;
        const n2 = mk(C('2', '♠'), true, 'known-g'); oldJ.replaceWith(n2); d.remove();
        const nJ = mk(C('J', '♣'), true);
        sfx('swap');
        slide(n2, rD); await toPile(disc, nJ, rJ);
        if (!alive(t)) return;
        const save = chip('11 → 2  · saved 9 pts', 'good'); slots[0].appendChild(save); pop(save);
        if (!(await w(1700, t))) return;
        save.remove();
        cap('<b>Or throw it away:</b> drew something bad? Put it straight on the discard pile.');
        d = mk(null, false); drawn.appendChild(d); sfx('draw'); await slide(d, rect(deck));
        if (!alive(t)) return;
        d = await flip(d, C('Q', '♥'), true);
        if (!(await w(900, t))) return;
        const rq = rect(d); d.remove(); sfx('discard');
        await toPile(disc, mk(C('Q', '♥'), true), rq);
        if (!(await w(600, t))) return;
        cap('Tip: you may take the <b>top discard</b> instead of drawing — but then you must swap it into your hand.');
        disc.classList.add('tl-point');
      },
    },
    {
      t: 'Power cards',
      d: 'Draw one of these <b>from the deck</b> and you can discard it to use its power. Cards taken from the discard pile have no power.',
      async run(vis, cap, t) {
        const tiles = [
          ['7', '8', '👁', 'Peek', 'Look at one of <b>your</b> cards'],
          ['9', '10', '🔍', 'Spy', 'Look at one of an <b>opponent\'s</b> cards'],
          ['J', null, '⏭', 'Skip', 'The next player <b>misses</b> their turn'],
          ['Q', null, '🔀', 'Blind swap', 'Swap a card of yours with an opponent\'s — <b>without looking</b>'],
          ['K', null, '👑', 'Seen swap', '<b>Look</b> at a card of yours, then swap it with an opponent\'s'],
        ];
        const grid = h('div', 'tl-powers'); vis.appendChild(grid);
        const els = tiles.map(([a, b, ic, nm, desc], i) => {
          const tile = h('div', 'tl-pw');
          const cards = h('div', 'tl-pw-cards');
          cards.appendChild(mk(C(a, i % 2 ? '♥' : '♠'), true));
          if (b) cards.appendChild(mk(C(b, i % 2 ? '♦' : '♣'), true));
          tile.append(cards, h('div', 'tl-pw-txt', `<div class="tl-pw-ic">${ic}</div><b>${nm}</b><small>${desc}</small>`));
          grid.appendChild(tile); pop(tile, i * 180);
          return tile;
        });
        cap('Draw a 7 to K from the deck and you get a choice: <b>use its power</b> (it goes to the discard), or swap it in like any card.');
        if (!(await w(1400, t))) return;
        // spotlight each power in turn, forever, until the scene changes
        for (let k = 0; alive(t); k = (k + 1) % els.length) {
          els.forEach((e, i) => e.classList.toggle('on', i === k));
          bump(els[k].querySelector('.tl-pw-ic'));
          if (!(await w(1700, t))) return;
        }
      },
    },
    {
      t: 'Matching',
      d: 'At the <b>start of your turn</b>, before drawing, you may throw away a card that matches the top of the discard pile.',
      async run(vis, cap, t) {
        const center = h('div', 'tl-center');
        const deck = deckStack();
        const disc = h('div', 'tl-pile'); disc.appendChild(mk(C('5', '♣'), true));
        const col = (lab, el) => { const c = h('div', 'tl-col'); c.append(h('div', 'plbl', lab), el); return c; };
        center.append(col('DECK', deck), col('DISCARD', disc)); vis.appendChild(center);
        const btn = h('button', 'ab match-btn tl-fakebtn', '⇣ Match');
        vis.appendChild(btn);
        const { g, slots } = handGrid(4, true); vis.appendChild(g);
        const hand = [C('K', '♠'), C('5', '♦'), null, null];
        hand.forEach((c, i) => slots[i].appendChild(mk(c, !!c, c ? 'known-g' : '')));
        cap('The discard shows a <b>5</b>… and you know your card 2 is a <b>5</b>!');
        disc.lastChild.classList.add('tl-glow'); slots[1].firstChild.classList.add('tl-glow');
        if (!(await w(1900, t))) return;
        cap('Tap <b>Match</b>, then your 5. It\'s gone — one less card to count!');
        btn.classList.add('tl-press');
        if (!(await w(700, t))) return;
        const r5 = rect(slots[1].firstChild); slots[1].firstChild.remove(); sfx('match');
        await toPile(disc, mk(C('5', '♦'), true), r5);
        if (!alive(t)) return;
        btn.classList.remove('tl-press');
        const ok = chip('✓ Match! −1 card', 'good'); slots[1].appendChild(ok); pop(ok);
        if (!(await w(2000, t))) return;
        ok.remove();
        cap('Guess <b>wrong</b>? Your card is shown to everyone, stays in your hand, and you take a <b>penalty card</b>.');
        if (!(await w(1200, t))) return;
        const r3 = slots[2].firstChild;
        const up = await flip(r3, C('3', '♥'), true, 'tl-bad');
        if (!alive(t)) return;
        shake(up);
        const x = chip('✗ Not a 5', 'bad'); slots[2].appendChild(x); pop(x);
        if (!(await w(900, t))) return;
        const pen = mk(null, false); slots[1].appendChild(pen); sfx('discard');
        await slide(pen, rect(deck), 600);
        if (!alive(t)) return;
        const pc = chip('+1 penalty', 'bad'); slots[1].appendChild(pc); pop(pc);
        cap('Only match when you\'re sure. Matched cards never use their power.');
      },
    },
    {
      t: 'Call CABO',
      d: 'Think your total is the lowest? On your turn, call <b>CABO</b> instead of drawing. Everyone else gets one last turn, then all cards are revealed.',
      async run(vis, cap, t) {
        vis.classList.add('tl-side');
        const opp = handGrid(4, false, 'opp'); const ol = h('div', 'tl-you', 'RIVAL');
        const ob = h('div', 'tl-box'); ob.append(ol, opp.g); vis.appendChild(ob);
        const oc = [C('7', '♦'), C('5', '♠'), C('Q', '♣'), C('2', '♦')];
        opp.slots.forEach((s) => s.appendChild(mk(null, false)));
        const btn = h('button', 'cabo-btn tl-fakebtn', 'CALL CABO'); vis.appendChild(btn);
        const me = handGrid(4, true);
        const mc = [C('A', '♠'), C('2', '♥'), C('K', '♦'), C('3', '♣')];
        me.slots.forEach((s, i) => s.appendChild(mk(mc[i], true, 'known-g')));
        const yl = h('div', 'tl-you', 'YOU · <span class="spip">6</span>');
        const mb = h('div', 'tl-box'); mb.append(me.g, yl); vis.appendChild(mb);
        cap('Your hand adds up to just <b>6</b>. Time to call it!');
        if (!(await w(1500, t))) return;
        btn.classList.add('tl-press'); sfx('cabo');
        const fl = h('div', 'tl-cabo', '<span>CABO!</span>'); vis.appendChild(fl);
        if (!(await w(1300, t))) return;
        fl.remove(); btn.classList.remove('tl-press');
        cap('Everyone else gets <b>one final turn</b>…');
        ol.innerHTML = 'RIVAL <span class="ltag">LAST TURN</span>';
        opp.g.classList.add('tl-glowzone');
        if (!(await w(1700, t))) return;
        opp.g.classList.remove('tl-glowzone');
        cap('…then every card is revealed.');
        for (let i = 0; i < 4; i++) { await flip(opp.slots[i].firstChild, oc[i], true); if (!alive(t)) return; }
        ol.innerHTML = 'RIVAL · <span class="spip">26</span>';
        if (!(await w(600, t))) return;
        yl.classList.add('tl-winner'); bump(yl);
        cap('You <b>6</b> vs Rival <b>26</b> — you win! ✓ But if anyone is <b>lower than you</b>, you get a <b>+5 penalty</b>.');
      },
    },
    {
      t: 'Winning the game',
      d: 'Points add up over several rounds. When someone goes <b>past 100</b>, the game ends and the <b>lowest total wins</b>.',
      async run(vis, cap, t) {
        const ppl = [['You', [6, 12, 9]], ['Ana', [22, 30, 51]], ['Bo', [15, 20, 40]]];
        const box = h('div', 'tl-bars'); vis.appendChild(box);
        const rows = ppl.map(([n]) => {
          const r = h('div', 'tl-bar', `<span class="tl-bn">${n}</span><div class="tl-bt"><i></i><em></em></div><b>0</b>`);
          box.appendChild(r); return r;
        });
        const tot = [0, 0, 0];
        for (let round = 0; round < 3; round++) {
          cap(`Round ${round + 1}: each hand's points are added to your total.`);
          ppl.forEach(([, sc], i) => {
            tot[i] += sc[round];
            const r = rows[i];
            r.querySelector('i').style.width = Math.min(100, tot[i]) + '%';
            r.querySelector('b').textContent = tot[i];
            r.classList.toggle('over', tot[i] > 100);
          });
          if (!(await w(1500, t))) return;
        }
        cap('Ana went past 100 — <b>game over</b>. You have the lowest total, so <b>you win!</b> 🏆');
        rows[0].classList.add('win'); rows[0].appendChild(h('span', 'tl-crown sm', '👑'));
        if (!(await w(1800, t))) return;
        const n = h('div', 'tl-bonus', 'Bonus rule: land on <b>exactly 100</b> and you drop back to <b>50</b>!');
        vis.appendChild(n); pop(n);
      },
    },
  ];

  function renderDots() {
    dots.innerHTML = '';
    LESSONS.forEach((_, i) => {
      const d = h('button', 'tut-dot' + (i === li ? ' on' : i < li ? ' done' : ''));
      d.setAttribute('aria-label', 'Lesson ' + (i + 1));
      d.onclick = () => showLesson(i);
      dots.appendChild(d);
    });
  }

  function showLesson(i) {
    mode = 'lessons'; li = i; const t = ++tok;
    setTabs();
    const L = LESSONS[i];
    stage.innerHTML = '';
    const sc = h('div', 'tl-scene');
    sc.append(
      h('div', 'tl-step', `LESSON ${i + 1} OF ${LESSONS.length}`),
      h('div', 'tl-title', L.t),
      h('div', 'tl-desc', L.d)
    );
    const vis = h('div', 'tl-vis');
    const capEl = h('div', 'tl-cap', '&nbsp;');
    const replay = h('button', 'tl-replay', '↻ Replay');
    replay.onclick = () => showLesson(i);
    sc.append(vis, capEl, replay);
    stage.appendChild(sc);
    const cap = (txt) => { if (!alive(t)) return; capEl.innerHTML = txt; if (!REDUCED_MOTION && capEl.animate) capEl.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260 }); };
    renderDots();
    // nav
    nav.innerHTML = '';
    const back = h('button', 'ab', '‹ Back'); back.disabled = i === 0; back.onclick = () => showLesson(i - 1);
    const last = i === LESSONS.length - 1;
    const next = h('button', 'ab pri tut-next', last ? 'Try a practice round ▶' : 'Next ›');
    next.onclick = () => (last ? startPractice() : showLesson(i + 1));
    nav.append(back, dots, next);
    // run after layout so slide() measures real positions
    requestAnimationFrame(() => { if (alive(t)) L.run(vis, cap, t).catch((e) => console.error(e)); });
  }

  // ════════════════════════ PRACTICE ROUND ════════════════════════
  // A fixed, scripted hand. The coach tells you what to do; only the right
  // thing is tappable. Model lives here; the DOM is built once and cards are
  // moved/flipped between slots.
  let P = null;

  function buildBoard() {
    const b = h('div', 'tp-board');
    // bot
    const oz = h('div', 'tp-zone tp-bot');
    const ohead = h('div', 'tp-head', '<span class="tp-name">🤖 BOT</span><span class="tp-status"></span>');
    const opp = handGrid(4, false, 'opp');
    oz.append(ohead, opp.g);
    // center
    const center = h('div', 'tp-center');
    const deck = deckStack();
    const drawn = h('div', 'tl-pile tl-drawn');
    const disc = h('div', 'tl-pile');
    const col = (lab, el) => { const c = h('div', 'tl-col'); c.append(h('div', 'plbl', lab), el); return c; };
    center.append(col('DECK', deck), col('DRAWN', drawn), col('DISCARD', disc));
    // coach
    const coach = h('div', 'tp-coach');
    const bubble = h('div', 'tp-bubble');
    const msg = h('div', 'tp-msg');
    const acts = h('div', 'tp-acts');
    bubble.append(msg, acts);
    coach.append(h('div', 'tp-av', '🎓'), bubble);
    // you
    const mz = h('div', 'tp-zone tp-me');
    const me = handGrid(4, true);
    me.slots.forEach((s, i) => s.appendChild(h('div', 'tl-idx', i + 1)));
    const mhead = h('div', 'tp-head', '<span class="tp-name">YOU</span><span class="tp-pip"></span>');
    const cabo = h('button', 'cabo-btn tp-cabo', 'CALL CABO'); cabo.disabled = true;
    mhead.appendChild(cabo);
    mz.append(me.g, mhead);
    b.append(oz, center, coach, mz);
    stage.appendChild(b);
    // taps outside the current target: point at the right thing instead
    b.addEventListener('click', (e) => {
      if (!P || !P.targets.length) return;
      if (e.target.closest('.tut-target') || e.target.closest('.tp-acts')) return;
      shake(bubble);
      P.targets.forEach((x) => { x.classList.remove('tut-nudge'); void x.offsetWidth; x.classList.add('tut-nudge'); });
    }, true);
    return { b, oz, ohead, opp, deck, drawn, disc, coach, bubble, msg, acts, mz, me, mhead, cabo };
  }

  // coach speaks; with buttons, resolves to the clicked button's value
  function say(html, buttons) {
    const D = P.D;
    D.msg.innerHTML = html;
    D.acts.innerHTML = '';
    if (!REDUCED_MOTION && D.bubble.animate) D.bubble.animate([{ opacity: .3, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
    if (!buttons) return Promise.resolve();
    return new Promise((res) => {
      buttons.forEach((bt) => {
        const el = h('button', bt.c || 'ab pri', bt.t);
        el.onclick = () => res(bt.v);
        D.acts.appendChild(el);
      });
    });
  }
  // Wait for a tap on one of `els` (array of [element, value]).
  function tapOne(pairs) {
    return new Promise((res) => {
      P.targets = pairs.map(([el]) => el);
      pairs.forEach(([el, v]) => {
        el.classList.add('tut-target');
        if (el.tagName !== 'BUTTON') {
          el.tabIndex = 0; el.setAttribute('role', 'button');
          el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && el._tut) { e.preventDefault(); el._tut(); } };
        }
        const fg = h('div', 'tut-finger', '👆');
        if (el.classList.contains('tl-slot') || el.classList.contains('tl-col')) el.appendChild(fg);
        el._tut = () => {
          pairs.forEach(([x]) => { x.classList.remove('tut-target', 'tut-nudge'); x._tut = null; x.querySelectorAll(':scope > .tut-finger').forEach((f) => f.remove()); });
          P.targets = [];
          res(v);
        };
      });
    });
  }
  function onBoardTap(e) {
    const tg = e.target.closest('.tut-target');
    if (tg && tg._tut) tg._tut();
  }

  // hand helpers
  const meCard = (i) => P.D.me.slots[i].querySelector('.card');
  const botCard = (i) => P.D.opp.slots[i].querySelector('.card');
  function setMem(i) {
    const s = P.D.me.slots[i];
    s.querySelectorAll('.tl-mem').forEach((x) => x.remove());
    const m = P.me[i];
    if (!m) return;
    const mem = h('div', 'tl-mem' + (m.known ? '' : ' q'), m.known ? (m.c.rank === 'JOKER' ? '🃏' : m.c.rank) : '?');
    s.appendChild(mem);
  }
  function updatePip() {
    const parts = P.me.filter(Boolean).map((m) => (m.known ? valTxt(cv(m.c.rank)) : '?'));
    const allKnown = P.me.filter(Boolean).every((m) => m.known);
    const sum = P.me.filter(Boolean).reduce((s, m) => s + cv(m.c.rank), 0);
    P.D.mhead.querySelector('.tp-pip').innerHTML = `<span class="spip">${parts.join(' + ')}${allKnown ? ' = ' + sum : ''}</span>`;
    P.me.forEach((_, i) => setMem(i));
  }
  function botStatus(txt, busy) {
    const s = P.D.ohead.querySelector('.tp-status');
    s.innerHTML = txt ? (busy ? '<span class="spin"></span> ' : '') + txt : '';
    P.D.oz.classList.toggle('active', !!busy);
  }
  function myTurn(on) { P.D.mz.classList.toggle('active', on); if (on) { yourTurnCue(); } }

  // draw from deck into the DRAWN spot, face up (mine) or down (bot)
  async function drawTo(c, up) {
    sfx('draw');
    const el = mk(up ? c : null, up);
    P.D.drawn.appendChild(el);
    await slide(el, rect(P.D.deck.querySelector('.card')));
    return el;
  }
  async function drawnToDiscard(c) {
    const d = P.D.drawn.querySelector('.card'); const r = rect(d); d.remove();
    sfx('discard');
    await toPile(P.D.disc, mk(c, true), r);
  }
  // swap drawn card into my slot i; old card to discard
  async function swapIn(i, c) {
    const d = P.D.drawn.querySelector('.card'); const old = meCard(i);
    const rD = rect(d), rO = rect(old);
    const oldC = P.me[i].c;
    const n = mk(c, true, 'known-g'); old.replaceWith(n); d.remove();
    P.me[i] = { c, known: true };
    sfx('swap');
    slide(n, rD); await toPile(P.D.disc, mk(oldC, true), rO);
    await sleep(500);
    await flip(n, null, false, 'known-g');
    updatePip();
  }
  async function botTurn(t, c, opts = {}) {
    myTurn(false);
    botStatus('Thinking…', true);
    if (!(await w(900, t))) return false;
    const d = await drawTo(c, false);
    if (!(await w(800, t))) return false;
    if (opts.swapIdx != null) {
      const i = opts.swapIdx; const old = botCard(i); const rO = rect(old), rD = rect(d);
      const oldC = P.bot[i];
      const n = mk(null, false); old.replaceWith(n); d.remove(); P.bot[i] = c;
      sfx('swap'); slide(n, rD); await toPile(P.D.disc, mk(oldC, true), rO);
      botStatus(`✓ Swapped card ${i + 1}, discarded ${oldC.rank}${oldC.suit}`);
    } else {
      await drawnToDiscard(c);
      botStatus(`✓ Discarded ${c.rank}${c.suit}`);
    }
    P.D.oz.classList.remove('active');
    return alive(t);
  }

  async function startPractice() {
    mode = 'practice'; const t = ++tok;
    setTabs();
    stage.innerHTML = '';
    nav.innerHTML = '';
    const restart = h('button', 'ab', '↻ Restart practice'); restart.onclick = startPractice;
    const toLessons = h('button', 'ab', '‹ Lessons'); toLessons.onclick = () => showLesson(LESSONS.length - 1);
    nav.append(toLessons, restart);
    P = { targets: [], me: [], bot: [] };
    P.D = buildBoard();
    P.D.b.addEventListener('click', onBoardTap);
    const D = P.D;
    const ok = (txt = 'Got it ›') => [{ t: txt, v: 1 }];

    // ── deal ──
    P.me = [{ c: C('9', '♣'), known: false }, { c: C('2', '♥'), known: false }, { c: C('Q', '♠'), known: false }, { c: C('5', '♦'), known: false }];
    P.bot = [C('A', '♠'), C('K', '♦'), C('8', '♠'), C('6', '♥')];
    D.disc.appendChild(mk(C('10', '♠'), true));
    await say('Welcome to a <b>practice round</b> against a bot. I\'ll tell you what to do — just follow the glowing 👆.', ok('Deal the cards ›'));
    if (!alive(t)) return;
    const from = rect(D.deck.querySelector('.card'));
    for (let i = 0; i < 4; i++) {
      const a = mk(null, false); D.opp.slots[i].appendChild(a); slide(a, from, 380);
      const b2 = mk(null, false); D.me.slots[i].prepend(b2); slide(b2, from, 380); sfx('draw');
      if (!(await w(140, t))) return;
    }
    if (!(await w(500, t))) return;

    // ── memorize ──
    for (const i of [0, 1]) { await flip(meCard(i), P.me[i].c, true, 'memorize'); P.me[i].known = true; }
    if (!alive(t)) return;
    await say('Your <b>2 nearest cards</b> are face up for a moment: a <b>9</b> and a <b>2</b>. Memorize them! (Here a little reminder chip stays under cards you know.)', ok('I\'ll remember ›'));
    if (!alive(t)) return;
    for (const i of [0, 1]) await flip(meCard(i), null, false, 'known-g');
    updatePip();

    // ── turn 1: draw, swap ──
    myTurn(true);
    say('<b>Your turn.</b> Tap the <b>DECK</b> to draw a card.');
    await tapOne([[D.deck.parentNode, 1]]);
    if (!alive(t)) return;
    let d = await drawTo(C('3', '♥'), true);
    d.classList.add('tl-held');
    say('You drew a <b>3</b> — that\'s low! Your card 1 is the <b>9</b> (high). Tap card <b>1</b> to swap the 3 in.');
    await tapOne([[D.me.slots[0], 1]]);
    if (!alive(t)) return;
    await swapIn(0, C('3', '♥'));
    if (!alive(t)) return;
    myTurn(false);
    await say('Swapped! The 9 went to the discard pile and your hand is <b>6 points lighter</b>.', ok('Next: Bot\'s turn ›'));
    if (!alive(t)) return;

    // ── bot 1 ──
    say('Watch the bot play…');
    if (!(await botTurn(t, C('6', '♣')))) return;
    await say('The bot drew a card and threw away a <b>6</b>.', ok('My turn ›'));
    if (!alive(t)) return;

    // ── turn 2: 7 = peek ──
    myTurn(true);
    say('Draw from the <b>DECK</b> again.');
    await tapOne([[D.deck.parentNode, 1]]);
    if (!alive(t)) return;
    d = await drawTo(C('7', '♦'), true);
    powerBadge(d, '7', false);
    const v = await say('A <b>7</b> — a power card! 7s and 8s let you <b>peek</b> at one of your own cards. Let\'s use it.', [
      { t: '👁 Use 7 · Peek', v: 'pw', c: 'ab pri tut-target' },
    ]);
    if (!alive(t) || !v) return;
    say('Tap one of your <b>unknown</b> cards — <b>3</b> or <b>4</b> — to look at it.');
    let pick = await tapOne([[D.me.slots[2], 2], [D.me.slots[3], 3]]);
    if (!alive(t)) return;
    const other = pick === 2 ? 3 : 2;
    // the tapped card is always the 5 — the lesson needs it
    P.me[pick].c = C('5', '♦'); P.me[other].c = C('Q', '♠');
    let pe = await flip(meCard(pick), P.me[pick].c, true, 'peek-revealed');
    sfx('reveal');
    P.me[pick].known = true;
    await drawnToDiscard(C('7', '♦'));
    if (!alive(t)) return;
    await say(`Card ${pick + 1} is a <b>5</b>. Remember that! The 7 went to the discard pile.`, ok());
    if (!alive(t)) return;
    await flip(pe, null, false, 'known-g');
    updatePip();
    myTurn(false);

    // ── bot 2 ──
    say('Bot\'s turn…');
    if (!(await botTurn(t, C('5', '♣')))) return;
    await say('The bot threw away a <b>5</b>… and <b>you know you have a 5</b>. 👀', ok('My turn ›'));
    if (!alive(t)) return;

    // ── turn 3: match, then K ──
    myTurn(true);
    await say('<b>Matching:</b> before drawing, you can throw a card with the <b>same rank</b> as the discard top. Tap <b>Match</b>.', [
      { t: '⇣ Match', v: 1, c: 'ab match-btn tut-target' },
    ]);
    if (!alive(t)) return;
    say(`Now tap your <b>5</b> (card ${pick + 1}).`);
    await tapOne([[D.me.slots[pick], 1]]);
    if (!alive(t)) return;
    {
      const c5 = meCard(pick); const r5 = rect(c5); c5.remove();
      P.me[pick] = null; sfx('match');
      await toPile(D.disc, mk(C('5', '♦'), true), r5);
      D.me.slots[pick].classList.add('gone');
      updatePip();
    }
    if (!alive(t)) return;
    await say('<b>Match!</b> One card gone for free. (A wrong guess would cost you a penalty card.) Now take your normal turn.', ok());
    if (!alive(t)) return;
    say('Draw from the <b>DECK</b>.');
    await tapOne([[D.deck.parentNode, 1]]);
    if (!alive(t)) return;
    d = await drawTo(C('K', '♣'), true);
    powerBadge(d, 'K', false);
    await say('A <b>King</b>! Kings let you <b>look</b> at one of your cards, then <b>swap</b> it with an opponent\'s card.', [
      { t: '👑 Use K · Seen swap', v: 1, c: 'ab pri tut-target' },
    ]);
    if (!alive(t)) return;
    say(`Tap your last <b>unknown</b> card (card ${other + 1}).`);
    await tapOne([[D.me.slots[other], 1]]);
    if (!alive(t)) return;
    let qEl = await flip(meCard(other), C('Q', '♠'), true, 'sel');
    sfx('reveal');
    say('Ouch — a <b>Queen</b>, 12 points! Give it to the bot: tap <b>any bot card</b>.');
    pick = await tapOne(D.opp.slots.map((s, i) => [s, i]));
    if (!alive(t)) return;
    {
      // the bot card you take is always the Ace — rearrange the bot's hidden hand
      const ai = P.bot.findIndex((c) => c.rank === 'A');
      [P.bot[ai], P.bot[pick]] = [P.bot[pick], P.bot[ai]];
      const bEl = botCard(pick);
      const rB = rect(bEl), rM = rect(qEl);
      const nMe = mk(C('A', '♠'), true, 'peek-revealed'), nBot = mk(null, false);
      qEl.replaceWith(nMe); bEl.replaceWith(nBot);
      P.me[other] = { c: C('A', '♠'), known: true }; P.bot[pick] = C('Q', '♠');
      sfx('swap');
      slide(nMe, rB, 600); await slide(nBot, rM, 600);
      await drawnToDiscard(C('K', '♣'));
      if (!alive(t)) return;
      await say('You gave away a <b>12</b> and got an <b>Ace (1)</b>. Great trade!', ok());
      if (!alive(t)) return;
      await flip(nMe, null, false, 'known-g');
      updatePip();
    }
    myTurn(false);

    // ── bot 3 ──
    say('Bot\'s turn…');
    if (!(await botTurn(t, C('10', '♦')))) return;

    // ── turn 4: call Cabo ──
    myTurn(true);
    say('Your hand is <b>3 + 2 + 1 = 6</b>. That\'s very low — time to tap <b>CALL CABO</b>!');
    D.cabo.disabled = false;
    await tapOne([[D.cabo, 1]]);
    if (!alive(t)) return;
    D.cabo.disabled = true;
    sfx('cabo');
    const fl = h('div', 'tl-cabo', '<span>CABO!</span>'); D.b.appendChild(fl);
    if (!(await w(1300, t))) return;
    fl.remove();
    myTurn(false);
    D.ohead.querySelector('.tp-name').innerHTML = '🤖 BOT <span class="ltag">LAST TURN</span>';
    say('You called Cabo! The bot gets <b>one final turn</b>…');
    const bi8 = P.bot.findIndex((c) => c.rank === '8');
    if (!(await botTurn(t, C('4', '♠'), { swapIdx: bi8 }))) return;
    if (!(await w(500, t))) return;

    // ── reveal ──
    say('Revealing every card…');
    for (let i = 0; i < 4; i++) { await flip(botCard(i), P.bot[i], true); if (!alive(t)) return; }
    for (let i = 0; i < 4; i++) { if (P.me[i]) { await flip(meCard(i), P.me[i].c, true); if (!alive(t)) return; } }
    const bs = P.bot.reduce((s, c) => s + cv(c.rank), 0);
    const ms = P.me.filter(Boolean).reduce((s, m) => s + cv(m.c.rank), 0);
    D.ohead.querySelector('.tp-name').innerHTML = `🤖 BOT <span class="spip">${bs}</span>`;
    D.mz.classList.add('win');
    D.b.classList.add('final');
    sfx('match');
    try { Settings.set('tutDone', true); } catch (e) {}
    const res = await say(
      `<div class="tp-win">🏆 You win! <b>${ms}</b> vs <b>${bs}</b></div>` +
      '<ul class="tp-recap"><li>Lowest total wins</li><li>Draw → keep (swap) or discard</li><li>7–K from the deck have powers</li><li>Match the discard to dump a card</li><li>Call <b>CABO</b> when you\'re low</li></ul>' +
      '<div class="tp-small">In a real game, points add up each round until someone passes 100.</div>',
      [{ t: 'Play a real game ▶', v: 'play' }, { t: 'Practice again', v: 'again', c: 'ab' }, { t: 'Menu', v: 'menu', c: 'ab' }]
    );
    if (!alive(t)) return;
    if (res === 'play') { close(); ActiveGame = Local; Local.startGame(); }
    else if (res === 'again') startPractice();
    else close();
  }

  // ════════════════════════ shell ════════════════════════
  function setTabs() {
    root.querySelectorAll('.tut-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === mode));
  }
  function ensureDom() {
    if (root) return;
    root = document.getElementById('tutorial');
    root.innerHTML = '';
    const top = h('div', 'tut-top');
    const exit = h('button', 'mbtn', '‹ Menu'); exit.onclick = close;
    const tabs = h('div', 'seg tut-tabs');
    const t1 = h('button', 'sb tut-tab', 'Lessons'); t1.dataset.tab = 'lessons'; t1.onclick = () => showLesson(mode === 'lessons' ? li : 0);
    const t2 = h('button', 'sb tut-tab', 'Practice'); t2.dataset.tab = 'practice'; t2.onclick = () => { if (mode !== 'practice') startPractice(); };
    tabs.append(t1, t2);
    top.append(exit, h('div', 'tut-brand', 'HOW TO PLAY'), tabs);
    stage = h('div', 'tut-stage');
    dots = h('div', 'tut-dots');
    nav = h('div', 'tut-nav');
    root.append(top, stage, nav);
    document.addEventListener('keydown', (e) => {
      if (!root.classList.contains('on') || mode !== 'lessons') return;
      if (e.key === 'ArrowRight' && li < LESSONS.length - 1) showLesson(li + 1);
      if (e.key === 'ArrowLeft' && li > 0) showLesson(li - 1);
    });
  }
  function open(start) {
    ensureDom();
    Screens.show('tutorial');
    if (start === 'practice') startPractice(); else showLesson(0);
  }
  function close() { tok++; P = null; Screens.show('setup'); if (stage) stage.innerHTML = ''; }

  return { open, close };
})();
