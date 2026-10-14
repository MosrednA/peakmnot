// Peak Mnot, downhill (a prototype): Mnot on a very expensive office chair, down the mountain. Sets up the
// renderer and the scene like the climb does, wires the piste, the chair, its physics, Mnot and the camera together,
// and runs the HUD, the controls and the frame loop. The physics steps at a fixed 120 Hz.
// Open downhill.html?manual to stop the loop and step it from the console (window.downhill.step), for tests;
// downhill.autopilot(true) lets a bot ride.
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MnotSounds } from '../../sounds.js';
import { buildScenery, HORIZON, SUN_DIR } from '../look/scenery.js';
import { createPost } from '../look/post.js';
import { time as shaderTime } from '../look/materials.js';
import { loadMnot } from '../mnot/mnot.js';
import { Input } from '../controls/input.js';
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

const params = new URLSearchParams(location.search);
const manual = params.has('manual');
const STEP = 1 / 120;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const outline = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.16, 0.2, 0.3] });

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON, 70, 460);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2500);
const post = createPost(renderer, scene, camera, outline, { adaptive: !manual });

scene.add(new THREE.HemisphereLight('#c3d8ff', '#a9a6c4', 1.2));
const sun = new THREE.DirectionalLight('#fff2e0', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(post.shadowSize(2048));
sun.shadow.radius = 2.2;
// The shadows reach from just behind the camera to about 50 m down the run (SHADOW, in step()), so a tree's comes in
// far off, not as the chair gets to it; the bias is the same 5 cm as over the old, shorter range.
const SHADOW = { half: 28, ahead: 18, back: 50 };
Object.assign(sun.shadow.camera, { left: -SHADOW.half, right: SHADOW.half, top: SHADOW.half, bottom: -SHADOW.half,
  near: 1, far: 110 });
sun.shadow.bias = -0.00048;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

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
const ride = new Ride(track, obstacles);
const chase = new ChaseCamera(camera, track);
const autopilot = new Autopilot(track, obstacles);
const sounds = new MnotSounds({ effects: ['wave'] });   // of the climb's effects, only the wave at the finish
const sfx = new DownhillSfx(sounds);              // the chair's own sounds, through the same switch and unlock
const music = new DownhillMusic(sounds);          // the climb's tune, a little faster
const party = new Party();                        // the finish party, once the chair has stopped past the line
// the high scores: the run recorded from the gate, checked by the server at the finish (scores.js)
const scores = createScores({ ride, track, obstacles, manual, again: () => { restart(); begin(); } });
const input = new Input();
const puffs = obstacles.puffs;

// ------------------------------------------------------------------ the HUD

const $ = id => document.getElementById(id);
const hud = { time: $('time'), speed: $('speed'), wheels: [...document.querySelectorAll('#wheels i')], toast: $('toast'),
  finish: $('finish'), sound: $('sound'), flash: $('flash'), photo: $('photo'), bonus: $('bonus') };
const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
let toastTimer = 0;
function toast(big, small = '', kind = '') {
  hud.toast.className = '';
  void hud.toast.offsetWidth;                     // restart the pop
  hud.toast.className = `show ${kind}`;
  hud.toast.querySelector('b').textContent = big;
  const line = hud.toast.querySelector('small');
  line.textContent = small;
  line.hidden = !small;
  toastTimer = 2.4;
}
const said = new Set();
const once = (key, ...args) => { if (!said.has(key)) { said.add(key); toast(...args); } };

const syncSound = () => hud.sound.setAttribute('aria-pressed', String(sounds.enabled));
syncSound();
hud.sound.addEventListener('click', () => { sounds.setEnabled(!sounds.enabled); syncSound(); hud.sound.blur(); });
addEventListener('pointerdown', e => { if (e.isTrusted) void sounds.unlock(); }, { capture: true });
addEventListener('keydown', e => { if (e.isTrusted) void sounds.unlock(); }, { capture: true });

// ------------------------------------------------------------------ the ride's events

let playing = manual, respawnAt = -1, time = 0;
ride.on('start', () => { music.start(); toast('Go!', 'Mind the €1,649.'); });
ride.on('jump', () => {
  sfx.cue({ type: 'jump' });
  puffs.snow(ride.pos, { puffs: 5, flakes: 6, spread: 0.6 });
});
ride.on('land', ({ impact, at, air }) => {
  rider.land(impact);
  sfx.cue({ type: 'land', impact, air });
  if (impact > 2) puffs.snow(at, { puffs: 4 + Math.min(8, impact), flakes: 6 + impact, spread: 0.5 + impact * 0.08 });
  chase.shake(Math.min(0.5, impact * 0.035));
});
ride.on('crash', ({ impulse, kind, at }) => {
  rider.crash(impulse);
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
  const caster = chair.dropWheel(index);
  const kick = new THREE.Vector3(Math.random() - 0.5, 2.5 + Math.random() * 2, Math.random() - 0.5);
  obstacles.debris.add(caster, { vel: ride.vel.clone().multiplyScalar(0.85).add(kick), radius: 0.075, life: 12,
    bounce: 0.45 });
  if (left > 0) toast(`${left} wheel${left === 1 ? '' : 's'} left`,
    said.has('warranty') ? '' : 'That wheel had a warranty.', 'oops');
  said.add('warranty');
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
  chair.fix();
  sfx.cue({ type: 'pit' });
  // a quiet pit stop if something else is being said
  if (toastTimer < 1) toast('Pit stop', 'Fresh casters, on the house.', 'checkpoint');
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
  hud.bonus.hidden = true;
  void hud.bonus.offsetWidth;                     // restart the pop
  hud.bonus.hidden = false;
  bonusTimer = 2.8;
}

obstacles.pins.onScore = down => {
  run.pins = down;
  scores.recorder.event('bowl', down);
  sfx.cue({ type: 'bowling', down });
  const pins = pinsBonus(down);
  if (pins > run.bowled) { bonus(pins - run.bowled, down === 10 ? 'strike' : 'spare'); run.bowled = pins; }
  if (down === 10) toast('STRIKE!', '€490 of knock-offs.', 'checkpoint');
  else if (down >= 7) toast('Spare!', `${down} of 10. So close.`, 'checkpoint');
  else if (down > 0) toast(`${down} of 10.`, 'The rest are still sitting.', 'oops');
  else toast('Gutter ball.', 'The knock-offs live on.', 'oops');
};
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
// the sun's view: its axes, to move the shadows' box in whole texels so their edges don't crawl as it follows
const _sunX = new THREE.Vector3(), _sunY = new THREE.Vector3(), _sunZ = new THREE.Vector3(), _shade = new THREE.Vector3();
new THREE.Matrix4().lookAt(SUN_DIR, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP).extractBasis(_sunX, _sunY, _sunZ);
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
  for (let i = 0; i < 90; i++) {
    const color = new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
    puffs.add('bit', { at: ride.pos.clone().setY(ride.pos.y + 2.5), color, gravity: 4, drag: 1.5, spin: 6,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7),
      size: 0.05, life: 3 + Math.random() * 2, bounce: 0 });
  }
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
  party.reset();
  sfx.reset();
  music.duck(1);
  ride.reset(ride.checkpoint, { wheels: true });
  scores.recorder.respawned();
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
  if (title.visible) return;                                 // a tap on the title only starts the run (title.js)
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
  if (title.visible) return;                                 // the title has the keys until the run starts
  if (e.target.closest?.('input, textarea')) return;         // a name for the board
  if (e.code === 'KeyR' && !e.repeat) { begin(); restart(); }
  else if (!e.ctrlKey && !e.metaKey && !e.altKey) begin();
});

