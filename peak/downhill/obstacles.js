// What stands on the piste, and what flies off it. Rocks in a slalom, a stretch of pines right across the run, a
// field of snowmen (soft: they burst), ten cheap chairs to bowl over (bowling.js), a snowman taking photos at the
// ski jump, an office at the bottom (office.js: cabinets, desks and a printer are hard, water coolers, plants and
// chairs soft), signs that explain nothing, banners for the start, the pit stops, the river and the finish, paint
// on the snow (marks.js), and pines along the banks. ride.js asks near(s) for what it can hit; burst() pops a soft
// one. The debris (snowballs, a carrot, a lost caster, a water bottle) are loose bodies that bounce and roll down
// the snow on their own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, RAMPS } from '../look/look.js';
import { bursts } from '../look/bursts.js';
import { signpost } from '../props/signs.js';
import { painted, letter } from '../props/paint.js';
import { random } from '../world/world.js';
import { FEATURES, PISTE, BANK, EDGE } from './track.js';
import { Pins } from './bowling.js';
import { knockoff, KNOCKOFF, cabinet, cooler, ficus, desk, printer } from './office.js';
import { laneMarks, hillMarks } from './marks.js';

// [s, d, radius]: the slalom, each rock leaving a way round it
const ROCKS = [[44, 2.5, 0.8], [54, -3, 1], [63, 1, 0.7], [71, 4, 1.1], [80, -1.5, 0.9], [89, 3, 0.8],
  [97, -4, 1.2], [105, 0.5, 0.9], [113, -2.5, 0.7], [121, 3.5, 1], [129, -1, 0.8]];
// [s, d]: the pines right across the run, then the snowmen
const PINES = [[243, -3], [249, 2], [255, -0.5], [261, 4], [267, -4], [273, 0.5], [280, 3.2], [287, -2.5], [293, 1]];
const SNOWMEN = [[374, -2], [378, 2.5], [383, 0], [387, -3.6], [391, 3.4], [396, -0.8], [400, 1.6], [404, -4.2],
  [407, 4.4], [411, -1.8], [1.5, -4.5]];
const SIGNS = [
  [8, -1, 'Ergonomically certified\nfor 0 km/h.'],
  [196, 1, 'Crevasse ahead.\nPull the lever. (Space)'],
  [314, -1, 'Ice. Casters have\nopinions about this.'],
  [366, 1, 'Snowmen are soft.\nRocks are not.'],
  [412, -1, 'Moguls. Lumbar\nsupport recommended.'],
  [493, -1, 'Speed bumps. Not a\nbug, a feature.'],
  [552, 1, 'Meltwater. Pull the\nlever, floe to floe.'],
  [655, 1, 'Bumps again. Keep\nyour coffee level.'],
  [676, -1, 'Knock-offs ahead.\n€49 each. Bowl.'],
  [772, 1, 'Ski jump. Lever at the\nlip, tuck all the way.'],
  [936, -1, 'Back to the office.\nMind the furniture.'],
];
const BANNERS = [[FEATURES.gate, 'START', '#d0352a'],
  ...FEATURES.pits.slice(1).map(s => [s, 'PIT STOP · fresh casters', '#2f6fd0']),
  [FEATURES.river.from - 9, 'MIND THE GAP', '#2f8fd0'], [FEATURES.finish, 'FINISH', 'checker']];
// [s, d, what]: the open-plan office at the bottom, a slalom through the furniture
const OFFICE = [[952, -3, cabinet], [956, 2.5, cooler], [961, 0.5, desk], [966, -4, ficus], [968, 4, cabinet],
  [973, -1.5, cooler], [975, 1.2, knockoff], [977, 3.4, desk], [982, -3.5, cabinet], [985, 1, ficus],
  [990, -0.5, printer], [993, -3.6, knockoff], [995, 3.5, cooler], [997, -4.6, cabinet], [1002, -1.5, desk],
  [1006, 4, ficus], [1008, 1.6, knockoff], [1011, 0, cooler], [1014, -3.2, cabinet], [1016, 3.2, cabinet],
  [1022, -1.5, ficus], [1026, 2.5, cooler], [1029, -0.8, knockoff]];
