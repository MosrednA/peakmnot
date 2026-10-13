// The mountain: rock pillars, planks and ropes high above a sea of clouds. The route itself is data in route.js;
// this file builds the meshes and answers the player's questions: what's under me, which walls push me out, am I on
// a plank or a rope.
import * as THREE from 'three';
import { toon } from './look.js';
import { rock as rockMaterial } from './materials.js';

export function random(seed) {   // mulberry32, so the mountain looks the same every time
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const WOOD = '#b07a4a', ROPE = '#d9c08a';

// A rock you can stand on: a convex outline in XZ with a flat top. Its sides are walls.
export class Solid {
  constructor(poly, top, bottom, kind = 'rock') {
    this.poly = poly;
    this.top = top;
    this.bottom = bottom;
    this.kind = kind;
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cz = poly.reduce((s, p) => s + p.z, 0) / poly.length;
    this.center = new THREE.Vector2(cx, cz);
    this.edges = poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let nx = (b.z - a.z) / len, nz = -(b.x - a.x) / len;
      if (nx * ((a.x + b.x) / 2 - cx) + nz * ((a.z + b.z) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z, nx, nz, len };
    });
    this.radius = Math.max(...poly.map(p => Math.hypot(p.x - cx, p.z - cz)));
  }

  // Signed distance from the outline (< 0 inside) and the direction that leads out.
  closest(x, z) {
    let d = -Infinity, edge = null;
    for (const e of this.edges) {
      const s = e.nx * (x - e.ax) + e.nz * (z - e.az);
      if (s > d) { d = s; edge = e; }
    }
    if (d <= 0) return { d, nx: edge.nx, nz: edge.nz };
    let best = Infinity, nx = 0, nz = 0;
    for (const e of this.edges) {
      const t = THREE.MathUtils.clamp(((x - e.ax) * (e.bx - e.ax) + (z - e.az) * (e.bz - e.az)) / (e.len * e.len), 0, 1);
      const qx = e.ax + (e.bx - e.ax) * t, qz = e.az + (e.bz - e.az) * t, dist = Math.hypot(x - qx, z - qz);
      if (dist < best) { best = dist; nx = (x - qx) / dist; nz = (z - qz) / dist; }
    }
    return { d: best, nx, nz };
  }

  near(x, z, margin) {
    return Math.hypot(x - this.center.x, z - this.center.y) < this.radius + margin;
  }
}

// A plank or rope to balance on, from a to b (the walking surface at both ends). A rope sags, more so under Mnot.
export class Beam {
  constructor(kind, a, b, { sag = 0, width = 0.3, wobble = 1 } = {}) {
    this.kind = kind;
    this.a = a.clone();
    this.b = b.clone();
    this.sag = sag;
    this.width = width;
    this.wobble = wobble;                          // how unstable it is, scales the lean's fall-over pull
    this.dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    this.length = this.dir.length();
    this.dir.divideScalar(this.length);
    this.right = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.load = null;                              // where Mnot stands (0..1), so a rope dips there
    this.dip = 0;                                  // how far it dips under Mnot
    this.sway = 0;                                 // sideways swing of a rope's middle, in the wind
  }

  project(x, z) {
    const dx = x - this.a.x, dz = z - this.a.z;
    return { s: (dx * this.dir.x + dz * this.dir.z) / this.length, lat: dx * this.right.x + dz * this.right.z };
  }

  // Height of the walking surface at s (0..1), including the dip under Mnot.
  heightAt(s) {
    let y = this.a.y + (this.b.y - this.a.y) * s - this.sag * 4 * s * (1 - s);
    if (this.load !== null && this.dip > 0) {
      const p = THREE.MathUtils.clamp(this.load, 0.02, 0.98), peak = this.dip * 4 * p * (1 - p);
      y -= s < p ? peak * s / p : peak * (1 - s) / (1 - p);
    }
    return y;
  }

  // The rope's sideways swing at s (0 at the ends).
  swayAt(s) {
    return this.sway * Math.sin(Math.PI * THREE.MathUtils.clamp(s, 0, 1));
  }

