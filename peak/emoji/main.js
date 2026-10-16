// The emoji field (emoji.html), a prototype: a list of the community's Slack emoji at the top of the screen, and a
// snowy field full of them, with knee-high snow walls between (field.js). Mnot fetches the listed ones in the list's
// order; touching any other, or a listed one too early, costs one of three tries. With the list done, every other
// emoji twists away and :peak-mnot: drops into the middle of the field: fetching it stops the clock. Seen over Mnot's
// shoulder, steered like a shopping trolley on fresh snow: it slides, drifts wide in a turn and bonks off the walls,
// and the wrong emojis are never far. A few passages are cracked (cracks.js): the snow holds just long enough to run
// across, then gives way, and there's no way back through. Built on the mini game kit (peak/kit/README.md); no
// scores, stats or ?perf yet (README.md, "Not yet").
// Open emoji.html?manual to stop the loop and step it from the console (window.emoji.step), for tests;
// emoji.autopilot(true) lets a bot play. ?seed= deals a given field (else it's a random one), ?list= how many to fetch
// (5), ?wrong= how many others stand about (24), ?open= how open the maze is (0 a real maze, 1 no walls at all),
// ?cracks= how many cracked passages at most (3).
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
import { toaster, soundSwitch, pop } from '../kit/hud.js';
import { confetti } from '../kit/party.js';
import { GamepadInput, BUTTON } from '../kit/gamepad.js';
import { PadMenu } from '../kit/padmenu.js';
import { pickLevel } from '../kit/levels.js';
import { Field } from './field.js';
import { Cracks, CRACK } from './cracks.js';
import { Stickers, loadSheet, cssSticker } from './stickers.js';
import { SHEET } from './sheet.js';
import { Title } from './title.js';
import { Dizzy } from './dizzy.js';
import { EmojiSfx } from './sfx.js';
import { EmojiMusic } from './music.js';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');
// Made for more than one level from the start (kit/levels.js): '' is the first. ?level= picks one.
const LEVELS = [''];
const level = pickLevel(LEVELS);
const number = (name, fallback, min, max) => {
  const v = Number(params.get(name));
  return params.has(name) && Number.isFinite(v) ? THREE.MathUtils.clamp(v, min, max) : fallback;
};
const DEAL = { list: number('list', 5, 1, 12), wrong: number('wrong', 24, 0, 50), open: number('open', 0.5, 0, 1),
  cracks: number('cracks', 3, 0, 6) };
// The prize at the end of every list, never dealt on the field; it drops after `drop` s, while the camera looks over
// the field for `look` s.
const PEAK = 'peak-mnot';
const NAMES = SHEET.names.filter(name => name !== PEAK);
const FINALE = { drop: 0.5, look: 2 };
// Random fields, but about as hard as each other: one is dealt from random seeds until one rates (field.js, rate())
// in BAND, the middle of what the first RATED seeds' fields rate with this DEAL (as parts of them, low to high), and
// has at least CRACKED cracks (or as many as asked for).
const RATED = 48, BAND = [0.35, 0.65], TRIES = 80, CRACKED = 2;
const BODY = 0.38;                                // m: Mnot's round against the walls
// How Mnot gets about: A and D turn it (turn radians a second at most, reached at `steer` a second), W runs (top m/s),
// S brakes. Its speed only slowly follows where it faces (grip, a second), so a sharp turn drifts wide; let go and it
// glides on (`glide`); braking stops it within a metre or so (`brake`).
const RUN = { top: 4.2, turn: 2.7, steer: 9, grip: 3, glide: 1.1, brake: 6 };
// Bonking into a wall: what's left of the speed into it (bounce), from which speed (m/s) it's a bonk, and how long
// (s) Mnot reels from a hard one; a reel spins it a little too (spin radians a second per m/s).
const BONK = { bounce: 0.45, from: 1.3, reel: 0.55, spin: 0.35 };
const SKID = 1.4;                                 // m/s of sideways slide from which the snow sprays
// Three tries. A wrong emoji (or a listed one too early) costs one: it warps away, Mnot bumps back off it (bump
// m/s), reels for `reel` s and sees stars for `dizzy` s, its steering wandering a little (wander, of full lock) and
// no other emoji counting for `safe` s. The third is out.
const LIVES = 3;
const HIT = { bump: 3.4, reel: 0.5, dizzy: 2.4, wander: 0.4, safe: 0.9 };
// A cracked passage gone under Mnot (cracks.js): it drops in up to its glasses (sink m, in `down` s), flails for
// `stay` s and scrambles out on the side it came from (out s, a hop `hop` m high), seeing stars for `dizzy` s. No
// try lost: only the way through, and the time.
const PIT = { sink: 0.85, down: 0.22, stay: 0.75, out: 0.45, hop: 0.9, dizzy: 1.2 };
const PLOP = ['Plop.', 'Mind the gap.', 'Not that way any more.', 'Snow in the glasses.'];
// Funny lines for a hard bonk, one at a time
const OUCH = ['Bonk.', 'Ow. My glasses.', 'That wall wasn\'t there.', 'Snow in the can.', 'Who put that there?',
  'Totally meant that.'];
