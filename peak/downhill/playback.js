// Plays a recorded run back (record.js's format) for the Hall of Fame: "Watch run" moves the page's own chair along
// it, with the run's sounds, puffs and toasts, and "Race ghost" rolls a see-through chair with Mnot on it beside the
// player's. The replay controls (peak/replays/controller.js) load the run from the server and check it with
// validate(); main.js wires the rest. Nothing is simulated on the way: the chair is where the samples say, and between
// two of them on the curve through both positions and velocities, its seat turned as recorded. Only the springs under
// the seat, the casters and Mnot's pose follow from that, as in a live run.
import * as THREE from 'three';
import { FLAG } from './record.js';
import { Chair, CHAIR } from './chair.js';
import { G, Ride } from './ride.js';
import { Rider } from './rider.js';
import { FEATURES } from './track.js';
import { loadMnot } from '../mnot/mnot.js';

const WIDTH = 11;                     // a sample's fields (record.js)
const MAX_SAMPLES = 30000, MAX_TIME = 3 * 60 * 60 * 1000;
const NAMES = new Set(['wheel', 'wrecked', 'lost', 'bump', 'pit', 'flight', 'space', 'bowl']);
// the flag each event comes with (on the same sample); 'space' and 'bowl' have a moment of their own
const COMES_WITH = { wheel: FLAG.wheel, wrecked: FLAG.wheel, lost: FLAG.lost, bump: FLAG.bump, pit: FLAG.pit,
  flight: FLAG.land };
const STEP = 1 / 120;                 // the springs' step, as the physics'
const JUMP = 1.5;                     // s: a move further on than this is a jump in time, not playing on (as the
                                      // controls' camera snap, controller.js)
const GHOST = 0.36;                   // the ghost's opacity, as the climb's
const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();

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

// Throws for anything this page can't play: another version, another mountain, a sample that isn't one.
export function validate(replay, fingerprint) {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay)) invalid('expected an object');
  if (replay.v !== 1) invalid(`unsupported version ${String(replay.v)} (expected v=1)`);
  if (typeof fingerprint !== 'string' || replay.route !== fingerprint) invalid('route fingerprint mismatch');
  const { samples } = replay;
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES) {
    invalid(`samples must contain 2..${MAX_SAMPLES} rows`);
  }
  let previous = -Infinity;
  samples.forEach((sample, i) => {
    if (!Array.isArray(sample) || sample.length !== WIDTH || !sample.every(isInt)) {
      invalid(`samples[${i}] must be ${WIDTH} integers`);
    }
    const [t, x, y, z, vx, vy, vz, mode, flags, yaw, wheels] = sample;
    if (t < 0 || t > MAX_TIME || t < previous) invalid(`samples[${i}] has an invalid timestamp`);
    if ([x, y, z].some(v => Math.abs(v) > 1e7)) invalid(`samples[${i}] has an out-of-range position`);
    if ([vx, vy, vz].some(v => Math.abs(v) > 2e5)) invalid(`samples[${i}] has an out-of-range velocity`);
    if (![0, 1, 3].includes(mode)) invalid(`samples[${i}] has an unknown mode`);
    if (flags < 0 || flags >= 1024) invalid(`samples[${i}] has invalid flags`);
    if (Math.abs(yaw) > 3200) invalid(`samples[${i}] has an invalid seat yaw`);
    if (wheels < 0 || wheels >= 1 << CHAIR.legs) invalid(`samples[${i}] has invalid wheels`);
    previous = t;
  });
  const end = samples.at(-1)[0];
  rows(replay.inputs ?? [], 'inputs', 2, end, (row, i) => {
    if (!isInt(row[1]) || row[1] < 0 || row[1] > 15) invalid(`inputs[${i}] has an invalid key mask`);
  });
  rows(replay.events ?? [], 'events', 3, end, (row, i) => {
    if (!NAMES.has(row[1])) invalid(`events[${i}] has an unknown event name`);
    const value = row[2];
    if (!(isInt(value) && value >= -1 && value <= 1e6 || typeof value === 'string' && value.length <= 16)) {
      invalid(`events[${i}] has an invalid event value`);
    }
  });
  return replay;
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const bits = mask => { let n = 0; for (let i = 0; i < CHAIR.legs; i++) n += mask >> i & 1; return n; };

