// Node checks for the replay's pure sampler and v1 validation. Import through a data URL so the browser-only
// Three.js imports stay lazy and this check runs without a package.json or installed node modules.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ReplayMotion } from '../peak/replays/motion.js';

const source = await readFile(new URL('../peak/replays/playback.js', import.meta.url), 'utf8');
const motionUrl = new URL('../peak/replays/motion.js', import.meta.url).href;
const moduleSource = `${source.replace("'./motion.js'", JSON.stringify(motionUrl))}\n//# sourceURL=replay-playback.js`;
const { animationTime, sampleReplay, validateReplay } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

const row = (t, x, { vx = 1000, mode = 0, flags = 0, support = 0 } = {}) =>
  [t, x, 0, 0, vx, 0, 0, mode, flags, support];
const replay = (samples, overrides = {}) => ({
  v: 1, route: 'route-a', phase: 250, samples,
  inputs: [[samples[0][0], 0], [samples.at(-1)[0], 0]], events: [], ...overrides,
});

test('samples clamp before the start and after the finish', () => {
  const data = replay([row(100, 500), row(1100, 1500)]);
  assert.equal(sampleReplay(data, -4).x, 0.5);
  assert.equal(sampleReplay(data, 40).x, 1.5);
});

test('a seek at every stored sample returns its recorded state exactly', () => {
  const samples = [
    [0, 20, 100, 30, 0, 0, 0, 0, 0, 4],
    [170, 110, 120, 50, 900, 50, 100, 0, 0, 4],
    [630, 700, 250, 90, 1100, 90, -300, 1, 1, -1],
    [1000, 1050, 100, 120, 500, 0, 0, 0, 2, 5],
  ];
  const data = replay(samples);
  for (const sample of samples) {
    const at = sampleReplay(data, sample[0] / 1000);
    assert.deepEqual([at.x, at.y, at.z, at.vx, at.vz, at.vy, at.mode, at.flags, at.support], [
      sample[1] / 1000, sample[2] / 1000, sample[3] / 1000, sample[4] / 1000, sample[5] / 1000,
      sample[6] / 1000, ['ground', 'air', 'beam', 'out'][sample[7]], sample[8], sample[9],
    ]);
  }
});

test('Hermite interpolation follows recorded velocity and supports backward seeks', () => {
  const data = replay([row(0, 0), row(1000, 1000)]);
  const forward = sampleReplay(data, 0.75);
  const backward = sampleReplay(data, 0.25);
  assert.ok(Math.abs(forward.x - 0.75) < 1e-9);
  assert.ok(Math.abs(backward.x - 0.25) < 1e-9);
  assert.ok(Math.abs(sampleReplay(data, 0.75).x - forward.x) < 1e-9);
});

test('does not blend through a respawn boundary', () => {
  const data = replay([row(0, 0), row(1000, 10000, { flags: 32 })]);
  assert.equal(sampleReplay(data, 0.5).x, 0);
  assert.equal(sampleReplay(data, 1).x, 10);
});

test('holds through out gaps and resumes at the next recorded sample', () => {
  const data = replay([row(0, 0), row(1000, 1000, { mode: 3, vx: 0, support: -1 }),
    row(3000, 9000, { flags: 32 })]);
  const beforeOut = sampleReplay(data, 0.5);
  const outGap = sampleReplay(data, 2);
  assert.equal(beforeOut.x, 0);
  assert.equal(beforeOut.mode, 'ground');
  assert.equal(outGap.x, 1);
  assert.equal(outGap.mode, 'out');
  assert.equal(sampleReplay(data, 3).x, 9);
});

test('accepts verifier-valid duplicate timestamps and uses the latest state at that instant', () => {
  const data = replay([row(0, 0), row(500, 100), row(500, 200), row(1000, 700)]);
  assert.equal(validateReplay(data, 'route-a'), data);
  assert.equal(sampleReplay(data, 0.5).x, 0.2);
  assert.ok(sampleReplay(data, 0.5001).x >= 0.2);
  const duplicateStart = replay([row(0, 0), row(0, 400), row(1000, 1000)]);
  assert.equal(sampleReplay(duplicateStart, -0.1).x, 0);
  assert.equal(sampleReplay(duplicateStart, 0).x, 0.4);
});

