// An end-to-end check of the score server with a real climb (server/README.md, "Testing"). With the viewer on 5280
// and the score server on 5281, open http://127.0.0.1:5280/peak.html?keep=manual (a real game: the game's own
// ?manual never talks to the server, but any "manual" in the address stops the viewer's live reload, so another
// agent's save doesn't end the climb halfway) and run in the console:
//   const bot = await import('/server/browser_bot.js'); bot.keepFrames(); await bot.drive(peak, { name: 'Bot Can' })
// For a climb with falls: { stumble: ['ring'] } slides into the ring's hole once; numbers are game times at which
// it wanders off the path.
// It climbs like peak/bots.js's climb(), but in real time: between frames it presses and releases keys with real
// keyboard events, so the title screen, the game, the recorder (peak/replay.js) and scores.js get exactly what a
// player's keyboard gives them. At the summit it waits for the card, types the name (if given) and sends it.
// Not shipped (the Dockerfile leaves it out); nothing in the game imports it.
import * as THREE from 'three';

const PUSHES = [['KeyD'], ['KeyD', 'KeyW'], ['KeyD', 'KeyS'], ['KeyW'], ['KeyS'], ['KeyA'], ['KeyA', 'KeyW'],
  ['KeyA', 'KeyS']];
const sleep = t => new Promise(resolve => setTimeout(resolve, t));

function send(code, down) {
  dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code,
    bubbles: true, cancelable: true }));
}

// The steering below follows peak/bots.js's climb() (keysFor, onwards, counterSteer, ringSteer, exitPad); keep the
// two in step when a new obstacle needs a new trick.

// The keys that push most nearly along v (at least `most` of the way), or null when v is too small to bother.
function keysFor({ input }, v, most) {
  const length = v.length();
  if (length < 0.25 || !input.frame) return null;
  let best = null;
  for (const keys of PUSHES) {
    const fit = input.frame.direction(new Set(keys), new THREE.Vector3(), false).dot(v) / length;
    if (fit > most) [best, most] = [keys, fit];
  }
  return best;
}

// The key that means "onwards" right now: right on most shots, down where the camera looks from in front.
function onwards({ player, world, input }) {
  const dir = world.railAt(player.pos).dir;
  let best = { key: 'KeyD', dir: dir.clone(), fit: -Infinity };
  if (!input.frame) return best;
  for (const key of ['KeyD', 'KeyS', 'KeyW', 'KeyA']) {
    const d = input.frame.direction(new Set([key]), new THREE.Vector3(), false), fit = d.dot(dir);
    if (fit > best.fit + 1e-6) best = { key, dir: d, fit };
  }
  return best;
}

// On ice the keys only push: aim for a steady pace onwards and back towards the line, and push the difference.
function counterSteer(peak, want, onward, { pace = 2, line = 1.5 } = {}) {
  const { player, world, input } = peak, rail = world.railAt(player.pos);
  want.delete(onward);
  if (player.skate.meter > 0.55 || !input.frame) return;
  const off = THREE.MathUtils.clamp(line * rail.side, -0.8, 0.8);
  const back = new THREE.Vector3(rail.dir.z, 0, -rail.dir.x).multiplyScalar(off);
  const goal = rail.dir.clone().multiplyScalar(pace).add(back);
  for (const k of keysFor(peak, goal.sub(player.vel).setY(0), 0.5) ?? []) want.add(k);
}

// The ring of ice (peak/ring.js): round the hole the shorter way to the pad that leads on, slowly, carefully while
// the wobble meter is high.
const RING = { pace: 1.2, hold: 1.5, calm: 0.5 };
function ringSteer(peak, ring, exit, want, state) {
  const { player } = peak;
  const out = new THREE.Vector3(player.pos.x - ring.x, 0, player.pos.z - ring.z), r = out.length();
  out.divideScalar(r);
  if (!state.way) {
    const to = THREE.MathUtils.degToRad((exit.range[0] + exit.range[1]) / 2) - Math.atan2(out.z, out.x);
    state.way = Math.sin(to) >= 0 ? 1 : -1;
  }
  const goal = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(state.way * RING.pace)
    .addScaledVector(out, THREE.MathUtils.clamp(((ring.inner + ring.outer) / 2 - r) * RING.hold, -0.8, 0.8));
  const keys = player.icy ? keysFor(peak, goal.sub(player.vel).setY(0), 0.5) : keysFor(peak, goal, 0);
  for (const k of keys ?? []) want.add(k);
  if (!player.icy || player.skate.meter > RING.calm) want.add('ShiftLeft');
}

// The pad a ring is left by: the one the route goes on towards.
function exitPad(world, ring) {
  const dir = world.railAt(new THREE.Vector3(ring.x, ring.y, ring.z)).dir, rad = THREE.MathUtils.degToRad;
  const toward = ({ range: [a, b] }) => Math.cos(rad((a + b) / 2)) * dir.x + Math.sin(rad((a + b) / 2)) * dir.z;
  return ring.pads.reduce((best, pad) => toward(pad) > toward(best) ? pad : best);
}

