// Peak Mnot, downhill (a prototype): Mnot on a very expensive office chair, down the mountain. Sets up the stage,
// the frame loop and the HUD's moving parts with the mini game kit (peak/kit/), wires the piste, the chair, its
// physics, Mnot and the camera together, and runs the HUD and the controls. The physics steps at a fixed 120 Hz.
// Open downhill.html?manual to stop the loop and step it from the console (window.downhill.step), for tests;
// downhill.autopilot(true) lets a bot ride. ?ghost=ID races a run from the Hall of Fame, ?replay=ID watches one
// (playback.js); ?level= picks the level (kit/levels.js).
import * as THREE from 'three';
import { MnotSounds } from '../../sounds.js';
import { buildScenery } from '../look/scenery.js';
import { time as shaderTime } from '../look/materials.js';
import { loadMnot } from '../mnot/mnot.js';
import { Input } from '../controls/input.js';
import { createStage } from '../kit/stage.js';
import { warmUp } from '../kit/warmup.js';
import { startLoop, expose } from '../kit/loop.js';
import { toaster, pop, soundSwitch } from '../kit/hud.js';
import { confetti } from '../kit/party.js';
import { GamepadInput, BUTTON } from '../kit/gamepad.js';
import { PadMenu } from '../kit/padmenu.js';
import { Track, FEATURES, RIVER } from './track.js';
import { Chair, CHAIR } from './chair.js';
import { Ride } from './ride.js';
import { Obstacles } from './obstacles.js';
import { Rider } from './rider.js';
import { ChaseCamera } from './camera.js';
import { Autopilot } from './autopilot.js';
import { K_LINE } from './marks.js';
import { BONUS, jumpBonus, pinsBonus } from './bonus.js';
import { DownhillSfx } from './sfx.js';
import { DownhillMusic } from './music.js';
import { Party } from './party.js';
import { createScores } from './scores.js';
import { Title } from './title.js';
import { hookAnalytics } from './analytics.js';
import { Recording, Driver, Ghost, validate } from './playback.js';
import { routeFingerprint } from './routedata.js';
import { ReplayController } from '../replays/controller.js';
import { apiBase } from '../scores/scores.js';
import { pickLevel } from '../kit/levels.js';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');
const STEP = 1 / 120;
// The downhill's levels (kit/levels.js): one mountain so far. A level is a board, route and replays of its own.
const LEVELS = [''];
const level = pickLevel(LEVELS);
// the Hall of Fame's Race ghost (?ghost=ID) and Watch run (?replay=ID); a link with both is an error to show
const hasGhost = params.has('ghost'), hasReplay = params.has('replay');
const replayRoute = hasGhost || hasReplay ? {
  mode: hasGhost && hasReplay ? 'invalid' : hasReplay ? 'replay' : 'ghost',
  id: hasGhost && hasReplay ? '' : params.get(hasReplay ? 'replay' : 'ghost'),
} : null;
const watching = !!replayRoute && replayRoute.mode !== 'ghost';    // no run of its own: no scores, stats or keys

// The shadows reach from just behind the camera to about 50 m down the run (stage.aimSun, in step()), so a tree's
// comes in far off, not as the chair gets to it; the bias is the same 5 cm as over the old, shorter range.
const stage = createStage({ manual, fov: 52, fog: [70, 460],
  shadow: { half: 28, near: 1, far: 110, bias: -0.00048, ahead: 18, back: 50 } });
const { renderer, scene, camera, post, render } = stage;

// the range round the climb stands too close for a run this long: spread it out (and up a little), about the run's
// middle, so no peak stands in the way; the cloud sea spreads with it
const center = new THREE.Vector3(10, 0, 520), SPREAD = 3.5;
const scenery = buildScenery(scene, center);
const range = scene.getObjectByName('mountain range');
range.scale.set(SPREAD, 1.25, SPREAD);
range.position.set(center.x * (1 - SPREAD), 0, center.z * (1 - SPREAD));
scene.getObjectByName('cloud sea').scale.set(1.6, 1, 1.6);