const SOFT = new Set([cooler, ficus, knockoff]);
const WATER = new THREE.Color('#8ccbf5'), LEAF = new THREE.Color('#4f9a4a'), SOIL = new THREE.Color('#6b4a33');

const GRAVITY = 15;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _m2 = new THREE.Vector3(), _w2 = new THREE.Vector3();

export class Obstacles {
  constructor(track, scene) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'obstacles';
    scene.add(this.group);
    this.list = [];
    this.buckets = [];
    this.found = [];
    this.rand = random(77);
    this.hint = -1;
    // the little world the shared props and bursts expect: a group to go in, things to update, the snow's height
    this.world = { group: this.group, animated: [],
      ground: (x, z) => { const g = track.ground(x, z, this.hint); this.hint = g.i; return { top: g.y }; } };
    this.puffs = bursts(this.world);
    this.debris = new Debris(track, this.group);
    this.rocks();
    this.pines();
    this.snowmen();
    this.pins = new Pins(track, this, this.rand);
    this.office();
    this.photographer();
    this.group.add(laneMarks(track), hillMarks(track));
    for (const [s, side, text] of SIGNS) {
      const frame = track.frame(s), d = side * (PISTE + 1.1);
      signpost(this.world, track.point(s, d), uphill(frame.tangent) - side * 0.45, text, { width: 1.5, height: 0.62,
        size: 30, bottom: 1.2 });
    }
    for (const [s, text, color] of BANNERS) this.banner(s, text, color);
  }

  add(o) {
    const at = this.track.locate(o.x, o.z);
    o.s = at.s;
    o.d = at.d;
    this.list.push(o);
    const b = Math.floor(o.s);
    (this.buckets[b] ??= []).push(o);
    return o;
  }

  // Everything within a few metres of s along the piste.
  near(s) {
    const found = this.found;
    found.length = 0;
    for (let b = Math.floor(s) - 3; b <= Math.floor(s) + 3; b++) {
      const bucket = this.buckets[b];
      if (bucket) for (const o of bucket) found.push(o);
    }
    return found;
  }

  rocks() {
    const material = toon('#ffffff', { vertexColors: true, outline: 'rock' });
    const stone = new THREE.Color('#8f8aa8'), snow = new THREE.Color('#ffffff'), face = new THREE.Vector3();
    for (const [s, d, r] of ROCKS) {
      const at = this.track.point(s, d);
      // a lumpy boulder, faceted, with snow lying on the faces that look up
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const p = geometry.attributes.position, jitter = new Map();
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i);
        const key = _v.toArray().map(v => v.toFixed(3)).join();
        if (!jitter.has(key)) jitter.set(key, 0.82 + 0.3 * this.rand());
        _v.multiplyScalar(jitter.get(key));
        _v.y *= 0.85;
        p.setXYZ(i, _v.x, _v.y, _v.z);
      }
      geometry.computeVertexNormals();
      const colors = [], n = geometry.attributes.normal;
      for (let i = 0; i < p.count; i += 3) {
        face.fromBufferAttribute(n, i);
        const c = face.y > 0.55 ? snow : stone;
        for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const rock = new THREE.Mesh(geometry, material);
      rock.scale.setScalar(r);
      rock.rotation.y = this.rand() * 6;
      const y = at.y + 0.3 * r;
      rock.position.set(at.x, y, at.z);
      rock.castShadow = rock.receiveShadow = true;
      this.group.add(rock);
      this.add({ kind: 'rock', x: at.x, y, z: at.z, r, top: y + r * 0.85, mesh: rock });
    }
  }

  // Pines: one instanced mesh for all of them, those across the run and those lining the banks. Each one is hard.
  pines() {
    const spots = PINES.map(([s, d]) => [s, d, 1]);
    const R = this.rand, C = FEATURES.crevasse, W = FEATURES.river;
    for (let s = 20; s < FEATURES.finish + 30; s += 5.5) {
      if (s > C.from - 14 && s < C.to + 6 || s > W.from - 18 && s < W.to + 12) continue;
      for (const side of [-1, 1]) {
        if (R() < 0.35) continue;
        const d = side * (PISTE + BANK + 0.8 + R() * (EDGE - PISTE - BANK - 1.8));
        spots.push([s + R() * 3, d, 0.8 + R() * 0.5]);
      }
      // the forest grows down the banks too, where the pines stand across the run
      if (s > 234 && s < 300) for (const side of [-1, 1]) spots.push([s + R() * 3, side * (PISTE + 1.5 + R() * 4), 0.8 + R() * 0.4]);
    }
    const mesh = new THREE.InstancedMesh(pineGeometry(), toon('#ffffff', { vertexColors: true }), spots.length);
    spots.forEach(([s, d, size], i) => {
      const at = this.track.point(s, d);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.3);
      const tall = size * (0.9 + R() * 0.3);
      mesh.setMatrixAt(i, _m.compose(at.clone().setY(at.y - 0.1), _q, _v.set(size, tall, size)));
      // r: its widest branches, for the autopilot; ride.js asks pineReach() at the chair's height
      this.add({ kind: 'tree', x: at.x, y: at.y - 0.1, z: at.z, r: PINE_TIERS[0][0] * size, size, tall,
        top: at.y - 0.1 + 3.75 * tall });
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  snowmen() {
    for (const [s, d] of SNOWMEN) {
      const at = this.track.point(s, d), group = snowman(this.rand, s < 10 || this.rand() < 0.5);
      group.position.copy(at);
      group.rotation.y = uphill(this.track.frame(s).tangent) + (this.rand() - 0.5) * 0.8;
      this.group.add(group);
      this.add({ kind: 'snowman', soft: true, x: at.x, y: at.y, z: at.z, r: 0.42, top: at.y + 1.45, mesh: group });
    }
  }

  // The office: hard furniture to steer round, soft things to plough through. A loafing knock-off flies off whole.
  office() {
    for (const [s, d, make] of OFFICE) {
      const at = this.track.point(s, d), soft = SOFT.has(make);
      let thing = make(this.rand);
      if (make === knockoff) {
        const chair = thing;
        chair.position.y = KNOCKOFF.middle;
        chair.userData.radius = KNOCKOFF.radius;
        thing = new THREE.Group().add(chair);
        thing.userData = { parts: [chair], radius: KNOCKOFF.radius, height: KNOCKOFF.height };
      }
      thing.position.copy(at);
      thing.rotation.y = uphill(this.track.frame(s).tangent) + (this.rand() - 0.5) * (soft ? 2.5 : 0.6);
      this.group.add(thing);
      const kind = make === knockoff ? 'knockoff' : make.name;
      this.add({ kind, soft, x: at.x, y: at.y, z: at.z, r: thing.userData.radius, top: at.y + thing.userData.height,
        mesh: thing, puff: kind === 'cooler' ? 'water' : kind === 'ficus' ? 'leaves' : 'snow' });
    }
  }

  // At the side of the landing hill, a snowman in big glasses with a camera on a tripod, aimed at the jump.
  photographer() {
    const J = FEATURES.jump, s = J.lip + 15, d = 8.6;
    const at = this.track.point(s, d), aim = this.track.point(J.lip + 9, 0);
    const group = snowman(this.rand, true), ink = toon('#25272e'), metal = toon('#9aa0ab');
    const rig = new THREE.Group();
    rig.position.set(0, 0, 0.55);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.15, 5), metal);
      leg.position.set(Math.sin(a) * 0.14, 0.55, Math.cos(a) * 0.14);
      leg.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
      rig.add(leg);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.11), ink);
    body.position.y = 1.18;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), ink);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.18, 0.1);
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), toon('#f4f6fa'));
    flash.position.set(0.04, 1.29, 0.01);
    rig.add(body, lens, flash);
    group.add(rig);
    body.userData.radius = 0.08;
    group.userData.parts.push(body);
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.position.copy(at);
    group.rotation.y = Math.atan2(aim.x - at.x, aim.z - at.z);
    this.group.add(group);
    this.cameraman = this.add({ kind: 'photographer', soft: true, x: at.x, y: at.y, z: at.z, r: 0.5, top: at.y + 1.45,
      mesh: group });
    // where the photo is taken from: just above the lens
    group.updateMatrixWorld(true);
    this.lens = lens.getWorldPosition(new THREE.Vector3()).setY(at.y + 1.25);
  }

  // A banner on two poles right across the piste, facing the way down. The poles are hard.
  banner(s, text, color) {
    const frame = this.track.frame(s), half = PISTE + 0.35;
    const left = this.track.point(s, -half), right = this.track.point(s, half);
    const top = Math.max(left.y, right.y) + 2.9;
    const pole = toon('#e9edf3');
    for (const foot of [left, right]) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, top - foot.y + 0.2, 10), pole);
      mesh.position.set(foot.x, (top + foot.y + 0.2) / 2, foot.z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.add({ kind: 'pole', x: foot.x, y: foot.y, z: foot.z, r: 0.08, top: top + 0.2 });
    }
    const width = half * 2, height = 0.9;
    const texture = painted(1024, Math.round(1024 * height / width), (ctx, w, h) => {
      if (color === 'checker') {
        const n = 24, size = w / n;
        for (let i = 0; i < n; i++) for (let j = 0; j * size < h; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#1d1d26' : '#ffffff';
          ctx.fillRect(i * size, j * size, size, size);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(w * 0.32, h * 0.12, w * 0.36, h * 0.76);
        letter(ctx, text, w / 2, h / 2, { size: h * 0.62, color: '#1d1d26', maxWidth: w * 0.34 });
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, h * 0.08, w, h * 0.04);
        ctx.fillRect(0, h * 0.88, w, h * 0.04);
        letter(ctx, text, w / 2, h / 2 + h * 0.02, { size: h * 0.56, color: '#ffffff', maxWidth: w * 0.9 });
      }
    });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshToonMaterial({ map: texture, gradientMap: RAMPS.world, side: THREE.DoubleSide }));
    cloth.material.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.004, alpha: 1 };
    cloth.position.set((left.x + right.x) / 2, top - height / 2, (left.z + right.z) / 2);
    cloth.rotation.y = uphill(frame.tangent);
    cloth.castShadow = true;
    this.group.add(cloth);
  }

  // Something soft is hit (n points from it to the chair, speed is how fast the chair came at it). A pin is knocked
  // over (bowling.js). The rest go up in a puff, of powder, water or leaves, and their parts (a snowman's balls and
  // nose, a water bottle, a pot) fly on with the chair.
  // Water flying: drops thrown up and along with vel, and a little spray. size 1 is a water cooler; the river, more.
  splash(at, vel, size = 1) {
    const R = this.rand;
    for (let i = 0; i < 26 * size; i++) {
      this.puffs.add('bit', { at, size: 0.03 + 0.04 * R(), life: 0.7 + 0.5 * R(), gravity: 12, drag: 0.8, bounce: 0,
        spin: 4, color: WATER, vel: _n.copy(vel).multiplyScalar(0.5).add(_m2.set(R() - 0.5, 1 + 2 * R(), R() - 0.5)
          .multiplyScalar(3 * Math.sqrt(size))) });
    }
    this.puffs.snow(at, { puffs: 5 * size, flakes: 4 * size, spread: 0.6 * size, size: 1.2, grit: 0 });
  }

  burst(o, vel, n, speed) {
    if (o.hit) return o.hit(o, vel, n, speed);
    o.gone = true;
    o.mesh.visible = false;
    const at = _v.set(o.x, o.y + 0.7, o.z);
    if (o.puff === 'water') {
      this.splash(at, vel);
    } else if (o.puff === 'leaves') {
      for (let i = 0; i < 18; i++) {
        const R = this.rand;
        this.puffs.add('bit', { at: _n.copy(at).setY(at.y + 0.3), size: 0.04 + 0.03 * R(), life: 1.2 + R(), gravity: 3,
          drag: 2, bounce: 0, spin: 9, color: R() < 0.8 ? LEAF : SOIL,
          vel: _m2.copy(vel).multiplyScalar(0.4).add(_w2.set(R() - 0.5, 0.5 + 1.5 * R(), R() - 0.5).multiplyScalar(3)) });
      }
    } else {
      this.puffs.snow(at, { puffs: 12, flakes: 22, spread: 1.4, size: 2.4, grit: 0, up: 1.8 });
    }
    o.mesh.updateWorldMatrix(true, true);
    for (const part of o.mesh.userData.parts) {
      const copy = part.clone();
      part.getWorldPosition(copy.position);
      part.getWorldQuaternion(copy.quaternion);
      part.getWorldScale(copy.scale);
      const R = this.rand;
      const v = vel.clone().multiplyScalar(0.55 + 0.4 * R()).add(_n.set(R() - 0.5, 0.6 + R(), R() - 0.5).multiplyScalar(3.5));
      this.debris.add(copy, { vel: v, radius: part.userData.radius ?? 0.12, life: 5 + 3 * R(), bounce: 0.25 });
    }
  }

  // Back as they were, for a new try: every snowman, plant and water cooler stands again, and the pins are set up.
  reset() {
    for (const o of this.list) {
      if (!o.soft || o.hit) continue;
      o.gone = false;
      o.mesh.visible = true;
    }
    this.pins.reset();
  }

  // s: where the chair is. What is far down the run (or well behind it) isn't drawn.
  update(dt, s) {
    for (const a of this.world.animated) a.update(dt);
    this.debris.update(dt);
    this.pins.update(dt);
    for (const o of this.list) if (o.mesh && !o.gone) o.mesh.visible = o.s > s - 40 && o.s < s + 230;
  }
}

