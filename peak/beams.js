// The wooden things Mnot walks on: board walks with rope rails, planks, and the tightrope with its anchors.
// world.js keeps their solids and beams; this file only makes them look right. fitBeams (called from decor.js once
// the route is built) fits their ends to the ledges: boards and planks stop at the lip instead of poking through the
// snow, planks are lashed to stakes either side, and the rope runs over the snow to a two-stake anchor.
import * as THREE from 'three';
import { wood, rope } from './wood.js';

const WOOD = '#b07a4a', POST = '#8a5a34';

// The planks of a board walk from a to b on two stringers, and rope rails on posts either side.
export function boardMesh(a, b, width, rand) {
  const group = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
  const hw = width / 2, length = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const jitter = Array.from({ length: 64 }, () => [rand(), rand(), rand()]);
  // the boards: laid between from and to (metres from a), so they can be fitted to the lips later
  const lay = (from, to) => {
    group.children.filter(c => c.userData.boards).forEach(c => group.remove(c));
    const count = Math.max(1, Math.round((to - from) / 0.26)), step = (to - from) / count;
    const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.06, step - 0.035), wood(WOOD, 'x'), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const [r1, r2, r3] = jitter[i % jitter.length];
      const p = a.clone().lerp(b, (from + (i + 0.5) * step) / length);
      p.y -= 0.03 + 0.008 * r1;
      const tilt = new THREE.Quaternion().setFromAxisAngle(dir, (r2 - 0.5) * 0.04);
      p.addScaledVector(right, (r3 - 0.5) * 0.03);
      m.compose(p, tilt.multiply(q), new THREE.Vector3(1 - 0.08 * r3, 1, 1));
      boards.setMatrixAt(i, m);
    }
    boards.castShadow = boards.receiveShadow = true;
    boards.userData.boards = true;
    group.add(boards);
  };
  lay(0, length);
  // two stringers under the boards, set into the rock at both ends
  for (const side of [-1, 1]) {
    const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, length + 0.3), wood(POST, 'z'));
    stringer.quaternion.copy(q);
    stringer.position.copy(a).lerp(b, 0.5).addScaledVector(right, side * (hw - 0.1)).setY((a.y + b.y) / 2 - 0.1);
    stringer.castShadow = true;
    group.add(stringer);
  }
  const railGroup = new THREE.Group();
  railGroup.userData.fade = true;
  for (const side of [-1, 1]) {
    const posts = [], n = Math.max(1, Math.round(length / 1.6));
    for (let i = 0; i <= n; i++) posts.push(a.clone().lerp(b, i / n).addScaledVector(right, side * (hw + 0.02)));
    for (const p of posts) railGroup.add(post(p, 0.62, 0.035));
    const rail = [];
    for (let i = 0; i < posts.length - 1; i++) {
      for (let k = 0; k < 8; k++) {
        const t = k / 8, r = posts[i].clone().lerp(posts[i + 1], t);
        r.y += 0.58 - 0.08 * Math.sin(Math.PI * t);
        rail.push(r);
      }
    }
    rail.push(posts.at(-1).clone().setY(posts.at(-1).y + 0.58));
    railGroup.add(tube(rail, 0.018));
  }
  group.add(railGroup);
  // boards only over the gap: from the first rock's lip to the next one's
  group.userData.fit = (world) => {
    const from = lipFrom(world, a, dir), to = length - lipFrom(world, b, dir.clone().negate());
    if (from > 0 || to < length) lay(from + 0.01, to - 0.01);
  };
  return group;
}

// How far from end, going along dir, the rock under end stops (0 if end isn't on a rock).
function lipFrom(world, end, dir) {
  const solid = world.ground(end.x, end.z, end.y + 0.12, 0);
  if (!solid || solid.top < end.y - 0.12 || solid.closest(end.x, end.z).d > 0) return 0;
  for (let t = 0; t < 1.2; t += 0.005) {
    if (solid.closest(end.x + dir.x * t, end.z + dir.z * t).d > 0) return t;
  }
  return 0;
}

