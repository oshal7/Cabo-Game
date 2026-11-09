const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { applyAction, buildView } = require('./cabo');

// Turn timers: a disconnected player is auto-played quickly; a connected but
// idle player gets a generous limit so one AFK seat can't freeze the room.
const TURN_MS_CONNECTED = 90 * 1000;
const TURN_MS_DISCONNECTED = 15 * 1000;

function cleanName(raw, fallback) {
  return String(raw || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || fallback;
}

// Very small per-socket rate limit: at most 15 events per 2 seconds.
function rateOk(socket) {
  const now = Date.now();
  const r = socket.data.rate || (socket.data.rate = { t: now, n: 0 });
  if (now - r.t > 2000) { r.t = now; r.n = 0; }
  return ++r.n <= 15;
}

const PORT = process.env.PORT || 3000;
const rooms = new RoomManager(3);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || '*' },
});

function broadcastLobby() {
  io.emit('rooms_list', rooms.list());
}

function broadcastRoom(room) {
  io.to(room.code).emit('room_update', room.summary());
}

function scheduleTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  const game = room.game;
  if (!game || game.phase === 'reveal' || !room.hasConnectedSeat()) { if (game) game.turnDeadline = null; return; }
  const seat = room.seats[game.turn];
  const ms = seat && seat.connected ? TURN_MS_CONNECTED : TURN_MS_DISCONNECTED;
  const turnAtSchedule = game.turn;
  const turnsAtSchedule = game.turnsTaken;
  game.turnDeadline = Date.now() + ms;
  room.turnTimer = setTimeout(() => {
    if (room.game !== game || game.turn !== turnAtSchedule || game.turnsTaken !== turnsAtSchedule) return;
    autoPlay(room);
  }, ms);
}

// Plays the safest legal move for the current seat (draw + discard).
function autoPlay(room) {
  const game = room.game;
  const seatIdx = game.turn;
  const name = room.seats[seatIdx] ? room.seats[seatIdx].name : 'Player';
  if (game.phase.startsWith('spec-')) applyAction(game, seatIdx, 'cancel_special');
  if (game.phase === 'match-pick') applyAction(game, seatIdx, 'match_skip');
  else {
    if (game.phase === 'play') applyAction(game, seatIdx, 'draw_deck');
    if (game.phase === 'drawn') applyAction(game, seatIdx, 'discard_drawn');
    if (game.phase === 'match-pick') applyAction(game, seatIdx, 'match_skip');
  }
  io.to(room.code).emit('banner', { text: `${name} ran out of time — auto-played.`, level: 'warn' });
  broadcastGame(room);
  if (game.phase === 'reveal') broadcastLobby();
}

function broadcastGame(room) {
  if (!room.game) return;
  scheduleTurnTimer(room);
  for (const seat of room.seats) {
    if (seat.connected && seat.socketId) {
      io.to(seat.socketId).emit('game_state', buildView(room.game, room.seats.indexOf(seat)));
    }
  }
}

function sendBanners(room, banners, fromSeat) {
  if (!banners || !banners.length) return;
  for (const b of banners) {
    const payload = { text: b.text, level: b.level || 'info' };
    if (b.scope === 'all') {
      io.to(room.code).emit('banner', payload);
    } else if (b.scope === 'others') {
      room.seats.forEach((s, i) => {
        if (i !== b.exclude && s.connected && s.socketId) io.to(s.socketId).emit('banner', payload);
      });
    } else if (typeof b.scope === 'number') {
      const s = room.seats[b.scope];
      if (s && s.connected && s.socketId) io.to(s.socketId).emit('banner', payload);
    }
  }
  const publicText = banners.find((b) => b.scope === 'all');
  if (publicText && room.game) room.game.log = publicText.text;
}

function seatFor(socket) {
  const { roomCode, token } = socket.data || {};
  if (!roomCode || !token) return null;
  const room = rooms.get(roomCode);
  if (!room) return null;
  const seatIdx = room.seatIndexByToken(token);
  if (seatIdx === -1) return null;
  return { room, seatIdx };
}

