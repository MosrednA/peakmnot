// Test players, for tuning in the browser console with peak.html?manual (nothing in the game imports this):
//   const bots = await import('./peak/bots.js');
//   bots.survey(peak)                  // how players with slow and quick reactions do on each beam
//   bots.cross(peak, 'rope', { delay: 0.3 })
//   bots.look(peak, [0.4, 4.3, 33.7])   // Mnot and the camera at a spot
// A bot sees the lean `delay` seconds late, like a person, and holds the key that leans back once the lean (plus
// where it's heading, if it anticipates) passes `dead` radians.
import * as THREE from 'three';

const BEAMS = {
  plank: { at: [0.2, 1.0, 17.6], yaw: 0 },
  rope: { at: [0.4, 4.3, 33.7], yaw: 0 },
  steep: { at: [2.7, 6.8, 64.95], yaw: 0 },
};

// Put Mnot somewhere and the camera on its shot there, for looking at a spot: bots.look(peak, [0, 0, -0.6]).
export function look(peak, at, yaw = 0, { userYaw = 0, userPitch = 0 } = {}) {
  const { player, world, follow, game } = peak;
  player.celebrate = 0;
  game.out = null;
  player.spawn(new THREE.Vector3(...at), yaw);
  peak.step(0.05);
  follow.snap(player, world);
  Object.assign(follow, { userYaw, userPitch, lastDrag: follow.time });
  follow.yaw += userYaw;          // update(0) doesn't glide, so turn it here
  follow.update(0, player, world);
  peak.render();
}

// Hold keys for a while, or until something happens.
export function hold(peak, keys, seconds, until = () => false) {
  for (const k of keys) peak.key(k, true);
  let t = 0;
  while (t < seconds && !until()) { peak.step(1 / 60); t += 1 / 60; }
  for (const k of keys) peak.key(k, false);
  return t;
}

// Walk onto a beam holding right ("onwards") and try to cross it.
export function cross(peak, beam, { delay = 0.3, dead = 0.06, anticipate = 0.3, seconds = 25 } = {}) {
  const { player, follow, world, game } = peak;
  const start = BEAMS[beam];
  player.spawn(new THREE.Vector3(...start.at), start.yaw);
  game.out = null;
  follow.snap(player, world);
  hold(peak, ['KeyD'], 4, () => player.mode === 'beam');
  if (player.mode !== 'beam') return { result: 'missed it', at: player.pos.toArray().map(v => +v.toFixed(2)) };
  const b = player.balance, seen = [];
  let t = 0, held = null, worst = 0;
  while (t < seconds && player.mode === 'beam') {
    seen.push(b.lean + anticipate * b.leanSpeed);
    const lean = seen[Math.max(0, seen.length - 1 - Math.round(delay * 60))];
    let want = null;
    if (Math.abs(lean) > dead) {
      const f = follow.heading(player, world), right = new THREE.Vector3(-f.z, 0, f.x);
      want = -Math.sign(lean) * right.dot(b.beam.right) > 0 ? 'KeyD' : 'KeyA';
    }
    if (want !== held) { if (held) peak.key(held, false); if (want) peak.key(want, true); held = want; }
    peak.step(1 / 60);
    t += 1 / 60;
    if (player.mode === 'beam') worst = Math.max(worst, Math.abs(b.lean));
  }
  if (held) peak.key(held, false);
  return { result: player.mode === 'ground' ? 'across' : 'fell', seconds: +t.toFixed(1), worst: +worst.toFixed(2) };
}

// Each beam, a few tries for each reaction time: how many got across.
export function survey(peak, { delays = [0.2, 0.3, 0.4, 0.5], tries = 6, anticipate = 0.3 } = {}) {
  const table = {};
  for (const beam of Object.keys(BEAMS)) {
    table[beam] = {};
    for (const delay of delays) {
      let across = 0;
      for (let i = 0; i < tries; i++) if (cross(peak, beam, { delay, anticipate }).result === 'across') across++;
      table[beam][`${delay}s`] = `${across}/${tries}`;
    }
  }
  return table;
}

// On ice the keys only push (skate.js), so steer like a player: aim for a steady pace onwards and back towards the
// line, and push the difference between that and the slide. Coast while the wobble meter is high, to let it drain.
const PUSHES = [['KeyD'], ['KeyD', 'KeyW'], ['KeyD', 'KeyS'], ['KeyW'], ['KeyS'], ['KeyA'], ['KeyA', 'KeyW'],
  ['KeyA', 'KeyS']];
function counterSteer(peak, want, onward, { pace = 2, line = 1.5 } = {}) {
  const { player, world, input } = peak, rail = world.railAt(player.pos);
  want.delete(onward);
  if (player.skate.meter > 0.55 || !input.frame) return;
  const off = THREE.MathUtils.clamp(line * rail.side, -0.8, 0.8);
  const back = new THREE.Vector3(rail.dir.z, 0, -rail.dir.x).multiplyScalar(off);    // side is to the route's right
  const goal = rail.dir.clone().multiplyScalar(pace).add(back);
  for (const k of keysFor(peak, goal.sub(player.vel).setY(0), 0.5) ?? []) want.add(k);
}

