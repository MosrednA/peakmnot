// The painted rock: a toon material (look.js) with a little shader on top, so it gets texture without image files:
// layers of sediment, cracks, lichen and snow that drips over the lip, with an ink line along every edge you can
// stand on; it darkens and dissolves into the clouds further down. The shading stays the toon ramp, so it matches
// Mnot. wood.js does the same for wood and rope, with the noise from here.
import * as THREE from 'three';
import { RAMPS } from './look.js';

export const time = { value: 0 };           // seconds, for the snow's sparkle; main.js advances it

export const NOISE = /* glsl */`
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                   mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                   mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { sum += amp * noise3(p); p = p * 2.03 + 1.7; amp *= 0.5; }
    return sum;
  }`;

const linear = hex => new THREE.Color(hex);

// ------------------------------------------------------------------ rock

// The rock's colours: warm granite in the light, cooler slate, darker strata and a blue-grey far down; the haze is
// the cloud sea's (sky.js uBelow).
const ROCK = {
  warm: linear('#c4a896'), cool: linear('#9397b6'), strata: linear('#776e8a'), deep: linear('#56628a'),
  lichen: linear('#dda04a'), moss: linear('#9fae6a'), snow: linear('#ffffff'), snowEdge: linear('#c4d5f2'),
  ink: linear('#2f3550'), haze: linear('#e3ecf7'),
};

let rockMaterial = null;

// One material for every rock. The geometry carries aDrop: metres below the rock's top on its sides (0 at the lip),
// negative going in over the top, so the snow line and the lip's ink line are drawn per pixel.
export function rock() {
  if (rockMaterial) return rockMaterial;
  const material = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: RAMPS.world });
  material.userData.outlineParameters = { color: [0.2, 0.22, 0.34], thickness: 0.0034, alpha: 1 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, Object.fromEntries(Object.entries(ROCK).map(([k, c]) => [`u_${k}`, { value: c }])),
      { uTime: time });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDrop;
        varying vec3 vWorld;
        varying vec3 vRest;
        varying float vDrop;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRest = transformed;     // where it was built, so the paint stays put on a rock that falls away
        vDrop = aDrop;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${Object.keys(ROCK).map(k => `uniform vec3 u_${k};`).join('\n')}
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vRest;
        varying float vDrop;
        ${NOISE}
        float snowMask, lipMask;`)
      // facets: the normal of each triangle, while the smooth vertex normals keep the outline in one piece
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vRest;
          vec3 up = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          // the size of a pixel on the rock: detail finer than a few pixels fades out instead of shimmering
          float px = length(fwidth(p));
          float fine = 1.0 - smoothstep(0.012, 0.035, px), mid = 1.0 - smoothstep(0.04, 0.12, px);
          // rock: layers of sediment in a few tones, wavy and a little tilted, each with a dark seam on top (the
          // layers' line and the seam's width everywhere: a derivative needs the pixels next door to work it out too)
          float warp = fbm3(p * 0.21);
          float t = (p.y + warp * 1.1 + 0.12 * sin(p.x * 0.37 + p.z * 0.23)) * 1.35;
          float seam = max(0.07, fwidth(t) * 1.5);
          float aa = fwidth(vDrop) + 1e-4;
          // snow: on top, and dripping over the lip to a depth that wanders (the line: 0.1 to 0.66 m down); a cool
          // rim where it ends. What can't be seen isn't worked out, so the picture is the same for less: the line on
          // the tops and well down the sides, the rock under the snow or the haze, lichen where none grows.
          float upward = step(0.78, up.y), rim = 0.0, overhang = 0.0;
          snowMask = 1.0;
          if (upward < 1.0 && vDrop > min(0.01, 0.1 - aa)) {
            if (vDrop >= max(1.12, 0.67 + aa)) snowMask = 0.0;
            else {
              float line = 0.1 + 0.6 * fbm3(vec3(p.x * 1.7, 0.0, p.z * 1.7));
              snowMask = 1.0 - smoothstep(line - aa, line + aa, vDrop);
              rim = smoothstep(line - 0.09, line - 0.02, vDrop);
              overhang = (1.0 - smoothstep(line, line + 0.45, vDrop)) * step(0.0, vDrop);
            }
          }
          vec3 c = vec3(0.0), snow = vec3(0.0);
          if (snowMask < 1.0 && vWorld.y > -25.0) {
            float layer = floor(t), f = fract(t);
            float tone = hash3(vec3(layer, 1.7, 3.1));
            c = mix(u_warm, u_cool, smoothstep(0.25, 0.75, fbm3(p * 0.09 + 3.1)));
            c = mix(c, u_strata, step(0.66, tone) * 0.6);
            c *= 0.92 + 0.16 * tone;
            c = mix(c, u_strata * 0.7, (1.0 - smoothstep(0.0, seam, f)) * 0.7 * (0.07 / seam));
            c = mix(c, c * 1.12, smoothstep(0.75, 1.0, f));
            // grain, and here and there a thin crack running down
            if (fine > 0.0) c *= 1.0 + (0.14 * noise3(p * vec3(9.0, 14.0, 9.0)) - 0.07) * fine;
            if (mid > 0.0) {
              float cracked = smoothstep(0.55, 0.7, noise3(p * 0.4 + 2.0));
              if (cracked > 0.0) {
                float crack = abs(noise3(vec3(p.x * 2.6, p.y * 0.3, p.z * 2.6) + 7.0) - 0.5);
                c = mix(c, u_strata * 0.55, (1.0 - smoothstep(0.008, 0.02, crack)) * cracked * 0.8 * mid);
              }
            }
            // lichen and moss in small patches just under the lip, where the sun gets to them
            float near = (1.0 - smoothstep(0.4, 2.2, vDrop)) * step(0.0, vDrop);
            if (near > 0.0) {
              float growth = smoothstep(0.62, 0.67, fbm3(p * 3.2 + 11.0)) * near;
              if (growth > 0.0) c = mix(c, mix(u_lichen, u_moss, step(0.5, noise3(p * 0.7 + 5.0))), growth * 0.75);
            }
            // further down it gets darker and bluer
            c = mix(c, u_deep, (1.0 - exp(-max(vDrop, 0.0) / 9.0)) * 0.55);
            c *= 1.0 - 0.28 * overhang;      // the snow's overhang
          }
          if (snowMask > 0.0) snow = mix(u_snow, u_snowEdge, max(rim, 0.25 * noise3(p * vec3(2.0, 6.0, 2.0)) * mid));
          diffuseColor.rgb *= mix(c, snow, snowMask);
          // the ink line along the lip, about two pixels wide at any distance
          lipMask = 1.0 - smoothstep(aa * 0.9, aa * 2.0, abs(vDrop));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // sparkle on the snow
          vec3 cell = floor(vRest * 34.0);
          float g = hash3(cell);
          float twinkle = step(0.994, g) * max(0.0, sin(uTime * 2.6 + g * 300.0));
          float close = 1.0 - smoothstep(0.006, 0.02, length(fwidth(vWorld)));   // only where a cell is pixels wide
          totalEmissiveRadiance += snowMask * twinkle * close * vec3(0.9, 0.95, 1.0);
        }`)
      .replace('#include <tonemapping_fragment>', `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_ink, lipMask * 0.85);
        // deep down the rock dissolves into the haze above the clouds
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_haze, smoothstep(-3.0, -25.0, vWorld.y));
        #include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => 'peak-rock';
  rockMaterial = material;
  return material;
}