// The yaw that turns a thing's front (+z) to face up the hill, towards whoever comes down.
export const uphill = tangent => Math.atan2(-tangent.x, -tangent.z);

// Loose bodies on the snow: gravity, a bounce off the ground, friction, and rolling, which turns them about the axis
// across the way they go. They shrink away at the end of their life.
class Debris {
  constructor(track, group) {
    this.track = track;
    this.group = group;
    this.bodies = [];
    this.probe = { normal: new THREE.Vector3() };
  }

  add(mesh, { vel, radius, life = 8, bounce = 0.3, roll = true }) {
    if (this.bodies.length > 40) this.remove(this.bodies[0]);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.bodies.push({ mesh, vel: vel.clone(), radius, life, age: 0, bounce, roll, hint: -1, size: mesh.scale.clone(),
      spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12) });
  }

  remove(body) {
    this.group.remove(body.mesh);
    this.bodies.splice(this.bodies.indexOf(body), 1);
  }

  update(dt) {
    for (const b of [...this.bodies]) {
      b.age += dt;
      if (b.age > b.life) { this.remove(b); continue; }
      const p = b.mesh.position;
      b.vel.y -= GRAVITY * dt;
      p.addScaledVector(b.vel, dt);
      const g = this.track.ground(p.x, p.z, b.hint, this.probe);
      b.hint = g.i;
      if (p.y - b.radius < g.y) {
        p.y = g.y + b.radius;
        const vn = b.vel.dot(g.normal);
        if (vn < 0) b.vel.addScaledVector(g.normal, -(1 + (vn < -2 ? b.bounce : 0)) * vn);
        b.vel.multiplyScalar(Math.exp(-(g.surface === 'ice' ? 0.1 : 0.9) * dt));
        // rolling: turning about the axis across its way, at its speed over its radius
        if (b.roll) b.spin.crossVectors(g.normal, b.vel).divideScalar(b.radius);
      }
      const w = b.spin.length();
      if (w > 1e-3) b.mesh.quaternion.premultiply(_q.setFromAxisAngle(_n.copy(b.spin).divideScalar(w), w * dt));
      const fade = THREE.MathUtils.clamp((b.life - b.age) / 0.6, 0, 1);
      b.mesh.scale.copy(b.size).multiplyScalar(fade);
    }
  }
}