// The camera: over Mnot's right shoulder (back, h, side m), looking ahead of it (ahead m, at look m high), swinging
// round after where Mnot faces a little late (swing, a second), so a turn shows. Space (or holding the list) peeks:
// the camera rises to look over the whole field from behind Mnot, and Mnot stops to look. At the start it peeks by
// itself for `intro` seconds. When it's over, the camera comes round to the front (front: dist, h m).
const VIEW = { back: 4.4, h: 2.4, side: 0.55, ahead: 3.4, look: 0.8, swing: 3.2, fov: 56,
  peek: { h: 18, back: 7, toward: 0.4, fov: 50, rate: 4 }, intro: 1.6, front: { dist: 4, h: 1.6, look: 0.9 } };
const turn = a => Math.atan2(Math.sin(a), Math.cos(a));
const ahead = (yaw, to = new THREE.Vector3()) => to.set(Math.sin(yaw), 0, Math.cos(yaw));

const stage = createStage({ manual, fov: VIEW.fov, fog: [60, 420], shadow: { half: 17, far: 70, back: 40 } });
const { renderer, scene, camera, post, render } = stage;
const scenery = buildScenery(scene, new THREE.Vector3(0, 0, 10));

const snow = new THREE.Mesh(new THREE.CircleGeometry(70, 64).rotateX(-Math.PI / 2), toon('#f4f7ff'));
snow.receiveShadow = true;
snow.name = 'the snow';
scene.add(snow);
// the pooled bursts (look/bursts.js) want a little world: a group, things to update, the ground's height
const world = { group: new THREE.Group(), animated: [], ground: () => ({ top: 0 }) };
world.group.name = 'puffs and confetti';
scene.add(world.group);
const puffs = bursts(world);

const [mnot, sheet] = await Promise.all([loadMnot(), loadSheet(renderer)]);
scene.add(mnot.root);
const stickers = new Stickers(sheet);
scene.add(stickers.group);
const dizzy = new Dizzy();
scene.add(dizzy.group);
const cracks = new Cracks(puffs);
scene.add(cracks.group);
const sounds = new MnotSounds({ effects: ['wave', 'land-soft', 'land-hard', 'jump'] });
const sfx = new EmojiSfx(sounds);                 // the game's own sounds and tune (Codex), through the same switch
const music = new EmojiMusic(sounds);
const input = new Input();
// spin: how fast it turns now (radians a second); reel: seconds left reeling from a bonk or a wrong one; wobble: the
// squash (amp) and how long ago (t); dizzy: seconds of stars left; safe: seconds no wrong one counts; fall: seconds
// since it went over, when out; pit: in a hole (climb()); holes: cracks given way, plops: holes dropped into
const player = { pos: mnot.root.position, vel: new THREE.Vector3(), yaw: 0, spin: 0, done: false, out: false,
  time: 0, next: 0, lives: LIVES, reel: 0, wobble: { amp: 0, t: 0 }, dizzy: 0, safe: 0, fall: 0, bonks: 0, pit: null,
  holes: 0, plops: 0 };

// ------------------------------------------------------------------ the HUD

const $ = id => document.getElementById(id);
const hud = { time: $('time'), seed: $('seed'), lives: $('lives'), list: $('list-row'), card: $('finish') };
const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const toast = toaster($('toast'));
soundSwitch(sounds, $('sound'));

// The list: the listed emojis in order, the one to fetch now big and bobbing, the fetched ones ticked off, and the
// prize at the end.
function drawList() {
  const em = (name, n, kind = 'em') => {
    const el = document.createElement('i');
    el.className = kind;
    el.dataset.n = n;
    cssSticker(el, name);
    return el;
  };
  hud.list.replaceChildren(...field.order.map((i, n) => em(field.emojis[i].name, n + 1)), em(PEAK, '\u25b2', 'em peak'));
  markList();
}
function drawLives() {
  [...hud.lives.children].forEach((heart, i) => heart.classList.toggle('lost', i >= player.lives));
  hud.lives.setAttribute('aria-label', `${player.lives} of ${LIVES} tries left`);
}
function markList() {
  [...hud.list.children].forEach((em, n) => {
    em.classList.toggle('done', n < player.next || player.done);
    em.classList.toggle('now', n === player.next && !player.out && !player.done);
    em.classList.toggle('missed', n === player.next && player.out);
  });
}

