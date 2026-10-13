// The ring: a rock with a sinkhole down its middle, its top glazed with meltwater that froze sloping into the hole.
// Two rock pads on the rim are where the way comes on and goes off; between them, either way round, it's ice
// (ice.js's iceArc), so there's no going straight across: steer round the hole all the way, or slide into it or off
// the outside. The collision is convex Solids at one height: one per pad (straight lips, so a ledge or a plank can
// meet it) and one per STEP degrees of ice, meeting on radial seams, so nothing catches. The look is one rock mesh
// with the hole cut out, painted like rockmesh.js's (materials.js reads aDrop), icicles round the hole and mist that
// slowly turns in it. world.rings keeps { x, z, inner, outer, y, pads: [{ range, solid }], solids } for the bots.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Solid, random } from './world.js';
import { rock as rockMaterial } from '../look/materials.js';
import { iceArc } from './ice.js';
import { toon, noOutline } from '../look/look.js';

const STEP = 15;             // degrees of ice per Solid
const LIP = 3;               // degrees between the mesh's vertices round the lips; the pads start and end on these
const LEVELS = [0, 0.1, 0.32, 0.75, 1.4, 2.4, 3.8, 6, 9, 14, 21, 32, 48, 70];   // the sides' rings, as rockmesh.js
const SHAFT = 32;            // how far down the hole's wall goes; the haze and the clouds hide the rest
const MIST = [[0.9, 0.3, 0.05], [2.4, 0.5, -0.04], [5, 0.75, 0.03], [9, 0.97, -0.02]];   // depth, opacity, turn rate

// center: [x, z]; the hole's radius (inner) and the rock's (outer); its top at y; pads: [[from, to], [from, to]],
// the rock bits, in degrees (0 = +X, 90 = +Z, going up from the first pad, on multiples of LIP from its start);
// drift: how hard the ice pulls into the hole, m/s².
export function ringRock(world, { center, inner, outer, y, pads, drift = 0.5, seed = 5 }) {
  const [cx, cz] = center, rad = THREE.MathUtils.degToRad;
  const padAt = deg => pads.find(([a, b]) => ((deg - a) % 360 + 360) % 360 <= b - a + 1e-6);
  // the lips' distance from the middle: round, but straight across a pad (a chord between its ends)
  const lip = (r, deg) => {
    const pad = padAt(deg);
    return pad ? r * Math.cos(rad((pad[1] - pad[0]) / 2)) / Math.cos(rad(deg - (pad[0] + pad[1]) / 2)) : r;
  };
  const point = (r, deg, out = 0) => {
    const d = lip(r, deg) + out;
    return { x: cx + d * Math.cos(rad(deg)), z: cz + d * Math.sin(rad(deg)) };
  };
  const solids = [], solid = (poly) => {
    const s = new Solid(poly, y, y - LEVELS.at(-1));
    world.solids.push(s);
    solids.push(s);
    return s;
  };
  const rocks = pads.map(([a, b]) => solid([point(outer, a), point(outer, b), point(inner, b), point(inner, a)]));
  const ice = [[pads[0][1], pads[1][0]], [pads[1][1], pads[0][0] + 360]];
  for (const [a, b] of ice) {
    const n = Math.ceil((b - a) / STEP - 1e-6);
    for (let k = 0; k < n; k++) {
      const a0 = a + (b - a) * k / n, a1 = a + (b - a) * (k + 1) / n;
      solid([point(outer, a0), point(outer, (a0 + a1) / 2), point(outer, a1), point(inner, a1), point(inner, a0)]);
    }
    iceArc(world, { center, inner, outer, from: a, to: b, y, drift, step: STEP });
  }
  const rand = random(seed), angles = Array.from({ length: 360 / LIP }, (_, k) => pads[0][0] + k * LIP);
  const mesh = ringMesh(angles, point, inner, outer, y, rand);
  world.group.add(mesh, icicles(angles.filter(deg => !padAt(deg)), point, inner, y, rand));
  world.blockers.push(mesh);
  mist(world, cx, cz, y, inner);
  world.rings.push({ x: cx, z: cz, inner, outer, y, solids,
    pads: pads.map((range, i) => ({ range, solid: rocks[i] })) });
}

