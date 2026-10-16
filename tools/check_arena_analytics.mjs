// Run with node --test tools/check_arena_analytics.mjs: the arena's goals (peak/arena/analytics.js), where the page
// counts them (peak/arena/main.js) and the tracker in arena.html. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hookAnalytics, GOALS } from '../peak/arena/analytics.js';

function arena({ host = 'peakmnot.mosredna.eu', manual = false, tracker } = {}) {
  const events = [];
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  const moment = hookAnalytics({ manual });
  return { moment, events };
}

test('each moment counts once a page, and nothing else does', () => {
  const { moment, events } = arena();
  for (const goal of ['Join', 'Wave', 'Wave', 'Not Alone', 'Chat', 'Bump', 'Chat', 'Dance', 'Fly', 'Join']) {
    moment(goal);
  }
  assert.deepEqual(events, ['Arena: Join', 'Arena: Wave', 'Arena: Not Alone', 'Arena: Chat', 'Arena: Bump',
    'Arena: Dance']);
});

test('localhost, staging and manual pages do not send', () => {
  for (const options of [{ host: 'localhost' }, { host: '127.0.0.1' }, { host: 'staging.example' }, { manual: true }]) {
    const { moment, events } = arena(options);
    for (const goal of GOALS) moment(goal);
    assert.deepEqual(events, []);
  }
});

test('a missing or throwing tracker cannot break the plaza', () => {
  let run = arena();
  delete window.plausible;
  assert.doesNotThrow(() => { for (const goal of GOALS) run.moment(goal); });
  run = arena({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => { for (const goal of GOALS) run.moment(goal); });
});

test('the page counts every goal somewhere', () => {
  const page = readFileSync(new URL('../peak/arena/main.js', import.meta.url), 'utf8');
  assert.match(page, /const moment = hookAnalytics\(\{ manual \}\);/);
  for (const goal of GOALS) assert.ok(page.includes(`moment('${goal}')`), `main.js counts ${goal}`);
});

test('the page counts pageviews on the public site only, and not in ?manual', () => {
  const head = readFileSync(new URL('../arena.html', import.meta.url), 'utf8').split('</head>')[0];
  assert.ok(head.includes('<script async src="https://stats.mosredna.eu/js/pa-2BZDJF6nKHv_ruimg75Ar.js"></script>'));
  const init = head.match(/plausible\.init\(\{ autoCapturePageviews: (.+) \}\);/)?.[1];
  assert.equal(init, "location.hostname === 'peakmnot.mosredna.eu' && !new URLSearchParams(location.search).has('manual')");
});
