// Mnot on the chair. There's no sitting clip, so the pose goes on top of the clips (Idle, Fall in the air, Wave at
// the finish): the thighs forward along the seat, the short legs sticking out over its front edge, the gloves on
// the armrests. What the chair feels moves the rest: the legs flop and swing, and fly up as the seat spins; braking,
// the rubber-hose shins stretch down to dig the heels into the snow; spinning fast, airborne or hit, the arms let go
// and flail, which spreads Mnot out and slows the spin (the ride reads armsOut for the seat's inertia). At the finish
// party (party.js) it raises the roof, flings itself out for the spins and swings its legs to the shimmy. On the
// title (title.js) it plays an act: a wave, pushing its glasses up.
// Angles work in the holder's frame (mnot.root), as in pose.js: +Z is where Mnot faces, +X is Mnot's left.
import * as THREE from 'three';
import { Pose } from '../mnot/pose.js';
import { CHAIR } from './chair.js';
import { G } from './ride.js';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _r = new THREE.Quaternion();
const PAD = { x: 0.355, y: 0.255 + 0.388 + 0.03, z: 0.03 };   // the armrest pads, in the holder's frame (chair.js)
const FREE = new Set(['Wave', 'PushGlasses', 'LookUp']);         // clips that move the right arm: it lets go of its pad

export class Rider {
  constructor(mnot, chair) {
    this.mnot = mnot;
    chair.mount.add(mnot.root);
    this.pose = new Pose(mnot);
    const bone = name => mnot.model.getObjectByName(name);
    this.legs = [1, -1].map(side => {
      const k = side > 0 ? 'L' : 'R';
      return { side, thigh: bone(`thigh_${k}`), shin: bone(`shin_${k}`), foot: bone(`foot_${k}`),
        swing: { x: 0, y: 0, vx: 0, vy: 0 } };
    });
    this.arms = [1, -1].map(side => {
      const k = side > 0 ? 'L' : 'R';
      return { side, upper: bone(`upper_arm_${k}`), fore: bone(`forearm_${k}`), hand: bone(`hand_${k}`) };
    });
    // the bones the pose turns, with what the clips last gave them: the mixer only writes a bone when its clip value
    // changes, so on a clip that holds the legs still (PushGlasses) last frame's turns would stay and pile up
    this.clipPose = new Map([...this.legs.flatMap(l => [l.thigh, l.shin]), ...this.arms.flatMap(a => [a.upper, a.fore])]
      .map(b => [b, b.quaternion.clone()]));
    this.out = 0;          // 0..1: the arms let go of the armrests
    this.brake = 0;        // 0..1: the legs down, heels in the snow
    this.tuck = 0;         // 0..1: leaning in, holding on tight
    this.wave = 0;         // 0..1: the right glove lets go of its armrest to wave (the Wave clip moves that arm, as
                           // PushGlasses and LookUp do)
    this.party = null;     // the finish party's pose (party.js), set by main.js every frame
    this.act = null;       // a clip the title has Mnot play (title.js), over anything else
    this.roof = 0;         // 0..1: both arms up, raising the roof
    this.squash = { y: 0, v: 0 };
    this.hit = 0;          // seconds of fright left after a crash
    this.time = 0;
    this.lastSpin = 0;
    this.felt = new THREE.Vector3();
    this.sizes = null;     // the bones' lengths, measured on the first frame
    this.clip = 'Idle';
    mnot.animator.play('Idle', 0);
    // where a bird out of a pine sits a moment, dazed: in the can's lid, which moves with the can (birds.js)
    this.perch = new THREE.Object3D();
    this.perch.position.set(0, 1.13, -0.02);
    bone('body').add(this.perch);
  }

  land(impact) { this.squash.v -= Math.min(impact, 14) * 0.22; }
  crash(impulse) { this.hit = Math.max(this.hit, Math.min(1.2, impulse * 0.12)); this.squash.v -= impulse * 0.05; }

