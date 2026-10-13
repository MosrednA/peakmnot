// Touch controls for phones and tablets. They come up on a coarse pointer or at the first touch and go away at a key
// press or a mouse click, so desktop play sees nothing of them. peak/controls/touch.css styles them.
// - Move: a floating stick on the left half, wherever the thumb lands. A thumb resting on it or a small push is
//   careful steps (like Shift: stop at an edge, grip on ice, brace against a gust, stand still on a plank or rope), a
//   fuller push runs. input.js reads it as the keys it stands for, so right means onwards, the lane assist, leaning on
//   a plank and the score server's replay all work as with the keys.
// - Jump: the round button at the bottom right, the same press as Space (so the jump buffer works).
// - Look: a drag anywhere else looks around (camera.js keeps the can's face in view); two fingers pinch to zoom.
// - Words: the HUD's hint bar, the title's "Tap to start" and How to play, and the tips (touchText) for touch.
// - No browser fights: no page scroll or zoom, long-press menus or selection (touch.css), the summit card's name field
//   kept above the on-screen keyboard, and the full screen at the start where the browser allows it (Android).
import { PAD } from './input.js';

const FOLLOW = 1.35;       // past this many radii the stick's base slides after the thumb
const HINTS = 45;          // seconds the touch hint bar stays up after the start

// Key names in the game's hints, as a touch player would do it (hud.js runs every toast line through touchText).
const WORDS = [[/\bA \/ D\b/g, 'tilt the stick'], [/\bShift (to|grips)\b/g, 'a light thumb $1'],
  [/\bsmall taps\b/g, 'small nudges'], [/\bSpace\b/g, 'the jump button']];

export function touchText(text) {
  if (!text || !document.body.classList.contains('touch')) return text;
  const out = WORDS.reduce((s, [from, to]) => s.replace(from, to), text);
  return /^[A-Z]/.test(text) ? out[0].toUpperCase() + out.slice(1) : out;
}

const HOWTO = [
  ['left thumb, anywhere', 'move; right always means onwards'],
  ['a light thumb', 'careful steps: stop at an edge, grip on ice; resting, stand still'],
  ['Jump', 'jump; a running jump clears about a metre'],
  ['tilt on a plank or rope', 'lean against the wobble; let go and Mnot walks on'],
  ['drag on the right, pinch', 'look around, zoom'],
];

const el = (tag, className, parent, text = '') => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  parent?.append(node);
  return node;
};

export class Touch {
  // dom: the canvas (the layer goes right above it, under the HUD); guard: { player, world } for the camera's look
  constructor({ input, follow, player, world, title, dom }) {
    Object.assign(this, { input, follow, title });
    this.guard = { player, world };
    this.on = false;
    this.stick = null;          // { id, cx, cy, r } while a thumb holds it
    this.looks = new Map();     // pointerId → { x, y }: the fingers looking around or pinching
    this.pinch = 0;             // the pinching fingers' distance last time
    this.jumpId = null;
    this.phone = matchMedia('(pointer: coarse)').matches;
    this.build(dom);
    const layer = this.layer;
    layer.addEventListener('pointerdown', e => this.down(e));
    layer.addEventListener('pointermove', e => this.move(e));
    for (const type of ['pointerup', 'pointercancel']) layer.addEventListener(type, e => this.up(e));
    layer.addEventListener('contextmenu', e => e.preventDefault());
    this.jump.addEventListener('pointerdown', e => this.press(e, true));
    for (const type of ['pointerup', 'pointercancel']) this.jump.addEventListener(type, e => this.press(e, false));
    // touch mode: on at a touch anywhere, off at a key press or a mouse click (not typing in a text field)
    addEventListener('pointerdown', e => this.enable(e.pointerType !== 'mouse'), { capture: true });
    addEventListener('keydown', (e) => {
      if (!e.isTrusted || e.key === 'Unidentified' || e.key === 'Process' || e.keyCode === 229) return;
      if (!e.target.closest?.('input, textarea, select, [contenteditable="true"]')) this.enable(false);
    }, { capture: true });
    addEventListener('blur', () => this.release());
    addEventListener('resize', () => this.home());
    document.addEventListener('gesturestart', (e) => { if (this.on) e.preventDefault(); });   // Safari's page pinch
    // the on-screen keyboard: keep the summit card's name field in sight
    for (const type of ['resize', 'scroll']) visualViewport?.addEventListener(type, () => this.keyboard());
    document.addEventListener('focusin', () => this.keyboard());
    document.addEventListener('focusout', () => setTimeout(() => this.keyboard(), 50));
    if (title?.on) title.on('start', () => this.started());
    else this.started();
    if (this.phone) this.enable(true);
  }

