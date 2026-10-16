// The emoji field (emoji.html), a prototype: a list of the community's Slack emoji at the top of the screen, and a
// snowy field full of them, with knee-high snow walls between (field.js). Mnot fetches the listed ones in the list's
// order; touching any other, or a listed one too early, costs one of three tries. With the list done, every other
// emoji twists away and :peak-mnot: drops into the middle of the field: fetching it stops the clock. Seen over Mnot's
// shoulder, steered like a shopping trolley on fresh snow: it slides, drifts wide in a turn and bonks off the walls,
// and the wrong emojis are never far. A few passages are cracked (cracks.js): stepped on, the snow holds for two
// seconds, time enough to get across, then gives way, and there's no way back through. Run into a hole's edge and
// Mnot teeters there (teeter.js): brake or steer away, or in it goes. Built on the mini game kit
// (peak/kit/README.md), with high scores (scores.js, checked by server/emoji.py), the Hall of Fame's Race ghost and
// Watch run (playback.js) and Plausible goals (analytics.js).
// Open emoji.html?manual to stop the loop and step it from the console (window.emoji.step), for tests;
// emoji.autopilot(true) lets a bot play. ?seed= deals a given field (else it's a random one), ?list= how many to fetch
// (5), ?wrong= how many others stand about (24), ?open= how open the maze is (0 a real maze, 1 no walls at all),
// ?cracks= how many cracked passages at most (3), ?finale= how many give way at the end (three to five). Only the
// board's fields count for the board: those a random deal gives (counts(), below); any other is practice.
// ?ghost=ID races a run from the Hall of Fame, ?replay=ID watches one (playback.js); ?hall opens the Hall. ?perf times
// how this computer draws it (perf.js).
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
import { Teeter, TEETER } from './teeter.js';
import { Stickers, loadSheet, cssSticker } from './stickers.js';
import { SHEET } from './sheet.js';
import { Title } from './title.js';
import { Dizzy } from './dizzy.js';
import { EmojiSfx } from './sfx.js';
import { EmojiMusic } from './music.js';
import { createScores } from './scores.js';
import { routeFingerprint } from './routedata.js';
import { FLAG, KEY } from './record.js';
import { Ghost, Recording, validateReplay } from './playback.js';
import { ReplayController } from '../replays/controller.js';
import { apiBase } from '../scores/scores.js';
import { hookAnalytics } from './analytics.js';

const params = new URLSearchParams(location.search);
const perf = params.has('perf');                  // the perf probe (perf.js) drives the game, as tests do
const manual = params.has('manual') || perf;
// the Hall of Fame's Race ghost (?ghost=ID) and Watch run (?replay=ID: no run of its own, so no scores, keys or
// title); a link with both is an error to show
const hasGhost = params.has('ghost'), hasReplay = params.has('replay');
const replayRoute = hasGhost || hasReplay ? {
  mode: hasGhost && hasReplay ? 'invalid' : hasReplay ? 'replay' : 'ghost',
  id: hasGhost && hasReplay ? '' : params.get(hasReplay ? 'replay' : 'ghost'),
} : null;
const watching = !!replayRoute && replayRoute.mode !== 'ghost';
const racing = replayRoute?.mode === 'ghost';
// Made for more than one level from the start (kit/levels.js): '' is the first. ?level= picks one.
const LEVELS = [''];
const level = pickLevel(LEVELS);
const number = (name, fallback, min, max) => {
  const v = Number(params.get(name));
  return params.has(name) && Number.isFinite(v) ? THREE.MathUtils.clamp(v, min, max) : fallback;
};
const DEFAULT = { list: 5, wrong: 24, open: 0.5, cracks: 3, finale: null };
const DEAL = { list: number('list', DEFAULT.list, 1, 12), wrong: number('wrong', DEFAULT.wrong, 0, 50),
  open: number('open', DEFAULT.open, 0, 1), cracks: number('cracks', DEFAULT.cracks, 0, 6),
  finale: params.has('finale') ? number('finale', 3, 0, 8) : DEFAULT.finale };
