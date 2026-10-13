// The title screen, the climb's way (peak/ui/title.js, styled by the same peak/ui/title.css): MNOT DOWNHILL over one
// slow shot at the start. The chair stands with its back to the camera and swivels round, like a villain's, to Mnot,
// who pushes its glasses up now and then and waves; the camera creeps in, then sways gently from side to side, and
// the seat turns to keep facing it. Round the chair lies what it came in: the open box, the receipt, and the office
// plant and the water cooler, which came along to watch (props(), there for the whole game, beside the chair where
// it never goes). Nothing further down the mountain is shown: that's for the run. A key, a tap on the scene or Start
// rolls off, a movement key on the very frame it's read (main.js reads it as the run begins), and the camera glides
// into the chase camera. The HUD waits until the run starts (title.css hides it while body has the class
// `title-up`). The menu, the tips and How to play are downhill.html's #title-screen.
// main.js calls update(dt) before the chair is posed (it turns the seat and picks Mnot's act) and place(dt) after the
// chase camera has placed itself. Events: on('start', { how }). ?manual never shows it.
import * as THREE from 'three';
import { FEATURES } from './track.js';
import { cooler, ficus } from './office.js';
import { toon, RAMPS } from '../look/look.js';
import { painted, letter } from '../props/paint.js';

const TIPS = [
  'Tip: the chair cost €1,649. The mountain was free.',
  'Tip: the height lever is a jump button now. Facilities have not signed off on this.',
  'Tip: tuck in (W) for speed. Lumbar support is optional at 90 km/h.',
  'Tip: heels in the snow (S) to brake. The shoes are not in the warranty.',
  'Tip: five casters. Rocks take them, pit stops give them back. Nobody knows who pays.',
  'Tip: the box says THIS WAY UP. The chair is going the other way.',
  'Tip: snowmen are soft. Rocks are not. Pines don\'t do lumbar support either.',
  'Tip: chairs don\'t float. Remember that. You\'ll know when.',
  'Tip: some things on the way down take time off the clock. Knock them over. Fly far.',
  'Tip: smile on the way down. Someone might be taking pictures.',
  'Tip: a fall costs its time on the clock. The chair rolls back to the last pit stop, sulking.',
];
const TIP_TIME = 6.5;

// The shot, in the piste's metres from the chair: back up the slope (dist), swung to the right by an angle (radians),
// up from the snow (h), looking at Mnot. It creeps in over the first seconds, then sways and breathes, slowly.
const AT = FEATURES.pits[0];
const SHOT = { dist: 6.2, creep: 1.1, angle: 0.1, sway: 0.2, h: 1.3, look: 1, fov: 40 };
const SWIVEL = [0.7, 1.7];        // the seat's swing round to the camera: from, seconds
// Mnot's acts, again every CYCLE seconds: [at, clip, seconds] (a one-shot plays its whole length)
const ACTS = [[2.7, 'PushGlasses'], [7.4, 'Wave', 2.4]];
const CYCLE = 14;
const MOVES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'ShiftLeft', 'ShiftRight']);
// keys that never start the run: focus, closing a panel, modifiers
const QUIET = new Set(['Tab', 'Escape', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'ContextMenu']);
const GLIDE = 1.5;                // seconds from the title shot into the chase camera
const GLIDE_LOOK = 0.6;           // ... of which the look point takes this part, to find the chair early
const BYE = 1.3;                  // seconds of waving goodbye after Start or a key

