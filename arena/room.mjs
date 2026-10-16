// The room on the server: who's in it, their cans, and the one place where what happens is decided. Everyone who
// opens the page is connected and watches; up to MAX_PLAYERS of them join with a name and get a can. Each step
// (sim.js TICK) every can takes its player's next input, they bump, and every connection gets the snapshot.
// Chat goes to everyone. It knows nothing of sockets: server.mjs hands it each connection as { send, close }, and the
// tests hand it their own.
import { TICK, MAX_PLAYERS, IDLE, spawn, stepRoom } from '../peak/arena/sim.js';
import { KIND, kindOf, decodeInput, encodeSnapshot } from '../peak/arena/protocol.js';
import { cleanName, cleanChat } from './words.mjs';

export const LIMITS = {
  queue: 30,                    // a player's inputs waiting at most (a second); past that the oldest go (presses kept)
  bank: 8,                      // steps a can may catch up at once: it earns one a step, and saves up while waiting
  stale: 8,                     // steps without an input before the can goes on without (a page in the background)
  idle: 300,                    // s without walking or talking before a player goes back to watching
  chat: { burst: 4, every: 1.5 },   // chat lines in a row, then one every this many seconds
  connections: 48,              // players and watchers together
};

export class Room {
  constructor({ max = MAX_PLAYERS, clock = () => performance.now() / 1000 } = {}) {
    this.max = Math.min(max, MAX_PLAYERS);
    this.clock = clock;
    this.sessions = new Set();
    this.players = new Map();     // by id
    this.step = 0;
    this.lastId = 0;
  }

  get playing() { return this.players.size; }
  get watching() { return this.sessions.size - this.players.size; }

  // A new connection, or null when the room has no more room for watchers either.
  open(client) {
    if (this.sessions.size >= LIMITS.connections) {
      client.close(1013, 'busy');
      return null;
    }
    const session = { client, player: null, chat: LIMITS.chat.burst, chatAt: this.clock() };
    this.sessions.add(session);
    this.send(session, { t: 'hello', max: this.max, tick: TICK, players: [...this.players.values()].map(card) });
    return session;
  }

  close(session) {
    if (session.player) this.leave(session, 'left');
    this.sessions.delete(session);
  }

  // What a connection sent: an input (binary) or a JSON message. Anything else is ignored.
  receive(session, data, binary) {
    if (binary) {
      if (session.player && kindOf(data) === KIND.input) this.input(session.player, decodeInput(data));
      return;
    }
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') this.join(session, m.name);
    else if (m.t === 'chat') this.chat(session, m.text);
    else if (m.t === 'leave' && session.player) this.leave(session, 'left');
    else if (m.t === 'ping' && Number.isFinite(m.at)) this.send(session, { t: 'pong', at: m.at });
  }

  join(session, raw) {
    if (session.player) return;
    if (this.players.size >= this.max) return this.send(session, { t: 'full', max: this.max });
    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    let name = cleanName(raw);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cleanName(raw).slice(0, 13)} ${n}`;
    const colors = new Set([...this.players.values()].map(p => p.color));
    let color = 0;
    while (colors.has(color)) color++;
    const id = this.nextId();
    const can = spawn(color);
    can.id = id;
    const player = { id, name, color, can, session, queue: [], credit: 0, ack: 0, stale: 0, active: this.clock() };
    session.player = player;
    this.players.set(id, player);
    this.send(session, { t: 'joined', id, name });
    this.broadcast({ t: 'add', ...card(player) });
  }

  leave(session, why) {
    const player = session.player;
    if (!player) return;
    session.player = null;
    this.players.delete(player.id);
    this.broadcast({ t: 'remove', id: player.id, why });
  }

  input(player, input) {
    if (!input) return;
    player.queue.push(input);
    if (player.queue.length > LIMITS.queue) {
      // far behind, or sending too fast: the oldest go, but not their presses
      const dropped = player.queue.splice(0, player.queue.length - LIMITS.queue);
      const next = player.queue[0];
      for (const d of dropped) {
        next.jump ||= d.jump;
        next.emote ||= d.emote;
      }
    }
  }

  chat(session, raw) {
    const player = session.player;
    if (!player) return;
    const now = this.clock();
    session.chat = Math.min(LIMITS.chat.burst, session.chat + (now - session.chatAt) / LIMITS.chat.every);
    session.chatAt = now;
    if (session.chat < 1) return this.send(session, { t: 'slow' });
    const text = cleanChat(raw);
    if (!text) return;
    session.chat -= 1;
    player.active = now;
    this.broadcast({ t: 'chat', id: player.id, text });
  }

  // One step of the room, and its snapshot to everyone. A can takes the inputs its page sent since: one a step, and
  // the ones it waited for when they came in late or all at once after a hiccup (the page and the server tick on
  // clocks of their own), as many as it saved up (bank), so sending more never makes a can faster. With none, it
  // waits a few steps for them where it is, and then goes on without (standing still, coming down from a jump).
  tick() {
    const now = this.clock(), inputs = new Map();
    for (const p of this.players.values()) {
      p.credit = Math.min(LIMITS.bank, p.credit + 1);
      const taken = p.queue.splice(0, p.credit);
      p.credit -= taken.length;
      for (const input of taken) {
        p.ack = input.seq;
        if (input.x || input.z || input.jump || input.emote) p.active = now;
      }
      if (taken.length) p.stale = 0;
      else if (++p.stale > LIMITS.stale) {
        taken.push(IDLE);
        p.credit -= 1;
      }
      inputs.set(p.id, taken);
    }
    stepRoom([...this.players.values()].map(p => p.can), inputs);
    this.step = (this.step + 1) & 0xffff;
    for (const p of [...this.players.values()]) {
      if (now - p.active < LIMITS.idle) continue;
      this.send(p.session, { t: 'idle' });
      this.leave(p.session, 'idle');
    }
    const snapshot = encodeSnapshot(this.step, [...this.players.values()]);
    for (const s of this.sessions) s.client.send(snapshot);
  }

  nextId() {
    do this.lastId = this.lastId % 250 + 1; while (this.players.has(this.lastId));
    return this.lastId;
  }

  send(session, message) { session.client.send(JSON.stringify(message)); }
  broadcast(message) {
    const text = JSON.stringify(message);
    for (const s of this.sessions) s.client.send(text);
  }
}

const card = p => ({ id: p.id, name: p.name, color: p.color });
