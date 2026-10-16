// The arena: a snowy plaza on the mountain where everyone who opens the page meets as a can, up to twelve at a
// time (sim.js MAX_PLAYERS). Fill in a name and you're in: walk, jump, wave, dance, chat, and bump into each other.
// The room lives on the server (arena/server.mjs, room.mjs), which decides where everyone is. This page runs its own
// can ahead of it on the same rules (sim.js), so the keys answer at once, and puts it right when the server's
// snapshot says otherwise; everyone else is drawn a few steps behind, smoothly between two snapshots.
// ?server=host:port picks the room server; ?lag=ms plays as if it were far away (net.js).
import * as THREE from 'three';
import { MnotSounds } from '../../sounds.js';
import { buildScenery } from '../look/scenery.js';
import { time as shaderTime } from '../look/materials.js';
import { bursts } from '../look/bursts.js';
import { createStage } from '../kit/stage.js';
import { warmUp } from '../kit/warmup.js';
import { startLoop, expose } from '../kit/loop.js';
import { toaster, soundSwitch, pop } from '../kit/hud.js';
import { GamepadInput, BUTTON } from '../kit/gamepad.js';
import { TICK, EMOTE, MAX_PLAYERS, spawn, stepCan, collide, keepIn, copy } from './sim.js';
import { asSent, after } from './protocol.js';
import { Net, serverUrl } from './net.js';
import { Cans, COLORS } from './cans.js';
import { buildPlaza } from './plaza.js';
import { ArenaMusic } from './music.js';
import { ArenaSfx } from './sfx.js';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');
const BEHIND = 3;                                 // steps the others are drawn behind the newest snapshot (100 ms)
const VIEW = { up: 4.4, back: 7.4, ahead: 0.8, ease: 5 };   // the camera over the shoulder of your can (m, 1/s)
const NAME_KEY = 'mnot-arena-name';

const stage = createStage({ manual, fov: 50, fog: [60, 420], shadow: { half: 14, far: 70, back: 40 } });
const { renderer, scene, camera, post, render } = stage;
const scenery = buildScenery(scene, new THREE.Vector3(0, 0, 0));
buildPlaza(scene);
const world = { group: new THREE.Group(), animated: [], ground: () => ({ top: 0 }) };
world.group.name = 'puffs';
scene.add(world.group);
const puffs = bursts(world);
const sounds = new MnotSounds({ effects: ['walk-1', 'walk-2', 'walk-3', 'run-1', 'run-2', 'jump', 'land-soft',
  'wave'] });
const music = new ArenaMusic(sounds);
const sfx = new ArenaSfx(sounds, music);

const $ = id => document.getElementById(id);
const cans = new Cans(scene, $('tags'));
const mnot = await cans.load();

// ------------------------------------------------------------------ the room, as this page knows it

const net = new Net(serverUrl(location), { lag: Number(params.get('lag')) || 0 });
const room = { max: MAX_PLAYERS, players: new Map(), connected: false };
let me = null;                                    // { id, name, color, can, prev, pending, seq, offset } while in
let wanted = null;                                // the name to join again with when the line comes back
let reconnecting = false;
const snaps = [];                                 // the last snapshots: { tick (counting on), cans: Map id → can }
const shown = new Map();                          // the others as drawn this frame (sim.js fields), by id
let clockTick = 0, lastRaw = null, tickCount = 0;

