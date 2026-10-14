// A game controller (the browser's Gamepad API), the same in every mini game. Read once a step (poll()), it gives the
// game the left stick, the right stick as a camera drag, the D-pad, the triggers and the buttons pressed since the
// step before; the game decides what they do, and padmenu.js puts the controller on the screen. Only the browser's
// standard layout counts, whose buttons BUTTON names by where they sit (as on an Xbox controller). With several
// connected, the one in use wins: on Windows a DualSense on USB can show up twice, with the presses arriving on only
// one of the two. A browser shows a controller to the page after its first button press, and only while the page
// has the focus; without the focus everything lets go, and a button still held when it's back isn't a fresh press.
// A controller can't start the sound: browsers wait for a click or a key (padmenu.js says so).

export const BUTTON = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, ls: 10, rs: 11, up: 12,
  down: 13, left: 14, right: 15 };
// the sticks like the climb's touch stick (controls/input.js): a push below `dead` is nothing, below `run` it's a
// careful one, and it holds a direction's key while it leans past `key` of its push that way (sin 26°)
export const STICK = { dead: 0.2, run: 0.6, key: 0.44 };
// the right stick at full tilt, in camera drag pixels a second (the climb's camera.js), by the look speed setting
export const LOOK = { slow: 170, normal: 260, fast: 380 };
const AIM = 1.6;            // the right stick's curve: gentle round the middle, for small turns
const TRIGGER = 0.06;       // a trigger's dead zone
// the buzzes a game asks for: [strong motor, weak motor, ms]
const RUMBLE = { bump: [0.45, 0.25, 110], hit: [0.9, 0.5, 240], cheer: [0.35, 0.8, 520] };
// the settings and their choices, the first the default (padmenu.js shows the ones a game uses)
export const SETTINGS = { invert: [false, true], speed: ['normal', 'slow', 'fast'], rumble: [true, false] };
const STORE = 'mnot.pad';

// whose names the buttons go by, and what to call the controller: by the browser's name for it and its USB ids
function identify(id) {
  const [, vendor = '', product = ''] = /vendor:\s*([0-9a-f]{1,4})\s*product:\s*([0-9a-f]{1,4})/i.exec(id)
    ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id) ?? [];
  const v = vendor.toLowerCase().padStart(4, '0'), p = product.toLowerCase().padStart(4, '0');
  if (v === '054c' || /dualsense|dualshock|playstation/i.test(id)) {
    const name = /dualsense/i.test(id) || ['0ce6', '0df2'].includes(p) ? 'DualSense'
      : /dualshock/i.test(id) || ['05c4', '09cc'].includes(p) ? 'DualShock 4' : 'PlayStation controller';
    return { kind: 'playstation', name };
  }
  if (v === '057e' || /nintendo|pro controller|joy-con/i.test(id)) return { kind: 'nintendo', name: 'Switch controller' };
  return { kind: 'xbox', name: v === '045e' || /xbox|xinput/i.test(id) ? 'Xbox controller' : 'Controller' };
}

const busy = pad => pad.buttons.some(b => b.pressed) || pad.axes.slice(0, 4).some(a => Math.abs(a) >= STICK.dead);
const clamp = v => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

export class GamepadInput {
  constructor() {
    this.index = null;          // the controller in use, by the browser's index and its name for it
    this.id = '';
    this.kind = 'xbox';         // 'xbox', 'playstation' or 'nintendo'
    this.name = '';
    this.rumbles = false;       // whether it can buzz
    this.active = false;        // whether it's the device in use: a key or a touch hands over (the hints follow)
    this.used = false;          // whether it did anything this step
    this.fresh = new Set();     // the buttons pressed since the step before
    this.buttons = [];          // pressed or not, by BUTTON
    this.values = [];           // how far, 0..1 (the triggers)
    this.stick = { x: 0, y: 0, push: 0 };   // the left stick (y up), and how far it's pushed past `dead`, 0..1
    this.look = { x: 0, y: 0 };             // the right stick as a camera drag, pixels a second
    this.listeners = new Map();
    this.settings = Object.fromEntries(Object.entries(SETTINGS).map(([key, choices]) => [key, choices[0]]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      for (const key in SETTINGS) if (SETTINGS[key].includes(saved[key])) this.settings[key] = saved[key];
    } catch { /* no storage: the defaults */ }
    addEventListener('keydown', e => { if (e.isTrusted) this.setActive(false); }, { capture: true });
    addEventListener('pointerdown', e => { if (e.pointerType === 'touch') this.setActive(false); }, { capture: true });
  }

  // on('connect' | 'disconnect' | 'active' (on) | 'settings' (key), fn)
  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(fn); }
  emit(name, data) { for (const fn of this.listeners.get(name) ?? []) fn(data); }