  update(dt, ride, intent) {
    this.time += dt;
    const { animator, model, root } = this.mnot;
    const spin = ride.seatSpin, spinAccel = (spin - this.lastSpin) / Math.max(dt, 1e-4);
    this.lastSpin = spin;
    this.hit = Math.max(0, this.hit - dt);
    const air = !ride.grounded && ride.airTime > 0.18 || ride.out;
    const panic = Math.max(THREE.MathUtils.smoothstep(Math.abs(spin), 3, 7), air ? 1 : 0, this.hit > 0 ? 1 : 0);
    const party = this.party, out = party ? party.out : ride.done ? 0 : panic;
    this.out = THREE.MathUtils.damp(this.out, out, out > this.out ? 9 : 2.2, dt);
    this.roof = THREE.MathUtils.damp(this.roof, party ? party.roof : 0, 10, dt);
    ride.armsOut = this.out;
    const braking = intent.brake && ride.grounded && !ride.done;
    this.brake = THREE.MathUtils.damp(this.brake, braking ? 1 : 0, braking ? 14 : 6, dt);
    this.tuck = THREE.MathUtils.damp(this.tuck, intent.tuck && !braking ? 1 : 0, 6, dt);

    const clip = this.act && animator.has(this.act) ? this.act : party ? 'Idle'
      : ride.done ? (animator.has('Wave') ? 'Wave' : 'Idle') : air ? 'Fall' : 'Idle';
    if (clip !== this.clip) { animator.play(clip, 0.2); this.clip = clip; }
    for (const [b, q] of this.clipPose) b.quaternion.copy(q);
    animator.update(dt);
    for (const [b, q] of this.clipPose) q.copy(b.quaternion);
    // an act lets go quickly: the glove is on its way up from the first frame
    this.wave = THREE.MathUtils.damp(this.wave, FREE.has(clip) ? 1 : 0, this.act ? 9 : 4, dt);

    // the can squashes on a landing, about its bottom on the seat, and leans in or back
    const s = this.squash;
    s.v += (-220 * s.y - 11 * s.v) * dt;
    s.y = THREE.MathUtils.clamp(s.y + s.v * dt, -0.22, 0.18);
    model.scale.set(1 - s.y * 0.5, 1 + s.y, 1 - s.y * 0.5);
    model.position.y = -0.5 * s.y;
    root.rotation.x = 0.22 * this.tuck - 0.1 * this.brake;

    // what the chair feels, in the seat's frame
    _q.copy(ride.tiltQ).multiply(_r.setFromAxisAngle(Y, ride.seatYaw)).invert();
    const f = this.felt.copy(ride.feel).applyQuaternion(_q);
    if (!this.sizes) this.measure();
    this.poseLegs(dt, ride, f, spin, spinAccel);
    this.poseArms(dt, spin);
  }

  measure() {
    const p = this.pose, length = (a, b) => p.local(b, _c).distanceTo(p.local(a, _d));
    const leg = this.legs[0], arm = this.arms[0];
    this.sizes = { shin: length(leg.shin, leg.foot), upper: length(arm.upper, arm.fore), fore: length(arm.fore, arm.hand) };
  }

  poseLegs(dt, ride, f, spin, spinAccel) {
    const p = this.pose;
    // the snow under the seat, in the holder's frame (the chair stands at ride.pos)
    const ground = -(CHAIR.lift + ride.lift + CHAIR.pan - 0.488);
    for (const leg of this.legs) {
      const w = leg.swing, side = leg.side;
      // a springy leg: more weight flops it down, the spin lifts it and drags it behind, a sideways pull swings it
      const wantX = THREE.MathUtils.clamp((-f.y - G) * 0.012 - spin * spin * 0.004, -0.6, 0.7);
      const wantY = THREE.MathUtils.clamp(-spinAccel * 0.006 + f.x * 0.025, -0.5, 0.5);
      w.vx += (90 * (wantX - w.x) - 5 * w.vx) * dt;
      w.vy += (70 * (wantY - w.y) - 4 * w.vy) * dt;
      w.x += w.vx * dt; w.y += w.vy * dt;
      const kick = this.out * 0.5 * Math.sin(this.time * 16 + (side > 0 ? 0 : Math.PI));
      const lower = 0.12 + 0.25 * this.brake + w.x + kick * 0.6;
      p.turn(leg.thigh, X, -Math.PI / 2 + lower);
      p.turn(leg.thigh, Y, side * (0.14 + 0.25 * this.out) + w.y + (this.party?.legs ?? 0));
      p.turn(leg.shin, X, THREE.MathUtils.lerp(0.5 - 0.3 * this.tuck, 1.05, this.brake) + kick);
      // braking: the shin stretches until the heel is in the snow (rubber hose), the foot keeps its own size
      let k = 1;
      if (this.brake > 0.01) {
        const knee = p.local(leg.shin, _b), ankle = p.local(leg.foot, _c), dir = _d.subVectors(ankle, knee).normalize();
        if (dir.y < -0.3) k = THREE.MathUtils.clamp((knee.y - ground - 0.06) / -dir.y / this.sizes.shin, 1, 2.6);
        k = 1 + (k - 1) * this.brake;
      }
      stretch(leg.shin, leg.foot, k);
    }
  }