  build(dom) {
    const layer = this.layer = el('div', '', null);
    layer.id = 'touch';
    layer.hidden = true;
    this.base = el('div', 'tc-stick', layer);
    this.base.style.setProperty('--careful', PAD.run);
    el('i', 'tc-ring', this.base);
    this.knob = el('b', 'tc-knob', this.base);
    this.jump = el('div', 'tc-jump', layer, 'Jump');
    this.jump.setAttribute('aria-hidden', 'true');
    if (dom?.after) dom.after(layer); else document.body.prepend(layer);
    // the words: a hint bar in the HUD, and the title's touch versions of "Press any key" and How to play
    const hud = document.getElementById('hud');
    this.hints = el('div', 'tc-hints', null);
    this.hints.id = 'touch-help';
    this.hints.innerHTML = '<b>left thumb</b> walk · <b>light thumb</b> careful · <b>Jump</b> · '
      + '<b>drag</b> look · <b>pinch</b> zoom';
    hud?.append(this.hints);
    const press = document.querySelector('#title-screen .ts-press');
    if (press) press.after(el('p', 'ts-press tc-press', null, 'Tap anywhere to start'));
    const howto = document.querySelector('#title-howto dl');
    if (howto) {
      const dl = el('dl', 'tc-howto', null);
      for (const [dt, dd] of HOWTO) { el('dt', '', dl, dt); el('dd', '', dl, dd); }
      howto.after(dl);
    }
  }

  enable(on) {
    if (on === this.on) return;
    this.on = on;
    document.body.classList.toggle('touch', on);
    this.layer.hidden = !on;
    if (!on) this.release();
    this.home();
  }

  // The climb starts: the hint bar for a while, and the full screen on a phone.
  started() {
    clearTimeout(this.hintTimer);
    this.hints.classList.remove('gone');
    this.hintTimer = setTimeout(() => this.hints.classList.add('gone'), HINTS * 1000);
    if (this.on && this.phone) this.fullscreen();
  }

  // Android Chrome: the whole screen, asked once. A touch only counts as a gesture when it lifts, so if asking at the
  // touch that started the climb fails, ask again as it lifts.
  fullscreen() {
    const root = document.documentElement;
    if (this.askedFull || !document.fullscreenEnabled || document.fullscreenElement || !root.requestFullscreen) return;
    this.askedFull = true;
    const ask = () => root.requestFullscreen({ navigationUI: 'hide' });
    ask().catch(() => addEventListener('pointerup', () => ask().catch(() => {}), { once: true, capture: true }));
  }

  // ------------------------------------------------------------------ fingers

