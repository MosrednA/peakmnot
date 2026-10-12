// What lies around the climb: the sky, a sea of clouds far below and snowy peaks in the distance. None of it
// collides; it's there to say "very high up".
import * as THREE from 'three';
import { toon } from './look.js';
import { random } from './world.js';

export const HORIZON = new THREE.Color('#d6e8f6');
export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();   // towards the sun
const CLOUD_Y = -28;

export function buildScenery(scene, center) {
  const sky = skyDome();
  scene.add(sky);
  scene.add(cloudSea(center));
  scene.add(peaks(center));
  return {
    update(camera) { sky.position.copy(camera.position); },
  };
}

function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#3f86d8') }, horizon: { value: HORIZON },
      below: { value: new THREE.Color('#eef5fb') }, sun: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;   // always behind everything
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith, horizon, below, sun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 1.0, d.y), 0.55));
        c = mix(c, below, smoothstep(0.0, -0.25, d.y));
        float s = max(dot(d, sun), 0.0);
        c += vec3(1.0, 0.95, 0.8) * (step(0.9993, s) * 0.6 + pow(s, 60.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// Puffy clouds as one instanced mesh, on a flat floor of cloud that fades into the haze.
function cloudSea(center) {
  const group = new THREE.Group();
  const rand = random(31);
  const count = 520;
  const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), toon('#ffffff', { outline: false }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const r = 12 + 420 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
    const size = 7 + 16 * rand() * (0.5 + r / 420);
    p.set(center.x + Math.cos(a) * r, CLOUD_Y + (rand() - 0.6) * 4, center.z + Math.sin(a) * r);
    s.set(size * (1 + rand()), size * (0.35 + 0.25 * rand()), size * (1 + rand()));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    puffs.setMatrixAt(i, m.compose(p, q, s));
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), toon('#e8f0f8', { outline: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, CLOUD_Y - 1.5, center.z);
  floor.receiveShadow = false;
  group.add(puffs, floor);
  return group;
}

// Distant peaks around the route: faceted cones with snow above a line, blue in the haze.
function peaks(center) {
  const group = new THREE.Group();
  const rand = random(77);
  const snow = new THREE.Color('#f6f9fd'), rock = new THREE.Color('#7f8fae'), dark = new THREE.Color('#6a7898');
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + rand() * 0.2, r = 150 + 260 * rand();
    const height = 60 + 110 * rand() * (0.4 + r / 410), radius = height * (0.55 + 0.35 * rand());
    const geometry = new THREE.ConeGeometry(radius, height, 7 + Math.floor(rand() * 4), 5, true).toNonIndexed();
    const pos = geometry.attributes.position;
    // crumple the cone, keeping the tip a little off-centre
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k), t = (y + height / 2) / height;
      const key = Math.round(pos.getX(k) * 10) * 7 + Math.round(y * 10) * 13 + Math.round(pos.getZ(k) * 10) * 3;
      const n = random(key + i * 1000)();
      pos.setX(k, pos.getX(k) * (0.8 + 0.4 * n) + radius * 0.12 * t);
      pos.setZ(k, pos.getZ(k) * (0.8 + 0.4 * n));
      pos.setY(k, y + (n - 0.5) * height * 0.06 * (1 - t));
    }
    const colors = [], line = 0.45 + 0.2 * rand();
    for (let k = 0; k < pos.count; k += 3) {
      const t = (pos.getY(k) + pos.getY(k + 1) + pos.getY(k + 2)) / 3 / height + 0.5;
      const c = t > line + 0.05 * Math.sin(k) ? snow : (k / 3) % 3 === 0 ? dark : rock;
      for (let j = 0; j < 3; j++) colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, toon('#ffffff', { vertexColors: true, outline: false }));
    mesh.position.set(center.x + Math.cos(a) * r, CLOUD_Y - 20 + height / 2, center.z + Math.sin(a) * r);
    mesh.rotation.y = rand() * Math.PI;
    group.add(mesh);
  }
  return group;
}
