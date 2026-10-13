// What lies around the climb: the sky (sky.js), a sea of clouds far below (clouds.js), the mountain range rising out
// of it (range.js) and a few birds. None of it collides; it's there to say "very high up".
import * as THREE from 'three';
import { skyDome, skyTime, HORIZON, SUN_DIR } from './sky.js';
import { buildClouds } from './clouds.js';
import { buildRange } from './range.js';

export { HORIZON, SUN_DIR };

export function buildScenery(scene, center) {
  const sky = skyDome();
  const clouds = buildClouds(center);
  const birds = flock(center);
  scene.add(sky, clouds.group, buildRange(center), birds.mesh);
  return {
    update(camera, time) {
      sky.position.copy(camera.position);
      skyTime.value = time;
      clouds.update(time);
      birds.update(time);
    },
  };
}

// A few birds far out, gliding in slow circles and flapping now and then: little ink ticks against the clouds.
function flock(center) {
  const count = 7;
  const wing = new THREE.BufferGeometry();
  // one bird: two wings meeting at the body, a V seen from anywhere
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -1, 0, -0.1, 0, 0, -0.2,
    0, 0, 0.25, 0, 0, -0.2, 1, 0, -0.1], 3));
  wing.setAttribute('side', new THREE.Float32BufferAttribute([0, 1, 0, 0, 0, 1], 1));
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: skyTime, uColor: { value: new THREE.Color('#3b4366') } },
    vertexShader: /* glsl */`
      attribute float side;
      uniform float uTime;
      void main() {
        float phase = float(gl_InstanceID) * 1.7;
        // flap a few beats, then glide
        float flap = sin(uTime * 7.0 + phase) * smoothstep(0.2, 0.6, sin(uTime * 0.7 + phase));
        vec3 p = position * 0.9;
        p.y += side * (0.5 * flap + 0.12);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.InstancedMesh(wing, material, count);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1.6, 1.6, 1.6);
  const axis = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    update(time) {
      for (let i = 0; i < count; i++) {
        // two loose groups circling over the cloud sea, each bird a little off the group's line
        const group = i < 4 ? 0 : 1, r = (group ? 60 : 40) + i * 3, speed = group ? 0.045 : -0.06;
        const a = time * speed + i * 0.08 + group * 2.4;
        p.set(center.x + (group ? 110 : 60) + Math.cos(a) * r, (group ? -14 : -4) + Math.sin(time * 0.3 + i) * 0.8,
          center.z + (group ? -10 : -70) + Math.sin(a) * r);
        q.setFromAxisAngle(axis, -a + (speed > 0 ? 0 : Math.PI));
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