  poseArms(dt, spin) {
    const p = this.pose, { upper: a, fore: b } = this.sizes;
    for (const arm of this.arms) {
      const side = arm.side, hold = side < 0 ? 1 - this.wave : 1;
      // holding on: the glove on the pad, the elbow out and back
      const shoulder = p.local(arm.upper, _a);
      const hand = _b.set(side * PAD.x, PAD.y, PAD.z).applyQuaternion(_r.copy(this.mnot.root.quaternion).invert());
      const reach = _c.subVectors(hand, shoulder), c = Math.min(reach.length(), a + b - 1e-3);
      reach.normalize();
      const bend = _d.set(side * 0.8, 0.15, -0.55);
      bend.addScaledVector(reach, -bend.dot(reach)).normalize();
      const along = (a * a - b * b + c * c) / (2 * c), up = Math.sqrt(Math.max(0, a * a - along * along));
      const elbow = reach.multiplyScalar(along).addScaledVector(bend, up).normalize();
      // flailing: out wide and up, flapping, a bit behind when the seat spins
      const flap = Math.sin(this.time * 15 + (side > 0 ? 0 : 1.7));
      const angle = 0.35 + 0.55 * flap;
      const wild = new THREE.Vector3(side * Math.cos(angle), Math.sin(angle), 0.15 - 0.05 * spin * side).normalize();
      // raising the roof: the elbows out at the shoulders, the forearms up, pushed higher on the beat
      const pump = this.party?.pump ?? 0, lift = 0.55 + 0.45 * pump;
      const roofUpper = _e.set(side * Math.cos(lift), Math.sin(lift), 0.2).normalize();
      const roofFore = _f.set(side * 0.25, 1, 0.15).normalize();
      p.aim(arm.upper, arm.fore, elbow.lerp(wild, this.out).normalize().lerp(roofUpper, this.roof).normalize(), hold);
      // the forearm to the pad, or on out along the upper arm
      const at = p.local(arm.fore, _a), toPad = _c.subVectors(hand, at).normalize();
      const onward = wild.clone().add(_d.set(0, 0.25, 0.1)).normalize();
      p.aim(arm.fore, arm.hand, toPad.lerp(onward, this.out).normalize().lerp(roofFore, this.roof).normalize(), hold);
    }
  }

  // Where the feet are in the world, for the snow they kick up.
  feet(targets) {
    return this.legs.map((leg, i) => leg.foot.getWorldPosition(targets[i]));
  }
}

// A bone stretched along itself by k, its child scaled back on whichever of its own axes lies along the stretch.
function stretch(bone, child, k) {
  const axis = _a.copy(child.position).normalize();
  const sx = Math.abs(axis.x), sy = Math.abs(axis.y), sz = Math.abs(axis.z);
  bone.scale.set(sx > 0.7 ? k : 1, sy > 0.7 ? k : 1, sz > 0.7 ? k : 1);
  // the stretch axis in the child's own frame
  const local = axis.applyQuaternion(_q.copy(child.quaternion).invert());
  const lx = Math.abs(local.x), ly = Math.abs(local.y), lz = Math.abs(local.z), m = Math.max(lx, ly, lz);
  child.scale.set(lx === m ? 1 / k : 1, ly === m ? 1 / k : 1, lz === m ? 1 / k : 1);
  bone.updateMatrixWorld(true);
}