// The snow's height on a rock a little way in from its lip (the rock mesh rises in a soft pillow, see rockmesh.js).
function snowAt(world, x, z, y) {
  const solid = world.ground(x, z, y + 0.15, 0);
  if (!solid) return null;
  const inside = -solid.closest(x, z).d;
  return inside < 0 ? null : solid.top + Math.min(0.025, inside * 0.16);
}

// What a rope lies on: the snow on a rock, or just past its lip the edge it bends over.
function floorAt(world, x, z, y) {
  const snow = snowAt(world, x, z, y);
  if (snow !== null) return snow;
  const solid = world.ground(x, z, y + 0.15, 0.3);
  return solid ? solid.top - 1.2 * solid.closest(x, z).d : -Infinity;
}

// A plank along a beam. fitBeams trims it to the lips and pins it down.
export function plankMesh(beam) {
  const group = new THREE.Group();
  const build = (from, to) => {
    group.clear();
    const { a, b, width } = beam;
    const along = new THREE.Vector3().subVectors(b, a), length = along.length();
    along.normalize();
    const up = new THREE.Vector3().crossVectors(beam.right, along).normalize();
    const start = a.clone().addScaledVector(along, from), end = a.clone().addScaledVector(along, length - to);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, start.distanceTo(end)), wood(WOOD, 'z'));
    plank.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beam.right, up, along));
    plank.position.copy(start).lerp(end, 0.5).addScaledVector(up, -0.035);
    plank.castShadow = plank.receiveShadow = true;
    group.add(plank);
    return { along, up, start, end };
  };
  build(-0.15, -0.15);
  group.userData.fit = (world) => {
    const flat = beam.dir, from = lipFrom(world, beam.a, flat), to = lipFrom(world, beam.b, flat.clone().negate());
    const slope = Math.hypot(beam.length, beam.b.y - beam.a.y) / beam.length;
    const { along, up, start, end } = build(from ? from * slope - 0.01 : -0.15, to ? to * slope - 0.01 : -0.15);
    // at each end over a rock: a rope wound round the plank, lashed to a stake on either side of the path
    [[start, from, -1], [end, to, 1]].forEach(([p, lip, out]) => {
      if (!lip) return;
      const wrapAt = p.clone().addScaledVector(along, -out * 0.12);
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 5, 16), rope(0.7));
      wrap.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beam.right, up, along));
      wrap.scale.set(beam.width / 0.2 + 0.08, 0.5, 1);
      wrap.position.copy(wrapAt).addScaledVector(up, -0.035);
      group.add(wrap);
      for (const side of [-1, 1]) {
        const stakeAt = p.clone().addScaledVector(flat, out * 0.32).addScaledVector(beam.right, side * 0.44);
        stakeAt.y = snowAt(world, stakeAt.x, stakeAt.z, p.y) ?? p.y;
        const s = stake(stakeAt, flat.clone().multiplyScalar(out).addScaledVector(beam.right, side * 0.7), 0.24);
        group.add(s.mesh);
        const from3 = wrapAt.clone().addScaledVector(beam.right, side * (beam.width / 2 + 0.01)).addScaledVector(up, -0.02);
        const mid = from3.clone().lerp(s.top, 0.5);
        mid.y = Math.max(from3.y, s.top.y) + 0.01;
        group.add(tube([from3, mid, s.top], 0.009));
      }
    });
  };
  return group;
}

// A wooden stake hammered into the snow, leaning away from what pulls on it, with a rope wound round its head.
function stake(foot, lean, height = 0.3, radius = 0.032) {
  const away = lean.clone().setY(0).normalize();
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-away.z, 0, away.x).normalize(), -0.28);
  const mesh = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height + 0.08, 7), wood(POST, 'y'));
  shaft.position.y = height / 2 - 0.04;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, 0.03, 7), wood('#6e4a2c', 'y'));
  head.position.y = height;
  const wound = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.05, 0.011, 5, 10), rope(0.25));
  wound.rotation.x = Math.PI / 2;
  wound.position.y = height * 0.72;
  shaft.castShadow = true;
  mesh.add(shaft, head, wound);
  mesh.position.copy(foot);
  mesh.quaternion.copy(tilt);
  const top = new THREE.Vector3(0, height * 0.72, 0).applyQuaternion(tilt).add(foot);
  return { mesh, top };
}

