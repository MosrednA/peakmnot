// Run with node --test tools/check_analytics.mjs. No network calls or live statistics.
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { hookAnalytics } from '../peak/analytics.js';

function climb({ host = 'peakmnot.mosredna.eu', manual = false, tracker } = {}) {
  const events = [], title = new EventEmitter(), game = new EventEmitter(), player = new EventEmitter();
  globalThis.location = { hostname: host };
  globalThis.window = { plausible: tracker ?? (name => events.push(name)) };
  hookAnalytics({ title, game, player, manual });
  return { title, game, player, events };
}

test('the title starts once, and milestones count only during the climb', () => {
  const { title, game, player, events } = climb();
  game.emit('checkpoint', { index: 1 });
  game.emit('summit');
  player.emit('lost', { reason: 'fall' });
  assert.deepEqual(events, []);
  title.emit('start', { how: 'button' });
  title.emit('start', { how: 'move' });
  for (const index of [0, 1, 1, 2, 3, 4, -1, 1.5]) game.emit('checkpoint', { index });
  game.emit('summit');
  game.emit('summit');
  game.emit('checkpoint', { index: 2 });
  player.emit('lost', { reason: 'fall' });
  assert.deepEqual(events, ['Start Climb', 'Checkpoint 1 Reached', 'Checkpoint 2 Reached',
    'Checkpoint 3 Reached', 'Summit Reached']);
});

test('falls and flattening count separately, including repeated losses after respawn', () => {
  const { title, game, player, events } = climb();
  title.emit('start', { how: 'pointer' });
  for (const reason of ['fall', 'flat', 'fall', 'unexpected']) {
    player.emit('lost', { reason, name: 'private', player: 'private' });
    game.emit('respawn', { flat: reason === 'flat' });
  }
  assert.deepEqual(events, ['Start Climb', 'Fall', 'Flattened', 'Fall']);
});

test('localhost, staging and manual bots do not subscribe or send', () => {
  for (const options of [{ host: 'localhost' }, { host: '127.0.0.1' }, { host: 'staging.example' }, { manual: true }]) {
    const { title, game, player, events } = climb(options);
    assert.equal(title.listenerCount('start') + game.listenerCount('checkpoint') + player.listenerCount('lost'), 0);
    title.emit('start', { how: 'key' });
    game.emit('summit');
    assert.deepEqual(events, []);
  }
});

test('a missing, delayed or throwing tracker cannot break the climb', () => {
  let run = climb();
  delete window.plausible;
  assert.doesNotThrow(() => run.title.emit('start', { how: 'move' }));
  window.plausible = name => run.events.push(name);
  run.game.emit('checkpoint', { index: 1 });
  assert.deepEqual(run.events, ['Checkpoint 1 Reached']);
  run = climb({ tracker: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => {
    run.title.emit('start', { how: 'key' });
    run.player.emit('lost', { reason: 'fall' });
    run.game.emit('summit');
  });
});

test('the supplied async head tracker queues events and excludes test pageviews', () => {
  const html = readFileSync(new URL('../peak.html', import.meta.url), 'utf8');
  const head = html.split('</head>')[0];
  assert.match(head, /<script async src="https:\/\/stats\.mosredna\.eu\/js\/pa-2BZDJF6nKHv_ruimg75Ar\.js"><\/script>/);
  const inline = [...head.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(code => code.includes('plausible.init'));
  assert.ok(inline);
  for (const [hostname, search, enabled] of [
    ['peakmnot.mosredna.eu', '', true], ['peakmnot.mosredna.eu', '?manual', false],
    ['127.0.0.1', '', false], ['localhost', '', false], ['staging.example', '', false],
  ]) {
    const context = { location: { hostname, search }, URLSearchParams };
    context.window = context;
    runInNewContext(inline, context);
    assert.equal(context.plausible.o.autoCapturePageviews, enabled);
    context.plausible('Start Climb');
    assert.equal(context.plausible.q[0][0], 'Start Climb');
  }
});
