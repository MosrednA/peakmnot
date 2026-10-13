// Loose ledges: a chunk of rock with ink cracks on top, hanging in the air on a pointed underside, so it looks loose
// before anyone stands on it. Landing on it kicks up its snow and starts it shaking: the cracks spread, crumbs of
// snow and grit trickle off the lip, and after DELAY seconds it drops away in a spray of snow and broken bits
// (player.js still allows a jump for a moment after). GONE seconds later it pops back. world.emit: 'crack' when it
// starts to shake, 'crumble' when it drops, 'regrow' when it is back.
import * as THREE from 'three';
import { rock as rockMaterial } from './materials.js';
import { noOutline } from './look.js';
import { bursts } from './bursts.js';

const DELAY = 0.85;           // seconds from the first touch to the drop
const GONE = 3.2;             // seconds from the drop until it is back
const SHAKE = 0.04;           // metres, at the end of the shaking

const CRACK_MATERIAL = noOutline(new THREE.MeshBasicMaterial({ color: '#2a2e45', side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -3 }));

// A loose ledge from its extents, like route.js's rock(): x0..x1 by z0..z1, its top at y.
export function looseLedge(world, x0, x1, z0, z1, y, { delay = DELAY, gone = GONE, chamfer = 0.22, seed } = {}) {
  const { solid, rand } = world.outline({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y,
    chamfer, seed, depth: 1.3 });
  solid.loose = true;
  world.solids.push(solid);
  const group = new THREE.Group(), body = new THREE.Group();
  const cracks = crackMesh(solid, rand);
  body.add(chunkMesh(solid, rand), cracks.mesh);
  group.add(body);
  world.group.add(group);
  const at = new THREE.Vector3(solid.center.x, y, solid.center.y);
  const spray = bursts(world), lip = new THREE.Vector3(), out = new THREE.Vector3();
  let state = 'still', t = 0, vy = 0;

  // a spot on the lip, and the way out over it
  const edgeSpot = (inset = 0) => {
    const e = solid.edges[Math.floor(rand() * solid.edges.length)], k = 0.1 + 0.8 * rand();
    out.set(e.nx, 0, e.nz);
    return lip.set(e.ax + (e.bx - e.ax) * k - e.nx * inset, y + 0.02, e.az + (e.bz - e.az) * k - e.nz * inset);
  };

  solid.touch = (player) => {
    if (state !== 'still') return;
    state = 'shaking';
    t = 0;
    spray.snow(player?.pos ?? at, { puffs: 6, flakes: 9 });
    world.emit('crack', { at, solid });
  };

  const ledge = {
    solid,
    get state() { return state; },
    update(dt) {
      t += dt;
      if (state === 'still') cracks.show(0.5);
      else if (state === 'shaking') {
        const k = Math.min(1, t / delay);
        cracks.show(0.5 + 0.5 * k);
        body.position.set((rand() - 0.5) * 2 * SHAKE * k, 0, (rand() - 0.5) * 2 * SHAKE * k);
        if (rand() < dt * (6 + 18 * k)) spray.crumbs(edgeSpot(), out, { count: 1 + Math.round(k) });
        if (t >= delay) {
          state = 'falling';
          t = vy = 0;
          solid.off = true;
          // it goes: snow bursts off the lip all round, and broken bits drop with it
          for (let i = 0; i < 4; i++) spray.snow(edgeSpot(0.15), { puffs: 3, flakes: 3, up: 0.6, grit: 0.5 });
          spray.chips(at, { count: 7, size: 2.4, speed: 0.8, fall: true, up: 0.15, spread: 0.5 });
          world.emit('crumble', { at, solid });
        }
      } else if (state === 'falling') {
        vy -= 15 * dt;
        body.position.y += vy * dt;
        body.rotation.x += dt * 0.5;
        body.rotation.z -= dt * 0.35;
        if (t > 1.3) { state = 'gone'; group.visible = false; }
      } else if (state === 'gone' && t >= gone) {
        state = 'back';
        t = 0;
        solid.off = false;
        body.position.set(0, 0, 0);
        body.rotation.set(0, 0, 0);
        group.visible = true;
        world.emit('regrow', { at, solid });
      } else if (state === 'back') {
        // pops back in with a little overshoot
        const k = Math.min(1, t / 0.35), s = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
        group.scale.set(s, k < 1 ? s : 1, s);
        group.position.set(at.x * (1 - s), at.y * (1 - s), at.z * (1 - s));
        if (k >= 1) { state = 'still'; group.scale.setScalar(1); group.position.set(0, 0, 0); }
      }
    },
  };
  world.animated.push(ledge);
  return ledge;
}