// A pine's tiers of branches, for one of size 1: the radius at the bottom, the height, and how high the bottom is.
export const PINE_TIERS = [[1.25, 1.7, 0.65], [0.95, 1.45, 1.6], [0.62, 1.25, 2.5]];
export const TRUNK = { radius: 0.17, height: 0.9 };

// How far out a pine (an obstacle from pines()) reaches between heights lo and hi above its foot: its widest branch
// in that span (a cone is widest at its lowest point), or its trunk below the branches.
export function pineReach(o, lo, hi) {
  let r = lo < TRUNK.height * o.tall ? TRUNK.radius * o.size : 0;
  for (const [radius, height, y] of PINE_TIERS) {
    const bottom = y * o.tall, top = (y + height) * o.tall;
    if (hi < bottom || lo > top) continue;
    r = Math.max(r, radius * o.size * (1 - (Math.max(lo, bottom) - bottom) / (top - bottom)));
  }
  return r;
}

// A pine: a trunk and three tiers of branches, each with snow lying on its top, in one geometry with vertex colours.
function pineGeometry() {
  const parts = [];
  const piece = (geometry, color, y) => {
    geometry.translate(0, y, 0);
    const c = new THREE.Color(color), n = geometry.attributes.position.count;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    parts.push(geometry.toNonIndexed());
  };
  piece(new THREE.CylinderGeometry(0.11, TRUNK.radius, TRUNK.height, 7), '#7a5236', TRUNK.height / 2);
  for (const [r, h, y] of PINE_TIERS) {
    piece(new THREE.ConeGeometry(r, h, 9), '#3e7a68', y + h / 2);
    piece(new THREE.ConeGeometry(r * 0.62, h * 0.42, 9), '#ffffff', y + h * 0.8 + 0.03);
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts);
}

