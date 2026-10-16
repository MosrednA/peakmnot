// Reaction Run's tab in the viewer (index.html#emoji, peak/viewer/tabs.js): Mnot in the studio among the game's emoji
// tokens, in the game's look, to try what the game adds one move at a time: running laps past the tokens (the next on
// the list hops, the others lean back out of reach), fetching the next one, one touched too early (it pops back), a
// wrong one (it warps away and Mnot sees stars), the third wrong one (over backwards, flat on its back), a bonk into
// a snow wall, the snow giving way into a hole and the hop out, the title's acts, and the finale: every other token
// twisting away, :peak-mnot: dropping in its beam and held up over Mnot's head for the dance. The tokens, the stars,
// the sounds and the tune are the game's own (stickers.js, dizzy.js, sfx.js, music.js); Mnot's moves are main.js's,
// with its numbers, on a flat floor with no walls or field.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage } from '../kit/stage.js';
import { warmUp } from '../kit/warmup.js';
import { confetti } from '../kit/party.js';
import { toon } from '../look/look.js';
import { bursts } from '../look/bursts.js';
import { loadMnot } from '../mnot/mnot.js';
import { Stickers, loadSheet } from './stickers.js';
import { SHEET } from './sheet.js';
import { Dizzy } from './dizzy.js';
import { EmojiSfx } from './sfx.js';
import { EmojiMusic } from './music.js';

const PEAK = 'peak-mnot';
// The tokens: COUNT of the sheet's, spread over it, the list in their order, on an arc round the far side of the
// floor from the camera (m round, radians across, the way its middle lies from the floor's middle)
const COUNT = 7;
const ARC = { radius: 3.9, across: 2, toward: Math.atan2(-0.45, -0.9) };
const LAP = { radius: 1.6, speed: 3.8 };          // the laps round the floor's middle: m round, m/s
// as main.js's: running (top m/s, turn radians a second, steer, grip, glide and brake a second), a bonk's bounce and
// reel, a wrong one's bump, reel and stars, the snow holding (s) and the hole (sink m, down, stay, out s, hop m)
const RUN = { top: 4.2, turn: 2.7, steer: 9, grip: 3, glide: 1.1, brake: 6 };
const BONK = { bounce: 0.45, from: 1.3, reel: 0.55, spin: 0.35, speed: 3.2 };
const HIT = { bump: 3.4, reel: 0.5, dizzy: 2.4 };
const CRACK = 0.5;
const PIT = { sink: 0.85, down: 0.22, stay: 0.75, out: 0.45, hop: 0.9, dizzy: 1.2 };
const SKID = 1.4;
// the finale: s after the sweep the prize drops (it falls for PRIZE.fall more), m to Mnot's side it lands, s after
// it lands that Mnot has it
const FINALE = { drop: 0.2, side: 1.5, win: 0.35 };
const ACTS = { PushGlasses: null, Wave: 2.4 };    // the title's acts, s (null: the clip's length)
const NAMES = SHEET.names.filter(name => name !== PEAK);
const turn = a => Math.atan2(Math.sin(a), Math.cos(a));
const ahead = (yaw, to = new THREE.Vector3()) => to.set(Math.sin(yaw), 0, Math.cos(yaw));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _peak = new THREE.Vector3();

