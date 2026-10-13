// The sea of clouds far below the route, and a few big clouds far out. The puffs are one instanced mesh with a toon
// shader of their own: white where the sun hits, cool blue in the shade and underneath, a silver lining towards the
// sun, a slow boil, and they melt into the sky's haze far away. Under them lies a floor of cloud tops, painted in the
// same three tones. The sea turns slowly, so it drifts.
import * as THREE from 'three';
import { random } from './world.js';
import { SKY, SKY_UNIFORMS } from './sky.js';

export const CLOUD_Y = -28;

const TONES = {
  uLit: { value: new THREE.Color('#ffffff') },
  uMid: { value: new THREE.Color('#e1eaf7') },
  uShade: { value: new THREE.Color('#b3c3e6') },
  uDeep: { value: new THREE.Color('#8ea3d2') },
  uRim: { value: new THREE.Color('#fff1da') },
};

const TONE_GLSL = /* glsl */`
  uniform vec3 uLit, uMid, uShade, uDeep, uRim;
  // three toon tones with soft edges, from how much a surface faces the sun
  vec3 cloudTone(float light) {
    vec3 c = mix(uShade, uMid, smoothstep(-0.3, -0.18, light));
    return mix(c, uLit, smoothstep(0.18, 0.3, light));
  }`;

export function buildClouds(center) {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  const puffs = cloudPuffs();
  group.add(puffs, cloudFloor());
  return {
    group,
    update(time) { puffs.rotation.y = time * 0.0016; },
  };
}

// Clusters of puffs: a big one in the middle and a few smaller ones leaning on it, in the sea and far out.
function cloudPuffs() {
  const rand = random(31);
  const list = [];
  const cluster = (x, y, z, size) => {
    const n = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : size * (0.7 + 0.6 * rand());
      const s = size * (i === 0 ? 1 : 0.45 + 0.4 * rand());
      list.push({ x: x + Math.cos(a) * d, y: y + (i === 0 ? 0.25 : rand() * 0.15) * s, z: z + Math.sin(a) * d,
        sx: s * (1.2 + 0.5 * rand()), sy: s * (0.62 + 0.25 * rand()), sz: s * (1.2 + 0.5 * rand()) });
    }
  };
  for (let i = 0; i < 120; i++) {
    const r = 18 + 430 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
    cluster(Math.cos(a) * r, CLOUD_Y + (rand() - 0.6) * 3, Math.sin(a) * r, 4 + 9 * rand() * (0.5 + r / 430));
  }
  for (let i = 0; i < 16; i++) {            // big towers far out, on the horizon
    const r = 520 + 380 * rand(), a = rand() * Math.PI * 2;
    cluster(Math.cos(a) * r, CLOUD_Y + 6 + 22 * rand(), Math.sin(a) * r, 26 + 26 * rand());
  }
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const mesh = new THREE.InstancedMesh(geometry, puffMaterial(), list.length);
  const seeds = new Float32Array(list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI);
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz)));
    seeds[i] = rand();
  });
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  return mesh;
}

function puffMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...SKY_UNIFORMS, ...TONES },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uSkyTime;
      varying vec3 vNormalW, vWorld;
      varying float vLow;
      void main() {
        vec3 p = position, n = normal;
        // a flat underside, a lumpy top and a slow boil
        float lump = 1.0 + 0.07 * sin(p.x * 3.1 + aSeed * 40.0) * sin(p.z * 2.7 + aSeed * 17.0)
          + 0.03 * sin(uSkyTime * 0.4 + aSeed * 6.28 + p.y * 4.0);
        p *= lump;
        if (p.y < 0.0) { p.y *= 0.35; n.y /= 0.35; }
        vLow = position.y;
        mat3 m = mat3(instanceMatrix);
        vec3 s = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
        vNormalW = normalize(mat3(modelMatrix) * (m * (n / s)));
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      ${SKY}
      ${TONE_GLSL}
      varying vec3 vNormalW, vWorld;
      varying float vLow;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec3 c = cloudTone(dot(n, uSunDir));
        c = mix(uDeep, c, smoothstep(-0.55, 0.25, vLow));                 // deeper blue underneath
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        float backlit = max(dot(-v, uSunDir), 0.0);
        c = mix(c, uLit, rim * 0.35);                                     // soft bright edges
        c += uRim * rim * backlit * backlit * 0.8;                        // a silver lining towards the sun
        float haze = 1.0 - exp(-dist / 900.0);
        c = mix(c, mix(uBelow, skyHaze(-v), 0.6), haze * 0.92);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.outlineParameters = { visible: false };
  return material;
}

