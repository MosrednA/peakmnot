// Bowling with cheap chairs: ten knock-offs stand like pins at the end of the lane (track.js FEATURES.pins). The
// chair knocks them flying, and they knock each other over: each is a ball, for the collisions, that tumbles as it
// flies, bounces and slides on the snow, and settles on its side. A standing pin is still until something hits it.
// The score is how many went down, told (onScore) once they have had a moment to fall.
import * as THREE from 'three';
import { knockoff, KNOCKOFF } from './office.js';
import { FEATURES } from './track.js';

const GRAVITY = 15;
const MASS = 0.2;                 // a pin's mass, as a share of the chair with Mnot on it
const RESTITUTION = 0.45;         // how much bounces back, chair on pin and pin on pin
const GAP = 1.1;                  // metres between neighbouring pins
export const SETTLE = 2.6;        // seconds after the first pin goes, the score is in

const UP = new THREE.Vector3(0, 1, 0), NONE = new THREE.Quaternion();
const _n = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Pins {
  constructor(track, obstacles, rand) {
    this.track = track;
    this.rand = rand;
    this.list = [];
    this.probe = { normal: new THREE.Vector3() };
    this.onScore = null;
    // the triangle: one pin at the head, then two, three and four, pointing up the lane
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) {
      const s = FEATURES.pins + row * GAP * 0.866, d = (k - row / 2) * GAP;
      const foot = track.point(s, d), t = track.frame(s).tangent;
      const pin = { mesh: knockoff(), foot, home: new THREE.Quaternion(), pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        spin: new THREE.Vector3(), loose: false, hint: -1 };
      // facing up the lane, at whoever is coming, each a little askew
      pin.home.setFromAxisAngle(UP, Math.atan2(-t.x, -t.z) + (rand() - 0.5) * 0.5);
      obstacles.group.add(pin.mesh);
      pin.o = obstacles.add({ kind: 'pin', soft: true, x: foot.x, y: foot.y, z: foot.z, r: KNOCKOFF.radius,
        top: foot.y + KNOCKOFF.height, mesh: pin.mesh, take: (1 + RESTITUTION) * MASS / (1 + MASS),
        hit: (o, vel, n, speed) => this.knock(pin, vel, n, speed) });
      this.list.push(pin);
    }
    this.reset();
  }

  get down() { return this.list.filter(p => p.loose).length; }

  // All ten standing again.
  reset() {
    for (const pin of this.list) {
      pin.loose = false;
      pin.o.gone = false;
      pin.pos.copy(pin.foot).setY(pin.foot.y + KNOCKOFF.middle);
      pin.vel.set(0, 0, 0);
      pin.spin.set(0, 0, 0);
      pin.mesh.position.copy(pin.pos);
      pin.mesh.quaternion.copy(pin.home);
      pin.mesh.visible = true;
    }
    this.time = 0;
    this.first = -1;
    this.told = false;
  }

  // The chair hits a pin: n points from the pin to the chair, speed is how fast the chair came at it.
  knock(pin, vel, n, speed) {
    this.loosen(pin);
    const push = speed * (1 + RESTITUTION) / (1 + MASS);
    pin.vel.copy(vel).multiplyScalar(0.25).addScaledVector(n, -push);
    pin.vel.y += 1.2 + 1.5 * this.rand();
    this.tip(pin, _n.copy(n).negate(), push);
  }

  loosen(pin) {
    if (pin.loose) return;
    pin.loose = true;
    pin.o.gone = true;
    if (this.first < 0) this.first = this.time;
  }

  // Set it tumbling over, away from the blow (dir), and turning a little about itself.
  tip(pin, dir, amount) {
    _w.crossVectors(UP, dir.setY(0).normalize()).multiplyScalar(amount * (1.2 + 0.8 * this.rand()));
    pin.spin.add(_w).add(_v.set(0, (this.rand() - 0.5) * amount * 1.5, 0));
  }

  update(dt) {
    this.time += dt;
    if (this.first < 0) return;
    const steps = 3, h = dt / steps, R = KNOCKOFF.radius;
    for (let k = 0; k < steps; k++) {
      for (const pin of this.list) if (pin.loose) this.move(pin, h);
      // pin on pin: the one hit goes over too
      for (let i = 0; i < this.list.length; i++) for (let j = i + 1; j < this.list.length; j++) {
        const a = this.list[i], b = this.list[j];
        if (!a.loose && !b.loose) continue;
        const d = _n.subVectors(a.pos, b.pos), dist = d.length();
        if (dist >= 2 * R || dist < 1e-6) continue;
        d.divideScalar(dist);
        const closing = _v.subVectors(a.vel, b.vel).dot(d);
        if (closing >= 0) continue;
        this.loosen(a);
        this.loosen(b);
        const J = -(1 + RESTITUTION) * closing / 2;
        a.vel.addScaledVector(d, J);
        b.vel.addScaledVector(d, -J);
        a.pos.addScaledVector(d, (2 * R - dist) / 2);
        b.pos.addScaledVector(d, -(2 * R - dist) / 2);
        this.tip(a, _w.copy(d), J * 0.8);
        this.tip(b, _w.copy(d).negate(), J * 0.8);
      }
    }
    for (const pin of this.list) {
      pin.mesh.position.copy(pin.pos);
    }
    if (!this.told && (this.time - this.first > SETTLE || this.down === this.list.length)) {
      this.told = true;
      this.onScore?.(this.down);
    }
  }

  // A loose pin: it flies, lands, bounces a little and slides, its spin dying away on the snow, and lies down on its
  // side or its back as it comes to rest.
  move(pin, h) {
    const R = KNOCKOFF.radius, p = pin.pos, v = pin.vel;
    v.y -= GRAVITY * h;
    p.addScaledVector(v, h);
    const g = this.track.ground(p.x, p.z, pin.hint, this.probe);
    pin.hint = g.i;
    if (p.y - R < g.y && !g.hole) {
      p.y = g.y + R;
      const vn = v.dot(g.normal);
      if (vn < 0) v.addScaledVector(g.normal, -(1 + (vn < -2 ? 0.35 : 0)) * vn);
      v.multiplyScalar(Math.exp(-(g.surface === 'ice' ? 0.2 : 1.4) * h));
      pin.spin.multiplyScalar(Math.exp(-3 * h));
      // its seat's up towards flat on the snow
      const up = _w.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion), lean = up.dot(g.normal);
      if (Math.abs(lean) > 0.15) {
        const flat = _v.copy(up).addScaledVector(g.normal, -lean);
        if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0).applyQuaternion(pin.mesh.quaternion);
        flat.normalize();
        _q.setFromUnitVectors(up, flat);
        pin.mesh.quaternion.premultiply(_q.slerp(NONE, 1 - Math.min(1, 5 * h)));
      }
    }
    const w = pin.spin.length();
    if (w > 1e-3) pin.mesh.quaternion.premultiply(_q.setFromAxisAngle(_n.copy(pin.spin).divideScalar(w), w * h));
  }
}
