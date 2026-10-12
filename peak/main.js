// Peak Mnot: sets up the renderer and the scene, wires the modules together and runs the frame loop.
// Open peak.html?manual to stop the loop and step it from the console (window.peak.step), for tests.
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { MnotSounds } from '../sounds.js';
import { World } from './world.js';
import { buildRoute } from './route.js';
import { buildScenery, HORIZON, SUN_DIR } from './scenery.js';
import { loadMnot } from './mnot.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';
import { Input } from './input.js';
import { Weather } from './weather.js';
import { Game, MAX_DENTS, clock } from './game.js';
import { Dents } from './dents.js';
import { Rockfall } from './rocks.js';
import { Hud } from './hud.js';
import { hookSounds } from './audio.js';

const manual = new URLSearchParams(location.search).has('manual');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const outline = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.16, 0.2, 0.3] });

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON, 60, 420);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2500);

scene.add(new THREE.HemisphereLight('#e2eeff', '#7d8496', 1.25));
const sun = new THREE.DirectionalLight('#fff4e0', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
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
player.spawn(start.respawn, start.yaw);
follow.snap(player, world);

let time = 0;
function step(dt) {
  time += dt;
  const forward = follow.forward();
  const intent = input.read(follow.heading(player, world), world.railAt(player.pos));
  if (intent.mute) sounds.setEnabled(!sounds.enabled);
  weather.update(dt, player.pos, camera);
  player.update(dt, intent, weather.windAt(player.pos));
  audio.update();
  game.update(dt);
  dents.update(dt);
  rocks.update(dt);
  for (const thing of world.animated) thing.update(dt, time, weather);
  follow.update(dt, player, world);
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 30);
  sun.target.position.copy(player.pos);
  scenery.update(camera);
  scene.fog.near = 60 - 48 * weather.snow;
  scene.fog.far = 420 - 340 * weather.snow;
  hud.update(dt, player, forward);
  hud.stats(`${clock(game.time)} · dents ${game.dents}/${MAX_DENTS} · falls ${game.falls}`);
}

function render() {
  outline.render(scene, camera);
}

const timer = new THREE.Timer();
timer.connect(document);
function frame(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  const steps = Math.ceil(dt / (1 / 60 + 1e-6));
  for (let i = 0; i < steps; i++) step(dt / steps);
  render();
  requestAnimationFrame(frame);
}
if (!manual) requestAnimationFrame(frame);
else render();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (manual) render();
});

// for debugging and tests
window.peak = { THREE, scene, camera, world, player, game, dents, rocks, weather, follow, input, mnot, sounds,
  step(seconds = 1 / 60, dt = 1 / 60) { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); render(); },
  render, key: (code, down) => input.key(code, down) };
