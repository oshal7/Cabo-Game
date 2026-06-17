const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { applyAction, buildView } = require('./cabo');

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

function broadcastGame(room) {
  if (!room.game) return;
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
  socket.emit('rooms_list', rooms.list());

  socket.on('list_rooms', () => {
    socket.emit('rooms_list', rooms.list());
  });

  socket.on('create_room', ({ name, maxPlayers }, ack) => {
    try {
      const cleanName = String(name || 'Host').trim().slice(0, 16) || 'Host';
      const { room, token } = rooms.create(cleanName, maxPlayers);
      room.seats[0].socketId = socket.id;
      room.seats[0].connected = true;
      room.lastActivity = Date.now();
      socket.data = { roomCode: room.code, token };
      socket.join(room.code);
      ack && ack({ ok: true, code: room.code, token, seat: 0, room: room.summary() });
      broadcastLobby();
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', ({ code, name }, ack) => {
    try {
      const cleanName = String(name || 'Player').trim().slice(0, 16) || 'Player';
      const { room, token } = rooms.join(code, cleanName);
      const seatIdx = room.seatIndexByToken(token);
      room.seats[seatIdx].socketId = socket.id;
      room.seats[seatIdx].connected = true;
      room.lastActivity = Date.now();
      socket.data = { roomCode: room.code, token };
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
      socket.data = { roomCode: room.code, token };
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

  socket.on('action', ({ type, payload }, ack) => {
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.game) return ack && ack({ ok: false, error: 'Game not started.' });
    const result = applyAction(room.game, seatIdx, type, payload || {});
    room.lastActivity = Date.now();
    if (!result.ok) return ack && ack(result);
    sendBanners(room, result.banners, seatIdx);
    if (result.flashes && result.flashes.length) io.to(room.code).emit('flashes', result.flashes);
    broadcastGame(room);
    if (room.game.phase === 'reveal') broadcastLobby();
    ack && ack({ ok: true });
  });

  socket.on('next_round', (_payload, ack) => {
    const found = seatFor(socket);
    if (!found) return ack && ack({ ok: false, error: 'Not in a room.' });
    const { room, seatIdx } = found;
    if (!room.seats[seatIdx].isHost) return ack && ack({ ok: false, error: 'Only the host can continue.' });
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
    socket.data = {};
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
    }
    broadcastLobby();
  });
});

setInterval(() => { rooms.sweepStale(); broadcastLobby(); }, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`CABO server listening on http://localhost:${PORT}`);
});
