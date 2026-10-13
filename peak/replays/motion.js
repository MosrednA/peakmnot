// Absolute replay motion and clip blends. Integrate stride phase once instead of multiplying the clock by
// changing speed; the same timestamp always gives the same heading, feet and blend, even after a backward seek.
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const BLEND_RATE = 18, TURN_RATE = 14, MAX_TURN = 7;

function turn(from, target, dt) {
  const angle = wrap(target - from), distance = Math.abs(angle), threshold = MAX_TURN / TURN_RATE;
  const linearTime = Math.max(0, (distance - threshold) / MAX_TURN);
  const remaining = dt <= linearTime ? distance - MAX_TURN * dt : Math.min(distance, threshold) * Math.exp(-TURN_RATE * (dt - linearTime));
  return from + Math.sign(angle) * (distance - remaining);
}

function indexAt(rows, time, value = row => row.time) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value(rows[mid]) <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

// Exact damp toward a linearly changing target, including the fractional interval between recorded samples.
function damp(from, a, b, dt, elapsed, rate) {
  if (dt <= 0) return from;
  const slope = (b - a) / dt;
  return a + slope * (elapsed - 1 / rate) + (from - a + slope / rate) * Math.exp(-rate * elapsed);
}

export class ReplayMotion {
  constructor(replay, world, rig, durations) {
    this.samples = replay.samples;
    this.rig = rig;
    this.durations = durations;
    this.jumps = [];
    this.landings = [];
    this.lost = [];
    this.summits = [];
    let heading = 0, beamSupport = -1;
    this.motion = this.samples.map((s, i, samples) => {
      const time = s[0] / 1000;
      let vx = s[4] / 1000, vz = s[5] / 1000;
      if (s[7] === 2) {
        beamSupport = s[9];
        const before = samples[i - 1], after = samples[i + 1];
        const sameBeam = other => other && other[7] === 2 && other[9] === s[9] && other[0] !== s[0];
        const a = sameBeam(before) ? before : s, b = sameBeam(after) ? after : s;
        const dt = b[0] - a[0], dir = world.beams?.[s[9]]?.dir;
        vx = dt > 0 ? (b[1] - a[1]) / dt : 0;
        vz = dt > 0 ? (b[3] - a[3]) / dt : 0;
        // Entry offsets and rope sway are sideways motion, not where the balancing can faces or steps.
        if (dir) {
          const along = vx * dir.x + vz * dir.z;
          const facing = Math.abs(along) > 0.03 ? Math.sign(along) : Math.sign(Math.sin(heading) * dir.x + Math.cos(heading) * dir.z) || 1;
          heading = Math.atan2(dir.x * facing, dir.z * facing);
          vx = dir.x * along; vz = dir.z * along;
        }
      }
      const speed = Math.hypot(vx, vz);
      if (s[7] !== 2 && speed > 0.08) heading = Math.atan2(vx, vz);
      const event = { time, sample: s };
      if (s[8] & 1) {
        event.clip = speed > 0.25 ? 'LeapStart' : 'JumpStart';
        event.takeoff = event.clip === 'LeapStart' ? rig.leap_takeoff : rig.jump_takeoff;
        // Coyote jumps start already airborne; regular jumps anticipate the recorded launch by the rig's crouch.
        event.start = Math.max(samples[i - 1]?.[0] / 1000 || 0, time - event.takeoff);
        if (samples[i - 1]?.[7] === 1) event.start = time;
        this.jumps.push(event);
      }
      if (s[8] & 2) {
        const hard = (replay.events ?? []).some(([at, name, value]) => at === s[0] && name === 'dent' && value === 'landing');
        event.clip = hard ? 'LandHard' : speed > 0.25 ? 'LeapLand' : 'Land';
        event.end = time + (hard ? 0.5 : 0.1);
        this.landings.push(event);
      }
      if (s[8] & 16) this.lost.push(event);
      if (s[8] & 128) this.summits.push(event);
      return { time, speed, target: heading, yaw: heading, phase: 0, beamSupport, beamWeight: i === 0 && s[7] === 2 ? 1 : 0 };
    });
    for (let i = 1; i < this.motion.length; i++) {
      const a = this.motion[i - 1], b = this.motion[i], dt = b.time - a.time;
      b.yaw = this.samples[i][8] & 32 ? b.target : turn(a.yaw, a.target, dt);
      b.phase = a.phase + this.phaseBetween(i - 1, dt);
      const beamTarget = this.samples[i - 1][7] === 2 ? 1 : 0;
      b.beamWeight = beamTarget + (a.beamWeight - beamTarget) * Math.exp(-8 * dt);
      if (this.samples[i][8] & 32) b.beamWeight = 0;
    }

    // Add clip boundaries between the 10 Hz samples so short takeoffs and landings blend at their real times.
    const times = new Set(this.motion.map(m => m.time));
    for (const e of this.jumps) { times.add(e.start); times.add(e.time + this.duration(e.clip) - e.takeoff); }
    for (const e of this.landings) times.add(e.end);
    for (const e of this.lost) { times.add(e.time + 0.28); times.add(e.time + 0.5); }
    for (const e of this.summits) times.add(e.time + 4);
    this.blends = [...times].filter(t => t >= this.motion[0].time)
      .sort((a, b) => a - b).map(time => ({ time, weights: this.targetAt(time) }));
    for (let i = 1; i < this.blends.length; i++) {
      const a = this.blends[i - 1], b = this.blends[i];
      b.weights = this.blendAt(a, b.time, b.time - 1e-7);
      const sample = this.samples[indexAt(this.samples, b.time * 1000, s => s[0])];
      if (sample[0] === Math.round(b.time * 1000) && sample[8] & 32) b.weights = this.targetAt(b.time);
    }
  }

