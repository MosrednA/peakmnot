// The ride: the chair's physics, with nothing scripted. The star rolls on casters that swivel freely, so it rolls
// every way alike: gravity takes it down the slope, rolling resistance and the air slow it, Mnot's feet push it
// sideways to steer and dig in to brake, the gas lift pops it up for a jump, and it flies on true parabolas over
// crests and kickers.
//
// The seat turns freely on its swivel, and how it turns is physics too. With Mnot in it, it is a pendulum about the
// swivel: its centre of mass sits behind the axis (the backrest), so every push on the chair swings it (the rolling
// resistance alone settles the backrest downhill, so Mnot rides backwards, facing the camera), the feet's pushes act
// in front of the axis and turn it, a crash or a snowman knocks it round, and only the swivel's bearing slowly calms
// it. Its angular momentum is kept as its inertia changes: arms flung out, it spins slower; in again, faster.
import * as THREE from 'three';
import { CHAIR } from './chair.js';
import { FEATURES } from './track.js';
import { pineReach } from './obstacles.js';

export const G = 15;
export const FEEL = {
  roll: { piste: 0.035, bank: 0.14, powder: 0.32, ice: 0.006 },    // rolling resistance, as a share of the weight
  steer: { piste: 7, bank: 5.5, powder: 4, ice: 1.2, air: 1.4 },   // m/s²: how hard the feet push sideways
  brake: { piste: 0.6, bank: 0.7, powder: 0.8, ice: 0.12 },        // feet down: the drag, as a share of the weight
  drag: 0.0085, tuck: 0.0055,     // air drag per metre (sitting up, tucked in)
  push: 3.2, pushTop: 4,          // m/s²: paddling with the feet, while slower than pushTop
  jump: 5.4,                      // m/s up from the gas lift
  stick: 0.001,                   // m: how far a crest may fall away under a rolling chair before it flies
  wall: 0.35,                     // m: a rise steeper than this within a step is a wall
  bounce: 5.5,                    // m/s into the snow from which a landing bounces
  hard: 10,                       // m/s into the snow from which a landing costs a wheel
  restitution: 0.25, grip: 0.4,   // crashes: how much bounces back, and the friction along the obstacle
  crash: 6.5,                     // m/s of impulse from which a crash costs a wheel
  scrape: 0.05,                   // extra drag per missing wheel: a bare leg end in the snow
  // the seat on its swivel (per kg of seat and Mnot)
  offset: 0.1,                    // m: the centre of mass behind the swivel
  feet: 0.36, feetShare: 0.22,    // m: the feet in front of it, and the share of their push that turns the seat
  brakeShare: 0.3, brakeCalm: 2.5,   // braking feet: their drag's share on the seat, and how they stop a spin
  inertia: 0.12, arms: 0.1,       // m²: the seat with Mnot, and how much more with the arms flung out
  bearing: 0.035, stiction: 0.012,   // the swivel: viscous and dry friction
  catch: 0.35,                    // the share of a crash's twist that the seat catches (legs, armrests)
  snowSpin: 0.12,                 // how much a snowman hitting the seat off-centre turns it
  baseInertia: 0.15, scrub: 3,    // the star: its inertia, and how fast its casters scrub its turning out
  lift: { k: 420, c: 20, give: 0.12 },   // the gas spring
  rock: { k: 180, c: 12, lean: 0.25 },   // the seat rocking on its mechanism
};

export const BODY = 0.3;          // m: Mnot's can and the armrests, out from the swivel
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _t = new THREE.Vector3();
const _prev = new THREE.Vector3(), _old = new THREE.Vector3(), _steer = new THREE.Vector3(), _along = new THREE.Vector3();
const _w = new THREE.Vector3();
const frame = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() };

