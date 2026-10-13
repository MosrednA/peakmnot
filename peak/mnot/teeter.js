// Teetering on the very edge of a drop. Left standing right at a rock's rim, or shoved there by the wind, Mnot turns to
// face the drop and rocks out over it and back with its arms wheeling (the Teeter clip), and goes over unless the
// player steps back in time or holds on with Shift. Walking or running off an edge, jumping from it, careful steps,
// ice and moving platforms never teeter, so it never gets in the way of a run-up and a jump.
import * as THREE from 'three';

const TIME = 1.1;          // seconds of teetering before Mnot goes over
const RIM = 0.04;          // how far past the edge the feet are (they may stand EDGE past it) before Mnot teeters
const PROBE = 0.25;        // how far out past the feet to look for the drop
const DROP = 1.2;          // a rock out there less than this below the feet is a step down, not a drop
// as in player.js: the feet may stand EDGE past a rock's edge, the can is HEIGHT tall and steps STEP_UP up, and
// stepping off within BEAM_CATCH of a plank or rope's end gets onto it
const EDGE = 0.1, STEP_UP = 0.26, HEIGHT = 1.6, BEAM_CATCH = 0.6;
const STILL = 0.3;         // m/s: slower than this is standing still
const SLOW = 1.0;          // m/s: drifting out over the edge slower than this is being shoved, not walking off
const INTENT = 0.3;        // how much of the keys must point back in (or out) to count
const OVER = 0.9;          // m/s out over the edge when Mnot goes
const CALM = 0.4;          // seconds after a save before the next teeter
const GUST = 1.0;          // a shove out over the edge runs the time out this much faster per m/s
const CLIP = 0.8;          // seconds: the Teeter clip's loop, which the can's rocking keeps time with

export class Teeter {
  constructor(player) {
    this.player = player;
    this.active = false;
    this.time = 0;             // towards TIME, faster in a shove
    this.age = 0;              // seconds since it started, which the rocking keeps time with
    this.calm = 0;
    this.out = new THREE.Vector3();      // the way to the drop
  }

  stop() { this.active = false; }

  // Whether a teeter may start: standing on solid, still rock, not jumping, on ice or holding on.
  allowed(input) {
    const p = this.player, s = p.support;
    return this.calm <= 0 && !input.careful && !p.jumpPhase && !p.icy && !p.skate.busy && !!s && !s.moving && !s.off;
  }

  // Whether there's a real drop out past (x, z): no rock out there within DROP below the feet (or a wall to bump
  // into; a rock overhead doesn't count), and no plank or rope to step onto.
  drop(x, z, y, out) {
    const w = this.player.world, px = x + out.x * PROBE, pz = z + out.z * PROBE;
    for (const s of w.solids) {
      if (s.off || s.top <= y - DROP || s.bottom >= y + HEIGHT || !s.near(px, pz, 0)) continue;
      if (s.closest(px, pz).d <= 0) return false;
    }
    return !w.beam(px, pz, y - DROP, y + STEP_UP, BEAM_CATCH);
  }

  // On the ground and standing still with the feet past the rim of a drop: start teetering.
  rim(dt, input) {
    const p = this.player;
    this.calm = Math.max(0, this.calm - dt);
    if (this.active || p.moving || p.speed > STILL || !this.allowed(input)) return;
    const c = p.support.closest(p.pos.x, p.pos.z);
    if (c.d > RIM && this.drop(p.pos.x, p.pos.z, p.pos.y, this.out.set(c.nx, 0, c.nz))) this.start();
  }

  // Just gone over the edge (player.followGround): with no keys held and only drifting, back onto the rim to teeter
  // instead. Returns true if it caught Mnot.
  overEdge(input, before) {
    const p = this.player;
    if (p.moving || !this.allowed(input)) return false;
    const c = p.support.closest(p.pos.x, p.pos.z);
    this.out.set(c.nx, 0, c.nz);
    if (p.vel.dot(this.out) > SLOW || !this.drop(p.pos.x, p.pos.z, p.pos.y, this.out)) return false;
    p.pos.copy(before);
    this.start();
    return true;
  }

  start() {
    const p = this.player;
    this.active = true;
    this.time = this.age = 0;
    p.vel.set(0, 0, 0);
    p.anim.play('Teeter', 0.12, { restart: true });
    p.emit('teeter');
  }

  // While teetering (player.move): stepping back in or holding on saves Mnot, keys out over the edge or running out
  // of time send it over. Returns true while it holds Mnot on the rim, so the step doesn't move it.
  hold(dt, input, wind, push) {
    const p = this.player, out = this.out;
    const toward = input.move.x * out.x + input.move.z * out.z;
    if (toward < -INTENT || input.careful) {
      this.active = false;
      this.calm = CALM;
      p.emit('steady');
      return false;
    }
    this.time += dt * (1 + GUST * Math.max(0, push * (wind.dir.x * out.x + wind.dir.z * out.z)));
    if (toward > INTENT || this.time >= TIME || p.support?.off) { this.over(); return true; }
    this.age += dt;
    p.vel.set(0, 0, 0);
    p.turnTowards(Math.atan2(out.x, out.z), 10, dt);
    // the whole can tips out over the edge and back about its feet, further the longer it goes on
    const k = this.time / TIME;
    p.tilt.axis.set(out.z, 0, -out.x);
    p.tilt.angle = (0.06 + 0.16 * k) * (0.7 + 0.3 * Math.sin(2 * Math.PI * this.age / CLIP));
    return true;
  }

  // Over the edge: out into the air at a stumble, toppling (player.updateTilt) and flailing (pose.js) as it goes. The
  // feet go just past where the rock still holds them, so it can't catch Mnot again.
  over() {
    const p = this.player, s = p.support;
    this.active = false;
    if (s && !s.off) p.pos.addScaledVector(this.out, Math.max(0, EDGE + 0.02 - s.closest(p.pos.x, p.pos.z).d));
    p.mode = 'air';
    p.support = null;
    p.vy = 0;
    p.coyote = 0;
    p.vel.copy(this.out).multiplyScalar(OVER);
    p.tilt.axis.set(this.out.z, 0, -this.out.x);
    p.tilt.toppling = 1;
    p.last.teeter = true;
    p.anim.play('Fall', 0.2);
  }
}