const TAU = Math.PI * 2;
const ease = k => THREE.MathUtils.smootherstep(k, 0, 1);
// a swivel that swings a little past and settles back (an ease-out-back)
const swing = k => k >= 1 ? 1 : 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Title {
  constructor({ camera, chase, track, ride, rider, scene, dom }) {
    Object.assign(this, { camera, chase, track, ride, rider });
    scene.add(props(track));
    this.visible = false;
    this.time = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.glide = null;
    this.bye = 0;
    this.tip = { index: 0, clock: 0 };
    this.listeners = new Map();
    this.el = document.getElementById('title-screen');
    if (!this.el) return;
    const $ = id => document.getElementById(id);
    this.tipEl = $('title-tip');
    this.howto = $('title-howto');
    this.help = $('title-help');
    this.sound = $('title-sound');
    this.spell(this.el.querySelector('.ts-logo'));
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

  // The logo's letters, each bobbing on its own with a snow cap (title.css), word by word: the second word's letters
  // step down like a slope (--j, downhill.html).
  spell(logo) {
    if (!logo) return;
    const words = logo.textContent.trim().toUpperCase().split(/\s+/);
    logo.setAttribute('aria-label', logo.textContent.trim());
    logo.textContent = '';
    let i = 0;
    for (const word of words) {
      const w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      [...word].forEach((ch, j) => {
        const span = Object.assign(document.createElement('span'), { className: 'l', textContent: ch });
        span.dataset.l = ch;
        span.style.setProperty('--i', i++);
        span.style.setProperty('--j', j);
        w.append(span);
      });
      logo.append(w);
    }
  }

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
    this.frame();
  }

  // how: 'move' (a movement key, read this frame), 'pointer', 'key' or 'button'.
  start(how = 'key') {
    if (!this.visible) return;
    this.visible = false;
    this.showHelp(false);
    if (this.el.contains(document.activeElement)) document.activeElement.blur();
    document.body.classList.remove('title-up');
    document.body.classList.add('title-out');       // the HUD fades in (title.css)
    this.el.classList.add('leaving');
    setTimeout(() => {
      document.body.classList.remove('title-out');
      if (!this.visible) this.el.hidden = true;
    }, 700);
    // the shot rides along with the chair into the chase camera
    const at = this.ride.pos;
    this.glide = { t: 0, from: this.pos.clone().sub(at), look: this.look.clone().sub(at), fov: this.camera.fov };
    this.bye = how === 'key' || how === 'button' ? BYE : 0;
    this.rider.act = this.bye > 0 ? 'Wave' : null;
    this.ride.seatL = 0;
    this.emit('start', { how });
  }

  // Once a frame, before the chair is posed: the shot for this moment, the seat's turn and Mnot's act.
  update(dt) {
    if (this.visible) {
      this.time += dt;
      this.frame();
      this.rotateTips(dt);
      this.syncSound();
      return;
    }
    if (this.bye > 0 && (this.bye -= dt) <= 0) { this.bye = 0; this.rider.act = null; }
  }

  // Once a frame, after the chase camera has placed itself: the title's shot, or the glide out of it.
  place(dt) {
    const cam = this.camera;
    if (this.visible) {
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.lens(SHOT.fov);
      return;
    }
    const g = this.glide;
    if (!g) return;
    // from the title shot, riding along with the chair, into wherever the chase camera has put itself this frame
    const u = Math.min(1, (g.t += dt) / GLIDE), k = ease(u), at = this.ride.pos;
    const look = _a.copy(g.look).add(at).lerp(this.chase.look, ease(Math.min(1, u / GLIDE_LOOK)));
    cam.position.lerpVectors(_b.copy(g.from).add(at), cam.position, k);
    cam.lookAt(look);
    this.lens(g.fov + (this.chase.fov - g.fov) * k);
    if (u >= 1) this.glide = null;
  }

  lens(fov) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // The shot at this moment, the seat turned to it and Mnot's act. On a narrow screen the camera stands further
  // back, so the props stay in the picture.
  frame() {
    const t = this.time, ride = this.ride, at = ride.pos;
    const narrow = 1 - THREE.MathUtils.clamp(this.camera.aspect / 1.15, 0.4, 1);
    const dist = (SHOT.dist + SHOT.creep * (1 - ease(Math.min(1, t / 6))) + 0.25 * Math.sin(t * TAU / 31))
      * (1 + 0.6 * narrow);
    const angle = SHOT.angle + SHOT.sway * Math.sin(t * TAU / 23);
    const p = this.track.point(AT - dist * Math.cos(angle), dist * Math.sin(angle), this.pos);
    p.y += SHOT.h + 0.1 * Math.sin(t * TAU / 17);
    this.look.copy(at).setY(at.y + SHOT.look);
    // the seat: its back to the camera, swung round, then following it with a lazy sway
    const face = Math.atan2(p.x - at.x, p.z - at.z) + 0.07 * Math.sin(t * 0.8);
    ride.seatYaw = face + Math.PI * (1 - swing(THREE.MathUtils.clamp((t - SWIVEL[0]) / SWIVEL[1], 0, 1)));
    ride.seatL = 0;
    this.act(t % CYCLE);
  }

  act(t) {
    const anim = this.rider.mnot.animator;
    let clip = null;
    for (const [at, name, hold] of ACTS) {
      const length = hold ?? anim.actions.get(name)?.getClip().duration ?? 0;
      if (t >= at && t < at + length && anim.has(name)) clip = name;
    }
    this.rider.act = clip;
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

  // the title's sound button mirrors the HUD's
  syncSound() {
    const hud = document.getElementById('sound');
    if (!this.sound || !hud) return;
    const on = hud.getAttribute('aria-pressed') !== 'false', text = on ? 'Sound on' : 'Sound off';
    if (this.sound.textContent !== text) this.sound.textContent = text;
    if (this.sound.getAttribute('aria-pressed') !== String(on)) this.sound.setAttribute('aria-pressed', String(on));
  }

  // Any key starts the run, except the quiet ones; a movement key also steers on that same frame (main.js reads the
  // keys as the run begins). Enter on a focused title button clicks it instead.
  key(e) {
    if (!this.visible || e.ctrlKey || e.metaKey || e.altKey || QUIET.has(e.code)) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.sc-panel.open')) return;            // the keyboard stays in the Hall of Fame
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target.closest?.('button')) return;
    if (!MOVES.has(e.code)) e.preventDefault();
    this.start(MOVES.has(e.code) ? 'move' : 'key');
  }
}

