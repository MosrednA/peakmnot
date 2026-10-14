// Run with node --test tools/check_games_analytics.mjs: the goals of the page of all the games
// (peak/games/analytics.js) and the links in games.html that name them. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hookAnalytics } from '../peak/games/analytics.js';

// a page that hands its listeners a click on a link with data-goal (or on something else)
function page({ host = 'peakmnot.mosredna.eu', tracker } = {}) {
  const events = [], doc = new EventEmitter();
  doc.addEventListener = (type, fn) => doc.on(type, fn);
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  hookAnalytics(doc);
  const click = (goal, { type = 'click', button = 0 } = {}) => doc.emit(type, { type, button,
    target: { closest: selector => goal && selector === 'a[data-goal]' ? { dataset: { goal } } : null } });
  return { doc, events, click };
}

test('a click on a game or the viewer counts its goal, the middle button too', () => {
  const { events, click } = page();
  click('Play Climb');
  click('Play Downhill', { type: 'auxclick', button: 1 });
  click('Play Downhill', { type: 'auxclick', button: 2 });     // the right button: a menu, not a visit
  click(null);                                                // the logo, the "soon" card, the page
  click('Viewer');
  assert.deepEqual(events, ['Games: Play Climb', 'Games: Play Downhill', 'Games: Viewer']);
});

test('localhost and staging do not subscribe', () => {
  for (const host of ['localhost', '127.0.0.1', 'staging.example']) {
    const { doc, events, click } = page({ host });
    assert.equal(doc.listenerCount('click') + doc.listenerCount('auxclick'), 0);
    click('Play Climb');
    assert.deepEqual(events, []);
  }
});

test('a missing or throwing tracker cannot stop the link', () => {
  let run = page();
  delete window.plausible;
  assert.doesNotThrow(() => run.click('Play Climb'));
  run = page({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => run.click('Play Downhill'));
});

test('every game card and the viewer link name a goal', () => {
  const html = readFileSync(new URL('../games.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a class="(game|viewer) card"[^>]*>/g)].map(match => match[0]);
  assert.ok(links.length >= 3);
  for (const link of links) assert.match(link, /data-goal="[A-Z][A-Za-z ]+"/, link);
  assert.ok(html.includes('<script type="module" src="peak/games/main.js"></script>'));
  const main = readFileSync(new URL('../peak/games/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes('hookAnalytics(document)'));
});
