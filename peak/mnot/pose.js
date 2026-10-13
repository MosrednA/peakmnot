// Procedural touches on top of the animation clips, for poses the rig has no clip for:
//  - on a plank or rope the legs pinch in so both feet stand on it (a rope is 6 cm wide; the clips walk hip-wide),
//    and the arms go out wide like a tightrope walker's, seesawing against the lean and flapping when it gets close;
//  - slipping or falling into the abyss (fall.js), or down on the ice, the arms flap as if that might help and the
//    legs kick;
//  - wobbling on ice (skate.js), the arms go out and windmill, and standing feet take little panicky steps.
// Every clip keys every bone each frame, so these turns never pile up. All angles work in the frame of Mnot's
// holder (mnot.root): +Z is where Mnot faces, +X is Mnot's left, +Y up.
import * as THREE from 'three';
import { FALL_ANGLE } from './balance.js';

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _r = new THREE.Quaternion(), _f = new THREE.Quaternion();

export class Pose {
  constructor(mnot) {
    this.frame = mnot.root;
    const bone = name => mnot.model.getObjectByName(name);
    this.legs = [1, -1].map(side => ({ side, thigh: bone(side > 0 ? 'thigh_L' : 'thigh_R'),
      foot: bone(side > 0 ? 'foot_L' : 'foot_R') }));
    this.arms = [1, -1].map(side => ({ side, upper: bone(side > 0 ? 'upper_arm_L' : 'upper_arm_R'),
      fore: bone(side > 0 ? 'forearm_L' : 'forearm_R') }));
    this.beam = 0;          // 0..1, how much of the balancing pose shows
    this.panic = 0;         // 0..1, flapping arms
    this.stance = 0;        // half the distance between the feet on a beam
    this.time = 0;
  }

  update(dt, player) {
    this.time += dt;
    const b = player.balance;
    const onBeam = player.mode === 'beam';
    const falling = player.tilt.toppling !== 0 || player.mode === 'out' && player.fall.active && player.hang === 0 ||
      player.skate.busy;
    const ice = player.skate.flail;
    this.beam = THREE.MathUtils.damp(this.beam, onBeam ? 1 : 0, onBeam ? 8 : 5, dt);
    this.panic = THREE.MathUtils.damp(this.panic, falling ? 1 : 0, falling ? 10 : 4, dt);
    if (onBeam) this.stance = THREE.MathUtils.clamp(b.beam.width / 2 - 0.08, 0, 0.13);
    if (this.beam < 0.01 && this.panic < 0.01 && ice < 0.01) return;

    // how close Mnot is to slipping off, and which way: the lean is about the beam, the holder faces along it
    const roll = onBeam ? b.lean * b.facing : 0;
    const danger = onBeam ? THREE.MathUtils.smoothstep(Math.abs(b.lean) / FALL_ANGLE, 0.4, 1) : 0;

    for (const leg of this.legs) {
      this.pinch(leg, this.beam);
      // falling: legs apart, kicking out of step; wobbling on ice: little quick steps
      const kick = 0.8 * this.panic + 0.3 * ice * (player.moving ? 0.3 : 1);
      this.turn(leg.thigh, Z, leg.side * 0.35 * this.panic);
      this.turn(leg.thigh, X, kick * Math.sin(this.time * 15 + (leg.side > 0 ? 0 : Math.PI)));
    }
    for (const arm of this.arms) {
      const s = arm.side;
      // out wide and a little forward, the line of the arms tilting against the lean, a flap when it's close
      const flap = danger * 0.55 * Math.sin(this.time * 17 + (s > 0 ? 0 : 1.3));
      const balance = 0.32 - s * 1.3 * roll + flap;
      // falling: flapping like a bird
      const angle = THREE.MathUtils.lerp(balance, 0.3 + 0.9 * Math.sin(this.time * 19), this.panic);
      const target = _c.set(s * Math.cos(angle), Math.sin(angle), 0.22 + 0.2 * this.panic).normalize();
      // wobbling on ice: out to the sides, then windmilling in big circles as it gets worse
      const mill = THREE.MathUtils.smoothstep(ice, 0.3, 0.8) * (1 - this.panic);
      const turn = this.time * 12 + (s > 0 ? 0 : 2.4);
      if (mill > 0) target.lerp(_b.set(s * 0.45, Math.sin(turn), Math.cos(turn)), mill).normalize();
      this.aim(arm.upper, arm.fore, target, Math.max(this.beam, this.panic, ice));
      // elbows bent a touch, and flapping with the arms
      this.turn(arm.fore, Z, s * (0.25 + 0.6 * flap) * this.beam);
    }
  }

  // Swing a leg in under the hip, so the foot lands at the stance; the foot turns back to stay flat.
  pinch({ side, thigh, foot }, weight) {
    const hip = this.local(thigh, _a), toe = this.local(foot, _b);
    const drop = Math.max(0.1, hip.y - toe.y);
    const angle = (Math.atan2(side * this.stance - hip.x, drop) - Math.atan2(toe.x - hip.x, drop)) * weight;
    this.turn(thigh, Z, angle);
    this.turn(foot, Z, -angle);
  }

  // Swing a bone (pivoting at its own origin) so the direction to its child points at target, by weight.
  aim(bone, child, target, weight) {
    const from = this.local(child, _a).sub(this.local(bone, _b)).normalize();
    _q.setFromUnitVectors(from, target);
    this.turnBy(bone, _r.identity().slerp(_q, weight));
  }

  turn(bone, axis, angle) {
    if (angle) this.turnBy(bone, _r.setFromAxisAngle(axis, angle));
  }

  // Rotate a bone by q, given in the holder's frame, on top of its animated rotation.
  turnBy(bone, q) {
    this.frame.getWorldQuaternion(_f);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    // the same rotation in the parent's space: P⁻¹ F q F⁻¹ P
    const local = parent.clone().invert().multiply(_f).multiply(q).multiply(_f.invert()).multiply(parent);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  }

  local(bone, target) {
    return this.frame.worldToLocal(bone.getWorldPosition(target));
  }
}