function begin() {
  if (playing) return;
  playing = true;
  music.start();
}

// The title screen (title.js): a slow shot of Mnot at the start until a key, a tap or Start. It listens after the
// controls above, so the key or tap that starts the run isn't also a steer or a jump.
const title = new Title({ camera, chase, track, ride, rider, scene, dom: renderer.domElement });
title.on('start', () => begin());

let steer = 0;
function intent(dt) {
  if (autopilot.on) return autopilot.intent(ride);
  if (!playing || ride.done) { input.pressed.clear(); return { steer: 0, push: false, tuck: false, brake: ride.done, jump: false }; }
  const held = (...codes) => input.held(...codes);
  const want = THREE.MathUtils.clamp((held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0) + touch.steer, -1, 1);
  steer = THREE.MathUtils.damp(steer, want, 12, dt);
  const forward = held('KeyW', 'ArrowUp') || touch.push;
  const frame = { steer, push: forward, tuck: forward, brake: held('KeyS', 'ArrowDown', 'ShiftLeft', 'ShiftRight') || touch.brake,
    jump: input.pressed.has('Space') || touch.jump };
  input.pressed.clear();
  touch.jump = false;
  return frame;
}

// ------------------------------------------------------------------ the loop

const feet = [new THREE.Vector3(), new THREE.Vector3()], _spray = new THREE.Vector3(), _kick = new THREE.Vector3();
let spray = 0, last = null, waitYaw = null;
function step(dt) {
  if (!(dt > 0)) return;
  time += dt;
  shaderTime.value = time;
  const want = intent(dt);
  last = want;
  scores.recorder.input(want);
  // the physics at a fixed rate; a jump only on the first of the steps. Until the player starts, the chair waits at
  // the top (on a slope, it would roll off under the title), the seat swivelling lazily under an idling Mnot.
  const steps = Math.max(1, Math.round(dt / STEP));
  if (playing || autopilot.on) {
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
  if (respawnAt >= 0 && time >= respawnAt) respawn();
  scores.update();
  // the finish party poses the seat, the lift and a hop of the whole chair on top of the physics
  const dance = party.update(dt, ride, camera, music.loopTime());
  if (dance) {
    Object.assign(ride, { seatYaw: dance.yaw, seatL: 0, lift: dance.lift, liftVel: 0 });
    if (dance.paper) throwPaper();
    if (dance.landed) rider.land(dance.landed);
  }
  rider.party = dance;
  rider.update(dt, ride, want);
  chair.pose(ride, dt);
  if (dance) chair.root.position.y += dance.hop;
  // the party's spins creak the swivel (the ride's own spin stays still under it)
  sfx.update({ active: playing && !ride.out && (!ride.done || !!dance), speed: dance ? 0 : ride.speed,
    grounded: ride.grounded, surface: ride.under.surface, brake: rider.brake, spin: dance ? dance.spin : ride.seatSpin,
    missing: ride.missing });
  // heels in the snow: a fine spray off each foot, flying on with the chair
  spray += dt;
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
  obstacles.update(dt, ride.s);
  chase.update(dt, ride);
  title.place(dt);
  camera.getWorldDirection(_shade).setY(0).normalize();
  _shade.multiplyScalar(SHADOW.ahead).add(ride.pos);
  const texel = 2 * SHADOW.half / sun.shadow.mapSize.x, snap = v => Math.round(v / texel) * texel;
  const sx = snap(_shade.dot(_sunX)), sy = snap(_shade.dot(_sunY)), sz = _shade.dot(_sunZ);
  sun.target.position.set(0, 0, 0).addScaledVector(_sunX, sx).addScaledVector(_sunY, sy).addScaledVector(_sunZ, sz);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, SHADOW.back);
  scenery.update(camera, time);
  // the photographer: as the chair flies past, or where a short hop came down
  if (!run.photo && (run.snapAt || ride.flight && ride.s > FEATURES.jump.lip + 11)) snap();
  // the HUD
  toastTimer -= dt;
  if (toastTimer <= 0 && hud.toast.classList.contains('show')) hud.toast.className = '';
  photoTimer -= dt;
  if (photoTimer <= 0 && !hud.photo.hidden) hud.photo.hidden = true;
  bonusTimer -= dt;
  if (bonusTimer <= 0 && !hud.bonus.hidden) hud.bonus.hidden = true;
  hud.time.textContent = clock(Math.max(0, ride.time - run.bonus));
  hud.speed.textContent = `${Math.round(ride.speed * 3.6)} km/h`;
  hud.wheels.forEach((w, i) => w.classList.toggle('gone', !ride.wheels[i]));
}

