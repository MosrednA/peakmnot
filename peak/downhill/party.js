// The finish party: once the chair has stopped past the line, Mnot celebrates the office way, in a loop of two bars
// at 120 BPM. Bar one: the gas lift pumps like a lowrider's hydraulics, the chair hopping on every beat, while Mnot
// raises the roof. Bar two: two spins on the swivel, arms and legs flung out, a sheaf of paper and sticky notes thrown
// up (main.js throws it), then a shimmy, the seat twisting left and right under Mnot's hands on the armrests.
// It poses on top of the ride: main.js puts the seat's yaw, the lift and the chair's hop where this says, after the
// physics, and the rider (rider.js) does the arms and legs. It dances on the music's beat (music.js loopTime(), the
// run's tune playing on through the finish): the first beat lands on one of the tune's, and the dance is eased back
// onto them if it drifts; while the music is off, it keeps its own time.
import * as THREE from 'three';

const BEAT = 0.5;                 // s: 120 BPM, the run's tune
const LOOP = 8;                   // beats
const TURN = 0.8;                 // s to swing round to the camera before the first beat
const ease = x => THREE.MathUtils.smootherstep(x, 0, 1);

export class Party {
  constructor() { this.reset(); }

  reset() {
    this.t = -1;                  // seconds since the party began, -1 before
    this.b = 0;                   // beats into the dance, negative while it swings round to the camera
    this.lead = 1;                // the beats that swing took
    this.from = 0;                // the seat's yaw when it began, and the one facing the camera
    this.face = 0;
    this.beat = -1;
    this.lastHop = 0;
    this.pose = { yaw: 0, spin: 0, lift: 0, hop: 0, roof: 0, pump: 0, out: 0, legs: 0, paper: false, landed: 0 };
  }

  get on() { return this.t >= 0; }

  // The pose for this frame, or null while there's no party (yet). clock: seconds into the music's loop, or null.
  update(dt, ride, camera, clock = null) {
    const tune = clock === null ? null : clock / BEAT;
    if (!this.on) {
      if (!ride.done || ride.out || !ride.grounded || ride.speed > 0.3) return null;
      this.t = 0;
      this.from = ride.seatYaw;
      // facing the camera, the way round that's nearest
      const face = Math.atan2(camera.position.x - ride.pos.x, camera.position.z - ride.pos.z);
      this.face = this.from + Math.atan2(Math.sin(face - this.from), Math.cos(face - this.from));
      // the swing round ends on the tune's next beat after TURN
      this.b = tune === null ? -TURN / BEAT : -(Math.ceil(tune + TURN / BEAT) - tune);
      this.lead = -this.b;
    } else {
      this.b += dt / BEAT;
      // back onto the beat, gently (never so hard it runs backwards)
      if (tune !== null) { const off = tune - this.b; this.b += (off - Math.round(off)) * Math.min(1, 3 * dt); }
    }
    this.t += dt;
    const p = this.pose, yaw = p.yaw;
    p.paper = false;
    p.landed = 0;
    Object.assign(p, { lift: 0, hop: 0, roof: 0, pump: 0, out: 0, legs: 0 });
    if (this.b < 0) {
      p.yaw = this.from + (this.face - this.from) * ease(Math.min(1, (1 - -this.b / this.lead) * this.lead * BEAT / TURN));
      p.spin = 0;
      return p;
    }
    const b = this.b, at = b % LOOP, k = Math.floor(at), u = at - k;
    const beat = Math.floor(b);
    const fresh = beat !== this.beat;
    this.beat = beat;
    // every loop's spins wind on from the last, so the yaw never jumps back
    p.yaw = this.face + 4 * Math.PI * Math.floor(b / LOOP);
    if (at < 4) {
      // the hydraulics: down on the beat, then up, and the whole chair off the snow; a bigger hop on the fourth
      p.lift = u < 0.12 ? -0.07 * ease(u / 0.12) : -0.07 + 0.15 * ease(Math.min(1, (u - 0.12) / 0.14));
      const x = (u - 0.18) / 0.5, high = k === 3 ? 0.3 : 0.17;
      if (x > 0 && x < 1) p.hop = 4 * high * x * (1 - x);
      p.yaw += 0.16 * Math.sin(Math.PI * u) * (k % 2 ? 1 : -1);
      p.roof = 1;
      p.pump = 1 - ease(Math.min(1, u * 2.5));
      p.legs = 0.25 * Math.sin(Math.PI * u) * (k % 2 ? 1 : -1);
    } else if (at < 6) {
      // two turns on the swivel, flung out, paper everywhere
      if (fresh && k === 4) p.paper = true;
      p.yaw += 4 * Math.PI * ease((at - 4) / 2);
      p.out = 1;
      p.lift = 0.06;
    } else {
      // the shimmy: four twists, hands on the armrests, the legs swinging the other way
      const w = Math.sin(2 * Math.PI * (at - 6) * 2);
      p.yaw += 4 * Math.PI + 0.5 * w;
      p.legs = -0.45 * w;
      p.lift = 0.02 * Math.abs(w);
    }
    p.spin = dt > 0 ? (p.yaw - yaw) / dt : 0;
    // a hop that came down: the can squashes on it
    if (this.lastHop > 0 && p.hop === 0) p.landed = 3;
    this.lastHop = p.hop;
    return p;
  }
}