const track = new Track();
scene.add(track.meshes());
const obstacles = new Obstacles(track, scene);
const chair = new Chair();
scene.add(chair.root);
const mnot = await loadMnot();
const rider = new Rider(mnot, chair);
obstacles.birds.perch = rider.perch;     // a bird out of a pine lands on Mnot's head, so it rides along in sight
const ride = new Ride(track, obstacles);
const chase = new ChaseCamera(camera, track);
const autopilot = new Autopilot(track, obstacles);
const sounds = new MnotSounds({ effects: ['wave'] });   // of the climb's effects, only the wave at the finish
const sfx = new DownhillSfx(sounds);              // the chair's own sounds, through the same switch and unlock
const music = new DownhillMusic(sounds);          // the climb's tune, a little faster
const party = new Party();                        // the finish party, once the chair has stopped past the line
// the high scores: the run recorded from the gate, checked by the server at the finish (scores.js)
const scores = createScores({ ride, track, obstacles, manual, level, watching, again: () => { restart(); begin(); } });
const input = new Input();
const puffs = obstacles.puffs;

// ------------------------------------------------------------------ the HUD

const $ = id => document.getElementById(id);
const hud = { time: $('time'), speed: $('speed'), wheels: [...document.querySelectorAll('#wheels i')], toast: $('toast'),
  finish: $('finish'), sound: $('sound'), flash: $('flash'), photo: $('photo'), bonus: $('bonus') };
const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const toast = toaster(hud.toast), once = toast.once;
soundSwitch(sounds, hud.sound);

// ------------------------------------------------------------------ the ride's events

