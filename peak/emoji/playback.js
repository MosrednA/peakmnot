// Plays a recorded run back (record.js's format) for the Hall of Fame: "Watch run" moves the page's own Mnot along
// it on the run's field, with the run's sounds, puffs and toasts (main.js, watcher()), and "Race ghost" runs a
// see-through Mnot beside the player's. The replay controls (peak/replays/controller.js) load the run from the
// server and check it with validateReplay(); main.js wires the rest. Nothing is simulated on the way: Mnot is where
// the samples say, and between two of them on the curve through both positions and velocities, turned as recorded.
import * as THREE from 'three';
import { FLAG, MODE } from './record.js';
import { TEETER } from './teeter.js';
import { loadMnot } from '../mnot/mnot.js';

const WIDTH = 10;                     // a sample's fields (record.js)
const MAX_SAMPLES = 30000, MAX_TIME = 60 * 60 * 1000;
const NAMES = new Set(['take', 'hit', 'crack', 'hole', 'pit', 'bonk', 'rim']);
const FLAGS = Object.values(FLAG).reduce((all, bit) => all | bit, 0);
const GHOST = 0.36;                   // the ghost's opacity, as the climb's
const _a = new THREE.Vector3();

const isInt = Number.isSafeInteger;
function invalid(message) { throw new Error(`Invalid replay: ${message}`); }

function rows(list, label, width, end, check) {
  if (!Array.isArray(list) || list.length > 4 * MAX_SAMPLES) invalid(`${label} must be an array`);
  let previous = -Infinity;
  list.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== width) invalid(`${label}[${i}] must have ${width} fields`);
    if (!isInt(row[0]) || row[0] < 0 || row[0] > end) invalid(`${label}[${i}] has an out-of-range time`);
    if (row[0] < previous) invalid(`${label}[${i}] is out of time order`);
    previous = row[0];
    check(row, i);
  });
}

// Throws for anything this page can't play: another version, another field's rules, a sample that isn't one.
export function validateReplay(replay, fingerprint) {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay)) invalid('expected an object');
  if (replay.v !== 1) invalid(`unsupported version ${String(replay.v)} (expected v=1)`);
  if (typeof fingerprint !== 'string' || replay.route !== fingerprint) invalid('route fingerprint mismatch');
  if (!isInt(replay.seed) || replay.seed < 1 || replay.seed > 2 ** 31) invalid('the field\'s seed is not one');
  const { samples } = replay;
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES) {
    invalid(`samples must contain 2..${MAX_SAMPLES} rows`);
  }
  let previous = -Infinity;
  samples.forEach((sample, i) => {
    if (!Array.isArray(sample) || sample.length !== WIDTH || !sample.every(isInt)) {
      invalid(`samples[${i}] must be ${WIDTH} integers`);
    }
    const [t, x, y, z, vx, vy, vz, mode, flags, yaw] = sample;
    if (t < 0 || t > MAX_TIME || t < previous) invalid(`samples[${i}] has an invalid timestamp`);
    if ([x, y, z].some(v => Math.abs(v) > 1e5)) invalid(`samples[${i}] has an out-of-range position`);
    if ([vx, vy, vz].some(v => Math.abs(v) > 2e4)) invalid(`samples[${i}] has an out-of-range velocity`);
    if (mode !== MODE.snow && mode !== MODE.pit) invalid(`samples[${i}] has an unknown mode`);
    if (flags < 0 || flags > FLAGS) invalid(`samples[${i}] has invalid flags`);
    if (Math.abs(yaw) > 3200) invalid(`samples[${i}] has an invalid yaw`);
    previous = t;
  });
  const end = samples.at(-1)[0];
  rows(replay.inputs ?? [], 'inputs', 2, end, (row, i) => {
    if (!isInt(row[1]) || row[1] < 0 || row[1] > 31) invalid(`inputs[${i}] has an invalid key mask`);
  });
  rows(replay.events ?? [], 'events', 3, end, (row, i) => {
    if (!NAMES.has(row[1])) invalid(`events[${i}] has an unknown event name`);
    if (!isInt(row[2]) || row[2] < -1 || row[2] > 1e6) invalid(`events[${i}] has an invalid event value`);
  });
  return replay;
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// A recorded run, ready to be asked about any moment of it (t: seconds of the run's clock).
export class Recording {
  constructor(replay) {
    const samples = this.samples = replay.samples;
    this.seed = replay.seed;
    this.inputs = replay.inputs ?? [];
    this.events = replay.events ?? [];
    this.end = samples.at(-1)[0] / 1000;
    // each sample's events, in the order they happened (each came with its sample's flag)
    this.with = samples.map(() => []);
    for (const [t, name, arg] of this.events) this.with[this.sampleAt(t, FLAG[name])].push([name, arg]);
    // since when Mnot has been in the hole it's in (s), for each sample in one; and since when it has been teetering
    // on a hole's rim, for each sample it is (else -1): from the rim to steadying or dropping in
    this.dropped = new Float64Array(samples.length);
    this.rimmed = new Float64Array(samples.length).fill(-1);
    let since = 0, rim = -1;
    samples.forEach((s, i) => {
      if (s[7] === MODE.pit && (i === 0 || samples[i - 1][7] !== MODE.pit)) since = s[0] / 1000;
      this.dropped[i] = since;
      if (s[8] & (FLAG.steady | FLAG.pit)) rim = -1;
      if (s[8] & FLAG.rim) rim = s[0] / 1000;
      this.rimmed[i] = rim;
    });
  }