// ------------------------------------------------------------------ the props at the start

const CARD = '#c99a5e', CARD_DARK = '#a87a45', INK = '#2a2c33';

// What the chair came in and who came to see it off, round the start: off to the sides of where the chair stands and
// no further down, where it never goes (the physics doesn't know they're there).
function props(track) {
  const group = new THREE.Group();
  group.name = 'start props';
  const place = (object, s, d, turn = 0) => {
    const { tangent } = track.frame(s);
    track.point(s, d, object.position);
    object.rotation.y = Math.atan2(-tangent.x, -tangent.z) + turn;     // its front (+z) up the hill
    group.add(object);
    return object;
  };
  place(box(), AT - 0.55, -1.55, 0.25);
  group.add(receipt(track, [AT - 0.5, -0.98], [AT - 1.35, -0.25]));
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  place(ficus(rand), AT - 0.1, 1.65, -0.6);
  place(cooler(), AT + 0.25, 2.35, -0.5);
  return group;
}

// The chair's cardboard box, emptied, lying on its side with its open end to the chair and its flaps out. The print
// says THIS WAY UP, with the arrow now pointing sideways.
function box() {
  const g = new THREE.Group(), card = toon(CARD), dark = toon(CARD_DARK);
  const L = 0.9, H = 0.62, W = 0.66, T = 0.02;            // along to the open end (+x), up, across (+z)
  const wall = (w, h, d, x, y, z, material = card) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  wall(L, T, W, 0, T / 2, 0, dark);
  wall(L, T, W, 0, H - T / 2, 0);
  wall(L, H, T, 0, H / 2, -W / 2 + T / 2);
  wall(L, H, T, 0, H / 2, W / 2 - T / 2);
  wall(T, H, W, -L / 2 + T / 2, H / 2, 0);
  // the flaps, folded out about the open end's edges
  const flap = (w, h, d, x, y, z, axis, angle) => {
    const hinge = new THREE.Group();
    hinge.position.set(x, y, z);
    hinge.rotation[axis] = angle;
    g.add(hinge);
    const mesh = wall(w, h, d, 0, 0, 0);
    hinge.add(mesh);
    return mesh;
  };
  flap(0.3, T, W, L / 2, H, 0, 'z', 1.9).position.x = 0.15;               // up and back
  flap(0.3, T, W, L / 2, 0, 0, 'z', 0.04).position.x = 0.15;              // out on the snow
  flap(0.24, H - 0.04, T, L / 2, H / 2, W / 2, 'y', -1).position.x = 0.12;
  flap(0.24, H - 0.04, T, L / 2, H / 2, -W / 2, 'y', 1.3).position.x = 0.12;
  // the print on the side to the camera, with the arrow turned the way the box now lies
  const print = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.08, H - 0.08), new THREE.MeshToonMaterial({
    gradientMap: RAMPS.world, transparent: true, map: painted(512, 352, (ctx, w, h) => {
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = 14;
      ctx.lineCap = ctx.lineJoin = 'round';
      // ↑ THIS WAY UP, on its side: the arrow points along the box
      ctx.beginPath();
      ctx.moveTo(40, 70); ctx.lineTo(170, 70);
      ctx.moveTo(130, 32); ctx.lineTo(172, 70); ctx.lineTo(130, 108);
      ctx.stroke();
      letter(ctx, 'THIS WAY UP', 330, 72, { size: 50, color: INK, maxWidth: 290 });
      letter(ctx, 'FRAGILE', 256, 190, { size: 92, color: '#d0352a', maxWidth: 440 });
      ctx.strokeStyle = '#d0352a';
      ctx.lineWidth = 8;
      ctx.strokeRect(36, 136, 440, 108);
      letter(ctx, '1 × ERGONOMIC CHAIR · €1,649', 256, 300, { size: 34, color: INK, maxWidth: 450 });
    }) }));
  print.material.userData.outlineParameters = { visible: false };
  print.position.set(0, H / 2, W / 2 + 0.002);
  g.add(print);
  return g;
}