let playing = manual, respawnAt = -1, time = 0;
ride.on('start', () => { music.start(); toast('Go!', 'Mind the €1,649.'); });
ride.on('jump', () => {
  sfx.cue({ type: 'jump' });
  puffs.snow(ride.pos, { puffs: 5, flakes: 6, spread: 0.6 });
});
ride.on('land', ({ impact, at, air }) => {
  rider.land(impact);
  if (impact > 4) pad.rumble('bump');
  sfx.cue({ type: 'land', impact, air });
  if (impact > 2) puffs.snow(at, { puffs: 4 + Math.min(8, impact), flakes: 6 + impact, spread: 0.5 + impact * 0.08 });
  chase.shake(Math.min(0.5, impact * 0.035));
});
ride.on('crash', ({ impulse, kind, at }) => {
  rider.crash(impulse);
  if (impulse > 1.5) pad.rumble(impulse > 3 ? 'hit' : 'bump');
  chase.shake(Math.min(0.9, impulse * 0.08));
  if (impulse > 1.5) sfx.cue({ type: 'crash', impulse, kind });
  if (kind === 'tree') puffs.snow(at.setY(at.y + 1.2), { puffs: 8, flakes: 16, spread: 0.9, up: -0.5 });
  else puffs.chips(at, { count: 4 + Math.floor(impulse), speed: 2 + impulse * 0.2 });
  if (impulse > 5 && kind === 'rock') once('rock', 'Ergonomics: 0.', 'Rock: 1.', 'oops');
  if (impulse > 5 && kind === 'tree') once('tree', 'Bark > mesh.', 'Pines don’t do lumbar support.', 'oops');
  if (impulse > 3 && kind === 'cabinet') once('cabinet', 'Filed under: ouch.', '', 'oops');
  if (impulse > 3 && kind === 'desk') once('desk', 'Hot-desking.', 'Not like this.', 'oops');
  if (impulse > 2 && kind === 'printer') once('printer', 'PC LOAD LETTER', 'It was broken already.', 'oops');
});
ride.on('wheel', ({ index, cause, left }) => {
  sfx.cue({ type: 'wheel', cause, left });
  pad.rumble('hit');
  const caster = chair.dropWheel(index);
  const kick = new THREE.Vector3(Math.random() - 0.5, 2.5 + Math.random() * 2, Math.random() - 0.5);
  obstacles.debris.add(caster, { vel: ride.vel.clone().multiplyScalar(0.85).add(kick), radius: 0.075, life: 12,
    bounce: 0.45 });
  if (left > 0) toast(`${left} wheel${left === 1 ? '' : 's'} left`,
    toast.said.has('warranty') ? '' : 'That wheel had a warranty.', 'oops');
  toast.said.add('warranty');
});
ride.on('wrecked', () => {
  sfx.cue({ type: 'wrecked' });
  music.duck(0.24);
  toast('Wrecked.', 'Ergonomics: 0. Mountain: 1.', 'oops');
  respawnAt = time + 1.6;
});
let swims = 0;
ride.on('lost', ({ at, water }) => {
  sfx.cue({ type: water ? 'splash' : 'lost' });
  pad.rumble('hit');
  music.duck(0.24);
  if (water) {
    at.y = track.sample(ride.s).y - RIVER.water;
    obstacles.splash(at, ride.vel, 3);
    const lines = [['Splash!', 'Chairs don’t float.'], ['Plop.', 'Not in the warranty either.'],
      ['Glug.', 'The casters are rinsed, at least.']];
    toast(...lines[swims++ % lines.length], 'oops');
    respawnAt = time + 1.8;
    return;
  }
  const crevasse = Math.abs(ride.d) < 20 && ride.s > FEATURES.crevasse.from - 1 && ride.s < FEATURES.crevasse.to + 1;
  toast(crevasse ? 'Into the crevasse.' : 'Off-piste. Very.', crevasse ? 'The crevasse wasn’t in the brochure.'
    : 'Back to the last pit stop.', 'oops');
  respawnAt = time + 1.8;
});
let snowmen = 0;
ride.on('bump', ({ kind }) => {
  sfx.cue({ type: 'bump', kind });
  pad.rumble('bump');
  chase.shake(kind === 'pin' ? 0.12 : 0.25);
  if (kind === 'snowman') {
    snowmen++;
    if (snowmen === 1) toast('Sorry, snowman.', '', 'oops');
    else if (snowmen === 5) toast('Five snowmen.', 'This is a pattern now.', 'oops');
  }
  if (kind === 'photographer') toast('Not the photographer!', 'No photo for you.', 'oops');
  if (kind === 'cooler') once('cooler', 'Splash.', 'That was the last cold water.', 'oops');
  if (kind === 'ficus') once('ficus', 'The office plant!', 'It had one job.', 'oops');
  if (kind === 'knockoff') once('knockoff', 'Sorry, Gary.', 'Your chair is on a mountain now.', 'oops');
});
ride.on('pit', () => {
  chair.fix(true);
  sfx.cue({ type: 'pit' });
  // a quiet pit stop if something else is being said
  if (toast.left < 1) toast('Pit stop', 'Fresh casters, on the house.', 'checkpoint');
});

// the bowling, the ski jump and its photo: what this run did, for the finish card
const run = { pins: -1, jump: 0, photo: null, snapAt: false, bowled: 0, bonus: 0 };

// Time off the clock for a strike, a spare and a long ski jump (bonus.js), shown as it's earned
let bonusTimer = 0;
function bonus(seconds, what) {
  if (!(seconds > 0.05)) return;
  run.bonus += seconds;
  sfx.cue({ type: 'bonus', seconds });
  hud.bonus.querySelector('b').textContent = `−${seconds.toFixed(1)} s`;
  hud.bonus.querySelector('small').textContent = what;
  pop(hud.bonus);
  bonusTimer = 2.8;
}