  pointAt(s, target = new THREE.Vector3()) {
    target.set(this.a.x + (this.b.x - this.a.x) * s, this.heightAt(s), this.a.z + (this.b.z - this.a.z) * s);
    return target.addScaledVector(this.right, this.swayAt(s));
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.solids = [];
    this.beams = [];
    this.checkpoints = [];
    this.zones = [];          // { kind: 'wind' | 'rockfall' | 'snow', ... }
    this.rail = [];           // the camera's guide along the route: { at, theta, pitch, distance }
    this.blockers = [];       // meshes the camera stays in front of
    this.animated = [];       // things with an update(dt, time, weather)
    this.summit = null;
    this.rand = random(7);
  }

  // ------------------------------------------------------------------ queries

  // The highest top under (x, z) that is no higher than maxY, within margin of a rock's edge.
  ground(x, z, maxY, margin = 0.1) {
    let best = null;
    for (const s of this.solids) {
      if (s.top > maxY || s.top < (best?.top ?? -Infinity) || !s.near(x, z, margin)) continue;
      if (s.closest(x, z).d <= margin) best = s;
    }
    return best;
  }

  // A plank or rope under (x, z) whose surface is between minY and maxY.
  beam(x, z, minY, maxY, tolerance = 0.3) {
    let best = null;
    for (const b of this.beams) {
      const { s, lat } = b.project(x, z);
      if (s < 0 || s > 1 || Math.abs(lat - b.swayAt(s)) > tolerance) continue;
      const y = b.heightAt(s);
      if (y < minY || y > maxY) continue;
      if (!best || y > best.y) best = { beam: b, s, lat, y };
    }
    return best;
  }