// ------------------------------------------------------------------ the field and a run on it

const plan = s => new Field({ seed: s, names: NAMES, ...DEAL, look: false });
let band = null;
function randomSeed() {
  if (!band) {
    const rates = Array.from({ length: RATED }, (_, i) => plan(i + 1).rate()).sort((a, b) => a - b);
    band = BAND.map(k => rates[Math.floor(k * (RATED - 1))]);
  }
  let best = 0, off = Infinity;
  for (let i = 0; i < TRIES; i++) {
    const s = 1 + Math.floor(Math.random() * 1e6), planned = plan(s), rate = planned.rate();
    const few = planned.cracks.length < Math.min(CRACKED, DEAL.cracks);
    const o = Math.max(band[0] - rate, rate - band[1], 0) + (few ? 100 : 0);
    if (o === 0) return s;
    if (o < off) [best, off] = [s, o];
  }
  return best;
}
// N (and X on a controller): a new field; after a ?seed=, the next seed, so a test or a shared link stays put
const another = () => deal(params.has('seed') ? seed + 1 : randomSeed());

let field = null, seed = params.has('seed') ? number('seed', 1, 0, 2 ** 31) : randomSeed();
let playing = manual, time = 0, autopilot = false, ouch = 0, plop = 0, said = 0;

function deal(next = seed) {
  seed = next;
  field?.dispose();
  field = new Field({ seed, names: NAMES, ...DEAL });
  scene.add(field.group);
  hud.seed.textContent = `field ${seed}`;
  restart();
}
function restart() {
  for (const e of field.emojis) e.taken = false;
  stickers.set(field.emojis);
  field.holes.clear();
  cracks.set(field);
  field.centre(...field.start, player.pos);
  player.vel.set(0, 0, 0);
  Object.assign(player, { yaw: 0, spin: 0, done: false, out: false, time: 0, next: 0, lives: LIVES, reel: 0, dizzy: 0,
    safe: 0, fall: 0, bonks: 0, pit: null, holes: 0, plops: 0 });
  player.wobble.amp = 0;
  mnot.root.rotation.y = 0;
  mnot.model.position.set(0, 0, 0);
  mnot.model.rotation.set(0, 0, 0);
  mnot.model.scale.setScalar(1);
  mnot.animator.play('Idle', 0);
  hud.card.hidden = true;
  follow.yaw = 0;
  if (playing) follow.intro = VIEW.intro;
  sfx.reset();
  music.reset();
  if (playing) music.start();
  drawList();
  drawLives();
}
function begin() {
  if (playing) return;
  playing = true;
  follow.intro = VIEW.intro;
  sfx.cue({ type: 'start' });
  music.start();
  toast('Go!', 'Fetch them in the list\'s order.');
}