// A recorded run, ready to be asked about any moment of it (t: seconds of the run's clock).
export class Recording {
  constructor(replay) {
    const samples = this.samples = replay.samples;
    this.inputs = replay.inputs ?? [];
    this.events = replay.events ?? [];
    this.end = samples.at(-1)[0] / 1000;
    // each sample's events (the ones that came with its flags), and those of a moment of their own
    this.with = samples.map(() => []);
    this.moments = [];
    for (const [t, name, arg] of this.events) {
      if (!COMES_WITH[name]) this.moments.push([t / 1000, name, arg]);
      else this.with[this.sampleAt(t, COMES_WITH[name])].push([name, arg]);
    }
    // since when the chair has been off the snow (the time of the last sample on it), and the ski jump's flights:
    // from leaving the snow to the landing that measured one
    this.lifted = new Float64Array(samples.length);
    this.flying = new Uint8Array(samples.length);
    let ground = samples[0][0];
    samples.forEach((s, i) => {
      if (s[7] !== 1) ground = s[0];
      this.lifted[i] = ground / 1000;
      if (this.with[i].some(e => e[0] === 'flight')) {
        for (let k = i - 1; k >= 0 && samples[k][7] === 1; k--) this.flying[k] = 1;
      }
    });
  }

  // The sample an event at t ms came with: the first at that time with its flag.
  sampleAt(t, flag) {
    const s = this.samples;
    let i = this.after(t / 1000 - 1e-7);
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

  // Where the chair was at t (out: its pos, vel and acc vectors are filled in): between the samples on either side,
  // on the curve through both positions and velocities, but never across a respawn (it was put back there).
  state(t, out) {
    const s = this.samples, ms = t * 1000;
    const lo = Math.max(0, this.after(t) - 1), hi = Math.min(lo + 1, s.length - 1), a = s[lo], b = s[hi];
    const span = (b[0] - a[0]) / 1000;
    out.index = lo;
    out.pos.set(a[1], a[2], a[3]).multiplyScalar(1e-3);
    out.vel.set(a[4], a[5], a[6]).multiplyScalar(1e-3);
    out.acc.set(0, 0, 0);
    let yaw = a[9] / 1000, spin = 0;
    if (hi > lo && span > 0 && ms > a[0] && !(b[8] & FLAG.respawn)) {
      const u = Math.min(1, (ms - a[0]) / (b[0] - a[0])), u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
      for (const [k, axis] of [[1, 'x'], [2, 'y'], [3, 'z']]) {
        out.pos[axis] = (h00 * a[k] + h01 * b[k] + span * (h10 * a[k + 3] + h11 * b[k + 3])) / 1000;
        out.vel[axis] = (a[k + 3] + (b[k + 3] - a[k + 3]) * u) / 1000;
        out.acc[axis] = (b[k + 3] - a[k + 3]) / 1000 / span;
      }
      const turn = wrap((b[9] - a[9]) / 1000);
      yaw += turn * u;
      spin = turn / span;
    } else if (hi > lo && ms > a[0]) {
      out.pos.addScaledVector(out.vel, (ms - a[0]) / 1000);   // the moment before it's put back
    }
    out.yaw = yaw;
    out.spin = spin;
    out.out = a[7] === 3;
    // on the snow while both ends are; leaving it or coming down, wherever the curve is above it
    out.snow = a[7] === 0 && (b[7] === 0 || hi === lo);
    out.air = t - this.lifted[lo];
    out.wheels = a[10];
    out.flying = !!this.flying[lo];
    return out;
  }

  // What the player held at t, as the ride's intent (the rider's legs and lean follow it).
  intent(t) {
    const list = this.inputs, ms = t * 1000;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= ms) lo = mid + 1;
      else hi = mid;
    }
    const mask = lo > 0 ? list[lo - 1][1] : 0;
    return { steer: (mask & 8 ? 1 : 0) - (mask & 4 ? 1 : 0), push: !!(mask & 1), tuck: !!(mask & 1),
      brake: !!(mask & 2), jump: false };
  }

  // The last pit stop passed by t.
  checkpoint(t) {
    let pit = FEATURES.pits[0];
    for (const [et, name, arg] of this.events) {
      if (et > t * 1000) break;
      if (name === 'pit') pit = FEATURES.pits[arg] ?? pit;
    }
    return pit;
  }
}