net.on('open', () => { room.connected = true; showJoin(); });
net.on('close', ({ was }) => {
  sfx.update({ reel: 0, dance: 0 });
  if (was) { reconnecting = true; sfx.cue('lost', 0); }
  room.connected = false;
  if (me) wanted = me.name;
  me = null;
  room.players.clear();
  cans.clear();
  shown.clear();
  snaps.length = 0;
  if (was) toast('Line lost', 'Back in a moment…', 'oops');
  showJoin();
});
net.on('hello', m => {
  room.max = m.max;
  lastRaw = null;
  for (const p of m.players) addPlayer(p);
  if (wanted) join(wanted);
  showJoin();
});
net.on('joined', m => {
  sfx.cue(reconnecting ? 'back' : 'join-self', 0);
  reconnecting = false;
  me = { id: m.id, name: m.name, color: 0, can: null, prev: null, pending: [], seq: 0,
    offset: new THREE.Vector3() };
  wanted = null;
  try { localStorage.setItem(NAME_KEY, m.name); } catch { /* a private window */ }
  showJoin();
  toast(`Hi, ${m.name}!`, 'Walk over and say hello. Bumping is allowed.');
});
net.on('add', p => {
  addPlayer(p);
  if (me && p.id === me.id) {
    me.color = p.color;
    me.can = spawn(p.color);
    me.prev = copy(me.can);
  } else {
    sfx.cue('join', distanceTo(spawn(p.color)));
    line(null, `${p.name} came in.`);
  }
  showJoin();
});
net.on('remove', ({ id, why }) => {
  const p = room.players.get(id);
  // Measure before removing its last drawn position. My own idle message has its own cue.
  if (why !== 'idle' || id !== me?.id) sfx.cue(why === 'idle' ? 'idle' : 'leave', distanceOf(id));
  if (id === me?.id) sfx.update({ reel: 0, dance: 0 });
  room.players.delete(id);
  cans.remove(id);
  shown.delete(id);
  if (me && id === me.id) me = null;
  else if (p) line(null, `${p.name} ${why === 'idle' ? 'dozed off' : why === 'room' ? 'made room' : 'left'}.`);
  showJoin();
});
net.on('full', () => {
  sfx.cue('full', 0);
  wanted = null;
  $('join-note').textContent = `Full: ${room.max} cans already. A spot frees up soon.`;
  showJoin();
});
net.on('chat', ({ id, text }) => {
  const p = room.players.get(id);
  if (!p) return;
  sfx.cue(id === me?.id ? 'chat-self' : 'chat', distanceOf(id));
  cans.say(id, text);
  line(p, text);
});
net.on('slow', () => {
  sfx.cue('slow', 0);
  toast('', 'Easy on the chat: one line every second and a half.');
});
net.on('idle', () => {
  sfx.cue('idle', 0);
  $('join-note').textContent = 'Five minutes without a step: back to watching. Join again any time.';
});
net.on('snapshot', snap => {
  const tick = unwrap(snap.tick);
  snaps.push({ tick, cans: new Map(snap.players.map(p => [p.id, p.can])) });
  while (snaps.length > 30) snaps.shift();
  if (Math.abs(tick - clockTick) > 6) clockTick = tick;
  else clockTick += (tick - clockTick) * 0.08;
  const mine = me && snap.players.find(p => p.id === me.id);
  if (mine && me.can) reconcile(mine);
});

// the server's step number as one that keeps counting (it goes round at 65536)
function unwrap(raw) {
  tickCount = lastRaw === null ? raw : tickCount + (((raw - lastRaw + 0x8000) & 0xffff) - 0x8000);
  lastRaw = raw;
  return tickCount;
}

function addPlayer(p) {
  room.players.set(p.id, p);
  if (!cans.list.has(p.id)) cans.add(p, !!me && p.id === me.id);
}

// Without my can there is no world listener. Network messages use the last drawn position.
function distanceTo(at) {
  return me?.can && at ? Math.hypot(at.x-me.can.x, at.z-me.can.z) : Infinity;
}
function distanceOf(id) { return id === me?.id ? 0 : distanceTo(shown.get(id)); }

function join(name) {
  if (!room.connected || me) return;
  net.send({ t: 'join', name });
}

// ------------------------------------------------------------------ my can, run ahead of the server

let ahead = 0;                                    // s since the last step of my can
const latched = { jump: false, emote: 0 };       // presses waiting for the next step

function myStep() {
  const want = readInput();
  const input = asSent({ seq: me.seq = (me.seq + 1) & 0xffff, ...want, jump: latched.jump, emote: latched.emote });
  latched.jump = false;
  latched.emote = 0;
  net.sendInput(input);
  me.pending.push(input);
  if (me.pending.length > 90) me.pending.shift();
  me.prev = copy(me.can);
  simulate(me.can, input);
}

// one step of my can as the server will take it, against the others where they're drawn
const _others = [];
function simulate(can, input) {
  stepCan(can, input, TICK);
  _others.length = 0;
  _others.push(can);
  for (const s of shown.values()) _others.push(s);
  collide(_others, can);
  keepIn(can);
}