obstacles.pins.onScore = down => {
  if (watching) return;                           // a watched run bowls as it was recorded (watcher(), below)
  scores.recorder.event('bowl', down);
  bowled(down);
};
function bowled(down) {
  run.pins = down;
  sfx.cue({ type: 'bowling', down });
  const pins = pinsBonus(down);
  if (pins > run.bowled) { bonus(pins - run.bowled, down === 10 ? 'strike' : 'spare'); run.bowled = pins; }
  if (down === 10) toast('STRIKE!', '€490 of knock-offs.', 'checkpoint');
  else if (down >= 7) toast('Spare!', `${down} of 10. So close.`, 'checkpoint');
  else if (down > 0) toast(`${down} of 10.`, 'The rest are still sitting.', 'oops');
  else toast('Gutter ball.', 'The knock-offs live on.', 'oops');
}
ride.on('flight', ({ distance: metres }) => {
  const distance = Math.round(metres * 100) / 100;    // to the cm, as the server has it
  const had = jumpBonus(run.jump);
  run.jump = Math.max(run.jump, distance);
  bonus(jumpBonus(run.jump) - had, had ? 'a longer jump' : distance < K_LINE ? 'ski jump' : 'past the K line');
  run.snapAt = true;                              // a short hop: the photo at the landing
  sfx.cue({ type: 'flight', distance, kLine: K_LINE });
  toast(`${distance.toFixed(1)} m`, distance < 15 ? 'More of a hop. Pull the lever!' : distance < 40
    ? 'Ski jumping, but seated.' : distance < K_LINE ? 'Lovely flight.' : 'Past the K line!',
  distance < 15 ? 'oops' : 'checkpoint');
});

// The snowman at the landing hill takes a photo as the chair flies past: the frame is drawn once from its camera,
// kept, and drawn over at once by the chase camera's; the flash hides the swap. It shows in the corner and on the
// finish card.
const shot = document.createElement('canvas');
shot.width = 480;
shot.height = 360;
const _look = new THREE.Vector3();
function snap() {
  run.snapAt = false;
  if (run.photo || obstacles.cameraman.gone) return;
  sfx.cue({ type: 'photo' });
  const save = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
  const target = _look.copy(ride.pos).setY(ride.pos.y + 0.6), dist = obstacles.lens.distanceTo(target);
  camera.position.copy(obstacles.lens);
  camera.lookAt(target);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1.7 / dist));
  camera.updateProjectionMatrix();
  post.render();
  const c = renderer.domElement, cw = Math.min(c.width, c.height * 4 / 3), ch = cw * 3 / 4;
  shot.getContext('2d').drawImage(c, (c.width - cw) / 2, (c.height - ch) / 2, cw, ch, 0, 0, shot.width, shot.height);
  run.photo = shot.toDataURL('image/jpeg', 0.85);
  camera.position.copy(save.pos);
  camera.quaternion.copy(save.quat);
  camera.fov = save.fov;
  camera.updateProjectionMatrix();
  hud.flash.className = '';
  void hud.flash.offsetWidth;
  hud.flash.className = 'go';
  hud.photo.querySelector('img').src = run.photo;
  hud.photo.hidden = false;
  photoTimer = 3.5;
}
let photoTimer = 0;
ride.on('finish', ({ time: t }) => {
  sounds.play('wave');
  pad.rumble('cheer');
  music.finish();
  const left = CHAIR.legs - ride.missing, jumped = jumpBonus(run.jump);
  hud.finish.querySelector('.time').textContent = clock(Math.max(0, t - run.bonus));
  const off = hud.finish.querySelector('.bonus');
  off.hidden = !(run.bonus > 0);
  off.textContent = [`${clock(t)} on the clock`,
    run.bowled && `${run.bowled === BONUS.pins[10] ? 'strike' : 'spare'} −${run.bowled.toFixed(1)} s`,
    jumped > 0 && `ski jump −${jumped.toFixed(1)} s`].filter(Boolean).join(' · ');
  hud.finish.querySelector('.wheels').textContent = [`${left} of ${CHAIR.legs} wheels`,
    run.jump ? `ski jump ${run.jump.toFixed(1)} m` : 'no ski jump', run.pins >= 0 ? `${run.pins} of 10 pins` : '']
    .filter(Boolean).join(' · ');
  hud.finish.querySelector('.verdict').textContent = left === CHAIR.legs ? 'Worth every euro.'
    : left > 2 ? 'Mostly worth it.' : 'The warranty does not cover this.';
  const picture = hud.finish.querySelector('.snap');
  picture.hidden = !run.photo;
  if (run.photo) picture.querySelector('img').src = run.photo;
  hud.photo.hidden = true;
  hud.finish.hidden = false;
  confetti(puffs, ride.pos);
});