  // The sample an event at t ms came with: the first at that time with its flag.
  sampleAt(t, flag) {
    const s = this.samples;
    const i = this.after(t / 1000 - 1e-7);
    for (let k = i; k < s.length && s[k][0] === t; k++) if (s[k][8] & flag) return k;
    return Math.min(i, s.length - 1);
  }

  // The first sample later than t.
  after(t) {
    const s = this.samples, ms = t * 1000;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Where Mnot was at t (out: its pos and vel vectors are filled in), between the samples on either side, and
  // which way it faced and turned; pit: in a hole, since `dropped` s; rimmed: teetering on a hole's rim since then (s;
  // else -1).
  state(t, out) {
    const s = this.samples, ms = t * 1000;
    const lo = Math.max(0, this.after(t) - 1), hi = Math.min(lo + 1, s.length - 1), a = s[lo], b = s[hi];
    const span = (b[0] - a[0]) / 1000;
    out.index = lo;
    out.pos.set(a[1], a[2], a[3]).multiplyScalar(1e-3);
    out.vel.set(a[4], a[5], a[6]).multiplyScalar(1e-3);
    let yaw = a[9] / 1000, spin = 0;
    if (hi > lo && span > 0 && ms > a[0]) {
      const u = Math.min(1, (ms - a[0]) / (b[0] - a[0])), u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
      for (const [k, axis] of [[1, 'x'], [2, 'y'], [3, 'z']]) {
        out.pos[axis] = (h00 * a[k] + h01 * b[k] + span * (h10 * a[k + 3] + h11 * b[k + 3])) / 1000;
        out.vel[axis] = (a[k + 3] + (b[k + 3] - a[k + 3]) * u) / 1000;
      }
      const turn = wrap((b[9] - a[9]) / 1000);
      yaw += turn * u;
      spin = turn / span;
    }
    out.yaw = yaw;
    out.spin = spin;
    out.pit = a[7] === MODE.pit && (b[7] === MODE.pit || hi === lo);
    out.dropped = this.dropped[lo];
    out.rimmed = this.rimmed[lo];
    return out;
  }

  // The keys the player held at t (record.js, KEY).
  mask(t) {
    const list = this.inputs, ms = t * 1000;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 ? list[lo - 1][1] : 0;
  }

  // A bonk's wall, as near as the samples tell: the way it threw Mnot back, from the sample before to this one.
  normal(i, to = new THREE.Vector3()) {
    const a = this.samples[Math.max(0, i - 1)], b = this.samples[i];
    to.set(b[4] - a[4], 0, b[6] - a[6]);
    if (to.lengthSq() < 1) to.set(-b[4], 0, -b[6]);
    return to.lengthSq() < 1 ? to.set(0, 0, -1) : to.normalize();
  }
}

// The ghost to race: a see-through Mnot where the recording says, running, walking or standing by its speed,
// teetering on a hole's rim, sinking into a hole and hopping out of it (pit: main.js's PIT), and dancing at the end.
// It goes through everything.
export class Ghost {
  static async create({ replay, scene, pit }) {
    return new Ghost({ recording: new Recording(replay), scene, pit, mnot: await loadMnot() });
  }