// The keys that push most nearly along v (at least `most` of the way), or null when v is too small to bother.
function keysFor(peak, v, most) {
  const { input } = peak, length = v.length();
  if (length < 0.25 || !input.frame) return null;
  let best = null;
  for (const keys of PUSHES) {
    const fit = input.frame.direction(new Set(keys), new THREE.Vector3(), false).dot(v) / length;
    if (fit > most) [best, most] = [keys, fit];
  }
  return best;
}

// The key that means "onwards" right now: right on most shots, down where the camera looks from in front (input.js).
function onwards(peak) {
  const { player, world, input } = peak, dir = world.railAt(player.pos).dir;
  let best = { key: 'KeyD', dir: dir.clone(), fit: -Infinity };
  if (!input.frame) return best;
  for (const key of ['KeyD', 'KeyS', 'KeyW', 'KeyA']) {
    const d = input.frame.direction(new Set([key]), new THREE.Vector3(), false), fit = d.dot(dir);
    if (fit > best.fit + 1e-6) best = { key, dir: d, fit };
  }
  return best;
}

// The ring of ice (ring.js): round the hole the shorter way to the pad that leads on, along the middle of the ice and
// slowly enough that the pull into the hole does most of the turning. On rock walk that way, carefully, so it comes
// onto the ice slowly; on ice push the difference between that and the slide, carefully while the meter is high.
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

// The whole climb: hold "onwards", jump at gaps and rises, balance on beams, steer round the ring. Logs what happens.
export function climb(peak, { seconds = 180, delay = 0.25 } = {}) {
  const { player, world, game, follow } = peak;
  const log = [], at = () => player.pos.toArray().map(v => +v.toFixed(1)).join(',');
  const listen = (source, name) => source.on(name, (e) =>
    log.push(`${game.time.toFixed(1)}s ${name}${e?.cause ? ` (${e.cause})` : ''} @ ${at()}`));
  if (!climb.hooked) {
    for (const name of ['lost', 'beam', 'slip']) listen(player, name);
    for (const name of ['checkpoint', 'dent', 'summit', 'respawn']) listen(game, name);
    climb.hooked = log;
  }
  const record = climb.hooked;
  record.length = 0;
  const seen = [], round = {};
  let t = 0, keys = new Set();
  const press = want => {
    for (const k of keys) if (!want.has(k)) peak.key(k, false);
    for (const k of want) if (!keys.has(k)) peak.key(k, true);
    keys = want;
  };
  while (t < seconds && !game.done) {
    const want = new Set();
    const ring = player.mode === 'ground' && world.rings.find(r => r.solids.includes(player.support));
    const exit = ring && exitPad(world, ring);
    if (player.mode === 'beam') {
      const b = player.balance;
      seen.push(b.lean + 0.2 * b.leanSpeed);
      const lean = seen[Math.max(0, seen.length - 1 - Math.round(delay * 60))];
      if (Math.abs(lean) > 0.06) {
        const f = follow.heading(player, world), right = new THREE.Vector3(-f.z, 0, f.x);
        want.add(-Math.sign(lean) * right.dot(b.beam.right) > 0 ? 'KeyD' : 'KeyA');
      }
    } else if (player.mode === 'ground' && world.hazards.some(h => h.wait?.(player.pos))) {
      // a gondola or a wind gap isn't ready: stand still (careful steps, so a gust can't shove) until it is
      want.add('ShiftLeft');
    } else if (ring && player.support !== exit.solid) {
      seen.length = 0;
      ringSteer(peak, ring, exit, want, round);
    } else {
      seen.length = 0;
      round.way = null;
      const go = onwards(peak);
      want.add(go.key);
      if (player.icy && player.mode === 'ground') counterSteer(peak, want, go.key);
      if (player.mode === 'ground' && player.speed > 0.5) {
        // look ahead the way it's going; on ice, the way it wants to go (it slides round to that)
        const dir = player.icy ? go.dir : player.vel.clone().setY(0).normalize();
        const ahead = player.pos.clone().addScaledVector(dir, 0.32);
        const next = world.ground(ahead.x, ahead.z, player.pos.y + 0.6, 0);
        const wall = world.ground(ahead.x, ahead.z, Infinity, 0)?.top > player.pos.y + 0.6;   // walk along it
        const beam = world.beam(ahead.x, ahead.z, player.pos.y - 0.4, player.pos.y + 0.3, 0.6);
        if (!beam && !wall && (!next || next.top < player.pos.y - 0.3 || next.top > player.pos.y + 0.25)) want.add('Space');
      }
    }
    press(want);
    peak.step(1 / 60);
    t += 1 / 60;
  }
  press(new Set());
  return { done: game.done, time: +game.time.toFixed(1), falls: game.falls, dents: game.dents, at: at(), log: record.slice() };
}