// The finish party's spin: a sheaf of paper and sticky notes thrown up over the chair, fluttering down.
const PAPER = ['#ffffff', '#ffe45c', '#ff8fc0', '#7fd0ff', '#ffe45c', '#a8ec7a'].map(c => new THREE.Color(c));
function throwPaper() {
  for (let i = 0; i < 40; i++) {
    puffs.add('bit', { at: ride.pos.clone().setY(ride.pos.y + 1.4), color: PAPER[i % PAPER.length], gravity: 1.8,
      drag: 2.6, spin: 7, size: 0.06 + 0.04 * Math.random(), life: 2.6 + Math.random(), bounce: 0,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, 1.5 + Math.random() * 1.8, (Math.random() - 0.5) * 7) });
  }
}

// back on the snow at the last pit stop (or the start), with fresh wheels and every snowman stood up again
function respawn() {
  respawnAt = -1;
  ride.reset(ride.checkpoint, { wheels: true });
  scores.recorder.respawned();
  putBack();
}
// what a respawn sets right besides the ride (a watched run's ride is put back by its recording)
function putBack() {
  party.reset();
  sfx.reset();
  music.duck(1);
  chair.fix();
  obstacles.reset();
  chase.snap(ride);
}

// a new run from the top
function restart() {
  respawn();
  scores.reset();
  ride.checkpoint = FEATURES.pits[0];
  ride.reset(ride.checkpoint, { wheels: true });
  Object.assign(ride, { started: false, done: false, time: 0 });
  party.reset();
  Object.assign(run, { pins: -1, jump: 0, photo: null, snapAt: false, bowled: 0, bonus: 0 });
  music.reset();
  if (playing) music.start();
  hud.finish.hidden = true;
  hud.bonus.hidden = true;
  hud.photo.hidden = true;
  chase.snap(ride);
}

// ------------------------------------------------------------------ the controls

const touch = { steer: 0, push: false, brake: false, jump: false, pointer: null };
renderer.domElement.addEventListener('pointerdown', e => {
  if (title.visible || watching) return;                     // a tap on the title only starts the run (title.js)
  begin();
  if (e.clientX < innerWidth / 2) touch.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  else touch.jump = true;
});
renderer.domElement.addEventListener('pointermove', e => {
  const p = touch.pointer;
  if (!p || p.id !== e.pointerId) return;
  touch.steer = THREE.MathUtils.clamp((e.clientX - p.x) / 70, -1, 1);
  touch.brake = e.clientY - p.y > 45;
  touch.push = e.clientY - p.y < -45;
});
const release = e => {
  if (touch.pointer?.id !== e.pointerId) return;
  Object.assign(touch, { pointer: null, steer: 0, push: false, brake: false });
};
renderer.domElement.addEventListener('pointerup', release);
renderer.domElement.addEventListener('pointercancel', release);
addEventListener('keydown', e => {
  if (title.visible || watching) return;                     // the title has the keys until the run starts
  if (e.target.closest?.('input, textarea')) return;         // a name for the board
  if (e.code === 'KeyR' && !e.repeat) { begin(); restart(); }
  else if (!e.ctrlKey && !e.metaKey && !e.altKey) begin();
});

function begin() {
  if (playing) return;
  playing = true;
  music.start();
}

// A controller (kit/gamepad.js): the left stick or the D-pad steers (up pushes, down brakes), RT pushes and tucks,
// LT brakes, A pulls the lever, Y is a new run, View the sound. On screen, its chip, card and hints (kit/padmenu.js),
// which also take its presses on the title, in the Hall of Fame and on the finish card.
const pad = new GamepadInput();
const padMenu = new PadMenu(pad, { sounds, press: 'roll',
  controls: [['move dpad', 'steer; up pushes, down brakes'], ['rt', 'push off, then tuck in'],
    ['lt', 'heels in the snow: brake'], ['a', 'pull the height lever: jump'], ['y', 'a new run from the top'],
    ['view', 'sound on or off'], ['menu', 'this card']],
  help: [['move', 'steer'], ['rt', 'push, tuck'], ['lt', 'brake'], ['a', 'the lever (jump)'], ['y', 'again'],
    ['menu', 'more']] });
