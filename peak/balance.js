// Balancing on a plank or rope, shot from the front (camera.js). Mnot walks on by itself, the way it stepped on;
// Shift stands still. It leans like an upside-down pendulum: a lean grows by itself (faster on a rope), steps,
// gusts and the rope's swing push it. Holding left/right on screen leans back at a steady rate (not ever faster),
// so a late reaction overshoots a little instead of flinging Mnot off the other side. Lean past FALL_ANGLE and
// Mnot slips off.
// Keys already held when Mnot steps on are ignored until let go, since the camera swings round and they'd now mean
// something else.
import * as THREE from 'three';
import { random } from './world.js';

// The feel, tuned with a bot that reacts late (see peak/README.md): an alert player crosses the rope, a sleepy
// one mostly doesn't, and the first plank forgives nearly everyone.
export const FEEL = {
  speed: 0.5,       // walking speed along a beam
  pull: 2.2,        // how fast a lean grows by itself (times the beam's wobble)
  push: 6,          // how hard a held key steers the lean ...
  rate: 0.75,       // ... towards leaning back at this many radians a second
  damp: 1.8,
  kick: 0.06,       // the wobble from stepping on running, per m/s over walking speed
  shake: 1.2,       // the jitter from the feet, more while walking
};
export const FALL_ANGLE = 0.6;  // radians

export class Balance {
  constructor(player) {
    this.player = player;
    this.beam = null;
    this.s = 0;               // where along the beam, 0..1
    this.offset = 0;          // sideways distance from the middle, eased away after stepping on
    this.lean = 0;            // > 0 leans towards the beam's right
    this.leanSpeed = 0;
    this.speed = 0;           // along the beam, > 0 towards its far end
    this.facing = 1;
    this.noise = 0;
    this.ignored = new Set();   // keys held when stepping on
    this.entered = false;
    this.rand = random(99);
  }

  get active() { return this.beam !== null; }

  // Step or land onto a beam. Arriving fast or from a height starts a wobble.
  enter(hit, speed, impact) {
    const p = this.player, b = hit.beam;
    p.mode = 'beam';
    p.support = null;
    this.beam = b;
    this.s = hit.s;
    this.offset = hit.lat - b.swayAt(hit.s);
    const along = p.vel.x * b.dir.x + p.vel.z * b.dir.z;
    this.facing = Math.sign(along) || Math.sign(Math.cos(p.yaw - Math.atan2(b.dir.x, b.dir.z))) || 1;
    this.speed = THREE.MathUtils.clamp(along, -FEEL.speed, FEEL.speed);
    const side = this.rand() < 0.5 ? -1 : 1;
    this.lean = p.tilt.angle * (p.tilt.axis.dot(b.dir) || 0);
    this.leanSpeed = side * (FEEL.kick * Math.max(0, speed - FEEL.speed) + 0.1 * impact) * b.wobble;
    this.noise = 0;
    this.entered = true;
    p.vel.set(0, 0, 0);
    p.vy = 0;
    p.jumpPhase = null;
    p.tilt.axis.copy(b.dir);
    p.tilt.toppling = 0;
    b.load = this.s;
    p.emit('beam', { beam: b });
  }

  leave() {
    if (!this.beam) return;
    this.beam.load = null;
    this.beam = null;
  }

  update(dt, input, wind) {
    const p = this.player, b = this.beam;
    p.jumpBuffer = 0;     // no jumping off a beam
    if (this.entered) { this.ignored = new Set(input.held); this.entered = false; }
    for (const key of this.ignored) if (!input.held.has(key)) this.ignored.delete(key);
    const keys = [...input.held].filter(k => !this.ignored.has(k) && /^(Key[AD]|Arrow(Left|Right))$/.test(k));
    const across = input.direction(keys).dot(b.right);
    const steer = Math.abs(across) > 0.3 ? Math.sign(across) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, input.careful ? 0 : this.facing * FEEL.speed, 4, dt);

    // The lean: it tips over by itself, wobbles more while walking, gusts push it, and the player leans back.
    this.noise += (this.rand() * 2 - 1) * 1.2 * Math.sqrt(dt) - this.noise * 3 * dt;   // the same at any frame rate
    const gust = wind.strength * wind.dir.dot(b.right) * 1.5;
    const shake = FEEL.shake * this.noise * (0.25 + 1.6 * Math.abs(this.speed)) * b.wobble;
    const lean = steer ? FEEL.push * (steer * FEEL.rate - this.leanSpeed) : 0;
    const acc = FEEL.pull * b.wobble * Math.sin(this.lean) + lean + gust + shake - FEEL.damp * this.leanSpeed;
    this.leanSpeed += acc * dt;
    this.lean += this.leanSpeed * dt;
    if (Math.abs(this.lean) > FALL_ANGLE) { this.slip(); return; }

    // a rope swings away from the lean and with the wind
    if (b.kind === 'rope') b.sway = THREE.MathUtils.damp(b.sway, -0.1 * this.lean + 0.06 * gust, 3, dt);
    this.s += this.speed * dt / b.length;
    this.offset = THREE.MathUtils.damp(this.offset, 0, 8, dt);
    b.load = THREE.MathUtils.clamp(this.s, 0, 1);
    b.pointAt(this.s, p.pos).addScaledVector(b.right, this.offset);

    // off either end: onto the rock there
    if (this.s < 0 || this.s > 1) {
      const solid = p.world.ground(p.pos.x, p.pos.z, p.pos.y + 0.3, 0.1);
      if (solid) {
        p.pos.y = solid.top;
        p.mode = 'ground';
        p.support = solid;
        p.tilt.angle = this.lean;
        p.vel.copy(b.dir).multiplyScalar(this.speed);
        this.leave();
        return;
      }
      this.s = THREE.MathUtils.clamp(this.s, 0, 1);
    }

    p.tilt.axis.copy(b.dir);
    p.tilt.angle = this.lean;
    p.turnTowards(Math.atan2(b.dir.x * this.facing, b.dir.z * this.facing), 10, dt);
    if (Math.abs(this.speed) > 0.03) {
      p.anim.play('Walk', 0.25);
      p.anim.setGaitSpeed(Math.abs(this.speed), { Walk: p.rig.walk_speed, Run: p.rig.run_speed });
    } else p.anim.play('Idle', 0.3);
  }

  // Lean too far and Mnot goes over the side.
  slip() {
    const p = this.player, b = this.beam, side = Math.sign(this.lean);
    p.mode = 'air';
    p.vy = 0.8;
    p.vel.copy(b.right).multiplyScalar(side * 1.0).addScaledVector(b.dir, this.speed);
    p.tilt.angle = this.lean;
    p.tilt.toppling = side;
    p.anim.play('Fall', 0.2);
    p.slipped = b;
    this.leave();
    p.emit('slip');
  }
}
