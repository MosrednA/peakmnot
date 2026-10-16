// The room's rules, without sockets: `npm test` in arena/ (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, LIMITS } from './room.mjs';
import { cleanName, cleanChat } from './words.mjs';
import { TICK, MAX_PLAYERS, BUMP, PLAZA, BODY, MOVE, spawn, stepCan, keepIn, copy } from '../peak/arena/sim.js';
import { encodeInput, decodeInput, asSent, after, encodeSnapshot, decodeSnapshot, kindOf, KIND }
  from '../peak/arena/protocol.js';

// A connection as the room sees it, keeping what it was sent.
function fake() {
  const client = { text: [], binary: [], closed: null };
  client.send = data => (typeof data === 'string' ? client.text.push(JSON.parse(data)) : client.binary.push(data));
  client.close = (code, why) => { client.closed = [code, why]; };
  client.last = t => client.text.filter(m => m.t === t).at(-1);
  return client;
}

function setup(n = 0, options) {
  let now = 0;
  const room = new Room({ clock: () => now, ...options });
  const people = [];
  for (let i = 0; i < n; i++) {
    const client = fake(), session = room.open(client);
    room.receive(session, JSON.stringify({ t: 'join', name: `Can ${i + 1}` }), false);
    people.push({ client, session, player: session.player });
  }
  return { room, people, wait: s => { now += s; } };
}

const send = (room, session, input) => room.receive(session, Buffer.from(encodeInput(input)), true);

test('a visitor watches first and hears who is in', () => {
  const { room } = setup(2);
  const client = fake();
  room.open(client);
  const hello = client.last('hello');
  assert.equal(hello.max, MAX_PLAYERS);
  assert.deepEqual(hello.players.map(p => p.name), ['Can 1', 'Can 2']);
  assert.equal(room.playing, 2);
  assert.equal(room.watching, 1);
});

test('joining gives a can, tells everyone, and twelve is full', () => {
  const { room, people } = setup(MAX_PLAYERS);
  assert.equal(room.playing, 12);
  assert.equal(people[0].client.text.filter(m => m.t === 'add').length, 12);
  assert.deepEqual(new Set(people.map(p => p.player.color)).size, 12);
  const late = fake(), session = room.open(late);
  room.receive(session, JSON.stringify({ t: 'join', name: 'Thirteen' }), false);
  assert.deepEqual(late.last('full'), { t: 'full', max: 12 });
  assert.equal(session.player, null);
  // one leaves, the thirteenth gets in, with the colour that came free
  const color = people[4].player.color;
  room.close(people[4].session);
  assert.equal(people[0].client.last('remove').id, people[4].player.id);
  room.receive(session, JSON.stringify({ t: 'join', name: 'Thirteen' }), false);
  assert.equal(late.last('joined').name, 'Thirteen');
  assert.equal(session.player.color, color);
});

test('names are tidy, polite and one of a kind', () => {
  assert.equal(cleanName('  Mnot  \u0007 fan  '), 'Mnot fan');
  assert.equal(cleanName('a'.repeat(40)).length, 16);
  assert.equal(cleanName('<b>hi</b>'), 'bhib');
  assert.match(cleanName(''), /^Can #\d{4}$/);
  assert.match(cleanName('fuck'), /^Mystery Can #\d{4}$/);
  assert.match(cleanName('Sh1t head'), /^Mystery Can #\d{4}$/);
  assert.equal(cleanName('Bass'), 'Bass');
  assert.equal(cleanName('Zoë 🥤'), 'Zoë 🥤');
  const { room, people } = setup(1);
  const client = fake(), session = room.open(client);
  room.receive(session, JSON.stringify({ t: 'join', name: 'CAN 1' }), false);
  assert.equal(client.last('joined').name, 'CAN 1 2');
  assert.equal(people[0].player.name, 'Can 1');
});

test('chat goes to everyone, fizzed, a few lines at a time', () => {
  const { room, people, wait } = setup(2);
  const [a, b] = people;
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'hallo   allemaal' }), false);
  assert.deepEqual(b.client.last('chat'), { t: 'chat', id: a.player.id, text: 'hallo allemaal' });
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'what the fuck' }), false);
  assert.equal(b.client.last('chat').text, 'what the *fizz*');
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'three' }), false);
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'four' }), false);
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'five' }), false);
  assert.equal(b.client.last('chat').text, 'four');
  assert.ok(a.client.last('slow'));
  wait(LIMITS.chat.every);
  room.receive(a.session, JSON.stringify({ t: 'chat', text: 'six' }), false);
  assert.equal(b.client.last('chat').text, 'six');
  // watchers only read
  const watcher = fake(), session = room.open(watcher);
  room.receive(session, JSON.stringify({ t: 'chat', text: 'psst' }), false);
  assert.equal(b.client.last('chat').text, 'six');
});