// The chunk: the lip is the collision outline, the sides bulge a little and then taper to a point underneath. The
// top is the same soft pillow of snow as the pillars (rockmesh.js), and aDrop lets the rock material paint it.
function chunkMesh(solid, rand) {
  const ring = [];
  for (const e of solid.edges) {
    const n = Math.max(1, Math.round(e.len / 0.4));
    for (let k = 0; k < n; k++) ring.push({ x: e.ax + (e.bx - e.ax) * k / n, z: e.az + (e.bz - e.az) * k / n });
  }
  const N = ring.length, { x: cx, y: cz } = solid.center;
  const levels = [[0, 1], [0.08, 0.96], [0.3, 1.05], [0.62, 0.97], [0.95, 0.78], [1.3, 0.5], [1.6, 0.24]];
  const positions = [], drops = [], index = [];
  const add = (x, y, z, drop) => { positions.push(x, y, z); drops.push(drop); return drops.length - 1; };
  levels.forEach(([dy, scale], level) => {
    for (const p of ring) {
      const s = level < 2 ? scale : scale * (0.9 + 0.2 * rand());
      add(cx + (p.x - cx) * s, solid.top - dy, cz + (p.z - cz) * s, dy);
    }
  });
  for (let l = 0; l < levels.length - 1; l++) {
    for (let i = 0; i < N; i++) {
      const a = l * N + i, b = l * N + (i + 1) % N;
      index.push(a, b, a + N, b, b + N, a + N);
    }
  }
  const tip = add(cx + (rand() - 0.5) * 0.2, solid.top - 2.0, cz + (rand() - 0.5) * 0.2, 2.0);
  const last = (levels.length - 1) * N;
  for (let i = 0; i < N; i++) index.push(last + i, last + (i + 1) % N, tip);
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

// Ink cracks on the top, zigzagging out from near the middle. show(k) draws the first k of each, so they spread.
function crackMesh(solid, rand) {
  const { x: cx, y: cz } = solid.center, y = solid.top + 0.05;
  const paths = [];
  const count = 3 + Math.floor(rand() * 2);
  for (let c = 0; c < count; c++) {
    const e = solid.edges[Math.floor(rand() * solid.edges.length)], k = 0.2 + 0.6 * rand();
    const end = { x: e.ax + (e.bx - e.ax) * k - e.nx * 0.12, z: e.az + (e.bz - e.az) * k - e.nz * 0.12 };
    const start = { x: cx + (rand() - 0.5) * 0.3, z: cz + (rand() - 0.5) * 0.3 };
    const points = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5, jag = i === 0 || i === 5 ? 0 : (rand() - 0.5) * 0.16;
      const dx = end.x - start.x, dz = end.z - start.z, len = Math.hypot(dx, dz);
      points.push({ x: start.x + dx * f - dz / len * jag, z: start.z + dz * f + dx / len * jag });
    }
    paths.push(points);
  }
  // segment i of every crack before segment i + 1 of any, so a draw range grows them all outwards together
  const positions = [], index = [];
  for (let i = 0; i < 5; i++) {
    for (const points of paths) {
      const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      const w = 0.03 * (1 - i / 8), nx = -(b.z - a.z) / len * w, nz = (b.x - a.x) / len * w;
      const base = positions.length / 3;
      positions.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx * 0.7, y, b.z + nz * 0.7,
        b.x - nx * 0.7, y, b.z - nz * 0.7);
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, CRACK_MATERIAL);
  const total = index.length / 6;
  return { mesh, show: k => geometry.setDrawRange(0, 6 * Math.ceil(total * k)) };
}
