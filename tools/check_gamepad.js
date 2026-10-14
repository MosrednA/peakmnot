// Run with Playwright's browser_run_code_unsafe(filename), while the dev server is running.
// A controller in both mini games (peak/kit/gamepad.js, padmenu.js), with a virtual one: navigator.getGamepads,
// the page's focus and the frame loop are stubbed, so every step is the same each run. Without a controller the climb
// runs on; with one, its chip and hints show, A starts without a jump, the sticks walk and look, the buttons do what
// the card says, two controllers or a lost focus or an unplug don't trip it, and the downhill steers by it.
async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://stats.mosredna.eu/**', route => route.abort());
  await page.addInitScript(() => {
    let now = 0, queue = [];
    performance.now = () => now;
    window.requestAnimationFrame = callback => queue.push(callback);
    window.__step = (seconds, fps = 60) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        now += 1000 / fps;
        const run = queue;
        queue = [];
        for (const callback of run) callback(now);
      }
    };
    // the controllers the page sees, its focus, and the buzzes asked for
    window.__pads = [];
    window.__focus = true;
    window.__buzz = [];
    navigator.getGamepads = () => window.__pads;
    document.hasFocus = () => window.__focus;
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    window.__pad = (id, index = 0) => ({ id, index, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      vibrationActuator: { playEffect: (type, effect) => { window.__buzz.push(effect); return Promise.resolve(); } } });
    window.__press = (pad, button, on = true) => { pad.buttons[button] = { pressed: on, value: +on }; pad.timestamp++; };
    window.__tap = (pad, button) => { __press(pad, button); __step(0.1); __press(pad, button, false); __step(0.1); };
    window.__tilt = (pad, axes) => { pad.axes = axes; pad.timestamp++; };
    window.__shown = selector => !!document.querySelector(selector)?.getClientRects().length;
  });
  const checks = [];
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  const open = async (path, ready) => {
    await page.goto(`http://127.0.0.1:5280/${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ready, null, { polling: 100, timeout: 60000 });
    // the input is what's checked, not the picture: no drawing, which headless takes long over (the disco most)
    await page.evaluate(() => { (window.peak ?? window.downhill).post.render = () => {}; __step(0.5); });
  };
  const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
  const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

  // ------------------------------------------------------------------ the climb
  await open('peak.html', () => !!window.peak?.padMenu);
  let r = await page.evaluate(() => {
    __step(1);
    return { title: peak.title.visible, chip: __shown('#pad-chip'), time: peak.game.time };
  });
  check('without a controller the climb runs on, no chip', r.title && !r.chip && errors.length === 0, r);

  r = await page.evaluate(xbox => {
    const pad = window.xbox = __pad(xbox);
    __pads = [pad];
    __tap(pad, 5);                                     // RB: nothing on the title, but in use
    return { kind: document.body.dataset.pad, name: peak.pad.name, chip: __shown('#pad-chip'),
      pad: document.body.classList.contains('pad'), press: __shown('.pad-press'),
      keys: __shown('.ts-press:not(.pad-press)'), glyph: __shown('#title-start .pg-a'), title: peak.title.visible };
  }, XBOX);
  check('a controller shows its chip, and its buttons on the title', r.kind === 'xbox' && r.name === 'Xbox controller'
    && r.chip && r.pad && r.press && !r.keys && r.glyph && r.title, r);

  r = await page.evaluate(() => {
    let jumps = 0;
    peak.player.on('jump', () => jumps++);
    window.__jumps = () => jumps;
    __press(xbox, 0);
    __step(0.6);
    const result = { title: peak.title.visible, jumps };
    __press(xbox, 0, false);
    __step(0.1);
    return result;
  });
  check('A on the title starts the climb, without a jump', !r.title && r.jumps === 0, r);

  r = await page.evaluate(() => {
    const from = peak.player.pos.clone();
    __tilt(xbox, [1, 0, 0, 0]);
    __step(1);
    const full = { moved: +peak.player.pos.distanceTo(from).toFixed(2), held: [...peak.input.frame.held],
      careful: peak.input.frame.careful, help: __shown('#pad-help'), keys: __shown('#help') };
    __tilt(xbox, [0.4, 0, 0, 0]);
    __step(0.2);
    const light = { held: [...peak.input.frame.held], careful: peak.input.frame.careful };
    __tilt(xbox, [0, 0, 0, 0]);
    __press(xbox, 4);
    __step(0.1);
    const lb = peak.input.frame.careful;
    __press(xbox, 4, false);
    __step(0.3);
    return { full, light, lb };
  });
  check('the left stick walks Mnot as the key it points at', r.full.moved > 1 && r.full.held.join() === 'KeyD'
    && !r.full.careful && r.full.help && !r.full.keys, r.full);
  check('a light push, or LB, is careful steps', r.light.careful && r.light.held.join() === 'KeyD' && r.lb, r);

  r = await page.evaluate(() => {
    const before = __jumps();
    __press(xbox, 0);
    __step(0.3);
    __press(xbox, 0, false);
    __step(1.2);
    return { jumps: __jumps() - before };
  });
  check('A jumps, once a press', r.jumps === 1, r);

  r = await page.evaluate(() => {
    for (const button of [12, 12, 13, 13, 14, 15, 14, 15, 1, 0]) {
      __press(xbox, button);
      __step(1 / 30);
      __press(xbox, button, false);
      __step(1 / 30);
    }
    const result = { party: !!peak.moments.party, mode: peak.player.mode };
    __step(1.5);
    return result;
  });
  check('the Konami code works on the D-pad, B and A', r.party, r);

  r = await page.evaluate(() => {
    const f = peak.follow, yaw = f.userYaw, zoom = f.zoom;
    __tilt(xbox, [0, 0, 1, 0]);
    __step(0.3);
    const turned = +(f.userYaw - yaw).toFixed(3);
    __tilt(xbox, [0, 0, 0, 0]);
    __press(xbox, 7);
    __step(0.3);
    const out = f.zoom;
    __press(xbox, 7, false);
    __press(xbox, 6);
    __step(0.6);
    const back = f.zoom;
    __press(xbox, 6, false);
    __step(0.1);
    return { turned, zoom, out, back };
  });
  check('the right stick looks round, RT zooms out and LT in', Math.abs(r.turned) > 0.1 && r.out > r.zoom
    && r.back < r.out, r);

  r = await page.evaluate(() => {
    const before = peak.sounds.enabled;
    __tap(xbox, 8);
    const after = peak.sounds.enabled;
    peak.sounds.setEnabled(before);
    return { before, after };
  });
  check('View switches the sound', r.after === !r.before, r);

  r = await page.evaluate(() => {
    __step(0.5);
    __tap(xbox, 9);
    const open = peak.padMenu.open, card = __shown('#pad-card'), from = peak.player.pos.clone();
    __tilt(xbox, [1, 0, 0, 0]);                       // on the card the stick picks a setting
    __step(0.5);
    const moved = +peak.player.pos.distanceTo(from).toFixed(3), invert = peak.pad.settings.invert;
    __tilt(xbox, [0, 0, 0, 0]);
    __tap(xbox, 1);
    const closed = !peak.padMenu.open;
    peak.pad.set('invert', false);
    return { open, card, moved, invert, closed };
  });
  check('Menu opens the card, Mnot stands still under it, B closes it', r.open && r.card && r.moved < 0.05
    && r.invert === true && r.closed, r);

  r = await page.evaluate(dualsense => {
    const ghost = __pad(dualsense, 0), real = window.ds = __pad(dualsense, 1);
    __pads = [ghost, real];
    __step(0.1);
    const from = peak.player.pos.clone();
    __tilt(real, [1, 0, 0, 0]);
    __step(0.6);
    const result = { index: peak.pad.index, kind: document.body.dataset.pad, name: peak.pad.name,
      moved: +peak.player.pos.distanceTo(from).toFixed(2) };
    __tilt(real, [0, 0, 0, 0]);
    __step(0.3);
    return result;
  }, DUALSENSE);
  check('with two controllers the one in use counts (a DualSense on USB can show up twice)', r.index === 1
    && r.kind === 'playstation' && r.name === 'DualSense' && r.moved > 0.5, r);

  r = await page.evaluate(() => {
    __tilt(ds, [1, 0, 0, 0]);
    __step(0.3);
    const walking = peak.input.frame.held.size;
    __focus = false;
    __press(ds, 0);
    __step(0.3);
    const away = { held: peak.input.frame.held.size, jumps: __jumps() };
    __tilt(ds, [0, 0, 0, 0]);
    __focus = true;
    __step(0.5);
    const back = __jumps();
    __press(ds, 0, false);
    __step(0.5);
    return { walking, away, back };
  });
  check('without the focus the controller lets go, and A held meanwhile is no jump after', r.walking > 0
    && r.away.held === 0 && r.back === r.away.jumps, r);

  r = await page.evaluate(() => {
    __buzz.length = 0;
    peak.pad.rumble('hit');
    const on = __buzz.length;
    peak.pad.set('rumble', false);
    peak.pad.rumble('hit');
    const off = __buzz.length - on;
    peak.pad.set('rumble', true);
    return { on, off };
  });
  check('the controller buzzes, not with Rumble off', r.on === 1 && r.off === 0, r);

  await page.keyboard.press('Shift');
  r = await page.evaluate(() => {
    __step(0.1);
    return { pad: document.body.classList.contains('pad'), keys: __shown('#help'), help: __shown('#pad-help') };
  });
  check('a key hands the hints back to the keyboard', !r.pad && r.keys && !r.help, r);

  r = await page.evaluate(() => {
    __tilt(ds, [1, 0, 0, 0]);
    __step(0.3);
    __pads = [];
    const time = peak.game.time;
    __step(0.5);
    const chip = document.getElementById('pad-chip');
    return { connected: peak.pad.connected, off: chip.classList.contains('off'), words: chip.textContent,
      held: peak.input.frame.held.size, ran: +(peak.game.time - time).toFixed(2) };
  });
  check('unplugged mid-climb, it lets go, says so, and the climb runs on', !r.connected && r.off
    && r.words.includes('Disconnected') && r.held === 0 && r.ran > 0.4, r);

  await open('peak.html', () => !!window.peak?.padMenu);
  r = await page.evaluate(() => {
    const pad = __pad('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)');
    __pads = [pad];
    __tap(pad, 3);
    const hall = !!document.querySelector('.sc-panel.open');
    __tap(pad, 1);
    const closed = !document.querySelector('.sc-panel.open');
    __tap(pad, 2);
    const howto = !document.getElementById('title-howto').hidden && __shown('.pad-howto');
    __tap(pad, 1);
    return { kind: document.body.dataset.pad, hall, closed, howto, shut: document.getElementById('title-howto').hidden,
      title: peak.title.visible };
  });
  check('on the title Y opens the Hall of Fame, X How to play, and B closes them', r.kind === 'nintendo' && r.hall
    && r.closed && r.howto && r.shut && r.title, r);

  // ------------------------------------------------------------------ the downhill
  await open('downhill.html', () => !!window.downhill?.padMenu);
  r = await page.evaluate(xbox => {
    const d = downhill, pad = __pad(xbox);
    __pads = [pad];
    __tap(pad, 0);
    __step(0.5);
    const started = !d.title.visible;
    __tilt(pad, [1, 0, 0, 0]);
    __step(0.5);
    const steer = +d.intent.steer.toFixed(2);
    __tilt(pad, [0, 0, 0, 0]);
    __press(pad, 7);
    __step(1);
    const push = d.intent.push, rolled = d.ride.s;
    __press(pad, 7, false);
    __press(pad, 6);
    __step(0.2);
    const brake = d.intent.brake;
    __press(pad, 6, false);
    __step(0.1);
    __tap(pad, 3);
    const again = d.ride.s;
    __tap(pad, 9);
    const rows = [...document.querySelectorAll('#pad-card .pad-row')].map(row => row.dataset.key);
    return { started, steer, push, brake, rolled, again, card: d.padMenu.open, rows };
  }, XBOX);
  check('the downhill: A starts the run, the stick steers, RT pushes, LT brakes', r.started && r.steer > 0.5
    && r.push && r.brake, r);
  check('the downhill: Y is a new run from the top', r.again < r.rolled, r);
  check('the downhill\'s card has only the rumble setting', r.card && r.rows.join() === 'rumble', r);

  check('no errors on either page', errors.length === 0, errors);
  const failed = checks.filter(c => !c.pass);
  if (failed.length) throw new Error(JSON.stringify(failed, null, 1));
  return `${checks.length} gamepad checks passed`;
}