test('nonsense is ignored', () => {
  const { room, people } = setup(1);
  const { session, client } = people[0];
  for (const bad of ['{', 'null', '42', '"join"', JSON.stringify({ t: 'what' })]) room.receive(session, bad, false);
  room.receive(session, Buffer.from([KIND.input, 0, 1]), true);
  room.receive(session, Buffer.from([9, 9, 9, 9, 9, 9]), true);
  room.receive(session, Buffer.alloc(0), true);
  room.tick();
  assert.equal(session.player.queue.length, 0);
  assert.equal(client.text.filter(m => m.t === 'chat').length, 0);
});

test('the stick walks the can, and the snapshot says so', () => {
  const { room, people } = setup(1);
  const { session, client, player } = people[0];
  const start = copy(player.can);
  for (let seq = 1; seq <= 30; seq++) {
    send(room, session, { seq, x: 0, z: -1, jump: false, emote: 0 });
    room.tick();
  }
  assert.ok(player.can.z < start.z - 2, `walked to the middle: ${player.can.z}`);
  const snap = decodeSnapshot(client.binary.at(-1));
  assert.equal(snap.tick, 30);
  assert.equal(snap.players[0].id, player.id);
  assert.equal(snap.players[0].ack, 30);
  assert.ok(Math.abs(snap.players[0].can.z - player.can.z) < 0.001);
});

test('a can waits a moment for a late input, catches up, and goes on without a page that stopped', () => {
  const { room, people } = setup(1);
  const { session, player } = people[0];
  send(room, session, { seq: 1, x: 1, z: 0, jump: true, emote: 0 });
  room.tick();
  assert.equal(player.can.ground, false);
  const held = copy(player.can);
  room.tick();
  assert.deepEqual(player.can, held, 'waiting where it was');
  send(room, session, { seq: 2, x: 1, z: 0, jump: false, emote: 0 });
  send(room, session, { seq: 3, x: 1, z: 0, jump: false, emote: 0 });
  send(room, session, { seq: 4, x: 1, z: 0, jump: false, emote: 0 });
  room.tick();
  assert.equal(player.ack, 3, 'two at once');
  room.tick();
  assert.equal(player.ack, 4);
  for (let i = 0; i < LIMITS.stale; i++) room.tick();
  assert.equal(player.can.ground, false, 'still waiting, in the air');
  for (let i = 0; i < 40; i++) room.tick();
  assert.ok(Math.hypot(player.can.vx, player.can.vz) < 0.05, 'stood still');
  assert.equal(player.can.ground, true);
});

test('a burst after a hiccup is caught up, but sending more never makes a can faster', () => {
  const { room, people } = setup(1);
  const { session, player } = people[0];
  for (let i = 0; i < 5; i++) room.tick();       // the page stalled: the can waited, and saved up
  for (let seq = 1; seq <= 6; seq++) send(room, session, { seq, x: 1, z: 0, jump: false, emote: 0 });
  room.tick();
  assert.equal(player.ack, 6, 'all caught up in one step');
  // a page sending three times too many: a step each, and the rest waits (then goes, its presses kept)
  let seq = 6;
  const x0 = player.can.x;
  send(room, session, { seq: ++seq, x: 0, z: 0, jump: true, emote: 0 });
  let jumped = false;
  for (let i = 0; i < 20; i++) {
    for (let k = 0; k < 3; k++) send(room, session, { seq: ++seq, x: 1, z: 0, jump: false, emote: 0 });
    room.tick();
    jumped ||= !player.can.ground;
  }
  const most = MOVE.run * TICK * 20;
  assert.ok(Math.abs(player.can.x - x0) <= most, `no faster than a step a step: ${player.can.x - x0} m`);
  assert.ok(player.queue.length <= LIMITS.queue);
  assert.ok(jumped, 'the jump went through');
});

test('waving and dancing, and walking off stops them', () => {
  const { room, people } = setup(1);
  const { session, player } = people[0];
  send(room, session, { seq: 1, x: 0, z: 0, jump: false, emote: 1 });
  room.tick();
  assert.equal(player.can.emote, 1);
  for (let i = 0; i < 80; i++) room.tick();
  assert.equal(player.can.emote, 0, 'a wave ends');
  send(room, session, { seq: 2, x: 0, z: 0, jump: false, emote: 2 });
  for (let i = 0; i < 80; i++) room.tick();
  assert.equal(player.can.emote, 2, 'a dance goes on');
  send(room, session, { seq: 3, x: 1, z: 0, jump: false, emote: 0 });
  room.tick();
  assert.equal(player.can.emote, 0);
});

