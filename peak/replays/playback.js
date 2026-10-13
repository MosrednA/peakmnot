// Samples and displays a recorded climb as an independently animated character. The replay uses the recorder's
// v1 format: millisecond timestamps and millimetre positions and velocities.
import { ReplayMotion } from './motion.js';
const MODES = ['ground', 'air', 'beam', 'out'];
const FLAG_RESPAWN = 32;
const GHOST_OPACITY = 0.36;
const MAX_TIME_MS = 3 * 60 * 60 * 1000, MAX_SAMPLES = 30000;
const ONE_SHOTS = new Set(['JumpStart', 'LeapStart', 'Land', 'LeapLand', 'LandHard', 'PushGlasses', 'LookUp', 'TapFoot']);

const isInt = value => Number.isSafeInteger(value);
const seconds = ms => ms / 1000;

function invalid(message) { throw new Error(`Invalid replay: ${message}`); }

function checkTimedRows(rows, label, width, lastSampleTime, checkRow) {
  if (!Array.isArray(rows)) invalid(`${label} must be an array`);
  let previous = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length !== width) invalid(`${label}[${i}] must have ${width} fields`);
    const time = row[0];
    if (!isInt(time) || time < 0 || time > MAX_TIME_MS) invalid(`${label}[${i}] has an out-of-range time`);
    if (time > lastSampleTime) invalid(`${label}[${i}] is after the final sample`);
    if (time < previous) invalid(`${label}[${i}] is out of time order`);
    previous = time;
    checkRow(row, i);
  }
}

// Validate the public v1 envelope before a UI attempts to play or display it.
export function validateReplay(replay, routeFingerprint) {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay)) invalid('expected an object');
  if (replay.v !== 1) invalid(`unsupported version ${String(replay.v)} (expected v=1)`);
  if (typeof routeFingerprint !== 'string' || typeof replay.route !== 'string' || replay.route !== routeFingerprint) {
    invalid('route fingerprint mismatch');
  }
  if (replay.route.length > 128) invalid('route fingerprint is too long');
  if (!isInt(replay.phase) || replay.phase < 0 || replay.phase > 30 * 24 * 60 * 60 * 1000) {
    invalid('phase is outside the supported millisecond range');
  }
  if (!Array.isArray(replay.samples) || replay.samples.length < 2 || replay.samples.length > MAX_SAMPLES) {
    invalid(`samples must contain 2..${MAX_SAMPLES} rows`);
  }

  let previous = -Infinity;
  for (let i = 0; i < replay.samples.length; i++) {
    const sample = replay.samples[i];
    if (!Array.isArray(sample) || sample.length !== 10) invalid(`samples[${i}] must have 10 fields`);
    if (!sample.every(isInt)) invalid(`samples[${i}] must contain only safe integers`);
    const [time, x, y, z, vx, vz, vy, mode, flags, support] = sample;
    if (time < 0 || time > MAX_TIME_MS || time < previous) invalid(`samples[${i}] has an invalid timestamp`);
    if ([x, y, z].some(value => value < -1e6 || value > 1e6)) invalid(`samples[${i}] has an out-of-range position`);
    if ([vx, vz, vy].some(value => value < -1e5 || value > 1e5)) invalid(`samples[${i}] has an out-of-range velocity`);
    if (mode < 0 || mode >= MODES.length) invalid(`samples[${i}] has an unknown mode`);
    if (flags < 0 || flags > 511) invalid(`samples[${i}] has invalid flags`);
    if (support < -1 || support > 999) invalid(`samples[${i}] has an invalid support index`);
    previous = time;
  }

  // Public API replays intentionally omit inputs; playback depends only on recorded samples.
  if (replay.inputs !== undefined) {
    if (!Array.isArray(replay.inputs) || replay.inputs.length > 4 * MAX_SAMPLES) invalid('inputs must be an array');
    checkTimedRows(replay.inputs, 'inputs', 2, replay.samples.at(-1)[0], (row, i) => {
      if (!isInt(row[1]) || row[1] < 0 || row[1] > 63) invalid(`inputs[${i}] has an invalid key mask`);
    });
  }
  if (replay.events !== undefined) {
    if (!Array.isArray(replay.events) || replay.events.length > 4 * MAX_SAMPLES) invalid('events must be an array');
    checkTimedRows(replay.events, 'events', 3, replay.samples.at(-1)[0], (row, i) => {
      if (typeof row[1] !== 'string' || !['space', 'lost', 'respawn', 'cp', 'dent', 'summit'].includes(row[1])) {
        invalid(`events[${i}] has an unknown event name`);
      }
      const value = row[2];
      if (!(isInt(value) && value >= -1 && value <= 99 || typeof value === 'string' && value.length <= 16)) {
        invalid(`events[${i}] has an invalid event value`);
      }
    });
  }
  return replay;
}

