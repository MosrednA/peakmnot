// TEMPLATE for peak/<game>/main.js: replace "mygame" and "My Game", then grow the game in its own modules. As it is
// it runs: Mnot on a snowy shoulder of the mountain walks (WASD, arrows or a controller) to a flag, and the finish
// party starts. The stage, the loop, the HUD's parts, the title and the controller come from the kit
// (peak/kit/README.md).
// Open mygame.html?manual to stop the loop and step it from the console (window.mygame.step), for tests;
// mygame.autopilot(true) lets a bot play.
import * as THREE from 'three';
import { MnotSounds } from '../../sounds.js';
import { buildScenery } from '../look/scenery.js';
import { time as shaderTime } from '../look/materials.js';
import { toon } from '../look/look.js';
import { bursts } from '../look/bursts.js';
import { loadMnot } from '../mnot/mnot.js';
import { Input } from '../controls/input.js';
import { createStage } from '../kit/stage.js';
import { warmUp } from '../kit/warmup.js';
import { startLoop, expose } from '../kit/loop.js';
import { toaster, soundSwitch } from '../kit/hud.js';
import { confetti } from '../kit/party.js';
import { GamepadInput, BUTTON } from '../kit/gamepad.js';
import { PadMenu } from '../kit/padmenu.js';
import { pickLevel } from '../kit/levels.js';
import { Title } from './title.js';
import { hookAnalytics } from './analytics.js';

const manual = new URLSearchParams(location.search).has('manual');
// Made for more than one level from the start (kit/levels.js): '' is the first. ?level= picks one; the world is
// built for it, and the high scores and the Hall of Fame's ghost and replay go to its board (SKILL.md, step 6).
const LEVELS = [''];
const level = pickLevel(LEVELS);
const GOAL = new THREE.Vector3(0, 0, 14);       // the flag, 14 m ahead
const SPEED = 2;                                // m/s

const stage = createStage({ manual, fov: 50, fog: [60, 420], shadow: { half: 12, far: 60, ahead: 4, back: 30 } });
const { renderer, scene, camera, post, render } = stage;
const scenery = buildScenery(scene, new THREE.Vector3(0, 0, 0));

// the world: a round of snow to stand on, and the flag (replace with the game's own, in its own modules)
const snow = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), toon('#f4f7ff'));
snow.receiveShadow = true;
scene.add(snow);
const flag = new THREE.Group();
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), toon('#2b3352'));
pole.position.y = 1.1;
const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.03), toon('#e23b2e'));
cloth.position.set(0.47, 1.9, 0);
for (const m of [pole, cloth]) { m.castShadow = true; flag.add(m); }
flag.position.copy(GOAL);
scene.add(flag);
// the pooled bursts (look/bursts.js) want a little world: a group, things to update, the ground's height
const world = { group: new THREE.Group(), animated: [], ground: () => ({ top: 0 }) };
scene.add(world.group);
const puffs = bursts(world);

const mnot = await loadMnot();
scene.add(mnot.root);
const sounds = new MnotSounds({ effects: ['wave'] });   // only the climb's effects this game uses
const input = new Input();
const player = { pos: mnot.root.position, yaw: 0, done: false, time: 0 };

// ------------------------------------------------------------------ the HUD

const $ = id => document.getElementById(id);
const hud = { time: $('time'), finish: $('finish') };
const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const toast = toaster($('toast'));
soundSwitch(sounds, $('sound'));

let playing = manual, time = 0, autopilot = false;
function begin() {
  if (playing) return;
  playing = true;
  toast('Go!', 'The flag. Over there.');
}
function finish() {
  player.done = true;
  player.yaw = Math.PI;                           // round to the camera, for the party
  sounds.play('wave');
  hud.finish.querySelector('.time').textContent = clock(player.time);
  hud.finish.querySelector('.verdict').textContent = 'Flawless. Probably.';
  hud.finish.hidden = false;
  confetti(puffs, player.pos);
  pad.rumble('cheer');
  mnot.animator.play('Dance', 0.3);
  stats.finish();
}
function restart() {
  player.pos.set(0, 0, 0);
  Object.assign(player, { yaw: 0, done: false, time: 0 });
  mnot.root.rotation.y = 0;
  hud.finish.hidden = true;
}
addEventListener('keydown', e => {
  if (title.visible || e.target.closest?.('input, textarea')) return;
  if (e.code === 'KeyR' && !e.repeat) restart();
  begin();
});
renderer.domElement.addEventListener('pointerdown', () => { if (!title.visible) begin(); });