test('loads the public API shape with no inputs and does not need input history to sample', () => {
  const privateRun = replay([row(0, 0), row(1000, 1000)]);
  const { inputs, ...publicRun } = privateRun;
  assert.equal('inputs' in publicRun, false);
  assert.equal(validateReplay(publicRun, 'route-a'), publicRun);
  assert.equal(sampleReplay(publicRun, 0.5).x, 0.5);
});

test('uses absolute animation time, wrapping loops and clamping one-shots', () => {
  assert.equal(animationTime('Run', 4.25, 1.5), 1.25);
  assert.equal(animationTime('Idle', 3.2, 1.6), 0);
  assert.equal(animationTime('LeapStart', 4, 0.8), 0.8);
});

const rig = { walk_speed: 0.625, run_speed: 2.08, jump_takeoff: 0.12, leap_takeoff: 0.12 };
const durations = new Map([['Idle', 2], ['Walk', 0.8], ['Run', 0.5333333], ['JumpStart', 0.3333333],
  ['LeapStart', 0.8], ['Land', 0.3333333], ['LeapLand', 0.2333333], ['LandHard', 0.8], ['Fall', 0.8], ['Dance', 4]]);
const motionFor = data => new ReplayMotion(data, { beams: [{ dir: { x: 1, z: 0 } }] }, rig, durations);

test('beam samples with zero stored velocity move at a steady pace between measurements', () => {
  const data = replay([row(0, 0, { mode: 2, vx: 0 }), row(100, 50, { mode: 2, vx: 0 }),
    row(200, 100, { mode: 2, vx: 0 })]);
  const motion = motionFor(data);
  for (const t of [0, 0.025, 0.05, 0.075, 0.1, 0.15]) {
    assert.ok(Math.abs(sampleReplay(data, t).x - t * 0.5) < 1e-9);
    assert.ok(Math.abs(motion.seek(t).phase - t) < 1e-9);
    assert.ok(Math.abs(motion.seek(t).weights.Walk - 1) < 1e-9);
  }
});

test('supported heights do not sag before a launch or when riding a rising platform', () => {
  const data = replay([[0, 0, 1000, 0, 0, 0, 0, 0, 0, 0], [100, 0, 1000, 0, 0, 0, 4900, 1, 1, -1]]);
  assert.equal(sampleReplay(data, 0.05).y, 1);
  data.samples[1] = [100, 0, 1100, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(sampleReplay(data, 0.025).y, 1.025);
});

test('stride phase advances continuously through acceleration, stops and gait changes', () => {
  const data = replay([row(0, 0, { vx: 0 }), row(100, 50, { vx: 600 }), row(200, 170, { vx: 1800 }),
    row(300, 340, { vx: 2000 }), row(400, 440, { vx: 0 }), row(500, 440, { vx: 0 })]);
  const motion = motionFor(data);
  let previous = 0;
  for (let frame = 0; frame <= 120; frame++) {
    const at = motion.seek(frame / 240);
    assert.ok(at.phase >= previous - 1e-9);
    assert.ok(at.phase - previous < 0.03);
    assert.ok(Math.abs(Object.values(at.weights).reduce((a, b) => a + b, 0) - 1) < 1e-8);
    previous = at.phase;
  }
  assert.equal(motion.seek(0.5).phase, motion.seek(0.4).phase);
});

test('about-turns and the pi seam stay continuous and respect the turn speed', () => {
  const data = replay([row(0, 0), row(100, 100, { vx: -1000 }), row(200, 0, { vx: -1000 }),
    row(700, -500, { vx: -1000 })]);
  const motion = motionFor(data);
  let previous = motion.seek(0).yaw;
  for (let frame = 1; frame <= 42; frame++) {
    const yaw = motion.seek(frame / 60).yaw;
    assert.ok(Math.abs(Math.atan2(Math.sin(yaw - previous), Math.cos(yaw - previous))) <= 7 / 60 + 1e-9);
    previous = yaw;
  }
});

test('jump crouches anticipate launch and clip changes blend without a hard cut', () => {
  const data = replay([row(0, 0), row(100, 100), row(200, 200, { mode: 1, flags: 1 }),
    row(300, 300, { mode: 1 }), row(800, 800, { mode: 1 }), row(900, 900, { flags: 2 }), row(1100, 1100)]);
  const motion = motionFor(data);
  const crouch = motion.seek(0.15);
  assert.ok(crouch.weights.LeapStart > 0 && crouch.weights.LeapStart < 1);
  assert.ok(Math.abs(motion.seek(0.2).clipTimes.LeapStart - rig.leap_takeoff) < 1e-9);
  const before = motion.seek(0.899999).weights, after = motion.seek(0.900001).weights;
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    assert.ok(Math.abs((before[name] ?? 0) - (after[name] ?? 0)) < 1e-4);
  }
});

