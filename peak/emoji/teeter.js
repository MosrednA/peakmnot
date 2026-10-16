// Teetering on the rim of a hole (cracks.js), as Mnot does at the climb's drops (peak/mnot/teeter.js): a step that
// would take Mnot's middle over an open hole stops it at the edge instead, and so does a crack giving way at its toes
// while it's slow. It turns to face the hole (unless the player steers) and rocks out over it and back with its arms
// wheeling (the Teeter clip), and drops in unless the player brakes or steers away in time; running on into the hole
// sends it over sooner. main.js does the rest (the record's rim and steady, the drop, the sounds), and the score
// server checks it (server/emoji.py, check_teeters()).
import * as THREE from 'three';

// time: s of teetering before Mnot goes over; catch: s before braking or steering saves it (a moment to see it go);
// push: how much faster running on into the hole runs the time out; intent: how much of a key counts; clip: s, the
// Teeter clip's loop, which the rocking keeps time with; slow: m/s under which a crack giving way within rim m of
// Mnot's middle catches it at the edge; over: m in from the edge that Mnot goes over at
export const TEETER = { time: 1.1, catch: 0.22, push: 2, intent: 0.3, clip: 0.8, slow: 1, rim: 0.2, over: 0.03 };

export class Teeter {
  constructor() {
    this.k = null;                        // the crack whose hole Mnot teeters over
    this.time = 0;                        // s towards TEETER.time, faster pushing on
    this.age = 0;                         // s since it started, which the rocking keeps time with
    this.out = new THREE.Vector3();       // the way to the hole
  }

  get active() { return this.k !== null; }

  start(k, out) {
    this.k = k;
    this.time = this.age = 0;
    this.out.copy(out);
  }

  stop() { this.k = null; }

  // A step of it, with the player's keys (main.js: steer, throttle, brake) and how much Mnot faces the hole (-1..1):
  // 'steady' (saved), 'over' (in it goes) or null (still teetering).
  hold(dt, want, facing) {
    const { time, catch: caught, push, intent } = TEETER;
    this.age += dt;
    if (this.age >= caught && (want.brake > intent || Math.abs(want.steer) > intent)) return 'steady';
    this.time += dt * (1 + push * want.throttle * Math.max(0, facing));
    return this.time >= time ? 'over' : null;
  }

  // Watching a run: the time goes by as it did (the record doesn't say how hard the player pushed on).
  tick(dt) {
    this.age += dt;
    this.time = Math.min(TEETER.time, this.time + dt);
  }

  // How far the can tips out over the hole (radians): further the longer it goes on, rocking with the clip.
  get tip() {
    const k = Math.min(1, this.time / TEETER.time);
    return (0.06 + 0.16 * k) * (0.7 + 0.3 * Math.sin(2 * Math.PI * this.age / TEETER.clip));
  }
}
