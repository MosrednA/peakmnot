// Run in a fresh Playwright tab, with normal animation time and the server on port 5280.
async (page) => {
  const checks = [], errors = [];
  const onError = error => errors.push(error.message);
  const onResponse = response => {
    if (/\.(wav|m4a)$/.test(response.url()) && !response.ok()) errors.push(`${response.status()} ${response.url()}`);
  };
  page.on('pageerror', onError);
  page.on('response', onResponse);
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  const state = () => page.evaluate(() => ({ sound: viewer.sound, motion: viewer.motion, clip: viewer.clip }));
  const total = (counts, prefix) => Object.entries(counts).filter(([id]) => id.startsWith(prefix))
    .reduce((sum, [, count]) => sum + count, 0);
  const steps = counts => total(counts, 'walk-') + total(counts, 'run-');
  try {
    await page.goto('http://127.0.0.1:5280/');
    await page.waitForFunction(() => !!window.viewer?.mnot);
    if (!(await state()).sound.enabled) await page.locator('#sound').click();
    else await page.getByRole('tab', { name: 'Mnot', exact: true }).click();
    await page.waitForFunction(() => viewer.sound.ready && viewer.sound.context === 'running');
    let result = await state();
    check('A real gesture loads and decodes all ten effects', result.sound.ready && !result.sound.error,
      result.sound);

    let before = result.sound.counts;
    await page.keyboard.down('w');
    await page.waitForTimeout(950);
    result = await state();
    check('Walking produces stride footsteps', total(result.sound.counts, 'walk-') - total(before, 'walk-') >= 2,
      result.sound.counts);
    before = result.sound.counts;
    await page.keyboard.down('Shift');
    await page.waitForTimeout(950);
    result = await state();
    check('Running uses its separate faster footsteps', total(result.sound.counts, 'run-') - total(before, 'run-') >= 3,
      result.sound.counts);
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.waitForTimeout(750);
    before = (await state()).sound.counts;
    await page.waitForTimeout(400);
    result = await state();
    check('Settling to Idle stops footsteps', steps(result.sound.counts) === steps(before) && result.sound.voices === 0,
      result.sound);

    before = result.sound.counts;
    await page.keyboard.press('Space');
    await page.waitForFunction(() => viewer.motion.airborne);
    const inAir = await state();
    await page.waitForTimeout(120);
    const laterAir = await state();
    check('Push-off plays Jump once, without air noise or footsteps during takeoff',
      inAir.sound.counts.jump - before.jump === 1 && !inAir.sound.fallPlaying && laterAir.motion.airborne
      && steps(laterAir.sound.counts) === steps(inAir.sound.counts), { inAir, laterAir });
    await page.waitForFunction(() => viewer.motion.jumpPhase === 'landing');
    result = await state();
    check('A normal standing jump never plays Fall audio, including its brief Fall pose',
      result.sound.counts.fall === before.fall, result.sound.counts);
    check('Touchdown plays one soft landing and stops Fall', result.sound.counts['land-soft'] - before['land-soft'] === 1
      && result.sound.counts['land-hard'] === before['land-hard'] && !result.sound.fallPlaying, result.sound);
    await page.waitForFunction(() => !viewer.motion.jumping);

    before = (await state()).sound.counts;
    await page.locator('#highjump').click();
    await page.waitForFunction(() => viewer.clip === 'Fall' && viewer.motion.airborne);
    const highAir = await state();
    await page.waitForFunction(() => viewer.clip === 'LandHard');
    result = await state();
    check('High jump keeps Fall running until its hard touchdown', highAir.sound.fallPlaying
      && result.sound.counts['land-hard'] - before['land-hard'] === 1
      && result.sound.counts['land-soft'] === before['land-soft'] && !result.sound.fallPlaying, { highAir, landing: result });
    await page.waitForFunction(() => !viewer.motion.jumping);

    before = (await state()).sound.counts;
    await page.keyboard.press('e');
    await page.waitForTimeout(650);
    await page.keyboard.press('e');
    result = await state();
    check('Wave greets once when entering; the loop does not repeat the sound', result.sound.counts.wave - before.wave === 1,
      result.sound.counts);

    await page.locator('[data-clip="Fall"]').click();
    await page.waitForFunction(() => viewer.sound.fallPlaying);
    const loopStart = (await state()).sound.counts.fall;
    await page.waitForTimeout(5500);
    result = await state();
    check('Long balancing keeps one Fall voice looping beyond the sample duration', result.sound.fallPlaying
      && result.sound.voices === 1 && result.sound.counts.fall === loopStart, result.sound);
    await page.locator('[data-clip="Idle"]').click();
    await page.waitForTimeout(100);
    result = await state();
    check('Leaving the Fall preview fades and releases its loop', !result.sound.fallPlaying && result.sound.voices === 0,
      result.sound);

    await page.keyboard.press('m');
    before = (await state()).sound.counts;
    await page.keyboard.down('w');
    await page.waitForTimeout(600);
    await page.keyboard.up('w');
    result = await state();
    check('M mutes playback while controls keep moving', !result.sound.enabled && steps(result.sound.counts) === steps(before)
      && result.sound.voices === 0, result.sound);
    await page.reload();
    await page.waitForFunction(() => !!window.viewer?.mnot);
    result = await state();
    check('Mute preference survives a reload', !result.sound.enabled && await page.locator('#sound').innerText() === 'Sound off',
      result.sound);
    await page.locator('#sound').click();
    await page.waitForFunction(() => viewer.sound.ready && viewer.sound.context === 'running');
    await page.locator('[data-clip="Fall"]').click();
    await page.waitForFunction(() => viewer.sound.fallPlaying);
    // Headless tabs may all report focus; exercise the browser focus handlers directly.
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    await page.waitForTimeout(150);
    const blurred = await state();
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => viewer.sound.fallPlaying);
    await page.locator('[data-clip="Idle"]').click();
    check('Focus loss handler releases active audio; returning can resume it', !blurred.sound.fallPlaying
      && blurred.sound.voices === 0, blurred.sound);
    check('No audio loading or browser errors', errors.length === 0, errors);
    return { passed: checks.filter(item => item.pass).length, total: checks.length, checks };
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
    page.off('pageerror', onError);
    page.off('response', onResponse);
  }
}