const practice = Object.keys(DEFAULT).some(k => DEAL[k] !== DEFAULT[k]);     // another deal: nothing for the board
// The prize at the end of every list, never dealt on the field; it drops after `drop` s. Meanwhile the camera looks
// over the field for `look` s, and Mnot stops and flails, as the snow shakes for `shake` s and a few passages give
// way (field.js, collapse()).
const PEAK = 'peak-mnot';
const NAMES = SHEET.names.filter(name => name !== PEAK);
const FINALE = { drop: 0.2, look: 1.2, shake: 0.9 };
// Random fields, but about as hard as each other: one is dealt from random seeds up to POOL until one rates
// (field.js, rate()) in BAND, the middle of what the first RATED seeds' fields rate with this DEAL (as parts of them,
// low to high), and has at least CRACKED cracks and GIVEN passages giving way at the end (or as many as asked for).
// Those are the board's fields (the score server has each one: routedata.js); any other is practice.
const RATED = 48, BAND = [0.35, 0.65], TRIES = 80, CRACKED = 2, GIVEN = 3, POOL = 2000;
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
const hinted = new Set();                         // the rules told already, once a page: 'crack', 'rim'
// Funny lines for a hard bonk, one at a time
const OUCH = ['Bonk.', 'Ow. My glasses.', 'That wall wasn\'t there.', 'Snow in the can.', 'Who put that there?',
  'Totally meant that.'];
// The camera: over Mnot's right shoulder (back, h, side m), looking ahead of it (ahead m, at look m high), swinging
// round after where Mnot faces a little late (swing, a second), so a turn shows. Space (or holding the list) peeks:
// the camera rises to look over the whole field from behind Mnot, and Mnot stops to look. At the start it peeks by
// itself for `intro` seconds. When it's over, the camera comes round to the front (front: dist, h m).
const VIEW = { back: 4.4, h: 2.4, side: 0.55, ahead: 3.4, look: 0.8, swing: 3.2, fov: 56,
  peek: { h: 18, back: 7, toward: 0.4, fov: 50, rate: 4, rush: 8 }, intro: 1.6, front: { dist: 4, h: 1.6, look: 0.9 },
  shake: 0.3 };
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
const teeter = new Teeter();
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
let rated = null, band = null;
const rates = () => (rated ??= Array.from({ length: RATED }, (_, i) => plan(i + 1)));
const banded = () => (band ??= (sorted => BAND.map(k => sorted[Math.floor(k * (RATED - 1))]))(
  rates().map(f => f.rate()).sort((a, b) => a - b)));
// how far a field (planned) is from a fair one: 0 in the band with its cracks, else more
function off(planned) {
  const rate = planned.rate(), [low, high] = banded();
  const few = planned.cracks.length < Math.min(CRACKED, DEAL.cracks)
    || planned.finale.length < Math.min(GIVEN, DEAL.finale ?? GIVEN);
  return Math.max(low - rate, rate - high, 0) + (few ? 100 : 0);
}
function randomSeed() {
  let best = 0, far = Infinity;
  for (let i = 0; i < TRIES; i++) {
    const s = 1 + Math.floor(Math.random() * POOL), o = off(plan(s));
    if (o === 0) return s;
    if (o < far) [best, far] = [s, o];
  }
  return best;
}
// the board's numbers and fields, for the score server (routedata.js) and the scores (scores.js)
const RULES = { deal: DEFAULT, pool: POOL, rated: RATED, band: BAND, cracked: CRACKED, given: GIVEN, body: BODY,
  run: RUN, bonk: BONK, lives: LIVES, hit: HIT, pit: { sink: PIT.sink, down: PIT.down, stay: PIT.stay, out: PIT.out },
  finale: FINALE };
const board = { rules: RULES, plan, names: NAMES, rated: rates, band: banded,
  counts: (s, planned) => !practice && Number.isInteger(s) && s >= 1 && s <= POOL && off(planned) === 0 };
// N (and X on a controller): a new field; after a ?seed=, the next seed, so a test or a shared link stays put; racing
// a ghost, its field again
const another = () => deal(racing ? seed : params.has('seed') ? seed + 1 : randomSeed());

let field = null, seed = params.has('seed') ? number('seed', 1, 0, 2 ** 31) : randomSeed(), counted = false;
// the perf probe (perf.js) keeps Mnot standing where it puts it, as under the title
let playing = manual && !perf, time = 0, autopilot = false, ouch = 0, plop = 0, said = 0;
// the high scores: the run recorded from the clock's start, checked by the server at :peak-mnot: (scores.js)
const scores = createScores({ player, route: () => routeFingerprint(board), field: () => ({ seed, counts: counted }),
  manual, level, watching, again: () => { another(); begin(); } });
const mark = (name, arg) => { if (!watching) scores.recorder.mark(name, arg); };

