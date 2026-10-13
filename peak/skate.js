// Mnot on ice (ice.js). The speed keeps going and the keys only push a little, so stopping and turning take
// steering against the slide before you get there; each patch also tilts a little and pulls Mnot towards its low
// side when nothing holds it. Careful steps (Shift) grip better, but slowly.
// Fighting the slide fills a wobble meter (the HUD's balance meter shows it): pushing against it or across it, the
// more the faster Mnot goes, sliding too fast, a hard landing or a bump into a wall. It drains when Mnot calms
// down, quicker with careful steps. Full, and the feet go out from under it: a pratfall onto its back, a slide, and
// up again; near an edge the slide can carry on over it. Meanwhile the body rides the sliding feet like a spring,
// so the can leans and wobbles and pose.js windmills the arms.
// player.emit('skid', { speed }) when a skid starts, player.emit('pratfall') when the feet go.
import * as THREE from 'three';
import { bursts } from './bursts.js';
import { random } from './world.js';

const ACCEL = 2.6;          // m/s² the keys push with on ice
const TOP = 2.6;            // the keys don't push faster than this, a little faster than running
export const SLIDE_MAX = 3.2;   // never faster than this on ice (routedata.js bounds replays with it)
const FRICTION = 0.4;       // per second: a slide coasts on about speed / FRICTION metres
const CAREFUL = { grip: 3.5, drift: 0.25 };   // careful steps follow the keys at this rate, and are pulled less
// The meter: filled per metre slid while pushing against the slide (across it counts ACROSS as much), per m/s
// over FAST, per m/s of a bump or a landing; drained per second.
const FILL = 1.6, ACROSS = 0.35, FAST = { from: 2.1, fill: 1.0 }, BUMP = 0.15, LANDING = 0.03;
const DRAIN = { ice: 0.5, careful: 1.5, off: 3 };
const SPRING = { stiff: 30, damp: 2.8, push: 4 };     // the body on the feet (push: lean per m/s² of the feet)
const DOWN = { slip: 0.18, lie: 0.32, up: 0.35 };     // the pratfall's beats, seconds
const FLAT = 1.4;           // radians: lying on its back
const LEAN = 0.3;           // radians the can leans at a lean of 1
const CAN = 0.27;           // lying down, the can rests on its side this far up, not in the ice
const _push = new THREE.Vector3(), _a = new THREE.Vector3(), _f = new THREE.Vector3();

export class Skate {
  constructor(player) {
    this.player = player;
    this.rand = random(31);
    this.ice = null;                       // the patch underfoot
    this.meter = 0;                        // the wobble meter: 1 is a pratfall
    this.lean = new THREE.Vector3();       // which way the body leans, and how far
    this.leanVel = new THREE.Vector3();
    this.lastVel = new THREE.Vector3();
    this.down = 0;                         // seconds into a pratfall, 0 when on its feet
    this.downDir = new THREE.Vector3();
    this.from = 0;                         // the lean it went down from
    this.calm = 0;                         // just got up: no new pratfall for this long
    this.flail = 0;                        // 0..1 for pose.js: arms out and windmilling, panicky steps
    this.skidding = false;
    this.quiet = 1;                        // seconds since the last skid
    this.spray = 0;
    this.lift = 0;                         // the slab's thickness under the feet
    this.shown = 0;                        // the HUD shows the meter while this is above 0
    this.side = 1;
    // a landing on ice jolts it
    player.on('land', ({ impact, beam }) => {
      const { pos, world } = player;
      if (!beam && world.iceAt(pos.x, pos.z, pos.y)) this.meter += LANDING * impact;
    });
  }

  get busy() { return this.down > 0; }
  get tilting() { return this.down > 0 || this.player.icy && this.player.mode === 'ground'; }

  stop() {
    this.down = this.meter = this.lift = this.shown = 0;
    this.lean.set(0, 0, 0);
    this.leanVel.set(0, 0, 0);
  }

