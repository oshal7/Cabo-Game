// Authoritative CABO game engine — runs on the server, drives N human seats.
// Ported from the original single-player ruleset: same deck, same special
// card powers, same match-bonus and Cabo-call/scoring rules.

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];

function cv(r) {
  if (r === 'A') return 1;
  if (r === 'K') return 0;
  if (r === 'J') return 11;
  if (r === 'Q') return 12;
  if (r === 'JOKER') return -2;
  return +r;
}
function isSpec(r) { return ['7','8','9','10','J','Q','K'].includes(r); }

function mkDeck() {
  let d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  d.push({ rank: 'JOKER', suit: '★' }, { rank: 'JOKER', suit: '★' });
  return d;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = ~~(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TARGET_SCORE = 100;

function scoreOf(game, i) {
  return game.players[i].cards.reduce((s, c) => s + cv(c.rank), 0);
}

// names: array of player display names, in seat order.
function createGame(names, round, totals) {
  const deck = shuffle(mkDeck());
  const players = names.map((name) => ({
    name,
    cards: deck.splice(0, 4).map((c) => ({ ...c, known: false })),
    matchUsed: false,
    skip: false,
  }));
  const discard = [deck.pop()];
  // every seat starts having privately peeked their own cards 0 & 1
  players.forEach((p) => { p.cards[0].known = true; p.cards[1].known = true; });
  return {
    id: Math.random().toString(36).slice(2, 10),
    deck, discard, players,
    turn: 0,
    turnsTaken: 0,
    finalPending: [],
    lastActions: {},       // seat -> short public description of their last move
    drawnFromDiscard: false,
    phase: 'play',
    drawnCard: null,
    swapSeen: false,
    swapPick1: null,
    peekOppWho: null,
    caboBy: -1,
    round: round || 1,
    totals: totals || players.map(() => 0),
    log: 'Round started — everyone peeked their first two cards.',
    winnerSeat: null,
    winnerSeats: [],
    caboLost: false,
    gameOver: false,
  };
}

// If the deck runs dry, reshuffle the discard pile (keeping its top card).
// Returns false when there is nothing left to draw at all.
function ensureDeck(game) {
  if (game.deck.length) return true;
  if (game.discard.length < 2) return false;
  const top = game.discard.pop();
  game.deck = shuffle(game.discard);
  game.discard = [top];
  return true;
}

function canCallCabo(game) {
  return game.caboBy === -1 && game.phase === 'play' && game.turnsTaken >= game.players.length;
}

function checkMatch(game, card) {
  if (game.discard.length < 2 || game.players[game.turn].matchUsed) return false;
  const prev = game.discard[game.discard.length - 2];
  if (prev && prev.rank === card.rank) {
    game.phase = 'match-pick';
    return true;
  }
  return false;
}

function endTurn(game) {
  game.drawnFromDiscard = false;
  game.drawnCard = null;
  game.swapPick1 = null;
  game.swapSeen = false;
  game.peekOppWho = null;
  game.phase = 'play';
  game.turnsTaken++;
  const n = game.players.length;
  const cabo = game.caboBy !== -1;
  // Track exactly who still owes a final turn, so a J skip can never hand
  // the Cabo caller (or anyone else) an extra turn.
  if (cabo) game.finalPending = game.finalPending.filter((s) => s !== game.turn);
  let next = (game.turn + 1) % n;
  for (let guard = 0; guard < n * 2; guard++) {
    const p = game.players[next];
    if (p.skip) {
      p.skip = false;
      if (cabo) game.finalPending = game.finalPending.filter((s) => s !== next);
      next = (next + 1) % n;
      continue;
    }
    if (cabo && !game.finalPending.includes(next)) { next = (next + 1) % n; continue; }
    break;
  }
  if (cabo && game.finalPending.length === 0) { revealAll(game); return; }
  if (!ensureDeck(game)) { revealAll(game); return; }
  game.turn = next;
  delete game.lastActions[next]; // their bubble is replaced by "thinking" until they act
}

function revealAll(game) {
  game.phase = 'reveal';
  game.finalPending = [];
  game.players.forEach((p) => p.cards.forEach((c) => { c.known = true; }));
  const scores = game.players.map((p, i) => scoreOf(game, i));
  const min = Math.min(...scores);
  const winners = scores.map((s, i) => (s === min ? i : -1)).filter((i) => i !== -1);
  const caboLost = game.caboBy !== -1 && scores[game.caboBy] !== min;
  scores.forEach((s, i) => {
    let t = (game.totals[i] || 0) + s + (caboLost && i === game.caboBy ? 5 : 0);
    if (t === TARGET_SCORE) t = 50; // house rule: landing exactly on 100 resets to 50
    game.totals[i] = t;
  });
  game.winnerSeat = winners[0];
  game.winnerSeats = winners;
  game.caboLost = caboLost;
  game.roundScores = scores;
  game.gameOver = game.totals.some((t) => t > TARGET_SCORE);
}

// Applies a player action. Returns { ok, error, banners }.
// banners: [{ scope: 'all' | seatIndex, text, level }]
function applyAction(game, seat, type, payload = {}) {
  const banners = [];
  const flashes = [];
  const moves = [];
  const act = (text) => { game.lastActions[seat] = text; };
  const fail = (error) => ({ ok: false, error, banners, flashes, moves });
  const ok = (extra) => ({ ok: true, banners, flashes, moves, ...extra });

  if (game.phase === 'reveal') return fail('Round is over.');
  if (seat !== game.turn) return fail('Not your turn.');
  const me = game.players[seat];

  switch (type) {
    case 'draw_deck': {
      if (game.phase !== 'play') return fail('Wrong phase.');
      if (!ensureDeck(game)) return fail('Deck is empty.');
      game.drawnCard = game.deck.pop();
      game.phase = 'drawn';
      act('Drew from the deck');
      moves.push({ from: 'deck', to: 'drawn' });
      return ok();
    }
    case 'draw_discard': {
      if (game.phase !== 'play') return fail('Wrong phase.');
      if (!game.discard.length) return fail('Discard pile is empty.');
      game.drawnCard = game.discard.pop();
      game.drawnFromDiscard = true;
      game.phase = 'drawn';
      const c = game.drawnCard;
      act(`Took ${c.rank}${c.suit} from discard`);
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} took the ${c.rank}${c.suit} from the discard pile.`, level: 'info' });
      moves.push({ from: 'discard', to: 'drawn' });
      return ok();
    }
    case 'discard_drawn': {
      if (game.phase !== 'drawn') return fail('Wrong phase.');
      const card = game.drawnCard;
      game.discard.push(card);
      game.drawnCard = null;
      moves.push({ from: 'drawn', to: 'discard' });
      act(`Discarded ${card.rank}${card.suit}`);
      if (checkMatch(game, card)) {
        banners.push({ scope: 'all', text: 'Match! Free discard bonus.', level: 'good' });
      } else {
        game.phase = 'play';
        endTurn(game);
      }
      return ok();
    }
    case 'swap_card': {
      if (game.phase !== 'drawn') return fail('Wrong phase.');
      const idx = payload.idx;
      if (!(idx >= 0 && idx < me.cards.length)) return fail('Invalid card.');
      const old = me.cards[idx];
      me.cards[idx] = { ...game.drawnCard, known: true };
      game.discard.push(old);
      game.drawnCard = null;
      banners.push({ scope: 'all', text: `${me.name} swapped card ${idx + 1}.`, level: 'info' });
      moves.push({ from: 'drawn', to: { seat, idx } }, { from: { seat, idx }, to: 'discard' });
      act(`Swapped card ${idx + 1}, discarded ${old.rank}${old.suit}`);
      if (checkMatch(game, old)) {
        banners.push({ scope: 'all', text: 'Match! Free discard bonus.', level: 'good' });
      } else {
        game.phase = 'play';
        endTurn(game);
      }
      return ok();
    }
    case 'use_special': {
      if (game.phase !== 'drawn') return fail('Wrong phase.');
      const r = game.drawnCard.rank;
      if (!isSpec(r)) return fail('Drawn card has no special power.');
      if (r === '7' || r === '8') { game.phase = 'spec-peek-own'; return ok(); }
      if (r === '9' || r === '10') {
        game.peekOppWho = null;
        game.phase = game.players.length > 2 ? 'spec-peek-opp-who' : 'spec-peek-opp-pick';
        if (game.players.length === 2) game.peekOppWho = (seat + 1) % 2;
        return ok();
      }
      if (r === 'J') {
        const next = (game.turn + 1) % game.players.length;
        game.players[next].skip = true;
        banners.push({ scope: 'all', text: `${me.name} played J — ${game.players[next].name}'s turn skipped!`, level: 'warn' });
        act(`Played J — skipped ${game.players[next].name}`);
        moves.push({ from: 'drawn', to: 'discard' });
        game.discard.push(game.drawnCard);
        game.drawnCard = null;
        game.phase = 'play';
        endTurn(game);
        return ok();
      }
      if (r === 'Q') { game.swapSeen = false; game.swapPick1 = null; game.phase = 'spec-swap1'; return ok(); }
      if (r === 'K') { game.swapSeen = true; game.swapPick1 = null; game.phase = 'spec-swap1'; return ok(); }
      return fail('Unknown special.');
    }
    case 'peek_own': {
      if (game.phase !== 'spec-peek-own') return fail('Wrong phase.');
      const idx = payload.idx;
      if (!(idx >= 0 && idx < me.cards.length)) return fail('Invalid card.');
      me.cards[idx].known = true;
      const c = me.cards[idx];
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} peeked their own card.`, level: 'info' });
      flashes.push({ kind: 'peek', seat, idx, by: seat, label: `${me.name} peeked!` });
      act(`Peeked own card ${idx + 1}`);
      game.discard.push(game.drawnCard);
      game.drawnCard = null;
      game.phase = 'play';
      endTurn(game);
      return ok({ reveal: { seat, idx, rank: c.rank, suit: c.suit } });
    }
    case 'choose_peek_opp': {
      if (game.phase !== 'spec-peek-opp-who') return fail('Wrong phase.');
      const oppSeat = payload.oppSeat;
      if (!(oppSeat >= 0 && oppSeat < game.players.length) || oppSeat === seat) return fail('Invalid target.');
      game.peekOppWho = oppSeat;
      game.phase = 'spec-peek-opp-pick';
      return ok();
    }
    case 'peek_opp_pick': {
      if (game.phase !== 'spec-peek-opp-pick') return fail('Wrong phase.');
      const oppSeat = game.peekOppWho;
      const idx = payload.idx;
      const opp = game.players[oppSeat];
      if (!(idx >= 0 && idx < opp.cards.length)) return fail('Invalid card.');
      const c = opp.cards[idx];
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} peeked ${opp.name}'s card.`, level: 'info' });
      flashes.push({ kind: 'peek', seat: oppSeat, idx, by: seat, label: `${me.name} peeked!` });
      act(`Peeked ${opp.name}'s card ${idx + 1}`);
      game.discard.push(game.drawnCard);
      game.drawnCard = null;
      game.phase = 'play';
      endTurn(game);
      return ok({ reveal: { seat: oppSeat, idx, rank: c.rank, suit: c.suit } });
    }
    case 'swap_pick1': {
      if (game.phase !== 'spec-swap1') return fail('Wrong phase.');
      const idx = payload.idx;
      if (!(idx >= 0 && idx < me.cards.length)) return fail('Invalid card.');
      game.swapPick1 = { owner: seat, idx };
      if (game.swapSeen) {
        const c = me.cards[idx];
        banners.push({ scope: seat, text: `Your card ${idx + 1}: ${c.rank}${c.suit}`, level: 'info' });
      }
      game.phase = 'spec-swap2';
      return ok();
    }
    case 'swap_pick2': {
      if (game.phase !== 'spec-swap2' || !game.swapPick1) return fail('Wrong phase.');
      const oppSeat = payload.oppSeat;
      const idx = payload.idx;
      if (oppSeat === seat) return fail('Pick an opponent card.');
      const opp = game.players[oppSeat];
      if (!opp || !(idx >= 0 && idx < opp.cards.length)) return fail('Invalid card.');
      const p1 = game.swapPick1;
      const c1 = { ...game.players[p1.owner].cards[p1.idx] };
      const c2 = { ...opp.cards[idx] };
      if (game.swapSeen) banners.push({ scope: seat, text: `Swapped! They had ${c2.rank}${c2.suit}`, level: 'info' });
      else banners.push({ scope: seat, text: 'Blind swap done!', level: 'info' });
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} swapped with ${opp.name}.`, level: 'warn' });
      act(`${game.swapSeen ? 'Seen' : 'Blind'}-swapped card ${p1.idx + 1} with ${opp.name}'s card ${idx + 1}`);
      flashes.push({ kind: 'swap', seat: p1.owner, idx: p1.idx }, { kind: 'swap', seat: oppSeat, idx });
      moves.push({ from: { seat: p1.owner, idx: p1.idx }, to: { seat: oppSeat, idx } }, { from: { seat: oppSeat, idx }, to: { seat: p1.owner, idx: p1.idx } });
      game.players[p1.owner].cards[p1.idx] = { ...c2, known: game.swapSeen };
      opp.cards[idx] = { ...c1, known: false };
      game.swapPick1 = null;
      game.swapSeen = false;
      game.discard.push(game.drawnCard);
      game.drawnCard = null;
      game.phase = 'play';
      endTurn(game);
      return ok();
    }
    case 'cancel_special': {
      if (!game.phase.startsWith('spec-')) return fail('Wrong phase.');
      game.phase = 'drawn';
      game.swapPick1 = null;
      game.swapSeen = false;
      game.peekOppWho = null;
      return ok();
    }
    case 'match_pick': {
      if (game.phase !== 'match-pick') return fail('Wrong phase.');
      const idx = payload.idx;
      if (!(idx >= 0 && idx < me.cards.length)) return fail('Invalid card.');
      moves.push({ from: { seat, idx }, to: 'discard' });
      const disc = me.cards.splice(idx, 1)[0];
      game.discard.push(disc);
      me.matchUsed = true;
      banners.push({ scope: 'all', text: `${me.name} used the match bonus.`, level: 'good' });
      act(`Match bonus: threw away card ${idx + 1}`);
      game.phase = 'play';
      endTurn(game);
      return ok();
    }
    case 'match_skip': {
      if (game.phase !== 'match-pick') return fail('Wrong phase.');
      game.phase = 'play';
      endTurn(game);
      return ok();
    }
    case 'call_cabo': {
      if (game.phase !== 'play') return fail('Wrong phase.');
      if (game.caboBy !== -1) return fail('Cabo already called.');
      if (!canCallCabo(game)) return fail('Cabo can be called once everyone has had a turn.');
      game.caboBy = seat;
      game.finalPending = game.players.map((_, i) => i).filter((i) => i !== seat);
      act('Called CABO!');
      banners.push({ scope: 'all', text: `${me.name} calls CABO! Everyone else gets one final turn.`, level: 'cabo' });
      endTurn(game);
      return ok();
    }
    default:
      return fail('Unknown action.');
  }
}

