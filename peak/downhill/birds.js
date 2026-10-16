// A little bird that lived in a pine the chair just went through. The chair goes on fast and the camera with it, so
// what stays at the pine is gone at once; the bird comes along instead. It bursts out of the branches tumbling and
// lands in the lid of Mnot's can (the perch, rider.js), where it sits a moment dazed, facing the camera, its eyes
// crossed and stars going round its head; then it shakes itself, takes off ahead of the chair and climbs away. A few
// needles cling to Mnot as well and drop off one by one on the way. Only for the look: nothing hits them, and their
// ways are Math.random's, so a watched run's bird may leave by another way. Without a perch (a headless ride) the
// bird just flies off from the pine.
import * as THREE from 'three';
import { toon } from '../look/look.js';
import { bursts } from '../look/bursts.js';

const HOP = 0.35, SIT = 1.7, FLIGHT = 2.4, DAZED = 1.2, SHRINK = 0.4;
// a blue tit, a robin and a goldfinch, by turns: [back, belly]
const FEATHERS = [['#4f8fdc', '#fff1c9'], ['#9a6a4a', '#f0784e'], ['#f2c443', '#fff6dc']];
const BEAK = '#f39a2b', EYE = '#ffffff', PUPIL = '#1d1d26', STAR = '#ffd84a', NEEDLE = '#2f6b45', TWIG = '#5a3d2a';
// where needles cling, from the perch: round the lid's rim, and on top of the glasses' frame
const CLING = [[0.22, -0.1, 0.1], [-0.2, -0.1, 0.12], [0.16, -0.11, -0.18], [-0.24, -0.12, -0.06], [0.13, -0.45, 0.36],
  [-0.15, -0.46, 0.35]];
const BITS = [new THREE.Color(TWIG), new THREE.Color(NEEDLE)];     // what a sprig falls apart into
const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3();

export class Birds {
  constructor(world) {
    this.group = world.group;
    this.puffs = bursts(world);
    this.perch = null;       // set by main.js: Mnot's head
    /** @type {(() => void)|null} */
    this.onTakeoff = null;   // the game's sound cue, when a perched bird leaves Mnot's head
    this.flying = [];
    this.spare = [];
    this.made = 0;
    this.sprigs = [];
    world.animated.push(this);
  }

  // Out of the branches at `at`, more or less along `away` (horizontal); vel is the chair's (it's kept, to fly off
  // with). To the perch if it's free, else off on its own.
  launch(at, away, vel) {
    const bird = this.spare.pop() ?? this.make(FEATHERS[this.made++ % FEATHERS.length]);
    const u = bird.userData, turn = (Math.random() - 0.5) * 2;
    u.t = 0;
    u.wobble = Math.random() * 6;
    u.carrier = vel;
    bird.scale.setScalar(1);
    bird.visible = true;
    this.flying.push(bird);
    if (this.perch && !this.flying.some(b => b !== bird && b.userData.phase !== 'fly')) {
      u.phase = 'hop';
      this.perch.updateWorldMatrix(true, false);
      u.from.copy(this.perch.worldToLocal(_w.copy(at)));
      this.perch.add(bird);
      bird.position.copy(u.from);
      return;
    }
    u.phase = 'fly';
    u.flight = 0;
    u.daze = DAZED;
    u.vel.set(away.x * Math.cos(turn) - away.z * Math.sin(turn), 0, away.x * Math.sin(turn) + away.z * Math.cos(turn))
      .multiplyScalar(3 + Math.random() * 1.5).addScaledVector(vel, 0.6).setY(2.2 + Math.random());
    this.group.add(bird);
    bird.position.copy(at);
  }