// The tab: its own canvas and buttons in a section of the page. sounds: the viewer's, for its Sound switch.
export async function createTab({ sounds }) {
  const section = document.createElement('section');
  section.hidden = true;
  section.innerHTML = `
    <div class="info"><b>Reaction Run</b> · Mnot among the thread's emoji, in the game's look<br>W to run laps ·
      S to stop · F to fetch the next one · X for a wrong one · B to bonk · H for a hole · P for the finale ·
      E to wave · M to mute · drag to orbit</div>
    <div class="ui">
      <div class="group" role="group" aria-label="Run"><button data-do="stand">Stand</button><button
        data-do="laps">Run laps</button><button data-do="stop">Stop</button></div>
      <div class="group" role="group" aria-label="Emoji"><button data-do="fetch">Fetch next</button><button
        data-do="early">Too early</button><button data-do="wrong">Wrong one</button><button
        data-do="out">Out</button></div>
      <div class="group" role="group" aria-label="Snow"><button data-do="bonk">Bonk</button><button
        data-do="hole">Hole</button></div>
      <div class="group" role="group" aria-label="Acts"><button data-act="PushGlasses">Push glasses</button><button
        data-act="Wave">Wave</button></div>
      <div class="group"><button data-do="finale">Finale</button></div>
      <div class="group"><button data-do="sound">Sound on</button></div>
    </div>`;
  document.body.appendChild(section);

  const stage = createStage({ fov: 38, shadow: { half: 6, near: 0.5, far: 40, bias: -0.0005, back: 12 } });
  const { renderer, scene, camera, post, render } = stage;
  section.prepend(renderer.domElement);
  // the studio: the Mnot tab's dark floor and grid, in the game's light
  scene.background = new THREE.Color('#20242b');
  scene.fog = new THREE.Fog('#20242b', 10, 26);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    toon('#2b3139', { outline: false }));
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(80, 80, '#3b434d', '#343b44');
  grid.position.y = 0.002;
  grid.material.userData.outlineParameters = { visible: false };
  scene.add(floor, grid);
  // the hole the snow gives way into: dark, on the floor, which hides what of Mnot is down in it
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40).rotateX(-Math.PI / 2),
    toon('#0c0e12', { outline: false }));
  hole.visible = false;
  hole.name = 'the hole';
  scene.add(hole);
  const world = { group: new THREE.Group(), animated: [], ground: () => ({ top: 0 }) };
  scene.add(world.group);
  const puffs = bursts(world);

  const [mnot, sheet] = await Promise.all([loadMnot(), loadSheet(renderer)]);
  scene.add(mnot.root);
  const stickers = new Stickers(sheet);
  scene.add(stickers.group);
  const dizzy = new Dizzy();
  scene.add(dizzy.group);
  const sfx = new EmojiSfx(sounds);
  const music = new EmojiMusic(sounds);

  // far enough back for the prize held up over Mnot's head
  camera.position.set(2.5, 2, 5.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.05, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 1.5;
  controls.maxDistance = 14;

  // Mnot as main.js's player: where it is and faces, how fast it turns, and what's happening to it (reel: s left
  // reeling; wobble: the squash and how long ago; dizzy: s of stars left; fall: s since it went over, out; pit: in a
  // hole; aim: the way its feet turn it, standing; finale: from the list done, done: the prize won)
  const player = { pos: mnot.root.position, vel: new THREE.Vector3(), yaw: 0.4, spin: 0, laps: false, braking: false,
    reel: 0, wobble: { amp: 0, t: 0 }, dizzy: 0, out: false, fall: 0, pit: null, finale: false, done: false,
    aim: null, next: 0 };
  let time = 0, act = null, actLeft = 0, cracking = 0, winAt = null, holeOpen = 0, shown = false, idle = true;
  let skidClock = 0, deals = 0;

  // ------------------------------------------------------------------ the emojis

  // a fresh set of tokens on the arc, a different handful of the sheet's each time
  function deal() {
    const step = Math.floor(NAMES.length / COUNT), from = deals++ % step;
    const emojis = Array.from({ length: COUNT }, (_, i) => {
      const a = ARC.toward + ARC.across * (i / (COUNT - 1) - 0.5);
      return { name: NAMES[from + i * step], at: new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
        .multiplyScalar(ARC.radius), listed: i, taken: false };
    });
    stickers.set(emojis);
    player.next = 0;
    winAt = null;
  }
  const standing = s => !s.emoji.taken && !s.how;
  const next = () => stickers.list[player.next];
  // the one nearest Mnot of those `fits`, dealing a fresh set when there's none left
  function nearest(fits) {
    for (let k = 0; k < 2; k++) {
      let best = null, d = Infinity;
      for (const s of stickers.list) {
        const far = s.emoji.at.distanceTo(player.pos);
        if (standing(s) && fits(s) && far < d) { best = s; d = far; }
      }
      if (best) return best;
      deal();
    }
    return null;
  }
  // past the ones gone (warped away, or taken)
  function skipGone() {
    while (player.next < COUNT && next().emoji.taken) player.next++;
  }

  // ------------------------------------------------------------------ what the buttons and keys do

  // out, in a hole or at the finale: back on its feet where it is, every token back, the tune stopped
  function recover() {
    if (!player.finale && !player.out && !player.pit && !cracking) return false;
    const m = mnot.model;
    m.position.y = 0;
    m.rotation.set(0, 0, 0);
    Object.assign(player, { finale: false, done: false, out: false, pit: null, fall: 0, dizzy: 0, reel: 0 });
    cracking = 0;
    mnot.animator.play('Idle', 0.25);
    music.reset();
    deal();
    return true;
  }
  // the feet turn Mnot round to the camera, as for a photo
  function faceCamera() {
    player.laps = false;
    player.aim = Math.atan2(camera.position.x - player.pos.x, camera.position.z - player.pos.z);
  }
  function fetch() {
    recover();
    skipGone();
    const s = next();
    if (!s) return deal();
    stickers.go(s, 'taken');
    puffs.snow(s.emoji.at, { puffs: 5, flakes: 10, up: 1.2 });
    sounds.play('land-soft');
    player.next++;
    sfx.cue({ type: 'take', n: player.next, of: COUNT });
    skipGone();
    if (player.next >= COUNT) finale();
  }
  // a wrong one touched (or a listed one too early): it warps away (or pops back in a moment), and Mnot bumps back
  // off it, reeling, seeing stars; running laps, it runs on once it's over the reel (as with W held in the game),
  // else it stops
  function touch(early) {
    recover();
    const s = nearest(t => early ? t.emoji.listed > player.next : t !== next());
    if (!s) return;
    stickers.go(s, early ? 'blinked' : 'warped');
    puffs.poof(_a.copy(s.emoji.at).setY(1), { size: 0.3, count: 8 });
    _a.set(player.pos.x - s.emoji.at.x, 0, player.pos.z - s.emoji.at.z);
    if (_a.lengthSq() < 1e-6) ahead(player.yaw, _a).negate();
    player.vel.copy(_a.normalize()).multiplyScalar(HIT.bump);
    player.spin += (Math.random() < 0.5 ? -1 : 1) * 2.2;
    Object.assign(player, { aim: null, braking: !player.laps, reel: HIT.reel, dizzy: HIT.dizzy });
    Object.assign(player.wobble, { amp: 0.3, t: 0 });
    sfx.cue({ type: early ? 'early' : 'wrong', lives: 2 });
    sounds.play('land-soft');
  }
  // the third: the token swells and shakes, and Mnot slips and goes over flat on its back, sliding on
  function out() {
    recover();
    const s = nearest(t => t !== next());
    if (s) stickers.go(s, 'wrong');
    Object.assign(player, { out: true, fall: 0, dizzy: 0, laps: false, aim: null });
    act = null;
    mnot.animator.play('Fall', 0.1);
    sfx.cue({ type: 'out' });
  }
  // into a snow wall straight ahead, at least at a good jog: bounced back, squashed, reeling and spun a little
  function bonk() {
    recover();
    const into = Math.max(BONK.speed, player.vel.dot(ahead(player.yaw, _a)));
    const hard = THREE.MathUtils.clamp((into - BONK.from) / (RUN.top - BONK.from), 0, 1);
    player.vel.copy(_a).multiplyScalar(-into * BONK.bounce);
    player.spin += (Math.random() < 0.5 ? -1 : 1) * into * BONK.spin;
    Object.assign(player, { aim: null, braking: !player.laps, reel: BONK.reel * (0.4 + 0.6 * hard) });
    Object.assign(player.wobble, { amp: 0.12 + 0.2 * hard, t: 0 });
    puffs.snow(_b.copy(player.pos).addScaledVector(_a, 0.38).setY(0.4), { puffs: 3 + 3 * hard, flakes: 8, up: 0.8 });
    sounds.play(hard > 0.5 ? 'land-hard' : 'land-soft');
    sfx.cue({ type: 'bonk', speed: into, hard });
  }
  // a cracked passage: the snow creaks under Mnot, holds a moment, then gives way (fallIn())
  function crack() {
    recover();
    player.braking = !player.laps;
    Object.assign(player.wobble, { amp: 0.08, t: 0 });
    cracking = CRACK;
    sfx.cue({ type: 'crack' });
  }
  function fallIn() {
    player.pit = { t: 0, at: player.pos.clone(), to: player.pos.clone().addScaledVector(ahead(player.yaw, _a), 0.9),
      hop: false };
    player.vel.set(0, 0, 0);
    Object.assign(player, { reel: 0, dizzy: 0, spin: 0, aim: null });
    hole.position.copy(player.pos).setY(0.006);
    holeOpen = 1e-6;
    puffs.snow(player.pos, { puffs: 6, flakes: 14, up: 1.1 });
    sounds.play('land-soft');
    sfx.cue({ type: 'hole', under: true, finale: false });
    sfx.cue({ type: 'pit', fresh: true });
  }
  // In the hole, as main.js's climb(): dropping in up to its glasses, flailing, then a hop out ahead, dizzy.
  function climb(dt) {
    const p = player.pit, m = mnot.model, { sink, down, stay } = PIT;
    p.t += dt;
    if (p.t < down + stay) {
      const k = Math.min(1, p.t / down);
      m.position.y = -sink * k * k + (p.t > down ? 0.06 * Math.sin((p.t - down) * 13) : 0);
      return;
    }
    if (!p.hop) {
      p.hop = true;
      sounds.play('jump');
    }
    const k = Math.min(1, (p.t - down - stay) / PIT.out);
    m.position.y = -sink * (1 - k) + PIT.hop * 4 * k * (1 - k);
    player.pos.lerpVectors(p.at, p.to, k);
    if (k < 1) return;
    player.pit = null;
    m.position.y = 0;
    Object.assign(player, { dizzy: PIT.dizzy, reel: 0.25 });
    Object.assign(player.wobble, { amp: 0.28, t: 0 });
    puffs.snow(player.pos, { puffs: 4, flakes: 8, up: 0.7 });
    sounds.play('land-soft');
    sfx.cue({ type: 'climb' });
  }
  // The list done: every token still standing twists away from Mnot outwards, :peak-mnot: drops beside Mnot with a
  // bump, in its beam, and Mnot flails a moment; then it's Mnot's, held up over its head for the dance.
  function finale() {
    recover();
    player.finale = true;
    faceCamera();
    stickers.sweep(player.pos);
    const side = _a.set(Math.cos(player.aim), 0, -Math.sin(player.aim)).multiplyScalar(FINALE.side);
    const at = player.pos.clone().add(side).setY(0);
    stickers.drop(PEAK, at, FINALE.drop, () => {
      puffs.snow(at, { puffs: 8, flakes: 18, up: 1.4 });
      sounds.play('land-hard');
      sfx.cue({ type: 'peak' });
      winAt = time + FINALE.win;
    });
    player.reel = FINALE.drop + 0.6;
    Object.assign(player.wobble, { amp: 0.2, t: 0 });
    sfx.cue({ type: 'clear' });
  }
  function win() {
    winAt = null;
    player.done = true;
    act = null;
    sounds.play('wave');
    confetti(puffs, player.pos);
    mnot.animator.play('Dance', 0.3);
    sfx.cue({ type: 'finish' });
    music.start();
    music.finish();
  }
  const DO = {
    stand: () => { if (!recover()) deal(); faceCamera(); player.braking = true; },
    laps: () => { recover(); Object.assign(player, { laps: true, braking: false, aim: null }); },
    stop: () => { Object.assign(player, { laps: false, braking: true }); },
    fetch, early: () => touch(true), wrong: () => touch(false), out, bonk, hole: crack,
    finale: () => { if (player.finale) DO.stand(); else finale(); },
    sound: () => { sounds.setEnabled(!sounds.enabled); refresh(); },
  };
  function play(name) {
    recover();
    if (!player.laps) faceCamera();
    act = name;
    actLeft = ACTS[name] ?? mnot.animator.actions.get(name)?.getClip().duration ?? 2;
    mnot.animator.play(name, 0.2, { restart: true });
  }
  section.querySelectorAll('[data-do]').forEach(b => { b.onclick = () => { DO[b.dataset.do](); refresh(); }; });
  section.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => { play(b.dataset.act); refresh(); }; });
  const button = name => section.querySelector(`[data-do="${name}"]`);
  function refresh() {
    const busy = player.finale || player.out;
    button('stand').classList.toggle('on', !player.laps && !busy && !player.braking);
    button('laps').classList.toggle('on', player.laps);
    button('stop').classList.toggle('on', player.braking);
    button('out').classList.toggle('on', player.out);
    button('finale').classList.toggle('on', player.finale);
    for (const b of section.querySelectorAll('[data-act]')) b.classList.toggle('on', b.dataset.act === act);
    button('sound').textContent = sounds.enabled ? 'Sound on' : 'Sound off';
    button('sound').setAttribute('aria-pressed', String(sounds.enabled));
  }

  const KEYS = { KeyW: 'laps', KeyS: 'stop', KeyF: 'fetch', KeyX: 'wrong', KeyB: 'bonk', KeyH: 'hole', KeyP: 'finale',
    KeyM: 'sound' };
  addEventListener('keydown', e => {
    if (!shown || !(e.code in KEYS || e.code === 'KeyE') || e.ctrlKey || e.metaKey || e.altKey
      || e.target.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
    e.preventDefault();
    if (e.isTrusted) void sounds.unlock();
    if (e.repeat) return;
    if (e.code === 'KeyE') play('Wave');
    else DO[KEYS[e.code]]();
    refresh();
  });

  // ------------------------------------------------------------------ the frame

  // as main.js's slide(): the spin easing to what's asked, the speed following where Mnot faces only slowly
  function slide(dt) {
    let steer = 0, throttle = 0;
    const free = !player.out && !player.finale && !player.pit && player.reel <= 0;
    if (free && player.laps) {
      // round the floor's middle, pulled back onto the circle
      const r = Math.hypot(player.pos.x, player.pos.z);
      if (r > 0.05) {
        _b.set(player.pos.z, 0, -player.pos.x).divideScalar(r);
        _b.addScaledVector(_c.set(player.pos.x, 0, player.pos.z).divideScalar(r),
          THREE.MathUtils.clamp((LAP.radius - r) * 2.5, -1.5, 1.5));
      } else ahead(player.yaw, _b);
      steer = THREE.MathUtils.clamp(turn(Math.atan2(_b.x, _b.z) - player.yaw) * 4 / RUN.turn, -1, 1);
      throttle = LAP.speed / RUN.top;
    } else if (player.aim !== null && !player.out && !player.pit) {
      // turning on the spot (even reeling, or dancing), to face the camera
      steer = THREE.MathUtils.clamp(turn(player.aim - player.yaw) * 3 / RUN.turn, -1, 1);
      if (Math.abs(turn(player.aim - player.yaw)) < 0.02) player.aim = null;
    }
    // as main.js's: braking (S, or Stop) stops it; reeling, it slows; out, it slides on on its back
    const brake = free ? (player.braking ? 1 : 0)
      : player.out ? 0 : player.done ? 0.4 : player.reel > 0 ? 0.3 : 0.6;
    player.spin += (steer * RUN.turn - player.spin) * (1 - Math.exp(-RUN.steer * dt));
    player.yaw += player.spin * dt;
    ahead(player.yaw, _a);
    _b.copy(_a).multiplyScalar(RUN.top * throttle);
    const grip = throttle > 0 ? RUN.grip : brake > 0 ? RUN.brake * brake : RUN.glide;
    player.vel.lerp(_b, 1 - Math.exp(-grip * dt));
    if (player.pit) player.vel.set(0, 0, 0);
    if (player.braking && player.vel.length() < 0.05) player.braking = false;
    player.pos.addScaledVector(player.vel, dt);
    // snow spraying from the feet in a skid or a hard brake, as in the game
    const sideways = Math.abs(_c.set(_a.z, 0, -_a.x).dot(player.vel));
    skidClock -= dt;
    if ((sideways > SKID || (brake > 0 && player.vel.length() > 1.5) || player.out) && player.vel.length() > 1
      && skidClock <= 0) {
      skidClock = 0.07;
      puffs.snow(_c.copy(player.pos).addScaledVector(player.vel, -0.12), { puffs: 1, flakes: 2, size: 0.55, up: 0.35,
        spread: 0.25 });
    }
    return { sideways, braking: brake > 0 };
  }

  // Mnot's pose on top of the clip, as main.js's pose(): leaning into a turn, swaying with stars, squashed by a bonk,
  // going over when out.
  function pose(dt, sideways) {
    const m = mnot.model, speed = player.vel.length();
    const sway = 0.14 * Math.min(1, player.dizzy) * Math.sin(time * 6.5);
    const lean = player.out ? 0 : THREE.MathUtils.clamp(-player.spin * speed * 0.05, -0.32, 0.32) + sway;
    m.rotation.z += (lean - m.rotation.z) * (1 - Math.exp(-8 * dt));
    const w = player.wobble;
    w.t += dt;
    const s = w.amp * Math.exp(-w.t * 6) * Math.cos(w.t * 21);
    m.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    if (player.out) {
      const f = (player.fall += dt), k = Math.min(1, f / 0.42);
      const over = k * k * (Math.PI / 2 - 0.12)
        - (f > 0.42 ? 0.12 * Math.exp(-(f - 0.42) * 7) * Math.sin((f - 0.42) * 26) : 0);
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
    if (player.done || player.out || act) return;
    const along = Math.max(0, player.vel.dot(ahead(player.yaw, _a)));
    const anim = mnot.animator;
    if (player.pit || cracking > 0) return anim.play('Teeter', 0.1);
    if (player.reel > 0 || player.finale || (sideways > SKID * 1.3 && speed > 2) || (!player.laps && speed > 2.2)) {
      anim.play('Teeter', 0.12);
    } else if (along > 0.3) {
      anim.play(along > 2.4 ? 'Run' : 'Walk', 0.2);
      anim.setGaitSpeed(along, { Walk: mnot.rig.walk_speed, Run: mnot.rig.run_speed });
    } else anim.play('Idle', 0.25);
  }

  const before = new THREE.Vector3();
  function step(dt) {
    if (!(dt > 0)) return;
    time += dt;
    before.copy(player.pos);
    if (cracking > 0 && (cracking -= dt) <= 0) {
      cracking = 0;
      fallIn();
    }
    const { sideways, braking } = slide(dt);
    if (player.pit) climb(dt);
    if (winAt !== null && time >= winAt) { win(); refresh(); }
    if (act && (actLeft -= dt) <= 0) { act = null; refresh(); }
    // won, the prize floats over Mnot's head, a little behind it, as in the game
    if (player.done) stickers.hold(_peak.copy(player.pos).addScaledVector(ahead(player.yaw, _a), -0.9).setY(2.4));
    player.reel -= dt;
    player.dizzy = Math.max(0, player.dizzy - dt);
    mnot.root.rotation.y = player.yaw;
    pose(dt, sideways);
    mnot.animator.update(dt);
    dizzy.update(dt, player.pos, player.out ? 0 : player.dizzy);
    stickers.update(dt, camera, player.pos, next()?.emoji);
    // the hole opens at once and closes over the floor once Mnot is out of it
    holeOpen = player.pit ? Math.min(1, holeOpen + dt / 0.1) : Math.max(0, holeOpen - dt / 0.5);
    hole.visible = holeOpen > 0;
    hole.scale.setScalar(Math.max(0.001, holeOpen));
    for (const a of world.animated) a.update(dt);
    sfx.update(dt, { speed: player.vel.length(), skid: sideways, braking, dizzy: player.dizzy, peek: 0 });
    // the camera comes along with Mnot (as in the Mnot tab)
    const moved = _a.subVectors(player.pos, before);
    camera.position.add(moved);
    controls.target.add(moved);
    controls.update();
    stage.aimSun(_b.copy(player.pos).multiplyScalar(0.5));
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  function frame(timestamp) {
    if (!shown) { idle = true; return; }
    timer.update(timestamp);
    post.adapt(timer.getDelta());
    step(Math.min(timer.getDelta(), 0.05));
    render();
    requestAnimationFrame(frame);
  }

  deal();
  mnot.animator.play('Idle', 0);
  step(1 / 60);
  warmUp(scene, render);
  refresh();
  const tab = {
    show() {
      section.hidden = false;
      shown = true;
      refresh();
      if (idle) { idle = false; timer.reset(); requestAnimationFrame(frame); }
    },
    hide() {
      section.hidden = true;
      shown = false;
      recover();
      Object.assign(player, { laps: false, braking: false });
      player.vel.set(0, 0, 0);
      sfx.update(0, { speed: 0, skid: 0, braking: false, dizzy: 0, peek: 0 });
      refresh();
    },
  };
  // for debugging and tests
  window.emojiViewer = { THREE, renderer, scene, camera, player, stickers, dizzy, sfx, music, step, render,
    do: name => { DO[name](); refresh(); }, act: name => { play(name); refresh(); } };
  return tab;
}