  constructor({ recording, scene, pit, mnot }) {
    Object.assign(this, { recording, pit, mnot });
    this.duration = recording.end;
    this.phase = 0;
    this.root = mnot.root;
    this.root.name = 'ghost';
    seeThrough(this.root);
    scene.add(this.root);
    this.state = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.t = 0;
    this.seek(0);
  }

  // To moment t of the run (the controls ask, every frame: the player's clock).
  seek(t) {
    this.t = t;
    const st = this.recording.state(Math.min(t, this.duration), this.state);
    this.root.position.copy(st.pos).setY(0);
    this.root.rotation.y = st.yaw;
  }

  // Once a frame: Mnot posed.
  update(dt) {
    const st = this.state, m = this.mnot.model, anim = this.mnot.animator, p = this.pit;
    m.position.y = 0;
    if (this.t >= this.duration) anim.play('Dance', 0.3);
    else if (st.pit) {
      // as climb() in main.js: down to its glasses, flailing, then a hop out
      const k = this.t - st.dropped, sunk = Math.min(1, k / p.down), out = Math.min(1, (k - p.down - p.stay) / p.out);
      m.position.y = out > 0 ? -p.sink * (1 - out) + p.hop * 4 * out * (1 - out) : -p.sink * sunk * sunk;
      anim.play('Teeter', 0.1);
    } else if (st.rimmed >= 0) {
      // as main.js's pose() on the rim: rocking forward, out over the hole it faces, and back
      const age = this.t - st.rimmed, k = Math.min(1, age / TEETER.time);
      m.rotation.x = (0.06 + 0.16 * k) * (0.7 + 0.3 * Math.sin(2 * Math.PI * age / TEETER.clip));
      anim.play('Teeter', 0.12);
    } else {
      const along = Math.max(0, st.vel.dot(_a.set(Math.sin(st.yaw), 0, Math.cos(st.yaw))));
      if (along > 0.3) {
        anim.play(along > 2.4 ? 'Run' : 'Walk', 0.2);
        anim.setGaitSpeed(along, { Walk: this.mnot.rig.walk_speed, Run: this.mnot.rig.run_speed });
      } else anim.play('Idle', 0.25);
    }
    if (st.rimmed < 0) m.rotation.x *= Math.exp(-14 * dt);
    m.rotation.z += (THREE.MathUtils.clamp(-st.spin * st.vel.length() * 0.05, -0.32, 0.32) - m.rotation.z)
      * (1 - Math.exp(-8 * dt));
    anim.update(dt);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// Its own materials, see-through and casting no shadow (the player's are shared with it: look.js caches).
function seeThrough(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = false;
    o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
      const material = m.clone();                   // its userData too (a copy)
      material.transparent = true;
      material.opacity = Math.min(material.opacity ?? 1, GHOST);
      material.depthWrite = false;
      if (material.alphaTest) material.alphaTest = Math.min(material.alphaTest, GHOST / 2);
      if (material.userData.outlineParameters) material.userData.outlineParameters.alpha = GHOST;
      return material;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}