// A snowman: three balls, coal eyes, a carrot and stick arms, and sometimes big black glasses, Mnot-style. Its
// parts fly off as debris when it bursts.
function snowman(rand, glasses) {
  const group = new THREE.Group();
  const snow = toon('#ffffff'), coal = toon('#25272e'), carrot = toon('#f08a2b'), stick = toon('#7a5236');
  const parts = [];
  const ball = (r, y) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), snow);
    m.position.y = y;
    m.userData.radius = r;
    group.add(m);
    parts.push(m);
    return m;
  };
  ball(0.42, 0.36);
  ball(0.31, 0.9);
  const head = ball(0.22, 1.27);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), coal);
    eye.position.set(side * 0.08, 0.05, 0.19);
    head.add(eye);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.55, 5), stick);
    arm.position.set(side * 0.42, 1.0, 0);
    arm.rotation.z = side * (1.0 + rand() * 0.5);
    arm.userData.radius = 0.05;
    group.add(arm);
    parts.push(arm);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 8), carrot);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.25, 0.3);
  nose.userData.radius = 0.04;
  group.add(nose);
  parts.push(nose);
  if (glasses) {
    const frame = new THREE.Group();
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 6, 16), coal);
      ring.position.set(side * 0.085, 0, 0);
      frame.add(ring);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.016), coal);
    frame.add(bridge);
    frame.position.set(0, 0.05, 0.2);
    head.add(frame);
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  group.userData.parts = parts;
  return group;
}
