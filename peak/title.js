// The title screen: PEAK MNOT over a slow cinematic drift round base camp and up the route, Mnot facing the camera,
// waving now and then and fidgeting in between. It never stands in the way: a movement key or Space starts the
// climb on the very frame it's read, and a click or drag on the scene, the Start button or any other key start it
// too (those last two with a goodbye wave). However it starts, the camera glides from the title shot into the live
// follow camera, riding along as Mnot sets off, while the title slides away and the HUD fades in. A shot is an orbit
// round Mnot (an angle off its front, a distance, a height and a look point up the route), and shots, and the glide,
// blend in those terms, so the camera swings round rather than cutting through. peak/title.css styles it; peak.html
// holds its #title-screen.
// Events: on('show') as it comes up, on('start', { how }) as the climb begins. While it's up, `visible` is true and
// body has the class `title-up`. game.time starts again from 0 at the start. ?manual never shows it (main.js), and
// nothing brings it back after a respawn.
import * as THREE from 'three';

const TIPS = [
  'Tip: the mountain is 4,810 m. We rounded. Badly.',
  'Tip: right always means onwards, even round corners. We argued about that for a whole episode.',
  'Tip: loose ledges are like legacy code. Don\'t stand on them for long.',
  'Tip: ice has the grip of a Friday-afternoon deploy. Careful steps help.',
  'Tip: one dent is a feature. Four dents is a pancake.',
  'Tip: the wind gaps blow on a steady beat. Count along, like a proper nerd.',
  'Tip: the gondola waits 1.8 s at each end. We measured. Twice.',
  'Tip: on the rope, lean against the wobble. It\'s only an inverted pendulum. How hard can it be?',
  'Tip: a falling rock\'s shadow grows before the rock arrives. Physics is polite like that.',
  'Tip: the checkpoint flags pop the dents out. Don\'t ask how. We don\'t know either.',
  'Tip: careful steps stop at the edge. Gravity doesn\'t do refunds.',
  'Tip: Mnot can\'t take its glasses off. We checked the rig.',
  'Tip: this tip was peer-reviewed by a soda can.',
];
const TIP_TIME = 6.5;

// Orbit shots round Mnot: deg off its front (negative is the route's right, where the follow camera stands), dist and
// h in metres, and the look point `ahead` metres the way Mnot faces and `up` metres high. Each drifts from a to b
// over its whole time on screen, blends included.
const SHOTS = [
  { hold: 8, a: { deg: -22, dist: 4.6, h: 1.3, ahead: 0, up: 0.82 },         // close on the glasses, swinging round
    b: { deg: 14, dist: 4.0, h: 1.15, ahead: 0, up: 0.8 } },
  { hold: 7, a: { deg: -38, dist: 7.0, h: 2.3, ahead: 1.3, up: 1.3 },        // base camp, the route going on
    b: { deg: -52, dist: 7.8, h: 2.8, ahead: 1.8, up: 1.5 } },
  { hold: 6, a: { deg: -99, dist: 5.0, h: 3.0, ahead: 15, up: 3.2 },         // up the cliff at the climb ahead
    b: { deg: -92, dist: 5.3, h: 3.9, ahead: 17, up: 4.6 } },
];
const BLEND = 3;                                   // seconds from one shot into the next
const ROUND = SHOTS.reduce((sum, s) => sum + s.hold + BLEND, 0);
// Mnot's show, in seconds into each round: a wave at the camera, fidgets in between, and a look up at the climb just
// before the camera follows its gaze. [at, clip, seconds] (a one-shot plays its whole length).
const ACTS = [[0.8, 'Wave', 3.2], [5.6, 'PushGlasses'], [9.4, 'Wave', 2.4], [13, 'TapFoot'], [16.1, 'LookUp']];
const MOVES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
// keys that never start the climb: sound, focus, closing a panel, modifiers
const QUIET = new Set(['KeyM', 'Tab', 'Escape', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft',
  'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'ContextMenu']);
const GLIDE = 1.5;                                 // seconds from the title shot into the follow camera
const GLIDE_LOOK = 0.5;                            // ... of which the look point takes this part, to find Mnot early
const BYE = 1.4;                                   // seconds of waving goodbye after Start or a key

const lerpShot = (a, b, k) => Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * k]));
const ease = k => THREE.MathUtils.smootherstep(k, 0, 1);

