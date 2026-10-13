// Props that get in the way fade out: a sign, flag or tent between the camera and Mnot, or right in front of the
// camera, dissolves (a dither, so it needs no sorting and keeps its shadow) and comes back once the view is clear.
// Anything in world.group marked userData.fade = true takes part (decor.js marks its props); rocks you stand on don't.
// main.js calls fadeProps once a frame, after the camera has moved.
import * as THREE from 'three';

const GHOST = 0.22;            // how much of a prop is left while it's in the way
const NEAR = 0.75;             // closer than this to the camera, a prop goes altogether

let props = null;

// Every prop's meshes, each with its own copy of its materials that knows how to dissolve.
function collect(world) {
  props = [];
  world.group.updateWorldMatrix(true, true);
  world.group.traverse((root) => {
    if (!root.userData.fade || root.parent?.userData.inFade) return;
    root.traverse(o => { o.userData.inFade = true; });
    const fade = { value: 1 }, meshes = [];
    root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData.noFade) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      meshes.push({ mesh, box: new THREE.Box3(), moving: !!mesh.userData.moving });
    });
    const prop = { root, fade, meshes, clones: new Map(), level: 1 };
    for (const m of meshes) measure(m);
    props.push(prop);
  });
}

function measure(entry) {
  entry.box.copy(entry.mesh.geometry.boundingBox).applyMatrix4(entry.mesh.matrixWorld)
    .expandByScalar(entry.moving ? 0.12 : 0.04);
}

// A copy of a material that discards a growing share of its pixels in a 4×4 pattern as fade.value drops.
function dissolving(prop, material) {
  if (prop.clones.has(material)) return prop.clones.get(material);
  material = material.userData.dissolves ?? material;        // a copy made before the props were found again
  if (prop.clones.has(material)) return prop.clones.get(material);
  const copy = material.clone();
  const base = material.onBeforeCompile, key = material.customProgramCacheKey.call(material);
  copy.onBeforeCompile = (shader, renderer) => {
    base.call(copy, shader, renderer);
    shader.uniforms.uFade = prop.fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFade;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
          ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
          if ((bayer[c.x + 4 * c.y] + 0.5) / 16.0 > uFade) discard;
        }`);
  };
  copy.customProgramCacheKey = () => `${key}|fade`;
  copy.userData.outlineVisible = copy.userData.outlineParameters?.visible ?? true;
  copy.userData.dissolves = material;
  prop.clones.set(material, copy);
  prop.clones.set(copy, copy);
  return copy;
}

const ray = new THREE.Ray(), hitPoint = new THREE.Vector3(), aims = Array.from({ length: 7 }, () => new THREE.Vector3());
const right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

// Is this box on a line from the camera to Mnot's outline, short of Mnot?
function inTheWay(box, eye) {
  for (const aim of aims) {
    const length = eye.distanceTo(aim);
    ray.origin.copy(eye);
    ray.direction.subVectors(aim, eye).divideScalar(length);
    if (ray.intersectBox(box, hitPoint) && eye.distanceTo(hitPoint) < length - 0.25) return true;
  }
  return false;
}

export function fadeProps(world, camera, player, dt) {
  if (!props) collect(world);
  const eye = camera.position, p = player.pos;
  right.subVectors(p, eye).setY(0).normalize().cross(up);
  // Mnot's outline: feet, middle and head, and the arms' reach either side
  aims[0].copy(p).y += 0.15;
  aims[1].copy(p).y += 0.75;
  aims[2].copy(p).y += 1.45;
  aims[3].copy(aims[1]).addScaledVector(right, 0.45);
  aims[4].copy(aims[1]).addScaledVector(right, -0.45);
  aims[5].copy(aims[2]).addScaledVector(right, 0.35);
  aims[6].copy(aims[2]).addScaledVector(right, -0.35);
  for (const prop of props) {
    let want = 1;
    for (const entry of prop.meshes) {
      if (entry.moving) measure(entry);
      if (entry.box.distanceToPoint(eye) < NEAR) { want = 0; break; }
      if (want > GHOST && inTheWay(entry.box, eye)) want = GHOST;
    }
    // out quickly, back gently
    prop.level = dt === 0 ? want : THREE.MathUtils.damp(prop.level, want, want < prop.level ? 9 : 3, dt);
    prop.fade.value = prop.level > 0.995 ? 1 : prop.level;
    const solid = prop.fade.value === 1;
    for (const { mesh } of prop.meshes) {
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => dissolving(prop, m));
      else mesh.material = dissolving(prop, mesh.material);
      for (const m of [mesh.material].flat()) {
        if (m.userData.outlineParameters) m.userData.outlineParameters.visible = solid && m.userData.outlineVisible;
      }
    }
  }
}

// Forget the props, so they're found and measured again (after the route changed, or a test moved a prop).
export function resetFade() {
  for (const prop of props ?? []) prop.root.traverse(o => { delete o.userData.inFade; });
  props = null;
}
