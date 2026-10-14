// The office chair: the expensive ergonomic kind, all graphite and woven mesh. A polished five-star base on twin-wheel
// casters that swivel to trail their wheels, a gas lift, and on top a seat that turns freely on its own: the seat
// pan, a mesh back that wraps round the can, armrests, the height lever, and the price tag still on it. The physics
// (ride.js) moves it; pose() puts every part where the physics says, and turns the casters and their wheels.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon, noOutline, RAMPS } from '../look/look.js';
import { painted, letter } from '../props/paint.js';

export const CHAIR = {
  legs: 5, reach: 0.33,          // the star: how many legs, and the casters' swivels from the middle
  wheel: 0.045,                  // a caster wheel's radius
  pivot: 0.115,                  // the casters' swivels above the ground
  trail: 0.045,                  // how far a caster's wheels trail behind its swivel
  lift: 0.36,                    // the top of the gas lift above the ground, at rest
  pan: 0.1,                      // the seat's top above the gas lift
  radius: 0.38,                  // for collisions: the star with its casters
};
export const PRICE = '€1,649';
// The pit stop's fresh casters (fix(true)): one after the other (stagger s apart), each flies in from out past the end
// of its leg (out m, up m), spinning and faster and faster (fly s), and pops on, a moment bigger (pop s, squash).
const REFIT = { stagger: 0.05, out: 0.55, up: 0.4, fly: 0.2, pop: 0.16, squash: 0.35 };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion();