function locate(samples, timeMs) {
  if (timeMs < samples[0][0]) return { lo: 0, hi: 0, u: 0 };
  const last = samples.length - 1;
  if (timeMs >= samples[last][0]) return { lo: last, hi: last, u: 0 };

  // Upper-bound search keeps seeking logarithmic, including backward scrubs. It also resolves accepted duplicate
  // timestamps to the last sample at that instant, avoiding a zero-length interpolation interval.
  let left = 0, right = samples.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (samples[mid][0] <= timeMs) left = mid + 1;
    else right = mid;
  }
  const lo = left - 1, hi = left;
  if (samples[lo][0] === timeMs) return { lo, hi: lo, u: 0 };
  const u = (timeMs - samples[lo][0]) / (samples[hi][0] - samples[lo][0]);
  return { lo, hi, u };
}

function decoded(sample) {
  return {
    time: seconds(sample[0]),
    x: sample[1] / 1000, y: sample[2] / 1000, z: sample[3] / 1000,
    vx: sample[4] / 1000, vz: sample[5] / 1000, vy: sample[6] / 1000,
    mode: MODES[sample[7]], flags: sample[8], support: sample[9],
  };
}

function interpolate(a, b, u) {
  const dt = seconds(b[0] - a[0]);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const hermite = (p0, v0, p1, v1) => h00 * p0 + h10 * v0 * dt + h01 * p1 + h11 * v1 * dt;
  const lerp = (x, y) => x + (y - x) * u;
  // Beam velocities are deliberately zero in v1 (Balance moves the player directly). Zero tangents made the
  // actor stop and start at every 10 Hz sample. The recorded beam path and supported height are continuous.
  const beam = a[7] === 2 || b[7] === 2;
  return {
    time: seconds(a[0]) + dt * u,
    x: beam ? lerp(a[1], b[1]) / 1000 : hermite(a[1] / 1000, a[4] / 1000, b[1] / 1000, b[4] / 1000),
    y: a[7] !== 1 ? lerp(a[2], b[2]) / 1000 : hermite(a[2] / 1000, a[6] / 1000, b[2] / 1000, b[6] / 1000),
    z: beam ? lerp(a[3], b[3]) / 1000 : hermite(a[3] / 1000, a[5] / 1000, b[3] / 1000, b[5] / 1000),
    vx: lerp(a[4] / 1000, b[4] / 1000),
    vz: lerp(a[5] / 1000, b[5] / 1000),
    vy: lerp(a[6] / 1000, b[6] / 1000),
    mode: MODES[a[7]], flags: a[8], support: a[9],
  };
}

// Pure v1 sampler, in seconds and metres. Hermite tangents come from recorded velocities; beam paths and supported
// heights use positions directly. Respawns are hard boundaries; intentionally unrecorded out gaps hold still.
export function sampleReplay(replay, time) {
  if (!replay || !Array.isArray(replay.samples) || replay.samples.length === 0) invalid('samples are missing');
  if (!Number.isFinite(time)) throw new TypeError('Replay time must be finite seconds');
  const samples = replay.samples, { lo, hi, u } = locate(samples, time * 1000);
  if (lo === hi) return decoded(samples[lo]);
  const a = samples[lo], b = samples[hi];
  if ((b[8] & FLAG_RESPAWN) || a[7] === 3 || b[7] === 3) return decoded(a);
  return interpolate(a, b, u);
}

// Absolute clip time for deterministic seeking. Loop clips wrap; the rig's one-shots hold on their last pose.
export function animationTime(name, elapsed, clipDuration) {
  if (!Number.isFinite(elapsed) || !Number.isFinite(clipDuration) || clipDuration <= 0) return 0;
  const time = Math.max(0, elapsed);
  return ONE_SHOTS.has(name) ? Math.min(time, clipDuration) : time % clipDuration;
}

function lastEvent(events, time) {
  let left = 0, right = events.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (events[mid].time <= time) left = mid + 1;
    else right = mid;
  }
  return left ? events[left - 1] : null;
}

export class ReplayActor {
  static async create({ scene, world, replay, ghost = true }) {
    if (!scene?.add || !world || !replay) throw new TypeError('ReplayActor.create needs scene, world, and replay');
    // The route comparison belongs to the caller, which has the current route fingerprint. Still reject malformed
    // payloads here so a standalone viewer cannot create an unusable actor.
    validateReplay(replay, replay.route);
    const [THREE, { loadMnot }, { Pose }] = await Promise.all([import('three'), import('../mnot/mnot.js'), import('../mnot/pose.js')]);
    const mnot = await loadMnot();
    const actor = new ReplayActor({ THREE, scene, world, replay, mnot, ghost, pose: new Pose(mnot) });
    scene.add(actor.root);
    actor.seek(0);
    return actor;
  }