  // Push a standing cylinder out of every rock it walks into. Rocks no higher than stepTop are stepped onto instead.
  pushOut(pos, radius, stepTop, headY) {
    let hit = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.solids) {
        if (s.top <= stepTop || s.bottom >= headY || !s.near(pos.x, pos.z, radius)) continue;
        const c = s.closest(pos.x, pos.z);
        if (c.d >= radius) continue;
        pos.x += c.nx * (radius - c.d);
        pos.z += c.nz * (radius - c.d);
        hit = c;
      }
    }
    return hit;
  }

  // Where the route goes near pos, and how the camera looks at that stretch (values blend along each stretch).
  // Within CORNER of a bend the way turns gradually, half-way at the bend itself, so "onwards" has no seam. side is
  // how far pos is off the walking line, to the route's right.
  railAt(pos) {
    const CORNER = 0.8;
    const dirOf = i => new THREE.Vector3().subVectors(this.rail[i + 1].at, this.rail[i].at).setY(0).normalize();
    let best = null;
    for (let i = 0; i < this.rail.length - 1; i++) {
      const a = this.rail[i], b = this.rail[i + 1];
      const ab = new THREE.Vector3().subVectors(b.at, a.at);
      const u = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(pos, a.at).dot(ab) / ab.lengthSq(), 0, 1);
      const q = a.at.clone().addScaledVector(ab, u);
      const d = Math.hypot(pos.x - q.x, 2 * (pos.y - q.y), pos.z - q.z);   // heights tell stacked stretches apart
      if (!best || d < best.d) best = { i, d, a, b, u, q, length: Math.hypot(ab.x, ab.z) };
    }
    const { i, a, b, u, q, length } = best;
    const dir = dirOf(i), reach = Math.min(CORNER, length / 2), done = u * length;
    if (done > length - reach && i + 2 < this.rail.length) dir.lerp(dirOf(i + 1), 0.5 * (1 - (length - done) / reach));
    else if (done < reach && i > 0) dir.lerp(dirOf(i - 1), 0.5 * (1 - done / reach));
    const mix = key => a[key] + (b[key] - a[key]) * u;
    const way = dirOf(i), side = (pos.x - q.x) * -way.z + (pos.z - q.z) * way.x;
    return { dir: dir.normalize(), side, theta: mix('theta'), pitch: mix('pitch'), distance: mix('distance') };
  }

  zonesAt(kind, x, z) {
    let value = 0;
    for (const zone of this.zones) {
      if (zone.kind !== kind) continue;
      const d = Math.hypot(x - zone.x, z - zone.z);
      value = Math.max(value, zone.strength * (1 - THREE.MathUtils.smoothstep(d, zone.radius * 0.7, zone.radius)));
    }
    return value;
  }

  // ------------------------------------------------------------------ building

  // A rock pillar: w by d with chamfered corners, turned by rot degrees, its top at y.
  rock({ x, z, w, d, y, rot = 0, depth = 70, chamfer = 0.3, seed }) {
    const rand = seed === undefined ? this.rand : random(seed);
    const c = Math.cos(THREE.MathUtils.degToRad(rot)), s = Math.sin(THREE.MathUtils.degToRad(rot));
    const hw = w / 2, hd = d / 2, ch = Math.min(chamfer, hw * 0.6, hd * 0.6);
    const corners = [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]];
    const poly = [];
    for (let i = 0; i < 4; i++) {
      const [px, pz] = corners[i], [nx, nz] = corners[(i + 1) % 4], [qx, qz] = corners[(i + 3) % 4];
      const k1 = ch * (0.45 + 0.8 * rand()), k2 = ch * (0.45 + 0.8 * rand());
      const toPrev = [Math.sign(qx - px) * Math.min(k1, Math.abs(qx - px) / 2.2), Math.sign(qz - pz) * Math.min(k1, Math.abs(qz - pz) / 2.2)];
      const toNext = [Math.sign(nx - px) * Math.min(k2, Math.abs(nx - px) / 2.2), Math.sign(nz - pz) * Math.min(k2, Math.abs(nz - pz) / 2.2)];
      poly.push([px + toPrev[0], pz + toPrev[1]], [px + toNext[0], pz + toNext[1]]);
    }
    const pts = poly.map(([px, pz]) => ({ x: x + px * c + pz * s, z: z - px * s + pz * c }));
    const solid = new Solid(pts, y, y - depth);
    this.solids.push(solid);
    const mesh = rockMesh(solid, rand);
    this.group.add(mesh);
    this.blockers.push(mesh);
    return solid;
  }

  // A board walk: wide enough to walk on without balancing. Its top is a flat solid from a to b.
  board(a, b, width = 0.8) {
    const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
    const hw = width / 2;
    const pts = [a.clone().addScaledVector(right, hw), b.clone().addScaledVector(right, hw),
      b.clone().addScaledVector(right, -hw), a.clone().addScaledVector(right, -hw)].map(p => ({ x: p.x, z: p.z }));
    const solid = new Solid(pts, a.y, a.y - 0.12, 'board');
    this.solids.push(solid);
    const length = a.distanceTo(b), count = Math.round(length / 0.26);
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.07, 0.22), toon(WOOD), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const rand = this.rand;
    for (let i = 0; i < count; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / count);
      p.y -= 0.035 + 0.01 * rand();
      const tilt = new THREE.Quaternion().setFromAxisAngle(dir, (rand() - 0.5) * 0.06);
      m.compose(p, tilt.multiply(q), new THREE.Vector3(1 - 0.1 * rand(), 1, 1));
      planks.setMatrixAt(i, m);
    }
    planks.castShadow = planks.receiveShadow = true;
    this.group.add(planks);
    // rope rails on posts
    for (const side of [-1, 1]) {
      const posts = [];
      for (let i = 0; i <= Math.max(1, Math.round(length / 1.6)); i++) {
        const t = i / Math.max(1, Math.round(length / 1.6));
        posts.push(a.clone().lerp(b, t).addScaledVector(right, side * (hw + 0.02)));
      }
      for (const p of posts) this.post(p, 0.62, 0.035);
      const rail = [];
      for (let i = 0; i < posts.length - 1; i++) {
        for (let k = 0; k < 8; k++) {
          const t = k / 8, q = posts[i].clone().lerp(posts[i + 1], t);
          q.y += 0.58 - 0.08 * Math.sin(Math.PI * t);
          rail.push(q);
        }
      }
      rail.push(posts.at(-1).clone().setY(posts.at(-1).y + 0.58));
      this.ropeMesh(rail, 0.018);
    }
    return solid;
  }

  // A single plank to balance on.
  plank(a, b, { width = 0.3, wobble = 1 } = {}) {
    const beam = new Beam('plank', a, b, { width, wobble });
    this.beams.push(beam);
    const along = new THREE.Vector3().subVectors(b, a), length = along.length();
    along.normalize();
    const up = new THREE.Vector3().crossVectors(beam.right, along).normalize();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, length + 0.3), toon(WOOD));
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beam.right, up, along));
    mesh.position.copy(a).lerp(b, 0.5).addScaledVector(up, -0.035);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    beam.mesh = mesh;
    return beam;
  }

  // A tightrope between two stakes; it sags, dips under Mnot and swings in the wind.
  rope(a, b, { sag = 0.25, wobble = 2.7 } = {}) {
    const beam = new Beam('rope', a, b, { sag, width: 0.06, wobble });
    beam.dip = 0.22;
    this.beams.push(beam);
    for (const end of [a, b]) {
      const outward = end === a ? -1 : 1;
      this.post(end.clone().addScaledVector(beam.dir, 0.12 * outward), 0.35, 0.05);
    }
    const segments = 48, radial = 6, r = 0.03;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * radial * 3);
    const index = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const p = i * radial + j, q = i * radial + (j + 1) % radial;
        index.push(p, p + radial, q, q, p + radial, q + radial);
      }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geometry, toon(ROPE));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const point = new THREE.Vector3(), side = beam.right, up = UP;
    beam.update = () => {
      for (let i = 0; i <= segments; i++) {
        const s = -0.03 + 1.06 * i / segments;
        beam.pointAt(s, point);
        point.y -= r;     // the walking surface is the rope's top
        for (let j = 0; j < radial; j++) {
          const a = 2 * Math.PI * j / radial;
          const k = (i * radial + j) * 3;
          positions[k] = point.x + side.x * Math.cos(a) * r;
          positions[k + 1] = point.y + Math.sin(a) * r;
          positions[k + 2] = point.z + side.z * Math.cos(a) * r;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
    };
    beam.update();
    this.animated.push(beam);
    return beam;
  }

  post(foot, height, radius) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, height, 7), toon('#8a5a34'));
    mesh.position.copy(foot).setY(foot.y + height / 2 - 0.05);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  ropeMesh(points, radius) {
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, radius, 5), toon(ROPE));
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  zone(kind, x, z, radius, strength = 1, extra = {}) {
    this.zones.push({ kind, x, z, radius, strength, ...extra });
  }
}