const stick = { steer: 0, push: false, brake: false, jump: false };      // the controller this step
function readPad(dt) {
  pad.poll();
  Object.assign(stick, { steer: 0, push: false, brake: false, jump: false });
  if (!pad.connected || padMenu.update(dt)) return;
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
  const { x, y, push } = pad.stick, d = pad.dpad;
  const steer = THREE.MathUtils.clamp((push > 0 ? x : 0) + d.x, -1, 1);
  const forward = push > 0 && y > 0.5 || d.y > 0 || pad.value(BUTTON.rt) > 0.5;
  const brake = push > 0 && y < -0.5 || d.y < 0 || pad.value(BUTTON.lt) > 0.5;
  if (pad.fresh.has(BUTTON.view)) hud.sound.click();
  if (title.visible) {                            // A went to the title's Start (padmenu.js); the stick starts too
    if (steer || forward || brake) title.start('move');
    return;
  }
  if (watching) return;
  if (pad.fresh.has(BUTTON.y)) { begin(); restart(); return; }
  if (pad.used) begin();
  Object.assign(stick, { steer, push: forward, brake, jump: pad.fresh.has(BUTTON.a) });
}

// The title screen (title.js): a slow shot of Mnot at the start until a key, a tap or Start. It listens after the
// controls above, so the key or tap that starts the run isn't also a steer or a jump.
const title = new Title({ camera, chase, track, ride, rider, scene, dom: renderer.domElement });
title.on('start', () => begin());
if (!watching) hookAnalytics({ title, ride, pits: FEATURES.pits, manual });

let steer = 0;
function intent(dt) {
  if (autopilot.on) return autopilot.intent(ride);
  if (!playing || ride.done) { input.pressed.clear(); return { steer: 0, push: false, tuck: false, brake: ride.done, jump: false }; }
  const held = (...codes) => input.held(...codes);
  const want = THREE.MathUtils.clamp((held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0) + touch.steer
    + stick.steer, -1, 1);
  steer = THREE.MathUtils.damp(steer, want, 12, dt);
  const forward = held('KeyW', 'ArrowUp') || touch.push || stick.push;
  const frame = { steer, push: forward, tuck: forward,
    brake: held('KeyS', 'ArrowDown', 'ShiftLeft', 'ShiftRight') || touch.brake || stick.brake,
    jump: input.pressed.has('Space') || touch.jump || stick.jump };
  input.pressed.clear();
  touch.jump = false;
  return frame;
}

// ------------------------------------------------------------------ the Hall of Fame's ghost and replay

// Watching a run (?replay=ID): the controls (peak/replays/controller.js) move the run's clock, and the driver
// (playback.js) the page's own chair along the recording, telling the ride's events as they happened, so the sounds,
// puffs, toasts and the finish card are the live game's. Past the finish, the physics roll it out, heels down, for
// the party. Racing (?ghost=ID): a see-through chair on the recording, at the player's clock.
let replays = null, watch = null, ghost = null;
const RUN_OUT = { steer: 0, push: false, tuck: false, brake: true, jump: false };
if (replayRoute) {
  replays = new ReplayController({ mode: replayRoute.mode, id: replayRoute.id, scene, title,
    api: apiBase(location, 'downhill', level), fingerprint: routeFingerprint({ track, obstacles }), validate,
    createActor: async ({ replay, ghost: race }) => race
      ? ghost = await Ghost.create({ replay, track, obstacles, scene }) : watch = watcher(replay),
    snap: () => chase.snap(ride), done: () => ride.done,
    isRunActive: () => replays?.mode === 'ghost' && replays.ready && !title.visible && !ride.done,
    words: { ready: 'Start rolling when you’re ready.', finished: clock => `Finish · ${clock} on the clock`,
      leave: 'Leave this run? Your current run will be lost.' } });
  if (replayRoute.mode === 'ghost') {
    // the clean title start, but no race before its ghost has loaded and been checked
    const startTitle = title.start.bind(title);
    title.start = (how = 'key') => {
      if (!replays.ready) { replays.status.textContent = 'Wait for the ghost to load before starting.'; return; }
      startTitle(how);
    };
  }
}