function take(s) {
  stickers.go(s, 'taken');
  puffs.snow(s.emoji.at, { puffs: 5, flakes: 10, up: 1.2 });
  sounds.play('land-soft');
  pad.rumble('bump');
  sfx.cue({ type: 'take', n: player.next + 1, of: field.order.length });
  player.next++;
  markList();
  pop(hud.list.children[player.next - 1]);
  if (player.next === field.order.length) toThePeak();
}
// The list done: every other emoji twists away, from Mnot outwards, the camera rises to watch, and :peak-mnot: drops
// into the middle of the field with a bump. The clock runs on: fetching it is the finish.
const _peak = new THREE.Vector3();
function toThePeak() {
  stickers.sweep(player.pos);
  stickers.drop(PEAK, field.centre(...field.peak, _peak), FINALE.drop, () => {
    puffs.snow(_peak, { puffs: 8, flakes: 18, up: 1.4 });
    sounds.play('land-hard');
    sfx.cue({ type: 'peak' });
    pad.rumble('bump');
  });
  follow.intro = FINALE.look;
  sfx.cue({ type: 'clear' });
  toast(`All ${field.order.length}!`, 'Now :peak-mnot:, in the middle of the field. The clock is running.');
}
// A wrong one touched: it costs a try. It warps away (a listed one too early pops back in a moment later), and Mnot
// bumps back off it, reeling, and sees stars for a while. The third is out.
const _off = new THREE.Vector3();
function hit(s) {
  player.lives--;
  drawLives();                                    // the heart pops as it goes (emoji.html)
  const early = s.emoji.listed > player.next, name = s.emoji.name;
  if (!player.lives) return wrong(s, early);
  stickers.go(s, early ? 'blinked' : 'warped');
  puffs.poof(_off.copy(s.emoji.at).setY(1), { size: 0.3, count: 8 });
  _off.set(player.pos.x - s.emoji.at.x, 0, player.pos.z - s.emoji.at.z);
  if (_off.lengthSq() < 1e-6) ahead(player.yaw, _off).negate();
  player.vel.copy(_off.normalize()).multiplyScalar(HIT.bump);
  player.spin += (Math.random() < 0.5 ? -1 : 1) * 2.2;
  Object.assign(player, { reel: HIT.reel, dizzy: HIT.dizzy, safe: HIT.safe });
  Object.assign(player.wobble, { amp: 0.3, t: 0 });
  sfx.cue({ type: early ? 'early' : 'wrong', lives: player.lives });
  sounds.play('land-soft');
  pad.rumble('hit');
  said = time;                                    // no bonk lines over this one
  const left = player.lives === 1 ? 'One try left.' : `${player.lives} tries left.`;
  toast(early ? 'Not yet!' : 'Wrong!', `${early ? `:${name}: comes later.` : `:${name}: isn't on the list.`} ${left}`,
    'oops');
}
// Out: the wrong emoji swells, and Mnot slips and goes over flat on its back, sliding on.
function wrong(s, early) {
  const want = field.emojis[field.order[player.next]].name;
  stickers.go(s, 'wrong');
  player.out = true;
  player.fall = 0;
  player.dizzy = 0;
  mnot.animator.play('Fall', 0.1);
  pad.rumble('hit');
  sfx.cue({ type: 'out' });
  music.duck(0.24);
  markList();
  toast('Out!', early ? `:${s.emoji.name}: is on the list, but not yet.` : `:${s.emoji.name}: isn't on the list.`, 'oops');
  showCard('Out!', `The third wrong reaction. The list said :${want}:. The thread is ruined.`);
}
function finish() {
  player.done = true;
  toast.left = 0;                                 // the card says it all
  sounds.play('wave');
  confetti(puffs, player.pos);
  pad.rumble('cheer');
  mnot.animator.play('Dance', 0.3);
  sfx.cue({ type: 'finish' });
  music.finish();
  const wrongs = LIVES - player.lives, plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
  const after = wrongs ? ` ${plural(wrongs, 'wrong one')} in between, but who reads a whole thread?`
    : player.plops ? ` Fell in ${player.plops > 1 ? `${player.plops} holes` : 'a hole'}, but nobody saw.`
    : player.bonks ? ` ${plural(player.bonks, 'bonk')}, but nobody noticed.` : ' Not one bonk, not one slip.';
  markList();
  pop(hud.list.lastElementChild);
  showCard('Thread complete!', `${field.order.length} reactions in order, and :peak-mnot: on top.${after}`);
}
// The cracks (cracks.js): one stepped on creaks; given way, its passage is shut for good (field.holes, so the bot and
// the checks go round); and Mnot over a hole drops in.
function crackle(happened) {
  for (const [what, k] of happened) {
    if (what === 'stepped') sfx.cue({ type: 'crack' });
    else if (what === 'opened') {
      const under = cracks.over(k, player.pos);
      field.holes.add(k.key);
      player.holes++;
      sounds.play('land-soft');
      sfx.cue({ type: 'hole', under });
      pad.rumble('bump');
      if (!under && player.holes === 1 && time - said > 1.5) {
        said = time;
        toast('Made it!', 'The snow gave way behind you: no way back through there.');
      }
    } else if (what === 'under' && !player.pit) fallIn(k);
  }
}
function fallIn(k) {
  const fresh = k.t < 0.1;                        // it gave way under Mnot just now, rather than walked into
  player.pit = { k, t: 0, from: player.pos.clone(), in: cracks.inside(k, player.pos),
    to: cracks.outside(k, player.pos, BODY), hop: false };
  player.vel.set(0, 0, 0);
  Object.assign(player, { reel: 0, dizzy: 0, plops: player.plops + 1 });
  puffs.snow(player.pos, { puffs: 6, flakes: 14, up: 1.1 });
  sounds.play('land-soft');
  sfx.cue({ type: 'pit', fresh });
  pad.rumble('hit');
  said = time;
  toast(fresh ? 'Too slow!' : PLOP[plop++ % PLOP.length],
    fresh ? 'Run across: the snow holds just long enough.' : 'That way is gone. Find another way round.', 'oops');
}
// In a hole: dropping in up to its glasses, flailing, then a hop out onto the side it came from, dizzy.
function climb(dt) {
  const p = player.pit, m = mnot.model, { sink, down, stay, out } = PIT;
  p.t += dt;
  if (p.t < down + stay) {
    const k = Math.min(1, p.t / down);
    player.pos.lerpVectors(p.from, p.in, k);
    m.position.y = -sink * k * k + (p.t > down ? 0.06 * Math.sin((p.t - down) * 13) : 0);
    return;
  }
  if (!p.hop) {
    p.hop = true;
    sounds.play('jump');
  }
  const k = Math.min(1, (p.t - down - stay) / out);
  player.pos.lerpVectors(p.in, p.to, k);
  m.position.y = -sink * (1 - k) + PIT.hop * 4 * k * (1 - k);
  player.yaw += turn(Math.atan2(p.to.x - p.in.x, p.to.z - p.in.z) - player.yaw) * (1 - Math.exp(-12 * dt));
  if (k < 1) return;
  player.pit = null;
  m.position.y = 0;
  player.spin = 0;
  Object.assign(player, { dizzy: PIT.dizzy, reel: 0.25 });
  Object.assign(player.wobble, { amp: 0.28, t: 0 });
  puffs.snow(player.pos, { puffs: 4, flakes: 8, up: 0.7 });
  sounds.play('land-soft');
  sfx.cue({ type: 'climb' });
}

