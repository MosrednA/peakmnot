// The stage every mini game plays on, set up the climb's way: the renderer, the scene in the sky's colour with the
// haze, the camera, the ink outlines and the post-processing (look/post.js: adaptive, except in ?manual), and the
// late-morning light, a cool sky filling the shadows and a warm sun casting them. The sun's shadow covers a box that
// aimSun() moves along with the play, a little ahead of the camera, snapped to the shadow map's texels so its edges
// don't crawl. On a resize the camera and the post-processing follow (and ?manual draws again).
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { HORIZON, SUN_DIR } from '../look/scenery.js';
import { createPost } from '../look/post.js';

// shadow: the box round the play (half its width, near, far), the bias, how far ahead of the camera it reaches and
// how far back along the sun the light stands
export function createStage({ manual = false, fov = 50, fog = [60, 420],
  shadow: { half = 10, near = 1, far = 60, bias = -0.0006, ahead = 0, back = 30 } = {} } = {}) {
  // post.js draws into its own multisampled buffer and sets the pixel ratio, so the canvas needs no antialiasing
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  const outline = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.16, 0.2, 0.3] });

  const scene = new THREE.Scene();
  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON, fog[0], fog[1]);
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, 2500);
  const post = createPost(renderer, scene, camera, outline, { adaptive: !manual });

  scene.add(new THREE.HemisphereLight('#c3d8ff', '#a9a6c4', 1.2));
  const sun = new THREE.DirectionalLight('#fff2e0', 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(post.shadowSize(2048));     // smaller on a phone (post.js)
  sun.shadow.radius = 2.2;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near, far });
  sun.shadow.bias = bias;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const render = () => post.render();

  // the sun's axes, to snap its shadow to whole texels
  const sunX = new THREE.Vector3(), sunY = new THREE.Vector3(), sunZ = new THREE.Vector3(), shade = new THREE.Vector3();
  new THREE.Matrix4().lookAt(SUN_DIR, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP).extractBasis(sunX, sunY, sunZ);
  // the shadow's box round `at` (the player), pushed ahead along the camera's heading
  function aimSun(at) {
    camera.getWorldDirection(shade).setY(0).normalize();
    shade.multiplyScalar(ahead).add(at);
    const texel = 2 * half / sun.shadow.mapSize.x, snap = v => Math.round(v / texel) * texel;
    const sx = snap(shade.dot(sunX)), sy = snap(shade.dot(sunY)), sz = shade.dot(sunZ);
    sun.target.position.set(0, 0, 0).addScaledVector(sunX, sx).addScaledVector(sunY, sy).addScaledVector(sunZ, sz);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, back);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    post.setSize(innerWidth, innerHeight);
    if (manual) render();
  });

  return { renderer, outline, scene, camera, post, sun, render, aimSun };
}
