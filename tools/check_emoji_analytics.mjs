// Run with node --test tools/check_emoji_analytics.mjs: Reaction Run's goals (peak/emoji/analytics.js) and the
// tracker in emoji.html's head. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hookAnalytics } from '../peak/emoji/analytics.js';

function game({ host = 'peakmnot.mosredna.eu', manual = false, tracker } = {}) {
  const events = [], title = new EventEmitter();
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  const goals = hookAnalytics({ title, manual });
  return { title, goals, events };
}

test('the start, the list and the finish count once a page, and only in a run after the title', () => {
  const { title, goals, events } = game();
  goals.run();                                     // the field dealt behind the title
  goals.listed();
  goals.finish();
  assert.deepEqual(events, []);
  title.emit('start');
  title.emit('start');
  goals.run();                                     // begin()
  goals.listed();
  goals.listed();
  goals.finish();
  goals.finish();
  goals.hole();                                    // after the finish: the dance, not the run
  goals.run();                                     // R, and fetched again
  goals.listed();
  goals.finish();
  assert.deepEqual(events, ['Reaction Run: Start', 'Reaction Run: List Done', 'Reaction Run: Finish']);
});

test('each mishap counts when it happens, in every run; out ends the run', () => {
  const { title, goals, events } = game();
  title.emit('start');
  goals.run();
  goals.wrong();
  goals.hole();
  goals.hole();
  goals.wrong();
  goals.wrong();
  goals.out();
  goals.out();
  goals.finish();                                  // out: no finish for this run
  goals.run();                                     // N, a new field
  goals.wrong();
  assert.deepEqual(events, ['Reaction Run: Start', 'Reaction Run: Wrong One', 'Reaction Run: Hole',
    'Reaction Run: Hole', 'Reaction Run: Wrong One', 'Reaction Run: Wrong One', 'Reaction Run: Out',
    'Reaction Run: Wrong One']);
});

test('localhost, staging, manual bots and watched runs do not listen or send', () => {
  for (const options of [{ host: 'localhost' }, { host: '127.0.0.1' }, { host: 'staging.example' }, { manual: true }]) {
    const { title, goals, events } = game(options);
    assert.equal(title.listenerCount('start'), 0);
    goals.run();
    goals.wrong();
    goals.finish();
    assert.deepEqual(events, []);
  }
});

test('a missing or throwing tracker cannot break the game', () => {
  let run = game();
  delete window.plausible;
  assert.doesNotThrow(() => { run.title.emit('start'); run.goals.run(); run.goals.wrong(); run.goals.finish(); });
  run = game({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => { run.title.emit('start'); run.goals.run(); run.goals.hole(); run.goals.finish(); });
});

test('the page counts pageviews on the public site only, and not in ?manual', () => {
  const head = readFileSync(new URL('../emoji.html', import.meta.url), 'utf8').split('</head>')[0];
  assert.ok(head.includes('<script async src="https://stats.mosredna.eu/js/pa-2BZDJF6nKHv_ruimg75Ar.js"></script>'));
  const init = head.match(/plausible\.init\(\{ autoCapturePageviews: (.+) \}\);/)?.[1];
  assert.equal(init, "location.hostname === 'peakmnot.mosredna.eu' && !new URLSearchParams(location.search).has('manual')");
});

test('the game hooks its goals in, a watched run as manual', () => {
  const main = readFileSync(new URL('../peak/emoji/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes('hookAnalytics({ title, manual: manual || watching })'));
  for (const call of ['run', 'listed', 'wrong', 'out', 'hole', 'finish']) {
    assert.ok(main.includes(`analytics.${call}();`), call);
  }
});