  // A few needles stick on Mnot, to fall off one by one over the next couple of seconds.
  cling(vel) {
    if (!this.perch) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const sprig = this.sprigs.find(s => !s.visible) ?? this.sprig();
      const at = CLING[Math.floor(Math.random() * CLING.length)];
      sprig.position.set(at[0], at[1], at[2]);
      sprig.rotation.set((Math.random() - 0.5) * 1.6, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.6);
      sprig.userData.left = 0.5 + i * 0.45 + Math.random() * 0.5;
      sprig.userData.carrier = vel;
      sprig.visible = true;
    }
  }

  reset() {
    for (const bird of this.flying) {
      bird.visible = false;
      this.group.add(bird);
      this.spare.push(bird);
    }
    this.flying.length = 0;
    for (const sprig of this.sprigs) sprig.visible = false;
  }

  update(dt) {
    for (const sprig of this.sprigs) {
      if (!sprig.visible || (sprig.userData.left -= dt) > 0) continue;
      sprig.visible = false;
      this.perch.updateWorldMatrix(true, false);
      sprig.getWorldPosition(_w);
      for (let i = 0; i < 3; i++) {
        this.puffs.add('bit', { at: _w, size: 0.025, life: 1, gravity: 2.5, drag: 1.2, bounce: 0, spin: 10,
          color: BITS[Math.min(i, 1)], vel: _v.copy(sprig.userData.carrier).multiplyScalar(0.85)
            .add(_r.set(Math.random() - 0.5, 0.6, Math.random() - 0.5)) });
      }
    }
    for (let k = this.flying.length - 1; k >= 0; k--) {
      const bird = this.flying[k], u = bird.userData;
      u.t += dt;
      if (u.phase === 'hop') this.hop(bird, u);
      else if (u.phase === 'sit') this.sit(bird, u, dt);
      else if (this.fly(bird, u, dt)) {
        bird.visible = false;
        this.flying.splice(k, 1);
        this.spare.push(bird);
      }
    }
  }

  // From the branches into the lid, tumbling: in the perch's frame, so it keeps up with the chair.
  hop(bird, u) {
    const k = Math.min(1, u.t / HOP), e = k * k * (3 - 2 * k);
    bird.position.copy(u.from).multiplyScalar(1 - e).y += 0.45 * Math.sin(Math.PI * k);
    bird.rotation.set(Math.sin(u.t * 17) * 0.8, u.t * 14, Math.sin(u.t * 11) * 0.8);
    this.look(u, 1, 46);
    if (k === 1) u.phase = 'sit';
  }

  // Sitting in the lid, facing the camera behind, swaying; at the end it shakes itself and flutters up.
  sit(bird, u, dt) {
    const t = u.t - HOP, shake = Math.max(0, (t - (SIT - 0.35)) / 0.35);
    bird.position.set(0, Math.abs(Math.sin(t * 5)) * 0.02 + shake * 0.12, 0);
    bird.rotation.set(Math.sin(t * 2.3) * 0.12, Math.PI + Math.sin(t * 1.7 + u.wobble) * 0.45,
      Math.sin(t * 3.1) * 0.22 + Math.sin(t * 40) * 0.12 * shake);
    this.look(u, Math.max(0.2, 1 - shake), shake > 0 ? 34 : 0, -1.05 + 0.12 * Math.sin(t * 9));
    if (t < SIT) return;
    // off it goes, a little faster than the chair and up, so it's in sight a while before the chair passes under it
    this.group.attach(bird);
    const side = Math.random() < 0.5 ? -1 : 1, c = u.carrier;
    u.vel.copy(c).multiplyScalar(1.05).add(_v.set(-c.z, 0, c.x).setLength(side * (1.5 + Math.random())))
      .setY(Math.max(c.y, 0) + 2.6);
    u.phase = 'fly';
    u.flight = 0;
    u.daze = 0.4;
    this.onTakeoff?.();
  }

  // Free in the air: dazed a moment (sagging, fluttering every which way), then a climb, still wobbling a little.
  // True when it's gone.
  fly(bird, u, dt) {
    const v = u.vel;
    u.flight += dt;
    if (u.flight > FLIGHT) return true;
    const dazed = Math.max(0, 1 - u.flight / u.daze);
    if (dazed > 0) v.y -= 3.5 * dt;
    else v.y += (1.6 - v.y) * 2 * dt;
    let flat = Math.hypot(v.x, v.z) || 1;
    if (dazed === 0 && flat < 5) v.multiplyScalar(1 + 0.8 * dt).setY(v.y);
    if (flat > 7) {                    // the chair's speed it took along fades to a bird's own
      const k = Math.exp(-0.5 * dt);
      v.x *= k;
      v.z *= k;
      flat *= k;
    }
    _w.set(-v.z / flat, 0, v.x / flat).multiplyScalar(Math.sin(u.t * 7 + u.wobble) * (0.6 + 2.2 * dazed));
    bird.position.addScaledVector(v, dt).addScaledVector(_w, dt);
    // facing the way it flies, nose up as it climbs, rolling over and over while it's dazed
    bird.rotation.set(-Math.atan2(v.y, flat) * 0.6, Math.atan2(v.x, v.z),
      Math.sin(u.t * 9 + u.wobble) * 1.1 * dazed + Math.sin(u.t * 5) * 0.15);
    this.look(u, dazed, dazed > 0 ? 46 : 30);
    bird.scale.setScalar(Math.min(1, (FLIGHT - u.flight) / SHRINK));
    return false;
  }

  // The stars and crossed eyes as dazed as it is (0..1), the wings beating at rate (or at 0 held at fold: -1 tucked
  // in, 0 spread).
  look(u, dazed, rate, fold = -1) {
    const flap = rate ? 0.25 + 0.95 * Math.sin(u.t * rate) : fold;
    u.wings[0].rotation.z = flap;
    u.wings[1].rotation.z = -flap;
    u.stars.visible = dazed > 0.05;
    u.stars.rotation.y = u.t * 9;
    u.stars.scale.setScalar(Math.min(1, dazed * 3));
    // the eyes cross while it's dazed, and come right
    for (const [pupil, x] of u.pupils) pupil.position.x = x * (1 - 0.45 * dazed);
  }

  // One bird, round as a ball, facing +z: a back and a belly, a beak, big eyes, a tuft, a tail, two wings, and the
  // stars for its head.
  make([back, belly]) {
    const bird = new THREE.Group(), feathers = toon(back), front = toon(belly);
    const ball = (r, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      bird.add(mesh);
      return mesh;
    };
    ball(0.14, feathers, 0, 0, 0, 1, 0.95, 1.15);
    ball(0.105, front, 0, -0.035, 0.055, 1, 0.95, 1);
    const pupils = [];
    for (const x of [-0.058, 0.058]) {
      ball(0.048, toon(EYE), x, 0.05, 0.115);
      const pupil = ball(0.024, toon(PUPIL, { outline: false }), x, 0.052, 0.155);
      pupils.push([pupil, x * 1.08]);
    }
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.08, 6), toon(BEAK));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.005, 0.185);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 5), feathers);
    tuft.position.set(0, 0.155, 0.02);
    tuft.rotation.x = -0.4;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 4), feathers);
    tail.rotation.x = -Math.PI / 2 - 0.35;
    tail.position.set(0, 0.03, -0.18);
    bird.add(beak, tuft, tail);
    const wings = [1, -1].map(side => {
      const hinge = new THREE.Group(), wing = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), feathers);
      wing.scale.set(0.12, 0.022, 0.075);
      wing.position.x = side * 0.11;
      hinge.position.set(side * 0.1, 0.03, -0.01);
      hinge.add(wing);
      bird.add(hinge);
      return hinge;
    });
    const stars = new THREE.Group();
    stars.position.y = 0.25;
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), toon(STAR, { outline: false }));
      const a = i / 3 * Math.PI * 2;
      star.position.set(Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15);
      stars.add(star);
    }
    bird.add(stars);
    bird.traverse(part => { part.castShadow = part.isMesh; });
    bird.userData = { t: 0, wobble: 0, phase: 'fly', flight: 0, daze: DAZED, carrier: null, from: new THREE.Vector3(),
      vel: new THREE.Vector3(), wings, stars, pupils };
    return bird;
  }

  // A sprig of three needles on a bit of twig, clinging to Mnot (on the perch).
  sprig() {
    const sprig = new THREE.Group(), needle = toon(NEEDLE, { outline: false });
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 5), toon(TWIG, { outline: false }));
    sprig.add(twig);
    for (const a of [-0.55, 0, 0.55]) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.11, 4), needle);
      mesh.position.set(Math.sin(a) * 0.05, 0.03 + Math.cos(a) * 0.05, 0);
      mesh.rotation.z = -a;
      sprig.add(mesh);
    }
    sprig.visible = false;
    this.perch.add(sprig);
    this.sprigs.push(sprig);
    return sprig;
  }
}
