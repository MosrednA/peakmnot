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
  steep: { at: [2.7, 6.8, 59.2], yaw: 0 },
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

// The whole climb: hold right ("onwards"), jump at gaps and rises, balance on beams. Logs what happens.
export function climb(peak, { seconds = 180, delay = 0.25 } = {}) {
  const { player, world, game, follow } = peak;
  const log = [], at = () => player.pos.toArray().map(v => +v.toFixed(1)).join(',');
  const listen = (source, name) => source.on(name, () => log.push(`${game.time.toFixed(1)}s ${name} @ ${at()}`));
  if (!climb.hooked) {
    for (const name of ['lost', 'beam', 'slip']) listen(player, name);
    for (const name of ['checkpoint', 'dent', 'summit', 'respawn']) listen(game, name);
    climb.hooked = log;
  }
  const record = climb.hooked;
  record.length = 0;
  const seen = [];
  let t = 0, keys = new Set();
  const press = want => {
    for (const k of keys) if (!want.has(k)) peak.key(k, false);
    for (const k of want) if (!keys.has(k)) peak.key(k, true);
    keys = want;
  };
  while (t < seconds && !game.done) {
    const want = new Set();
    if (player.mode === 'beam') {
      const b = player.balance;
      seen.push(b.lean + 0.2 * b.leanSpeed);
      const lean = seen[Math.max(0, seen.length - 1 - Math.round(delay * 60))];
      if (Math.abs(lean) > 0.06) {
        const f = follow.heading(player, world), right = new THREE.Vector3(-f.z, 0, f.x);
        want.add(-Math.sign(lean) * right.dot(b.beam.right) > 0 ? 'KeyD' : 'KeyA');
      }
    } else {
      seen.length = 0;
      want.add('KeyD');
      if (player.mode === 'ground' && player.speed > 0.5) {
        const dir = player.vel.clone().setY(0).normalize(), ahead = player.pos.clone().addScaledVector(dir, 0.32);
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