export class Chair {
  constructor() {
    const graphite = toon('#3c404c'), dark = toon('#25272e'), polished = toon('#c9cfd9', { ramp: RAMPS.metal });
    const chrome = toon('#e4e9f1', { ramp: RAMPS.metal });
    this.root = new THREE.Group();
    this.root.name = 'chair';
    this.base = new THREE.Group();
    this.root.add(this.base);

    // the star: a hub and five tapered legs sloping down to the casters
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.075, 20), polished);
    hub.position.y = 0.155;
    this.base.add(hub);
    const legShape = taperedLeg();
    this.casters = [];
    for (let i = 0; i < CHAIR.legs; i++) {
      const a = i / CHAIR.legs * Math.PI * 2;
      const leg = new THREE.Mesh(legShape, polished);
      leg.rotation.y = a;
      this.base.add(leg);
      this.casters.push(this.caster(a, dark, polished));
    }
    // the shroud over the gas spring, and the chrome piston sliding out of it
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.15, 18), graphite);
    shroud.position.y = 0.25;
    this.base.add(shroud);

    this.lift = new THREE.Group();
    this.lift.position.y = CHAIR.lift;
    this.root.add(this.lift);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 14), chrome);
    piston.position.y = -0.08;
    this.lift.add(piston);

    this.seat = new THREE.Group();          // turns on the lift
    this.lift.add(this.seat);
    this.tilt = new THREE.Group();          // rocks a little on its mechanism
    this.seat.add(this.tilt);
    this.buildSeat(graphite, dark, polished);
    this.mount = new THREE.Group();         // where Mnot sits: the can's bottom on the seat pan
    this.mount.position.set(0, CHAIR.pan - 0.5 + 0.012, -0.02);
    this.tilt.add(this.mount);

    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.tag.mesh.castShadow = false;
    this.tagSwing = { x: 0, z: 0, vx: 0, vz: 0 };
  }

  // A twin-wheel caster on the end of a leg: a swivel (turns about its stem) with the wheels trailing behind it.
  caster(angle, dark, polished) {
    const swivel = new THREE.Group();
    swivel.position.set(Math.sin(angle) * CHAIR.reach, CHAIR.pivot, Math.cos(angle) * CHAIR.reach);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), polished);
    stem.position.y = 0.012;
    const hood = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.075, 2, 0.012), dark);
    hood.position.set(0, -0.03, -CHAIR.trail * 0.55);
    const wheel = new THREE.Group();
    wheel.position.set(0, CHAIR.wheel - CHAIR.pivot, -CHAIR.trail);
    for (const side of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(CHAIR.wheel, CHAIR.wheel, 0.018, 16), dark);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = side * 0.016;
      wheel.add(disc);
    }
    swivel.add(stem, hood, wheel);
    this.base.add(swivel);
    return { swivel, wheel, home: swivel.position.clone(), yaw: 0, spin: 0, angle, gone: false, fly: null };
  }

  buildSeat(graphite, dark, polished) {
    const t = this.tilt;
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); t.add(mesh); return mesh; };
    // the mechanism under the seat, and the seat pan: a frame with mesh stretched over it, the front rolled down
    add(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.05, 0.24, 2, 0.015), graphite), 0, 0.02, -0.02);
    add(new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.055, 0.48, 3, 0.025), graphite), 0, CHAIR.pan - 0.028, -0.04);
    const weave = meshMaterial(4.5, 4);
    const top = add(new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.42), weave), 0, CHAIR.pan + 0.002, -0.04);
    top.rotation.x = -Math.PI / 2;
    // the back: a woven panel that wraps round the can, in a frame, on two struts from the mechanism
    const panel = backPanel();
    add(new THREE.Mesh(panel.geometry, meshMaterial(5, 6)), 0, 0, 0);
    add(new THREE.Mesh(new THREE.TubeGeometry(panel.outline, 80, 0.02, 8, true), graphite), 0, 0, 0);
    for (const side of [-1, 1]) {
      const strut = new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.07, 0.02, -0.12),
        new THREE.Vector3(side * 0.16, 0.05, -0.3), panel.corner(side)]);
      add(new THREE.Mesh(new THREE.TubeGeometry(strut, 12, 0.022, 8), graphite), 0, 0, 0);
    }
    // armrests: out from under the seat, up, and a pad
    for (const side of [-1, 1]) {
      const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.08, 0.01, -0.06),
        new THREE.Vector3(side * 0.3, 0.02, -0.07), new THREE.Vector3(side * 0.355, 0.08, -0.07),
        new THREE.Vector3(side * 0.36, 0.22, -0.05)], false, 'catmullrom', 0.2);
      add(new THREE.Mesh(new THREE.TubeGeometry(arm, 16, 0.018, 8), graphite), 0, 0, 0);
      add(new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.035, 0.24, 2, 0.014), dark), side * 0.36, 0.235, -0.02);
    }
    // the height lever on Mnot's right (−x): it flicks up for a jump
    this.lever = new THREE.Group();
    this.lever.position.set(-0.1, 0.0, 0.07);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), polished);
    rod.rotation.z = Math.PI / 2;
    rod.position.x = -0.11;
    const paddle = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.014, 0.035, 2, 0.006), dark);
    paddle.position.x = -0.22;
    this.lever.add(rod, paddle);
    t.add(this.lever);
    // the price tag, still on: a card on a string from the left armrest's front
    const pivot = new THREE.Group();
    pivot.position.set(0.36, 0.22, 0.1);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.06, 4), toon('#f4efe2', { outline: false }));
    string.position.y = -0.03;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.11), tagMaterial());
    card.position.y = -0.11;
    pivot.add(string, card);
    t.add(pivot);
    this.tag = { pivot, mesh: card };
  }

  // Everything where the ride says: the star tilted to the ground and turned, the casters trailing their wheels,
  // the lift, the seat's own turn and rock, the lever and the tag swinging.
  pose(ride, dt) {
    this.root.position.copy(ride.pos);
    this.root.quaternion.copy(ride.tiltQ);
    this.base.rotation.y = ride.baseYaw;
    // each caster swivels to trail its wheels behind the way its stem moves, the sooner the further it rolls
    _q.copy(ride.tiltQ).multiply(_r.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ride.baseYaw)).invert();
    for (const c of this.casters) {
      c.swivel.visible = !c.gone && !(c.fly < 0);       // a fresh one waiting for its turn isn't there yet
      if (c.gone) continue;
      // the stem's speed in the star's frame: the chair's own, plus its turning
      _v.copy(ride.vel).applyQuaternion(_q);
      _v.x += ride.baseSpin * c.swivel.position.z;
      _v.z -= ride.baseSpin * c.swivel.position.x;
      _v.y = 0;
      const speed = _v.length();
      if (speed > 0.05) {
        const want = Math.atan2(_v.x, _v.z);           // the wheel's forward along the motion: it trails behind
        const k = Math.min(1, speed * dt / CHAIR.trail);
        c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * k;
        if (ride.grounded) c.spin += speed * Math.cos(want - c.yaw) * dt / CHAIR.wheel;
      }
      c.swivel.rotation.y = c.yaw;                      // the wheels sit behind the stem (−z)
      c.wheel.rotation.x = c.spin;
      if (c.fly !== null) this.refit(c, dt);
    }
    this.lift.position.y = CHAIR.lift + ride.lift;
    this.seat.rotation.y = ride.seatYaw;
    this.tilt.rotation.set(ride.rock.x, 0, ride.rock.z);
    this.lever.rotation.z = -ride.lever * 0.6;
    this.swingTag(ride, dt);
  }

  // The tag hangs like a pendulum from the armrest, along the pull it feels in the seat's frame: gravity less the
  // seat's acceleration, and the spin flinging it outwards (it hangs 0.37 m off the swivel, on the +x side).
  swingTag(ride, dt) {
    const s = this.tagSwing;
    _q.copy(ride.tiltQ).multiply(_r.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ride.seatYaw)).invert();
    _w.copy(ride.feel).applyQuaternion(_q);
    const down = Math.max(1, -_w.y), out = _w.x + 0.37 * ride.seatSpin * ride.seatSpin;
    const wantX = Math.atan2(-_w.z, down), wantZ = Math.atan2(out, down);
    s.vx += (70 * (wantX - s.x) - 3 * s.vx) * dt;
    s.vz += (70 * (wantZ - s.z) - 3 * s.vz) * dt;
    s.x = THREE.MathUtils.clamp(s.x + s.vx * dt, -1.4, 1.4);
    s.z = THREE.MathUtils.clamp(s.z + s.vz * dt, -1.4, 1.4);
    this.tag.pivot.rotation.set(s.x, 0, s.z);
    this.tag.mesh.rotation.y = 0.5;
  }

  // A caster's wheels as a loose copy, for the debris; the caster itself goes.
  dropWheel(index) {
    const c = this.casters[index];
    c.gone = true;
    c.swivel.updateWorldMatrix(true, true);
    const copy = c.swivel.clone();
    c.swivel.getWorldPosition(copy.position);
    c.swivel.getWorldQuaternion(copy.quaternion);
    return copy;
  }

  // A fresh caster for every missing one. fly: they fly in and pop on one after the other (the pit stop); otherwise
  // they're simply there (back at the pit after a wreck, a new run).
  fix(fly = false) {
    let n = 0;
    for (const c of this.casters) {
      c.fly = fly && c.gone ? -REFIT.stagger * n++ : null;
      c.gone = false;
      c.swivel.position.copy(c.home);
      c.swivel.scale.setScalar(1);
    }
  }

  // The casters as on says (on[i]: is caster i there?), at once and none flying in: a replay's jump in time.
  setWheels(on) {
    this.casters.forEach((c, i) => {
      c.gone = !on[i];
      c.fly = null;
      c.swivel.position.copy(c.home);
      c.swivel.scale.setScalar(1);
    });
  }

  // A fresh caster on its way in: from out past its leg, spinning, faster and faster, then the pop as it snaps on.
  refit(c, dt) {
    c.fly += dt;
    const t = THREE.MathUtils.clamp(c.fly / REFIT.fly, 0, 1), away = 1 - t * t;
    const pop = THREE.MathUtils.clamp((c.fly - REFIT.fly) / REFIT.pop, 0, 1);
    c.swivel.position.copy(c.home).add(_w.set(Math.sin(c.angle) * REFIT.out, REFIT.up, Math.cos(c.angle) * REFIT.out)
      .multiplyScalar(away));
    c.swivel.rotation.y += away * 5;
    c.wheel.rotation.x += away * 9;
    c.swivel.scale.setScalar((1 - away * 0.5) * (1 + REFIT.squash * Math.sin(Math.PI * pop) * (1 - pop)));
    if (pop < 1) return;
    c.fly = null;
    c.swivel.position.copy(c.home);
    c.swivel.scale.setScalar(1);
  }
}