// a controller (kit/gamepad.js): the left stick or the D-pad walks, Y starts again, View switches the sound. On the
// screen, its chip, card and hints (kit/padmenu.js), which also take its presses on the title and in the Hall of Fame.
const pad = new GamepadInput();
const padMenu = new PadMenu(pad, { sounds,
  controls: [['move dpad', 'walk'], ['y', 'start again'], ['view', 'sound on or off'], ['menu', 'this card']],
  help: [['move', 'walk'], ['y', 'again'], ['menu', 'more']] });
const padKeys = new Set();                        // the keys the controller's stick and D-pad stand for, this step
function readPad(dt) {
  pad.poll();
  padKeys.clear();
  if (!pad.connected || padMenu.update(dt)) return;
  if (pad.fresh.has(BUTTON.view)) $('sound').click();
  pad.keys(padKeys);
  if (title.visible) {                            // A went to the title's Start (padmenu.js); the stick starts too
    if (padKeys.size) title.start('move');
    return;
  }
  if (pad.fresh.has(BUTTON.y)) restart();
  if (pad.used) begin();
}
const held = (...codes) => input.held(...codes) || codes.some(c => padKeys.has(c));

// ------------------------------------------------------------------ the camera

// behind Mnot and a little up, easing after it; the title glides into it (its look and fov). At the finish it looks
// lower, so Mnot dances above the finish card.
const follow = { look: new THREE.Vector3(), fov: 50 }, _seat = new THREE.Vector3();
function placeCamera(dt) {
  camera.position.lerp(_seat.set(player.pos.x, 2.4, player.pos.z - 5.5), 1 - Math.exp(-4 * dt));
  follow.look.copy(player.pos).setY(player.done ? 0.2 : 1);
  camera.lookAt(follow.look);
}

// the title (title.js); it listens after the controls above, so the key that starts isn't read twice
const title = new Title({ camera, dom: renderer.domElement, mnot, player, follow });
title.on('start', () => begin());
// the Plausible goals (analytics.js, on the kit's goals()): the start and the finish, on the public site only
const stats = hookAnalytics({ title, manual });

// ------------------------------------------------------------------ the loop

function step(dt) {
  if (!(dt > 0)) return;
  time += dt;
  shaderTime.value = time;
  readPad(dt);
  // the player: walks where the keys say (or the bot), until the flag
  const move = new THREE.Vector3();
  if (playing && !player.done) {
    if (autopilot) move.subVectors(GOAL, player.pos).setY(0);
    else {
      move.x = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0);
      move.z = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
    }
    if (move.lengthSq() > 1e-4) {
      move.normalize();
      player.pos.addScaledVector(move, SPEED * dt);
      player.yaw = Math.atan2(move.x, move.z);
    }
    player.time += dt;
    if (player.pos.distanceTo(GOAL) < 1) finish();
  }
  input.pressed.clear();
  const onTitle = title.update(dt);                // on the title, Mnot's act is the title's (title.js)
  if (!onTitle && !player.done) mnot.animator.play(move.lengthSq() > 1e-4 ? 'Walk' : 'Idle');
  const r = mnot.root.rotation;                    // Mnot turns to where it walks, the short way round
  r.y += Math.atan2(Math.sin(player.yaw - r.y), Math.cos(player.yaw - r.y)) * (1 - Math.exp(-12 * dt));
  mnot.animator.update(dt);
  for (const a of world.animated) a.update(dt);
  placeCamera(dt);
  title.place(dt);
  stage.aimSun(player.pos);
  scenery.update(camera, time);
  toast.update(dt);
  hud.time.textContent = clock(player.time);
}

camera.position.set(0, 2.4, -5.5);
if (!manual) title.show();
step(1 / 60);
warmUp(scene, render);
render();
startLoop({ manual, post, step, render });

// for debugging and tests
expose('mygame', { THREE, renderer, scene, camera, post, stage, mnot, player, sounds, input, title, restart, pad,
  padMenu, level, autopilot(on = true) { autopilot = on; begin(); } }, { step, render });