function showCard(head, verdict) {
  hud.card.querySelector('h1').textContent = head;
  hud.card.querySelector('.time').textContent = clock(player.time);
  hud.card.querySelector('.verdict').textContent = verdict;
  hud.card.classList.toggle('out', player.out);
  pop(hud.card);
}

addEventListener('keydown', e => {
  if (title.visible || e.target.closest?.('input, textarea')) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && !e.repeat) restart();
  if (e.code === 'KeyN' && !e.repeat) another();
  begin();
});

// A finger (or a mouse) dragged on the field steers, from where it went down: sideways turns, up runs, down brakes.
// Holding the list peeks.
const drag = { id: null, x0: 0, y0: 0, x: 0, y: 0 }, touchPeek = new Set();
renderer.domElement.addEventListener('pointerdown', e => {
  if (title.visible) return;
  begin();
  Object.assign(drag, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
});
$('list').addEventListener('pointerdown', e => {
  if (title.visible) return;
  touchPeek.add(e.pointerId);
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (e.pointerId === drag.id) Object.assign(drag, { x: e.clientX - drag.x0, y: e.clientY - drag.y0 });
});
for (const type of ['pointerup', 'pointercancel']) {
  addEventListener(type, e => {
    if (e.pointerId === drag.id) drag.id = null;
    touchPeek.delete(e.pointerId);
  });
}
const DRAG = { dead: 14, full: 90 };              // px: a drag this short is nothing, this long full

// a controller (kit/gamepad.js): the left stick or the D-pad steers and runs, LB or RB peeks, Y this field again,
// X a new one, View the sound
const pad = new GamepadInput();
const padMenu = new PadMenu(pad, { sounds,
  controls: [['move dpad', 'steer, up runs, down brakes'], ['lb rb', 'look over the field'], ['y', 'this field again'],
    ['x', 'a new field'], ['view', 'sound on or off'], ['menu', 'this card']],
  help: [['move', 'steer'], ['lb', 'peek'], ['y', 'again'], ['x', 'new field'], ['menu', 'more']] });
const padKeys = new Set();                        // the keys the controller's D-pad stands for, this step
function readPad(dt) {
  pad.poll();
  padKeys.clear();
  if (!pad.connected || padMenu.update(dt)) return;
  if (pad.fresh.has(BUTTON.view)) $('sound').click();
  pad.keys(padKeys);
  if (title.visible) {
    if (padKeys.size) title.start('move');
    return;
  }
  if (pad.fresh.has(BUTTON.y)) restart();
  if (pad.fresh.has(BUTTON.x)) another();
  if (pad.used) begin();
}
const held = (...codes) => input.held(...codes) || codes.some(c => padKeys.has(c));
const peeking = () => held('Space') || touchPeek.size > 0 || pad.down(BUTTON.lb) || pad.down(BUTTON.rb);

// What the player asks for this step: steer (-1 right .. 1 left), throttle (0..1) and brake (0..1).
const want = { steer: 0, throttle: 0, brake: 0 };
function controls() {
  Object.assign(want, { steer: 0, throttle: 0, brake: 0 });
  if (autopilot) return autoSteer(want);
  if (drag.id !== null && Math.hypot(drag.x, drag.y) > DRAG.dead) {
    const k = v => THREE.MathUtils.clamp((Math.abs(v) - DRAG.dead) / (DRAG.full - DRAG.dead), 0, 1) * Math.sign(v);
    want.steer = -k(drag.x);
    want.throttle = Math.max(0, -k(drag.y));
    want.brake = Math.max(0, k(drag.y));
  } else if (pad.stick.push > 0) {
    want.steer = -pad.stick.x;
    want.throttle = Math.max(0, pad.stick.y);
    want.brake = Math.max(0, -pad.stick.y * 1.6 - 0.6);
  } else {
    want.steer = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0);
    want.throttle = held('KeyW', 'ArrowUp') ? 1 : 0;
    want.brake = held('KeyS', 'ArrowDown') ? 1 : 0;
  }
}

