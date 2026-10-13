// The dents you can see: the health bar is the can itself. Each dent presses a crumpled hollow into the can on the
// side the hit came from (low for a hard landing, anywhere for a fall); a checkpoint pops them all out with a boing.
// The hollows are morph targets built here from the can's own meshes, so the model needs no extra shape keys.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const CAN_RADIUS = 0.3;
const SIZE = 0.15;           // a dent's radius on the can
const DEPTH = 0.095;
// Where dents can go: the angle round the can (0 = the front, + towards Mnot's left) and the height in the model.
// Not right behind the glasses; the last two crumple the top rim.
const SPOTS = [[0, 0.8], [0.9, 1.15], [-0.9, 0.92], [1.7, 0.82], [-1.7, 1.22], [2.5, 1.18], [-2.5, 0.84],
  [Math.PI, 1.02], [0.6, 1.52], [-2.1, 1.52]];
const SPRING = 320, FRICTION = 11;   // springy: a dent overshoots as it lands, and bulges for a moment popping out

export class Dents {
  constructor(mnot, game) {
    this.meshes = [];
    mnot.model.traverse(o => {
      if (o.isMesh && (o.material.name === 'Can' || o.material.name === 'Aluminium')) this.meshes.push(o);
    });
    for (const mesh of this.meshes) {
      if (mesh.material.name === 'Can') addRings(mesh);
      addHollows(mesh);
    }
    this.root = mnot.root;
    this.spots = SPOTS.map(([angle, y]) => ({ angle, y, target: 0, value: 0, speed: 0 }));
    game.on('dent', ({ reason, from }) => this.press(reason, from));
    game.on('pop', () => { for (const s of this.spots) s.target = 0; });
  }

  // A free spot facing where the hit came from, or a fitting one at random.
  press(reason, from) {
    const free = this.spots.filter(s => s.target === 0);
    if (!free.length) return;
    let pick;
    if (from) {
      const local = this.root.worldToLocal(from.clone());
      const angle = Math.atan2(local.x, local.z), high = local.y > 1.4;
      const cost = s => Math.abs(Math.atan2(Math.sin(s.angle - angle), Math.cos(s.angle - angle))) + (high && s.y < 1.4 ? 1 : 0);
      pick = free.reduce((a, b) => cost(b) < cost(a) ? b : a);
    } else {
      const low = free.filter(s => s.y < 1);
      const pool = reason === 'landing' && low.length ? low : free;
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
    pick.target = 1;
    pick.speed = 9;          // a smack
  }

  update(dt) {
    for (const s of this.spots) {
      s.speed += (SPRING * (s.target - s.value) - FRICTION * s.speed) * dt;
      s.value += s.speed * dt;
      if (s.target === 0 && Math.abs(s.value) < 1e-3 && Math.abs(s.speed) < 1e-2) s.value = s.speed = 0;
    }
    for (const mesh of this.meshes) this.spots.forEach((s, i) => { mesh.morphTargetInfluences[i] = s.value; });
  }
}

// The can's side has few rings (plenty for a smooth can); a dent needs more, so tall triangles are cut into strips
// RING apart. A cut depends only on its own edge, so neighbouring triangles stay joined. The can is rigid (no UVs,
// one bone), so positions and normals are blended and the rest is copied.
function addRings(mesh, RING = 0.04) {
  const source = mesh.geometry.toNonIndexed(), attributes = source.attributes, names = Object.keys(attributes);
  const out = Object.fromEntries(names.map(n => [n, []]));
  const vertex = i => Object.fromEntries(names.map(n => {
    const { array, itemSize } = attributes[n];
    return [n, Array.from(array.subarray(i * itemSize, (i + 1) * itemSize))];
  }));
  const mix = (a, b, t) => Object.fromEntries(names.map(n =>
    [n, n === 'position' || n === 'normal' ? a[n].map((v, k) => v + (b[n][k] - v) * t) : a[n]]));
  const push = v => { for (const n of names) out[n].push(...v[n]); };
  for (let i = 0; i < attributes.position.count; i += 3) {
    const v = [vertex(i), vertex(i + 1), vertex(i + 2)], y = v.map(c => c.position[1]);
    // the corner the other two share a height against, if it's far above or below them
    const top = [0, 1, 2].find(k => Math.abs(y[(k + 1) % 3] - y[(k + 2) % 3]) < 1e-4 && Math.abs(y[k] - y[(k + 1) % 3]) > RING);
    if (top === undefined) { v.forEach(push); continue; }
    const c = v[top], a = v[(top + 1) % 3], b = v[(top + 2) % 3];     // the same winding
    const n = Math.ceil(Math.abs(c.position[1] - a.position[1]) / RING);
    for (let k = 0; k < n; k++) {
      const a0 = mix(a, c, k / n), b0 = mix(b, c, k / n), a1 = mix(a, c, (k + 1) / n), b1 = mix(b, c, (k + 1) / n);
      push(a0); push(b0); push(b1);
      if (k < n - 1) { push(a0); push(b1); push(a1); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const n of names) {
    const { array, itemSize, normalized } = attributes[n];
    geometry.setAttribute(n, new THREE.BufferAttribute(new array.constructor(out[n]), itemSize, normalized));
  }
  const normal = geometry.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, ...v.fromBufferAttribute(normal, i).normalize().toArray());
  mesh.geometry.dispose();
  mesh.geometry = mergeVertices(geometry);
  source.dispose();
}

// One morph target per spot: the can's surface pushed in round it, with a star of creases, and the normals bent
// along (the difference of recomputed normals, so seams stay as they were).
function addHollows(mesh) {
  const geometry = mesh.geometry, position = geometry.attributes.position, count = position.count;
  const plain = geometry.clone();
  plain.computeVertexNormals();
  const p = new THREE.Vector3();
  geometry.morphAttributes.position = [];
  geometry.morphAttributes.normal = [];
  SPOTS.forEach(([angle, y], k) => {
    const delta = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(position, i);
      const r = Math.hypot(p.x, p.z);
      if (r < 1e-4) continue;
      const turn = Math.atan2(Math.sin(Math.atan2(p.x, p.z) - angle), Math.cos(Math.atan2(p.x, p.z) - angle));
      const arc = turn * CAN_RADIUS, dy = p.y - y, t = Math.hypot(arc, dy) / SIZE;
      if (t >= 1) continue;
      const creases = 0.6 + 0.4 * Math.cos(5 * Math.atan2(dy, arc) + k);
      const push = DEPTH * (1 - t * t) ** 2 * creases;
      delta[i * 3] = -p.x / r * push;
      delta[i * 3 + 2] = -p.z / r * push;
      if (y > 1.45) delta[i * 3 + 1] = -0.6 * push;      // a rim dent also squashes the rim down
    }
    const dented = plain.clone();
    const moved = dented.attributes.position;
    for (let i = 0; i < count; i++) moved.setXYZ(i, moved.getX(i) + delta[i * 3], moved.getY(i) + delta[i * 3 + 1], moved.getZ(i) + delta[i * 3 + 2]);
    dented.computeVertexNormals();
    const bend = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) bend[i] = dented.attributes.normal.array[i] - plain.attributes.normal.array[i];
    geometry.morphAttributes.position.push(new THREE.Float32BufferAttribute(delta, 3));
    geometry.morphAttributes.normal.push(new THREE.Float32BufferAttribute(bend, 3));
    dented.dispose();
  });
  plain.dispose();
  geometry.morphTargetsRelative = true;
  mesh.updateMorphTargets();
}
