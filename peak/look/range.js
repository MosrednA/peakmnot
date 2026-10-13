// The mountain range around the climb: snowy peaks rising out of the cloud sea, islands close by, a range further
// out and a jagged skyline far off, with gaps where the clouds run on to the horizon. Each peak is a cone with sharp
// ridges running down from the top, so every face is either in the sun or in the shade, like a drawing. Snow caps
// the tops and runs further down the gullies between the ridges; the rock below is painted in warm strata. The
// distance fades it all through blue into the sky's haze. From the route the tops stay a little below the horizon:
// up here Mnot is higher than nearly all of them.
import * as THREE from 'three';
import { RAMPS } from './look.js';
import { random } from '../world/world.js';
import { SKY, SKY_UNIFORMS } from './sky.js';
import { CLOUD_Y } from './clouds.js';

// Bands of peaks: how many, how far from the centre, how high their tips may get above the clouds (as a share of
// the height at which they would touch the horizon seen from the route).
const BANDS = [
  { count: 10, near: 190, far: 330, reach: [0.45, 0.95] },
  { count: 16, near: 380, far: 680, reach: [0.6, 1.05] },
  { count: 26, near: 760, far: 1250, reach: [0.8, 1.35] },
];
// Hero peaks where the camera looks on the way up: [angle from +X towards +Z in degrees, distance, reach]. A few
// break the horizon.
const HEROES = [[-30, 255, 1.0], [-74, 300, 0.95], [-6, 430, 1.15], [-50, 560, 1.3], [-102, 520, 1.1],
  [-22, 900, 1.45], [-62, 1050, 1.4]];

const COLORS = {
  u_rockWarm: '#bb8d70', u_rockCool: '#8c86a8', u_rockDark: '#6a5a7a', u_snow: '#ffffff', u_snowShade: '#d8e5fb',
  u_hazeBlue: '#94b2e6',
};

export function buildRange(center) {
  const rand = random(404);
  const parts = [];
  const mountain = (a, r, reach) => {
    // reach 1: the tip would just touch the horizon seen from the route
    const tip = (2 + 0.055 * r - CLOUD_Y) * reach;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    parts.push(peak(rand, x, z, tip));
    // a shoulder or two leaning on it
    const shoulders = rand() < 0.85 ? 1 + Math.floor(rand() * 2) : 0;
    for (let k = 0; k < shoulders; k++) {
      const b = rand() * Math.PI * 2, d = tip * (0.8 + 0.7 * rand());
      parts.push(peak(rand, x + Math.cos(b) * d, z + Math.sin(b) * d, tip * (0.45 + 0.3 * rand())));
    }
  };
  for (const band of BANDS) {
    for (let i = 0; i < band.count; i++) {
      const a = (i + 0.2 + 0.6 * rand()) / band.count * Math.PI * 2;
      mountain(a, band.near + (band.far - band.near) * rand(), band.reach[0] + (band.reach[1] - band.reach[0]) * rand());
    }
  }
  for (const [deg, r, reach] of HEROES) mountain(THREE.MathUtils.degToRad(deg), r, reach);
  const mesh = new THREE.Mesh(merge(parts), rangeMaterial());
  mesh.frustumCulled = false;
  return mesh;
}

// One peak: a summit, then rings widening and dropping to well under the clouds. The rings bulge out along a few
// ridges and fall in between them (the gullies), and the profile is steep at the top and flares at the foot. Each
// one is stretched along a summit ridge and leans a little, so one face is a steep wall and the other a long slope.
function peak(rand, x, z, tip) {
  const rings = 7, segments = 30;
  const height = tip + 40;                       // the part under the cloud floor
  const radius = height * (0.7 + 0.45 * rand());
  const bow = 1.15 + 0.45 * rand();              // how sharply the flanks flare out at the foot
  const along = rand() * Math.PI * 2, stretch = 0.5 * rand() + 0.35 * rand();
  const lean = 0.3 * rand(), leanX = Math.cos(along + 1.2) * lean * radius, leanZ = Math.sin(along + 1.2) * lean * radius;
  const ridges = [along, along + Math.PI];       // the summit ridge, and a few more
  for (let j = 0, n = 2 + Math.floor(rand() * 3); j < n; j++) ridges.push(along + (j + 0.5 + 0.4 * (rand() - 0.5)) / n * Math.PI);
  const ridgeAt = (a) => Math.max(...ridges.map(r => Math.pow(Math.max(0, Math.cos(a - r)), 6)));
  const positions = [x, CLOUD_Y + tip, z];
  const gully = [0], rel = [1], index = [];
  for (let k = 1; k <= rings; k++) {
    const t = k / rings;
    for (let s = 0; s < segments; s++) {
      const a = (s + (k % 2) * 0.5) / segments * Math.PI * 2;
      const ridge = ridgeAt(a), sideways = Math.cos(a - along) ** 2;
      const r = radius * Math.pow(t, bow) * (0.66 + 0.5 * ridge) * (1 + stretch * sideways) * (0.9 + 0.2 * rand());
      const y = CLOUD_Y + tip - height * t + height * 0.05 * (rand() - 0.5) * t;
      positions.push(x + Math.cos(a) * r + leanX * t, y, z + Math.sin(a) * r + leanZ * t);
      gully.push(1 - ridge);
      rel.push(1 - t * height / tip);              // 1 at the tip, 0 where it meets the clouds
    }
  }
  for (let s = 0; s < segments; s++) index.push(0, 1 + (s + 1) % segments, 1 + s);
  for (let k = 0; k < rings - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = 1 + k * segments + s, b = 1 + k * segments + (s + 1) % segments, c = a + segments, d = b + segments;
      // the odd rings are turned half a step, so pick the diagonal that follows them
      if (k % 2 === 0) index.push(a, b, d, a, d, c);
      else index.push(a, b, c, b, d, c);
    }
  }
  return { positions, gully, rel, index };
}

