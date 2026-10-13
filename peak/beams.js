// The wooden things Mnot walks on: board walks with rope rails, planks, and the tightrope with its stakes.
// world.js keeps their solids and beams; this file only makes them look right.
import * as THREE from 'three';
import { toon } from './look.js';

const WOOD = '#b07a4a', ROPE = '#d9c08a';

// The planks of a board walk from a to b, and rope rails on posts either side.
export function boardMesh(a, b, width, rand) {
  const group = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
  const hw = width / 2;
  const length = a.distanceTo(b), count = Math.round(length / 0.26);
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 0.07, 0.22), toon(WOOD), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  for (let i = 0; i < count; i++) {
    const p = a.clone().lerp(b, (i + 0.5) / count);
    p.y -= 0.035 + 0.01 * rand();
    const tilt = new THREE.Quaternion().setFromAxisAngle(dir, (rand() - 0.5) * 0.06);
    m.compose(p, tilt.multiply(q), new THREE.Vector3(1 - 0.1 * rand(), 1, 1));
    planks.setMatrixAt(i, m);
  }
  planks.castShadow = planks.receiveShadow = true;
  group.add(planks);
  for (const side of [-1, 1]) {
    const posts = [], n = Math.max(1, Math.round(length / 1.6));
    for (let i = 0; i <= n; i++) posts.push(a.clone().lerp(b, i / n).addScaledVector(right, side * (hw + 0.02)));
    for (const p of posts) group.add(post(p, 0.62, 0.035));
    const rail = [];
    for (let i = 0; i < posts.length - 1; i++) {
      for (let k = 0; k < 8; k++) {
        const t = k / 8, q = posts[i].clone().lerp(posts[i + 1], t);
        q.y += 0.58 - 0.08 * Math.sin(Math.PI * t);
        rail.push(q);
      }
    }
    rail.push(posts.at(-1).clone().setY(posts.at(-1).y + 0.58));
    group.add(tube(rail, 0.018));
  }
  return group;
}

// A plank along a beam.
export function plankMesh(beam) {
  const { a, b, width } = beam;
  const along = new THREE.Vector3().subVectors(b, a), length = along.length();
  along.normalize();
  const up = new THREE.Vector3().crossVectors(beam.right, along).normalize();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, length + 0.3), toon(WOOD));
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beam.right, up, along));
  mesh.position.copy(a).lerp(b, 0.5).addScaledVector(up, -0.035);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// The tightrope and its two stakes. update() moves the rope with the beam's sag, dip and sway, every frame.
export function ropeMesh(beam) {
  const { a, b } = beam;
  const group = new THREE.Group();
  for (const end of [a, b]) {
    const outward = end === a ? -1 : 1;
    group.add(post(end.clone().addScaledVector(beam.dir, 0.12 * outward), 0.35, 0.05));
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
  group.add(mesh);
  const point = new THREE.Vector3(), side = beam.right;
  const update = () => {
    for (let i = 0; i <= segments; i++) {
      const s = -0.03 + 1.06 * i / segments;
      beam.pointAt(s, point);
      point.y -= r;     // the walking surface is the rope's top
      for (let j = 0; j < radial; j++) {
        const angle = 2 * Math.PI * j / radial;
        const k = (i * radial + j) * 3;
        positions[k] = point.x + side.x * Math.cos(angle) * r;
        positions[k + 1] = point.y + Math.sin(angle) * r;
        positions[k + 2] = point.z + side.z * Math.cos(angle) * r;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  return { mesh: group, update };
}

export function post(foot, height, radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, height, 7), toon('#8a5a34'));
  mesh.position.copy(foot).setY(foot.y + height / 2 - 0.05);
  mesh.castShadow = true;
  return mesh;
}

export function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, radius, 5), toon(ROPE));
  mesh.castShadow = true;
  return mesh;
}