// Puts a Ride (the page's own, or the ghost's, which never steps) where a recording says, and tells what happened on
// the way: emit(name, data) with the ride's own events (ride.js), as the recording has them, and 'respawn' (put back
// at the pit stop), 'space' (the lever pulled) and 'bowl' ({ down }). knock: the soft props it bumps into burst, as
// they did (the page's own ride; the ghost goes through them).
export class Driver {
  constructor(recording, ride, emit = () => {}, { knock = false } = {}) {
    Object.assign(this, { recording, ride, emit, knock });
    this.t = -1;                      // where it is: s of the run's clock, -1 before it's put anywhere
    this.state = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3() };
  }

  // To moment t. A little later than where it is, it plays on there: the springs step and every event on the way is
  // told. Anywhere else it jumps there, telling nothing ('seek': the caller sets the rest of the scene as it was).
  to(t) {
    t = THREE.MathUtils.clamp(Number(t) || 0, 0, this.recording.end);
    if (this.t < 0 || t < this.t || t - this.t > JUMP) {
      this.put(t, 0);
      this.t = t;
      return 'seek';
    }
    while (this.t < t) {
      const from = this.t, next = Math.min(t, from + STEP);
      this.put(next, next - from);
      this.tell(from, next);
      this.t = next;
    }
    return 'play';
  }

  put(t, dt) {
    const r = this.ride, st = this.recording.state(t, this.state), under = r.under;
    r.pos.copy(st.pos);
    r.vel.copy(st.vel);
    r.track.ground(r.pos.x, r.pos.z, r.hint, under);
    r.hint = under.i;
    r.s = under.s;
    r.d = under.d;
    r.out = st.out;
    r.grounded = !st.out && (st.snow || r.pos.y <= under.y + 0.005);
    if (r.grounded) r.pos.y = under.y;
    r.airTime = r.grounded ? 0 : st.air;
    r.feel.set(0, -G, 0).sub(st.acc);
    if (dt === 0) r.up.copy(under.normal.y > 0.3 ? under.normal : UP);
    else if (r.grounded) r.up.lerp(under.normal, 1 - Math.exp(-14 * dt)).normalize();
    r.tiltQ.setFromUnitVectors(UP, r.up);
    r.seatYaw = st.yaw;
    r.seatL = st.spin * r.inertia;
    r.baseSpin = 0;
    for (let i = 0; i < CHAIR.legs; i++) r.wheels[i] = !!(st.wheels >> i & 1);
    r.time = t;
    r.started = t * 1000 >= this.recording.samples[0][0];
    r.done = t >= this.recording.end;
    r.flight = st.flying && !r.grounded ? r.flight ?? { time: 0, top: r.pos.y } : null;
    r.checkpoint = this.recording.checkpoint(t);
    if (dt > 0) {
      if (r.crouch >= 0 && (r.crouch += dt) >= 0.07) r.crouch = -1;
      r.lever = Math.max(0, r.lever - dt * 3);
      r.springs(dt);
    } else {
      r.crouch = -1;
      r.lever = 0;
    }
  }

  // Everything recorded after from, up to and with to: in the order a step of the physics tells it.
  tell(from, to) {
    const rec = this.recording, s = rec.samples;
    for (let i = rec.after(from); i < s.length && s[i][0] <= to * 1000; i++) this.told(i);
    for (const [t, name, arg] of rec.moments) {
      if (t <= from || t > to) continue;
      if (name === 'space') { this.ride.crouch = 0; this.ride.lever = 1; this.emit('space', {}); }
      else if (name === 'bowl') this.emit('bowl', { down: arg });
    }
  }

  told(i) {
    const r = this.ride, rec = this.recording, s = rec.samples[i], before = rec.samples[Math.max(0, i - 1)];
    const flags = s[8], list = rec.with[i], all = name => list.filter(e => e[0] === name);
    if (flags & FLAG.respawn) this.emit('respawn', {});
    if (flags & FLAG.start) this.emit('start', {});
    if (flags & FLAG.jump) { r.liftVel += 1.6; this.emit('jump', {}); }
    if (flags & FLAG.land) {
      // how hard it came down: the speed into the snow it had, falling on from the sample before
      const dt = (s[0] - before[0]) / 1000;
      _v.set(before[4], before[5], before[6]).multiplyScalar(1e-3).addScaledVector(UP, -G * dt);
      this.emit('land', { impact: Math.max(0, -_v.dot(r.under.normal)), at: r.pos.clone(),
        air: Math.max(0, s[0] / 1000 - rec.lifted[Math.max(0, i - 1)]) });
      for (const [, cm] of all('flight')) this.emit('flight', { distance: cm / 100 });
    }
    if (flags & FLAG.crash) this.emit('crash', this.crash(s, before));
    for (const [, kind] of all('bump')) this.emit('bump', this.bump(kind));
    // the casters that went, closest to the blow first as the ride lost them (one each step, nearly always)
    const causes = all('wheel').map(e => e[1]), lost = [];
    for (let k = 0; k < CHAIR.legs; k++) if (before[10] >> k & 1 && !(s[10] >> k & 1)) lost.push(k);
    lost.forEach((index, n) => this.emit('wheel', { index, cause: causes[n] ?? causes.at(-1) ?? 'crash',
      left: bits(s[10]) + lost.length - 1 - n }));
    if (all('wrecked').length) this.emit('wrecked', {});
    for (const [, how] of all('lost')) this.emit('lost', { at: r.pos.clone(), water: how === 'water' });
    for (const [, index] of all('pit')) this.emit('pit', { s: FEATURES.pits[index] });
    if (flags & FLAG.finish) this.emit('finish', { time: s[0] / 1000 });
  }

  // A crash: how hard (the change in the speed across the slope, less what the slope gave) and into what (the
  // nearest hard thing, else a wall too steep to ride).
  crash(s, before) {
    const r = this.ride, impulse = Math.max(0, Math.hypot(s[4] - before[4], s[6] - before[6]) / 1000 - 0.5);
    let near = null, gap = 1.2;
    for (const o of r.obstacles.near(r.s)) {
      if (o.soft) continue;
      const g = Math.hypot(r.pos.x - o.x, r.pos.z - o.z) - o.r - CHAIR.radius;
      if (g < gap) { gap = g; near = o; }
    }
    return near ? { impulse, kind: near.kind, at: new THREE.Vector3(near.x, r.pos.y + 0.5, near.z) }
      : { impulse, kind: 'wall', at: r.pos.clone() };
  }

  // A bump into a soft prop: the nearest of its kind still standing, burst (knock) the way the chair came at it.
  bump(kind) {
    const r = this.ride, o = this.soft(kind, r.pos, r.s);
    if (o && this.knock) this.hit(o, r.pos, r.vel, false);
    return { kind, at: o ? new THREE.Vector3(o.x, o.y, o.z) : r.pos.clone() };
  }

  soft(kind, pos, s) {
    let best = null, gap = 1;
    for (const o of this.ride.obstacles.near(s)) {
      if (!o.soft || o.gone || o.kind !== kind) continue;
      const g = Math.hypot(pos.x - o.x, pos.z - o.z) - o.r - CHAIR.radius;
      if (g < gap) { gap = g; best = o; }
    }
    return best;
  }

  hit(o, pos, vel, quiet) {
    const n = _n.set(pos.x - o.x, 0, pos.z - o.z);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
    n.normalize();
    const speed = Math.max(0.5, -vel.dot(n));
    if (o.hit) o.hit(o, vel, n, speed);              // a pin: it's knocked flying, and the rest after it
    else if (quiet) { o.gone = true; o.mesh.visible = false; }
    else this.ride.obstacles.burst(o, vel, n, speed);
  }

  // After a jump in time: every prop stood up again, and those the chair had knocked over by t since it was last put
  // back gone at once (a pin is still knocked over, and falls).
  knockTo(t) {
    const obstacles = this.ride.obstacles, rec = this.recording, s = rec.samples;
    obstacles.reset();
    if (!this.knock) return;
    for (let i = 0; i < s.length && s[i][0] <= t * 1000; i++) {
      if (s[i][8] & FLAG.respawn) obstacles.reset();
      for (const [name, kind] of rec.with[i]) {
        if (name !== 'bump') continue;
        _p.set(s[i][1], s[i][2], s[i][3]).multiplyScalar(1e-3);
        _v.set(s[i][4], s[i][5], s[i][6]).multiplyScalar(1e-3);
        const o = this.soft(kind, _p, this.ride.track.locate(_p.x, _p.z).s);
        if (o) this.hit(o, _p, _v, true);
      }
    }
  }
}

