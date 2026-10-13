// Props along the route. The pieces live in their own modules (flags.js, signs.js, camp.js); this file gathers them
// for route.js, adds the small stuff (cairns, a snack stash, a lost microphone, a bench) and dresses the route once
// it is built: beams fitted to their ledges, signs turned to the camera, every prop's feet checked to stand on rock
// (footing.js), the trailhead map drawn.
// Every prop is marked userData.fade, so fade.js can dissolve it while it stands between the camera and Mnot.
import * as THREE from 'three';
import { toon } from '../look/look.js';
import { wood } from './wood.js';
import { fitBeams } from '../world/beams.js';
import { lookYaw } from '../controls/camera.js';
import { aim, snowStrip, faceMaterial } from './signs.js';
import { painted, letter, planks } from './paint.js';
import { feet, settle } from './footing.js';
import { stoneStack } from './flags.js';

export { checkpointFlag, summitFlag, pennants } from './flags.js';
export { signpost, warningSign } from './signs.js';
export { trailMap } from './trailmap.js';
export { tent, podcastTable } from './camp.js';
export { onRock } from './footing.js';

// A stack of flat stones.
export function cairn(world, foot, size = 0.4, count = 4) {
  const group = stoneStack(size, count);
  group.position.copy(foot);
  group.userData.fade = true;
  world.group.add(group);
  feet(group, [[0, 0]], 'cairn', size * 0.45);
  return group;
}

// A crate of snacks with its lid off: the climb's real fuel.
export function snackStash(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const label = painted(256, 128, (ctx, w, h) => {
    planks(ctx, w, h, { count: 2, seed: 31, color: '#b8864e', nails: false });
    letter(ctx, 'SNACKS\n(do not feed\nthe can)', w / 2, h / 2, { size: h * 0.2, color: 'rgba(30, 20, 15, 0.85)', line: 1.05 });
  });
  const side = wood('#b8864e', 'x');
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), [side, side, side, side, faceMaterial(label), side]);
  crate.position.y = 0.13;
  crate.castShadow = true;
  group.add(crate);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.32), wood('#a87a46', 'x'));
  lid.position.set(-0.05, 0.03, 0.3);
  lid.rotation.set(0.1, 0.4, 0.05);
  group.add(lid);
  for (const [x, z, color] of [[-0.1, -0.03, '#f2c14e'], [0.06, 0.04, '#3d8fd6'], [0.12, -0.06, '#e23b2e']]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.16), toon(color));
    bar.position.set(x, 0.27, z);
    bar.rotation.set(0.2, x * 5, 0.3);
    group.add(bar);
  }
  const snow = snowStrip(0.4, 0.06, 0.025, 5);
  snow.position.set(0, 0.26, -0.13);
  group.add(snow);
  world.group.add(group);
  feet(group, [[-0.21, -0.15], [0.21, -0.15], [-0.21, 0.15], [0.21, 0.15]], 'snack stash', 0.02);
  aim(world, group, yaw);
  return group;
}

// A microphone someone dropped on the way up, cable and all.
export function lostMic(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.16, 12), toon('#2c2f3a'));
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0.035, 0);
  const foam = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 9), toon('#e23b2e'));
  foam.position.set(0.11, 0.045, 0);
  const points = [new THREE.Vector3(-0.08, 0.03, 0), new THREE.Vector3(-0.2, 0.02, 0.08), new THREE.Vector3(-0.3, 0.02, -0.05),
    new THREE.Vector3(-0.45, 0.02, 0.03)];
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.008, 5), toon('#1d1d26'));
  body.castShadow = foam.castShadow = true;
  group.add(body, foam, cable);
  world.group.add(group);
  feet(group, [[0.11, 0], [-0.45, 0.03]], 'lost mic', 0.03);
  aim(world, group, yaw);
  return group;
}

// A plank bench on two stumps, for getting your breath back at a checkpoint.
export function bench(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  for (const x of [-0.38, 0.38]) {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.36, 9), wood('#7a4f2e', 'y'));
    stump.position.set(x, 0.15, 0);
    stump.castShadow = true;
    group.add(stump);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.26), wood('#a8743f', 'x'));
  seat.position.y = 0.355;
  seat.castShadow = seat.receiveShadow = true;
  const snow = snowStrip(0.5, 0.2, 0.03, 9);
  snow.position.set(0.22, 0.38, 0);
  group.add(seat, snow);
  world.group.add(group);
  feet(group, [[-0.38, 0], [0.38, 0]], 'bench', 0.14);
  aim(world, group, yaw);
  return group;
}

// ------------------------------------------------------------------ dressing the route

// Where the camera stands when Mnot is on the walking line nearest to point.
export function cameraNear(world, point) {
  const shot = world.railAt(point), right = new THREE.Vector3(-shot.dir.z, 0, shot.dir.x);
  const yaw = lookYaw(shot), pitch = shot.pitch;
  const target = point.clone().addScaledVector(right, -shot.side);
  target.y += 0.9;
  const look = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  return target.addScaledVector(look, -shot.distance);
}

// Once the route and its camera rail exist: fit the beams, turn the props that face the camera, stand every prop on
// its rock (turning it again if it has to move), draw the maps.
export function dressRoute(world) {
  fitBeams(world);
  const turns = new Map((world.aimed ?? []).map(({ object, turn }) => [object, turn]));
  const face = (object) => {
    if (!turns.has(object)) return;
    const eye = cameraNear(world, object.position);
    object.rotation.y = Math.atan2(eye.x - object.position.x, eye.z - object.position.z) + turns.get(object);
  };
  turns.forEach((turn, object) => face(object));
  const footed = [];
  world.group.traverse((o) => { if (o.userData.feet) footed.push(o); });
  for (const object of footed) settle(world, object, face);
  world.group.traverse((o) => { if (o.userData.draw) o.userData.draw(world); });
}