// The server's word on my can: from there, my inputs it hasn't had yet again. Where it lands differs a little from
// where I was (mostly not at all); the step being drawn moves by that difference as a whole, and the difference
// eases out on screen (offset) instead of jumping. (Close to the server it may have had all my inputs already: the
// step being drawn still runs to its end.)
function reconcile({ ack, can }) {
  me.pending = me.pending.filter(i => after(i.seq, ack));
  const state = { ...can };
  for (const input of me.pending) simulate(state, input);
  const was = me.can, prev = me.prev, dx = state.x - was.x, dz = state.z - was.z;
  me.offset.x -= dx;
  me.offset.z -= dz;
  me.can = state;
  me.prev = { ...prev, x: prev.x + dx, z: prev.z + dz, y: Math.max(0, prev.y + state.y - was.y),
    yaw: prev.yaw + wrap(state.yaw - was.yaw) };
  if (me.offset.length() > 2) {                   // far off (a long stall): just go there
    me.offset.set(0, 0, 0);
    me.prev = copy(state);
  }
}

// ------------------------------------------------------------------ the controls

const keys = new Set();
const typing = () => document.activeElement === $('chat-text') || document.activeElement === $('join-name');
addEventListener('keydown', e => {
  if (typing()) return;
  if (e.code === 'Enter' && me) { openChat(); e.preventDefault(); return; }
  keys.add(e.code);
  if (e.repeat || !me) return;
  if (e.code === 'Space') { latched.jump = true; e.preventDefault(); }
  if (e.code === 'KeyE') latched.emote = EMOTE.wave;
  if (e.code === 'KeyQ') latched.emote = EMOTE.dance;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const held = (...codes) => codes.some(c => keys.has(c) || padKeys.has(c));

// a controller: the stick walks (as far as it's pushed), A jumps, X waves, Y dances
const pad = new GamepadInput();
const padKeys = new Set();
function readPad() {
  pad.poll();
  padKeys.clear();
  if (!pad.connected || !me) return;
  pad.keys(padKeys);
  if (pad.fresh.has(BUTTON.a)) latched.jump = true;
  if (pad.fresh.has(BUTTON.x)) latched.emote = EMOTE.wave;
  if (pad.fresh.has(BUTTON.y)) latched.emote = EMOTE.dance;
  if (pad.fresh.has(BUTTON.view)) $('sound').click();
}

// a thumb: drag on the left half to walk, tap the right half to jump
const touch = { id: null, x0: 0, y0: 0, x: 0, z: 0 };
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !me) return;
  if (e.clientX > innerWidth / 2) { latched.jump = true; return; }
  Object.assign(touch, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, z: 0 });
});
addEventListener('pointermove', e => {
  if (e.pointerId !== touch.id) return;
  const dx = (e.clientX - touch.x0) / 60, dy = (e.clientY - touch.y0) / 60, m = Math.max(1, Math.hypot(dx, dy));
  touch.x = -dx / m;
  touch.z = -dy / m;
});
for (const type of ['pointerup', 'pointercancel']) {
  addEventListener(type, e => { if (e.pointerId === touch.id) Object.assign(touch, { id: null, x: 0, z: 0 }); });
}

// The stick on the snow: { x, z }, up to 1 long. The camera looks along +z, so W is +z and A is +x. A test can
// hold it with arena.drive(x, z) (and let go with arena.drive(null)).
let driven = null;
function readInput() {
  if (driven) return driven;
  if (touch.id !== null) return { x: touch.x, z: touch.z };
  if (pad.connected && pad.stick.push > 0) {
    const { x, y, push } = pad.stick, m = Math.hypot(x, y);
    return { x: -x / m * push, z: y / m * push };
  }
  if (typing()) return { x: 0, z: 0 };
  let x = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0);
  let z = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
  const m = Math.hypot(x, z) / (held('ShiftLeft', 'ShiftRight') ? 0.35 : 1);
  if (m) { x /= m; z /= m; }
  return { x, z };
}

// ------------------------------------------------------------------ the HUD: joining, chat, the buttons

const toast = toaster($('toast'));
soundSwitch(sounds, $('sound'));