// The bot: the shortest way to the list's next one past every other emoji (field.route), then to the prize in the
// middle, a cell at a time, steering for it and easing off in the turns, so it doesn't drift into a wrong one.
const _to = new THREE.Vector3();
function autoSteer(w) {
  const n = player.next, last = n === field.order.length;
  const goal = last ? { cell: field.peak, at: field.centre(...field.peak) } : field.emojis[field.order[n]];
  const way = field.route(field.cellAt(player.pos), goal.cell, last ? new Set() : field.blocked(n));
  const to = way?.length > 1 ? field.centre(...way[0], _to) : _to.copy(goal.at);
  const off = turn(Math.atan2(to.x - player.pos.x, to.z - player.pos.z) - player.yaw);
  const dist = Math.hypot(to.x - player.pos.x, to.z - player.pos.z);
  w.steer = THREE.MathUtils.clamp(off * 2.5, -1, 1);
  w.throttle = Math.max(0, Math.cos(off)) ** 4 * THREE.MathUtils.clamp(dist / 2.5, 0.45, 1);
  // too fast for the corner coming: brake
  const speed = player.vel.length();
  w.brake = Math.abs(off) > 0.6 && speed > 1.6 ? 1 : 0;
  // a crack on the way (or already underfoot): flat out across it, before it goes
  const k = cracks.near(player.pos, 0.9);
  const across = k && (cracks.over(k, player.pos, CRACK.near)
    || (way?.length > 0 && field.edge(field.cellAt(player.pos), way[0]) === k.key));
  if (across) {
    cracks.beyond(k, player.pos, _to);
    w.steer = THREE.MathUtils.clamp(turn(Math.atan2(_to.x - player.pos.x, _to.z - player.pos.z) - player.yaw) * 2.5,
      -1, 1);
    w.throttle = 1;
    w.brake = 0;
  }
}

// ------------------------------------------------------------------ Mnot on the snow

const _ahead = new THREE.Vector3(), _want = new THREE.Vector3(), _side = new THREE.Vector3();
let skidClock = 0;
function slide(dt) {
  // on the title (or in a hole) Mnot stands still; out, it slides on on its back; done, it dances to a stop; reeling
  // from a bonk or peeking, it slows
  const stuck = !playing || title.visible || !!player.pit;
  const free = !stuck && !player.out && !player.done && player.reel <= 0 && !peeking();
  if (free) {
    controls();
    // seeing stars: the steering wanders a little
    const daze = Math.min(1, player.dizzy);
    if (daze > 0) want.steer = THREE.MathUtils.clamp(want.steer + HIT.wander * daze * Math.sin(time * 4.3), -1, 1);
  } else Object.assign(want, { steer: 0, throttle: 0, brake: player.out ? 0 : player.done ? 0.4 : player.reel > 0 ? 0.3 : 0.6 });
  // turning: the spin eases to what's asked, so a tap is a nudge and a held key swings it right round
  player.spin += (want.steer * RUN.turn - player.spin) * (1 - Math.exp(-RUN.steer * dt));
  player.yaw += player.spin * dt;
  // the speed follows where it faces only slowly: drifting in a turn, gliding when let go, stopping when braked
  ahead(player.yaw, _ahead);
  _want.copy(_ahead).multiplyScalar(RUN.top * want.throttle);
  const grip = want.throttle > 0 ? RUN.grip : want.brake > 0 ? RUN.brake * want.brake : RUN.glide;
  player.vel.lerp(_want, 1 - Math.exp(-grip * dt));
  if (stuck) player.vel.set(0, 0, 0);
  player.pos.addScaledVector(player.vel, dt);
  const push = field.collide(player.pos, BODY);
  if (push.lengthSq() > 1e-8) bonk(push.normalize());
  // snow spraying from the feet in a skid or a hard brake
  const sideways = Math.abs(_side.set(_ahead.z, 0, -_ahead.x).dot(player.vel));
  skidClock -= dt;
  if ((sideways > SKID || (want.brake > 0 && player.vel.length() > 1.5) || player.out) && player.vel.length() > 1
    && skidClock <= 0) {
    skidClock = 0.07;
    puffs.snow(_want.copy(player.pos).addScaledVector(player.vel, -0.12), { puffs: 1, flakes: 2, size: 0.55, up: 0.35,
      spread: 0.25 });
  }
  return sideways;
}

