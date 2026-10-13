// Gondolas: a wooden pallet hanging from a trolley on a cable, shuttling between two ledges. It waits at each end,
// then glides across; whoever stands on it rides along (player.js reads the solid's moved). The cable, its posts
// and the pallet's hanger run along the pallet's back, the side away from the camera, so nothing hides Mnot.
// world.emit('gondola', { at, moving }) when it sets off and when it docks. A bot asks wait(pos) whether to hold
// back, and covers(pos) tells the jokes that a fall was a missed gondola.
import * as THREE from 'three';
import { Solid } from './world.js';
import { wood, rope } from '../props/wood.js';
import { toon } from '../look/look.js';

const METAL = '#5d6378';

// a and b: the middle of the pallet's top at either end (b is onwards). feet: where the cable's two posts stand.
// travel and pause in seconds; offset shifts it in its cycle. The camera is on the route's right, so the cable runs
// along the pallet's left.
export function gondola(world, a, b, feet, { size = [1.0, 0.9], travel = 3, pause = 1.8, offset = 0, hang = 2 } = {}) {
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  const right = new THREE.Vector3(-dir.z, 0, dir.x), back = right.clone().negate();
  const [along, across] = [size[0] / 2, size[1] / 2];
  const corner = (u, v) => ({ x: a.x + dir.x * u + right.x * v, z: a.z + dir.z * u + right.z * v });
  const solid = new Solid([corner(along, across), corner(-along, across), corner(-along, -across),
    corner(along, -across)], a.y, a.y - 0.16, 'gondola');
  solid.moving = true;
  world.solids.push(solid);

  // the pallet: slats across the way it goes, on two runners, and a hanger up its back to the trolley
  const group = new THREE.Group();
  group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  const slats = 5, slat = size[0] / slats;
  for (let i = 0; i < slats; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(slat - 0.025, 0.055, size[1]), wood('#b07a4a', 'z'));
    mesh.position.set(-along + slat * (i + 0.5), -0.028, 0);
    group.add(mesh);
  }
  for (const v of [-0.65, 0.65]) {
    const runner = new THREE.Mesh(new THREE.BoxGeometry(size[0], 0.07, 0.09), wood('#8a5a34', 'x'));
    runner.position.set(0, -0.09, v * across);
    group.add(runner);
  }
  // in the group, local +z is the route's right (towards the camera), so the back is -z
  const rear = -(across + 0.05);
  const bar = (from, to, radius, material) => {
    const length = from.distanceTo(to);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 7), material);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return mesh;
  };
  const metal = toon(METAL);
  const under = (u, y = -0.06) => new THREE.Vector3(u, y, rear);
  group.add(bar(under(-along * 0.8), under(along * 0.8), 0.03, metal));
  group.add(bar(under(0), under(0, hang - 0.12), 0.035, metal));
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.1), toon('#e23b2e'));
  trolley.position.set(0, hang - 0.02, rear);
  group.add(trolley);
  for (const u of [-0.1, 0.1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateX(Math.PI / 2), metal);
    wheel.position.set(u, hang + 0.05, rear);
    group.add(wheel);
  }
  for (const mesh of group.children) mesh.castShadow = true;
  world.group.add(group);

  // the cable, on the line the trolley runs along, from post to post; the posts stand on the ledges at feet
  const run = Math.hypot(b.x - a.x, b.z - a.z), slope = (b.y - a.y) / run;
  const off = back.clone().multiplyScalar(across + 0.05);
  const [ca, cb] = feet.map((foot) => {
    const k = new THREE.Vector3().subVectors(foot, a).dot(dir);
    return a.clone().addScaledVector(dir, k).add(off).setY(a.y + slope * k + hang + 0.05);
  });
  const cable = bar(ca, cb, 0.012, rope(ca.distanceTo(cb), '#3c3f4f'));
  world.group.add(cable);
  feet.forEach((foot, i) => {
    const top = i === 0 ? ca : cb;
    world.group.add(bar(top.clone().setY(foot.y - 0.05), top.clone().setY(top.y + 0.18), 0.05, wood('#8a5a34', 'y')));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12).rotateX(Math.PI / 2), metal);
    cap.position.copy(top);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), right);
    world.group.add(cap);
  });

  // the cycle: wait at a, glide to b, wait at b, glide back
  const cycle = 2 * (pause + travel), at = new THREE.Vector3(), point = new THREE.Vector3();
  let t = offset, phase = null;
  const state = (time) => {
    const p = ((time % cycle) + cycle) % cycle;
    if (p < pause) return { s: 0, docked: 'a', left: pause - p };
    if (p < pause + travel) return { s: ease((p - pause) / travel), docked: null };
    if (p < 2 * pause + travel) return { s: 1, docked: 'b', left: 2 * pause + travel - p };
    return { s: 1 - ease((p - 2 * pause - travel) / travel), docked: null };
  };
  const place = (s) => point.copy(a).lerp(b, s);
  place(state(t).s);
  solid.moveBy(point.x - a.x, point.y - a.y, point.z - a.z);
  group.position.copy(point);

  const mover = {
    kind: 'gondola',
    solid,
    state: () => state(t),
    // Set the gondola to an absolute elapsed time from route construction. Replay playback uses this to make the
    // pallet match the recorded run while watching, paused or scrubbed.
    seek(seconds, dt = 0) {
      const next = offset + Math.max(0, seconds);
      if (Math.abs(next - t) < 1e-9) return false;       // preserve the last frame's movement for a rider
      t = next;
      const now = state(t);
      place(now.s);
      solid.moveBy(point.x - group.position.x, point.y - group.position.y, point.z - group.position.z, dt);
      group.position.copy(point);
      phase = !now.docked;
      return true;
    },
    update(dt) {
      t += dt;
      const now = state(t);
      place(now.s);
      solid.moveBy(point.x - group.position.x, point.y - group.position.y, point.z - group.position.z, dt);
      group.position.copy(point);
      const moving = !now.docked;
      if (phase !== null && moving !== phase) world.emit('gondola', { at: at.copy(point), moving });
      phase = moving;
    },
    // Hold back: near a until it will be docked there by the time a run-up and a jump get there; on board until it
    // is docked at b for long enough to jump off.
    wait(pos) {
      const docked = (end, from, to) => state(t + from).docked === end && state(t + to).docked === end;
      if (onBoard(pos)) return !docked('b', 0, 0.6);
      const near = Math.hypot(pos.x - a.x, pos.z - a.z) < along + 1.6 && Math.abs(pos.y - a.y) < 0.6;
      return near && !docked('a', 0.6, 1.5);
    },
    covers(pos) {
      const rel = new THREE.Vector3().subVectors(pos, a), u = rel.dot(dir), length = Math.hypot(b.x - a.x, b.z - a.z);
      if (u < -along || u > length + along || pos.y > Math.max(a.y, b.y) + 1) return false;
      return Math.abs(rel.dot(right)) < across + 0.6;
    },
  };
  const onBoard = (pos) => solid.closest(pos.x, pos.z).d < 0.1 && Math.abs(pos.y - solid.top) < 0.3;
  world.animated.push(mover);
  world.hazards.push(mover);
  return mover;
}

const ease = u => 0.5 - 0.5 * Math.cos(Math.PI * u);
