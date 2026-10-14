// Real unlock, decoded MP3 loop seam, lifecycle and failure isolation; run in a fresh Playwright tab on 5280.
async page => {
  const checks = [], errors = [], loads = [];
  const onError = e => errors.push(e.message);
  const onRequest = r => { if (/peak-downhill.*\.mp3/.test(r.url())) loads.push(r.url()); };
  page.on('pageerror', onError); page.on('request', onRequest);
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });
  await page.goto('http://127.0.0.1:5280/downhill.html?manual');
  await page.waitForFunction(() => !!window.downhill, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const { DownhillMusic } = await import('./peak/downhill/music.js');
    window.musicCheck = new DownhillMusic(downhill.sounds);
    window.musicSoundBefore = downhill.sounds.enabled;
    musicCheck.start();
  });
  let result = await page.evaluate(() => musicCheck.state);
  check('Run request stays silent and has no musical clock before unlock', !result.ready && !result.playing && result.loopTime === null && loads.length === 0, result);
  await page.locator('canvas').first().click({ position: { x: 30, y: 40 } });
  await page.evaluate(() => { if (!downhill.sounds.enabled) downhill.sounds.setEnabled(true); });
  await page.waitForFunction(() => musicCheck.ready || musicCheck.error, null, { timeout: 30000 });
  result = await page.evaluate(() => musicCheck.state);
  check('Trusted unlock loads two music assets and starts one shared-context loop', result.ready && result.playing && result.voices === 1 && !result.error
    && await page.evaluate(() => musicCheck.sounds.context === downhill.sounds.context), result);
  const decoded = await page.evaluate(async () => {
    const loop = musicCheck.buffers.get('run'), finish = musicCheck.buffers.get('finish');
    const offline = new OfflineAudioContext(2, Math.round(loop.sampleRate * .6), loop.sampleRate);
    const source = offline.createBufferSource(); source.buffer = loop; source.loop = true; source.connect(offline.destination);
    source.start(0, loop.duration - .3);
    const audio = await offline.startRendering(), at = Math.round(loop.sampleRate * .3);
    const edges = [0, 1].map(c => Math.abs(audio.getChannelData(c)[at] - audio.getChannelData(c)[at - 1]));
    return { loop: loop.duration, finish: finish.duration, channels: loop.numberOfChannels, edges };
  });
  check('Decoded loop is exactly 32 bars at 120 BPM, with a smooth boundary', Math.abs(decoded.loop - 64) < .001
    && decoded.finish < 5 && decoded.channels === 2 && decoded.edges.every(v => v < .02), decoded);
  result = await page.evaluate(() => {
    const origin = musicCheck.origin;
    for (let i = 0; i < 20; i++) musicCheck.start();
    return { origin, after: musicCheck.origin, state: musicCheck.state };
  });
  check('Begin and later gate events cannot stack or restart the music', result.origin === result.after && result.state.counts.run === 1, result);
  result = await page.evaluate(() => {
    const time = musicCheck.loopTime(), context = downhill.sounds.context;
    return { time, clock: context.currentTime, origin: musicCheck.origin, duration: musicCheck.buffers.get('run').duration };
  });
  check('Musical clock follows the audio playhead and its 40 ms downbeat offset', result.time >= 0 && result.time < result.duration
    && Math.abs((result.clock - result.origin - result.time + result.duration) % result.duration - .04) < .001, result);
  await page.evaluate(() => musicCheck.duck(.24));
  check('Mishaps duck the run', await page.evaluate(() => musicCheck.state.duck === .24));
  await page.evaluate(() => musicCheck.duck(1));
  check('Respawn restores the run without changing phase', await page.evaluate(() => musicCheck.state.duck === 1 && musicCheck.state.playing));
  const origin = await page.evaluate(() => musicCheck.origin);
  await page.evaluate(() => downhill.sounds.setEnabled(false));
  await page.waitForTimeout(160);
  result = await page.evaluate(() => musicCheck.state);
  check('Shared Sound off releases music voices and hides the beat clock', !result.playing && result.voices === 0 && result.loopTime === null, result);
  await page.evaluate(() => downhill.sounds.setEnabled(true));
  await page.waitForFunction(() => musicCheck.state.playing);
  result = await page.evaluate(() => musicCheck.state);
  check('Unmute resumes the continuing musical phase', result.phase > .1 && await page.evaluate(origin => musicCheck.origin === origin, origin), result);
  await page.evaluate(() => downhill.sounds.pause());
  await page.waitForTimeout(160);
  result = await page.evaluate(() => musicCheck.state);
  check('Focus loss releases the loop and hides the beat clock', !result.playing && result.voices === 0 && result.loopTime === null, result);
  await page.evaluate(() => downhill.sounds.resume());
  await page.waitForFunction(() => musicCheck.state.playing);
  result = await page.evaluate(() => {
    const loop = musicCheck.loop, origin = musicCheck.origin;
    musicCheck.finish(); musicCheck.finish();
    return { state: musicCheck.state, sameLoop: loop === musicCheck.loop, sameOrigin: origin === musicCheck.origin };
  });
  check('Finish overlays one short answer while preserving the running loop and its phase', result.state.scene === 'finished'
    && result.state.stingPlaying && result.state.playing && result.state.counts.finish === 1 && result.sameLoop && result.sameOrigin, result);
  await page.waitForTimeout(4700);
  result = await page.evaluate(() => musicCheck.state);
  check('The sting releases its voice while the party keeps the tune', !result.stingPlaying && result.playing && result.voices === 1, result);
  const partyClock = await page.evaluate(() => ({ time: musicCheck.loopTime(), phase: musicCheck.state.phase, origin: musicCheck.origin, count: musicCheck.counts.run }));
  await page.evaluate(() => downhill.sounds.setEnabled(false));
  await page.waitForTimeout(160);
  result = await page.evaluate(() => musicCheck.state);
  check('Mute hides the dance clock while preserving the continuing internal phase', !result.playing && result.voices === 0
    && result.loopTime === null && result.phase > partyClock.phase
    && await page.evaluate(origin => musicCheck.origin === origin, partyClock.origin), result);
  await page.evaluate(() => downhill.sounds.setEnabled(true));
  await page.waitForFunction(() => musicCheck.state.playing);
  result = await page.evaluate(() => musicCheck.state);
  check('Unmute during the party resumes the same tune without replaying the sting', result.playing && result.counts.finish === 1
    && result.counts.run === partyClock.count + 1 && !result.stingPlaying
    && result.loopTime > partyClock.time
    && await page.evaluate(origin => musicCheck.origin === origin, partyClock.origin), result);
  await page.evaluate(() => musicCheck.reset());
  await page.waitForTimeout(160);
  result = await page.evaluate(() => musicCheck.state);
  check('Reset stops the finish party and clears its musical clock', !result.playing && result.voices === 0 && result.loopTime === null, result);
  await page.evaluate(() => { musicCheck.reset(); musicCheck.start(); });
  result = await page.evaluate(() => musicCheck.state);
  check('Restart starts a new musical origin', result.scene === 'run' && result.playing && result.phase < .3 && result.duck === 1, result);
  const failure = await page.evaluate(() => {
    musicCheck.reset();
    const context = downhill.sounds.context, original = context.createBufferSource.bind(context);
    context.createBufferSource = () => { throw new Error('QA music device failure'); };
    musicCheck.start(); context.createBufferSource = original;
    const before = downhill.sfx.counts.get('lift') ?? 0;
    downhill.sfx.cue({ type: 'jump' });
    return { error: musicCheck.error, effectsWork: downhill.sfx.counts.get('lift') === before + 1 };
  });
  check('An audio-device failure is contained and effects still work', failure.error === 'QA music device failure' && failure.effectsWork, failure);
  await page.evaluate(() => { musicCheck.dispose(); downhill.sounds.setEnabled(musicSoundBefore); });
  await page.waitForTimeout(160);
  check('Dispose releases nodes and decoded buffers', await page.evaluate(() => musicCheck.voices.size === 0 && musicCheck.buffers.size === 0));
  check('No uncaught music errors', errors.length === 0, errors);
  page.off('pageerror', onError); page.off('request', onRequest);
  const failed = checks.filter(c => !c.pass);
  if (failed.length) throw new Error(JSON.stringify(failed));
  return { passed: checks.length, total: checks.length, checks };
}