// The receipt, a long white strip run out over the snow from the box, curling up at its end.
function receipt(track, [s0, d0], [s1, d1]) {
  const N = 28, WIDTH = 0.13, positions = [], uvs = [], index = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), across = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  track.point(s0, d0, a);
  track.point(s1, d1, b);
  across.subVectors(b, a).setY(0).normalize().cross(up);
  for (let i = 0; i <= N; i++) {
    const k = i / N, s = s0 + (s1 - s0) * k, d = d0 + (d1 - d0) * k;
    const p = track.point(s, d, new THREE.Vector3());
    p.y += 0.012 + 0.025 * Math.sin(k * 9) ** 2 + 0.09 * THREE.MathUtils.smoothstep(k, 0.86, 1);   // ripples, the curl
    for (const side of [-1, 1]) {
      const q = p.clone().addScaledVector(across, side * WIDTH / 2);
      positions.push(q.x, q.y, q.z);
      uvs.push(side < 0 ? 0 : 1, k);
    }
    if (i < N) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshToonMaterial({ gradientMap: RAMPS.world, side: THREE.DoubleSide,
    map: painted(64, 512, (ctx, w, h) => {
      ctx.fillStyle = '#fff3cf';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7d8290';
      for (let y = 24; y < h - 60; y += 22) ctx.fillRect(8, y, 20 + (y * 7 % 28), 6);
      ctx.fillStyle = INK;
      ctx.fillRect(8, h - 44, 48, 12);
    }) });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'receipt';
  mesh.receiveShadow = true;
  return mesh;
}