// Into a wall: bounce back off it, and from a good speed, a bonk: squashed, reeling and spun a little.
function bonk(normal) {
  const into = -player.vel.dot(normal);
  if (into <= 0) return;
  player.vel.addScaledVector(normal, into * (1 + BONK.bounce));
  if (into < BONK.from || player.out) return;
  const hard = THREE.MathUtils.clamp((into - BONK.from) / (RUN.top - BONK.from), 0, 1);
  player.wobble.amp = 0.12 + 0.2 * hard;
  player.wobble.t = 0;
  player.reel = BONK.reel * (0.4 + 0.6 * hard);
  player.spin += (Math.random() < 0.5 ? -1 : 1) * into * BONK.spin;
  player.bonks++;
  puffs.snow(_want.copy(player.pos).addScaledVector(normal, -BODY).setY(0.4), { puffs: 3 + 3 * hard, flakes: 8,
    up: 0.8 });
  sounds.play(hard > 0.5 ? 'land-hard' : 'land-soft');
  sfx.cue({ type: 'bonk', speed: into, hard });
  pad.rumble(hard > 0.5 ? 'hit' : 'bump');
  if (hard > 0.35 && time - said > 4) {
    said = time;
    toast(OUCH[ouch++ % OUCH.length], '', 'oops');
  }
}

// Mnot's pose on top of the clip: leaning into a turn, squashed by a bonk, going over when out.
function pose(dt, sideways) {
  const m = mnot.model, speed = player.vel.length();
  const sway = 0.14 * Math.min(1, player.dizzy) * Math.sin(time * 6.5);          // seeing stars
  const lean = player.out ? 0 : THREE.MathUtils.clamp(-player.spin * speed * 0.05, -0.32, 0.32) + sway;
  m.rotation.z += (lean - m.rotation.z) * (1 - Math.exp(-8 * dt));
  const w = player.wobble;
  w.t += dt;
  const s = w.amp * Math.exp(-w.t * 6) * Math.cos(w.t * 21);
  m.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
  if (player.out) {
    // over backwards, a bounce on landing, then flat on its back
    const f = (player.fall += dt), k = Math.min(1, f / 0.42);
    const over = k * k * (Math.PI / 2 - 0.12) - (f > 0.42 ? 0.12 * Math.exp(-(f - 0.42) * 7) * Math.sin((f - 0.42) * 26) : 0);
    m.rotation.x = -over;
    m.position.y = 0.3 * Math.sin(over);
    if (f - dt < 0.42 && f >= 0.42) {
      sounds.play('land-hard');
      sfx.cue({ type: 'fall' });
      puffs.snow(player.pos, { puffs: 6, flakes: 12, up: 0.9 });
    }
  } else {
    m.rotation.x += (-0.5 * w.amp * Math.exp(-w.t * 5) - m.rotation.x) * (1 - Math.exp(-14 * dt));
  }
  if (title.visible || player.done || player.out) return;
  // the clip: still, walking or running by the speed along where it faces; arms wheeling in a glide or a skid
  const along = Math.max(0, player.vel.dot(ahead(player.yaw, _ahead)));
  const anim = mnot.animator;
  if (player.pit) return anim.play('Teeter', 0.1);   // flailing, in a hole
  if (player.reel > 0 || (sideways > SKID * 1.3 && speed > 2) || (want.throttle === 0 && speed > 2.2)) {
    anim.play('Teeter', 0.12);
  } else if (along > 0.3) {
    anim.play(along > 2.4 ? 'Run' : 'Walk', 0.2);
    anim.setGaitSpeed(along, { Walk: mnot.rig.walk_speed, Run: mnot.rig.run_speed });
  } else anim.play('Idle', 0.25);
}

// ------------------------------------------------------------------ the camera

