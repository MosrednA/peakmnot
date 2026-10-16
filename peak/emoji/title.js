// The title screen (peak/kit/title.js, styled by peak/ui/title.css): the logo over one slow shot of Mnot at the
// start of the field, from the front and a little to the side, creeping in and swaying, while Mnot pushes its glasses
// up and waves now and then. The emojis behind stand out of focus in the shot; which ones are on the list is for the
// game.
// main.js calls update(dt) before Mnot is posed and place(dt) after its camera has placed itself.
import * as THREE from 'three';
import { TitleScreen } from '../kit/title.js';

// Each a real tip, said in the premise's words.
const TIPS = [
  'Tip: the list is at the top. It is in order. The order is the whole point.',
  'Tip: you have three tries. A wrong emoji leaves Mnot seeing stars; the third ruins the thread.',
  'Tip: a listed emoji fetched too early is a wrong one too. Patience is a reaction.',
  'Tip: the list done, :peak-mnot: drops into the middle of the field. The clock stops when you fetch it.',
  'Tip: the list done, the snow gives way here and there. Watch where from up high, then find the way round.',
  'Tip: a crack in the snow holds for a moment. Run across, and don\'t count on coming back that way.',
  'Tip: the snow walls are knee-high. Mnot can see over them, not step over them. It can bonk into them, though.',
  'Tip: the snow is slippery. Let go of W early, or brake with S, and steer round a wrong one in good time.',
  'Tip: hold Space to look over the whole field. Mnot stops to look; the clock doesn\'t.',
  'Tip: R starts this field again, N deals a new one.',
];
// the keys that move the player: they start the game and move it on that same frame
const MOVES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
// The shot, from the player: out to the side and the front (angle, radians from straight ahead), how far, how high,
// looking at Mnot's glasses. It creeps in over the first seconds, then sways slowly.
const SHOT = { dist: 3.6, creep: 0.8, angle: 0.85, sway: 0.15, h: 1.3, look: 0.9, fov: 40 };
// Mnot's acts, again every CYCLE seconds: [at, clip, seconds] (a one-shot plays its whole length)
const ACTS = [[2.5, 'PushGlasses'], [7, 'Wave', 2.4]];
const CYCLE = 12;

const TAU = Math.PI * 2;
const ease = k => THREE.MathUtils.smootherstep(k, 0, 1);

export class Title extends TitleScreen {
  constructor({ camera, dom, mnot, player, follow }) {
    super({ camera, dom, tips: TIPS, moves: MOVES, anchor: () => player.pos, follow: () => follow });
    Object.assign(this, { mnot, player });
    this.fov = SHOT.fov;
  }

  // The shot at this moment and Mnot's act. On a narrow screen the camera stands further back.
  frame() {
    const t = this.time, at = this.player.pos;
    const narrow = 1 - THREE.MathUtils.clamp(this.camera.aspect / 1.15, 0.4, 1);
    const dist = (SHOT.dist + SHOT.creep * (1 - ease(Math.min(1, t / 6)))) * (1 + 0.6 * narrow);
    const angle = this.player.yaw + SHOT.angle + SHOT.sway * Math.sin(t * TAU / 23);
    this.pos.set(at.x + dist * Math.sin(angle), at.y + SHOT.h + 0.08 * Math.sin(t * TAU / 17),
      at.z + dist * Math.cos(angle));
    this.look.copy(at).setY(at.y + SHOT.look);
    this.act(t % CYCLE);
  }

  act(t) {
    const anim = this.mnot.animator;
    let clip = 'Idle';
    for (const [at, name, hold] of ACTS) {
      const length = hold ?? anim.actions.get(name)?.getClip().duration ?? 0;
      if (t >= at && t < at + length && anim.has(name)) clip = name;
    }
    anim.play(clip);
  }

  // the moment it starts: Mnot leaves its act
  leaving() {
    this.mnot.animator.play('Idle');
  }
}
