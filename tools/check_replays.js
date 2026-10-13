// Run with Playwright's browser_run_code_unsafe(filename), after `python3 tools/replay_test_server.py`.
// Hall replay actions, watch controls, race controls and the public replay loader.
async (page) => {
  const base = 'http://127.0.0.1:5291';
  const checks = [], apiPosts = [];
  const onRequest = request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.startsWith('/api/peak/')) {
      apiPosts.push({ path: url.pathname, method: request.method() });
    }
  };
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  const waitForReplay = async mode => {
    await page.waitForFunction(mode => window.peak?.replays?.mode === mode
      && (window.peak.replays.ready || window.peak.replays.error), mode, { timeout: 30000, polling: 50 });
    return page.evaluate(() => ({ ready: window.peak.replays.ready, error: window.peak.replays.error }));
  };
  const openHall = async () => {
    await page.goto(`${base}/peak.html`);
    await page.waitForFunction(() => !!window.peak?.game && !!document.querySelector('#hall-of-fame'), null,
      { timeout: 60000, polling: 50 });
    await page.locator('#hall-of-fame').click();
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('.sc-panel.open .sc-list .sc-name')].map(e => e.textContent.trim());
      return names.includes('Demo climb') && names.includes('Demo falls');
    }, null, { timeout: 20000, polling: 50 });
    return page.evaluate(() => [...document.querySelectorAll('.sc-panel.open .sc-list li')].map(li => ({
      name: li.querySelector('.sc-name')?.textContent.trim() ?? '', house: li.classList.contains('house'),
      actions: [...li.querySelectorAll('[data-replay-action]')].map(button => ({
        mode: button.dataset.replayAction, id: button.dataset.replayId, label: button.textContent.trim(),
      })),
      note: li.querySelector('.sc-replay-note')?.textContent.trim() ?? '',
    })));
  };
  const clickHallAction = async (name, mode) => page.evaluate(({ name, mode }) => {
    const row = [...document.querySelectorAll('.sc-panel.open .sc-list li')]
      .find(li => li.querySelector('.sc-name')?.textContent.trim() === name);
    const button = row?.querySelector(`[data-replay-action="${mode}"]`);
    if (!button) throw new Error(`Missing ${mode} action for ${name}`);
    button.click();
    return button.dataset.replayId;
  }, { name, mode });

  page.setDefaultTimeout(10000);
  page.on('request', onRequest);
  await page.route('https://stats.mosredna.eu/**', route => route.abort());
  try {
    let hall = await openHall();
    const climb = hall.find(row => row.name === 'Demo climb');
    const falls = hall.find(row => row.name === 'Demo falls');
    check('Hall offers Race ghost and Watch run for both demo records', !!climb && !!falls
      && [climb, falls].every(row => row.actions.map(action => action.mode).sort().join(',') === 'ghost,replay'
        && row.actions.every(action => action.id && action.label)), { climb, falls });
    const house = hall.filter(row => row.house);
    check('House rows have no replay actions', house.length > 0
      && house.every(row => row.actions.length === 0 && /no replay/i.test(row.note)), house);

    const beforeWatchPosts = apiPosts.length;
    const watchId = await clickHallAction('Demo climb', 'replay');
    await page.waitForFunction(id => new URL(location.href).searchParams.get('replay') === id, watchId,
      { timeout: 10000, polling: 50 });
    const watchLoad = await waitForReplay('replay');
    await page.waitForFunction(() => document.querySelector('.replay-ui--watch.replay-ready'), null,
      { timeout: 10000, polling: 50 });
    check('Watch run loads its verified public replay', watchLoad.ready && !watchLoad.error
      && !!watchId && await page.locator('.replay-chip').innerText().then(text => text.includes('Demo climb')),
    { watchId, ...watchLoad });

    const poseSeek = await page.evaluate(() => {
      const a = window.peak.replays.actor, bones = [];
      a.model.traverse(bone => { if (bone.isBone) bones.push(bone); });
      const beam = a.replay.samples.find(s => s[7] === 2);
      if (!beam) throw new Error('No beam in the replay fixture.');
      const time = beam[0] / 1000 + 0.3;
      a.seek(time);
      const expected = bones.map(bone => bone.quaternion.toArray());
      let error = 0;
      for (const seek of [time, time, 0, a.duration, time, time]) {
        a.seek(seek);
        if (seek !== time) continue;
        bones.forEach((bone, i) => {
          const actual = bone.quaternion.toArray(), q = expected[i];
          error = Math.max(error, Math.min(Math.max(...actual.map((v, k) => Math.abs(v - q[k]))),
            Math.max(...actual.map((v, k) => Math.abs(v + q[k])))));
        });
      }
      return { time, error };
    });
    check('Balancing pose is identical after pausing and backward seeks', poseSeek.error < 1e-9, poseSeek);

    const pauseTarget = await page.evaluate(() => {
      const c = window.peak.replays;
      const gondola = window.peak.world.animated.find(thing => thing.kind === 'gondola');
      if (!gondola) throw new Error('The route has no gondola to verify during replay.');
      c.playing = false;
      let seconds = Math.min(3, c.duration);
      while (seconds < c.duration && gondola.state().docked !== null) {
        seconds = Math.round((seconds + 0.1) * 1000) / 1000;
        gondola.seek(c.actor.phase + seconds);
      }
      if (seconds >= c.duration) throw new Error('The replay never reaches a moving gondola phase.');
      const slider = document.querySelector('.replay-seek');
      slider.value = String(seconds);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const worldTime = c.worldTime();
      const p = ((worldTime % 9.6) + 9.6) % 9.6;
      const ease = u => 0.5 - 0.5 * Math.cos(Math.PI * u);
      const s = p < 1.8 ? 0 : p < 4.8 ? ease((p - 1.8) / 3) : p < 6.6 ? 1 :
        1 - ease((p - 6.6) / 3);
      return { seconds, worldTime, expected: { x: 5.65 + (3.15 - 5.65) * s,
        z: 33.1, top: 3.3 + (4.2 - 3.3) * s } };
    });
    await page.waitForFunction(expected => {
      const c = window.peak.replays, gondola = window.peak.world.animated.find(thing => thing.kind === 'gondola');
      return Math.abs(window.peak.weather.time - c.worldTime()) < 1e-6 && gondola.state().docked === null
        && Math.abs(gondola.solid.center.x - expected.x) < 1e-4
        && Math.abs(gondola.solid.center.y - expected.z) < 1e-4
        && Math.abs(gondola.solid.top - expected.top) < 1e-4;
    }, pauseTarget.expected, { timeout: 3000, polling: 50 });
    const pausedAt = await page.evaluate(() => {
      const c = window.peak.replays, mover = window.peak.world.animated.find(thing => thing.kind === 'gondola');
      return { time: c.time, gameTime: window.peak.game.time, weatherTime: window.peak.weather.time,
        replayTime: c.worldTime(), center: [mover.solid.center.x, mover.solid.center.y], top: mover.solid.top,
        moving: mover.state().docked === null };
    });
    await page.waitForTimeout(250);
    const pausedAfter = await page.evaluate(() => {
      const c = window.peak.replays, mover = window.peak.world.animated.find(thing => thing.kind === 'gondola');
      return { time: c.time, gameTime: window.peak.game.time, weatherTime: window.peak.weather.time,
        replayTime: c.worldTime(), center: [mover.solid.center.x, mover.solid.center.y], top: mover.solid.top,
        moving: mover.state().docked === null, playing: c.playing };
    });
    const platformDrift = Math.hypot(...pausedAfter.center.map((value, i) => value - pausedAt.center[i]));
    check('Pause freezes replay, weather and the gondola at the absolute replay phase', !pausedAfter.playing
      && pausedAt.moving && Math.abs(pausedAfter.time - pausedAt.time) < 1e-6
      && Math.abs(pausedAfter.gameTime - pausedAt.gameTime) < 1e-6
      && Math.abs(pausedAfter.weatherTime - pausedAt.weatherTime) < 1e-6
      && Math.abs(pausedAfter.replayTime - pauseTarget.worldTime) < 1e-6
      && platformDrift < 1e-6 && Math.abs(pausedAfter.top - pausedAt.top) < 1e-6,
    { pauseTarget, pausedAt, pausedAfter, platformDrift });

    const beforeInput = await page.evaluate(() => ({ player: window.peak.player.pos.toArray(), time: window.peak.game.time }));
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowUp');
    const afterInput = await page.evaluate(() => ({ player: window.peak.player.pos.toArray(), time: window.peak.game.time }));
    const playerDrift = Math.hypot(...afterInput.player.map((value, i) => value - beforeInput.player[i]));
    check('Watch mode ignores player input and keeps the game clock stopped', playerDrift < 1e-6
      && Math.abs(afterInput.time - beforeInput.time) < 1e-6, { playerDrift, beforeInput, afterInput });

    const seekTargets = await page.evaluate(() => {
      const samples = window.peak.replays.actor.replay.samples;
      const counts = new Map();
      samples.forEach(sample => counts.set(sample[0], (counts.get(sample[0]) ?? 0) + 1));
      const eligible = samples.filter(sample => sample[0] % 10 === 0 && counts.get(sample[0]) === 1
        && sample[7] !== 3 && !(sample[8] & 32));
      const at = fraction => {
        const sample = eligible[Math.floor((eligible.length - 1) * fraction)];
        return { seconds: sample[0] / 1000, position: sample.slice(1, 4).map(value => value / 1000) };
      };
      return { forward: at(0.7), backward: at(0.3), count: eligible.length };
    });
    const seekTo = async target => page.evaluate(seconds => {
      const slider = document.querySelector('.replay-seek');
      slider.value = String(seconds);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const actor = window.peak.replays.actor;
      return { time: window.peak.replays.time, position: actor.root.position.toArray() };
    }, target.seconds);
    const forward = await seekTo(seekTargets.forward);
    const backward = await seekTo(seekTargets.backward);
    const positionError = (actual, expected) => Math.hypot(...actual.map((value, i) => value - expected[i]));
    check('Forward and backward seeks place the actor on the recorded samples', seekTargets.count > 10
      && Math.abs(forward.time - seekTargets.forward.seconds) < 1e-6
      && Math.abs(backward.time - seekTargets.backward.seconds) < 1e-6
      && positionError(forward.position, seekTargets.forward.position) < 0.002
      && positionError(backward.position, seekTargets.backward.position) < 0.002,
    { seekTargets, forward, backward, forwardError: positionError(forward.position, seekTargets.forward.position),
      backwardError: positionError(backward.position, seekTargets.backward.position) });

    // Existing recordings carry the supporting solid: loose blocks should follow those recorded contacts,
    // including when the viewer jumps straight into a collapse or scrubs backwards while paused.
    const collapse = await page.evaluate(() => {
      const { replays: c, world } = window.peak;
      c.playing = false;
      const contact = c.actor.replay.samples.find(row => row[7] === 0 && world.solids[row[9]]?.loose);
      if (!contact) throw new Error('Demo climb has no recorded loose-platform contact.');
      const ledge = world.animated.find(thing => thing.solid === world.solids[contact[9]]);
      const start = contact[0] / 1000;
      const snapshot = () => {
        const group = ledge.group, body = group.children[0], cracks = body.children[1].geometry;
        return { time: c.time, state: ledge.state, off: !!ledge.solid.off, visible: group.visible,
          position: group.position.toArray(), scale: group.scale.toArray(),
          bodyPosition: body.position.toArray(), rotation: body.rotation.toArray(),
          cracks: cracks.drawRange.count, fullCracks: cracks.index.count };
      };
      const at = seconds => {
        const slider = document.querySelector('.replay-seek');
        slider.value = String(seconds);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        window.peak.step(1 / 60);
        return snapshot();
      };
      // The first teaching ledge has a 1.3 s delay, then 3.2 s before its 0.35 s regrowth.
      const states = [0.4, 1.55, 2.8, 4.65, 5.0].map(offset => at(start + offset));
      const rewind = at(start - 0.1);
      const fallingAgain = at(start + 1.55);
      window.peak.step(1);
      const paused = snapshot();
      c.restart();
      c.playing = false;
      window.peak.step(1 / 60);
      const restarted = snapshot();
      return { start, support: contact[9], states, rewind, fallingAgain, paused, restarted };
    });
    check('Recorded platform contact shakes, drops, hides and regrows the block',
      collapse.states.map(item => item.state).join(',') === 'shaking,falling,gone,back,still'
      && collapse.states.map(item => item.off).join(',') === 'false,true,true,false,false'
      && collapse.states[1].bodyPosition[1] < -0.1
      && collapse.states[1].cracks === collapse.states[1].fullCracks
      && !collapse.states[2].visible && collapse.states[3].visible
      && collapse.states[3].scale[0] < 1 && collapse.states[4].scale.every(value => value === 1), collapse);
    check('Backward seeking and Restart restore collapsed blocks', collapse.rewind.state === 'still'
      && !collapse.rewind.off && collapse.restarted.time === 0 && collapse.restarted.state === 'still'
      && !collapse.restarted.off && collapse.rewind.visible && collapse.restarted.visible
      && collapse.rewind.bodyPosition.every(value => value === 0)
      && collapse.restarted.bodyPosition.every(value => value === 0), collapse);
    check('Paused collapse stays frozen and seeking reproduces the same state',
      JSON.stringify(collapse.states[1]) === JSON.stringify(collapse.fallingAgain)
      && JSON.stringify(collapse.fallingAgain) === JSON.stringify(collapse.paused), collapse);

    await page.locator('.replay-speed[data-speed="2"]').click();
    await page.locator('.replay-play').click();
    const fastStart = await page.evaluate(() => window.peak.replays.time);
    await page.waitForTimeout(350);
    const fastEnd = await page.evaluate(() => window.peak.replays.time);
    await page.locator('.replay-play').click();
    const fast = await page.evaluate(() => ({ speed: window.peak.replays.speed,
      pressed: document.querySelector('.replay-speed[data-speed="2"]').getAttribute('aria-pressed') }));
    check('2× speed advances the replay and marks the selected speed', fast.speed === 2 && fast.pressed === 'true'
      && fastEnd - fastStart > 0.3, { ...fast, elapsed: fastEnd - fastStart });

    const endState = await page.evaluate(() => {
      const c = window.peak.replays, last = c.actor.replay.samples.at(-1);
      const slider = document.querySelector('.replay-seek');
      slider.value = slider.max;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { time: c.time, duration: c.duration, position: c.actor.root.position.toArray(),
        last: last.slice(1, 4).map(value => value / 1000) };
    });
    // Click and read in the same page task so an animation frame cannot advance
    // the freshly restarted replay before its zero-time state is observed.
    const restartState = await page.evaluate(() => {
      [...document.querySelectorAll('.replay-controls button')]
        .find(button => button.textContent.trim() === 'Restart')?.click();
      const c = window.peak.replays;
      return { time: c.time, playing: c.playing, position: c.actor.root.position.toArray(),
        first: c.actor.replay.samples[0].slice(1, 4).map(value => value / 1000) };
    });
    check('End seeking and Restart return the actor to the first sample', Math.abs(endState.time - endState.duration) < 1e-6
      && positionError(endState.position, endState.last) < 0.002 && restartState.time === 0 && restartState.playing
      && positionError(restartState.position, restartState.first) < 1e-6, { endState, restartState });

    await page.setViewportSize({ width: 320, height: 720 });
    const mobile = await page.evaluate(() => {
      const bounds = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth,
        top: bounds('.replay-top'), controls: bounds('.replay-controls'), seek: bounds('.replay-seek') };
    });
    check('Watch controls fit a 320 px mobile viewport without horizontal overflow', mobile.scroll <= mobile.viewport + 1
      && mobile.top.left >= -1 && mobile.top.right <= mobile.viewport + 1
      && mobile.controls.left >= -1 && mobile.controls.right <= mobile.viewport + 1
      && mobile.seek.left >= -1 && mobile.seek.right <= mobile.viewport + 1, mobile);
    await page.setViewportSize({ width: 1280, height: 800 });
    check('Watching never sends a score POST', apiPosts.length === beforeWatchPosts, apiPosts);

    // A ghost race uses the same board action but keeps the player climb live and records its normal run start.
    await openHall();
    const ghostId = await clickHallAction('Demo climb', 'ghost');
    await waitForReplay('ghost');
    await page.waitForFunction(() => document.querySelector('.replay-ui--race.replay-ready'), null,
      { timeout: 10000, polling: 50 });
    const beforeRace = apiPosts.length;
    const playerStart = await page.evaluate(() => window.peak.player.pos.toArray());
    const runStart = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/peak/run', { timeout: 10000 });
    await page.keyboard.down('w');
    await runStart;
    await page.waitForFunction(() => window.peak.game.time > 0.25 && window.peak.replays.time > 0.2, null,
      { timeout: 5000, polling: 50 });
    const toggle = page.locator('.replay-ghost-toggle');
    await toggle.click();
    const hidden = await page.evaluate(() => ({ hidden: window.peak.replays.hidden,
      visible: window.peak.replays.actor.root.visible, gameTime: window.peak.game.time,
      replayTime: window.peak.replays.time, player: window.peak.player.pos.toArray() }));
    await page.waitForTimeout(250);
    const whileHidden = await page.evaluate(() => ({ gameTime: window.peak.game.time,
      replayTime: window.peak.replays.time, player: window.peak.player.pos.toArray() }));
    await toggle.click();
    const shown = await page.evaluate(() => ({ hidden: window.peak.replays.hidden,
      visible: window.peak.replays.actor.root.visible }));
    await page.keyboard.up('w');
    const racePosts = apiPosts.slice(beforeRace);
    const raceMoved = Math.hypot(...hidden.player.map((value, i) => value - playerStart[i]));
    const hiddenMoved = Math.hypot(...whileHidden.player.map((value, i) => value - hidden.player[i]));
    check('Race ghost follows the live climb clock and hide/show does not stop player movement', !!ghostId
      && raceMoved > 0.05 && hiddenMoved > 0.01 && hidden.hidden && !hidden.visible && !shown.hidden && shown.visible
      && Math.abs(hidden.gameTime - hidden.replayTime) < 0.05 && whileHidden.gameTime > hidden.gameTime
      && whileHidden.replayTime > hidden.replayTime, { ghostId, raceMoved, hiddenMoved, hidden, whileHidden, shown });
    check('A ghost race still starts a normal scored run', racePosts.some(post => post.path === '/api/peak/run'), racePosts);

    const ghostPlatforms = await page.evaluate(() => {
      const { replays: c, world } = window.peak;
      const ledges = world.animated.filter(thing => thing.solid?.loose);
      const snapshot = () => ledges.map(ledge => ({ state: ledge.state, off: !!ledge.solid.off }));
      const before = snapshot();
      const contact = c.actor.replay.samples.find(row => row[7] === 0 && world.solids[row[9]]?.loose);
      c.seek(contact[0] / 1000 + 1.55);
      return { before, after: snapshot() };
    });
    check('Seeking the racing ghost cannot collapse the live player platforms',
      JSON.stringify(ghostPlatforms.before) === JSON.stringify(ghostPlatforms.after), ghostPlatforms);

    // Route fingerprint mismatches and missing IDs are shown as UI errors, never as playable actors.
    await page.unroute('https://stats.mosredna.eu/**');
    const beforeValidationPosts = apiPosts.length;
    await page.route('**/api/peak/replay/**', async route => {
      const response = await route.fetch({ timeout: 10000 });
      const payload = await response.json();
      payload.replay.route = 'incompatible-route';
      await route.fulfill({ response, json: payload });
    });
    await page.goto(`${base}/peak.html?replay=${encodeURIComponent(watchId)}`);
    await waitForReplay('replay');
    const mismatch = await page.evaluate(() => ({ error: window.peak.replays.error, ready: window.peak.replays.ready,
      actor: !!window.peak.replays.actor, status: document.querySelector('.replay-status')?.textContent ?? '' }));
    check('A replay for a different route is rejected with an error', !mismatch.ready
      && !mismatch.actor && /route fingerprint mismatch/i.test(`${mismatch.error} ${mismatch.status}`), mismatch);
    await page.unroute('**/api/peak/replay/**');

    const postsAfterRace = apiPosts.length;
    await page.goto(`${base}/peak.html?replay=missing_replay_01`);
    await waitForReplay('replay');
    const missing = await page.evaluate(() => ({ error: window.peak.replays.error,
      actor: !!window.peak.replays.actor, ready: window.peak.replays.ready,
      status: document.querySelector('.replay-status')?.textContent ?? '' }));
    check('A missing run is presented as unavailable', !missing.actor
      && /no longer available/i.test(`${missing.error} ${missing.status}`), missing);
    check('A missing watch run never sends a score POST', apiPosts.length === postsAfterRace
      && postsAfterRace === beforeValidationPosts, apiPosts);
  } finally {
    await page.keyboard.up('w').catch(() => {});
    page.off('request', onRequest);
  }
  return { passed: checks.filter(item => item.pass).length, total: checks.length, checks };
}
