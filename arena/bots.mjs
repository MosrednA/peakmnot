// Cans that aren't people, to fill the room while testing: each wanders the plaza, now and then runs at someone to
// bump them, jumps, waves, dances and says something (brain.mjs, as the room's own bots do). They come in over the
// line, as people do, so they count as people: the room's own bots make way for them. `node bots.mjs [count]
// [ws://host:port/arena/ws]`; Ctrl+C takes them home.
import WebSocket from 'ws';
import { TICK } from '../peak/arena/sim.js';
import { PATH, encodeInput, decodeSnapshot, kindOf, KIND } from '../peak/arena/protocol.js';
import { NAMES, brain } from './brain.mjs';

const count = Number(process.argv[2] ?? 4);
const url = process.argv[3] ?? `ws://127.0.0.1:${process.env.PORT ?? 5298}${PATH}`;

function bot(i) {
  const ws = new WebSocket(url, { origin: 'http://127.0.0.1' });
  ws.binaryType = 'arraybuffer';
  const me = { id: null, seq: 0, mind: brain(), cans: [], timer: null };
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
    if (kindOf(data) === KIND.snapshot) me.cans = decodeSnapshot(data).players;
  });
  ws.on('close', () => clearInterval(me.timer));

  function step() {
    const mine = me.cans.find(p => p.id === me.id);
    if (!mine || ws.readyState !== WebSocket.OPEN) return;
    const { input, say } = me.mind.step(mine, me.cans);
    if (say) ws.send(JSON.stringify({ t: 'chat', text: say }));
    ws.send(encodeInput({ seq: me.seq = (me.seq + 1) & 0xffff, ...input }));
  }
  return ws;
}

const bots = Array.from({ length: count }, (_, i) => bot(i));
console.log(`${count} bots to ${url}`);
process.on('SIGINT', () => {
  for (const ws of bots) ws.close(1000, 'home time');
  setTimeout(() => process.exit(0), 300);
});
