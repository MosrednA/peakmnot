// Peak Mnot: sets up the renderer and the scene, wires the modules together and runs the frame loop.
// Open peak.html?manual to stop the loop and step it from the console (window.peak.step), for tests.
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MnotSounds } from '../sounds.js';
import { World } from './world/world.js';
import { buildRoute } from './world/route.js';
import { buildScenery, HORIZON, SUN_DIR } from './look/scenery.js';
import { loadMnot } from './mnot/mnot.js';
import { Player } from './mnot/player.js';
import { FollowCamera } from './controls/camera.js';
import { Input } from './controls/input.js';
import { Weather } from './world/weather.js';
import { Game, MAX_DENTS, clock } from './game.js';
import { Dents } from './mnot/dents.js';
import { Rockfall } from './world/rocks.js';
import { Hud } from './ui/hud.js';
import { hookSounds } from './audio.js';
import { time as shaderTime } from './look/materials.js';
import { createPost } from './look/post.js';
import { fadeProps } from './props/fade.js';
import { Title } from './ui/title.js';
import { Touch } from './controls/touch.js';
import { Moments } from './mnot/moments.js';
import { onKonami } from './controls/konami.js';
import { createScores } from './scores/scores.js';
import { hookAnalytics } from './analytics.js';
import { ReplayController } from './replays/controller.js';
import { GamepadInput, BUTTON } from './kit/gamepad.js';
import { PadMenu } from './kit/padmenu.js';

const params = new URLSearchParams(location.search);
const perf = params.has('perf');               // the perf probe (dev/perf.js) drives the game, as tests do
const manual = params.has('manual') || perf;
const hasGhost = params.has('ghost'), hasReplay = params.has('replay');
const replayRoute = hasGhost || hasReplay ? {
  mode: hasGhost && hasReplay ? 'invalid' : hasReplay ? 'replay' : 'ghost',
  id: hasGhost && hasReplay ? '' : params.get(hasReplay ? 'replay' : 'ghost'),
} : null;

// post.js draws into its own multisampled buffer and sets the pixel ratio, so the canvas needs no antialiasing
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const outline = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.16, 0.2, 0.3] });

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON, 60, 420);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2500);
const post = createPost(renderer, scene, camera, outline, { adaptive: !manual });