function render() {
  post.render();
}

ride.reset(FEATURES.pits[0], { wheels: true });
chase.snap(ride);
if (!manual) { title.show(); music.start(); }     // the tune plays under the title once the sound is unlocked
step(1 / 60);

// Every shader built now, behind the preloader (peak/ui/preload.css), not on the way down where each one is a hitch:
// one frame with nothing culled, so all of the run is drawn once, with its shadows and ink (the climb's main.js too).
// Nothing hidden either: the obstacles far down the run (obstacles.update) and the ones not set up yet would each
// build a shader of their own, or a shadow's, the first time they show (docs/performance.md, "The downhill").
// The painted things that cast a shadow (the banners, the signs) get a depth material of their own: three.js draws
// every other shadow with one, and builds its shader again only when the kind of mesh changes (Mnot's skinned can,
// the instanced ones), from the first mesh after the change. A painted one there built a shader more, down the run.
const PAINTED_SHADOW = new THREE.MeshDepthMaterial();
function warmUp() {
  const culled = [], hidden = [];
  scene.traverse(o => {
    if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }    // a light more would build every shader anew
    if (o.castShadow && o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.customDepthMaterial
      && [].concat(o.material).some(m => m.map && !(m.alphaTest > 0))) o.customDepthMaterial = PAINTED_SHADOW;
  });
  render();
  for (const o of culled) o.frustumCulled = true;
  for (const o of hidden) o.visible = false;
}
warmUp();
render();

// the preloader stays up until the first frame is on screen
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.remove('preloading');
  const cover = document.getElementById('preload');
  if (manual) cover?.remove();
  else { cover?.classList.add('done'); setTimeout(() => cover?.remove(), 600); }
}

const timer = new THREE.Timer();
timer.connect(document);
function frame(timestamp) {
  timer.update(timestamp);
  post.adapt(timer.getDelta());
  step(Math.min(timer.getDelta(), 0.05));
  render();
  requestAnimationFrame(frame);
  if (!revealed) requestAnimationFrame(reveal);
}
if (!manual) requestAnimationFrame(frame);
else reveal();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
  if (manual) render();
});

// for debugging and tests
window.downhill = { THREE, renderer, scene, camera, post, track, obstacles, chair, ride, rider, chase, mnot, sounds, sfx,
  music, party, scores, input, title,
  step(seconds = 1 / 60, dt = 1 / 60) { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); render(); },
  render, restart, respawn, get intent() { return last; },
  autopilot(on = true) { autopilot.on = on; begin(); return autopilot; } };