  down(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    if (document.activeElement?.matches?.('input')) document.activeElement.blur();     // the keyboard goes away
    if (this.title?.visible) {
      // a tap on the scene starts the climb; with the Hall of Fame open it only closes that
      const panel = document.querySelector('.sc-panel.open');
      if (panel) { panel.querySelector('.sc-x')?.click(); return; }
      this.title.start('pointer');
    }
    this.layer.setPointerCapture?.(e.pointerId);
    if (!this.stick && e.clientX < innerWidth / 2) this.grab(e);
    else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = 0;
    }
  }

  move(e) {
    if (this.stick?.id === e.pointerId) { this.steer(e.clientX, e.clientY); return; }
    const finger = this.looks.get(e.pointerId);
    if (!finger) return;
    const dx = e.clientX - finger.x, dy = e.clientY - finger.y;
    finger.x = e.clientX;
    finger.y = e.clientY;
    if (this.title?.visible) return;
    if (this.looks.size === 1) { this.follow.look(dx, dy, this.guard); return; }
    const [a, b] = [...this.looks.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinch > 0 && d > 0) this.follow.zoomBy(this.pinch / d);     // fingers apart: closer in
    this.pinch = d;
  }

  up(e) {
    if (this.stick?.id === e.pointerId) this.letGo();
    if (this.looks.delete(e.pointerId)) this.pinch = 0;
  }

  // The jump button: Space, held while the finger is on it.
  press(e, down) {
    e.stopPropagation();
    if (down) {
      e.preventDefault();
      this.jumpId = e.pointerId;
    } else if (e.pointerId !== this.jumpId) return;
    this.input.key('Space', down);
    this.jump.classList.toggle('down', down);
    if (!down) this.jumpId = null;
  }

  // ------------------------------------------------------------------ the stick

  get radius() { return Math.max(40, Math.min(64, 0.13 * Math.min(innerWidth, innerHeight))); }

  // The safe area (notches, the home bar), from the layer's padding (touch.css).
  get insets() {
    const css = getComputedStyle(this.layer);
    return { left: parseFloat(css.paddingLeft) || 0, right: parseFloat(css.paddingRight) || 0,
      top: parseFloat(css.paddingTop) || 0, bottom: parseFloat(css.paddingBottom) || 0 };
  }

  // A thumb lands: the stick comes to it, kept whole on the screen.
  grab(e) {
    const r = this.radius, m = r + 8, inset = this.insets;
    const cx = Math.min(Math.max(e.clientX, m + inset.left), innerWidth - m - inset.right);
    const cy = Math.min(Math.max(e.clientY, m + inset.top), innerHeight - m - inset.bottom);
    this.stick = { id: e.pointerId, cx, cy, r };
    this.base.classList.add('held');
    this.steer(e.clientX, e.clientY);
  }

  steer(x, y) {
    const s = this.stick;
    let dx = x - s.cx, dy = y - s.cy, d = Math.hypot(dx, dy);
    const reach = s.r * FOLLOW;
    if (d > reach) {             // the base slides after a thumb that wanders off
      s.cx += dx * (1 - reach / d);
      s.cy += dy * (1 - reach / d);
      dx = x - s.cx;
      dy = y - s.cy;
      d = reach;
    }
    const push = Math.min(1, d / s.r), ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
    this.input.stick = { x: ux * push, y: -uy * push };
    this.base.classList.toggle('careful', push < PAD.run);
    this.base.classList.toggle('run', push >= PAD.run);
    this.draw(s.cx, s.cy, s.r, ux * push * s.r, uy * push * s.r);
  }

  letGo() {
    this.stick = null;
    this.input.stick = null;
    this.base.classList.remove('held', 'careful', 'run');
    this.home();
  }

  // Back to where it waits, faded, at the bottom left.
  home() {
    if (this.stick) return;
    const r = this.radius, inset = this.insets;
    this.draw(inset.left + r + 30, innerHeight - inset.bottom - r - 26, r, 0, 0);
  }

  draw(cx, cy, r, kx, ky) {
    const style = this.base.style;
    style.width = style.height = `${2 * r}px`;
    style.transform = `translate(${cx - r}px, ${cy - r}px)`;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  release() {
    if (this.stick) this.letGo();
    this.looks.clear();
    this.pinch = 0;
    if (this.jumpId !== null) {
      this.input.key('Space', false);
      this.jump.classList.remove('down');
      this.jumpId = null;
    }
  }

  // ------------------------------------------------------------------ the on-screen keyboard

  // Typing a name on the summit card: when the keyboard only shrinks the visible part of the page (Safari), the card
  // moves into what's left of it. (Chrome resizes the page itself: interactive-widget in peak.html's viewport.)
  keyboard() {
    const vv = visualViewport, panel = document.querySelector('.sc-panel');
    if (!vv || !panel) return;
    const field = document.activeElement?.closest?.('.sc-panel') ? document.activeElement : null;
    const up = this.on && !!field?.matches('input') && vv.height < innerHeight * 0.85;
    panel.classList.toggle('tc-kb', up);
    if (!up) return;
    panel.style.setProperty('--kb-top', `${vv.offsetTop + 8}px`);
    panel.style.setProperty('--kb-height', `${Math.max(120, vv.height - 16)}px`);
    field.scrollIntoView({ block: 'nearest' });
  }
}