function showJoin() {
  // the people: the bots that keep a lone visitor company make room for them
  const card = $('join'), button = $('join-go'), count = [...room.players.values()].filter(p => !p.bot).length;
  const bots = room.players.size - count;
  $('count').textContent = `${count}/${room.max}`;
  $('ping').textContent = net.rtt === null ? '' : ` · ${Math.round(net.rtt)} ms`;
  document.body.classList.toggle('in', !!me);
  if (me) { card.hidden = true; return; }
  if (card.hidden) {
    pop(card);
    try { $('join-name').value ||= localStorage.getItem(NAME_KEY) ?? ''; } catch { /* a private window */ }
  }
  const full = count >= room.max;
  button.disabled = !room.connected || full || !!wanted;
  $('join-status').textContent = !room.connected ? 'Finding the plaza…'
    : full ? `Full: ${count} of ${room.max} cans. Watch for a moment, a spot frees up.`
      : count === 0 ? `${bots ? 'Only bots here so far' : 'Nobody here yet'}. Be the first can on the plaza.`
        : `${count} of ${room.max} cans on the plaza${bots ? `, and ${bots === 1 ? 'a bot' : `${bots} bots`}` : ''}.`;
}
$('join-form').addEventListener('submit', e => {
  e.preventDefault();
  $('join-note').textContent = '';
  join($('join-name').value);
  $('join-name').blur();
});

$('leave').addEventListener('click', () => {
  if (!me) return;
  net.send({ t: 'leave' });
  $('leave').blur();
});

function openChat() {
  $('chat-form').hidden = false;
  $('chat-text').focus();
}
$('chat-open').addEventListener('click', () => (me ? openChat() : null));
$('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  if (text && me) net.send({ t: 'chat', text });
  $('chat-text').value = '';
  $('chat-text').blur();
});
$('chat-text').addEventListener('blur', () => { $('chat-form').hidden = true; });
$('chat-text').addEventListener('keydown', e => { if (e.code === 'Escape') $('chat-text').blur(); });
for (const [id, emote] of [['wave', EMOTE.wave], ['dance', EMOTE.dance]]) {
  $(id).addEventListener('click', () => { latched.emote = emote; $(id).blur(); });
}
$('jump').addEventListener('click', () => { latched.jump = true; $('jump').blur(); });

// the chat's last few lines, bottom left: who (in their can's colour) and what; and who came and went
function line(player, text) {
  const row = document.createElement('div');
  if (player) {
    const who = document.createElement('b'), color = COLORS[player.color % COLORS.length];
    who.textContent = player.name;
    // a light can's name (yellow, sky, silver) can't be read on the cream: in ink, underlined in its colour, as its tag
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.65) {
      who.className = 'light';
      who.style.setProperty('--can', color);
    } else who.style.color = color;
    row.append(who, document.createTextNode(` ${text}`));
  } else {
    row.className = 'note';
    row.textContent = text;
  }
  const log = $('log');
  log.append(row);
  while (log.children.length > 7) log.firstChild.remove();
  setTimeout(() => row.classList.add('old'), 20000);
}

// ------------------------------------------------------------------ the camera

const look = new THREE.Vector3(0, 0.6, 0), _seat = new THREE.Vector3(), _look = new THREE.Vector3();
let orbit = 0;
function placeCamera(dt, at) {
  if (at) {
    _seat.set(at.x, at.y * 0.4 + VIEW.up, at.z - VIEW.back);
    _look.set(at.x, 0.7 + at.y * 0.4, at.z + VIEW.ahead);
  } else {                                        // watching: slowly round the plaza
    orbit += dt * 0.06;
    _seat.set(Math.sin(orbit) * 15, 7.5, -Math.cos(orbit) * 15);
    _look.set(0, 0.4, 0);
  }
  const k = 1 - Math.exp(-VIEW.ease * dt);
  camera.position.lerp(_seat, k);
  look.lerp(_look, k);
  camera.lookAt(look);
}

// ------------------------------------------------------------------ the loop

let time = 0;
const _mine = {};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// the others between the two snapshots either side of BEHIND steps ago
function interpolate() {
  shown.clear();
  if (!snaps.length) return;
  const at = clockTick - BEHIND;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].tick > at) i--;
  const a = snaps[Math.max(0, i - 1)], b = snaps[i];
  const t = b.tick > a.tick ? THREE.MathUtils.clamp((at - a.tick) / (b.tick - a.tick), 0, 1) : 1;
  for (const [id, sb] of b.cans) {
    if (me && id === me.id) continue;
    const sa = a.cans.get(id) ?? sb;
    shown.set(id, { ...sb, x: sa.x + (sb.x - sa.x) * t, z: sa.z + (sb.z - sa.z) * t, y: sa.y + (sb.y - sa.y) * t,
      vx: sa.vx + (sb.vx - sa.vx) * t, vz: sa.vz + (sb.vz - sa.vz) * t, yaw: sa.yaw + wrap(sb.yaw - sa.yaw) * t,
      ground: t < 0.5 ? sa.ground : sb.ground, daze: Math.max(sa.daze, sb.daze) });
  }
}