// One leg of the star: from the hub out to a caster, wide and thick at the hub, slim at the tip, sloping down.
function taperedLeg() {
  const g = new THREE.BoxGeometry(1, 1, 1, 6, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) + 0.5;                          // 0 at the hub, 1 at the tip
    const r = 0.04 + t * (CHAIR.reach - 0.04);
    const w = 0.07 - 0.028 * t, h = 0.05 - 0.018 * t;
    const y = 0.17 - t * 0.04 + p.getY(i) * h - (t > 0.97 ? 0.02 : 0);
    p.setXYZ(i, p.getZ(i) * w, y, r);
  }
  g.computeVertexNormals();
  return g;
}

// The back panel: u across, v up; it widens towards the top, leans back and wraps round the can.
function backPanel() {
  const at = (u, v, target = new THREE.Vector3()) => {
    const width = 0.47 + 0.12 * v, x = (u - 0.5) * width, R = 0.55;
    return target.set(x, 0.16 + 0.56 * v, -0.34 - 0.08 * v + (R - Math.sqrt(R * R - x * x)));
  };
  const nu = 12, nv = 10, positions = [], uvs = [], index = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = at(i / nu, j / nv);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / nu, j / nv);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const rim = [];
  for (let i = 0; i <= 10; i++) rim.push(at(i / 10, 0));
  for (let j = 1; j <= 10; j++) rim.push(at(1, j / 10));
  for (let i = 9; i >= 0; i--) rim.push(at(i / 10, 1));
  for (let j = 9; j >= 1; j--) rim.push(at(0, j / 10));
  return { geometry, outline: new THREE.CatmullRomCurve3(rim, true), corner: side => at(side > 0 ? 1 : 0, 0.12) };
}