// late-morning light: a warm sun, a cool sky filling the shadows, and snow bouncing a little light back up
scene.add(new THREE.HemisphereLight('#c3d8ff', '#a9a6c4', 1.2));
const sun = new THREE.DirectionalLight('#fff2e0', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(post.shadowSize(2048));     // smaller on a phone (post.js)
sun.shadow.radius = 2.2;
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 60 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const world = new World(scene);
const { start } = buildRoute(world);
const scenery = buildScenery(scene, new THREE.Vector3(2, 0, 35));
const weather = new Weather(scene, world);
const input = new Input();
const follow = new FollowCamera(camera, renderer.domElement);
const hud = new Hud();
const sounds = new MnotSounds();

const mnot = await loadMnot();
scene.add(mnot.root);
const player = new Player(world, mnot);
const game = new Game({ player, world, hud, camera: follow });
const dents = new Dents(mnot, game);
const rocks = new Rockfall(scene, world, { player, game });
const audio = hookSounds({ sounds, player, game, button: document.getElementById('sound') });
const title = new Title({ camera, follow, dom: renderer.domElement, player, game, input });
audio.attachTitle(title);
const touch = new Touch({ input, follow, player, world, title, dom: renderer.domElement });   // phones (touch.js)
const moments = new Moments({ player, game, world, weather, title, hud, camera, dom: renderer.domElement,
  model: mnot.model });
const konami = replayRoute?.mode !== 'replay' ? onKonami(() => moments.startParty()) : null;   // none in the spectator
const replayIsReadOnly = replayRoute && replayRoute.mode !== 'ghost';
const scores = createScores({ player, game, world, manual, replayMode: replayIsReadOnly });   // watched/invalid routes never record or post scores
if (!replayIsReadOnly) hookAnalytics({ title, game, player, manual });
// a controller (kit/gamepad.js), read once a step by readPad(); on screen, its chip, card and hints (kit/padmenu.js)
const pad = new GamepadInput();
const padMenu = new PadMenu(pad, { sounds, press: 'start', settings: ['invert', 'speed', 'rumble'],
  controls: [['move dpad', 'move; right always means onwards'], ['lb', 'careful steps, or a light push'],
    ['a', 'jump'], ['look', 'look around'], ['lt rt', 'zoom in and out'], ['view', 'sound on or off'],
    ['menu', 'this card']],
  help: [['move', 'move'], ['lb', 'careful'], ['a', 'jump'], ['look', 'look'], ['lt rt', 'zoom'], ['menu', 'more']] });
player.on('land', ({ hard }) => { if (hard) pad.rumble('bump'); });
game.on('dent', () => pad.rumble('hit'));
game.on('summit', () => pad.rumble('cheer'));
player.spawn(start.respawn, start.yaw);
follow.snap(player, world);

let replays = null;
if (replayRoute) {
  replays = new ReplayController({ mode: replayRoute.mode, id: replayRoute.id, scene, world, player, game, follow, title,
    isRunActive: () => replays?.mode === 'ghost' && replays.ready && !title.visible && !game.done });
  if (replayRoute.mode === 'replay') {
    input.setEnabled(false);
    mnot.root.visible = false;
  } else {
    // Keep the clean title start, but do not let a key or tap start the race before its ghost has validated.
    const startTitle = title.start.bind(title);
    title.start = (how = 'key') => {
      if (!replays.ready) { replays.status.textContent = 'Wait for the ghost to load before starting.'; return; }
      startTitle(how);
    };
    title.show();
  }
  replays.load().then(ready => { if (ready && replays.mode === 'ghost') input.setEnabled(true); });
} else if (!manual) {
  title.show();
  if (params.has('hall')) scores.board?.openHall();
}

// The controller, once a step: to the page first (its card, the Hall of Fame, a title button: padmenu.js), else to
// Mnot as the keys its stick and D-pad stand for (input.js, so the score server's replay reads it like keys), and to
// the camera (the right stick and the triggers).
const STILL = { held: new Set(), careful: false, jump: false, mute: false };
const KONAMI = [[BUTTON.up, 'arrowup'], [BUTTON.down, 'arrowdown'], [BUTTON.left, 'arrowleft'],
  [BUTTON.right, 'arrowright'], [BUTTON.b, 'b'], [BUTTON.a, 'a']];
function readPad(dt) {
  pad.poll();
  input.gamepad = STILL;
  if (!pad.connected) return;
  if (pad.used) touch.enable(false);
  if (padMenu.update(dt)) return;
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
  const held = new Set(), careful = pad.keys(held) || pad.down(BUTTON.lb);
  input.gamepad = { held, careful, jump: pad.fresh.has(BUTTON.a), mute: pad.fresh.has(BUTTON.view) };
  for (const [button, key] of KONAMI) if (pad.fresh.has(button)) konami?.(key);
  if (title.visible || !input.enabled) return;
  if (pad.look.x || pad.look.y) follow.look(pad.look.x * dt, pad.look.y * dt, { player, world });
  const zoom = pad.value(BUTTON.rt) - pad.value(BUTTON.lt);       // in with LT, out with RT
  if (zoom) follow.zoomBy(Math.exp(zoom * dt));
}

let time = 0;
function step(dt) {
  time += dt;
  shaderTime.value = time;

  if (replays?.mode === 'replay') {
    const previousReplayTime = replays.time;
    replays.update(dt);
    const actor = replays.actor ?? player;
    const replayTime = replays.ready ? replays.worldTime() : time;
    const visualDt = replays.ready ? Math.max(0, replays.time - previousReplayTime) : dt;
    shaderTime.value = replayTime;
    weather.time = replayTime - visualDt;       // wind-gap beats follow the recorded route clock
    weather.update(visualDt, actor.pos, camera);
    for (const thing of world.animated) {
      if (replays.ready && thing.seekReplay) continue;  // replay controller seeks loose ledges from recorded support
      if (replays.ready && thing.seek) thing.seek(replayTime);
      else if (visualDt > 0) thing.update(visualDt, replayTime, weather);
    }
    follow.update(dt, actor, world);
    fadeProps(world, camera, actor, dt);
    sun.position.copy(actor.pos).addScaledVector(SUN_DIR, 30);
    sun.target.position.copy(actor.pos);
    scenery.update(camera, replayTime);
    scene.fog.near = 60 - 48 * weather.snow;
    scene.fog.far = 420 - 340 * weather.snow;
    return;                                 // spectator mode has no live input, physics, hazards, audio or score calls
  }

  readPad(dt);
  const forward = follow.forward();
  const ghostLoading = replays?.mode === 'ghost' && !replays.ready;
  const intent = ghostLoading ? { move: new THREE.Vector3(), held: new Set(), jump: false, mute: false, careful: false } :
    input.read(follow.heading(player, world), world.railAt(player.pos));
  if (intent.mute) sounds.setEnabled(!sounds.enabled);
  weather.update(dt, player.pos, camera);
  if (!ghostLoading) player.update(dt, intent, weather.windAt(player.pos));
  audio.update();
  game.update(dt);
  dents.update(dt);
  rocks.update(dt);
  for (const thing of world.animated) thing.update(dt, time, weather);
  follow.update(dt, player, world);
  moments.update(dt, intent);                 // fidgets and the summit dance (moments.js)
  title.update(dt, intent);                   // the title screen's camera, and its glide into the climb (title.js)
  replays?.update(dt, { gameTime: game.time, titleVisible: title.visible });
  fadeProps(world, camera, player, dt);       // props between the camera and Mnot dissolve (fade.js)
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 30);
  sun.target.position.copy(player.pos);
  scenery.update(camera, time);
  scene.fog.near = 60 - 48 * weather.snow;
  scene.fog.far = 420 - 340 * weather.snow;
  hud.update(dt, player, forward);
  hud.stats({ time: clock(game.time), dents: game.dents, maxDents: MAX_DENTS, falls: game.falls });
  scores.step(dt, intent);                    // records the climb for the score check (replay.js); last, after all moved
}

