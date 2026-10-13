// Run with Playwright's browser_run_code_unsafe(filename), while the dev server is running.
// The gondola under uneven frame times (peak.html?manual): whoever stands on the pallet is carried at the pallet's own
// speed, and a jump off it gains no more than that, however long or short the steps around it are. Once a jump off a
// climbing pallet after a long step and then a short one came out too fast, and the score server
// (server/verify.py) rightly called that honest climb antigravity.
async (page) => {
  await page.route('https://stats.mosredna.eu/**', route => route.abort());
  await page.goto('http://127.0.0.1:5280/peak.html?manual');
  await page.waitForFunction(() => !!window.peak?.player?.rig, null, { polling: 100, timeout: 60000 });
  const result = await page.evaluate(() => {
    const { world, player, THREE } = window.peak;
    const mover = world.animated.find(m => m.kind === 'gondola');
    const solid = mover.solid;
    // the pallet's speed over each of its steps, and the player's carry checked against the step before
    const update = mover.update;
    let speed = 0, top = 0, worst = 0;
    mover.update = (dt, ...rest) => {
      if (player.mode === 'ground' && player.support === solid) worst = Math.max(worst, Math.abs(player.carried.y - speed));
      const y = solid.top;
      update(dt, ...rest);
      speed = (solid.top - y) / dt;
      top = Math.max(top, speed);
    };
    const launches = [];
    const launch = player.launch.bind(player);
    player.launch = () => { launch(); launches.push({ vy: player.vy, base: player.launchSpeed }); };

    const trials = [];
    for (const pattern of [[1 / 60, 1 / 120], [1 / 30, 1 / 240], [1 / 60]]) {
      for (const wait of [0.6, 1.2, 1.5, 1.8, 2.4]) {
        while (mover.state().docked !== 'a' || mover.state().left < 0.8) update(0.05);   // the next stop at the bottom
        update(0);                         // a still step, so the pallet starts the ride at rest
        speed = 0;
        player.spawn(new THREE.Vector3(solid.center.x, solid.top, solid.center.y), 0);
        let i = 0, travelled = 0, steps = 0;
        const next = () => { const dt = pattern[i++ % pattern.length]; window.peak.step(dt, dt); return dt; };
        while (mover.state().docked === 'a' && steps++ < 400) next();
        while (travelled < wait && steps++ < 1200) travelled += next();
        const before = launches.length;
        window.peak.key('Space', true);
        while (launches.length === before && steps++ < 1400) next();
        window.peak.key('Space', false);
        const jump = launches[before];
        trials.push({ pattern: pattern.map(dt => Math.round(1 / dt)).join('/'), wait, onPallet: !!jump,
          gain: jump ? +(jump.vy - jump.base).toFixed(4) : null });
      }
    }
    mover.update = update;
    player.launch = launch;
    return { top: +top.toFixed(4), worst: +worst.toFixed(6), trials };
  });
  const checks = [];
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  check('the carry is the pallet\'s own speed on every step', result.worst < 1e-6, { worst: result.worst });
  check('the pallet climbs at most about 0.47 m/s', result.top > 0.3 && result.top < 0.48, { top: result.top });
  for (const t of result.trials) {
    check(`a jump ${t.wait} s into the ride at ${t.pattern} fps gains no more than the pallet's climb`,
      t.onPallet && t.gain >= 0 && t.gain <= result.top + 1e-6, { ...t, top: result.top });
  }
  const failed = checks.filter(c => !c.pass);
  if (failed.length) throw new Error(JSON.stringify(failed, null, 1));
  return `${checks.length} gondola checks passed`;
}
