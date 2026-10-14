// Physical mix contracts, PCM masters and browser AAC assets, without a browser or audio hardware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { downhillLoopMix } from '../peak/downhill/sfx.js';

const state = { active: true, speed: 20, grounded: true, surface: 'piste', brake: 0, spin: 0, missing: 0 };
const mix = overrides => downhillLoopMix({ ...state, ...overrides });

test('a stopped or inactive ride has no rolling, wind, brake or scrape', () => {
  assert.ok([...mix({ active: false, brake: 1, missing: 3, spin: 15 }).values()].every(t => t.gain === 0));
  assert.ok([...mix({ speed: 0, brake: 1, missing: 3 }).values()].every(t => t.gain === 0));
});

test('airborne chairs lose ground contact but keep wind and swivel', () => {
  const air = mix({ grounded: false, spin: 10, missing: 3, brake: 1 });
  for (const id of ['roll-piste', 'roll-ice', 'roll-bank', 'roll-powder', 'brake', 'scrape']) assert.equal(air.get(id).gain, 0);
  assert.ok(air.get('wind').gain > mix({}).get('wind').gain);
  assert.ok(air.get('swivel').gain > 0);
});

test('surface changes select one caster loop; powder and ice change friction sound', () => {
  for (const surface of ['piste', 'ice', 'bank', 'powder']) {
    const target = mix({ surface, brake: 1 });
    assert.deepEqual([...target].filter(([id, t]) => id.startsWith('roll-') && t.gain > 0).map(([id]) => id), [`roll-${surface}`]);
  }
  assert.ok(mix({ surface: 'ice', brake: 1 }).get('brake').gain < mix({ brake: 1 }).get('brake').gain);
});

test('lost wheels reduce caster noise and add scraping; braking and spinning scale separately', () => {
  assert.equal(mix({ missing: 5 }).get('roll-piste').gain, 0);
  assert.ok(mix({ missing: 4 }).get('scrape').gain > mix({ missing: 1 }).get('scrape').gain);
  assert.ok(mix({ brake: 1 }).get('brake').gain > mix({ brake: 0.2 }).get('brake').gain);
  assert.equal(mix({ spin: -8 }).get('swivel').gain, mix({ spin: 8 }).get('swivel').gain);
});

test('motion cannot send invalid or unbounded gain and pitch to Web Audio', () => {
  for (const speed of [-5, 0, 2, 28, 1000, Infinity, NaN]) {
    const targets = mix({ speed, spin: speed, brake: speed, missing: speed });
    for (const t of targets.values()) {
      assert.ok(Number.isFinite(t.gain) && t.gain >= 0 && t.gain <= 0.34);
      assert.ok(Number.isFinite(t.rate) && t.rate > 0 && t.rate < 2);
    }
  }
  assert.ok(mix({ speed: 28 }).get('wind').gain > mix({ speed: 6 }).get('wind').gain);
});

test('all thirty-one PCM masters are non-silent, bounded, small and seam-safe', async () => {
  const dir = new URL('../audio/downhill/', import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  assert.equal(manifest.sounds.length, 31);
  let total = 0, loops = 0;
  for (const sound of manifest.sounds) {
    const file = await readFile(new URL(`${sound.id}.wav`, dir)); total += file.length;
    assert.equal(file.toString('ascii', 0, 4), 'RIFF');
    assert.equal(file.toString('ascii', 8, 12), 'WAVE');
    let pcm, format;
    for (let at = 12; at + 8 <= file.length;) {
      const id = file.toString('ascii', at, at + 4), size = file.readUInt32LE(at + 4);
      if (id === 'fmt ') format = file.subarray(at + 8, at + 8 + size);
      if (id === 'data') pcm = file.subarray(at + 8, at + 8 + size);
      at += 8 + size + size % 2;
    }
    assert.equal(format.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(2), 1);
    assert.equal(format.readUInt32LE(4), 22050);
    assert.equal(format.readUInt16LE(14), 16);
    let peak = 0, square = 0;
    for (let at = 0; at < pcm.length; at += 2) {
      const v = pcm.readInt16LE(at) / 32768; peak = Math.max(peak, Math.abs(v)); square += v * v;
    }
    assert.ok(peak <= 0.35004 && peak > 0.01, sound.id);
    assert.ok(Math.sqrt(square / (pcm.length / 2)) > 0.01, sound.id);
    if (sound.loop) {
      loops++;
      assert.equal(pcm.readInt16LE(0), pcm.readInt16LE(pcm.length - 2), `${sound.id} seam`);
      assert.equal(pcm.length / 2 / 22050, 2);
    }
  }
  assert.equal(loops, 8);
  assert.ok(total < 1.5 * 1024 * 1024, total);
});

test('every effect has an AAC browser asset and the palette stays below 300 KiB', async () => {
  const dir = new URL('../audio/downhill/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  let total = 0;
  for (const sound of manifest.sounds) {
    const file = await readFile(new URL(`${sound.id}.m4a`, dir));
    assert.equal(file.toString('ascii', 4, 8), 'ftyp', sound.id);
    total += file.length;
  }
  assert.ok(total < 300 * 1024, total);
});