io.on('connection', (socket) => {
  socket.data = socket.data || {};
  socket.emit('rooms_list', rooms.list());

  socket.on('list_rooms', () => {
    socket.emit('rooms_list', rooms.list());
  });

  socket.on('create_room', ({ name, maxPlayers }, ack) => {
    try {
      const { room, token } = rooms.create(cleanName(name, 'Host'), maxPlayers);
      room.seats[0].socketId = socket.id;
      room.seats[0].connected = true;
      room.lastActivity = Date.now();
      socket.data = { ...socket.data, roomCode: room.code, token };
      socket.join(room.code);
      ack && ack({ ok: true, code: room.code, token, seat: 0, room: room.summary() });
      broadcastLobby();
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', ({ code, name }, ack) => {
    try {
      const { room, token } = rooms.join(code, cleanName(name, 'Player'));
      const seatIdx = room.seatIndexByToken(token);
      room.seats[seatIdx].socketId = socket.id;
      room.seats[seatIdx].connected = true;
      room.lastActivity = Date.now();
      socket.data = { ...socket.data, roomCode: room.code, token };
      socket.join(room.code);
      ack && ack({ ok: true, code: room.code, token, seat: seatIdx, room: room.summary() });
      broadcastRoom(room);
      broadcastLobby();
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('rejoin', ({ code, token }, ack) => {
    try {
      const room = rooms.get(code);
      if (!room) throw new Error('Room no longer exists.');
      const seatIdx = room.seatIndexByToken(token);
      if (seatIdx === -1) throw new Error('Seat not found.');
      room.seats[seatIdx].socketId = socket.id;
      room.seats[seatIdx].connected = true;
      room.lastActivity = Date.now();
      socket.data = { ...socket.data, roomCode: room.code, token };
      socket.join(room.code);
      ack && ack({ ok: true, code: room.code, token, seat: seatIdx, room: room.summary(), status: room.status });
      broadcastRoom(room);
      if (room.status === 'playing') broadcastGame(room);
      io.to(room.code).emit('banner', { text: `${room.seats[seatIdx].name} reconnected.`, level: 'good' });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('start_game', (_payload, ack) => {
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.seats[seatIdx].isHost) return ack && ack({ ok: false, error: 'Only the host can start.' });
    try {
      room.startGame();
      room.lastActivity = Date.now();
      broadcastRoom(room);
      broadcastGame(room);
      broadcastLobby();
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('action', ({ type, payload } = {}, ack) => {
    if (!rateOk(socket)) return ack && ack({ ok: false, error: 'Slow down a little.' });
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.game) return ack && ack({ ok: false, error: 'Game not started.' });
    const result = applyAction(room.game, seatIdx, type, payload || {});
    room.lastActivity = Date.now();
    if (!result.ok) return ack && ack(result);
    sendBanners(room, result.banners, seatIdx);
    if (result.moves && result.moves.length) io.to(room.code).emit('moves', result.moves);
    if (result.flashes && result.flashes.length) io.to(room.code).emit('flashes', result.flashes);
    ack && ack({ ok: true, reveal: result.reveal });
    // Give the peek flip/blur animation time to play before the next
    // game_state wipes the card elements with a fresh re-render.
    const hasPeek = result.flashes && result.flashes.some((f) => f.kind === 'peek');
    const sendState = () => {
      broadcastGame(room);
      if (room.game.phase === 'reveal') broadcastLobby();
    };
    if (hasPeek) setTimeout(sendState, 2000);
    else sendState();
  });

  socket.on('next_round', (_payload, ack) => {
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.seats[seatIdx].isHost) return ack && ack({ ok: false, error: 'Only the host can continue.' });
    if (room.game && room.game.gameOver) return ack && ack({ ok: false, error: 'Game over — start a new game.' });
    try {
      room.nextRound();
      room.lastActivity = Date.now();
      broadcastGame(room);
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('new_game', (_payload, ack) => {
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.seats[seatIdx].isHost) return ack && ack({ ok: false, error: 'Only the host can restart.' });
    try {
      room.newGame();
      room.lastActivity = Date.now();
      broadcastGame(room);
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('leave_room', () => {
    const found = seatFor(socket);
    if (!found) return;
    const { room, seatIdx } = found;
    room.seats[seatIdx].connected = false;
    room.seats[seatIdx].socketId = null;
    socket.leave(room.code);
    socket.data = { rate: socket.data.rate };
    if (room.status === 'lobby') {
      room.seats.splice(seatIdx, 1);
      if (room.seats.length === 0) {
        rooms.removeIfAbandoned(room.code);
      } else {
        if (!room.seats.some((s) => s.isHost)) room.seats[0].isHost = true;
        broadcastRoom(room);
      }
    } else {
      if (!room.seats.some((s) => s.isHost && s.connected)) {
        const next = room.seats.find((s) => s.connected);
        if (next) { room.seats.forEach((s) => { s.isHost = false; }); next.isHost = true; }
      }
      io.to(room.code).emit('banner', { text: `${room.seats[seatIdx].name} left the game.`, level: 'warn' });
      broadcastRoom(room);
      broadcastGame(room);
    }
    broadcastLobby();
  });

  socket.on('disconnect', () => {
    const found = seatFor(socket);
    if (!found) return;
    const { room, seatIdx } = found;
    if (room.seats[seatIdx].socketId !== socket.id) return; // already replaced by a newer connection
    room.seats[seatIdx].connected = false;
    room.seats[seatIdx].socketId = null;
    if (room.status === 'lobby') {
      room.seats.splice(seatIdx, 1);
      if (room.seats.length === 0) {
        rooms.removeIfAbandoned(room.code);
      } else {
        if (!room.seats.some((s) => s.isHost)) room.seats[0].isHost = true;
        broadcastRoom(room);
      }
    } else {
      if (!room.seats.some((s) => s.isHost && s.connected)) {
        const next = room.seats.find((s) => s.connected);
        if (next) { room.seats.forEach((s) => { s.isHost = false; }); next.isHost = true; }
      }
      io.to(room.code).emit('banner', { text: `${room.seats[seatIdx].name} disconnected. Waiting for them to reconnect…`, level: 'warn' });
      broadcastRoom(room);
      broadcastGame(room);
    }
    broadcastLobby();
  });
});

setInterval(() => { rooms.sweepStale(); broadcastLobby(); }, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`CABO server listening on http://localhost:${PORT}`);
});