// The tightrope. update() moves it with the beam's sag, dip and sway, every frame; past its ends it lies on the
// snow to a knot, and from there two shorter ropes run to stakes (added by fitBeams, once both ledges exist).
export function ropeMesh(beam) {
  const { a, b } = beam;
  const group = new THREE.Group();
  const tail = 0.4 / beam.length, s0 = -tail, s1 = 1 + tail;
  const segments = 64, radial = 7, r = 0.03;
  const floor = new Float32Array(segments + 1).fill(-Infinity);       // the snow under the rope, past the lips
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 1) * (radial + 1) * 3), uvs = [];
  const index = [];
  for (let i = 0; i <= segments; i++) for (let j = 0; j <= radial; j++) uvs.push(i / segments, j / radial);
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const p = i * (radial + 1) + j, q = p + 1;
      index.push(p, p + radial + 1, q, q, p + radial + 1, q + radial + 1);
    }
  }
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, rope(beam.length * (s1 - s0), '#d9c08a'));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  const point = new THREE.Vector3(), side = beam.right;
  const centre = (s, target) => {
    const t = THREE.MathUtils.clamp(s, 0, 1);
    target.set(a.x + (b.x - a.x) * s, beam.heightAt(t), a.z + (b.z - a.z) * s).addScaledVector(side, beam.swayAt(t));
    return target;
  };
  const update = () => {
    for (let i = 0; i <= segments; i++) {
      const s = s0 + (s1 - s0) * i / segments;
      centre(s, point);
      point.y = Math.max(point.y - r, floor[i] + r * 0.8);     // the walking surface is the rope's top
      for (let j = 0; j <= radial; j++) {
        const angle = 2 * Math.PI * j / radial;
        const k = (i * (radial + 1) + j) * 3;
        positions[k] = point.x + side.x * Math.cos(angle) * r;
        positions[k + 1] = point.y + Math.sin(angle) * r;
        positions[k + 2] = point.z + side.z * Math.cos(angle) * r;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  group.userData.fit = (world) => {
    for (let i = 0; i <= segments; i++) {
      const s = s0 + (s1 - s0) * i / segments;
      centre(s, point);
      floor[i] = floorAt(world, point.x, point.z, Math.max(a.y, b.y));
    }
    update();
    for (const [end, out] of [[a, -1], [b, 1]]) {
      const knot = end.clone().addScaledVector(beam.dir, out * 0.4);
      knot.y = (snowAt(world, knot.x, knot.z, end.y) ?? end.y) + r * 0.8;
      const lump = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 8, 6), rope(0.2));
      lump.scale.set(1, 0.8, 1.3);
      lump.position.copy(knot);
      group.add(lump);
      for (const k of [-1, 1]) {
        const at = end.clone().addScaledVector(beam.dir, out * 0.75).addScaledVector(side, k * 0.36);
        at.y = snowAt(world, at.x, at.z, end.y) ?? end.y;
        const s = stake(at, beam.dir.clone().multiplyScalar(out).addScaledVector(side, k * 0.8), 0.3, 0.038);
        group.add(s.mesh);
        const mid = knot.clone().lerp(s.top, 0.5);
        mid.y = Math.max(knot.y, s.top.y - 0.05);
        group.add(tube([knot, mid, s.top], 0.014));
      }
    }
  };
  return { mesh: group, update };
}

export function post(foot, height, radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, height, 7), wood(POST, 'y'));
  mesh.position.copy(foot).setY(foot.y + height / 2 - 0.05);
  mesh.castShadow = true;
  return mesh;
}

// A rope through points, with the twist running along it.
export function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(4, points.length * 2), radius, 5),
    rope(curve.getLength() * 0.03 / radius));
  mesh.castShadow = true;
  return mesh;
}

// Fit every board walk, plank and rope in the world to the ledges they rest on.
export function fitBeams(world) {
  const fits = [];
  world.group.traverse((o) => { if (o.userData.fit) fits.push(o); });
  for (const o of fits) {
    o.userData.fit(world);
    delete o.userData.fit;
  }
}
