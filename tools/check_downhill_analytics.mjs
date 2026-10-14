// Run with node --test tools/check_downhill_analytics.mjs: the downhill's goals (peak/downhill/analytics.js) and the
// tracker in downhill.html and games.html. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { hookAnalytics } from '../peak/downhill/analytics.js';

const PITS = [6, 178, 306, 488, 760];       // FEATURES.pits in peak/downhill/track.js: the start, then the pit stops

function downhill({ host = 'peakmnot.mosredna.eu', manual = false, tracker } = {}) {
  const events = [], title = new EventEmitter(), ride = new EventEmitter();
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  hookAnalytics({ title, ride, pits: PITS, manual });
  return { title, ride, events };
}

test('the title starts once, and pit stops and the finish count once, only in a run', () => {
  const { title, ride, events } = downhill();
  ride.emit('start');
  ride.emit('pit', { s: 178 });
  ride.emit('finish', { time: 60 });
  assert.deepEqual(events, []);
  title.emit('start', { how: 'button' });
  title.emit('start', { how: 'key' });
  ride.emit('pit', { s: 178 });                       // before the gate: not a run yet
  ride.emit('start');
  for (const s of [6, 178, 178, 306, 12, 488, 760]) ride.emit('pit', { s });
  ride.emit('finish', { time: 80 });
  ride.emit('lost', { water: true });                // after the finish: the party, not the run
  ride.emit('start');                                // R, and through the gate again
  ride.emit('pit', { s: 178 });
  ride.emit('finish', { time: 75 });
  assert.deepEqual(events, ['Downhill: Start', 'Downhill: Pit Stop 1', 'Downhill: Pit Stop 2',
    'Downhill: Pit Stop 3', 'Downhill: Pit Stop 4', 'Downhill: Finish']);
});

test('each mishap counts when it happens, in every run', () => {
  const { title, ride, events } = downhill();
  title.emit('start', { how: 'pointer' });
  ride.emit('start');
  ride.emit('lost', { at: {}, water: false });
  ride.emit('lost', { at: {}, water: true });
  ride.emit('wrecked');
  ride.emit('finish', { time: 90 });
  ride.emit('start');
  ride.emit('wrecked');
  assert.deepEqual(events, ['Downhill: Start', 'Downhill: Off-Piste', 'Downhill: Splash', 'Downhill: Wrecked',
    'Downhill: Finish', 'Downhill: Wrecked']);
});

test('localhost, staging and manual bots do not subscribe or send', () => {
  for (const options of [{ host: 'localhost' }, { host: '127.0.0.1' }, { host: 'staging.example' }, { manual: true }]) {
    const { title, ride, events } = downhill(options);
    assert.equal(title.listenerCount('start') + ride.listenerCount('start') + ride.listenerCount('lost'), 0);
    title.emit('start', { how: 'key' });
    ride.emit('finish', { time: 1 });
    assert.deepEqual(events, []);
  }
});

test('a missing or throwing tracker cannot break the ride', () => {
  let run = downhill();
  delete window.plausible;
  assert.doesNotThrow(() => { run.title.emit('start', { how: 'move' }); run.ride.emit('start'); });
  window.plausible = name => run.events.push(name);
  run.ride.emit('pit', { s: 178 });
  assert.deepEqual(run.events, ['Downhill: Pit Stop 1']);
  run = downhill({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => {
    run.title.emit('start', { how: 'key' });
    run.ride.emit('start');
    run.ride.emit('wrecked');
    run.ride.emit('finish', { time: 1 });
  });
});

for (const [page, manualOff] of [['downhill.html', true], ['games.html', false]]) {
  test(`${page}'s head tracker queues events and counts only the public site`, () => {
    const head = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8').split('</head>')[0];
    const tracker = '<script async src="https://stats.mosredna.eu/js/pa-2BZDJF6nKHv_ruimg75Ar.js"></script>';
    assert.ok(head.includes(tracker));
    const inline = [...head.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).find(code => code.includes('plausible.init'));
    assert.ok(inline);
    for (const [hostname, search, enabled] of [
      ['peakmnot.mosredna.eu', '', true], ['peakmnot.mosredna.eu', '?manual', !manualOff],
      ['127.0.0.1', '', false], ['localhost', '', false], ['staging.example', '', false],
    ]) {
      const context = { location: { hostname, search }, URLSearchParams };
      context.window = context;
      runInNewContext(inline, context);
      assert.equal(context.plausible.o.autoCapturePageviews, enabled);
      context.plausible('Downhill: Start');
      assert.equal(context.plausible.q[0][0], 'Downhill: Start');
    }
  });
}
