// Run in a fresh Playwright tab with the dev server on 5280. Does not edit the downhill entry point.
async page => {
  const checks = [], errors = [];
  const onError = e => errors.push(e.message);
  page.on('pageerror', onError);
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  await page.goto('http://127.0.0.1:5280/downhill.html?manual');
  await page.waitForFunction(() => !!window.downhill, null, { timeout: 60000 });
  const locked = await page.evaluate(async () => {
    const { DownhillSfx } = await import('./peak/downhill/sfx.js');
    window.sfxCheck = new DownhillSfx(downhill.sounds);
    window.soundBeforeCheck = downhill.sounds.enabled;
    return sfxCheck.state;
  });
  check('No separate context or asset fetch before audio unlock', !locked.ready && !locked.audible && locked.voices === 0, locked);
  await page.locator('canvas').first().click({ position: { x: 30, y: 40 } });
  await page.evaluate(() => { if (!downhill.sounds.enabled) downhill.sounds.setEnabled(true); });
  await page.waitForFunction(() => sfxCheck.ready || sfxCheck.error, null, { timeout: 30000 });
  let result = await page.evaluate(() => ({ state: sfxCheck.state, buffers: sfxCheck.buffers.size,
    sameContext: sfxCheck.sounds.context === downhill.sounds.context }));
  check('Real gesture decodes all thirty-three effects on the shared context', result.buffers === 33 && result.sameContext && !result.state.error, result);
  const decodedLoops = await page.evaluate(() => ['roll-piste', 'roll-ice', 'roll-bank', 'roll-powder', 'wind', 'brake', 'swivel', 'scrape']
    .map(id => {
      const buffer = sfxCheck.buffers.get(id), samples = buffer.getChannelData(0);
      return { id, duration: buffer.duration, seam: Math.abs(samples[0] - samples[samples.length - 1]) };
    }));
  check('All eight AAC loops trim the codec padding and keep a smooth two-second boundary',
    decodedLoops.every(loop => Math.abs(loop.duration - 2) < .001 && loop.seam < .02), decodedLoops);
  result = await page.evaluate(() => {
    sfxCheck.update({ active: true, speed: 18, grounded: true, surface: 'piste', brake: 0.7, spin: 8, missing: 2 });
    for (let n = 0; n < 100; n++) sfxCheck.cue({ type: 'crash', kind: 'rock', impulse: 8 });
    return sfxCheck.state;
  });
  check('Rolling, braking, swivel and damage start distinct bounded loops', result.loops.sort().join(',') === 'brake,roll-piste,scrape,swivel,wind', result);
  check('Repeated collision contacts do not pile up a hundred impacts', result.counts['crash-rock'] === 1 && result.voices <= 6, result);
  result = await page.evaluate(() => {
    sfxCheck.update({ active: true, speed: 25, grounded: false, surface: 'ice', brake: 1, spin: -10, missing: 4 });
    return sfxCheck.state;
  });
  check('Flight stops all ground-contact loops', result.loops.sort().join(',') === 'swivel,wind', result);
  await page.waitForTimeout(160);
  result = await page.evaluate(() => {
    sfxCheck.update({ active: true, speed: 20, grounded: true, surface: 'ice', brake: 0, spin: 0, missing: 0 });
    return sfxCheck.state;
  });
  check('Ice replaces the snow caster loop', result.loops.sort().join(',') === 'roll-ice,wind', result);
  result = await page.evaluate(() => {
    const before = sfxCheck.counts.get('crash-metal') ?? 0;
    sfxCheck.cue({ type: 'crash', kind: 'pole', impulse: 7 });
    const pole = (sfxCheck.counts.get('crash-metal') ?? 0) - before;
    const counts = JSON.stringify(sfxCheck.state.counts);
    for (const kind of ['future-obstacle', 'constructor', '__proto__', undefined, null]) {
      sfxCheck.cue({ type: 'crash', kind, impulse: 7 });
      sfxCheck.cue({ type: 'bump', kind });
    }
    return { pole, unchanged: counts === JSON.stringify(sfxCheck.state.counts) };
  });
  check('Banner poles clang and unknown crash/bump kinds are safely ignored', result.pole === 1 && result.unchanged, result);
  await page.evaluate(() => downhill.sounds.setEnabled(false));
  await page.waitForTimeout(180);
  result = await page.evaluate(() => sfxCheck.state);
  check('Sound off releases every downhill voice', !result.audible && result.voices === 0 && result.loops.length === 0, result);
  await page.evaluate(() => downhill.sounds.setEnabled(true));
  await page.waitForFunction(() => sfxCheck.audible);
  result = await page.evaluate(() => sfxCheck.state);
  check('Sound on restores the current surface loops', result.loops.includes('roll-ice') && result.loops.includes('wind'), result);
  await page.evaluate(() => downhill.sounds.pause());
  await page.waitForTimeout(180);
  result = await page.evaluate(() => sfxCheck.state);
  check('Focus loss releases loops and one-shots', !result.audible && result.voices === 0, result);
  await page.evaluate(() => downhill.sounds.resume());
  await page.waitForFunction(() => sfxCheck.audible);
  const cues = [
    { type: 'jump' }, { type: 'land', impact: 2, air: 0.1 }, { type: 'land', impact: 10, air: 2 },
    ...['rock', 'tree', 'wall', 'cabinet', 'desk', 'printer', 'pole'].map(kind => ({ type: 'crash', kind, impulse: 7 })),
    { type: 'wheel', cause: 'landing', left: 3 },
    ...['snowman', 'pin', 'knockoff', 'photographer', 'cooler', 'ficus', 'tree'].map(kind => ({ type: 'bump', kind })),
    { type: 'bird' },
    { type: 'bowling', down: 10 }, { type: 'flight', distance: 70, kLine: 50 },
    ...['photo', 'pit', 'lost', 'splash', 'wrecked', 'finish'].map(type => ({ type })),
  ];
  await page.evaluate(() => sfxCheck.reset());
  for (const cue of cues) {
    await page.evaluate(cue => sfxCheck.cue(cue), cue);
    await page.waitForTimeout(140);
  }
  result = await page.evaluate(() => sfxCheck.state);
  check('Every material/event cue reaches its decoded sound', ['lift', 'land-soft', 'land-hard', 'crash-rock', 'crash-tree',
    'crash-metal', 'crash-desk', 'crash-printer', 'wheel', 'snowman', 'chair', 'photographer', 'cooler', 'ficus',
    'strike', 'crowd', 'photo', 'pit', 'lost', 'splash', 'wrecked', 'finish', 'branches', 'bird'].every(id => result.counts[id] > 0), result);
  result = await page.evaluate(() => {
    const before = sfxCheck.counts.get('crowd');
    sfxCheck.cue({ type: 'flight', distance: 60, kLine: 80 });
    return { before, after: sfxCheck.counts.get('crowd') };
  });
  check('The crowd respects the current larger K line', result.before === result.after, result);
  result = await page.evaluate(() => {
    const before = sfxCheck.counts.get('bonus') ?? 0;
    for (const seconds of [0, -1, NaN, Infinity]) sfxCheck.cue({ type: 'bonus', seconds });
    const quiet = (sfxCheck.counts.get('bonus') ?? 0) === before;
    sfxCheck.cue({ type: 'bonus', seconds: 2 });
    const voice = [...sfxCheck.voices.values()].find(v => v.source.buffer === sfxCheck.buffers.get('bonus'));
    return { quiet, level: voice?.level, rate: voice?.rate };
  });
  check('Bonus ignores non-positive/invalid time and plays a small cue in tune', result.quiet && result.level > .2 && result.rate === 1, result);
  const smallBonus = result.level;
  await page.waitForTimeout(160);
  result = await page.evaluate(() => {
    sfxCheck.cue({ type: 'bonus', seconds: 20 });
    const voices = [...sfxCheck.voices.values()].filter(v => v.source.buffer === sfxCheck.buffers.get('bonus'));
    return { level: voices.at(-1)?.level, duration: sfxCheck.buffers.get('bonus').duration };
  });
  check('More time saved gives a larger, short bonus cue below the cheers', result.level > smallBonus && result.level <= .42 + 1e-9 && result.duration < .5, result);
  await page.evaluate(() => sfxCheck.reset());
  await page.waitForTimeout(180);
  result = await page.evaluate(() => sfxCheck.state);
  check('Restart/respawn clears voices and ground-contact requests', result.voices === 0 && result.loops.length === 0
    && Object.values(result.targets).every(t => t.gain === 0), result);
  await page.waitForFunction(() => downhill.sfx.ready);
  result = await page.evaluate(() => {
    const before = downhill.sfx.counts.get('branches') ?? 0, trunks = downhill.sfx.counts.get('crash-tree') ?? 0;
    downhill.ride.emit('bump', { kind: 'tree' });
    return { rustles: (downhill.sfx.counts.get('branches') ?? 0) - before,
      trunks: (downhill.sfx.counts.get('crash-tree') ?? 0) - trunks };
  });
  check('The live branch bump rustles without a trunk impact', result.rustles === 1 && result.trunks === 0, result);
  result = await page.evaluate(() => {
    const { birds } = downhill.obstacles, V = downhill.THREE.Vector3;
    birds.reset();
    window.birdCountBefore = downhill.sfx.counts.get('bird') ?? 0;
    const at = downhill.rider.perch.getWorldPosition(new V());
    birds.launch(at, new V(0, 0, 1), new V(0, 0, 10));
    birds.update(.35); birds.update(1.69);
    return { phase: birds.flying[0].userData.phase, chirps: (downhill.sfx.counts.get('bird') ?? 0) - birdCountBefore };
  });
  check('A perched bird stays quiet while dazed', result.phase === 'sit' && result.chirps === 0, result);
  result = await page.evaluate(() => {
    const { birds } = downhill.obstacles;
    birds.update(.02);
    const phase = birds.flying[0].userData.phase;
    for (let i = 0; i < 30; i++) birds.update(.02);
    const chirps = (downhill.sfx.counts.get('bird') ?? 0) - birdCountBefore;
    birds.reset();
    birds.launch(downhill.rider.perch.getWorldPosition(new downhill.THREE.Vector3()),
      new downhill.THREE.Vector3(0, 0, 1), new downhill.THREE.Vector3(0, 0, 10));
    birds.reset(); birds.update(5);
    return { phase, chirps, afterReset: (downhill.sfx.counts.get('bird') ?? 0) - birdCountBefore };
  });
  check('Takeoff chirps exactly once, with no delayed chirp after reset', result.phase === 'fly'
    && result.chirps === 1 && result.afterReset === 1, result);
  await page.route('**/audio/downhill/lift.m4a', route => route.fulfill({ status: 404, body: 'Missing test asset' }));
  await page.evaluate(() => { window.failedSfx = new sfxCheck.constructor(downhill.sounds); });
  await page.waitForFunction(() => !!failedSfx.error);
  result = await page.evaluate(() => {
    failedSfx.cue({ type: 'jump' });
    downhill.step(0.02);
    const evidence = { error: failedSfx.error, ready: failedSfx.ready };
    failedSfx.dispose();
    return evidence;
  });
  await page.unroute('**/audio/downhill/lift.m4a');
  check('An unavailable asset is contained and the game keeps stepping', /HTTP 404/.test(result.error) && !result.ready, result);
  await page.evaluate(() => { sfxCheck.dispose(); downhill.sounds.setEnabled(soundBeforeCheck); });
  check('No JavaScript errors during playback and lifecycle checks', errors.length === 0, errors);
  page.off('pageerror', onError);
  const failed = checks.filter(c => !c.pass);
  if (failed.length) throw new Error(JSON.stringify(failed));
  return { passed: checks.length, total: checks.length, checks };
}
