// Run with Playwright's browser_run_code_unsafe(filename), with the dev server on 5280.
// The downhill's Hall of Fame replays (peak/downhill/playback.js): a run ridden by the autopilot, then watched (the
// chair on the recording, its events, jumps in time, pause and speed, the finish) and raced as a ghost. The board and
// the replay API are routed to it, so no score server is needed.
async (page) => {
  const base = 'http://127.0.0.1:5280';
  const checks = [], errors = [], posts = [], dialogs = [], boards = [];
  const check = (name, pass, evidence) => checks.push({ name, pass: !!pass, evidence });
  const FLAG = { jump: 1, land: 2, crash: 4, finish: 128, start: 256 };     // record.js
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/downhill/board')) boards.push(url.pathname);
    if (r.method() === 'POST' && url.pathname.startsWith('/api/')) posts.push(url.pathname);
  });
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.route('https://stats.mosredna.eu/**', route => route.abort());
  await page.route('**/api/downhill/run**', route => route.abort());

  // A run to play: the autopilot down the whole piste.
  await page.goto(`${base}/downhill.html?manual`);
  await page.waitForFunction(() => !!window.downhill?.ride, null, { timeout: 60000, polling: 50 });
  const replay = await page.evaluate(async () => {
    const d = window.downhill;
    d.autopilot(true);
    for (let i = 0; i < 400 && d.scores.recorder.state !== 'done'; i++) d.step(1, 1 / 60);
    const { routeFingerprint } = await import('/peak/downhill/routedata.js');
    return d.scores.recorder.data(await routeFingerprint({ track: d.track, obstacles: d.obstacles }));
  });
  const end = replay.samples.at(-1)[0] / 1000;
  const count = name => replay.events.filter(e => e[1] === name).length;
  const flagged = flag => replay.samples.filter(s => s[8] & flag).length;
  check('The autopilot rides down to the finish', replay.samples.length > 500 && flagged(FLAG.finish) === 1
    && count('pit') >= 1, { samples: replay.samples.length, end, pits: count('pit') });

  let delay = 0;
  await page.route('**/api/downhill/replay/**', async route => {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const body = { replay, name: 'Demo chair', time: Math.round(end * 1000) - 9000 };
    if (id === 'gone-gone-gone') return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (id === 'not-this-hill') body.replay = { ...replay, route: 'f'.repeat(64) };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/downhill/board**', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ total: 2, entries: [
      { rank: 1, name: 'Demo chair', time: 95000, falls: 0, dents: 2, me: false, replayId: 'demo-chair-01' },
      { rank: 2, name: 'Swivel Steve', time: 180000, falls: 3, dents: 4, me: false, replayId: null, house: true,
        quip: 'Came with the office.' }] }) }));
  const waitReplay = () => page.waitForFunction(() => {
    const r = window.downhill?.replays;
    return r && (r.ready || r.error);
  }, null, { timeout: 30000, polling: 50 });

  // The Hall of Fame: both buttons on a run, none on a house record; Watch run opens it.
  await page.goto(`${base}/downhill.html?hall=1&level=nope`);
  await page.waitForFunction(() => [...document.querySelectorAll('.sc-panel.open .sc-list .sc-name')]
    .some(e => e.textContent.trim() === 'Demo chair'), null, { timeout: 30000, polling: 50 });
  const hall = await page.evaluate(() => [...document.querySelectorAll('.sc-panel.open .sc-list li')].map(li => ({
    name: li.querySelector('.sc-name')?.textContent.trim(),
    note: li.querySelector('.sc-replay-note')?.textContent ?? '',
    actions: [...li.querySelectorAll('[data-replay-action]')].map(b => [b.dataset.replayAction, b.dataset.replayId]),
  })));
  check('The Hall offers Race ghost and Watch run on a run, nothing on a house record',
    hall[0]?.actions.map(a => a.join(':')).join(',') === 'ghost:demo-chair-01,replay:demo-chair-01'
    && hall[1]?.actions.length === 0 && /no replay/.test(hall[1]?.note), hall);
  check('An unknown ?level= reads the first level\'s board', boards.length > 0
    && boards.every(path => path === '/api/downhill/board'), boards);
  await page.click('[data-replay-action="replay"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('replay') === 'demo-chair-01', null,
    { timeout: 15000, polling: 50 });
  await waitReplay();
  await page.waitForTimeout(1200);
  const live = await page.evaluate(() => {
    const d = window.downhill, r = d.replays;
    return { ready: r.ready, error: r.error, time: r.time, playing: r.playing, title: d.title.visible,
      level: new URL(location.href).searchParams.get('level'),
      chip: document.querySelector('.replay-chip')?.textContent };
  });
  check('Watch run plays by itself, without the title', live.ready && live.playing && live.time > 0.3
    && !live.title && live.level === 'nope' && /^Replay: Demo chair/.test(live.chip), live);
  await page.click('.replay-button >> text=Back to Hall');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('hall') === '1'
    && !new URL(location.href).searchParams.has('replay') && !!document.querySelector('.sc-panel.open .sc-list li'),
  null, { timeout: 30000, polling: 50 });
  check('Back to Hall opens the Hall of Fame again', true, page.url());

  // Watching, step by step: the chair where the recording is, every event told once, as the run had them.
  await page.goto(`${base}/downhill.html?manual&replay=demo-chair-01`);
  await waitReplay();
  const watched = await page.evaluate(() => {
    const d = window.downhill, r = d.replays, rec = d.watch.recording, seen = {};
    const st = { pos: new d.THREE.Vector3(), vel: new d.THREE.Vector3(), acc: new d.THREE.Vector3() };
    const names = ['start', 'jump', 'land', 'crash', 'bump', 'wheel', 'wrecked', 'lost', 'pit', 'flight', 'finish'];
    for (const name of names) {
      d.ride.on(name, () => { seen[name] = (seen[name] ?? 0) + 1; });
    }
    let off = 0, frames = 0;
    while (r.time < r.duration && frames++ < 10000) {
      d.step(0.25, 1 / 60);
      if (r.time >= r.duration) break;          // rolling out past the finish
      rec.state(r.time, st);
      off = Math.max(off, Math.hypot(d.ride.pos.x - st.pos.x, d.ride.pos.z - st.pos.z));
    }
    return { ready: r.ready, error: r.error, duration: r.duration, off, seen, done: d.ride.done,
      api: r.api, chip: document.querySelector('.replay-chip')?.textContent };
  });
  check('Watch run loads the replay from the first level\'s board', watched.ready && !watched.error
    && Math.abs(watched.duration - end) < 1e-9 && /\/api\/downhill$/.test(watched.api), watched);
  check('The watched chair follows the recording', watched.off < 1e-6 && watched.done, { off: watched.off });
  const want = { start: 1, finish: 1, jump: flagged(FLAG.jump), land: flagged(FLAG.land), crash: flagged(FLAG.crash),
    pit: count('pit'), bump: count('bump'), flight: count('flight'), wrecked: count('wrecked'), lost: count('lost') };
  check('Every recorded event is told once', Object.entries(want).every(([k, n]) => (watched.seen[k] ?? 0) === n)
    && (watched.seen.wheel ?? 0) >= count('wheel'), { want, seen: watched.seen, wheel: count('wheel') });
  check('Watching posts nothing', posts.length === 0, [...posts]);

  // The finish: the card up (without riding again), and the chair rolled out to a stop for the party.
  const finished = await page.evaluate(() => {
    const d = window.downhill, r = d.replays;
    d.step(5, 1 / 60);
    const card = document.querySelector('#finish');
    return { card: !card.hidden, again: getComputedStyle(card.querySelector('.again')).display,
      status: r.status.textContent, speed: d.ride.speed, party: !!d.rider.party, time: r.time, playing: r.playing };
  });
  check('Past the finish: the card, the run-out and the party', finished.card && finished.again === 'none'
    && /finished/i.test(finished.status) && finished.speed < 0.5 && finished.party && !finished.playing, finished);

  // Jumps in time: the wheels, the props knocked over since the last spill, the card down again.
  const bumps = replay.events.filter(e => e[1] === 'bump').map(e => e[0] / 1000);
  const seeks = await page.evaluate(({ bumps }) => {
    const d = window.downhill, r = d.replays, rec = d.watch.recording;
    const knocked = () => d.obstacles.list.filter(o => o.soft && !o.hit && o.gone).length;
    const wheels = () => d.ride.wheels.map(Number).join('');
    const mask = t => {
      const s = rec.samples[Math.max(0, rec.after(t) - 1)][10];
      return d.ride.wheels.map((_, i) => s >> i & 1).join('');
    };
    const casters = () => d.chair.casters.map(c => c.gone ? 0 : 1).join('');
    const out = [];
    const t = bumps.length ? Math.min(r.duration, bumps.at(-1) + 0.5) : r.duration / 2;
    r.seek(t);
    d.step(1 / 60, 1 / 60);
    out.push({ t: r.time, knocked: knocked(), wheels: wheels(), want: mask(r.time), casters: casters(),
      card: !document.querySelector('#finish').hidden, done: d.ride.done });
    r.seek(0.5);
    d.step(1 / 60, 1 / 60);
    out.push({ t: r.time, knocked: knocked(), wheels: wheels(), want: mask(r.time), casters: casters() });
    // and played there, not jumped
    if (!r.playing) r.togglePlay();
    while (r.time < t) d.step(0.25, 1 / 60);
    out.push({ t: r.time, knocked: knocked(), wheels: wheels(), want: mask(r.time), casters: casters() });
    return out;
  }, { bumps });
  const [late, early, played] = seeks;
  check('A jump in time puts the wheels and the props as they were', late.wheels === late.want
    && late.casters === late.want && early.wheels === early.want && early.knocked === 0 && !late.card && !late.done
    && played.wheels === played.want && played.knocked === late.knocked, seeks);

  // Pause holds everything still; 2x plays twice as fast; the keys don't ride.
  const controls = await page.evaluate(() => {
    const d = window.downhill, r = d.replays;
    if (r.playing) r.togglePlay();
    const t0 = r.time, p0 = d.ride.pos.clone();
    d.step(1, 1 / 60);
    const paused = { dt: r.time - t0, moved: d.ride.pos.distanceTo(p0) };
    r.setSpeed(2);
    r.togglePlay();
    const t1 = r.time;
    d.step(1, 1 / 60);
    const fast = r.time - t1;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r' }));
    d.step(0.1, 1 / 60);
    return { paused, fast, speed: r.speed, ride: d.ride.time, time: r.time };
  });
  check('Pause, 2x and the keys', controls.paused.dt === 0 && controls.paused.moved === 0
    && Math.abs(controls.fast - 2) < 0.05 && Math.abs(controls.ride - controls.time) < 1e-6, controls);

  // Links that can't play say so.
  for (const [id, text] of [['not-this-hill', /fingerprint/i], ['gone-gone-gone', /no longer available/i]]) {
    await page.goto(`${base}/downhill.html?manual&replay=${id}`);
    await waitReplay();
    const failed = await page.evaluate(() => ({ ready: window.downhill.replays.ready,
      error: window.downhill.replays.error, status: window.downhill.replays.status.textContent }));
    check(`A ${id} link fails cleanly`, !failed.ready && text.test(`${failed.error} ${failed.status}`), failed);
  }

  // Racing the ghost: no start before it's in, then a see-through chair on the recording, at the player's clock.
  delay = 2500;
  await page.goto(`${base}/downhill.html?ghost=demo-chair-01`);
  await page.waitForFunction(() => window.downhill?.title?.visible && !!window.downhill.replays, null,
    { timeout: 60000, polling: 50 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const early2 = await page.evaluate(() => ({ title: window.downhill.title.visible,
    ready: window.downhill.replays.ready, status: window.downhill.replays.status.textContent }));
  check('No race before the ghost has loaded', early2.title && !early2.ready && /wait/i.test(early2.status), early2);
  delay = 0;
  await waitReplay();
  const ghostLook = await page.evaluate(() => {
    const d = window.downhill, g = d.ghost, mine = new Set(), see = [];
    d.chair.root.traverse(o => { if (o.isMesh) [o.material].flat().forEach(m => mine.add(m)); });
    g.root.traverse(o => { if (o.isMesh) [o.material].flat().forEach(m => see.push(m)); });
    return { ready: d.replays.ready, inScene: g.root.parent === d.scene, meshes: see.length,
      seeThrough: see.every(m => m.transparent && m.opacity <= 0.36 && !mine.has(m)),
      status: d.replays.status.textContent };
  });
  check('The ghost is a see-through chair of its own', ghostLook.ready && ghostLook.inScene && ghostLook.meshes > 5
    && ghostLook.seeThrough, ghostLook);
  await page.keyboard.press('Space');
  const race = await page.evaluate(() => {
    const d = window.downhill, g = d.ghost;
    const st = { pos: new d.THREE.Vector3(), vel: new d.THREE.Vector3(), acc: new d.THREE.Vector3() };
    d.autopilot(true);
    d.step(12, 1 / 60);
    g.recording.state(d.ride.time, st);
    return { title: d.title.visible, time: d.ride.time, ghostTime: d.replays.time, z: g.ride.pos.z,
      off: Math.hypot(g.ride.pos.x - st.pos.x, g.ride.pos.z - st.pos.z), status: d.replays.status.textContent };
  });
  check('The ghost rides the recording at the player\'s clock', !race.title && race.time > 5
    && Math.abs(race.ghostTime - race.time) < 1e-9 && race.off < 1e-6 && race.z > 30, race);
  const toggles = [];
  for (let i = 0; i < 2; i++) {
    await page.click('.replay-button >> text=/(Hide|Show) ghost/');
    toggles.push(await page.evaluate(() => window.downhill.ghost.root.visible));
  }
  check('Hide ghost and Show ghost', toggles.join() === 'false,true', toggles);
  await page.click('.replay-button >> text=Hall of Fame');
  await page.waitForTimeout(200);
  check('Leaving a race asks first', dialogs.at(-1) === 'Leave this run? Your current run will be lost.'
    && new URL(page.url()).searchParams.get('ghost') === 'demo-chair-01', { dialogs, url: page.url() });
  check('A race posts its run, as any ride', posts.includes('/api/downhill/run'), posts);
  check('No page errors', errors.length === 0, errors);
  return { passed: checks.filter(c => c.pass).length, total: checks.length, checks };
}