// One closed surface: the outside, bulging and widening towards the mountain's foot as rockmesh.js's rocks do; the
// hole's wall, narrowing a little as it goes down; and the top between the lips, rising a few centimetres in a pillow
// of snow. aDrop: metres below the top on the sides, negative going in over the top.
function ringMesh(angles, point, inner, outer, y, rand) {
  const N = angles.length, positions = [], drops = [], index = [];
  const add = ({ x, z }, top, drop) => { positions.push(x, top, z); drops.push(drop); return drops.length - 1; };
  const wall = (r, levels, out) => levels.map((dy, level) => angles.map((deg) => {
    const w = rand(), off = level === 0 ? 0 : level === 1 ? -0.05 : out(w, dy);
    return add(point(r, deg, r === inner ? -off : off), y - dy, dy);
  }));
  const outside = wall(outer, LEVELS, (w, dy) => -0.14 + 0.24 * w + Math.max(0, dy - 3) * 0.025);
  const hole = wall(inner, LEVELS.filter(dy => dy <= SHAFT), (w, dy) => -0.1 + 0.16 * w + Math.max(0, dy - 3) * 0.012);
  const strip = (upper, lower, flip) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, [a, b, c, d] = [upper[i], upper[j], lower[i], lower[j]];
      index.push(...(flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  };
  for (let l = 0; l < outside.length - 1; l++) strip(outside[l], outside[l + 1], false);
  for (let l = 0; l < hole.length - 1; l++) strip(hole[l], hole[l + 1], true);
  // the top: from the outer lip in, up over the middle and down to the hole's lip
  const width = outer - inner, across = (t, rise, drop) => angles.map((deg) => {
    const p = point(outer, deg), q = point(inner, deg);
    return add({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }, y + rise, drop);
  });
  const k = 0.16 / width;
  const rings = [outside[0], across(k, 0.025, -0.16), across(0.5, 0.035, -width / 2), across(1 - k, 0.025, -0.16),
    hole[0]];
  for (let r = 0; r < rings.length - 1; r++) {
    const p = rings[r], q = rings[r + 1];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      index.push(p[i], q[i], p[j], p[j], q[i], q[j]);
    }
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

// Icicles under the hole's lip, in little clusters, where the meltwater ran over.
function icicles(angles, point, inner, y, rand) {
  const parts = [];
  for (let c = 0; c < 7; c++) {
    const at = angles[Math.floor(rand() * angles.length)];
    for (let i = 0, n = 2 + Math.floor(rand() * 3); i < n; i++) {
      const deg = at + (rand() - 0.5) * 5, h = 0.12 + 0.3 * rand() * rand(), p = point(inner, deg, -0.03);
      const cone = new THREE.ConeGeometry(0.035 + 0.035 * rand(), h, 6).rotateX(Math.PI);
      parts.push(cone.translate(p.x, y - 0.015 - h / 2, p.z));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), toon('#bfe6f7'));
  mesh.castShadow = true;
  return mesh;
}

// Mist in the hole: a few layers, thicker further down, each turning slowly, so the bottom is never seen.
function mist(world, cx, cz, y, inner) {
  const map = mistTexture();
  for (const [depth, opacity, turn] of MIST) {
    const material = new THREE.MeshBasicMaterial({ map, color: '#eef5fb', transparent: true, opacity,
      depthWrite: false });
    const layer = new THREE.Mesh(new THREE.CircleGeometry(inner + 0.15, 40).rotateX(-Math.PI / 2), noOutline(material));
    layer.position.set(cx, y - depth, cz);
    layer.rotation.y = depth;
    world.group.add(layer);
    world.animated.push({ update(dt) { layer.rotation.y += turn * dt; } });
  }
}

// Soft puffs of white, for the mist.
function mistTexture() {
  const size = 256, canvas = document.createElement('canvas'), rand = random(77);
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = size * rand(), z = size * rand(), r = size * (0.06 + 0.14 * rand());
    const glow = ctx.createRadialGradient(x, z, 0, x, z, r);
    glow.addColorStop(0, `rgba(255,255,255,${0.25 + 0.35 * rand()})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, z - r, 2 * r, 2 * r);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