  get connected() { return this.index !== null; }
  down(button) { return !!this.buttons[button]; }
  value(button) { return Math.max(0, (this.values[button] ?? 0) - TRIGGER) / (1 - TRIGGER); }
  // the D-pad, -1, 0 or 1 each way (y up)
  get dpad() {
    return { x: this.down(BUTTON.right) - this.down(BUTTON.left), y: this.down(BUTTON.up) - this.down(BUTTON.down) };
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.emit('active', on);
  }

  // Once a step.
  poll() {
    let pads = [];
    try { pads = [...(navigator.getGamepads?.() ?? [])]; } catch { /* blocked by the page's Permissions Policy */ }
    const usable = pads.filter(p => p?.connected && p.mapping === 'standard');
    let pad = usable.find(p => p.index === this.index && p.id === this.id);
    if (!pad || !busy(pad)) pad = usable.filter(busy).sort((a, b) => b.timestamp - a.timestamp)[0] ?? pad ?? usable[0];
    this.fresh.clear();
    this.used = false;
    this.buttons = [];
    this.values = [];
    this.stick = { x: 0, y: 0, push: 0 };
    this.look = { x: 0, y: 0 };
    if (!pad) {
      if (!this.connected) return this;
      Object.assign(this, { index: null, id: '', was: [] });
      this.setActive(false);
      this.emit('disconnect');
      return this;
    }
    if (pad.index !== this.index || pad.id !== this.id) {
      Object.assign(this, { index: pad.index, id: pad.id, was: [], rumbles: !!pad.vibrationActuator }, identify(pad.id));
      this.emit('connect');
    }
    const down = pad.buttons.map(b => b.pressed);
    if (document.hidden || !document.hasFocus()) {
      this.was = down;
      return this;
    }
    down.forEach((on, i) => { if (on && !this.was[i]) this.fresh.add(i); });
    this.was = this.buttons = down;
    this.values = pad.buttons.map(b => b.value);
    const x = clamp(pad.axes[0]), y = -clamp(pad.axes[1]), push = Math.min(1, Math.hypot(x, y));
    this.stick = { x, y, push: push < STICK.dead ? 0 : (push - STICK.dead) / (1 - STICK.dead) };
    const rx = clamp(pad.axes[2]), ry = clamp(pad.axes[3]), tilt = Math.min(1, Math.hypot(rx, ry));
    if (tilt >= STICK.dead) {
      const k = LOOK[this.settings.speed] * ((tilt - STICK.dead) / (1 - STICK.dead)) ** AIM / tilt;
      this.look = { x: rx * k, y: ry * k * (this.settings.invert ? -1 : 1) };
    }
    this.used = this.stick.push > 0 || tilt >= STICK.dead || down.some(Boolean);
    if (this.used) this.setActive(true);
    return this;
  }

  // The left stick and the D-pad as the keys they point at (W A S D), 8 ways, into `held`, like the climb's touch
  // stick: true for a light push, careful steps.
  keys(held = new Set()) {
    const { x, y } = this.stick, push = Math.hypot(x, y);
    let careful = false;
    if (push >= STICK.dead) {
      if (Math.abs(x / push) > STICK.key) held.add(x > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(y / push) > STICK.key) held.add(y > 0 ? 'KeyW' : 'KeyS');
      careful = push < STICK.run;
    }
    const dpad = this.dpad;
    if (dpad.x) held.add(dpad.x > 0 ? 'KeyD' : 'KeyA');
    if (dpad.y) held.add(dpad.y > 0 ? 'KeyW' : 'KeyS');
    return careful;
  }

  set(key, value) {
    if (!SETTINGS[key]?.includes(value)) return;
    this.settings[key] = value;
    try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* for this visit only */ }
    this.emit('settings', key);
  }

  // A short buzz, 'bump', 'hit' or 'cheer', while the controller is in use and the player wants it.
  rumble(what, always = false) {
    if (!this.connected || !this.rumbles || !always && (!this.active || !this.settings.rumble)) return;
    const [strongMagnitude, weakMagnitude, duration] = RUMBLE[what];
    try {
      const effect = navigator.getGamepads()[this.index]?.vibrationActuator?.playEffect?.('dual-rumble',
        { duration, strongMagnitude, weakMagnitude });
      effect?.catch?.(() => {});
    } catch { /* no buzz here */ }
  }
}
