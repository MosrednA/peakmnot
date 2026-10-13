// Node checks for replay contact reconstruction, independent of Three.js and the browser renderer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../peak/replays/loose-ledges.js', import.meta.url), 'utf8');
const { looseLedgeContacts, replayLooseLedges } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const sample = (time, mode = 0, support = 3) => [time, 0, 0, 0, 0, 0, 0, mode, 0, support];

test('uses recorded ground support and ignores air or other solids', () => {
  const samples = [sample(0, 0, 2), sample(100, 1, 3), sample(200, 0, 3), sample(500, 0, 4), sample(700, 0, 3)];
  assert.deepEqual(looseLedgeContacts(samples, 3), [0.2]);
});

test('keeps a contact on the final recorded row and ignores duplicate rows at that time', () => {
  assert.deepEqual(looseLedgeContacts([sample(100), sample(100)], 3), [0.1]);
});

test('repeats contacts from recorded support rows after the ledge has regrown', () => {
  const samples = Array.from({ length: 101 }, (_, index) => sample(index * 100));
  samples.push(sample(10100, 1, -1));
  assert.deepEqual(looseLedgeContacts(samples, 3, { delay: 1.3, gone: 3.2, fall: 1.3, back: 0.35 }), [0, 4.9, 9.8]);
});

test('an early return waits for regrowth and a short support episode cannot trigger later', () => {
  const samples = [sample(0), sample(2000, 1, -1), sample(3000), sample(4000, 1, -1),
    sample(5500), sample(6000, 1, -1)];
  assert.deepEqual(looseLedgeContacts(samples, 3, { delay: 1.3, gone: 3.2, back: 0.35 }), [0, 5.5]);
});

test('maps replay contacts only to animated loose ledges', () => {
  const ledge = { solid: { loose: true }, replayTiming: { delay: 1.3, gone: 3.2, back: 0.35 }, seekReplay() {} };
  const ordinary = { solid: {}, replayTiming: {}, seekReplay() {} };
  const world = { solids: [ordinary.solid, ledge.solid], animated: [ordinary, ledge] };
  const timelines = replayLooseLedges({ samples: [sample(100, 0, 1), sample(500, 1, -1)] }, world);
  assert.deepEqual([...timelines.keys()], [ledge]);
  assert.deepEqual(timelines.get(ledge), [0.1]);
});
