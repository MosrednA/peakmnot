// A windsock beside a wind gap (weather.js): it hangs limp in the lull, lifts as the gust builds and streams out
// straight while it blows, so you can see when it is safe to jump. Five striped hoops on a pole, each bending a
// little further, so it droops in a curve. With a bracket it sticks out of a cliff wall instead.
import * as THREE from 'three';
import { toon } from '../look/look.js';

const HOOPS = 5, LENGTH = 0.8, ARM = 0.5;

// foot: where the pole stands, or with bracket (the way out of the wall) where the arm leaves the wall.
export function windsock(world, foot, { height = 1.7, bracket = null } = {}) {
  const group = new THREE.Group();
  group.position.copy(foot);
  const length = bracket ? ARM : height;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, length, 8), toon('#d8dde6'));
  pole.castShadow = true;
  const pivot = new THREE.Group();
  if (bracket) {
    pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bracket);
    pole.position.copy(bracket).multiplyScalar(length / 2);
    pivot.position.copy(bracket).multiplyScalar(length);
  } else {
    pole.position.y = length / 2;
    pivot.position.y = length - 0.05;
  }
  group.add(pole, pivot);
  const hoops = [];
  let parent = pivot;
  for (let i = 0; i < HOOPS; i++) {
    const r0 = 0.13 - 0.016 * i, r1 = 0.13 - 0.016 * (i + 1), len = LENGTH / HOOPS;
    const geometry = new THREE.CylinderGeometry(r1, r0, len, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2);
    const hoop = new THREE.Mesh(geometry, toon(i % 2 ? '#ffffff' : '#ef5a2a', { side: THREE.DoubleSide }));
    hoop.castShadow = true;
    const joint = new THREE.Group();
    joint.position.z = i === 0 ? 0 : len;
    joint.add(hoop);
    parent.add(joint);
    hoops.push(joint);
    parent = joint;
  }
  world.group.add(group);
  const top = foot.clone().add(pivot.position);
  let lift = 0, phase = Math.random() * 6;
  const sock = {
    update(dt, time, weather) {
      const wind = weather.windAt(top), s = Math.max(wind.jet ?? 0, 0.35 * wind.strength);
      lift = THREE.MathUtils.damp(lift, s, 4, dt);
      // the flutter's phase advances at the wind's pace; time times a changing rate would race through cycles
      // whenever a gust came or went
      phase += dt * (4 + 5 * lift);
      // point downwind, turning only when there's some wind to turn it
      const turn = Math.atan2(wind.dir.x, wind.dir.z) - pivot.rotation.y;
      pivot.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-(1 + 5 * s) * dt));
      const droop = 1 - lift;
      hoops.forEach((joint, i) => {
        const flutter = (0.03 + 0.06 * lift) * Math.sin(phase - i * 0.9);
        joint.rotation.x = (i === 0 ? 0.55 : 0.21) * droop + flutter * (i ? 1 : 0.3);
        joint.rotation.y = 0.5 * flutter;
      });
    },
  };
  world.animated.push(sock);
  return sock;
}