// The keys a player would hold now: onwards, a jump at gaps and rises, round the ring, leaning back on beams `delay`
// s late. state: { seen: the leans on the current beam, way: which way round the current ring }.
function decide(peak, state, now, delay) {
  const { player, world, follow } = peak;
  const want = new Set(), seen = state.seen;
  if (player.mode === 'beam') {
    const b = player.balance;
    seen.push([now, b.lean + 0.2 * b.leanSpeed]);
    while (seen.length > 1 && seen[1][0] <= now - delay) seen.shift();
    const lean = seen[0][1];
    if (Math.abs(lean) > 0.06) {
      const f = follow.heading(player, world), right = new THREE.Vector3(-f.z, 0, f.x);
      want.add(-Math.sign(lean) * right.dot(b.beam.right) > 0 ? 'KeyD' : 'KeyA');
    }
    return want;
  }
  seen.length = 0;
  if (player.mode === 'ground' && world.hazards.some(h => h.wait?.(player.pos))) return want.add('ShiftLeft');
  const ring = player.mode === 'ground' && world.rings?.find(r => r.solids.includes(player.support));
  const exit = ring && exitPad(world, ring);
  if (ring && player.support !== exit.solid) {
    ringSteer(peak, ring, exit, want, state);
    return want;
  }
  state.way = null;
  const go = onwards(peak);
  want.add(go.key);
  if (player.icy && player.mode === 'ground') counterSteer(peak, want, go.key);
  if (player.mode === 'ground' && player.speed > 0.5) {
    // look ahead the way it's going; on ice, the way it wants to go (it slides round to that)
    const dir = player.icy ? go.dir : player.vel.clone().setY(0).normalize();
    const ahead = player.pos.clone().addScaledVector(dir, 0.32);
    const next = world.ground(ahead.x, ahead.z, player.pos.y + 0.6, 0);
    const wall = world.ground(ahead.x, ahead.z, Infinity, 0)?.top > player.pos.y + 0.6;
    const beam = world.beam(ahead.x, ahead.z, player.pos.y - 0.4, player.pos.y + 0.3, 0.6);
    if (!beam && !wall && (!next || next.top < player.pos.y - 0.3 || next.top > player.pos.y + 0.25)) want.add('Space');
  }
  return want;
}

// A stumble, for a climb with falls: at each game time in `stumble` it holds S ("towards the camera") for 1.5 s,
// off the path; 'ring' pushes into the hole the first time it's on the ring's ice, until it falls in.
function stumbling(peak, stumble, state) {
  const { player, world, game } = peak;
  if (stumble.some(t => typeof t === 'number' && game.time >= t && game.time < t + 1.5)) return new Set(['KeyS']);
  if (!stumble.includes('ring') || state.fell) return null;
  if (player.mode === 'out') {
    state.fell = !!state.pushing;
    return null;
  }
  if (!state.pushing && player.mode === 'ground' && player.icy) {
    state.pushing = world.rings?.find(r => r.solids.includes(player.support)) ?? null;
  }
  if (!state.pushing) return null;
  const ring = state.pushing;
  return new Set(keysFor(peak, new THREE.Vector3(ring.x - player.pos.x, 0, ring.z - player.pos.z), 0) ?? []);
}

// A browser pane that isn't focused may throttle animation frames to a few a second; this drives them from a
// message loop at about 60 a second instead, still in real time. Call it before drive() if the game crawls. A page
// out of sight also says it's hidden, and three's Timer (main.js) then stops the game's clock: it says visible.
export function keepFrames() {
  if (window.__keepFrames) return;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  const queue = [], channel = new MessageChannel();
  let last = performance.now();
  channel.port1.onmessage = () => {
    const now = performance.now();
    if (now - last >= 16 && queue.length) { last = now; for (const cb of queue.splice(0)) cb(now); }
    channel.port2.postMessage(0);
  };
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.__keepFrames = true;
  channel.port2.postMessage(0);
}

// Climb to the summit in real time; resolves with the result and what the summit card says. stumble: game times at
// which to wander off the path, and/or 'ring' to slide into the ring's hole once (stumbling(), above).
export async function drive(peak, { delay = 0.25, seconds = 300, name = null, stumble = [] } = {}) {
  const { player, game } = peak;
  const log = [];
  const at = () => player.pos.toArray().map(v => v.toFixed(1)).join(',');
  const note = name => e => log.push(`${game.time.toFixed(1)}s ${name}${e?.cause ? ` (${e.cause})` : ''} @ ${at()}`);
  for (const n of ['lost', 'beam']) player.on(n, note(n));
  for (const n of ['checkpoint', 'dent', 'summit', 'respawn']) game.on(n, note(n));
  const held = new Set(), state = { seen: [], way: null }, fall = {};
  // the game drops held keys when the window loses focus (input.js): press them again then, like a player would
  const press = (want) => {
    for (const k of [...held]) if (!want.has(k)) { send(k, false); held.delete(k); }
    for (const k of want) if (!held.has(k) || !peak.input.keys.has(k)) { send(k, true); held.add(k); }
  };
  const begun = performance.now();
  await new Promise((resolve) => {
    function tick(now) {
      if (game.done || (now - begun) / 1000 > seconds) { press(new Set()); resolve(); return; }
      press(stumbling(peak, stumble, fall) ?? decide(peak, state, now / 1000, delay));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const result = { done: game.done, time: +game.time.toFixed(2), falls: game.falls, dents: game.dents,
    wall: +((performance.now() - begun) / 1000).toFixed(1), log };
  if (!game.done) return result;
  // the card (peak/leaderboard.js): wait for the server's verdict, then (optionally) put a name on it
  const panel = () => document.querySelector('.sc-panel');
  const status = () => panel()?.querySelector('.sc-status')?.textContent ?? '';
  for (let i = 0; i < 80 && !/Rank #|out of reach/.test(status()); i++) await sleep(250);
  result.card = panel()?.innerText.replace(/\s+/g, ' ').trim() ?? null;
  const form = panel()?.querySelector('.sc-form');
  if (name !== null && form && !form.hidden) {
    form.querySelector('input').value = name;
    form.requestSubmit();
    for (let i = 0; i < 40 && !panel().querySelector('.sc-list li.me'); i++) await sleep(250);
    result.status = status();
    result.board = [...panel().querySelectorAll('.sc-list li')].map(r => r.innerText.replace(/\s+/g, ' ').trim());
  }
  return result;
}