function deal(next = seed) {
  seed = next;
  field?.dispose();
  field = new Field({ seed, names: NAMES, ...DEAL });
  scene.add(field.group);
  counted = board.counts(seed, field);
  hud.seed.textContent = counted || watching ? `field ${seed}` : `field ${seed} · practice`;
  restart();
}
function restart() {
  for (const e of field.emojis) e.taken = false;
  stickers.set(field.emojis);
  field.holes.clear();
  cracks.set(field);
  teeter.stop();
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
  Object.assign(follow, { yaw: 0, rush: 0, shake: 0 });
  if (playing) follow.intro = VIEW.intro;
  sfx.reset();
  music.reset();
  if (playing) music.start();
  scores.reset();
  drawList();
  drawLives();
  analytics.run();
}
function begin() {
  if (playing) return;
  playing = true;
  analytics.run();
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
  mark('take', player.next);
  scores.take(player.next);
  markList();
  pop(hud.list.children[player.next - 1]);
  if (player.next === field.order.length) toThePeak();
}
// The list done: every other emoji twists away, from Mnot outwards, the camera shoots up to watch, the snow shakes
// and cracks open across a few passages on the way to the middle (cracks.js, quake()), and :peak-mnot: drops into
// the middle of the field with a bump, in a beam of light. Mnot stops and flails a moment. The clock runs on:
// fetching it is the finish.
const _peak = new THREE.Vector3();
function toThePeak() {
  analytics.listed();
  stickers.sweep(player.pos);
  cracks.quake(player.pos);
  stickers.drop(PEAK, field.centre(...field.peak, _peak), FINALE.drop, () => {
    puffs.snow(_peak, { puffs: 8, flakes: 18, up: 1.4 });
    sounds.play('land-hard');
    sfx.cue({ type: 'peak' });
    pad.rumble('bump');
  });
  Object.assign(follow, { intro: FINALE.look, rush: FINALE.look + 0.8 });
  player.reel = FINALE.look;
  Object.assign(player.wobble, { amp: 0.2, t: 0 });
  sfx.cue({ type: 'clear' });
  const holes = field.finale.length;
  if (holes) {
    follow.shake = FINALE.shake;
    sfx.cue({ type: 'quake', holes });
    pad.rumble('hit');
  }
  toast(`All ${field.order.length}!`, holes ? 'Now :peak-mnot:, in the middle! The snow gives way: find a way round.'
    : 'Now :peak-mnot:, in the middle of the field. The clock is running.');
}
// A wrong one touched: it costs a try. It warps away (a listed one too early pops back in a moment later), and Mnot
// bumps back off it, reeling, and sees stars for a while. The third is out.
const _off = new THREE.Vector3();
function hit(s) {
  teeter.stop();                                  // bumped off the rim, if on it, not over it
  mark('hit', field.emojis.indexOf(s.emoji));
  analytics.wrong();
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
  analytics.out();
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
  mark('finish');
  analytics.finish();
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
  showCard('Thread complete!', `${field.order.length} reactions in order, and :peak-mnot: on top.${after}`
    + (counted || watching ? '' : ' A practice field: this one isn\'t on the board.'));
}
// The cracks (cracks.js): one stepped on creaks; given way, its passage is shut for good (field.holes, so the bot and
// the checks go round), the same for those giving way at the end; Mnot over a hole drops in, and at its edge as it
// goes, slowly, teeters there.
function crackle(happened) {
  for (const [what, k] of happened) {
    if (what === 'stepped') {
      mark('crack', cracks.list.indexOf(k));
      sfx.cue({ type: 'crack' });
      if (!hinted.has('crack') && time - said > 1.5) {
        hinted.add('crack');
        said = time;
        toast('Cracked snow!', 'It holds for two seconds once you\'re on it. Keep going!');
      }
    } else if (what === 'opened') {
      mark('hole', cracks.list.indexOf(k));
      const under = cracks.over(k, player.pos);
      field.holes.add(k.key);
      sounds.play('land-soft');
      sfx.cue({ type: 'hole', under, finale: k.finale });
      pad.rumble('bump');
      if (!under && rimmed() && player.vel.length() < TEETER.slow && cracks.gap(k, player.pos) < TEETER.rim) onRim(k);
      if (k.finale) continue;
      player.holes++;
      if (!under && !teeter.active && player.holes === 1 && time - said > 1.5) {
        said = time;
        if (!cracks.crossed(k, player.pos)) toast('Gone!', 'The snow gave way: that way is shut now. Go round.');
        else toast('Made it!', 'The snow gave way behind you: no way back through there.');
      }
    } else if (what === 'under' && !player.pit) fallIn(k);
  }
}
function fallIn(k) {
  mark('pit', cracks.list.indexOf(k));
  analytics.hole();
  teeter.stop();
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
  if (fresh && k.finale) toast('Whoops!', 'The snow gave way right under you.', 'oops');
  else toast(fresh ? 'Too slow!' : PLOP[plop++ % PLOP.length],
    fresh ? 'Cracked snow holds for two seconds: don\'t stop on it.' : 'That way is gone. Find another way round.',
    'oops');
}

