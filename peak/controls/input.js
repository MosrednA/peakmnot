// Keyboard state (and the touch stick, touch.js, and a controller, main.js), turned into movement once per frame:
// relative to the camera's shot, with "onwards" along the route.
import * as THREE from 'three';

const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyM']);
// each movement key's direction on screen: x to the right, y up
const MOVES = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyD: [1, 0], ArrowRight: [1, 0],
  KeyA: [-1, 0], ArrowLeft: [-1, 0] };
const LANE = 1.4;        // how hard "onwards" alone steers back to the walking line, per metre off it
const STICK = 0.4;       // a held key stays "onwards" until the camera has swung this far off (the cosine)
// The touch stick (touch.js), by its push 0..1: a thumb resting on it (below dead) stands still like Shift alone,
// careful steps below run, running beyond. It holds a direction's key while it leans past `key` of its push that way
// (sin 26°): wide sectors for straight on.
export const PAD = { dead: 0.2, run: 0.6, key: 0.44 };

export class Input {
  constructor() {
    this.enabled = true;
    // a controller this step (main.js reads it, kit/gamepad.js): the keys its stick and D-pad stand for, and its presses
    this.gamepad = { held: new Set(), careful: false, jump: false, mute: false };
    this.keys = new Set();
    this.pressed = new Set();     // pressed since the last read()
    this.move = new THREE.Vector3();
    this.axis = null;             // which screen axis means "onwards", kept while a key on it stays held
    this.stick = null;            // the touch stick, { x, y } on screen (x right, y up, length ≤ 1), or null
    addEventListener('keydown', (e) => {
      if (!this.enabled || !KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, button')) return;
      e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.keys.clear();
    this.pressed.clear();
    this.stick = null;
    this.axis = null;
  }

  // For tests: hold or release a key as if it were typed.
  key(code, down) {
    if (!this.enabled) return;
    if (down && !this.keys.has(code)) this.pressed.add(code);
    if (down) this.keys.add(code); else this.keys.delete(code);
  }

  held(...codes) { return codes.some(c => this.keys.has(c)); }

  // The touch stick as the keys it stands for, added to held, so everything after (onwards along the route, the lane
  // assist, leaning on a beam, the replay for the score server) treats it like the keys. True for a resting thumb or
  // a small push: careful steps.
  stickKeys(held) {
    const s = this.stick, push = s ? Math.hypot(s.x, s.y) : 0;
    if (!s) return false;
    if (push < PAD.dead) return true;
    const x = s.x / push, y = s.y / push;
    if (Math.abs(x) > PAD.key) held.add(x > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(y) > PAD.key) held.add(y > 0 ? 'KeyW' : 'KeyS');
    return push < PAD.run;
  }

  // The frame's intent, relative to the camera's flat forward direction. The screen axis that lies closest to the
  // route (route.dir, the way it goes here) is swapped for the route itself, like a 2.5D game: when the route runs
  // across the screen, right means exactly "onwards" though the camera looks at it at an angle, and round corners.
  // Holding only that axis also steers gently back to the walking line (route.side metres off it); up and down
  // step off it on purpose. While a key on that axis stays held it keeps meaning onwards as the camera swings round
  // a corner, so holding right never turns into walking off the edge halfway. direction(keys) gives the move of just
  // some of the held keys (planks and ropes ignore the keys held when Mnot stepped on); direction(keys, target,
  // false) leaves out the lane assist (ice: holding the line is up to the player).
  read(forward, route = null) {
    if (!this.enabled) {
      this.move.set(0, 0, 0);
      const frame = { move: this.move, held: new Set(), direction: () => new THREE.Vector3(),
        careful: false, jump: false, mute: false };
      this.frame = frame;
      return frame;
    }
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    forward = forward.clone();
    const held = new Set([...this.keys].filter(k => k in MOVES));
    const gentle = this.stickKeys(held);
    for (const key of this.gamepad.held) held.add(key);
    const keyed = axis => [...held].some(k => MOVES[k][axis] !== 0);
    let lane = null;
    if (!route || this.axis !== null && !keyed(this.axis)) this.axis = null;
    if (route) {
      const along = route.dir, r = along.dot(right), f = along.dot(forward);
      const across = new THREE.Vector3(-along.z, 0, along.x)
        .multiplyScalar(-THREE.MathUtils.clamp(route.side * LANE, -0.6, 0.6));
      let axis = this.axis ?? (Math.abs(r) >= Math.abs(f) ? 0 : 1);
      if (Math.abs(axis === 0 ? r : f) < STICK) axis = 1 - axis;
      this.axis = keyed(axis) ? axis : null;
      if (axis === 0) right.copy(along).multiplyScalar(Math.sign(r));
      else forward.copy(along).multiplyScalar(Math.sign(f));
      lane = { axis, across };
    }
    const direction = (keys = held, target = new THREE.Vector3(), assist = true) => {
      let x = 0, y = 0;
      for (const k of keys) { x += MOVES[k][0]; y += MOVES[k][1]; }
      target.set(0, 0, 0).addScaledVector(right, Math.sign(x)).addScaledVector(forward, Math.sign(y));
      if (assist && lane && (lane.axis === 0 ? x !== 0 && y === 0 : y !== 0 && x === 0)) target.add(lane.across);
      return target.lengthSq() > 0 ? target.normalize() : target;
    };
    direction(held, this.move);
    const frame = { move: this.move, held, direction,
      careful: this.held('ShiftLeft', 'ShiftRight') || gentle || this.gamepad.careful,
      jump: this.pressed.has('Space') || this.gamepad.jump, mute: this.pressed.has('KeyM') || this.gamepad.mute };
    this.pressed.clear();
    this.frame = frame;           // the last one, for the bots
    return frame;
  }
}
