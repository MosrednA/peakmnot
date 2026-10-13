// The rock pillars' meshes; materials.js paints them.
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import { rock as rockMaterial } from './materials.js';

// One closed surface: a ring at each depth, the sides bulging and widening towards the mountain's foot, and a top
// that rises a few centimetres in a soft pillow of snow. The lip is exactly the collision outline. The material
// (materials.js) paints the facets, the snow and the lip's ink line from aDrop; the shared vertices give smooth
// normals, so the outline drawn round the rock has no cracks.
export function rockMesh(solid, rand) {
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
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDrop', new Float32BufferAttribute(drops, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, rockMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
