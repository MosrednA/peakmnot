// The title screen every mini game opens on, styled by peak/ui/title.css: the game's logo over one slow shot of its
// start, a menu (Start, Hall of Fame, How to play, Sound), the tips going round, and "press any key". It never stands
// in the way: a movement key starts the game on the very frame it's read (the game reads it as it begins), and a
// tap on the scene, the Start button or any other key start it too. However it starts, the camera glides from the
// title's shot into the game's own camera, riding along with the player, while the title slides away and the HUD
// fades in (title.css hides it while body has the class `title-up`). ?manual never shows it (the game doesn't call
// show()), and a respawn never brings it back.
//
// A game's title extends TitleScreen and brings its shot and its act: frame() sets this.pos, this.look and this.fov
// for this.time (seconds on the title) and poses the player for it; leaving(how) is the moment it starts (a wave
// goodbye, say). The page holds the markup (#title-screen, see the template in .claude/skills/mini-game/). The game
// calls update(dt) once a frame before the player is posed and place(dt) after its camera has placed itself.
// Events: on('start', { how }), how being 'move' (a movement key), 'pointer', 'key' or 'button'.
import * as THREE from 'three';

const TIP_TIME = 6.5;            // seconds a tip stays up
const GLIDE = 1.5;               // seconds from the title's shot into the game's camera
const GLIDE_LOOK = 0.6;          // ... of which the look point takes this part, to find the player early
// keys that never start the game: focus, closing a panel, modifiers
const QUIET = new Set(['Tab', 'Escape', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'ContextMenu']);

const ease = k => THREE.MathUtils.smootherstep(k, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class TitleScreen {
  // camera: the scene's; dom: the canvas (a tap there starts); tips: the lines that go round; moves: the key codes
  // that move the player (they start it on this frame); anchor(): where the player is (the glide rides along with
  // it); follow(): the game camera's { look, fov } this frame, which the glide ends in
  constructor({ camera, dom, tips = [], moves = [], anchor, follow }) {
    Object.assign(this, { camera, tips, anchor, follow });
    this.moves = new Set(moves);
    this.visible = false;
    this.time = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = camera.fov;
    this.glide = null;
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

  // the game's shot and act for this.time, and its moment of leaving: a game's title brings its own
  frame() {}
  leaving() {}

  // The logo's letters, each bobbing on its own with a snow cap (title.css), word by word: --i counts the letters,
  // --j counts them within their word (a page's own logo style can use it, like the downhill's letters stepping down
  // a slope).
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
    if (this.tipEl) this.tipEl.textContent = this.tips[0] ?? '';
    this.syncSound();
    document.body.classList.add('title-up');
    this.el.hidden = false;
    this.el.classList.remove('leaving');
    this.frame();
  }

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
    // the shot rides along with the player into the game's camera
    const at = this.anchor();
    this.glide = { t: 0, from: this.pos.clone().sub(at), look: this.look.clone().sub(at), fov: this.camera.fov };
    this.leaving(how);
    this.emit('start', { how });
  }

  // Once a frame, before the player is posed: the shot for this moment, the tips and the sound button. True while
  // the title is up.
  update(dt) {
    if (!this.visible) return false;
    this.time += dt;
    this.frame();
    this.rotateTips(dt);
    this.syncSound();
    return true;
  }

  // Once a frame, after the game's camera has placed itself: the title's shot, or the glide out of it.
  place(dt) {
    const cam = this.camera;
    if (this.visible) {
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.lens(this.fov);
      return;
    }
    const g = this.glide;
    if (!g) return;
    // from the title's shot, riding along with the player, into wherever the game's camera has put itself
    const u = Math.min(1, (g.t += dt) / GLIDE), k = ease(u), at = this.anchor(), to = this.follow();
    const look = _a.copy(g.look).add(at).lerp(to.look, ease(Math.min(1, u / GLIDE_LOOK)));
    cam.position.lerpVectors(_b.copy(g.from).add(at), cam.position, k);
    cam.lookAt(look);
    this.lens(g.fov + (to.fov - g.fov) * k);
    if (u >= 1) this.glide = null;
  }

  lens(fov) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  rotateTips(dt) {
    const tip = this.tip;
    if (!this.tipEl || !this.tips.length || (tip.clock += dt) < TIP_TIME) return;
    if (!this.tipEl.classList.contains('swap')) this.tipEl.classList.add('swap');
    if (tip.clock < TIP_TIME + 0.4) return;
    tip.index = (tip.index + 1) % this.tips.length;
    tip.clock = 0;
    this.tipEl.textContent = this.tips[tip.index];
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

  // Any key starts the game, except the quiet ones; a movement key also moves on that same frame. Enter on a focused
  // title button clicks it instead, and the keys stay in the Hall of Fame while it's open.
  key(e) {
    if (!this.visible || e.ctrlKey || e.metaKey || e.altKey || QUIET.has(e.code)) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.sc-panel.open')) return;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target.closest?.('button')) return;
    if (!this.moves.has(e.code)) e.preventDefault();
    this.start(this.moves.has(e.code) ? 'move' : 'key');
  }
}
