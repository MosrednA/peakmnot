// TEMPLATE for tools/check_<game>_analytics.mjs: replace "mygame" and "My Game". Run with
// node --test tools/check_mygame_analytics.mjs: the game's goals (peak/mygame/analytics.js) and the tracker in its
// page's head. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hookAnalytics } from '../peak/mygame/analytics.js';

function game({ host = 'peakmnot.mosredna.eu', manual = false, tracker } = {}) {
  const events = [], title = new EventEmitter();
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  const goals = hookAnalytics({ title, manual });
  return { title, goals, events };
}

test('the start and the finish count once a page, the finish only after a start', () => {
  const { title, goals, events } = game();
  goals.finish();
  title.emit('start');
  title.emit('start');
  goals.finish();
  goals.finish();
  assert.deepEqual(events, ['My Game: Start', 'My Game: Finish']);
});

test('localhost, staging and manual bots do not listen or send', () => {
  for (const options of [{ host: 'localhost' }, { host: '127.0.0.1' }, { host: 'staging.example' }, { manual: true }]) {
    const { title, goals, events } = game(options);
    assert.equal(title.listenerCount('start'), 0);
    goals.finish();
    assert.deepEqual(events, []);
  }
});

test('a missing or throwing tracker cannot break the game', () => {
  let run = game();
  delete window.plausible;
  assert.doesNotThrow(() => { run.title.emit('start'); run.goals.finish(); });
  run = game({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => { run.title.emit('start'); run.goals.finish(); });
});

test('the page counts pageviews on the public site only, and not in ?manual', () => {
  const head = readFileSync(new URL('../mygame.html', import.meta.url), 'utf8').split('</head>')[0];
  assert.ok(head.includes('<script async src="https://stats.mosredna.eu/js/pa-2BZDJF6nKHv_ruimg75Ar.js"></script>'));
  const init = head.match(/plausible\.init\(\{ autoCapturePageviews: (.+) \}\);/)?.[1];
  assert.equal(init, "location.hostname === 'peakmnot.mosredna.eu' && !new URLSearchParams(location.search).has('manual')");
});
