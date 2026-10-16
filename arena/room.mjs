// The room on the server: who's in it, their cans, and the one place where what happens is decided. Everyone who
// opens the page is connected and watches; up to MAX_PLAYERS of them join with a name and get a can. Each step
// (sim.js TICK) every can takes its player's next input, they bump, and every connection gets the snapshot.
// Chat goes to everyone. Bots keep a lone visitor company (fill). It knows nothing of sockets: server.mjs hands it
// each connection as { send, close }, and the tests hand it their own.
import { TICK, MAX_PLAYERS, IDLE, spawn, stepRoom } from '../peak/arena/sim.js';
import { KIND, kindOf, decodeInput, encodeSnapshot } from '../peak/arena/protocol.js';
import { cleanName, cleanChat } from './words.mjs';
import { NAMES, brain } from './brain.mjs';

export const LIMITS = {
  queue: 30,                    // a player's inputs waiting at most (a second); past that the oldest go (presses kept)
  bank: 20,                     // steps a can may catch up: it earns one a step, and saves up while waiting (a stale's)
  catchUp: 3,                   // steps a can takes at most in one step while it catches up
  stale: 15,                    // steps without an input before the can goes on without (a page in the background)
  // inputs a can keeps in hand before it walks on them, so an uneven line (wifi, a page's uneven frames) doesn't make
  // it stop a step and take two the next, which everyone else sees: one more each time it runs dry for at most `gap`
  // steps, one fewer after `calm` steps without
  buffer: { min: 2, max: 6, gap: 3, calm: 300 },
  idle: 300,                    // s without walking or talking before a player goes back to watching
  chat: { burst: 4, every: 1.5 },   // chat lines in a row, then one every this many seconds
  connections: 48,              // players and watchers together
};

export class Room {
  // bots: how many keep one person (or nobody yet) company, one fewer for each person more
  constructor({ max = MAX_PLAYERS, clock = () => performance.now() / 1000, bots = 0, random = Math.random } = {}) {
    this.max = Math.min(max, MAX_PLAYERS);
    this.clock = clock;
    this.random = random;
    this.sessions = new Set();
    this.players = new Map();     // by id, the bots too
    this.bots = bots;
    this.crowd = [];              // the bots in the room
    this.step = 0;
    this.lastId = 0;
    this.fill();
  }

  get playing() { return this.players.size - this.crowd.length; }
  get watching() { return this.sessions.size - this.playing; }

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
    if (this.playing >= this.max) return this.send(session, { t: 'full', max: this.max });
    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    let name = cleanName(raw);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cleanName(raw).slice(0, 13)} ${n}`;
    const colors = new Set([...this.players.values()].map(p => p.color));
    let color = 0;
    while (colors.has(color)) color++;
    const id = this.nextId();
    const can = spawn(color);
    can.id = id;
    const player = { id, name, color, can, session, queue: [], credit: 0, ack: 0, stale: 0, active: this.clock(),
      buffer: LIMITS.buffer.min, flowing: false, calm: 0, dry: 0 };
    session.player = player;
    this.players.set(id, player);
    this.send(session, { t: 'joined', id, name });
    this.broadcast({ t: 'add', ...card(player) });
    this.fill();
    this.crowd[Math.floor(this.random() * this.crowd.length)]?.mind.greet();
  }

  leave(session, why) {
    const player = session.player;
    if (!player) return;
    session.player = null;
    this.players.delete(player.id);
    this.broadcast({ t: 'remove', id: player.id, why });
    this.fill();
  }

  // Bots, so nobody is alone on the plaza: `bots` of them with one person or nobody yet, one fewer for each person
  // more. One makes room when a person comes in (the last to come), and comes back when one goes. They take the
  // colours from the far end, so people get the first ones. With nobody connected the room doesn't step, and they
  // wait where they are.
  fill() {
    const people = this.playing, want = Math.max(0, Math.min(this.bots + 1 - Math.max(1, people), this.max - people));
    while (this.crowd.length > want) {
      const bot = this.crowd.pop();
      this.players.delete(bot.id);
      this.broadcast({ t: 'remove', id: bot.id, why: 'room' });
    }
    while (this.crowd.length < want) {
      const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
      const free = NAMES.map(n => `${n} (bot)`).filter(n => !taken.has(n.toLowerCase()));
      const colors = new Set([...this.players.values()].map(p => p.color));
      let color = MAX_PLAYERS - 1;
      while (colors.has(color)) color--;
      const id = this.nextId();
      const can = spawn(color);
      can.id = id;
      // a line now and then: one idea in twenty
      const bot = { id, name: free[Math.floor(this.random() * free.length)], color, can, session: null, bot: true,
        ack: 0, mind: brain({ random: this.random, chat: 0.05 }) };
      this.players.set(id, bot);
      this.crowd.push(bot);
      this.broadcast({ t: 'add', ...card(bot) });
    }
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

  // One step of the room, and its snapshot to everyone. A can takes its page's inputs one a step, a few behind (the
  // buffer), so it walks evenly however unevenly they come in. When it runs dry it waits where it is until it has its
  // buffer again (a deeper one); with more than that in hand (a burst after a hiccup) it takes up to three a step,
  // no more than it saved up while waiting (bank), so sending more never makes a can faster. With none for a while,
  // it goes on without (standing still, coming down from a jump). A bot thinks of its input there and then.
  tick() {
    const now = this.clock(), inputs = new Map(), { min, max, calm } = LIMITS.buffer;
    const everyone = [...this.players.values()];
    for (const p of everyone) {
      if (p.bot) {
        const { input, say } = p.mind.step(p, everyone);
        inputs.set(p.id, [input]);
        if (say) this.broadcast({ t: 'chat', id: p.id, text: say });
        continue;
      }
      p.credit = Math.min(LIMITS.bank, p.credit + 1);
      const waiting = p.queue.length;
      if (p.flowing && !waiting) {                // ran dry: wait for a deeper buffer
        p.flowing = false;
        p.buffer = Math.min(max, p.buffer + 1);
        p.dry = 0;
      } else if (!p.flowing && !waiting) p.dry++;
      else if (!p.flowing && (waiting >= p.buffer || p.stale >= LIMITS.stale)) {
        p.flowing = true;
        // dry for long, a hiccup or a page in the background, is no sign of an uneven line: the buffer it had
        if (p.dry > LIMITS.buffer.gap) p.buffer = Math.max(min, p.buffer - 1);
        else p.calm = 0;
      }
      const extra = waiting - p.buffer - 1, want = extra > 0 ? Math.min(LIMITS.catchUp, 1 + Math.ceil(extra / 4)) : 1;
      const taken = p.flowing ? p.queue.splice(0, Math.min(p.credit, want)) : [];
      p.credit -= taken.length;
      for (const input of taken) {
        p.ack = input.seq;
        if (input.x || input.z || input.jump || input.emote) p.active = now;
      }
      if (taken.length) {
        p.stale = 0;
        if (++p.calm >= calm) {
          p.calm = 0;
          p.buffer = Math.max(min, p.buffer - 1);
        }
      } else if (++p.stale > LIMITS.stale) {
        taken.push(IDLE);
        p.credit -= 1;
      }
      inputs.set(p.id, taken);
    }
    stepRoom(everyone.map(p => p.can), inputs);
    this.step = (this.step + 1) & 0xffff;
    for (const p of everyone) {
      if (p.bot || now - p.active < LIMITS.idle) continue;
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

const card = p => ({ id: p.id, name: p.name, color: p.color, ...(p.bot && { bot: true }) });