// Teetering on a hole's rim (teeter.js), when Mnot may: on the snow, playing, not watching a run.
const rimmed = () => playing && !title.visible && !player.done && !player.out && !player.pit && !watching
  && !teeter.active;
// Caught at the edge of crack k's hole: still, facing it, rocking out over it with its arms wheeling.
const _out = new THREE.Vector3();
function onRim(k) {
  mark('rim', cracks.list.indexOf(k));
  teeter.start(k, cracks.toward(k, player.pos, _out));
  player.vel.set(0, 0, 0);
  Object.assign(player, { spin: 0, reel: 0 });
  mnot.animator.play('Teeter', 0.12, { restart: true });
  sfx.cue({ type: 'teeter' });
  pad.rumble('bump');
  if (!hinted.has('rim')) {
    hinted.add('rim');
    said = time;
    toast('Whoa!', 'Brake or steer away, or in you go.', 'oops');
  }
}
// A step on the rim: the player's keys (whatever a bonk or a peek says) save Mnot or send it in; till then it stays
// put, turning to face the hole unless steered.
function balance(dt) {
  controls();
  if (!watching) scores.recorder.input(want, peeking());
  const happened = teeter.hold(dt, want, ahead(player.yaw, _ahead).dot(teeter.out));
  if (happened === 'steady') return steady();
  if (happened === 'over') {
    // just over the edge, then down into the hole as if walked into
    const k = teeter.k;
    cracks.brink(k, player.pos, TEETER.over, player.pos);
    return fallIn(k);
  }
  player.vel.set(0, 0, 0);
  if (Math.abs(want.steer) > 0.05) {
    player.spin += (want.steer * RUN.turn - player.spin) * (1 - Math.exp(-RUN.steer * dt));
  } else {
    player.spin = 0;
    player.yaw += turn(Math.atan2(teeter.out.x, teeter.out.z) - player.yaw) * (1 - Math.exp(-10 * dt));
  }
  player.yaw += player.spin * dt;
}
// Saved: back from the brink, with a wobble.
function steady() {
  mark('steady');
  teeter.stop();
  Object.assign(player.wobble, { amp: 0.22, t: 0 });
  sfx.cue({ type: 'steady' });
}
// In a hole: dropping in up to its glasses, flailing, then a hop out onto the side it came from, dizzy.
function climb(dt) {
  const p = player.pit, m = mnot.model, { sink, down, stay, out } = PIT;
  p.t += dt;
  if (p.t < down + stay) {
    const k = Math.min(1, p.t / down);
    if (!watching) player.pos.lerpVectors(p.from, p.in, k);   // a watched run's Mnot is where it was
    m.position.y = -sink * k * k + (p.t > down ? 0.06 * Math.sin((p.t - down) * 13) : 0);
    return;
  }
  if (!p.hop) {
    p.hop = true;
    sounds.play('jump');
  }
  const k = Math.min(1, (p.t - down - stay) / out);
  m.position.y = -sink * (1 - k) + PIT.hop * 4 * k * (1 - k);
  if (!watching) {
    player.pos.lerpVectors(p.in, p.to, k);
    player.yaw += turn(Math.atan2(p.to.x - p.in.x, p.to.z - p.in.z) - player.yaw) * (1 - Math.exp(-12 * dt));
  }
  if (k < 1) return;
  climbOut();
}
// Out of the hole (or, watching a run, when the recording says so): on the snow again, seeing stars.
function climbOut() {
  const m = mnot.model;
  mark('climb');
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
  if (title.visible || watching || e.target.closest?.('input, textarea')) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && !e.repeat) restart();
  if (e.code === 'KeyN' && !e.repeat) another();
  begin();
});