test('pause, backward seeks and different frame rates reproduce the same phase and blends', () => {
  const data = replay([row(0, 0), row(100, 100, { vx: 1900 }), row(200, 290, { vx: 400 }), row(400, 370, { vx: 0 })]);
  const motion = motionFor(data), expected = motion.seek(0.23);
  for (const fps of [30, 60, 144]) {
    for (let t = 0; t <= 0.4; t += 1 / fps) motion.seek(t);
    motion.seek(0.01);
    assert.deepEqual(motion.seek(0.23), expected);
    assert.deepEqual(motion.seek(0.23), expected);
  }
});

test('a finished race ghost continues its summit dance without taking more steps', () => {
  const motion = motionFor(replay([row(0, 0), row(1000, 1000, { flags: 128 })]));
  assert.equal(motion.seek(2).phase, motion.seek(1).phase);
  assert.equal(motion.seek(2).clipTimes.Dance, 1);
  assert.ok(motion.seek(2).weights.Dance > 0.99);
  assert.ok(motion.seek(6).weights.Idle > 0.99);
});

test('duplicate timestamps, out gaps and respawns keep motion finite without phantom strides', () => {
  const data = replay([row(0, 0), row(100, 100), row(100, 100, { mode: 3, flags: 16 }),
    row(3000, 10000, { flags: 32 }), row(3100, 10100)]);
  const motion = motionFor(data);
  assert.equal(motion.seek(2).phase, motion.seek(0.1).phase);
  for (const t of [0, 0.1, 0.5, 2, 2.999, 3, 3.05]) {
    const state = motion.seek(t);
    assert.ok(Number.isFinite(state.yaw) && Number.isFinite(state.phase));
    assert.ok(Object.values(state.weights).every(Number.isFinite));
  }
  assert.deepEqual(motion.seek(3).weights, motion.targetAt(3));
});

test('rejects version, route, sample-shape and timestamp mismatches with useful errors', () => {
  const valid = replay([row(0, 0), row(1000, 1000)]);
  assert.equal(validateReplay(valid, 'route-a'), valid);
  assert.throws(() => validateReplay({ ...valid, v: 2 }, 'route-a'), /version 2/);
  assert.throws(() => validateReplay(valid, 'route-b'), /route fingerprint mismatch/);
  assert.throws(() => validateReplay(replay([[0, 1, 2], [1, 1, 2]]), 'route-a'), /10 fields/);
  assert.throws(() => validateReplay(replay([row(1000, 1), row(500, 2)]), 'route-a'), /timestamp/);
  assert.throws(() => validateReplay(replay([row(0, 1), row(1000.5, 2)]), 'route-a'), /safe integers/);
  assert.throws(() => validateReplay(replay([row(0, NaN), row(1000, 2)]), 'route-a'), /safe integers/);
  assert.throws(() => validateReplay(replay([row(0, 1000001), row(1000, 2)]), 'route-a'), /out-of-range position/);
  assert.throws(() => sampleReplay(valid, NaN), /finite seconds/);
});
