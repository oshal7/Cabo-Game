const crypto = require('crypto');
const { createGame } = require('./cabo');

const MAX_ROOMS = 3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[~~(Math.random() * CODE_CHARS.length)];
  return s;
}

class Room {
  constructor(code, maxPlayers) {
    this.code = code;
    this.maxPlayers = maxPlayers;
    this.seats = []; // { token, name, socketId, connected, isHost }
    this.status = 'lobby'; // 'lobby' | 'playing'
    this.game = null;
    this.lastActivity = Date.now();
  }

  addSeat(name, isHost) {
    if (this.status !== 'lobby') throw new Error('Game already in progress.');
    if (this.seats.length >= this.maxPlayers) throw new Error('Room is full.');
    const token = crypto.randomUUID();
    this.seats.push({ token, name, socketId: null, connected: false, isHost: !!isHost });
    return token;
  }

  seatIndexByToken(token) {
    return this.seats.findIndex((s) => s.token === token);
  }

  hasConnectedSeat() {
    return this.seats.some((s) => s.connected);
  }

  startGame() {
    if (this.status !== 'lobby') throw new Error('Already started.');
    if (this.seats.length < 2) throw new Error('Need at least 2 players.');
    this.status = 'playing';
    this.game = createGame(this.seats.map((s) => s.name));
  }

  nextRound() {
    if (!this.game || this.game.phase !== 'reveal') throw new Error('Round not over.');
    this.game = createGame(this.seats.map((s) => s.name), this.game.round + 1, this.game.totals);
  }

  newGame() {
    this.status = 'playing';
    this.game = createGame(this.seats.map((s) => s.name), 1, this.seats.map(() => 0));
  }

  summary() {
    return {
      code: this.code,
      maxPlayers: this.maxPlayers,
      status: this.status,
      players: this.seats.map((s) => ({ name: s.name, connected: s.connected, isHost: s.isHost })),
    };
  }
}

class RoomManager {
  constructor(maxRooms = MAX_ROOMS) {
    this.maxRooms = maxRooms;
    this.rooms = new Map();
  }

  list() {
    return [...this.rooms.values()]
      .filter((r) => r.status === 'lobby')
      .map((r) => r.summary());
  }

  create(hostName, maxPlayers) {
    if (this.rooms.size >= this.maxRooms) {
      throw new Error(`Server is full (max ${this.maxRooms} rooms right now). Try again shortly.`);
    }
    let code;
    do { code = genCode(); } while (this.rooms.has(code));
    const mp = Math.min(4, Math.max(2, maxPlayers | 0));
    const room = new Room(code, mp);
    const token = room.addSeat(hostName, true);
    this.rooms.set(code, room);
    return { room, token };
  }

  join(code, name) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) throw new Error('Room not found.');
    const token = room.addSeat(name, false);
    return { room, token };
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  removeIfAbandoned(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.status === 'lobby' && !room.hasConnectedSeat()) {
      this.rooms.delete(code);
    }
  }

  sweepStale(maxIdleMs = 60 * 60 * 1000) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (!room.hasConnectedSeat() && now - room.lastActivity > maxIdleMs) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { RoomManager, Room };