// The room keeps the server's time: the frame's own (its time on the screen, so my can moves as evenly as the
// frames come), but a slow frame, which the loop steps by at most 50 ms, moves my can and the others' clock on by
// all the time that went by.
const frameTime = () => document.timeline?.currentTime ?? performance.now();   // the frame's, in a frame
let lastReal = frameTime();
function step(dt) {
  if (!(dt > 0)) return;
  sfx.beginFrame();
  time += dt;
  shaderTime.value = time;
  const now = frameTime(), real = dt < 0.05 ? dt : Math.min(0.25, Math.max(dt, (now - lastReal) / 1000));
  lastReal = now;
  readPad();
  clockTick += real / TICK;
  interpolate();
  // my can: whole steps on the server's clock, drawn between the last two, plus what's left of a correction
  let mine = null;
  if (me?.can) {
    ahead += real;
    for (let n = 0; ahead >= TICK && n < 8; n++) {
      ahead -= TICK;
      myStep();
    }
    ahead = Math.min(ahead, TICK);
    const t = ahead / TICK, p = me.prev, c = me.can;
    me.offset.multiplyScalar(Math.exp(-10 * dt));
    mine = Object.assign(_mine, c, { x: p.x + (c.x - p.x) * t + me.offset.x, z: p.z + (c.z - p.z) * t + me.offset.z,
      y: p.y + (c.y - p.y) * t, yaw: p.yaw + wrap(c.yaw - p.yaw) * t });
  } else ahead = 0;
  // every can posed, with its jumps, landings and bumps heard and seen
  const audioMotion = { reel: 0, dance: 0 };
  for (const can of cans.list.values()) {
    const s = can.mine ? mine : shown.get(can.id);
    if (!s) { can.root.visible = false; continue; }
    can.root.visible = true;
    const events = cans.pose(can, s, dt);
    const distance = mine ? Math.hypot(s.x - mine.x, s.z - mine.z) : Infinity;
    const level = sfx.level(distance);
    if (s.daze > 0) audioMotion.reel = Math.max(audioMotion.reel, level);
    if (s.emote === EMOTE.dance && s.daze <= 0 && s.ground) {
      audioMotion.dance = Math.max(audioMotion.dance, level);
    }
    for (const e of events) {
      if (e === 'bump') {
        puffs.snow(can.root.position, { puffs: 7, flakes: 12, up: 1.2 });
        sfx.cue('bump', distance);
        if (can.mine) pad.rumble('bump');
      } else if (e === 'land') puffs.snow(can.root.position, { puffs: 3, flakes: 4, size: 0.6, up: 0.5 });
      if (!can.mine) continue;
      if (e === 'jump') sounds.play('jump');
      if (e === 'land') sounds.play('land-soft');
    }
    if (can.mine) {
      const gait = can.animator.footstep();
      if (gait) sounds.step(gait);
      if (s.emote === EMOTE.wave && can.waved !== true) sounds.play('wave');
      can.waved = s.emote === EMOTE.wave;
    }
  }
  sfx.update(audioMotion);
  puffs.update(dt);
  placeCamera(dt, mine);
  cans.place(camera, innerWidth, innerHeight);
  stage.aimSun(mine ?? look);
  scenery.update(camera, time);
  toast.update(dt);
}

camera.position.set(0, 7.5, -15);
step(1 / 60);
// every shader built before the first frame: Mnot's own copy stands in for the cans. Twice, because three.js draws the
// shadows before it counts the lights, so the first frame builds the cans' shadow for no light at all, and the first
// can that comes in would build it again (a hitch)
scene.add(mnot.root);
warmUp(scene, render);
warmUp(scene, render);
scene.remove(mnot.root);
render();
startLoop({ manual, post, step, render });
setInterval(showJoin, 1000);
showJoin();

// for debugging and tests
expose('arena', { THREE, renderer, scene, camera, net, room, cans, snaps, shown, sounds, music, sfx, pad, puffs, join, latched,
  keys, get me() { return me; }, drive(x, z) { driven = x === null ? null : { x, z }; } }, { step, render });
