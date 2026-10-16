// Cans that aren't people, to fill the room while testing: each wanders the plaza, now and then runs at someone to
// bump them, jumps, waves, dances and says something. `node bots.mjs [count] [ws://host:port/arena/ws]`; Ctrl+C
// takes them home.
import WebSocket from 'ws';
import { TICK, PLAZA } from '../peak/arena/sim.js';
import { PATH, encodeInput, decodeSnapshot, kindOf, KIND } from '../peak/arena/protocol.js';

const count = Number(process.argv[2] ?? 4);
const url = process.argv[3] ?? `ws://127.0.0.1:${process.env.PORT ?? 5298}${PATH}`;
const NAMES = ['Fizz', 'Bubbles', 'Tab', 'Dent', 'Zero Sugar', 'Cola', 'Seltzer', 'Ginger', 'Tonic', 'Lime',
  'Root Beer', 'Spritz'];
const LINES = ['hoi!', 'who bumped me', 'nice glasses', 'is this the queue for the summit?', 'brb, recycling',
  'fizz fizz', 'anyone seen the gondola?', 'bump gently, said the sign', 'zero sugar, all attitude'];

function bot(i) {
  const ws = new WebSocket(url, { origin: 'http://127.0.0.1' });
  ws.binaryType = 'arraybuffer';
  const me = { id: null, seq: 0, target: wander(), chase: null, still: false, x: 0, z: 0, until: 0, timer: null };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: `${NAMES[i % NAMES.length]} (bot)` })));
  ws.on('message', (data, binary) => {
    if (!binary) {
      const m = JSON.parse(String(data));
      if (m.t === 'joined') {
        me.id = m.id;
        me.timer = setInterval(() => step(), TICK * 1000);
      }
      if (m.t === 'full') console.log(`${NAMES[i]}: the room is full`);
      return;
    }
    if (kindOf(data) !== KIND.snapshot) return;
    const snap = decodeSnapshot(data);
    me.cans = snap.players;
    const mine = snap.players.find(p => p.id === me.id);
    if (mine) Object.assign(me, { x: mine.can.x, z: mine.can.z });
  });
  ws.on('close', () => clearInterval(me.timer));

  function step() {
    const now = performance.now() / 1000;
    let jump = false, emote = 0;
    if (now > me.until) {
      // a new idea: mostly somewhere to go, sometimes someone to bump, sometimes a wave or a dance on the spot
      const r = Math.random(), others = (me.cans ?? []).filter(p => p.id !== me.id);
      me.chase = null;
      me.still = false;
      if (r < 0.3 && others.length) me.chase = others[Math.floor(Math.random() * others.length)].id;
      else if (r < 0.47) {
        emote = r < 0.4 ? 1 : 2;
        me.still = true;
      } else me.target = wander();
      me.until = now + 2 + Math.random() * 4;
      const text = LINES[Math.floor(Math.random() * LINES.length)];
      if (Math.random() < 0.15) ws.send(JSON.stringify({ t: 'chat', text }));
    }
    if (Math.random() < 0.01) jump = true;
    let x = 0, z = 0;
    const chased = me.chase && me.cans?.find(p => p.id === me.chase);
    const goal = chased ? chased.can : me.still ? null : me.target;
    if (goal) {
      const dx = goal.x - me.x, dz = goal.z - me.z, d = Math.hypot(dx, dz);
      if (d > 0.4) { x = dx / d; z = dz / d; } else if (!chased) me.until = 0;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeInput({ seq: me.seq = (me.seq + 1) & 0xffff, x, z, jump, emote }));
    }
  }
  return ws;
}

function wander() {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (PLAZA.radius - 1.5);
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

const bots = Array.from({ length: count }, (_, i) => bot(i));
console.log(`${count} bots to ${url}`);
process.on('SIGINT', () => {
  for (const ws of bots) ws.close(1000, 'home time');
  setTimeout(() => process.exit(0), 300);
});