export class Ride {
  constructor(track, obstacles) {
    this.track = track;
    this.obstacles = obstacles;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);        // the star's up: the swivel's axis
    this.tiltQ = new THREE.Quaternion();
    this.feel = new THREE.Vector3(0, -G, 0);      // gravity as the chair feels it: g minus its acceleration
    this.under = { normal: new THREE.Vector3() };
    this.rock = { x: 0, z: 0, vx: 0, vz: 0 };
    this.wheels = new Array(CHAIR.legs).fill(true);
    this.listeners = new Map();
    this.checkpoint = FEATURES.pits[0];
    this.armsOut = 0;                             // set by the rider each frame
    this.time = 0;
    this.reset(this.checkpoint);
  }

  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(fn); }
  emit(name, data = {}) { for (const fn of this.listeners.get(name) ?? []) fn(data); }

  get missing() { return this.wheels.filter(w => !w).length; }
  get speed() { return this.vel.length(); }
  get seatSpin() { return this.seatL / this.inertia; }
  get inertia() { return FEEL.inertia + FEEL.arms * this.armsOut; }

  // On the snow at s, still, the seat turned to face up the hill (the camera), the wheels as they were.
  reset(s, { wheels = false } = {}) {
    this.track.frame(s, frame);
    this.hint = this.track.locate(frame.pos.x, frame.pos.z).i;
    this.pos.copy(frame.pos);
    this.pos.y = this.track.height(s, 0);
    this.vel.set(0, 0, 0);
    this.track.ground(this.pos.x, this.pos.z, this.hint, this.under);
    this.up.copy(this.under.normal);
    this.tiltQ.setFromUnitVectors(UP, this.up);
    this.grounded = true;
    this.airTime = 0;
    this.s = s; this.d = 0;
    this.seatYaw = Math.atan2(-frame.tangent.x, -frame.tangent.z);
    this.seatL = 0;
    this.baseYaw = this.seatYaw + 0.3;
    this.baseSpin = 0;
    this.lift = 0; this.liftVel = 0; this.lever = 0; this.crouch = -1;
    Object.assign(this.rock, { x: 0, z: 0, vx: 0, vz: 0 });
    this.feel.set(0, -G, 0);
    this.out = false;                             // fallen into the crevasse, the river or off the edge
    this.outTime = 0;
    this.sunk = false;                            // the river: it sinks slowly
    this.flight = null;                           // off the ski jump, until it lands
    if (wheels) this.wheels.fill(true);
  }

  // One step of dt seconds (1/120 s). intent: { steer -1..1, push, tuck, brake, jump }.
  step(dt, intent) {
    if (!(dt > 0)) return;
    const track = this.track, vel = this.vel, pos = this.pos, under = this.under;
    if (this.out) {
      if (this.sunk) vel.multiplyScalar(Math.exp(-5 * dt)).y -= 1.5 * dt;
      else vel.y -= G * dt;
      pos.addScaledVector(vel, dt);
      this.outTime += dt;
      if (this.started && !this.done) this.time += dt;   // a fall costs its time on the clock too
      this.spinSeat(dt, false, null, 0);
      return;
    }
    const N = under.normal, surface = under.surface;
    track.frame(this.s, frame);
    // the feet's push to steer: along the snow, across the piste
    const steer = _steer.copy(frame.right);
    if (this.grounded) steer.addScaledVector(N, -steer.dot(N)).normalize();
    steer.multiplyScalar(THREE.MathUtils.clamp(intent.steer, -1, 1) * (this.grounded ? FEEL.steer[surface] : FEEL.steer.air));
    const acc = _b.set(0, -G, 0).add(steer);
    const speed = vel.length();
    acc.addScaledVector(vel, -(intent.tuck ? FEEL.tuck : FEEL.drag) * speed);
    let braking = 0;
    const along = _along.set(0, 0, 0);            // the way it rolls, along the snow
    if (this.grounded) {
      along.copy(vel).addScaledVector(N, -vel.dot(N));
      const rolling = along.length();
      if (rolling > 1e-4) along.divideScalar(rolling);
      const weight = G * N.y;
      braking = intent.brake ? FEEL.brake[surface] * weight : 0;
      // friction slows it, but never past standing still
      const friction = Math.min((FEEL.roll[surface] + FEEL.scrape * this.missing) * weight + braking, rolling / dt);
      if (rolling > 1e-4) acc.addScaledVector(along, -friction);
      braking = Math.min(braking, friction);
      if (intent.push && rolling < FEEL.pushTop) {
        _d.copy(frame.tangent).addScaledVector(N, -frame.tangent.dot(N)).normalize();
        acc.addScaledVector(_d, FEEL.push);
      }
    }
    _prev.copy(vel);
    vel.addScaledVector(acc, dt);
    const wasGrounded = this.grounded;
    this.jumpStep(dt, intent);

    // move, and see what's under the new spot
    _old.copy(pos);
    pos.addScaledVector(vel, dt);
    track.ground(pos.x, pos.z, this.hint, under);
    this.hint = under.i;
    this.s = under.s;
    this.d = under.d;
    if (under.y > pos.y + FEEL.wall && under.y > _old.y + FEEL.wall) {
      this.hitWall(_old);
      // what's under it is where it was put back: beside a floe or the crevasse's far wall, the hole it falls in
      // (else it would slide down the wall, a step at a time, never falling out)
      track.ground(pos.x, pos.z, this.hint, under);
      this.hint = under.i;
      this.s = under.s;
      this.d = under.d;
    } else if (pos.y <= under.y + (this.grounded ? FEEL.stick : 0)) {
      const vn = vel.dot(under.normal);
      const impact = -vn;
      if (vn < 0) vel.addScaledVector(under.normal, -vn);
      pos.y = under.y;
      if (!this.grounded) { this.land(impact); this.airTime = 0; }
      this.grounded = true;
      if (impact > FEEL.bounce) {
        vel.addScaledVector(under.normal, impact * 0.16);
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    // off the ski jump's lip: a flight, measured when it lands
    const lip = FEATURES.jump.lip;
    if (wasGrounded && !this.grounded && this.s > lip - 6 && this.s < lip + 2) this.flight = { time: 0, top: pos.y };
    if (this.flight) { this.flight.time += dt; this.flight.top = Math.max(this.flight.top, pos.y); }
    this.collide();
    if (under.hole && pos.y < under.rim - 1.2) this.fallOut();

    // what the chair felt this step, for the seat
    this.feel.set(0, -G, 0).addScaledVector(_d.subVectors(vel, _prev), -1 / dt);
    if (this.grounded) this.up.lerp(under.normal, 1 - Math.exp(-14 * dt)).normalize();
    this.tiltQ.setFromUnitVectors(UP, this.up);
    this.spinSeat(dt, this.grounded, steer, braking, along);
    this.springs(dt);
    this.progress(dt);
  }

  // The gas lift: a quick crouch (the seat sinks as the lever goes), then it pops the chair up off the snow. Pulled
  // right at an edge, it still pops a moment after the snow has gone (so a floe's edge isn't a lottery).
  jumpStep(dt, intent) {
    if (intent.jump && this.grounded && this.crouch < 0) { this.crouch = 0; this.lever = 1; }
    if (this.crouch >= 0) {
      this.crouch += dt;
      if (this.crouch >= 0.07) {
        this.crouch = -1;
        if (this.grounded || this.airTime < 0.1) {
          this.vel.addScaledVector(this.under.normal, FEEL.jump);
          this.liftVel += 1.6;
          this.grounded = false;
          this.emit('jump');
        }
      }
    }
    this.lever = Math.max(0, this.lever - dt * 3);
  }

  land(impact) {
    this.emit('land', { impact, at: this.pos.clone(), air: this.airTime });
    if (this.flight) {
      // a ski jump's distance: from the lip to where it came down, in a straight line
      const lip = this.track.point(FEATURES.jump.lip, 0, _t);
      this.emit('flight', { distance: this.pos.distanceTo(lip), impact, time: this.flight.time });
      this.flight = null;
    }
    if (impact > FEEL.hard) this.loseWheel(_a.set(0, -1, 0), 'landing');
  }

  // Something too steep to roll up (the crevasse's far wall, a cliff, the gorge's rock): back to where it was, bounced
  // off it, and the rock's friction takes speed along it too, as a tree's or a rock's does.
  hitWall(old) {
    this.emit('wall');                            // for the recorder: this step went nowhere (record.js)
    const n = _a.copy(this.under.normal);
    n.y = 0;
    if (n.lengthSq() < 1e-6) n.copy(this.vel).setY(0).negate();
    n.normalize();
    this.pos.x = old.x; this.pos.z = old.z;
    const vn = this.vel.dot(n);
    if (vn < 0) {
      const J = -(1 + FEEL.restitution) * vn, t = _w.set(-n.z, 0, n.x), vt = this.vel.dot(t);
      this.vel.addScaledVector(n, J).addScaledVector(t, -Math.sign(vt) * Math.min(FEEL.grip * J, Math.abs(vt)));
      if (-vn > FEEL.crash) this.loseWheel(n.clone().negate(), 'wall');
      if (-vn > 0.6) this.emit('crash', { impulse: -vn, kind: 'wall', at: this.pos.clone() });
    }
  }

  // Rocks and trees are hard: the chair bounces off with friction along them, which twists the star and the seat.
  // Snowmen are soft: they burst, slow the chair and, hit off-centre, send the seat spinning.
  collide() {
    const pos = this.pos, vel = this.vel;
    for (const o of this.obstacles.near(this.s)) {
      if (o.gone || pos.y > o.top - 0.05) continue;
      let r = o.r, body = CHAIR.radius;
      if (o.kind === 'rock') {
        const dy = THREE.MathUtils.clamp(o.y, pos.y + 0.08, pos.y + 1.4) - o.y;
        if (Math.abs(dy) >= o.r) continue;
        r = Math.sqrt(o.r * o.r - dy * dy);
      } else if (o.kind === 'tree') {
        // the branches at Mnot's height (from the seat to the top of the can) meet the can and the armrests; the
        // trunk, the star of casters
        const branches = pineReach(o, pos.y - o.y + 0.45, pos.y - o.y + 1.6);
        r = Math.max(branches + BODY, pineReach(o, pos.y - o.y, pos.y - o.y + 0.45) + CHAIR.radius) - body;
      }
      const dx = pos.x - o.x, dz = pos.z - o.z, dist = Math.hypot(dx, dz), reach = r + body;
      if (dist >= reach || dist < 1e-6) continue;
      const n = _a.set(dx / dist, 0, dz / dist);
      const vn = vel.dot(n);
      if (o.soft) {
        if (vn >= 0) continue;
        // it hits the seat at its offset from the axis, pushing back along the way it came
        const offset = _c.set(o.x - pos.x, 0, o.z - pos.z);
        const hit = _d.copy(vel).setY(0).multiplyScalar(-0.55);
        this.seatL += offset.cross(hit).y * FEEL.snowSpin / 0.55;
        // a snowman takes half the speed into it; a light thing (o.take) less
        vel.addScaledVector(n, -vn * (o.take ?? 0.5)).multiplyScalar(o.take ? 0.98 : 0.92);
        this.obstacles.burst(o, vel, n, -vn);
        this.emit('bump', { kind: o.kind, at: new THREE.Vector3(o.x, o.y, o.z) });
        continue;
      }
      pos.addScaledVector(n, reach - dist);
      if (vn >= 0) continue;
      const J = -(1 + FEEL.restitution) * vn;
      const t = _c.set(-n.z, 0, n.x), vt = vel.dot(t);
      const Jt = -Math.sign(vt) * Math.min(FEEL.grip * J, Math.abs(vt));
      vel.addScaledVector(n, J).addScaledVector(t, Jt);
      // the friction acts at the rim, where it touched: a twist about the axis
      const twist = _d.copy(n).multiplyScalar(-CHAIR.radius).cross(t).y * Jt;
      this.baseSpin += twist / FEEL.baseInertia;
      this.seatL += twist * FEEL.catch;
      if (J > FEEL.crash) this.loseWheel(n.clone().negate(), o.kind);
      // leaning on it (pushed into it by the slope) is no crash
      if (J > 0.6) this.emit('crash', { impulse: J, kind: o.kind, at: new THREE.Vector3(o.x, pos.y + 0.5, o.z) });
    }
  }

  // The caster closest to where the blow came from comes off.
  loseWheel(from, cause) {
    let best = -1, bestDot = -Infinity;
    this.wheels.forEach((on, i) => {
      if (!on) return;
      const a = this.baseYaw + i / CHAIR.legs * Math.PI * 2;
      const dir = _t.set(Math.sin(a), 0, Math.cos(a)).applyQuaternion(this.tiltQ);
      const dot = from.y < -0.9 ? -dir.y + Math.random() * 0.01 : dir.dot(from);
      if (dot > bestDot) { bestDot = dot; best = i; }
    });
    if (best < 0) return;
    this.wheels[best] = false;
    this.emit('wheel', { index: best, cause, left: CHAIR.legs - this.missing });
    if (this.missing === CHAIR.legs) this.emit('wrecked');
  }

  fallOut() {
    this.out = true;
    this.outTime = 0;
    this.sunk = !!this.under.water;
    this.emit('lost', { at: this.pos.clone(), water: this.sunk });
  }

  // The seat on its swivel: torques from the pendulum, the feet and the bearing, on its angular momentum.
  spinSeat(dt, grounded, steer, braking, along) {
    const n = this.up, I = this.inertia;
    const forward = _a.set(Math.sin(this.seatYaw), 0, Math.cos(this.seatYaw)).applyQuaternion(this.tiltQ);
    // the centre of mass behind the axis, pulled by what the chair feels
    let torque = _d.copy(forward).multiplyScalar(-FEEL.offset).cross(this.feel).dot(n);
    if (grounded && steer) {
      // the feet push the snow in front of the axis; braking, they drag there
      torque += _d.copy(forward).multiplyScalar(FEEL.feet).cross(steer).dot(n) * FEEL.feetShare;
      if (braking > 0) {
        torque += _d.copy(forward).multiplyScalar(FEEL.feet).cross(_t.copy(along).multiplyScalar(-braking)).dot(n) * FEEL.brakeShare;
        this.seatL *= Math.exp(-FEEL.brakeCalm * dt);
      }
    }
    // the bearing: viscous, and dry friction that never more than stops it
    const rel = this.seatL / I - this.baseSpin;
    let bearing = -FEEL.bearing * rel;
    bearing -= Math.sign(rel) * Math.min(FEEL.stiction, Math.abs(rel) * I / dt);
    this.seatL += (torque + bearing) * dt;
    this.seatYaw += this.seatL / I * dt;
    // the star: the bearing's reaction, its casters scrubbing, and bare leg ends dragging in the snow
    let twist = -bearing;
    if (grounded && this.missing) {
      this.wheels.forEach((on, i) => {
        if (on) return;
        const a = this.baseYaw + i / CHAIR.legs * Math.PI * 2;
        const leg = _d.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(CHAIR.reach).applyQuaternion(this.tiltQ);
        twist += leg.cross(_t.copy(this.vel).normalize().multiplyScalar(-FEEL.scrape * G)).dot(n);
      });
    }
    this.baseSpin += twist / FEEL.baseInertia * dt;
    this.baseSpin *= Math.exp(-(grounded ? FEEL.scrub : 0.3) * dt);
    this.baseYaw += this.baseSpin * dt;
  }

  // The gas spring under the seat, and the seat rocking on its mechanism, both pushed by what the chair feels.
  springs(dt) {
    const L = FEEL.lift, n = this.up;
    const load = -this.feel.dot(n) - G;           // more than its weight on landing, less in the air
    const target = this.crouch >= 0 ? -0.06 : 0;
    this.liftVel += (-L.k * (this.lift - target) - L.c * this.liftVel - load * L.give) * dt;
    this.lift = THREE.MathUtils.clamp(this.lift + this.liftVel * dt, -0.09, 0.08);
    // the feel in the seat's frame: it rocks its top away from the pull, a little
    _q.copy(this.tiltQ).multiply(_q2.setFromAxisAngle(UP, this.seatYaw)).invert();
    const f = _a.copy(this.feel).applyQuaternion(_q), down = Math.max(2, -f.y), R = FEEL.rock, r = this.rock;
    const wantX = THREE.MathUtils.clamp(Math.atan2(-f.z, down) * R.lean, -0.25, 0.25);
    const wantZ = THREE.MathUtils.clamp(Math.atan2(f.x, down) * R.lean, -0.25, 0.25);
    r.vx += (R.k * (wantX - r.x) - R.c * r.vx) * dt;
    r.vz += (R.k * (wantZ - r.z) - R.c * r.vz) * dt;
    r.x += r.vx * dt; r.z += r.vz * dt;
  }

  // The clock, the pit stops and the finish, as the chair passes them.
  progress(dt) {
    if (!this.started && this.s > FEATURES.gate) { this.started = true; this.emit('start'); }
    if (this.started && !this.done) this.time += dt;
    for (const pit of FEATURES.pits) {
      if (pit > this.checkpoint && this.s > pit) {
        this.checkpoint = pit;
        this.wheels.fill(true);
        this.emit('pit', { s: pit });
      }
    }
    if (!this.done && this.s > FEATURES.finish) { this.done = true; this.emit('finish', { time: this.time }); }
  }
}
