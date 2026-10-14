// Office furniture, out on the mountain: the cheap chairs that stand as bowling pins (and loaf about the office at
// the bottom), filing cabinets, water coolers, potted plants, desks and a printer. Each is built from a few
// vertex-coloured pieces merged into one mesh per part, so a soft one can fly apart into its parts (obstacles.js
// throws them as debris) and the whole office costs few draw calls. Every piece of furniture stands on its own
// origin, front to +z, except the knock-off chair, which turns about its middle (bowling.js tumbles it).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon, RAMPS } from '../look/look.js';
import { painted, letter } from '../props/paint.js';

export const KNOCKOFF = { height: 1, middle: 0.45, radius: 0.3, price: '€49' };

const INK = '#2a2c33', SNOW = '#ffffff';

// One piece in one colour, turned and moved into place, ready to merge with the others.
function piece(geometry, color, x = 0, y = 0, z = 0, turn = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  if (turn) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn)));
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// The pieces as one mesh, in the shared vertex-coloured toon material.
function solid(pieces) {
  const mesh = new THREE.Mesh(mergeGeometries(pieces), toon('#ffffff', { vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const box = (w, h, d, r = 0) => r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);

// The knock-off: a five-star base on little casters, a bare gas lift, a seat and a back, in white with a red band
// round the back like a bowling pin's. About its middle, KNOCKOFF.middle above the floor.
export function knockoff() {
  const p = [], y = -KNOCKOFF.middle, white = '#fbf6ec', red = '#d0352a', grey = '#9aa0ab';
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, leg = box(0.035, 0.03, 0.25);
    leg.translate(0, 0, 0.125);
    p.push(piece(leg, INK, 0, y + 0.07, 0, [0, a, 0]));
    p.push(piece(new THREE.SphereGeometry(0.033, 8, 6), INK, Math.sin(a) * 0.25, y + 0.033, Math.cos(a) * 0.25));
  }
  p.push(piece(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 10), INK, 0, y + 0.08, 0));
  p.push(piece(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), grey, 0, y + 0.26, 0));
  p.push(piece(box(0.46, 0.08, 0.44, 0.03), white, 0, y + 0.46, 0));
  p.push(piece(box(0.05, 0.3, 0.04), INK, 0, y + 0.6, -0.21));
  p.push(piece(box(0.42, 0.13, 0.06, 0.02), white, 0, y + 0.7, -0.23));
  p.push(piece(box(0.43, 0.06, 0.064), red, 0, y + 0.79, -0.23));
  p.push(piece(box(0.42, 0.15, 0.06, 0.02), white, 0, y + 0.9, -0.23));
  const mesh = solid(p);
  mesh.name = 'knock-off chair';
  return mesh;
}

// A filing cabinet, three drawers, with a cap of snow from standing out here.
export function cabinet() {
  const p = [], body = '#8f98ab', front = '#a7b0c2';
  p.push(piece(box(0.5, 1.3, 0.6, 0.02), body, 0, 0.65, 0));
  for (const y of [0.24, 0.65, 1.06]) {
    p.push(piece(box(0.44, 0.37, 0.02), front, 0, y, 0.3));
    p.push(piece(box(0.15, 0.03, 0.03), INK, 0, y + 0.1, 0.32));
    p.push(piece(box(0.1, 0.05, 0.006), SNOW, 0, y + 0.02, 0.312));
  }
  p.push(piece(box(0.53, 0.07, 0.63, 0.03), SNOW, 0, 1.33, 0));
  return group(solid(p), { radius: 0.4, height: 1.36 });
}

// A water cooler: a white stand with taps, and the blue bottle upside down on top. Two parts, for when it bursts.
export function cooler() {
  const stand = [], bottle = [];
  stand.push(piece(box(0.34, 0.86, 0.34, 0.03), '#f4f6fa', 0, 0.43, 0));
  stand.push(piece(box(0.2, 0.03, 0.12), '#9aa0ab', 0, 0.5, 0.2));
  stand.push(piece(box(0.04, 0.05, 0.05), '#3d8fe0', -0.05, 0.62, 0.19));
  stand.push(piece(box(0.04, 0.05, 0.05), '#e23b2e', 0.05, 0.62, 0.19));
  bottle.push(piece(new THREE.CylinderGeometry(0.15, 0.15, 0.36, 14), '#7fc3f0', 0, 0.18, 0));
  bottle.push(piece(new THREE.CylinderGeometry(0.15, 0.06, 0.08, 14), '#7fc3f0', 0, -0.04, 0));
  bottle.push(piece(new THREE.CylinderGeometry(0.153, 0.153, 0.04, 14), '#a8d8f7', 0, 0.26, 0));
  const top = solid(bottle);
  top.position.y = 0.94;
  top.userData.radius = 0.15;
  const base = solid(stand);
  base.userData.radius = 0.2;
  return group([base, top], { radius: 0.3, height: 1.34 });
}