test('two cans running into each other bounce and reel', () => {
  const { room, people } = setup(2);
  const [a, b] = people;
  Object.assign(a.player.can, spawn(0), { id: a.player.id, x: -2, z: 0 });
  Object.assign(b.player.can, spawn(0), { id: b.player.id, x: 2, z: 0 });
  let met = false;
  for (let seq = 1; seq <= 45 && !met; seq++) {
    send(room, a.session, { seq, x: 1, z: 0, jump: false, emote: 0 });
    send(room, b.session, { seq, x: -1, z: 0, jump: false, emote: 0 });
    room.tick();
    met = a.player.can.bumps > 0;
  }
  assert.ok(met, 'they bumped');
  assert.equal(b.player.can.bumps, 1);
  assert.ok(a.player.can.vx < 0 && b.player.can.vx > 0, 'apart');
  assert.ok(a.player.can.daze > 0 && !a.player.can.ground, 'reeling, with a hop');
  assert.ok(b.player.can.x - a.player.can.x >= BODY * 2 - 1e-9, 'not inside each other');
  // a soft push doesn't make anyone reel
  const { room: calm, people: [c, d] } = setup(2);
  Object.assign(c.player.can, { x: -0.5, z: 0, vx: 0.4, vz: 0 });
  Object.assign(d.player.can, { x: 0.2, z: 0, vx: 0, vz: 0 });
  calm.tick();
  assert.equal(c.player.can.bumps + d.player.can.bumps, 0);
  assert.ok(BUMP.hard > 0.4);
});

test('the snow wall and the snowmen keep everyone on the plaza', () => {
  const can = spawn(0);
  for (let i = 0; i < 300; i++) stepCan(can, { x: 0.3, z: 1, jump: false, emote: 0 });
  assert.ok(Math.hypot(can.x, can.z) <= PLAZA.radius - BODY + 1e-9);
  const stuck = { ...spawn(0), x: -4.6, z: 3.2 };
  keepIn(stuck);
  assert.ok(Math.hypot(stuck.x + 4.6, stuck.z - 3.2) >= 0.55 + BODY - 1e-9);
});

test('nobody walks for five minutes: back to watching', () => {
  const { room, people, wait } = setup(2);
  const [a, b] = people;
  wait(LIMITS.idle - 1);
  send(room, b.session, { seq: 1, x: 1, z: 0, jump: false, emote: 0 });
  room.tick();
  wait(2);
  room.tick();
  assert.ok(a.client.last('idle'));
  assert.equal(a.session.player, null);
  assert.equal(b.client.last('remove').why, 'idle');
  assert.equal(room.playing, 1);
});

test('the inputs and snapshots survive the wire', () => {
  const input = { seq: 65535, x: -0.5, z: 1, jump: true, emote: 2 };
  const back = decodeInput(encodeInput(input));
  assert.equal(back.seq, 65535);
  assert.ok(Math.abs(back.x + 0.5) < 0.01);
  assert.deepEqual([back.z, back.jump, back.emote], [1, true, 2]);
  assert.equal(kindOf(encodeInput(input)), KIND.input);
  assert.equal(decodeInput(new ArrayBuffer(5)), null);
  assert.deepEqual(asSent(back), back);
  assert.ok(after(0, 65535) && after(5, 2) && !after(2, 5) && !after(7, 7));
  const can = { ...spawn(3), y: 0.4, vy: -1.2, daze: 0.5, emote: 1, emoteT: 1.7, bumps: 300, ground: false };
  const snap = decodeSnapshot(Buffer.from(encodeSnapshot(70000, [{ id: 7, can, ack: 65536 + 4 }])));
  assert.equal(snap.tick, 70000 & 0xffff);
  const got = snap.players[0];
  assert.deepEqual([got.id, got.ack, got.can.bumps, got.can.emote, got.can.ground], [7, 4, 300 & 255, 1, false]);
  for (const k of ['x', 'z', 'y', 'vy', 'yaw']) assert.ok(Math.abs(got.can[k] - can[k]) < 0.001, k);
  assert.ok(Math.abs(got.can.daze - 0.5) < 0.01 && got.can.emoteT >= 1.7);
  assert.equal(decodeSnapshot(new ArrayBuffer(3)), null);
});

test('the page running its own can ahead lands where the server does', () => {
  // the page: its can from the last snapshot (as sent, to the mm), and its own inputs since then replayed
  const { room, people } = setup(1);
  const { session, client, player } = people[0];
  const inputs = [];
  for (let seq = 1; seq <= 60; seq++) {
    inputs.push(asSent({ seq, x: Math.sin(seq / 9), z: -0.7, jump: seq % 20 === 0, emote: 0 }));
  }
  for (const input of inputs.slice(0, 40)) {
    send(room, session, input);
    room.tick();
  }
  const snap = decodeSnapshot(client.binary.at(-1)).players[0];
  const mine = { ...snap.can };
  for (const input of inputs.filter(i => after(i.seq, snap.ack))) stepCan(mine, input, TICK);
  for (const input of inputs.slice(40)) {
    send(room, session, input);
    room.tick();
  }
  assert.ok(Math.hypot(mine.x - player.can.x, mine.z - player.can.z) < 0.01, 'same place');
});