  constructor({ THREE, scene, world, replay, mnot, ghost, pose }) {
    this.THREE = THREE;
    this.scene = scene;
    this.world = world;
    this.replay = replay;
    this.root = mnot.root;
    this.animator = mnot.animator;
    this.model = mnot.model;
    this.rig = mnot.rig;
    this.pose = pose;
    this.clipPose = new Map();
    this.model.traverse(bone => { if (bone.isBone) this.clipPose.set(bone, bone.quaternion.clone()); });
    this.up = new THREE.Vector3(0, 1, 0);
    this.ghost = ghost;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.mode = 'ground';
    this.vy = 0;
    this.balance = { beam: null, lean: 0, facing: 1 };
    this.tilt = { toppling: 0 };
    this.fall = { active: false };
    this.skate = { busy: false, flail: 0 };
    this.safe = { pos: new THREE.Vector3(), yaw: 0 };
    this.squash = 1;
    this.hang = 0;
    this.celebrate = 0;
    this.phase = seconds(replay.phase);
    this.duration = seconds(replay.samples.at(-1)[0]);
    const durations = new Map([...this.animator.actions].map(([name, action]) => [name, action.getClip().duration]));
    this.motion = new ReplayMotion(replay, world, this.rig, durations);
    this.headings = this.motion.motion.map(m => m.yaw);
    this.safeAt = this.buildSafeSamples();
    this.lost = this.motion.lost;
    this.summits = this.motion.summits;
    if (ghost) this.applyGhostMaterial();
  }

  buildSafeSamples() {
    let safe = 0;
    return this.replay.samples.map((sample, index) => {
      if (sample[7] === 0 && sample[9] >= 0) {
        const solid = this.world.solids?.[sample[9]];
        if (!solid?.moving && !solid?.loose) safe = index;
      }
      return safe;
    });
  }

  applyGhostMaterial() {
    this.root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = Math.min(material.opacity ?? 1, GHOST_OPACITY);
        material.depthWrite = false;
        if (material.userData?.outlineParameters) material.userData.outlineParameters.alpha = GHOST_OPACITY;
        material.needsUpdate = true;
      }
    });
  }

  seek(time) {
    if (!Number.isFinite(time)) throw new TypeError('Replay time must be finite seconds');
    const samples = this.replay.samples;
    const boundedTime = Math.max(0, time);
    const bracket = locate(samples, boundedTime * 1000);
    const state = sampleReplay(this.replay, boundedTime);
    this.pos.set(state.x, state.y, state.z);
    this.vel.set(state.vx, 0, state.vz);
    this.vy = state.vy;
    this.mode = state.mode;
    this.balance.beam = state.mode === 'beam' ? this.world.beams?.[state.support] ?? null : null;
    this.squash = 1;

    const lo = bracket.lo;
    const motion = this.motion.seek(boundedTime);
    this.yaw = motion.yaw;

    const safeIndex = this.safeAt[lo];
    const safeSample = samples[safeIndex] ?? samples[0];
    this.safe.pos.set(safeSample[1] / 1000, safeSample[2] / 1000, safeSample[3] / 1000);
    this.safe.yaw = this.headings[safeIndex] ?? 0;

    const lost = lastEvent(this.lost, boundedTime);
    this.hang = this.mode === 'out' && lost ? Math.max(0, 0.5 - (boundedTime - lost.time)) : 0;
    const summit = lastEvent(this.summits, boundedTime);
    this.celebrate = summit ? Math.max(0, 4 - (boundedTime - summit.time)) : 0;

    // AnimationMixer skips identical property writes. Restore the last unmodified clip pose first, or seeking
    // a paused frame would apply Pose's balancing rotations on top of themselves every time.
    for (const [bone, quaternion] of this.clipPose) bone.quaternion.copy(quaternion);
    this.animateAt(motion);
    for (const [bone, quaternion] of this.clipPose) quaternion.copy(bone.quaternion);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(this.up, this.yaw);
    this.root.scale.set(1, this.squash, 1);
    // Reuse the live balancing stance, evaluated at absolute time rather than accumulating a procedural pose.
    if (this.pose) {
      this.pose.time = boundedTime;
      this.pose.beam = motion.beamWeight;
      this.pose.panic = 0;
      const beam = this.world.beams?.[motion.beamSupport];
      this.pose.stance = beam ? Math.max(0, Math.min(0.13, beam.width / 2 - 0.08)) : 0;
      this.pose.update(0, this);
    }
    return this;
  }

  animateAt({ weights, clipTimes }) {
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
    let dominant = null, largest = 0;
    for (const [name, action] of this.animator.actions) {
      const weight = (weights[name] ?? 0) / total;
      this.animator.weights.set(name, weight);
      // Keep a fixed mixer action order, including zero-weight actions. Removing/re-adding faded clips changes
      // quaternion blend order and can capture a procedural beam pose as the mixer's fallback/rest pose on seeks.
      action.reset().play();
      action.time = animationTime(name, clipTimes[name] ?? 0, action.getClip().duration);
      action.setEffectiveTimeScale(0);
      action.setEffectiveWeight(weight);
      if (weight > largest) { largest = weight; dominant = name; }
    }
    this.animator.current = dominant;
    this.animator.mixer.update(0);
  }

  dispose() {
    this.scene.remove(this.root);
    this.animator.mixer.stopAllAction();
    this.animator.mixer.uncacheRoot(this.model);
    this.root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // Material.dispose() releases this actor's material state; the shared toon gradient textures stay alive.
      for (const material of materials) material.dispose?.();
    });
  }
}
