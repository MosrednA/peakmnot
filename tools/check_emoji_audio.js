// Execute this function in a fresh Playwright page; needs the worktree dev server on 5296.
async page => {
  const checks = [], errors = [], loads = [];
  const check = (name, pass, evidence) => checks.push({name, pass, evidence});
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/audio\/emoji\//.test(r.url())) loads.push(r.url()); });
  await page.goto('http://127.0.0.1:5296/emoji.html?manual&seed=1');
  await page.waitForFunction(() => !!window.emoji, null, {timeout:60000});
  check('No palette or music download before gesture unlock', loads.length === 0, loads.slice());
  await page.keyboard.press('ArrowUp');
  await page.evaluate(() => { emoji.sounds.setEnabled(true); emoji.music.start(); });
  await page.waitForFunction(() => emoji.sfx.ready && emoji.music.ready, null, {timeout:30000});
  check('Shared trusted unlock decodes all effects and both scores', await page.evaluate(() =>
    emoji.sfx.buffers.size === 19 && emoji.music.buffers.size === 2 && emoji.music.state.playing));
  const pcm = await page.evaluate(() => {
    const loops = ['slide','skid'].map(id => {
      const b = emoji.sfx.buffers.get(id), x = b.getChannelData(0);
      return {id, seconds:b.duration, edge:Math.abs(x[0]-x[x.length-1])};
    });
    const run = emoji.music.buffers.get('run');
    return {loops, duration:run.duration, edges:Array.from({length:run.numberOfChannels}, (_, i) => {
      const x = run.getChannelData(i); return Math.abs(x[0]-x[x.length-1]);
    })};
  });
  check('AAC padding trimmed to two-second snow loops', pcm.loops.every(l => Math.abs(l.seconds-2)<.001 && l.edge<.08), pcm);
  check('Music is 32 bars at 112 BPM with a smooth seam', Math.abs(pcm.duration-128*535714/1e6)<.001
    && pcm.edges.every(e => e<.02), pcm);
  const cues = [{type:'start'}, {type:'take',n:1,of:5}, {type:'wrong',lives:2}, {type:'early',lives:1},
    {type:'out'}, {type:'fall'}, {type:'bonk',speed:8,hard:.8}, {type:'peek',up:true}, {type:'peek',up:false},
    {type:'clear'}, {type:'peak'}, {type:'finish'}, {type:'crack'}, {type:'quake',holes:4}, {type:'hole',under:true,finale:true},
    {type:'pit',fresh:false}, {type:'climb'}];
  for (const cue of cues) {
    const result = await page.evaluate(event => {
      emoji.sfx.cue(event); return emoji.sfx.state;
    }, cue);
    const id = cue.type === 'peek' ? `peek-${cue.up ? 'up' : 'down'}` : cue.type;
    check(`Cue ${id} plays`, result.counts[id] >= 1 && !result.error, result);
    await page.waitForTimeout(55);
  }
  const moving = await page.evaluate(() => {
    emoji.sfx.update(1/60, {speed:8,skid:4,braking:true,dizzy:0,peek:0});
    return emoji.sfx.state;
  });
  check('Speed and skid start both snow loops', moving.loops.length === 2, moving);
  await page.evaluate(() => emoji.sounds.setEnabled(false));
  await page.waitForTimeout(180);
  check('Mute releases every effect/music voice', await page.evaluate(() =>
    emoji.sfx.voices.size === 0 && emoji.music.voices.size === 0 && emoji.music.loopTime() === null));
  await page.evaluate(() => emoji.sounds.setEnabled(true));
  await page.waitForFunction(() => emoji.music.state.playing);
  const finished = await page.evaluate(() => {
    const loop = emoji.music.loop, origin = emoji.music.origin;
    emoji.music.duck(.24);
    const duck = emoji.music.state.duck;
    emoji.music.duck(1);
    emoji.music.finish(); emoji.music.finish();
    return {duck, same:emoji.music.loop === loop && emoji.music.origin === origin, state:emoji.music.state};
  });
  check('Finish overlays one answer while preserving the beat', finished.same && finished.duck === .24
    && finished.state.counts.finish === 1 && finished.state.stingPlaying, finished);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await page.waitForTimeout(180);
  check('Pause releases all voices', await page.evaluate(() => !emoji.sfx.audible && emoji.sfx.voices.size === 0
    && !emoji.music.state.playing && emoji.music.voices.size === 0));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => emoji.music.state.playing);
  check('Resume never repeats the finish answer', await page.evaluate(() => emoji.music.counts.finish === 1 && !emoji.music.sting));
  await page.evaluate(() => { emoji.sfx.reset(); emoji.music.reset(); });
  await page.waitForTimeout(180);
  check('Reset releases voices and resets the clock', await page.evaluate(() => emoji.sfx.voices.size === 0
    && emoji.music.voices.size === 0 && emoji.music.loopTime() === null && emoji.music.origin === null));
  const run = await page.evaluate(() => {
    emoji.restart(); emoji.autopilot(true);
    for (let i=0; i<18000 && !emoji.player.done && !emoji.player.out; i++) emoji.step(1/60);
    emoji.render();
    return {done:emoji.player.done, out:emoji.player.out, time:emoji.player.time,
      effects:emoji.sfx.state, music:emoji.music.state};
  });
  check('Whole autopilot run finishes with audio enabled', run.done && !run.out && !run.effects.error && !run.music.error, run);
  await page.evaluate(() => { emoji.sfx.reset(); emoji.music.reset(); });
  await page.waitForTimeout(180);
  const failures = await page.evaluate(() => {
    const context = emoji.sounds.context, create = context.createBufferSource;
    context.createBufferSource = () => { throw new Error('QA audio device failure'); };
    emoji.sfx.cue({type:'start'});
    emoji.music.start();
    context.createBufferSource = create;
    emoji.step(1/60);
    return {sfx:emoji.sfx.error, music:emoji.music.error};
  });
  check('Audio device failures stay contained while the game steps', failures.sfx === 'QA audio device failure'
    && failures.music === failures.sfx, failures);
  await page.evaluate(() => { emoji.sfx.dispose(); emoji.music.dispose(); });
  await page.waitForTimeout(180);
  check('Dispose releases buffers and voices', await page.evaluate(() => emoji.sfx.buffers.size === 0
    && emoji.sfx.voices.size === 0 && emoji.music.buffers.size === 0 && emoji.music.voices.size === 0));
  check('No uncaught browser errors', errors.length === 0, errors);
  if (checks.some(c=>!c.pass)) throw new Error(JSON.stringify(checks.filter(c=>!c.pass)));
  return {passed:checks.length, total:checks.length, run, checks};
}