function merge(parts) {
  const positions = [], gully = [], rel = [], index = [];
  for (const p of parts) {
    const offset = positions.length / 3;
    positions.push(...p.positions);
    gully.push(...p.gully);
    rel.push(...p.rel);
    for (const i of p.index) index.push(i + offset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aGully', new THREE.Float32BufferAttribute(gully, 1));
  geometry.setAttribute('aRel', new THREE.Float32BufferAttribute(rel, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// ------------------------------------------------------------------ paint

function rangeMaterial() {
  const material = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: RAMPS.far, fog: false });
  material.userData.outlineParameters = { visible: false };
  const colors = Object.fromEntries(Object.entries(COLORS).map(([k, hex]) => [k, { value: new THREE.Color(hex) }]));
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SKY_UNIFORMS, colors);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGully, aRel;
        varying vec3 vWorld;
        varying float vGully, vRel;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGully = aGully;
        vRel = aRel;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SKY}
        ${Object.keys(COLORS).map(k => `uniform vec3 ${k};`).join('\n')}
        varying vec3 vWorld;
        varying float vGully, vRel;`)
      // flat faces, each in the sun or in the shade
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 up = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          // strata a few metres thick, wavy, in warm and cool tones
          float t = (vWorld.y + 9.0 * skyNoise(vWorld.xz / 60.0)) / 5.5;
          float tone = skyHash(vec2(floor(t), 4.1));
          vec3 rock = mix(u_rockWarm, u_rockCool, smoothstep(0.3, 0.7, skyNoise(vWorld.xz / 90.0 + tone * 3.0)));
          rock = mix(rock, u_rockDark, step(0.72, tone) * 0.55);
          rock *= 0.9 + 0.2 * tone;
          // a snow cap with a ragged edge, running further down the gullies and onto flat ledges
          float edge = 0.08 * (skyNoise(vWorld.xz / 9.0) - 0.5) + 0.06 * (skyNoise(vWorld.xz / 3.0 + 7.0) - 0.5);
          float snowy = vRel - 0.52 + 0.42 * smoothstep(0.35, 0.95, vGully) + max(up.y - 0.8, 0.0) * 1.5 + edge;
          float aa = fwidth(snowy) + 1e-3;
          float snow = smoothstep(-aa, aa, snowy);
          // faces turned from the sun go a cooler blue, so the light side and the shade side read apart
          float sunny = smoothstep(-0.05, 0.12, dot(up, uSunDir));
          rock = mix(rock * vec3(0.86, 0.88, 1.04), rock, sunny);
          vec3 white = mix(u_snowShade * vec3(0.92, 0.95, 1.0), u_snow, sunny * (0.6 + 0.4 * smoothstep(0.2, 0.6, up.y)));
          diffuseColor.rgb *= mix(rock, white, snow);
        }`)
      .replace('#include <tonemapping_fragment>', `
        {
          // distance: near peaks keep their colour, further ones go blue, the farthest melt into the sky
          vec3 toCam = vWorld - cameraPosition;
          float dist = length(toCam);
          vec3 dir = toCam / dist;
          float haze = 1.0 - exp(-dist / 1000.0);
          vec3 far = skyHaze(normalize(vec3(dir.x, 0.0, dir.z)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(u_hazeBlue, far, smoothstep(0.5, 0.95, haze)), haze);
          // and mist rises out of the cloud sea round their feet
          float mist = smoothstep(${(CLOUD_Y + 9).toFixed(1)}, ${(CLOUD_Y - 1).toFixed(1)}, vWorld.y);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uBelow, mist * mist * 0.8);
        }
        #include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => 'peak-range';
  return material;
}