  // Instead of following the keys (player.js), the speed keeps going: on ice, or down on anything after a pratfall.
  // desired: the speed the keys ask for; top 0 means Mnot can't move just now (a hard landing).
  slide(dt, input, desired, ice, top) {
    const v = this.player.vel;
    this.ice = ice;
    if (this.down) {
      // down: no keys, sliding on, slowly stopping (quickly once off the ice)
      v.multiplyScalar(Math.exp(-(ice ? 2 : 8) * dt));
      if (ice) v.addScaledVector(ice.drift, dt);
      return;
    }
    if (input.careful) {
      v.lerp(desired, 1 - Math.exp(-CAREFUL.grip * dt)).addScaledVector(ice.drift, CAREFUL.drift * dt);
      return;
    }
    // the keys push, without the lane assist: holding the line on ice is up to the player
    const push = input.direction?.(input.held, _push, false) ?? _push.copy(input.move);
    if (top === 0) push.set(0, 0, 0);
    const speed = v.length();
    if (speed >= TOP && push.dot(v) > 0) push.addScaledVector(v, -push.dot(v) / (speed * speed));
    v.addScaledVector(push, ACCEL * dt).addScaledVector(ice.drift, dt).multiplyScalar(Math.exp(-FRICTION * dt));
    if (v.length() > SLIDE_MAX) v.setLength(SLIDE_MAX);
  }

  // After the move: the meter and the wobble, the pratfall, the skid and its spray of shavings.
  update(dt, input) {
    const p = this.player, onIce = p.icy && p.mode === 'ground';
    if (!onIce) this.ice = null;
    this.calm = Math.max(0, this.calm - dt);
    if (this.down) this.getUp(dt);
    else if (onIce) this.wobble(dt, input);
    else {
      this.meter = Math.max(0, this.meter - DRAIN.off * dt);
      this.lean.multiplyScalar(Math.exp(-6 * dt));
      this.leanVel.multiplyScalar(Math.exp(-8 * dt));
    }
    this.lastVel.copy(p.vel);
    this.shown = onIce || this.down ? 0.5 : Math.max(0, this.shown - dt);
    this.lift = THREE.MathUtils.damp(this.lift, this.ice ? this.ice.lift(p.pos.x, p.pos.z) : 0, 25, dt);
    const wobbly = onIce ? Math.max(0.25, this.meter, 1.4 * this.lean.length()) : 0;
    this.flail = THREE.MathUtils.damp(this.flail, this.down ? 0 : Math.min(1, wobbly), 8, dt);
    this.skid(dt, input, onIce);
  }

  wobble(dt, input) {
    const p = this.player, v = p.vel, speed = p.speed, careful = input.careful;
    // the meter: pushing against or across the slide, going too fast, a bump; it drains as Mnot calms down
    const push = careful ? null : input.direction?.(input.held, _push, false) ?? input.move;
    let fill = Math.max(0, speed - FAST.from) * FAST.fill;
    if (push?.lengthSq() > 0) {
      const against = Math.max(0, -push.dot(v)), across = Math.abs(push.x * v.z - push.z * v.x);
      fill += FILL * (against + ACROSS * across);
    }
    _a.subVectors(v, this.lastVel).setY(0);
    const bump = _a.length() > 0.3 ? BUMP * _a.length() / dt : 0;
    this.meter = Math.max(0, this.meter + (fill + bump) * dt - DRAIN[careful ? 'careful' : 'ice'] * dt);
    if (this.meter >= 1 && !this.calm && !p.jumpPhase) { this.pratfall(); return; }
    // the body lags behind the feet's push; the fuller the meter, the more it's jostled
    _a.divideScalar(dt).clampLength(0, 25);
    _f.copy(this.lean).multiplyScalar(-SPRING.stiff).addScaledVector(this.leanVel, -SPRING.damp)
      .addScaledVector(_a, -SPRING.push * (careful ? 0.4 : 1));
    this.leanVel.addScaledVector(_f, dt);
    const shake = 2.5 * this.meter * (careful ? 0.4 : 1);
    if (shake) {
      const a = 2 * Math.PI * this.rand();
      this.leanVel.x += Math.cos(a) * shake * Math.sqrt(dt);
      this.leanVel.z += Math.sin(a) * shake * Math.sqrt(dt);
    }
    this.lean.addScaledVector(this.leanVel, dt);
    // the can leans the way the body does
    const l = this.lean.length();
    if (l > 1e-3) p.tilt.axis.set(this.lean.z / l, 0, -this.lean.x / l);
    p.tilt.angle = LEAN * Math.min(l, 1.2);
  }