// A potted plant: a clay pot, and a ficus of three green clumps on a crooked stem. The pot and the plant come apart.
export function ficus(rand) {
  const pot = [], plant = [];
  pot.push(piece(new THREE.CylinderGeometry(0.21, 0.15, 0.34, 12), '#c9673f', 0, 0.17, 0));
  pot.push(piece(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 12), '#d97a4f', 0, 0.33, 0));
  pot.push(piece(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 12), '#6b4a33', 0, 0.335, 0));
  plant.push(piece(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 6), '#7a5236', 0, 0.3, 0, [0, 0, 0.12]));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + rand(), r = 0.2 + 0.06 * rand();
    plant.push(piece(new THREE.IcosahedronGeometry(r, 0), i % 2 ? '#3f8a4c' : '#4f9a4a',
      Math.cos(a) * 0.13, 0.55 + 0.17 * i, Math.sin(a) * 0.13));
  }
  const leaves = solid(plant);
  leaves.position.y = 0.32;
  leaves.userData.radius = 0.25;
  const base = solid(pot);
  base.userData.radius = 0.2;
  return group([base, leaves], { radius: 0.3, height: 1.25 });
}

// A desk: a wooden top on grey legs, a monitor (still on: the screensaver is Mnot's blue), a keyboard and a mug.
// The snow has settled on the monitor.
export function desk() {
  const p = [], wood = '#d8b98a', grey = '#8f98ab';
  p.push(piece(box(1.4, 0.05, 0.7, 0.015), wood, 0, 0.74, 0));
  for (const x of [-0.64, 0.64]) for (const z of [-0.29, 0.29]) p.push(piece(box(0.05, 0.72, 0.05), grey, x, 0.36, z));
  p.push(piece(box(0.06, 0.18, 0.06), INK, 0.1, 0.85, -0.18));
  p.push(piece(box(0.22, 0.02, 0.16), INK, 0.1, 0.775, -0.18));
  p.push(piece(box(0.56, 0.34, 0.04, 0.012), INK, 0.1, 1.07, -0.16));
  p.push(piece(box(0.5, 0.28, 0.01), '#4aa8f0', 0.1, 1.07, -0.137));
  p.push(piece(box(0.58, 0.04, 0.08, 0.015), SNOW, 0.1, 1.255, -0.16));
  p.push(piece(box(0.44, 0.02, 0.15, 0.006), '#4a4d57', 0.1, 0.775, 0.12));
  p.push(piece(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 10), '#e23b2e', -0.45, 0.815, 0.08));
  return group(solid(p), { radius: 0.7, height: 1.28 });
}

// A printer on its little cupboard, a sheet half out of it, and a note taped on: it has been like this for weeks.
export function printer() {
  const p = [], light = '#d6dae2', grey = '#8f98ab';
  p.push(piece(box(0.6, 0.6, 0.5, 0.02), grey, 0, 0.3, 0));
  p.push(piece(box(0.56, 0.3, 0.46, 0.03), light, 0, 0.75, 0));
  p.push(piece(box(0.4, 0.02, 0.06), INK, 0, 0.8, 0.23));
  p.push(piece(box(0.3, 0.005, 0.22), SNOW, 0, 0.81, 0.33, [-0.35, 0, 0]));
  p.push(piece(box(0.05, 0.03, 0.02), '#e23b2e', 0.2, 0.86, 0.23));
  p.push(piece(box(0.58, 0.05, 0.48, 0.02), SNOW, 0, 0.92, 0));
  const note = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshToonMaterial({ gradientMap: RAMPS.world,
    map: painted(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#fff3a8';
      ctx.fillRect(0, 0, w, h);
      letter(ctx, 'OUT OF\nORDER', w / 2, h / 2, { size: 44, color: '#d0352a', maxWidth: w * 0.85 });
    }) }));
  note.material.userData.outlineParameters = { visible: false };
  note.position.set(0, 0.42, 0.252);
  note.rotation.z = 0.06;
  return group([solid(p), note], { radius: 0.42, height: 0.95 });
}

// The furniture in a group, with what the collisions need to know: how wide (radius) and how tall. A soft piece's
// parts are what flies when it bursts.
function group(parts, { radius, height }) {
  const g = new THREE.Group();
  for (const part of [parts].flat()) g.add(part);
  g.userData = { parts: [parts].flat().filter(o => o.userData.radius), radius, height };
  return g;
}