// The floor of cloud tops under the puffs: a drifting pattern of humps, lit and shaded in the same tones, giving
// way to plain haze where it gets too small to see. Away from the route it tears open here and there, down to the
// blue valleys far below.
function cloudFloor() {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...SKY_UNIFORMS, ...TONES, uValley: { value: new THREE.Color('#47698c') },
      uMeadow: { value: new THREE.Color('#5c8576') } },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec2 vFromCentre;
      void main() {
        vFromCentre = position.xy;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      ${SKY}
      ${TONE_GLSL}
      uniform vec3 uValley, uMeadow;
      varying vec3 vWorld;
      varying vec2 vFromCentre;
      float humps(vec2 p) { return skyNoise(p) * 0.6 + skyNoise(p * 2.2 + 3.7) * 0.28 + skyNoise(p * 4.7 + 1.3) * 0.12; }
      // below about 0.36 the cloud sea is open; never near the route
      float gapAt(vec2 xz, vec2 fromCentre) {
        vec2 g = xz / 150.0;
        return skyNoise(g) * 0.7 + skyNoise(g * 2.3 + 5.1) * 0.3 + 0.3 * (1.0 - smoothstep(110.0, 180.0, length(fromCentre)));
      }
      void main() {
        vec3 toCam = vWorld - cameraPosition;
        float dist = length(toCam);
        vec3 dir = toCam / dist;
        vec2 p = (vWorld.xz + vec2(uSkyTime * 0.35, uSkyTime * 0.12)) / 58.0;
        float detail = 1.0 - smoothstep(0.12, 0.5, length(fwidth(p)));
        float h = humps(p), toward = humps(p + normalize(uSunDir.xz) * 0.05);
        vec3 c = cloudTone((h - toward) * 9.0 + 0.12);
        c = mix(c, uShade, (1.0 - smoothstep(0.3, 0.42, h)) * 0.5);      // the troughs between humps
        c = mix(mix(uMid, uShade, 0.25), c, detail);
        // the gaps: a shaded rim where the cloud curls down, the valley floor in the blue depth, and on the far
        // side the cloud's wall dropping down to it
        float gap = gapAt(vWorld.xz, vFromCentre) + 0.03 * (h - 0.5);
        vec2 away = normalize(dir.xz + vec2(1e-5)) * 14.0;
        float beyond = gapAt(vWorld.xz + away, vFromCentre + away);
        float aa = fwidth(gap) + 1e-4;
        c = mix(c, mix(uShade, uDeep, 0.5), smoothstep(0.385 + aa, 0.385 - aa, gap));
        vec3 valley = mix(uValley, uMeadow, smoothstep(0.4, 0.7, skyNoise(vWorld.xz / 70.0)));
        valley = mix(valley, uValley * 0.75, smoothstep(0.55, 0.6, skyNoise(vWorld.xz / 23.0 + 9.0)));
        vec3 wall = mix(uDeep, uShade, smoothstep(0.31, 0.36, gap));
        vec3 below = mix(mix(valley, uDeep, 0.3), wall, smoothstep(0.36 - aa, 0.36 + aa, beyond));
        c = mix(c, below, smoothstep(0.36 + aa, 0.36 - aa, gap));
        float haze = 1.0 - exp(-dist / 650.0);
        c = mix(c, mix(uBelow, skyHaze(dir), 0.6), haze);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.outlineParameters = { visible: false };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1500, 64), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = CLOUD_Y - 1.2;
  return floor;
}