// The page's own chair along a recorded run: the controls' actor.
function watcher(replay) {
  const recording = new Recording(replay);
  const driver = new Driver(recording, ride, (name, data) => {
    if (name === 'respawn') putBack();
    else if (name === 'bowl') bowled(data.down);
    else if (name !== 'space') ride.emit(name, data);
  }, { knock: true });
  return { recording, driver, duration: recording.end, phase: 0, root: chair.root, dispose() {},
    seek(t) { if (driver.to(t) === 'seek') rewind(driver, t); } };
}

// After a jump in the watched run: the scene as it was at t. Its wheels, the props knocked over since its last spill,
// the time off the clock so far, no card or party up, and the tune back on if it had finished.
function rewind(driver, t) {
  driver.knockTo(t);
  chair.setWheels(ride.wheels);
  respawnAt = -1;
  party.reset();
  sfx.reset();
  if (!ride.done) {
    hud.finish.hidden = true;
    if (music.scene === 'finished') { music.reset(); music.start(); }
  }
  hud.bonus.hidden = hud.photo.hidden = true;
  bonusTimer = photoTimer = 0;
  let pins = -1, jump = 0, bowled = 0;
  for (const [at, name, arg] of driver.recording.events) {
    if (at > t * 1000) break;
    if (name === 'bowl') { pins = arg; bowled = Math.max(bowled, pinsBonus(arg)); }
    if (name === 'flight') jump = Math.max(jump, arg / 100);
  }
  Object.assign(run, { pins, jump, bowled, bonus: bowled + jumpBonus(jump), photo: jump ? run.photo : null,
    snapAt: false });
}

// ------------------------------------------------------------------ the loop

