// TEMPLATE for peak/<game>/title.js: the title screen (peak/kit/title.js, styled by peak/ui/title.css). MY GAME over
// one slow shot of Mnot at the start, from the front and a little to the side, creeping in and swaying, while Mnot
// pushes its glasses up and waves now and then. Only the start is in the picture: the rest is for the game.
// main.js calls update(dt) before Mnot is posed and place(dt) after its camera has placed itself.
import * as THREE from 'three';
import { TitleScreen } from '../kit/title.js';

// Each a real tip, said in the premise's words.
const TIPS = [
  'Tip: the flag is that way. It has always been that way.',
  'Tip: WASD or the arrows walk. Walking is most of the game, so far.',
  'Tip: R starts again. The flag will wait.',
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

  // the moment it starts (how: 'move', 'pointer', 'key' or 'button'): Mnot leaves its act; the downhill's waves
  // goodbye after a key or Start
  leaving() {
    this.mnot.animator.play('Idle');
  }
}