// The woven mesh: dark threads in a diamond weave, see-through between them.
let weaveTexture = null;
function meshMaterial(repeatU, repeatV) {
  weaveTexture ??= painted(64, 64, (ctx, w, h) => {
    ctx.strokeStyle = '#2a2d37';
    ctx.lineWidth = 7;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath(); ctx.moveTo(k * w, 0); ctx.lineTo(k * w + w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k * w + w, 0); ctx.lineTo(k * w, h); ctx.stroke();
    }
  });
  const texture = weaveTexture.clone();
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatU * 3, repeatV * 3);
  texture.needsUpdate = true;
  const material = new THREE.MeshToonMaterial({ map: texture, gradientMap: RAMPS.world, alphaTest: 0.35,
    side: THREE.DoubleSide });
  return noOutline(material);
}

function tagMaterial() {
  const texture = painted(150, 220, (ctx, w, h) => {
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.moveTo(w * 0.22, 0); ctx.lineTo(w * 0.78, 0); ctx.lineTo(w, h * 0.16); ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.lineTo(0, h * 0.16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c9c2b0';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.1, w * 0.06, 0, Math.PI * 2); ctx.fill();
    letter(ctx, PRICE, w / 2, h * 0.42, { size: 44, color: '#d0352a', maxWidth: w * 0.9 });
    letter(ctx, 'worth it.', w / 2, h * 0.66, { size: 26, color: '#3b3f4a', maxWidth: w * 0.85, weight: 600 });
    letter(ctx, 'ergonomic', w / 2, h * 0.84, { size: 20, color: '#8a8577', maxWidth: w * 0.85, weight: 500 });
  });
  const material = new THREE.MeshToonMaterial({ map: texture, gradientMap: RAMPS.world, side: THREE.DoubleSide,
    emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.2 });
  return noOutline(material);
}