// Builds the redacted view of `game` visible to seat `viewer`.
function buildView(game, viewer) {
  const players = game.players.map((p, i) => {
    const revealAllCards = game.phase === 'reveal';
    const mine = i === viewer;
    return {
      seat: i,
      name: p.name,
      matchUsed: p.matchUsed,
      cardCount: p.cards.length,
      cards: p.cards.map((c) => (revealAllCards || (mine && c.known))
        ? { known: true, rank: c.rank, suit: c.suit }
        : { known: false }),
    };
  });
  return {
    you: viewer,
    round: game.round,
    turn: game.turn,
    phase: game.phase,
    caboBy: game.caboBy,
    deckCount: game.deck.length,
    discardTop: game.discard.length ? game.discard[game.discard.length - 1] : null,
    discardCount: game.discard.length,
    drawnCard: (viewer === game.turn && game.drawnCard) ? game.drawnCard : null,
    someoneHasDrawn: !!game.drawnCard,
    peekOppWho: viewer === game.turn ? game.peekOppWho : null,
    gameId: game.id,
    canCabo: canCallCabo(game),
    finalPending: game.finalPending,
    winnerSeats: game.winnerSeats,
    gameOver: game.gameOver,
    targetScore: TARGET_SCORE,
    turnDeadline: game.turnDeadline || null,
    turnMs: game.turnMs || null,
    turnNo: game.turnsTaken,
    lastActions: game.lastActions,
    drawnPublic: game.drawnFromDiscard ? game.drawnCard : null,
    swapPick1: viewer === game.turn ? game.swapPick1 : null,
    players,
    totals: game.totals,
    log: game.log,
    winnerSeat: game.winnerSeat,
    caboLost: game.caboLost,
    roundScores: game.phase === 'reveal' ? game.roundScores : null,
  };
}

module.exports = { createGame, applyAction, buildView, scoreOf, endTurn, RANKS, SUITS, cv, isSpec, TARGET_SCORE };
