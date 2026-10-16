// Run with Playwright's browser_run_code_unsafe(filename), with the dev server on 5280.
// Reaction Run's Hall of Fame replays (peak/emoji/playback.js): a run played by the autopilot and one recorded for the
// server's tests (server/fixtures/emoji/pits.json.gz: a wrong one, a bonk, cracks, holes, teetering on their edges
// and three drops into them), watched (Mnot on the recording, every event told once, jumps in time, pause and speed,
// the finish) and raced as a ghost. The board and the replay API are routed to them, so no score server is needed.
async (page) => {
  const base = 'http://127.0.0.1:5280';
  const checks = [], errors = [], posts = [], dialogs = [], boards = [];
  const check = (name, pass, evidence) => checks.push({ name, pass: !!pass, evidence });
  const FLAG = { start: 1, take: 2, hit: 4, crack: 8, hole: 16, pit: 32, climb: 64, bonk: 128, finish: 256, rim: 512,
    steady: 1024 };
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/emoji/board')) boards.push(url.pathname);
    if (r.method() === 'POST' && url.pathname.startsWith('/api/')) posts.push(url.pathname);
  });
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.route('https://stats.mosredna.eu/**', route => route.abort());
  await page.route('**/api/emoji/run**', route => route.abort());

  // The runs to play: the autopilot's on a board field, and the server tests' run with everything in it.
  await page.goto(`${base}/emoji.html?manual&seed=11`);
  await page.waitForFunction(() => !!window.emoji?.player, null, { timeout: 60000, polling: 50 });
  const { replay, pits, same } = await page.evaluate(async () => {
    const d = window.emoji;
    d.autopilot(true);
    for (let i = 0; i < 400 && d.scores.recorder.state !== 'done'; i++) d.step(1, 1 / 60);
    const { routeFingerprint } = await import('/peak/emoji/routedata.js');
    const fingerprint = await routeFingerprint(d.board);
    const res = await fetch('/server/fixtures/emoji/pits.json.gz');
    const fixture = JSON.parse(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text());
    return { replay: d.scores.recorder.data(fingerprint, d.seed), pits: fixture.replay,
      same: fixture.replay.route === fingerprint };
  });
  const end = replay.samples.at(-1)[0] / 1000;
  const takes = replay.events.filter(e => e[1] === 'take').length;
  const flagged = (run, flag) => run.samples.filter(s => s[8] & flag).length;
  check('The autopilot fetches the list and :peak-mnot:', replay.seed === 11 && replay.samples.length > 300
    && takes === 5 && flagged(replay, FLAG.finish) === 1, { samples: replay.samples.length, end, takes });
  check('The tests\' recorded run is on this field\'s rules (else export the route and the fixtures again)', same,
    { route: pits.route });

  let delay = 0;
  await page.route('**/api/emoji/replay/**', async route => {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const body = { replay, name: 'Demo Can', time: Math.round(end * 1000) };
    if (id === 'gone-gone-gone') return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (id === 'not-this-field') body.replay = { ...replay, route: 'f'.repeat(64) };
    if (id === 'demo-pits-01') Object.assign(body, { replay: pits, name: 'Demo Pits', time: 102017 });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/emoji/board**', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ total: 2, entries: [
      { rank: 1, name: 'Demo Can', time: 65000, falls: 0, dents: 0, me: false, replayId: 'demo-can-01' },
      { rank: 2, name: '@here', time: 187000, falls: 2, dents: 1, me: false, replayId: null, house: true,
        quip: 'Pinged everyone, fetched nothing.' }] }) }));
  const waitReplay = () => page.waitForFunction(() => {
    const r = window.emoji?.replays;
    return r && (r.ready || r.error);
  }, null, { timeout: 30000, polling: 50 });

  // The Hall of Fame: both buttons on a run, none on a house record; Watch run opens it.
  await page.goto(`${base}/emoji.html?hall=1`);
  await page.waitForFunction(() => [...document.querySelectorAll('.sc-panel.open .sc-list .sc-name')]
    .some(e => e.textContent.trim() === 'Demo Can'), null, { timeout: 30000, polling: 50 });
  const hall = await page.evaluate(() => [...document.querySelectorAll('.sc-panel.open .sc-list li')].map(li => ({
    name: li.querySelector('.sc-name')?.textContent.trim(),
    note: li.querySelector('.sc-replay-note')?.textContent ?? '',
    actions: [...li.querySelectorAll('[data-replay-action]')].map(b => [b.dataset.replayAction, b.dataset.replayId]),
  })));
  check('The Hall offers Race ghost and Watch run on a run, nothing on a house record',
    hall[0]?.actions.map(a => a.join(':')).join(',') === 'ghost:demo-can-01,replay:demo-can-01'
    && hall[1]?.actions.length === 0 && /no replay/.test(hall[1]?.note), hall);
  check('The Hall reads Reaction Run\'s own board', boards.length > 0
    && boards.every(path => path === '/api/emoji/board'), boards);
  await page.click('[data-replay-action="replay"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('replay') === 'demo-can-01', null,
    { timeout: 15000, polling: 50 });
  await waitReplay();
  await page.waitForTimeout(1200);
  const live = await page.evaluate(() => {
    const d = window.emoji, r = d.replays;
    return { ready: r.ready, error: r.error, time: r.time, playing: r.playing, title: d.title.visible, seed: d.seed,
      chip: document.querySelector('.replay-chip')?.textContent };
  });
  check('Watch run plays by itself on the run\'s field, without the title', live.ready && live.playing
    && live.time > 0.3 && !live.title && live.seed === 11 && /^Replay: Demo Can/.test(live.chip), live);
  await page.click('.replay-button >> text=Back to Hall');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('hall') === '1'
    && !new URL(location.href).searchParams.has('replay') && !!document.querySelector('.sc-panel.open .sc-list li'),
  null, { timeout: 30000, polling: 50 });
  check('Back to Hall opens the Hall of Fame again', true, page.url());

  // Watching, step by step: Mnot where the recording is, on its clock, and every event told once, as the run had them
  // (the sounds' cues say which).
  await page.goto(`${base}/emoji.html?manual&replay=demo-pits-01`);
  await waitReplay();
  const watched = await page.evaluate(() => {
    const d = window.emoji, r = d.replays, rec = d.watch.recording, seen = {};
    const st = { pos: new d.THREE.Vector3(), vel: new d.THREE.Vector3() };
    const cue = d.sfx.cue;
    d.sfx.cue = (c) => { seen[c.type] = (seen[c.type] ?? 0) + 1; return cue.call(d.sfx, c); };
    r.seek(0);
    let off = 0, clock = 0, frames = 0;
    while (r.time < r.duration && frames++ < 10000) {
      d.step(0.25, 1 / 60);
      if (r.time >= r.duration) break;          // sliding on past the end
      rec.state(r.time, st);
      off = Math.max(off, Math.hypot(d.player.pos.x - st.pos.x, d.player.pos.z - st.pos.z));
      clock = Math.max(clock, Math.abs(d.player.time - r.time));
    }
    return { ready: r.ready, error: r.error, duration: r.duration, off, clock, seen, done: d.player.done, seed: d.seed,
      api: r.api, chip: document.querySelector('.replay-chip')?.textContent };
  });
  check('Watch run loads the replay from Reaction Run\'s board', watched.ready && !watched.error
    && Math.abs(watched.duration - pits.samples.at(-1)[0] / 1000) < 1e-9 && watched.seed === pits.seed
    && /\/api\/emoji$/.test(watched.api), watched);
  check('The watched Mnot follows the recording, on its clock', watched.off < 1e-6 && watched.clock < 1e-9
    && watched.done, { off: watched.off, clock: watched.clock });
  const count = name => pits.events.filter(e => e[1] === name).length;
  const want = { start: 1, take: count('take'), hit: count('hit'), crack: count('crack'), hole: count('hole'),
    pit: count('pit'), climb: flagged(pits, FLAG.climb), bonk: count('bonk'), teeter: count('rim'),
    steady: flagged(pits, FLAG.steady), peak: 1, finish: 1 };
  const seen = { ...watched.seen, hit: ['early', 'wrong', 'out'].reduce((n, k) => n + (watched.seen[k] ?? 0), 0) };
  check('Every recorded event is told once', want.hit && want.bonk && want.pit && want.teeter
    && Object.entries(want).every(([k, n]) => (seen[k] ?? 0) === n), { want, seen: watched.seen });
  check('Watching posts nothing', posts.length === 0, [...posts]);

  // The finish: the card up (without playing again), and Mnot slid to a stop, dancing.
  const finished = await page.evaluate(() => {
    const d = window.emoji, r = d.replays;
    d.step(5, 1 / 60);
    const card = document.querySelector('#finish');
    return { card: !card.hidden, title: card.querySelector('h1')?.textContent,
      again: getComputedStyle(card.querySelector('.again')).display, status: r.status.textContent,
      speed: d.player.vel.length(), dance: d.mnot.animator.current, time: r.time, playing: r.playing };
  });
  check('Past the end: the card, the slide to a stop and the dance', finished.card
    && finished.title === 'Thread complete!' && finished.again === 'none' && /finished/i.test(finished.status)
    && finished.speed < 0.5 && finished.dance === 'Dance' && !finished.playing, finished);

  // Jumps in time: the list, the tries, the holes and Mnot in one as they were then, the card down again; and the
  // same played there.
  const drops = pits.events.filter(e => e[1] === 'pit').map(e => e[0] / 1000);
  const seeks = await page.evaluate(({ drops, pits }) => {
    const d = window.emoji, r = d.replays, rec = d.watch.recording;
    const st = { pos: new d.THREE.Vector3(), vel: new d.THREE.Vector3() };
    const upTo = (name, t) => pits.events.filter(e => e[1] === name && e[0] <= t * 1000).length;
    const now = () => ({ t: r.time, next: d.player.next, lives: d.player.lives, holes: d.field.holes.size,
      pit: !!d.player.pit, want: { next: upTo('take', r.time), lives: 3 - upTo('hit', r.time),
        holes: upTo('hole', r.time), pit: rec.state(r.time, st).pit },
      card: !document.querySelector('#finish').hidden, done: d.player.done });
    const out = [], t = drops[1] + 0.3;
    r.seek(t);
    d.step(1 / 60, 1 / 60);
    out.push(now());
    r.seek(0.5);
    d.step(1 / 60, 1 / 60);
    out.push(now());
    if (!r.playing) r.togglePlay();
    while (r.time < t) d.step(0.25, 1 / 60);
    out.push(now());
    return out;
  }, { drops, pits });
  const [late, early, played] = seeks;
  const asThen = s => ['next', 'lives', 'holes', 'pit'].every(k => s[k] === s.want[k]);
  check('A jump in time puts the field as it was', seeks.every(asThen) && late.pit && late.holes > 0
    && early.holes === 0 && !late.card && !late.done, seeks);

  // Pause holds everything still; 2x plays twice as fast; the keys don't play or deal.
  const controls = await page.evaluate(() => {
    const d = window.emoji, r = d.replays;
    if (r.playing) r.togglePlay();
    const t0 = r.time, p0 = d.player.pos.clone();
    d.step(1, 1 / 60);
    const paused = { dt: r.time - t0, moved: d.player.pos.distanceTo(p0) };
    r.setSpeed(2);
    r.togglePlay();
    const t1 = r.time;
    d.step(1, 1 / 60);
    const fast = r.time - t1, seed = d.seed, next = d.player.next;
    for (const code of ['KeyR', 'KeyN']) window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code[3] }));
    d.step(0.1, 1 / 60);
    return { paused, fast, speed: r.speed, clock: d.player.time, time: r.time, dealt: d.seed !== seed,
      restarted: d.player.next !== next };
  });
  check('Pause, 2x and the keys', controls.paused.dt === 0 && controls.paused.moved === 0
    && Math.abs(controls.fast - 2) < 0.05 && Math.abs(controls.clock - controls.time) < 1e-6 && !controls.dealt
    && !controls.restarted, controls);

  // Links that can't play say so.
  for (const [id, text] of [['not-this-field', /fingerprint/i], ['gone-gone-gone', /no longer available/i]]) {
    await page.goto(`${base}/emoji.html?manual&replay=${id}`);
    await waitReplay();
    const failed = await page.evaluate(() => ({ ready: window.emoji.replays.ready,
      error: window.emoji.replays.error, status: window.emoji.replays.status.textContent }));
    check(`A ${id} link fails cleanly`, !failed.ready && text.test(`${failed.error} ${failed.status}`), failed);
  }

  // Racing the ghost: no start before it's in, then a see-through Mnot on the recording, at the player's clock, on
  // the run's field (a board one: the race is a run like any).
  delay = 2500;
  await page.goto(`${base}/emoji.html?ghost=demo-can-01`);
  await page.waitForFunction(() => window.emoji?.title?.visible && !!window.emoji.replays, null,
    { timeout: 60000, polling: 50 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const early2 = await page.evaluate(() => ({ title: window.emoji.title.visible,
    ready: window.emoji.replays.ready, status: window.emoji.replays.status.textContent }));
  check('No race before the ghost has loaded', early2.title && !early2.ready && /wait/i.test(early2.status), early2);
  delay = 0;
  await waitReplay();
  const ghostLook = await page.evaluate(() => {
    const d = window.emoji, g = d.ghost, mine = new Set(), see = [];
    d.mnot.root.traverse(o => { if (o.isMesh) [o.material].flat().forEach(m => mine.add(m)); });
    g.root.traverse(o => { if (o.isMesh) [o.material].flat().forEach(m => see.push(m)); });
    return { ready: d.replays.ready, inScene: g.root.parent === d.scene, meshes: see.length, seed: d.seed,
      counted: d.counted, seeThrough: see.every(m => m.transparent && m.opacity <= 0.36 && !mine.has(m)),
      status: d.replays.status.textContent };
  });
  check('The ghost is a see-through Mnot of its own, on its run\'s field', ghostLook.ready && ghostLook.inScene
    && ghostLook.meshes > 5 && ghostLook.seeThrough && ghostLook.seed === 11 && ghostLook.counted, ghostLook);
  await page.keyboard.press('Space');
  const race = await page.evaluate(() => {
    const d = window.emoji, g = d.ghost;
    const st = { pos: new d.THREE.Vector3(), vel: new d.THREE.Vector3() };
    d.autopilot(true);
    d.step(12, 1 / 60);
    g.recording.state(d.player.time, st);
    return { title: d.title.visible, time: d.player.time, ghostTime: d.replays.time,
      off: Math.hypot(g.root.position.x - st.pos.x, g.root.position.z - st.pos.z),
      moved: Math.hypot(g.root.position.x, g.root.position.z), status: d.replays.status.textContent };
  });
  check('The ghost runs the recording at the player\'s clock', !race.title && race.time > 5
    && Math.abs(race.ghostTime - race.time) < 1e-9 && race.off < 1e-6 && race.moved > 2, race);
  const toggles = [];
  for (let i = 0; i < 2; i++) {
    await page.click('.replay-button >> text=/(Hide|Show) ghost/');
    toggles.push(await page.evaluate(() => window.emoji.ghost.root.visible));
  }
  check('Hide ghost and Show ghost', toggles.join() === 'false,true', toggles);
  await page.click('.replay-button >> text=Hall of Fame');
  await page.waitForTimeout(200);
  check('Leaving a race asks first', dialogs.at(-1) === 'Leave this run? Your current run will be lost.'
    && new URL(page.url()).searchParams.get('ghost') === 'demo-can-01', { dialogs, url: page.url() });
  check('A race posts its run, as any', posts.includes('/api/emoji/run'), posts);
  check('No page errors', errors.length === 0, errors);
  return { passed: checks.filter(c => c.pass).length, total: checks.length, checks };
}