  // The meter's full: the feet go, the can lands on its back the way it leaned (or back from the slide), and slides.
  pratfall() {
    const p = this.player;
    this.down = 1e-6;
    if (this.lean.length() > 0.15) this.downDir.copy(this.lean).normalize();
    else if (p.speed > 0.2) this.downDir.copy(p.vel).setY(0).normalize().negate();
    else this.downDir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)).negate();
    this.from = p.tilt.axis.dot(_f.set(this.downDir.z, 0, -this.downDir.x)) * p.tilt.angle;
    this.meter = 0;
    this.lean.set(0, 0, 0);
    this.leanVel.set(0, 0, 0);
    p.tilt.axis.set(this.downDir.z, 0, -this.downDir.x);
    p.jumpBuffer = 0;
    p.anim.play('Fall', 0.08, { restart: true });
    p.emit('pratfall');
  }

  getUp(dt) {
    const p = this.player, { slip, lie, up } = DOWN, before = this.down, t = this.down += dt;
    if (p.mode !== 'ground') { this.down = 0; return; }       // slid off the edge, or onto a beam
    // the feet go out the other way, so it lands on its back
    if (t < slip) p.turnTowards(Math.atan2(-this.downDir.x, -this.downDir.z), 16, dt);
    if (before < slip && t >= slip) {
      bursts(p.world).snow(p.pos.clone().addScaledVector(this.downDir, 0.8), { puffs: 4, flakes: 6, grit: 0 });
    }
    if (before < slip + lie && t >= slip + lie) p.anim.play('Idle', 0.25);
    let angle = 0;
    if (t < slip) angle = this.from + (FLAT - this.from) * (1 - (1 - t / slip) ** 2);
    else if (t < slip + lie) angle = FLAT + 0.08 * Math.sin((t - slip) * 28) * Math.exp(-(t - slip) * 9);
    else if (t < slip + lie + up) angle = FLAT * (1 - THREE.MathUtils.smootherstep(t, slip + lie, slip + lie + up));
    else {
      this.down = 0;
      this.calm = 0.8;
    }
    p.tilt.angle = angle;
  }

  // Skidding: sliding with the feet planted, or pushing across or against the slide. Shavings fly from the feet.
  skid(dt, input, onIce) {
    const p = this.player, speed = p.speed;
    const across = p.moving && input.move.dot(p.vel) < 0.75 * speed;
    const skidding = onIce && !this.down && speed > 0.45 && (!p.moving || across || input.careful);
    if (skidding && !this.skidding && this.quiet > 0.35) p.emit('skid', { speed });
    this.skidding = skidding;
    this.quiet = skidding ? 0 : this.quiet + dt;
    if (!(skidding || this.down && speed > 0.3)) return;
    if ((this.spray -= dt) > 0) return;
    this.spray = 0.075 - 0.025 * Math.min(1, speed / 2);
    const feet = p.pos.clone();
    feet.y += this.lift;
    bursts(p.world).shavings(feet, p.vel);
  }

  // Lying down the can rests on its side; on ice, it stands on the slab.
  place(root) {
    root.position.y += this.lift + (this.down ? CAN * Math.sin(this.player.tilt.angle) : 0);
  }

  // For the HUD: the meter, on the side the body leans as seen on screen (-1 left, 1 right), or null off the ice.
  meterOnScreen(forward) {
    if (this.shown <= 0) return null;
    const l = this.lean.length(), side = this.lean.x * -forward.z + this.lean.z * forward.x;
    if (Math.abs(side) > 0.3 * l && l > 0.02) this.side = Math.sign(side);
    return Math.min(1, this.down ? 1 : this.meter) * this.side;
  }
}