// A finger (or a mouse) dragged on the field steers, from where it went down: sideways turns, up runs, down brakes.
// Holding the list peeks.
const drag = { id: null, x0: 0, y0: 0, x: 0, y: 0 }, touchPeek = new Set();
renderer.domElement.addEventListener('pointerdown', e => {
  if (title.visible || watching) return;
  begin();
  Object.assign(drag, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
});
$('list').addEventListener('pointerdown', e => {
  if (title.visible || watching) return;
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
  if (watching) return;                           // a watched run's keys are the recording's
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
const peeking = () => watching ? peeked
  : held('Space') || touchPeek.size > 0 || pad.down(BUTTON.lb) || pad.down(BUTTON.rb);

// What the player asks for this step: steer (-1 right .. 1 left), throttle (0..1) and brake (0..1).
const want = { steer: 0, throttle: 0, brake: 0 };
function controls() {
  Object.assign(want, { steer: 0, throttle: 0, brake: 0 });
  if (watching) return;
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
const _before = new THREE.Vector3();
let skidClock = 0;
function slide(dt) {
  // on the title (or in a hole) Mnot stands still; out, it slides on on its back; done, it dances to a stop; reeling
  // from a bonk or peeking, it slows; on a hole's rim, it teeters
  const stuck = !playing || title.visible || !!player.pit;
  if (teeter.active && !stuck) {
    balance(dt);
    return 0;
  }
  const free = !stuck && !player.out && !player.done && player.reel <= 0 && !peeking();
  if (free) {
    controls();
    // seeing stars: the steering wanders a little
    const daze = Math.min(1, player.dizzy);
    if (daze > 0) want.steer = THREE.MathUtils.clamp(want.steer + HIT.wander * daze * Math.sin(time * 4.3), -1, 1);
  } else Object.assign(want, { steer: 0, throttle: 0, brake: player.out ? 0 : player.done ? 0.4 : player.reel > 0 ? 0.3 : 0.6 });
  if (!watching) scores.recorder.input(want, peeking());
  // turning: the spin eases to what's asked, so a tap is a nudge and a held key swings it right round
  player.spin += (want.steer * RUN.turn - player.spin) * (1 - Math.exp(-RUN.steer * dt));
  player.yaw += player.spin * dt;
  // the speed follows where it faces only slowly: drifting in a turn, gliding when let go, stopping when braked
  ahead(player.yaw, _ahead);
  _want.copy(_ahead).multiplyScalar(RUN.top * want.throttle);
  const grip = want.throttle > 0 ? RUN.grip : want.brake > 0 ? RUN.brake * want.brake : RUN.glide;
  player.vel.lerp(_want, 1 - Math.exp(-grip * dt));
  if (stuck) player.vel.set(0, 0, 0);
  _before.copy(player.pos);
  player.pos.addScaledVector(player.vel, dt);
  // a step that would take Mnot's middle over an open hole: caught at its edge instead, teetering
  const k = rimmed() ? cracks.hole(player.pos) : null;
  if (k && !cracks.over(k, _before)) {
    player.pos.copy(_before);
    onRim(k);
    return 0;
  }
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
  mark('bonk', Math.round(into * 100));
  player.spin += (Math.random() < 0.5 ? -1 : 1) * into * BONK.spin;
  thud(into, normal);
}
// A bonk at `into` m/s against the wall facing `normal`: squashed, reeling, the snow puffing and a line now and then.
function thud(into, normal) {
  const hard = THREE.MathUtils.clamp((into - BONK.from) / (RUN.top - BONK.from), 0, 1);
  player.wobble.amp = 0.12 + 0.2 * hard;
  player.wobble.t = 0;
  player.reel = BONK.reel * (0.4 + 0.6 * hard);
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

// Mnot's pose on top of the clip: leaning into a turn, squashed by a bonk, tipping out over a hole on its rim, going
// over when out.
function pose(dt, sideways) {
  const m = mnot.model, speed = player.vel.length();
  const sway = 0.14 * Math.min(1, player.dizzy) * Math.sin(time * 6.5);          // seeing stars
  let lean = player.out ? 0 : THREE.MathUtils.clamp(-player.spin * speed * 0.05, -0.32, 0.32) + sway, bow = null;
  if (teeter.active && !player.out) {
    // about the feet, toward the hole: forward as far as Mnot faces it, sideways (to its left: +x) the rest
    const o = teeter.out, cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), tip = teeter.tip;
    lean = -tip * (o.x * cy - o.z * sy);
    bow = tip * (o.x * sy + o.z * cy);
  }
  m.rotation.z += (lean - m.rotation.z) * (1 - Math.exp(-(bow === null ? 8 : 20) * dt));
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
  } else if (bow !== null) {
    m.rotation.x += (bow - m.rotation.x) * (1 - Math.exp(-20 * dt));
  } else {
    m.rotation.x += (-0.5 * w.amp * Math.exp(-w.t * 5) - m.rotation.x) * (1 - Math.exp(-14 * dt));
  }
  if (title.visible || player.done || player.out) return;
  // the clip: still, walking or running by the speed along where it faces; arms wheeling in a glide or a skid
  const along = Math.max(0, player.vel.dot(ahead(player.yaw, _ahead)));
  const anim = mnot.animator;
  if (player.pit || teeter.active) return anim.play('Teeter', 0.1);   // flailing, in a hole or on its rim
  if (player.reel > 0 || (sideways > SKID * 1.3 && speed > 2) || (want.throttle === 0 && speed > 2.2)) {
    anim.play('Teeter', 0.12);
  } else if (along > 0.3) {
    anim.play(along > 2.4 ? 'Run' : 'Walk', 0.2);
    anim.setGaitSpeed(along, { Walk: mnot.rig.walk_speed, Run: mnot.rig.run_speed });
  } else anim.play('Idle', 0.25);
}

// ------------------------------------------------------------------ the camera

const follow = { look: new THREE.Vector3(), fov: VIEW.fov, yaw: 0, peek: 0, up: false, intro: 0, rush: 0, shake: 0,
  jolt: new THREE.Vector3() };
const _seat = new THREE.Vector3(), _look = new THREE.Vector3(), _high = new THREE.Vector3(), _highLook = new THREE.Vector3();
function placeCamera(dt, snap = false) {
  const far = THREE.MathUtils.clamp(1.3 / camera.aspect, 1, 1.6);   // a tall screen: further back
  const at = player.pos;
  camera.position.sub(follow.jolt);               // last frame's shake off
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
  follow.rush -= dt;                              // at the end of the list, up and back down quicker
  follow.peek += ((up ? 1 : 0) - follow.peek) * (snap ? 1 : 1 - Math.exp(-(follow.rush > 0 ? p.rush : p.rate) * dt));
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
  // the snow shaking as it gives way at the end: the camera with it, dying down
  follow.shake = Math.max(0, follow.shake - dt);
  const shake = VIEW.shake * Math.min(1, follow.shake / 0.3);
  follow.jolt.set(Math.sin(time * 53), Math.sin(time * 61 + 1), Math.sin(time * 47 + 2)).multiplyScalar(shake);
  camera.position.add(follow.jolt);
  camera.lookAt(follow.look);
  if (Math.abs(camera.fov - follow.fov) > 0.01 && !title.visible) {
    camera.fov = follow.fov;
    camera.updateProjectionMatrix();
  }
}

// the title (title.js); it listens after the controls above, so the key that starts isn't read twice
const title = new Title({ camera, dom: renderer.domElement, mnot, player, follow });
// its Plausible goals (analytics.js) hear the start before begin() does; a watched run sends none
const analytics = hookAnalytics({ title, manual: manual || watching });
title.on('start', () => begin());

// ------------------------------------------------------------------ watching a run, racing one

// Watching (?replay=ID): the controls (peak/replays/controller.js) move the run's clock, and watcher() the page's own
// Mnot along the recording on the run's field, telling what happened as it happened, so the sounds, puffs, toasts and
// the card are the live game's; past the end, the physics let it slide to a stop, dancing. Racing (?ghost=ID): the
// run's field, and a see-through Mnot on the recording at the player's clock (playback.js).
const JUMP = 1.5;                                 // s: a move further on than this is a jump in time (controller.js)
let replays = null, watch = null, ghost = null, peeked = false;
if (replayRoute) {
  replays = new ReplayController({ mode: replayRoute.mode, id: replayRoute.id, scene, title,
    api: apiBase(location, 'emoji', level), fingerprint: routeFingerprint(board), validate: validateReplay,
    createActor: async ({ replay, ghost: race }) => race ? raceOn(replay) : watch = watcher(replay),
    snap: () => placeCamera(0, true), done: () => player.done || player.out,
    isRunActive: () => scores.recorder.recording,
    words: { ready: 'Start when you’re ready.', finished: clock => `Done · ${clock} on the clock`,
      leave: 'Leave this run? Your current run will be lost.' } });
  if (racing) {
    // the clean title start, but no race before its ghost has loaded and been checked
    const startTitle = title.start.bind(title);
    title.start = (how = 'key') => {
      if (!replays.ready) { replays.status.textContent = 'Wait for the ghost to load before starting.'; return; }
      startTitle(how);
    };
  }
}
// The ghost on its field: the player races it there.
async function raceOn(replay) {
  ghost = await Ghost.create({ replay, scene, pit: PIT });
  deal(replay.seed);
  return ghost;
}

// The page's own Mnot along a recorded run, on its field: the controls' actor.
function watcher(replay) {
  const recording = new Recording(replay);
  playing = true;
  deal(recording.seed);
  const w = { recording, duration: recording.end, phase: 0, root: mnot.root, t: -1, dispose() {},
    seek(t) {
      t = THREE.MathUtils.clamp(Number(t) || 0, 0, recording.end);
      if (t === w.t) return;
      if (w.t < 0 || t < w.t || t - w.t > JUMP) rewind(recording, t);
      else tell(recording, w.t, t);
      put(recording, t);
      w.t = t;
    } };
  return w;
}

// Mnot where the recording has it at t: going, facing and turning, the clock, and what the player held.
const _st = { pos: new THREE.Vector3(), vel: new THREE.Vector3() }, _n = new THREE.Vector3();
function put(rec, t) {
  const st = rec.state(t, _st), mask = rec.mask(t);
  player.pos.copy(st.pos).setY(0);
  player.vel.copy(st.vel);
  Object.assign(player, { yaw: st.yaw, spin: st.spin, time: Math.min(t, rec.end) });
  Object.assign(want, { steer: (mask & KEY.left ? 1 : 0) - (mask & KEY.right ? 1 : 0), throttle: mask & KEY.run ? 1 : 0,
    brake: mask & KEY.brake ? 1 : 0 });
  peeked = !!(mask & KEY.peek);
}

// Everything recorded after `from` (0: from the start), up to and with `to`, told as it happened in the live game.
function tell(rec, from, to) {
  const s = rec.samples;
  for (let i = from > 0 ? rec.after(from) : 0; i < s.length && s[i][0] <= to * 1000; i++) told(rec, i);
}
function told(rec, i) {
  const s = rec.samples[i], flags = s[8];
  put(rec, s[0] / 1000);
  if (flags & FLAG.start) {
    sfx.cue({ type: 'start' });
    toast('Go!', 'Fetch them in the list\'s order.');
  }
  if (flags & FLAG.steady && teeter.active) steady();
  if (flags & FLAG.climb && player.pit) climbOut();
  for (const [name, arg] of rec.with[i]) {
    const k = cracks.list[arg];
    if (name === 'bonk') thud(arg / 100, rec.normal(i, _n));
    else if (name === 'rim' && k && !teeter.active && !player.pit) onRim(k);
    else if (name === 'crack' && k && cracks.force(k, 'going', player.pos)) crackle([['stepped', k]]);
    else if (name === 'hole' && k && cracks.force(k, 'open')) crackle([['opened', k]]);
    else if (name === 'pit' && k && !player.pit) fallIn(k);
    else if (name === 'take' && arg === player.next + 1 && player.next < field.order.length) {
      take(stickers.list[field.order[player.next]]);
    } else if (name === 'hit' && stickers.list[arg] && !player.out) hit(stickers.list[arg]);
  }
  if (flags & FLAG.finish && !player.done) finish();
}

// After a jump in the watched run: the field as it was at t, played through from the start without a sound, a little
// at a time (the emojis twisting away, the cracks giving way, Mnot in and out of the holes), no toast left over from
// the way there, and the tune where it was.
const HUSH = [[sounds, 'play'], [sfx, 'cue'], [puffs, 'add'], [pad, 'rumble'], [music, 'reset'], [music, 'start'],
  [music, 'finish'], [music, 'duck']];
function rewind(rec, t) {
  const own = HUSH.map(([o, k]) => Object.hasOwn(o, k) ? o[k] : null);
  for (const [o, k] of HUSH) o[k] = () => {};
  try {
    restart();
    for (let at = 0; at < t;) {
      const next = Math.min(t, at + 0.05), dt = next - at;
      tell(rec, at, next);
      put(rec, next);
      player.reel -= dt;
      player.safe -= dt;
      player.dizzy = Math.max(0, player.dizzy - dt);
      if (teeter.active) teeter.tick(dt);
      if (player.pit) climb(dt);
      crackle(cracks.update(dt, null, camera));
      stickers.update(dt, camera, player.pos, field.emojis[field.order[player.next]]);
      follow.intro -= dt;
      follow.rush -= dt;
      follow.shake = Math.max(0, follow.shake - dt);
      at = next;
    }
  } finally {
    HUSH.forEach(([o, k], i) => { if (own[i]) o[k] = own[i]; else delete o[k]; });
  }
  toast.left = 0;
  toast.update(0);
  sfx.reset();
  if (player.done) music.finish();
  else {
    if (music.scene === 'finished') music.reset();
    music.start();
  }
}

// ------------------------------------------------------------------ the loop

function step(dt) {
  if (!(dt > 0)) return;
  // watching a run, its clock moves the field (paused, all of it stands still); past its end, Mnot slides on live
  const from = replays?.time ?? 0;
  if (watching) replays.update(dt, { gameTime: player.time });
  const replay = !!watch && (replays.playing || replays.time < replays.duration);
  const vdt = replay ? Math.max(0, replays.time - from) : dt;
  time += vdt;
  shaderTime.value = time;
  readPad(dt);
  player.reel -= vdt;
  ahead(player.yaw, _ahead);
  const pit = player.pit;       // a drop begun over a rim's edge in slide() sinks from the next step, as any other
  const sideways = replay ? Math.abs(_ahead.z * player.vel.x - _ahead.x * player.vel.z) : slide(vdt);
  if (replay && teeter.active) teeter.tick(vdt);
  if (pit) climb(vdt);
  const free = playing && !title.visible && !player.done && !player.out && !player.pit && !watching;
  crackle(cracks.update(vdt, free ? player.pos : null, camera));
  if (playing && !player.done && !player.out && !watching) player.time += vdt;     // on in a hole, too
  if (free) {
    if (player.next === field.order.length) {
      if (stickers.reached(player.pos)) finish();
    } else {
      const s = stickers.touched(player.pos);
      if (s?.emoji.listed === player.next) take(s);
      else if (s && player.safe <= 0) hit(s);
    }
  }
  if (!watching) {
    scores.recorder.step();
    scores.update();
  }
  // won, the prize floats over Mnot's head, a little behind it, where the camera in front sees both
  if (player.done) stickers.hold(_peak.copy(player.pos).addScaledVector(ahead(player.yaw, _to), -0.9).setY(2.4));
  player.safe -= vdt;
  player.dizzy = Math.max(0, player.dizzy - vdt);
  input.pressed.clear();
  title.update(dt);                               // on the title, Mnot's act is the title's (title.js)
  mnot.root.rotation.y = player.yaw;
  pose(vdt, sideways);
  mnot.animator.update(vdt);
  dizzy.update(vdt, player.pos, player.out ? 0 : player.dizzy);
  stickers.update(vdt, camera, player.pos, field.emojis[field.order[player.next]],
    THREE.MathUtils.smoothstep(follow.peek, 0.2, 0.9));
  for (const a of world.animated) a.update(vdt);
  placeCamera(vdt);
  title.place(dt);
  stage.aimSun(field.middle);
  scenery.update(camera, time);
  toast.update(vdt);
  const still = vdt === 0;                        // a watched run, paused
  sfx.update(dt, { speed: still ? 0 : player.vel.length(), skid: still ? 0 : sideways,
    braking: !still && want.brake > 0, dizzy: player.dizzy, peek: follow.peek });
  if (racing) {
    replays.update(dt, { gameTime: player.time, titleVisible: title.visible });
    ghost?.update(dt);
  }
  hud.time.textContent = clock(player.time);
}

deal();
placeCamera(0, true);
if (!manual && !watching) title.show();
if (!replayRoute && !manual && params.has('hall')) scores.board?.openHall();   // back from a replay (controller.js)
step(1 / 60);
warmUp(scene, render);
render();
startLoop({ manual, post, step, render });
replays?.load();

// for debugging and tests
expose('emoji', { THREE, renderer, scene, camera, post, stage, mnot, player, sounds, input, title, pad, padMenu,
  level, puffs, stickers, cracks, teeter, follow, sfx, music, dizzy, get field() { return field; },
  get seed() { return seed; },
  get counted() { return counted; }, board, scores, replays, get watch() { return watch; },
  get ghost() { return ghost; }, deal, restart, toThePeak,
  // past the title as a key would be, if it's up
  autopilot(on = true) { autopilot = on; if (title.visible) title.start(); else begin(); } }, { step, render });
if (perf) import('./perf.js').then(m => m.probe(window.emoji));