const follow = { look: new THREE.Vector3(), fov: VIEW.fov, yaw: 0, peek: 0, up: false, intro: 0 };
const _seat = new THREE.Vector3(), _look = new THREE.Vector3(), _high = new THREE.Vector3(), _highLook = new THREE.Vector3();
function placeCamera(dt, snap = false) {
  const far = THREE.MathUtils.clamp(1.3 / camera.aspect, 1, 1.6);   // a tall screen: further back
  const at = player.pos;
  follow.yaw += turn(player.yaw - follow.yaw) * (snap ? 1 : 1 - Math.exp(-VIEW.swing * dt));
  ahead(follow.yaw, _ahead);
  _side.set(-_ahead.z, 0, _ahead.x);              // Mnot's right
  if (player.done || (player.out && player.fall > 0.3)) {
    // round to the front, for the party (or the shame)
    const f = VIEW.front, d = f.dist * (player.out ? 0.85 : 1);
    ahead(player.yaw + (player.out ? 0.5 : 0.35), _want);
    _seat.copy(at).addScaledVector(_want, d).setY(f.h + (player.out ? 1.2 : 0));
    if (player.out) _look.copy(at).addScaledVector(ahead(player.yaw, _high), -0.8).setY(0.3);   // the can, flat
    else _look.copy(at).setY(f.look);
  } else {
    _seat.copy(at).addScaledVector(_ahead, -VIEW.back * far).addScaledVector(_side, VIEW.side).setY(VIEW.h * far);
    _look.copy(at).addScaledVector(_ahead, VIEW.ahead).setY(VIEW.look);
  }
  // the peek: high over the field from behind Mnot, so left stays left. The one at the start waits for the title's
  // glide into the shoulder view to finish.
  if (!title.glide) follow.intro -= dt;
  const p = VIEW.peek;
  const up = !player.done && !player.out && ((follow.intro > 0 && !title.glide) || (playing && peeking()));
  if (up !== follow.up && !snap) sfx.cue({ type: 'peek', up });
  follow.up = up;
  follow.peek += ((up ? 1 : 0) - follow.peek) * (snap ? 1 : 1 - Math.exp(-p.rate * dt));
  const k = THREE.MathUtils.smoothstep(follow.peek, 0, 1);
  if (k > 1e-3) {
    const pfar = THREE.MathUtils.clamp(1.5 / camera.aspect, 1, 1.8);
    _highLook.lerpVectors(field.middle, at, p.toward).setY(0.6);
    _high.copy(_highLook).addScaledVector(_ahead, -p.back * pfar).setY(p.h * pfar);
    _seat.lerp(_high, k);
    _look.lerp(_highLook, k);
  }
  follow.fov = VIEW.fov + (p.fov - VIEW.fov) * k;
  if (snap) {
    camera.position.copy(_seat);
    follow.look.copy(_look);
  } else {
    camera.position.lerp(_seat, 1 - Math.exp(-7 * dt));
    follow.look.lerp(_look, 1 - Math.exp(-9 * dt));
  }
  camera.lookAt(follow.look);
  if (Math.abs(camera.fov - follow.fov) > 0.01 && !title.visible) {
    camera.fov = follow.fov;
    camera.updateProjectionMatrix();
  }
}

// the title (title.js); it listens after the controls above, so the key that starts isn't read twice
const title = new Title({ camera, dom: renderer.domElement, mnot, player, follow });
title.on('start', () => begin());

// ------------------------------------------------------------------ the loop

function step(dt) {
  if (!(dt > 0)) return;
  time += dt;
  shaderTime.value = time;
  readPad(dt);
  player.reel -= dt;
  const sideways = slide(dt);
  if (player.pit) climb(dt);
  const free = playing && !title.visible && !player.done && !player.out && !player.pit;
  crackle(cracks.update(dt, free ? player.pos : null, camera));
  if (playing && !player.done && !player.out) player.time += dt;     // on in a hole, too
  if (free) {
    if (player.next === field.order.length) {
      if (stickers.reached(player.pos)) finish();
    } else {
      const s = stickers.touched(player.pos);
      if (s?.emoji.listed === player.next) take(s);
      else if (s && player.safe <= 0) hit(s);
    }
  }
  // won, the prize floats over Mnot's head, a little behind it, where the camera in front sees both
  if (player.done) stickers.hold(_peak.copy(player.pos).addScaledVector(ahead(player.yaw, _to), -0.9).setY(2.4));
  player.safe -= dt;
  player.dizzy = Math.max(0, player.dizzy - dt);
  input.pressed.clear();
  title.update(dt);                               // on the title, Mnot's act is the title's (title.js)
  mnot.root.rotation.y = player.yaw;
  pose(dt, sideways);
  mnot.animator.update(dt);
  dizzy.update(dt, player.pos, player.out ? 0 : player.dizzy);
  stickers.update(dt, camera, player.pos, field.emojis[field.order[player.next]],
    THREE.MathUtils.smoothstep(follow.peek, 0.2, 0.9));
  for (const a of world.animated) a.update(dt);
  placeCamera(dt);
  title.place(dt);
  stage.aimSun(field.middle);
  scenery.update(camera, time);
  toast.update(dt);
  sfx.update(dt, { speed: player.vel.length(), skid: sideways, braking: want.brake > 0, dizzy: player.dizzy,
    peek: follow.peek });
  hud.time.textContent = clock(player.time);
}

deal();
placeCamera(0, true);
if (!manual) title.show();
step(1 / 60);
warmUp(scene, render);
render();
startLoop({ manual, post, step, render });

// for debugging and tests
expose('emoji', { THREE, renderer, scene, camera, post, stage, mnot, player, sounds, input, title, pad, padMenu,
  level, puffs, stickers, cracks, follow, sfx, music, dizzy, get field() { return field; }, deal, restart,
  autopilot(on = true) { autopilot = on; begin(); } }, { step, render });
