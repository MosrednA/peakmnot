// Run with Playwright's browser_run_code_unsafe(filename), while the viewer server is running.
// Deterministic browser checks: actual DOM input, GLB clips, mixer and rendered viewer.
async (page) => {
  await page.addInitScript(() => {
    window.__testTime = 0;
    performance.now = () => window.__testTime;
    window.requestAnimationFrame = callback => { window.__frame = callback; return 1; };
    window.__step = (seconds, fps = 60) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        window.__testTime += 1000 / fps;
        window.__frame(window.__testTime);
      }
    };
    window.__key = (code, down, repeat = false) => document.body.dispatchEvent(new KeyboardEvent(
      down ? 'keydown' : 'keyup', { code, repeat, bubbles: true, cancelable: true }));
  });
  const checks = [];
  const fresh = async () => {
    await page.goto('http://127.0.0.1:5280/');
    await page.waitForFunction(() => !!window.viewer?.mnot, null, { polling: 50 });
    await page.evaluate(() => __step(0.1));
  };
  const check = (name, pass, evidence) => checks.push({ name, pass, evidence });

  await fresh();
  let result = await page.evaluate(() => {
    __key('KeyW', true); __key('Space', true); __step(1 / 60);
    return { clip: viewer.clip, time: viewer.motion.clipTime, jumpHeight: viewer.motion.jumpHeight };
  });
  check('W and Space together select LeapStart at walking height', result.clip === 'LeapStart'
    && Math.abs(result.jumpHeight - 0.6) < 0.001, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __key('ShiftLeft', true); __key('Space', true); __step(1 / 60);
    return { clip: viewer.clip, jumpHeight: viewer.motion.jumpHeight };
  });
  check('W, Shift and Space together select LeapStart at running height', result.clip === 'LeapStart'
    && Math.abs(result.jumpHeight - 0.8) < 0.001, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('Space', true); __step(0.14);
    return { clip: viewer.clip, airborne: viewer.motion.airborne, height: viewer.motion.height };
  });
  check('Standing jump is airborne within 140 ms', result.clip === 'JumpStart' && result.airborne
    && result.height > 0, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.4); __key('Space', true); __key('Space', false); __step(0.2);
    __key('KeyW', false);
    const flat = () => viewer.mnot.position.clone().setY(0);   // the root also flies up and down now
    const released = flat();
    __step(0.4);
    const beforeLanding = flat(), airborne = viewer.motion.airborne;
    __step(0.5);
    return { flightDistance: beforeLanding.distanceTo(released), landingDrift: flat().distanceTo(beforeLanding),
      airborne, height: viewer.motion.height, speed: viewer.motion.speed, clip: viewer.clip,
      jumping: viewer.motion.jumping };
  });
  check('Release retains flight momentum and brakes on touchdown', result.flightDistance > 0.2 && result.airborne
    && result.landingDrift < 0.1 && result.height === 0 && result.speed === 0 && !result.jumping
    && result.clip === 'Idle', result);

  await fresh();
  result = await page.evaluate(() => {
    __key('Space', true); __key('Space', false); __step(0.6);
    const airborne = viewer.motion.airborne;
    __key('Space', true); __key('Space', false); __step(0.13);
    return { airborneAtPress: airborne, clip: viewer.clip, time: viewer.motion.clipTime, jumping: viewer.motion.jumping };
  });
  check('A press just before touchdown buffers the next jump', result.airborneAtPress
    && result.clip === 'JumpStart' && result.jumping && result.time < 0.12, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('Space', true); __step(1.3);
    __key('Space', true, true); __step(0.2);
    return { clip: viewer.clip, jumping: viewer.motion.jumping };
  });
  check('Holding Space does not auto-repeat jumps', result.clip === 'Idle' && !result.jumping, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.4);
    const walk = viewer.motion.speed;
    __key('ShiftLeft', true); __step(1 / 60);
    const firstRunFrame = viewer.motion.speed;
    __step(0.4);
    const run = viewer.motion.speed;
    const sums = [];
    for (let i = 0; i < 24; i++) {
      __key('ShiftLeft', i % 2 === 0); __step(1 / 60);
      sums.push(viewer.motion.weights.reduce((sum, pair) => sum + pair[1], 0));
    }
    __key('KeyW', false); __key('ShiftLeft', false); __step(0.5);
    return { walk, firstRunFrame, run, minWeight: Math.min(...sums), maxWeight: Math.max(...sums), stop: viewer.motion };
  });
  check('Shift accelerates smoothly and release returns to Idle', Math.abs(result.walk - 0.625) < 0.005
    && result.firstRunFrame > result.walk && result.firstRunFrame < 1.4 && Math.abs(result.run - 2.083) < 0.005
    && result.stop.speed === 0, result);
  check('Interrupted blends keep total weight at one', Math.abs(result.minWeight - 1) < 0.001
    && Math.abs(result.maxWeight - 1) < 0.001, { min: result.minWeight, max: result.maxWeight });

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __key('ShiftLeft', true); __step(1); __key('ShiftLeft', false);
    let maxPhaseError = 0, maxRateError = 0;
    const clips = [];
    for (let i = 0; i < 8; i++) {
      __step(1 / 60);
      const [walk, run] = viewer.motion.gaits;
      const error = Math.abs(walk.phase - run.phase);
      maxPhaseError = Math.max(maxPhaseError, Math.min(error, 1 - error));
      maxRateError = Math.max(maxRateError, Math.abs(walk.rate - run.rate));
      clips.push(viewer.clip);
    }
    return { clips, maxPhaseError, maxRateError };
  });
  check('Run to Walk blends immediately and keeps both feet in phase', result.clips.every(c => c === 'Walk')
    && result.maxPhaseError < 0.001 && result.maxRateError < 0.001, result);

  await fresh();
  result = await page.evaluate(() => {
    document.querySelector('[data-clip="Run"]').click(); __step(0.6);
    document.querySelector('[data-clip="Walk"]').click();
    let maxPhaseError = 0, maxRateError = 0;
    for (let i = 0; i < 11; i++) {
      __step(1 / 60);
      const [walk, run] = viewer.motion.gaits;
      const error = Math.abs(walk.phase - run.phase);
      maxPhaseError = Math.max(maxPhaseError, Math.min(error, 1 - error));
      maxRateError = Math.max(maxRateError, Math.abs(walk.rate - run.rate));
    }
    __step(0.3);
    return { maxPhaseError, maxRateError, walkRate: viewer.motion.gaits[0].rate, clip: viewer.clip };
  });
  check('Run to Walk preview buttons also synchronize through the blend', result.maxPhaseError < 0.001
    && result.maxRateError < 0.001 && Math.abs(result.walkRate - 1.25) < 0.001 && result.clip === 'Walk', result);

  await fresh();
  result = await page.evaluate(() => {
    document.querySelector('[data-clip="Run"]').click(); __step(0.4);
    document.querySelector('[data-clip="Walk"]').click(); __step(1 / 60);
    document.querySelector('[data-clip="Run"]').click();
    let minWeight = 1, maxWeight = 1;
    for (let i = 0; i < 30; i++) {
      __step(1 / 60);
      const total = viewer.motion.weights.reduce((sum, pair) => sum + pair[1], 0);
      minWeight = Math.min(minWeight, total); maxWeight = Math.max(maxWeight, total);
    }
    return { clip: viewer.clip, weights: viewer.motion.weights, minWeight, maxWeight };
  });
  check('Quick preview reversal converges to the latest selection without losing pose weight', result.clip === 'Run'
    && Math.abs(result.minWeight - 1) < 0.001 && Math.abs(result.maxWeight - 1) < 0.001
    && result.weights.find(pair => pair[0] === 'Run')[1] === 1, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.4); __key('ShiftLeft', true); __step(1 / 60);
    __key('Space', true); __key('Space', false);
    const body = viewer.mnot.getObjectByName('body');
    const before = body.getWorldPosition(body.position.clone());
    const position = before.clone();
    let minWeight = 1, maxWeight = 1, maxPoseStep = 0, maxContributors = 0;
    for (let i = 0; i < 12; i++) {
      __step(1 / 60);
      const weights = viewer.motion.weights.map(pair => pair[1]);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      minWeight = Math.min(minWeight, total); maxWeight = Math.max(maxWeight, total);
      maxContributors = Math.max(maxContributors, weights.filter(weight => weight > 0.001).length);
      body.getWorldPosition(position);
      maxPoseStep = Math.max(maxPoseStep, position.distanceTo(before)); before.copy(position);
    }
    const clip = viewer.clip;
    __step(0.9);
    return { clip, minWeight, maxWeight, maxPoseStep, maxContributors, resumed: viewer.clip, jumping: viewer.motion.jumping };
  });
  check('Jump smoothly interrupts a gait blend and resumes Run on landing', result.clip === 'LeapStart'
    && result.maxContributors === 3 && Math.abs(result.minWeight - 1) < 0.001
    && Math.abs(result.maxWeight - 1) < 0.001 && result.maxPoseStep < 0.12
    && result.resumed === 'Run' && !result.jumping, result);

  const distances = [];
  for (const diagonal of [false, true]) {
    await fresh();
    distances.push(await page.evaluate(diagonal => {
      __key('KeyW', true); if (diagonal) __key('KeyD', true);
      __step(1);
      return viewer.mnot.position.length();
    }, diagonal));
  }
  check('Diagonal movement has the same speed', Math.abs(distances[0] - distances[1]) < 0.001, distances);

  const frameRates = [];
  for (const fps of [30, 60, 120]) {
    await fresh();
    frameRates.push(await page.evaluate(fps => {
      __key('KeyW', true); __key('ShiftLeft', true); __step(1, fps);
      return { fps, distance: viewer.mnot.position.length(), heading: viewer.mnot.rotation.y };
    }, fps));
  }
  check('Movement and turning agree at 30, 60 and 120 fps', Math.max(...frameRates.map(r => r.distance))
    - Math.min(...frameRates.map(r => r.distance)) < 0.035
    && Math.max(...frameRates.map(r => r.heading)) - Math.min(...frameRates.map(r => r.heading)) < 0.001, frameRates);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.4); dispatchEvent(new Event('blur'));
    const start = viewer.mnot.position.clone(); __step(0.3);
    const arrow = new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true, cancelable: true });
    document.body.dispatchEvent(arrow); __key('ArrowUp', false);
    return { distance: viewer.mnot.position.distanceTo(start), speed: viewer.motion.speed, prevented: arrow.defaultPrevented };
  });
  check('Focus loss clears input and arrow keys prevent page scrolling', result.distance === 0
    && result.speed === 0 && result.prevented, result);

  await fresh();
  result = await page.evaluate(() => {
    document.getElementById('runlaps').click();
    const start = viewer.mnot.position.clone(); __step(1 / 60);
    const firstFrame = viewer.mnot.position.distanceTo(start);
    __step(0.5); viewer.jump(); __step(1 / 60);
    return { firstFrame, clip: viewer.clip, jumpHeight: viewer.motion.jumpHeight };
  });
  check('Run laps starts without snapping and selects a running LeapStart', result.firstFrame < 0.02
    && result.clip === 'LeapStart' && Math.abs(result.jumpHeight - 0.8) < 0.001, result);

  await fresh();
  result = await page.evaluate(() => {
    viewer.jump(); __step(0.3); document.querySelector('[data-clip="Idle"]').click();
    document.getElementById('stroll').click(); __key('KeyE', true); __step(1 / 60);
    return { clip: viewer.clip, airborne: viewer.motion.airborne };
  });
  check('Preview and wave cannot cancel a jump in the air', ['JumpStart', 'Fall'].includes(result.clip)
    && result.airborne, result);

  await fresh();
  result = await page.evaluate(() => {
    document.getElementById('highjump').click();
    const clips = [];
    let maxHeight = 0;
    for (let i = 0; i < 150; i++) {
      __step(1 / 60);
      if (clips.at(-1) !== viewer.clip) clips.push(viewer.clip);
      maxHeight = Math.max(maxHeight, viewer.motion.height);
    }
    return { clips, maxHeight, jumping: viewer.motion.jumping };
  });
  check('A high jump flies through the Fall loop and lands hard', result.clips.join() === 'JumpStart,Fall,LandHard,Idle'
    && Math.abs(result.maxHeight - 2.2) < 0.03 && !result.jumping, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.5); __key('Space', true); __key('Space', false);
    const clips = [];
    let walkStart = null;
    for (let i = 0; i < 60; i++) {
      __step(1 / 60);
      if (clips.at(-1) !== viewer.clip) {
        clips.push(viewer.clip);
        if (viewer.clip === 'Walk') walkStart = viewer.motion.gaits[0].phase;
      }
    }
    return { clips, walkStart, speed: viewer.motion.speed };
  });
  check('A moving landing carries on walking from the heel strike', result.clips.join() === 'LeapStart,LeapLand,Walk'
    && result.walkStart < 0.05 && Math.abs(result.speed - 0.625) < 0.005, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyW', true); __step(0.45); __key('KeyW', false);
    let previousRate = viewer.motion.gaits[0].rate, maxRateIncrease = 0, outgoingFrames = 0;
    __step(1 / 60);
    const immediateIdle = viewer.clip === 'Idle' && viewer.motion.idleEntryTime !== null;
    for (let i = 0; i < 32; i++) {
      __step(1 / 60);
      const motion = viewer.motion, gait = motion.gaits[0];
      if (motion.weights.find(pair => pair[0] === 'Walk')[1] > 0.001) {
        maxRateIncrease = Math.max(maxRateIncrease, gait.rate - previousRate);
        outgoingFrames++;
      }
      previousRate = gait.rate;
    }
    return { immediateIdle, maxRateIncrease, outgoingFrames, clip: viewer.clip,
      remainingEntries: viewer.motion.poseEntryCount };
  });
  check('Release settles directly to Idle without a prolonged slowed walking cycle', result.immediateIdle
    && result.maxRateIncrease < 0.001 && result.outgoingFrames <= 4 && result.clip === 'Idle'
    && result.remainingEntries === 0, result);

  await fresh();
  result = await page.evaluate(() => {
    document.querySelector('[data-clip="Run"]').click(); __step(0.45);
    const names = ['hand_L', 'hand_R', 'foot_L', 'foot_R'];
    const bones = names.map(name => viewer.mnot.getObjectByName(name));
    const previous = bones.map(bone => bone.getWorldPosition(bone.position.clone()));
    const maximum = [0, 0, 0, 0];
    document.querySelector('[data-clip="Idle"]').click();
    for (let frame = 0; frame < 24; frame++) {
      __step(1 / 60);
      bones.forEach((bone, i) => {
        const position = bone.getWorldPosition(bone.position.clone());
        maximum[i] = Math.max(maximum[i], position.distanceTo(previous[i])); previous[i].copy(position);
      });
    }
    return { maximum: Object.fromEntries(names.map((name, i) => [name, maximum[i]])), clip: viewer.clip };
  });
  check('Run-to-Idle hands and feet settle without the previous fast snap', result.clip === 'Idle'
    && result.maximum.hand_L < 0.025 && result.maximum.hand_R < 0.025
    && result.maximum.foot_L < 0.022 && result.maximum.foot_R < 0.022, result);

  const settling = [];
  for (const phaseTime of [0.2, 0.4]) {
    await fresh();
    settling.push(await page.evaluate(phaseTime => {
      document.querySelector('[data-clip="Walk"]').click(); __step(phaseTime);
      document.querySelector('[data-clip="Idle"]').click(); __step(1 / 60);
      return viewer.motion.idleLimbDurations;
    }, phaseTime));
  }
  check('Arms already near Idle settle sooner than arms at full walking swing',
    settling[0].arm_L < settling[1].arm_L * 0.5
    && settling[0].arm_R < settling[1].arm_R * 0.5, { nearRest: settling[0], fullSwing: settling[1] });

  await fresh();
  result = await page.evaluate(() => {
    const arm = viewer.mnot.getObjectByName('upper_arm_R'), previous = arm.quaternion.clone();
    __key('KeyE', true); __key('KeyE', false);
    const angles = [];
    for (let frame = 0; frame < 30; frame++) {
      __step(1 / 60); angles.push(arm.quaternion.angleTo(previous)); previous.copy(arm.quaternion);
    }
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const start = mean(angles.slice(0, 4)), middle = mean(angles.slice(12, 16)), end = mean(angles.slice(26, 30));
    __step(0.3);
    return { start, middle, end, clip: viewer.clip, remainingEntries: viewer.motion.waveEntryCount };
  });
  check('Wave raises the arm with acceleration and ease-out before looping', result.middle > 0.02
    && result.start < result.middle * 0.25 && result.end < result.middle * 0.25
    && result.clip === 'Wave' && result.remainingEntries === 0, result);

  await fresh();
  result = await page.evaluate(() => {
    __key('KeyE', true); __key('KeyE', false); __step(0.2);
    document.querySelector('[data-clip="Walk"]').click(); __step(0.4);
    const interrupted = viewer.clip, entriesAfterInterrupt = viewer.motion.waveEntryCount;
    for (let i = 0; i < 5; i++) {
      document.querySelector('[data-clip="Wave"]').click(); __step(0.1);
      document.querySelector('[data-clip="Idle"]').click(); __step(0.1);
    }
    document.querySelector('[data-clip="Wave"]').click(); __step(0.8);
    return { interrupted, entriesAfterInterrupt, clip: viewer.clip, remainingEntries: viewer.motion.waveEntryCount,
      totalWeight: viewer.motion.weights.reduce((sum, pair) => sum + pair[1], 0) };
  });
  check('Wave entry can be interrupted and repeated without retaining temporary clips', result.interrupted === 'Walk'
    && result.entriesAfterInterrupt === 0 && result.clip === 'Wave' && result.remainingEntries === 0
    && Math.abs(result.totalWeight - 1) < 0.001, result);

  return { passed: checks.filter(c => c.pass).length, total: checks.length, checks };
}
