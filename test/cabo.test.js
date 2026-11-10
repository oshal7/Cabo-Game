const test = require('node:test');
const assert = require('node:assert');
const { createGame, applyAction, buildView } = require('../server/cabo');

const card = (rank, suit = '♠') => ({ rank, suit, known: false });

function playTurn(g, seat) {
  assert.strictEqual(g.turn, seat, `expected seat ${seat} to be on turn`);
  assert.ok(applyAction(g, seat, 'draw_deck').ok);
  const r = applyAction(g, seat, 'discard_drawn');
  assert.ok(r.ok);
  if (g.phase === 'match-pick') applyAction(g, seat, 'match_skip');
}

test('round number does not increase as turns go round the table', () => {
  const g = createGame(['A', 'B', 'C']);
  g.deck.push(card('2'), card('3'), card('4'), card('5'), card('6'), card('A'));
  g.discard = [card('K')];
  for (let i = 0; i < 6; i++) playTurn(g, i % 3);
  assert.strictEqual(g.round, 1);
});

test('Cabo cannot be called before everyone has had a turn', () => {
  const g = createGame(['A', 'B']);
  assert.strictEqual(applyAction(g, 0, 'call_cabo').ok, false);
});

test('a J skip during the final round does not give the caller an extra turn', () => {
  const g = createGame(['A', 'B', 'C']);
  g.turnsTaken = 3; // everyone has played once
  g.discard = [card('K')];
  g.turn = 0;
  assert.ok(applyAction(g, 0, 'call_cabo').ok);
  assert.strictEqual(g.turn, 1);
  g.deck.push(card('J'));
  applyAction(g, 1, 'draw_deck');
  assert.ok(applyAction(g, 1, 'use_special').ok); // skips seat 2
  assert.strictEqual(g.phase, 'reveal', 'round should end — nobody else owes a final turn');
});

test('empty deck reshuffles the discard pile, keeping its top card', () => {
  const g = createGame(['A', 'B']);
  g.deck = [];
  g.discard = [card('3'), card('4'), card('5')];
  assert.ok(applyAction(g, 0, 'draw_deck').ok);
  assert.strictEqual(g.discard.length, 1);
  assert.strictEqual(g.discard[0].rank, '5');
});

test('reaching exactly 100 resets to 50 and going over ends the game', () => {
  const g = createGame(['A', 'B'], 1, [90, 95]);
  g.players[0].cards = [card('10')];          // 90 + 10 = 100 -> 50
  g.players[1].cards = [card('Q')];           // 95 + 12 = 107 -> game over
  g.turnsTaken = 2;
  applyAction(g, 0, 'call_cabo');
  playTurn(g, 1);
  assert.strictEqual(g.phase, 'reveal');
  assert.deepStrictEqual(g.totals, [50, 107]);
  assert.strictEqual(g.gameOver, true);
});

test('views never leak hidden cards', () => {
  const g = createGame(['A', 'B']);
  const v = buildView(g, 0);
  assert.ok(v.players[1].cards.every((c) => !c.known && c.rank === undefined));
  assert.ok(v.players[0].cards[2].rank === undefined);
});

test('correct match throws your card on the pile and lets you keep playing', () => {
  const g = createGame(['A', 'B']);
  g.discard = [card('7', '♥')];
  g.players[0].cards = [card('7', '♠'), card('3'), card('K')];
  const r = applyAction(g, 0, 'match', { idx: 0 });
  assert.ok(r.ok && r.matched);
  assert.strictEqual(g.players[0].cards.length, 2);
  assert.strictEqual(g.discard[g.discard.length - 1].rank, '7');
  assert.strictEqual(g.turn, 0);
  assert.strictEqual(g.phase, 'play');
  assert.ok(applyAction(g, 0, 'draw_deck').ok, 'can still draw after matching');
});

test('wrong match: card stays, penalty card added, no second attempt', () => {
  const g = createGame(['A', 'B']);
  g.discard = [card('7')];
  g.players[0].cards = [card('5'), card('7'), card('K'), card('2')];
  const r = applyAction(g, 0, 'match', { idx: 0 });
  assert.ok(r.ok && r.matched === false);
  assert.strictEqual(g.players[0].cards.length, 5);
  assert.strictEqual(g.players[0].cards[0].rank, '5');
  assert.strictEqual(applyAction(g, 0, 'match', { idx: 1 }).ok, false);
});

test('cannot match after drawing', () => {
  const g = createGame(['A', 'B']);
  g.discard = [card('7')];
  g.players[0].cards = [card('7')];
  applyAction(g, 0, 'draw_deck');
  assert.strictEqual(applyAction(g, 0, 'match', { idx: 0 }).ok, false);
});

test('a card taken from the discard pile has no power and must be swapped in', () => {
  const g = createGame(['A', 'B']);
  g.discard = [card('Q')];
  assert.ok(applyAction(g, 0, 'draw_discard').ok);
  assert.strictEqual(applyAction(g, 0, 'use_special').ok, false);
  assert.strictEqual(applyAction(g, 0, 'discard_drawn').ok, false);
  assert.ok(applyAction(g, 0, 'swap_card', { idx: 2 }).ok);
  assert.strictEqual(g.turn, 1);
});
