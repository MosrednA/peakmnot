// Samples and displays a recorded climb as an independently animated character. The replay uses the recorder's
// v1 format: millisecond timestamps and millimetre positions and velocities.
const MODES = ['ground', 'air', 'beam', 'out'];
const FLAG_RESPAWN = 32, FLAG_JUMP = 1, FLAG_LAND = 2, FLAG_LOST = 16, FLAG_SUMMIT = 128;
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
  return {
    time: seconds(a[0]) + dt * u,
    x: hermite(a[1] / 1000, a[4] / 1000, b[1] / 1000, b[4] / 1000),
    y: hermite(a[2] / 1000, a[6] / 1000, b[2] / 1000, b[6] / 1000),
    z: hermite(a[3] / 1000, a[5] / 1000, b[3] / 1000, b[5] / 1000),
    vx: lerp(a[4] / 1000, b[4] / 1000),
    vz: lerp(a[5] / 1000, b[5] / 1000),
    vy: lerp(a[6] / 1000, b[6] / 1000),
    mode: MODES[a[7]], flags: a[8], support: a[9],
  };
}

// Pure v1 sampler, in seconds and metres. Hermite tangents come from the recorded velocities. Respawn samples are
// hard boundaries, and the recorder intentionally leaves long gaps while Mnot is out, so those spans hold still.
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
    const [THREE, { loadMnot }] = await Promise.all([import('three'), import('../mnot/mnot.js')]);
    const mnot = await loadMnot();
    const actor = new ReplayActor({ THREE, scene, world, replay, mnot, ghost });
    scene.add(actor.root);
    actor.seek(0);
    return actor;
  }

  constructor({ THREE, scene, world, replay, mnot, ghost }) {
    this.THREE = THREE;
    this.scene = scene;
    this.world = world;
    this.replay = replay;
    this.root = mnot.root;
    this.animator = mnot.animator;
    this.model = mnot.model;
    this.rig = mnot.rig;
    this.ghost = ghost;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.mode = 'ground';
    this.vy = 0;
    this.balance = { beam: null };
    this.safe = { pos: new THREE.Vector3(), yaw: 0 };
    this.squash = 1;
    this.hang = 0;
    this.celebrate = 0;
    this.phase = seconds(replay.phase);
    this.duration = seconds(replay.samples.at(-1)[0]);
    this.headings = this.buildHeadings();
    this.safeAt = this.buildSafeSamples();
    this.jumps = [];
    this.landings = [];
    this.lost = [];
    this.summits = [];
    this.replay.samples.forEach((sample, index) => {
      const event = { time: seconds(sample[0]), index, sample };
      if (sample[8] & FLAG_JUMP) {
        event.run = Math.hypot(sample[4], sample[5]) > 250;
        this.jumps.push(event);
      }
      if (sample[8] & FLAG_LAND) {
        const previous = this.replay.samples[index - 1];
        const hard = (replay.events ?? []).some(([at, name, value]) => at === sample[0] && name === 'dent' && value === 'landing');
        const moving = Math.hypot(sample[4], sample[5]) > 250 || previous && Math.hypot(previous[4], previous[5]) > 250;
        event.clip = hard ? 'LandHard' : moving ? 'LeapLand' : 'Land';
        this.landings.push(event);
      }
      if (sample[8] & FLAG_LOST) this.lost.push(event);
      if (sample[8] & FLAG_SUMMIT) this.summits.push(event);
    });
    if (ghost) this.applyGhostMaterial();
  }

  buildHeadings() {
    let previous = 0;
    return this.replay.samples.map((sample, index, samples) => {
      const vx = sample[4], vz = sample[5];
      if (Math.hypot(vx, vz) > 80) previous = Math.atan2(vx, vz);
      else if (sample[7] === 2 && index > 0) {
        const before = samples[index - 1], dx = sample[1] - before[1], dz = sample[3] - before[3];
        if (Math.hypot(dx, dz) > 20) previous = Math.atan2(dx, dz);
        else if (sample[9] >= 0 && this.world.beams?.[sample[9]]?.dir) {
          const dir = this.world.beams[sample[9]].dir;
          if (dir.lengthSq() > 0) previous = Math.atan2(dir.x, dir.z);
        }
      }
      return previous;
    });
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
    let heading = Math.hypot(state.vx, state.vz) > 0.08 ? Math.atan2(state.vx, state.vz) : this.headings[lo];
    if (state.mode === 'beam' && Math.hypot(state.vx, state.vz) <= 0.08 && bracket.hi !== bracket.lo) {
      const a = samples[bracket.lo], b = samples[bracket.hi];
      const dt = seconds(b[0] - a[0]), dx = (b[1] - a[1]) / 1000, dz = (b[3] - a[3]) / 1000;
      if (dt > 0 && Math.hypot(dx, dz) / dt > 0.08) heading = Math.atan2(dx, dz);
    }
    this.yaw = heading;

    const safeIndex = this.safeAt[lo];
    const safeSample = samples[safeIndex] ?? samples[0];
    this.safe.pos.set(safeSample[1] / 1000, safeSample[2] / 1000, safeSample[3] / 1000);
    this.safe.yaw = this.headings[safeIndex] ?? 0;

    const lost = lastEvent(this.lost, boundedTime);
    this.hang = this.mode === 'out' && lost ? Math.max(0, 0.5 - (boundedTime - lost.time)) : 0;
    const summit = lastEvent(this.summits, boundedTime);
    this.celebrate = summit ? Math.max(0, 4 - (boundedTime - summit.time)) : 0;

    this.animateAt(boundedTime, state, bracket);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(new this.THREE.Vector3(0, 1, 0), this.yaw);
    this.root.scale.set(1, this.squash, 1);
    return this;
  }

  animateAt(time, state, bracket) {
    const speed = Math.hypot(state.vx, state.vz);
    const choose = (name, at = 0) => {
      if (!this.animator.has(name)) return;
      const action = this.animator.actions.get(name), duration = action.getClip().duration;
      const clipTime = animationTime(name, at, duration);
      this.animator.play(name, 0, { restart: true, at: clipTime });
      action.setEffectiveTimeScale(0);
      this.animator.update(0);
    };
    const duration = name => this.animator.actions.get(name)?.getClip().duration ?? 0;

    if (this.celebrate > 0) {
      const event = lastEvent(this.summits, time);
      const clipDuration = duration('Dance');
      choose('Dance', clipDuration ? (time - event.time) % clipDuration : 0);
      return;
    }
    if (state.mode === 'air') {
      const jump = lastEvent(this.jumps, time);
      const launch = jump?.run ? 'LeapStart' : 'JumpStart';
      if (jump && time - jump.time < duration(launch)) choose(launch, time - jump.time);
      else choose('Fall', jump ? time - jump.time - duration(launch) : time);
      return;
    }
    if (state.mode === 'out') {
      const lost = lastEvent(this.lost, time);
      const elapsed = lost ? time - lost.time : 0;
      if (this.hang > 0.22) choose('Run', Math.max(0, (0.5 - this.hang) * 1.8));
      else if (this.hang > 0) choose('Idle', 0);
      else choose('Fall', Math.max(0, elapsed - 0.5));
      return;
    }

    const landing = lastEvent(this.landings, time);
    if (landing && time - landing.time < duration(landing.clip)) {
      choose(landing.clip, time - landing.time);
      return;
    }
    if (state.mode === 'beam') {
      let beamSpeed = speed;
      if (beamSpeed <= 0.03 && bracket.hi !== bracket.lo) {
        const a = this.replay.samples[bracket.lo], b = this.replay.samples[bracket.hi];
        beamSpeed = Math.hypot(b[1] - a[1], b[3] - a[3]) / (b[0] - a[0]);
      }
      if (beamSpeed > 0.03) choose('Walk', time * beamSpeed / Math.max(0.1, this.rig.walk_speed));
      else choose('Idle', time);
      return;
    }
    if (speed < 0.08) choose('Idle', time);
    else if (speed < 1.2) choose('Walk', time * speed / Math.max(0.1, this.rig.walk_speed));
    else choose('Run', time * speed / Math.max(0.1, this.rig.run_speed));
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