function render() {
  post.render();
}

// the preloader (preload.css) stays up until the first frame, whose shaders take a while, is on screen
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.remove('preloading');
  const cover = document.getElementById('preload');
  if (manual) cover?.remove();
  else { cover?.classList.add('done'); setTimeout(() => cover?.remove(), 600); }
}

// Every shader built now, behind the preloader, not on the way up where each one is a hitch: one frame with nothing
// culled, so all of the climb is drawn once, with its shadows and ink, and the props in their copies that can
// dissolve (fade.js). See docs/performance.md.
function warmUp() {
  fadeProps(world, camera, player, 0);
  const culled = [];
  scene.traverse(o => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  render();
  for (const o of culled) o.frustumCulled = true;
}
warmUp();

const timer = new THREE.Timer();
timer.connect(document);
function frame(timestamp) {
  timer.update(timestamp);
  post.adapt(timer.getDelta());
  const dt = Math.min(timer.getDelta(), 0.05);
  const steps = Math.ceil(dt / (1 / 60 + 1e-6));
  for (let i = 0; i < steps; i++) step(dt / steps);
  render();
  requestAnimationFrame(frame);
  if (!revealed) requestAnimationFrame(reveal);
}
if (!manual) requestAnimationFrame(frame);
else { render(); reveal(); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
  if (manual) render();
});

// for debugging and tests
window.peak = { THREE, renderer, scene, camera, world, player, game, dents, rocks, weather, follow, input, mnot, sounds, post,
  step(seconds = 1 / 60, dt = 1 / 60) { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); render(); },
  render, key: (code, down) => input.key(code, down), title, moments, touch, pad, padMenu };
window.peak.replays = replays;
if (perf) import('./dev/perf.js').then(m => m.probe(window.peak));