export class Title {
  constructor({ camera, follow, dom, player, game, input }) {
    Object.assign(this, { camera, follow, player, game, input });
    this.visible = false;
    this.time = 0;
    this.glide = null;          // gliding into the follow camera after the start
    this.bye = 0;               // seconds of waving goodbye left
    this.shotPos = new THREE.Vector3();
    this.shotLook = new THREE.Vector3();
    this.tip = { index: 0, clock: 0 };
    this.listeners = new Map();
    this.el = document.getElementById('title-screen');
    if (!this.el) return;
    const $ = id => document.getElementById(id);
    this.tipEl = $('title-tip');
    this.howto = $('title-howto');
    this.help = $('title-help');
    this.sound = $('title-sound');
    // the logo's letters each bob on their own, with a snow cap drawn from data-l
    const logo = this.el.querySelector('.ts-logo');
    if (logo) {
      const text = logo.textContent.trim().toUpperCase();
      logo.setAttribute('aria-label', logo.textContent.trim());
      logo.textContent = '';
      [...text].forEach((ch, i) => {
        const span = document.createElement('span');
        span.setAttribute('aria-hidden', 'true');
        if (ch === ' ') span.className = 'gap';
        else {
          Object.assign(span, { className: 'l', textContent: ch });
          span.dataset.l = ch;
        }
        span.style.setProperty('--i', i);
        logo.append(span);
      });
    }
    $('title-start')?.addEventListener('click', () => this.start('button'));
    this.help?.addEventListener('click', () => this.showHelp(this.howto.hidden));
    this.sound?.addEventListener('click', () => document.getElementById('sound')?.click());
    // buttons keep the focus away, so the keys keep going to the game
    for (const b of this.el.querySelectorAll('button')) b.addEventListener('mousedown', e => e.preventDefault());
    dom.addEventListener('pointerdown', () => this.start('pointer'));
    addEventListener('keydown', e => this.key(e));
  }

  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(fn); }
  emit(name, data) { for (const fn of this.listeners.get(name) ?? []) fn(data); }

  // True while the title or its send-off drives Mnot's clip and the camera.
  get busy() { return this.visible || this.bye > 0 || this.glide !== null; }

  show() {
    if (this.visible || !this.el) return;
    this.visible = true;
    this.time = 0;
    this.tip = { index: 0, clock: 0 };
    if (this.tipEl) this.tipEl.textContent = TIPS[0];
    this.syncSound();
    document.body.classList.add('title-up');
    this.el.hidden = false;
    this.el.classList.remove('leaving');
    this.shoot();
    this.emit('show');
  }

  // how: 'move' (a movement key or Space, read this frame), 'pointer', 'key' or 'button'.
  start(how = 'key') {
    if (!this.visible) return;
    this.visible = false;
    this.game.time = 0;
    this.showHelp(false);
    if (this.el.contains(document.activeElement)) document.activeElement.blur();
    document.body.classList.remove('title-up');
    document.body.classList.add('title-out');        // the HUD fades in (title.css)
    this.el.classList.add('leaving');
    setTimeout(() => {
      document.body.classList.remove('title-out');
      if (!this.visible) this.el.hidden = true;
    }, 700);
    // the shot as where the camera stands round the follow camera's target (Mnot), and where it looks
    const anchor = this.follow.target.clone();
    this.glide = { t: 0, anchor, look: this.shotLook.clone(),
      from: new THREE.Spherical().setFromVector3(this.shotPos.clone().sub(anchor)) };
    this.bye = how === 'key' || how === 'button' ? BYE : 0;
    this.player.idleClip = this.bye > 0 && this.player.anim.has('Wave') ? 'Wave' : null;
    this.emit('start', { how });
  }

  // Call once per step, after the follow camera has placed itself.
  update(dt, intent) {
    const moved = intent.move.lengthSq() > 0 || intent.jump;
    if (this.visible && moved) this.start('move');
    if (this.visible) {
      this.time += dt;
      this.direct();
      this.shoot();
      this.rotateTips(dt);
      this.syncSound();
      return;
    }
    if (this.bye > 0) {
      this.bye -= dt;
      if (this.bye <= 0 || moved) { this.bye = 0; this.player.idleClip = null; }
    }
    if (this.glide) this.glideOn(dt);
  }

  // From the title shot into wherever the follow camera has put itself this frame (Mnot is on the move already). The
  // camera swings round Mnot (the follow camera's target), closing in or backing off, while its look point slides
  // across, sooner (so a shot up the cliff comes down to Mnot early on). The title shot rides along with the target,
  // so Mnot never runs out of it. Smootherstep starts and ends the glide at rest relative to either shot; the follow
  // camera keeps its own field of view, so that doesn't change.
  glideOn(dt) {
    const g = this.glide, cam = this.camera, target = this.follow.target, u = (g.t += dt) / GLIDE, k = ease(u);
    // the follow camera's look point: on its line of sight, as far off as its target (which it is, but in a fall)
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = cam.position.clone().addScaledVector(ahead, cam.position.distanceTo(target));
    const look = g.look.clone().add(target).sub(g.anchor).lerp(to, ease(Math.min(1, u / GLIDE_LOOK)));
    const orbit = new THREE.Spherical().setFromVector3(cam.position.clone().sub(target)), from = g.from;
    const turn = orbit.theta - from.theta;
    orbit.set(from.radius + (orbit.radius - from.radius) * k, from.phi + (orbit.phi - from.phi) * k,
      from.theta + Math.atan2(Math.sin(turn), Math.cos(turn)) * k);
    cam.position.setFromSpherical(orbit).add(target);
    cam.lookAt(look);
    if (g.t >= GLIDE) this.glide = null;
  }

  // Mnot's act for this moment of the round, as the clip it stands about in.
  direct() {
    const t = this.time % ROUND, anim = this.player.anim;
    let clip = null;
    for (const [at, name, hold] of ACTS) {
      const length = hold ?? anim.actions.get(name)?.getClip().duration ?? 0;
      if (t >= at && t < at + length && anim.has(name)) clip = name;
    }
    this.player.idleClip = clip;
  }

  // The camera on this moment's shot, blended into the next one at the end.
  shoot() {
    const p = this.player, t = this.time % ROUND;
    let start = 0, shot = null;
    SHOTS.forEach((s, i) => {
      if (shot || t >= start + s.hold + BLEND) { start += s.hold + BLEND; return; }
      const local = t - start, drift = (s, u) => lerpShot(s.a, s.b, (u + BLEND) / (s.hold + 2 * BLEND));
      shot = drift(s, local);
      if (local > s.hold) {
        const next = SHOTS[(i + 1) % SHOTS.length];
        shot = lerpShot(shot, drift(next, local - s.hold - BLEND), ease((local - s.hold) / BLEND));
      }
    });
    const front = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const side = new THREE.Vector3(front.z, 0, -front.x);
    const a = THREE.MathUtils.degToRad(shot.deg);
    this.camera.position.copy(p.pos).addScaledVector(front, Math.cos(a) * shot.dist)
      .addScaledVector(side, Math.sin(a) * shot.dist).y += shot.h;
    const look = p.pos.clone().addScaledVector(front, shot.ahead);
    look.y += shot.up;
    this.camera.lookAt(look);
    this.shotPos.copy(this.camera.position);
    this.shotLook.copy(look);
  }

  rotateTips(dt) {
    const tip = this.tip;
    if (!this.tipEl || (tip.clock += dt) < TIP_TIME) return;
    if (!this.tipEl.classList.contains('swap')) this.tipEl.classList.add('swap');
    if (tip.clock < TIP_TIME + 0.4) return;
    tip.index = (tip.index + 1) % TIPS.length;
    tip.clock = 0;
    this.tipEl.textContent = TIPS[tip.index];
    this.tipEl.classList.remove('swap');
  }

  showHelp(open) {
    if (!this.howto) return;
    this.howto.hidden = !open;
    this.help?.setAttribute('aria-expanded', String(open));
  }

  // the title's sound button mirrors the HUD's, which audio.js keeps
  syncSound() {
    const hud = document.getElementById('sound');
    if (!this.sound || !hud) return;
    if (this.sound.textContent !== hud.textContent) this.sound.textContent = hud.textContent;
    const pressed = hud.getAttribute('aria-pressed') ?? 'true';
    if (this.sound.getAttribute('aria-pressed') !== pressed) this.sound.setAttribute('aria-pressed', pressed);
  }

  // Any key starts the climb, except the quiet ones. Movement and Space start it through the game's own input on
  // the next step, so they move Mnot on that same frame; on a focused title button they're handed on to the input.
  key(e) {
    if (!this.visible || e.ctrlKey || e.metaKey || e.altKey || QUIET.has(e.code)) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (MOVES.has(e.code)) {
      if (e.target.closest?.('button')) {
        e.preventDefault();
        e.target.blur();
        if (!e.repeat) this.input.key(e.code, true);
      }
      return;
    }
    if (document.querySelector('.sc-panel.open')) return;            // the Hall of Fame is open
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target.closest?.('button')) return;   // clicks it
    e.preventDefault();
    this.start('key');
  }
}
