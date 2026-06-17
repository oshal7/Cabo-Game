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
    deck, discard, players,
    turn: 0,
    phase: 'play',
    drawnCard: null,
    swapSeen: false,
    swapPick1: null,
    peekOppWho: null,
    caboBy: -1,
    caboLeft: 0,
    round: round || 1,
    totals: totals || players.map(() => 0),
    log: 'Round started — everyone peeked their first two cards.',
    winnerSeat: null,
    caboLost: false,
  };
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
  game.drawnCard = null;
  game.swapPick1 = null;
  game.swapSeen = false;
  game.peekOppWho = null;
  game.phase = 'play';
  if (game.caboBy !== -1) {
    game.caboLeft--;
    if (game.caboLeft <= 0) { revealAll(game); return; }
  }
  let next = (game.turn + 1) % game.players.length;
  let safety = 0;
  while (game.players[next].skip && safety < game.players.length) {
    game.players[next].skip = false;
    next = (next + 1) % game.players.length;
    safety++;
  }
  if (next <= game.turn) game.round++;
  game.turn = next;
}

function revealAll(game) {
  game.phase = 'reveal';
  game.players.forEach((p) => p.cards.forEach((c) => { c.known = true; }));
  const scores = game.players.map((p, i) => ({ i, s: scoreOf(game, i) }));
  const min = Math.min(...scores.map((x) => x.s));
  const winner = scores.find((x) => x.s === min);
  const caboLost = game.caboBy !== -1 && scores[game.caboBy].s !== min;
  scores.forEach((x) => {
    game.totals[x.i] = (game.totals[x.i] || 0) + x.s + (caboLost && x.i === game.caboBy ? 5 : 0);
  });
  game.winnerSeat = winner.i;
  game.caboLost = caboLost;
  game.roundScores = scores.map((x) => x.s);
}

// Applies a player action. Returns { ok, error, banners }.
// banners: [{ scope: 'all' | seatIndex, text, level }]
function applyAction(game, seat, type, payload = {}) {
  const banners = [];
  const flashes = [];
  const fail = (error) => ({ ok: false, error, banners, flashes });
  const ok = () => ({ ok: true, banners, flashes });

  if (game.phase === 'reveal') return fail('Round is over.');
  if (seat !== game.turn) return fail('Not your turn.');
  const me = game.players[seat];

  switch (type) {
    case 'draw_deck': {
      if (game.phase !== 'play') return fail('Wrong phase.');
      if (!game.deck.length) return fail('Deck is empty.');
      game.drawnCard = game.deck.pop();
      game.phase = 'drawn';
      return ok();
    }
    case 'draw_discard': {
      if (game.phase !== 'play') return fail('Wrong phase.');
      if (!game.discard.length) return fail('Discard pile is empty.');
      game.drawnCard = game.discard.pop();
      game.phase = 'drawn';
      return ok();
    }
    case 'discard_drawn': {
      if (game.phase !== 'drawn') return fail('Wrong phase.');
      const card = game.drawnCard;
      game.discard.push(card);
      game.drawnCard = null;
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
      banners.push({ scope: 'all', text: `${me.name} swapped a card.`, level: 'info' });
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
      banners.push({ scope: seat, text: `Card ${idx + 1}: ${c.rank}${c.suit}`, level: 'info' });
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} peeked their own card.`, level: 'info' });
      game.discard.push(game.drawnCard);
      game.drawnCard = null;
      game.phase = 'play';
      endTurn(game);
      return ok();
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
      banners.push({ scope: seat, text: `${opp.name}'s card ${idx + 1}: ${c.rank}${c.suit}`, level: 'info' });
      banners.push({ scope: 'others', exclude: seat, text: `${me.name} peeked ${opp.name}'s card.`, level: 'info' });
      flashes.push({ kind: 'peek', seat: oppSeat, idx, label: `${me.name} peeked!` });
      game.discard.push(game.drawnCard);
      game.drawnCard = null;
      game.phase = 'play';
      endTurn(game);
      return ok();
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
      flashes.push({ kind: 'swap', seat: p1.owner, idx: p1.idx }, { kind: 'swap', seat: oppSeat, idx });
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
      const disc = me.cards.splice(idx, 1)[0];
      game.discard.push(disc);
      me.matchUsed = true;
      banners.push({ scope: 'all', text: `${me.name} used the match bonus.`, level: 'good' });
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
      game.caboBy = seat;
      game.caboLeft = game.players.length - 1;
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
    swapPick1: viewer === game.turn ? game.swapPick1 : null,
    players,
    totals: game.totals,
    log: game.log,
    winnerSeat: game.winnerSeat,
    caboLost: game.caboLost,
    roundScores: game.phase === 'reveal' ? game.roundScores : null,
  };
}

module.exports = { createGame, applyAction, buildView, scoreOf, RANKS, SUITS, cv, isSpec };