// The ghost to race: a see-through chair with a see-through Mnot on it, where the recording says. Its ride only holds
// the state the chair and Mnot are posed from; it never steps, and it goes through everything.
export class Ghost {
  static async create({ replay, track, obstacles, scene }) {
    return new Ghost({ recording: new Recording(replay), track, obstacles, scene, mnot: await loadMnot() });
  }

  constructor({ recording, track, obstacles, scene, mnot }) {
    this.recording = recording;
    this.duration = recording.end;
    this.phase = 0;
    this.ride = new Ride(track, obstacles);
    this.chair = new Chair();
    this.rider = new Rider(mnot, this.chair);
    this.root = this.chair.root;
    this.root.name = 'ghost';
    seeThrough(this.root);
    scene.add(this.root);
    this.driver = new Driver(recording, this.ride, (name, data) => {
      if (name === 'wheel') this.chair.casters[data.index].gone = true;
      else if (name === 'pit') this.chair.fix(true);
      else if (name === 'respawn') this.chair.fix();
    });
    this.t = 0;
  }

  // To moment t of the run (the controls ask, every frame: the player's clock).
  seek(t) {
    this.t = t;
    if (this.driver.to(t) === 'seek') this.chair.setWheels(this.ride.wheels);
  }

  // Once a frame: Mnot and the chair posed.
  update(dt) {
    this.rider.update(dt, this.ride, this.recording.intent(this.t));
    this.chair.pose(this.ride, dt);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// Its own materials, see-through and casting no shadow (the chair's are shared with the player's: look.js caches).
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