const feet = [new THREE.Vector3(), new THREE.Vector3()], _spray = new THREE.Vector3(), _kick = new THREE.Vector3();
let spray = 0, last = null, waitYaw = null;
function step(dt) {
  if (!(dt > 0)) return;
  time += dt;
  shaderTime.value = time;
  readPad(dt);
  // a watched run: the controls move its clock (playing, paused, 2×, a jump) and the chair with it; the scene moves
  // on by the run's own time (none while it's paused), and past the finish by the frame's
  const from = replays?.time ?? 0;
  if (watching) replays.update(dt, { gameTime: ride.time });
  const ended = !!watch && replays.time >= replays.duration && !replays.playing;
  const vdt = watch && !ended ? Math.max(0, replays.time - from) : dt;
  const want = watch ? ended ? RUN_OUT : watch.recording.intent(replays.time) : intent(dt);
  last = want;
  if (!watching) scores.recorder.input(want);
  // the physics at a fixed rate; a jump only on the first of the steps. Until the player starts, the chair waits at
  // the top (on a slope, it would roll off under the title), the seat swivelling lazily under an idling Mnot.
  const steps = Math.max(1, Math.round(dt / STEP));
  if (watching) {
    if (ended) for (let i = 0; i < steps; i++) ride.step(dt / steps, want);
  } else if (playing || autopilot.on) {
    for (let i = 0; i < steps; i++) {
      ride.step(dt / steps, i === 0 ? want : { ...want, jump: false });
      scores.recorder.step();
    }
    waitYaw = null;
  } else if (!title.visible) {
    waitYaw ??= ride.seatYaw;
    ride.seatYaw = waitYaw + 0.14 * Math.sin(time * 0.8) * Math.min(1, time / 2);
  }
  title.update(dt);                               // on the title: the seat's turn and Mnot's act
  if (!watching && respawnAt >= 0 && time >= respawnAt) respawn();
  scores.update();
  // the ghost, at the player's clock (from the gate; at the gate while the title is up)
  if (replays?.mode === 'ghost') {
    replays.update(dt, { gameTime: ride.time, titleVisible: title.visible });
    ghost?.update(dt);
  }
  // the finish party poses the seat, the lift and a hop of the whole chair on top of the physics
  const dance = party.update(vdt, ride, camera, music.loopTime());
  if (dance) {
    Object.assign(ride, { seatYaw: dance.yaw, seatL: 0, lift: dance.lift, liftVel: 0 });
    if (dance.paper) throwPaper();
    if (dance.landed) rider.land(dance.landed);
  }
  rider.party = dance;
  rider.update(vdt, ride, want);
  chair.pose(ride, vdt);
  if (dance) chair.root.position.y += dance.hop;
  // the party's spins creak the swivel (the ride's own spin stays still under it)
  sfx.update({ active: (playing || watching && vdt > 0) && !ride.out && (!ride.done || !!dance),
    speed: dance ? 0 : ride.speed,
    grounded: ride.grounded, surface: ride.under.surface, brake: rider.brake, spin: dance ? dance.spin : ride.seatSpin,
    missing: ride.missing });
  // heels in the snow: a fine spray off each foot, flying on with the chair
  spray += vdt;
  if (rider.brake > 0.5 && ride.grounded && ride.speed > 1.5 && spray > 1 / 30) {
    spray = 0;
    chair.root.updateMatrixWorld(true);
    for (const at of rider.feet(feet)) {
      at.y = Math.min(at.y, ride.pos.y + 0.08);
      for (let k = 0; k < 3; k++) {
        puffs.add('bit', { at, size: 0.02 + 0.02 * Math.random(), life: 0.6 + 0.4 * Math.random(), gravity: 10, drag: 1.5,
          bounce: 0, spin: 8, vel: _spray.copy(ride.vel).multiplyScalar(0.75)
            .add(_kick.set(Math.random() - 0.5, 1 + 1.5 * Math.random(), Math.random() - 0.5)) });
      }
      if (Math.random() < 0.4) {
        puffs.add('puff', { at, size: 0.05 + 0.04 * Math.random(), life: 0.45, drag: 2.5,
          vel: _spray.copy(ride.vel).multiplyScalar(0.85).add(_kick.set(0, 0.4, 0)) });
      }
    }
  }
  obstacles.update(vdt, ride.s);
  chase.update(dt, ride);
  title.place(dt);
  stage.aimSun(ride.pos);
  scenery.update(camera, time);
  // the photographer: as the chair flies past, or where a short hop came down
  if (!run.photo && (run.snapAt || ride.flight && ride.s > FEATURES.jump.lip + 11)) snap();
  // the HUD
  toast.update(dt);
  photoTimer -= dt;
  if (photoTimer <= 0 && !hud.photo.hidden) hud.photo.hidden = true;
  bonusTimer -= dt;
  if (bonusTimer <= 0 && !hud.bonus.hidden) hud.bonus.hidden = true;
  hud.time.textContent = clock(Math.max(0, ride.time - run.bonus));
  hud.speed.textContent = `${Math.round(ride.speed * 3.6)} km/h`;
  hud.wheels.forEach((w, i) => w.classList.toggle('gone', !ride.wheels[i]));
}

ride.reset(FEATURES.pits[0], { wheels: true });
chase.snap(ride);
if (!manual && !watching) { title.show(); music.start(); }   // the tune plays under the title once it's unlocked
if (!replayRoute && !manual && params.has('hall')) scores.board?.openHall();   // back from a replay (controller.js)
replays?.load();
step(1 / 60);

// Every shader built now, behind the preloader, not on the way down where each one is a hitch (kit/warmup.js): the
// obstacles far down the run (obstacles.update) and the ones not set up yet too (docs/performance.md, "The downhill").
warmUp(scene, render);
render();
startLoop({ manual, post, step, render });

// for debugging and tests: window.downhill, with step(seconds, dt) and render() (kit/loop.js)
expose('downhill', { THREE, renderer, scene, camera, post, stage, track, obstacles, chair, ride, rider, chase, mnot,
  sounds, sfx, music, party, scores, input, title, restart, respawn, pad, padMenu, replays,
  get watch() { return watch; }, get ghost() { return ghost; }, get intent() { return last; },
  autopilot(on = true) { autopilot.on = on; begin(); return autopilot; } }, { step, render });
