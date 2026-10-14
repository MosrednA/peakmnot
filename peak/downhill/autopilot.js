// A test rider for the downhill (downhill.autopilot(true) in the console). It looks about a second ahead, picks the
// line across the piste with the most room between the obstacles (and straight at the bowling pins), and on the river
// the line whose hop lands on a floe; it steers for it, jumps off the kicker, the floes' edges and the ski jump's
// lip (tucked all the way down), and brakes when it's going faster than it can steer, but never on the ski jump. It
// rides through the same physics as a player, so it shows whether the run can be ridden, and what the chair does
// on the way.
import * as THREE from 'three';
import { FEATURES } from './track.js';

export class Autopilot {
  constructor(track, obstacles) {
    this.track = track;
    this.obstacles = obstacles;
    this.on = false;
    this.lever = true;     // pull it at the ski jump's lip, for the long jump
    this.line = 0;
    this.frame = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() };
  }

  intent(ride) {
    const s = ride.s, speed = ride.speed, ahead = THREE.MathUtils.clamp(4 + speed, 6, 24);
    const near = [];
    for (let b = Math.floor(s) + 1; b <= Math.floor(s + ahead); b++) {
      for (const o of this.obstacles.buckets[b] ?? []) if (!o.gone && Math.abs(o.d) < 9) near.push(o);
    }
    const R = FEATURES.river, river = s > R.from - 20 && s < R.to;
    let best = this.line, bestCost = Infinity;
    for (let d = -5.5; d <= 5.5; d += 0.25) {
      let cost = 0.01 * d * d + 0.03 * (d - this.line) ** 2;
      if (river) cost += 6 * this.wetLanding(s, d, speed);
      for (const o of near) {
        const room = o.r + (o.soft ? 0.7 : 1.1);
        cost += (o.kind === 'pin' ? -1.5 : o.soft ? 1 : 4) * Math.exp(-(((d - o.d) / room) ** 2));
      }
      if (cost < bestCost) { bestCost = cost; best = d; }
    }
    this.line = best;
    const f = this.track.frame(s, this.frame);
    const across = ride.vel.dot(f.right);
    const steer = THREE.MathUtils.clamp(0.7 * (this.line - ride.d) - 0.45 * across, -1, 1);
    const K = FEATURES.kicker, I = FEATURES.ice, J = FEATURES.jump;
    const edge = river && this.track.wet(s + 0.6 + speed * 0.07, ride.d);
    const jump = ride.grounded && (s > K.to - 1.1 && s < K.to - 0.2 || this.lever && s > J.lip - 1.2 && s < J.lip - 0.3
      || edge);
    const fast = speed > (s > I.from - 20 && s < I.to ? 12 : 16);
    const flying = s > K.from - 10 && s < K.to || s > J.lip - 58 && s < J.lip + 85;
    return { steer, push: speed < 4, tuck: speed < 12 || s > J.lip - 58 && s < J.lip + 85, brake: fast && !flying, jump };
  }

  // How much of the next three hops off the floes' edges along line d come down in the water (the next counts most):
  // each hop's length from a flight on the river's slope at this speed, give or take.
  wetLanding(s, d, speed) {
    const hop = Math.max(4, speed * (5.4 + 0.13 * speed) / 7.5);
    let from = s, wet = 0;
    for (const weight of [1, 0.7, 0.4]) {
      let gap = -1;
      for (let a = from + 0.5; a < from + 30; a += 0.5) if (this.track.wet(a, d)) { gap = a; break; }
      if (gap < 0) break;
      if (gap < from + 1.5) return wet + weight;   // water right there: that's off the side of the floe
      for (const k of [0.85, 1, 1.15]) if (this.track.wet(gap + hop * k, d)) wet += weight / 3;
      from = gap + hop;
    }
    return wet;
  }
}
