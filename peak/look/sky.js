// The sky: a gradient dome with the sun, its glow and a few high wisps. Its GLSL (SKY) is shared with the clouds
// and the far range, so everything in the distance melts into exactly the colour of the sky behind it.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();   // towards the sun
export const HORIZON = new THREE.Color('#d3e6f6');      // the horizon away from the sun, and the fog
export const skyTime = { value: 0 };                     // seconds; main.js advances it

export const SKY_UNIFORMS = {
  uSunDir: { value: SUN_DIR },
  uZenith: { value: new THREE.Color('#2f7bd9') },
  uUpper: { value: new THREE.Color('#6fb2ef') },
  uHorizon: { value: HORIZON },
  uWarm: { value: new THREE.Color('#ffdcae') },          // the golden band towards the sun
  uBelow: { value: new THREE.Color('#e3ecf7') },         // under the horizon: the cloud sea's haze
  uSkyTime: skyTime,
};

export const SKY = /* glsl */`
  uniform vec3 uSunDir, uZenith, uUpper, uHorizon, uWarm, uBelow;
  uniform float uSkyTime;
  // the colour along the horizon in direction d: a golden band towards the sun, a hint of it all round
  vec3 skyHaze(vec3 d) {
    vec2 across = normalize(d.xz + vec2(1e-5)), sunAcross = normalize(uSunDir.xz);
    float toward = dot(across, sunAcross) * 0.5 + 0.5;
    return mix(uHorizon, uWarm, 0.12 + 0.6 * toward * toward * toward);
  }
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 c = mix(skyHaze(d), uUpper, pow(smoothstep(0.0, 0.32, h), 0.75));
    c = mix(c, uZenith, smoothstep(0.22, 1.0, h));
    c = mix(c, uBelow, smoothstep(0.0, -0.08, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uWarm * (pow(s, 5.0) * 0.16 + pow(s, 40.0) * 0.55);
    return c;
  }
  float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float skyNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
  }`;

export function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { ...SKY_UNIFORMS },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;   // always behind everything
      }`,
    fragmentShader: /* glsl */`
      ${SKY}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // a few thin wisps of cirrus, drifting, low over the horizon
        vec2 q = d.xz / (d.y + 0.25) * 2.2 + vec2(uSkyTime * 0.004, uSkyTime * 0.0015);
        float w = skyNoise(q * vec2(0.6, 4.0)) * 0.65 + skyNoise(q * vec2(1.7, 9.0) + 4.0) * 0.35;
        float band = smoothstep(0.04, 0.12, d.y) * (1.0 - smoothstep(0.2, 0.42, d.y));
        c = mix(c, vec3(1.0, 0.99, 0.97), smoothstep(0.7, 0.9, w) * band * 0.14);
        // the sun: a hot disc for the bloom to catch
        float s = dot(d, uSunDir);
        c += vec3(1.0, 0.93, 0.8) * smoothstep(0.99935, 0.9996, s) * 12.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
