// Node checks for the replay's pure sampler and v1 validation. Import through a data URL so the browser-only
// Three.js imports stay lazy and this check runs without a package.json or installed node modules.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../peak/replays/playback.js', import.meta.url), 'utf8');
const moduleSource = `${source}\n//# sourceURL=replay-playback.js`;
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