  duration(name) { return this.durations.get(name) ?? 0; }
  eventAt(events, time) { return events[indexAt(events, time)] ?? null; }

  paceAt(time) {
    const i = Math.max(0, indexAt(this.motion, time)), a = this.motion[i], b = this.motion[i + 1];
    const mode = this.samples[i][7];
    const speed = b && !(this.samples[i + 1][8] & 32) && mode !== 3 ?
      lerp(a.speed, b.speed, Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)))) : !b && time > a.time ? 0 : a.speed;
    return { i, mode, speed };
  }

  gait(speed, mode) {
    const moving = smooth(0.03, 0.12, speed), run = mode === 2 ? 0 : smooth(0.85, 1.5, speed);
    return { Idle: 1 - moving, Walk: moving * (1 - run), Run: moving * run };
  }

  phaseBetween(i, elapsed) {
    const a = this.motion[i], b = this.motion[i + 1], mode = this.samples[i][7];
    if (!b || elapsed <= 0 || ![0, 2].includes(mode) || this.samples[i + 1][8] & 32) return 0;
    const dt = b.time - a.time;
    if (dt <= 0) return 0;
    // Fixed positive frequency knots make the integral monotonic, including the last few frames of a stop.
    // Resampling a quadrature over each partial interval can otherwise make phase creep backwards near zero speed.
    if (!a.rates) {
      a.rates = Array.from({ length: 9 }, (_, n) => {
        const speed = lerp(a.speed, b.speed, n / 8), run = mode === 2 ? 0 : smooth(0.85, 1.5, speed);
        const stride = lerp(this.rig.walk_speed * this.duration('Walk'), this.rig.run_speed * this.duration('Run'), run);
        return speed / Math.max(0.1, stride);
      });
      a.areas = [0];
      for (let n = 1; n <= 8; n++) a.areas.push(a.areas[n - 1] + (a.rates[n - 1] + a.rates[n]) / 2 * dt / 8);
    }
    const slice = Math.max(0, Math.min(8, elapsed / dt * 8)), n = Math.min(7, Math.floor(slice)), u = slice - n;
    return a.areas[n] + (a.rates[n] + lerp(a.rates[n], a.rates[n + 1], u)) / 2 * u * dt / 8;
  }

  targetAt(time) {
    const { mode, speed } = this.paceAt(time);
    const summit = this.eventAt(this.summits, time);
    if (summit && time - summit.time < 4) return { Dance: 1 };
    const nextJump = this.jumps[indexAt(this.jumps, time) + 1];
    if (nextJump && time >= nextJump.start && mode !== 3) return { [nextJump.clip]: 1 };
    const jump = this.eventAt(this.jumps, time);
    if (mode === 1) return jump && time < jump.time + this.duration(jump.clip) - jump.takeoff ? { [jump.clip]: 1 } : { Fall: 1 };
    if (mode === 3) {
      const lost = this.eventAt(this.lost, time), elapsed = lost ? time - lost.time : 0;
      return { [elapsed < 0.28 ? 'Run' : elapsed < 0.5 ? 'Idle' : 'Fall']: 1 };
    }
    const landing = this.eventAt(this.landings, time);
    if (mode !== 2 && landing && time < landing.end) return { [landing.clip]: 1 };
    return this.gait(speed, mode);
  }

  blendAt(a, time, end = time) {
    const first = this.targetAt(a.time), last = this.targetAt(end), dt = time - a.time, weights = {};
    for (const name of new Set([...Object.keys(a.weights), ...Object.keys(first), ...Object.keys(last)])) {
      weights[name] = Math.max(0, damp(a.weights[name] ?? 0, first[name] ?? 0, last[name] ?? 0, dt, dt, BLEND_RATE));
    }
    return weights;
  }

  seek(time) {
    // A race ghost can finish before the player. Its path holds at the final sample, but the summit dance goes on.
    time = Math.max(this.motion[0].time, time);
    const { i, mode, speed } = this.paceAt(time), a = this.motion[i], elapsed = time - a.time;
    const phase = a.phase + this.phaseBetween(i, elapsed);
    const blend = this.blends[Math.max(0, indexAt(this.blends, time))];
    const weights = time === blend.time ? blend.weights : this.blendAt(blend, time);
    const jump = this.eventAt(this.jumps, time) ?? this.jumps[0];
    const nextJump = this.jumps[indexAt(this.jumps, time) + 1];
    const launch = nextJump && time >= nextJump.start ? nextJump : jump;
    const landing = this.eventAt(this.landings, time), lost = this.eventAt(this.lost, time), summit = this.eventAt(this.summits, time);
    const clipTimes = {
      Idle: time, Walk: phase * this.duration('Walk'), Run: phase * this.duration('Run'),
      JumpStart: launch ? Math.max(0, time - launch.time + launch.takeoff) : 0,
      LeapStart: launch ? Math.max(0, time - launch.time + launch.takeoff) : 0,
      Land: landing ? time - landing.time : 0, LeapLand: landing ? time - landing.time : 0,
      LandHard: landing ? time - landing.time : 0,
      Fall: mode === 3 && lost ? Math.max(0, time - lost.time - 0.5) : jump ? Math.max(0, time - jump.time - this.duration(jump.clip) + jump.takeoff) : time,
      Dance: summit ? time - summit.time : 0,
    };
    if (mode === 3 && lost) clipTimes.Run = (time - lost.time) * 1.8;
    const beamTarget = mode === 2 ? 1 : 0;
    const beamWeight = beamTarget + (a.beamWeight - beamTarget) * Math.exp(-8 * elapsed);
    return { yaw: turn(a.yaw, a.target, elapsed), phase, speed, weights, clipTimes,
      beamWeight, beamSupport: a.beamSupport };
  }
}