// ------------------------------------------------------------------ rock meshes

// One closed surface: a ring at each depth, the sides bulging and widening towards the mountain's foot, and a top
// that rises a few centimetres in a soft pillow of snow. The lip is exactly the collision outline. The material
// (materials.js) paints the facets, the snow and the lip's ink line from aDrop; the shared vertices give smooth
// normals, so the outline drawn round the rock has no cracks.
function rockMesh(solid, rand) {
  const ring = [];
  for (const e of solid.edges) {
    const n = Math.max(1, Math.round(e.len / 0.45));
    for (let k = 0; k < n; k++) ring.push({ x: e.ax + (e.bx - e.ax) * k / n, z: e.az + (e.bz - e.az) * k / n });
  }
  const N = ring.length;
  const { x: cx, y: cz } = solid.center;
  const depth = solid.top - solid.bottom;
  const levels = [0, 0.1, 0.32, 0.75, 1.4, 2.4, 3.8, 6, 9, 14, 21, 32, 48, depth].filter(v => v <= depth);
  const wobble = levels.map(() => ring.map(() => rand()));
  const positions = [], drops = [], index = [];
  const add = (x, y, z, drop) => { positions.push(x, y, z); drops.push(drop); return drops.length - 1; };
  levels.forEach((dy, level) => {
    for (let i = 0; i < N; i++) {
      const p = ring[i], ox = p.x - cx, oz = p.z - cz, len = Math.hypot(ox, oz);
      // the lip curls in a little, then the face bulges out and widens further down
      const w = wobble[level][i];
      const out = level === 0 ? 0 : level === 1 ? -0.05 : -0.14 + 0.24 * w + Math.max(0, dy - 3) * 0.025;
      add(p.x + ox / len * out, solid.top - dy, p.z + oz / len * out, dy);
    }
  });
  for (let l = 0; l < levels.length - 1; l++) {
    for (let i = 0; i < N; i++) {
      const a = l * N + i, b = l * N + (i + 1) % N, c = a + N, d = b + N;
      index.push(a, b, c, b, d, c);
    }
  }
  // the top: an inner ring a little way in and up, then the middle
  const inner = ring.map(p => {
    const ox = cx - p.x, oz = cz - p.z, len = Math.hypot(ox, oz), k = Math.min(0.16, 0.3 * len);
    return add(p.x + ox / len * k, solid.top + 0.025, p.z + oz / len * k, -k);
  });
  const reach = ring.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.z - cz), 0) / N;
  const middle = add(cx, solid.top + 0.035, cz, -reach);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    index.push(inner[i], j, i, inner[i], inner[j], j, middle, inner[j], inner[i]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDrop', new THREE.Float32BufferAttribute(drops, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, rockMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
