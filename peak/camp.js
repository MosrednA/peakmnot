// Base camp, where the podcast records before the climb: a ridge tent with an open door and a sleeping bag peeking
// out, and the "om Tafel" table: two microphones facing each other, mugs (one still steaming), a thermos, a laptop
// covered in stickers, an ON AIR light and the show's banner, with two stools. Each piece returns its group.
import * as THREE from 'three';
import { toon, RAMPS } from './look.js';
import { wood } from './wood.js';
import { painted, letter, emblem, sticker, roundRect } from './paint.js';
import { faceMaterial, snowStrip, aim } from './signs.js';
import { feet } from './footing.js';

const ALU = '#c9d0db', INK = '#1d1d26';

function mesh(geometry, material, { x = 0, y = 0, z = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

// A thin rod from p to q.
function rod(p, q, radius, material) {
  const d = new THREE.Vector3().subVectors(q, p), m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 6), material);
  m.position.copy(p).lerp(q, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ the tent

// A ridge tent: its ridge along local Z, the door at +Z. The panels sag between the A-frame poles, the door flaps
// are rolled back, guy ropes run to pegs in the snow, and there's snow along the ridge.
export function tent(world, foot, yaw, { color = '#2f9c95' } = {}) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const W = 1.5, H = 1.28, L = 1.85;
  const cloth = toon(color, { side: THREE.DoubleSide });
  const ridge = z => H - 0.07 * (1 - (2 * z / L) ** 2);
  // the two roof panels, as grids that sag in the middle
  for (const side of [-1, 1]) {
    const nz = 10, nt = 6, positions = [], index = [];
    for (let i = 0; i <= nz; i++) {
      const z = -L / 2 + L * i / nz, edge = 1 - (2 * z / L) ** 2;
      for (let j = 0; j <= nt; j++) {
        const t = j / nt;
        const x = side * (W / 2) * t * (1 - 0.04 * edge * Math.sin(Math.PI * t));
        const y = ridge(z) * (1 - t) + 0.02 * t - 0.05 * edge * Math.sin(Math.PI * t);
        positions.push(x, y, z);
      }
    }
    for (let i = 0; i < nz; i++) {
      for (let j = 0; j < nt; j++) {
        const p = i * (nt + 1) + j;
        index.push(p, p + nt + 1, p + 1, p + 1, p + nt + 1, p + nt + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const panel = mesh(geometry, cloth);
    panel.receiveShadow = true;
    group.add(panel);
  }
  // the back, closed, and the front either side of the door
  const back = new THREE.Shape([new THREE.Vector2(-W / 2, 0.02), new THREE.Vector2(W / 2, 0.02), new THREE.Vector2(0, ridge(-L / 2))]);
  group.add(mesh(new THREE.ShapeGeometry(back), cloth, { z: -L / 2 }));
  const door = 0.42, top = ridge(L / 2);
  for (const side of [-1, 1]) {
    const s = new THREE.Shape([new THREE.Vector2(side * W / 2, 0.02), new THREE.Vector2(side * door, 0.02),
      new THREE.Vector2(side * 0.05, top - 0.12), new THREE.Vector2(0, top)]);
    group.add(mesh(new THREE.ShapeGeometry(s), cloth, { z: L / 2 }));
    // the door flap, rolled up and tied back
    group.add(rod(new THREE.Vector3(side * (door + 0.03), 0.08, L / 2 + 0.03),
      new THREE.Vector3(side * 0.09, top - 0.16, L / 2 + 0.03), 0.04, toon(color)));
  }
  // the dark inside, and a sleeping bag sticking out of the door
  const inside = new THREE.Shape([new THREE.Vector2(-door, 0.02), new THREE.Vector2(door, 0.02), new THREE.Vector2(0, top - 0.05)]);
  group.add(mesh(new THREE.ShapeGeometry(inside), toon('#2a2440', { outline: false }), { z: L / 2 - 0.35, shadow: false }));
  const bag = mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 10), toon('#f2b33d'), { x: 0.05, y: 0.11, z: L / 2 - 0.1 });
  bag.rotation.set(Math.PI / 2, 0, 0.12);
  bag.scale.set(1, 1, 0.55);
  const pillow = mesh(new THREE.SphereGeometry(0.13, 10, 6), toon('#f4ead2'), { x: 0.1, y: 0.13, z: L / 2 + 0.28 });
  pillow.scale.set(1.2, 0.45, 0.8);
  group.add(bag, pillow);
  // A-frame poles at both ends, crossing just above the ridge
  const pole = toon('#5a5f70');
  for (const z of [-L / 2 - 0.02, L / 2 + 0.02]) {
    for (const side of [-1, 1]) {
      group.add(rod(new THREE.Vector3(side * (W / 2 + 0.02), 0, z), new THREE.Vector3(-side * 0.05, ridge(z) + 0.1, z), 0.015, pole));
    }
  }
  // guy ropes and pegs: from both ends of the ridge, and from the middle of each side
  const guy = (from, to) => {
    group.add(rod(from, to, 0.006, toon('#f08a24', { outline: false })));
    group.add(rod(to.clone().setY(-0.05), to.clone().setY(0.07), 0.012, toon(ALU)));
  };
  guy(new THREE.Vector3(0, ridge(L / 2) + 0.05, L / 2 + 0.02), new THREE.Vector3(0, 0.03, L / 2 + 0.75));
  guy(new THREE.Vector3(0, ridge(-L / 2) + 0.05, -L / 2 - 0.02), new THREE.Vector3(0, 0.03, -L / 2 - 0.75));
  for (const side of [-1, 1]) {
    for (const z of [-L / 4, L / 4]) {
      guy(new THREE.Vector3(side * W * 0.3, H * 0.42, z), new THREE.Vector3(side * (W / 2 + 0.45), 0.03, z));
    }
  }
  // snow along the ridge
  const snow = snowStrip(L * 0.8, 0.12, 0.04, 3);
  snow.rotation.y = Math.PI / 2;
  snow.position.y = H - 0.055;
  group.add(snow);
  world.group.add(group);
  feet(group, [[0, L / 2 + 0.75], [0, -L / 2 - 0.75], [-W / 2 - 0.45, -L / 4], [-W / 2 - 0.45, L / 4],
    [W / 2 + 0.45, -L / 4], [W / 2 + 0.45, L / 4]], 'tent', 0.04);
  aim(world, group, yaw);
  return group;
}

// ------------------------------------------------------------------ the table

function laptopLid() {
  return painted(320, 220, (ctx, w, h) => {
    ctx.fillStyle = '#9aa3b2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, 0, w, h * 0.1);
    sticker(ctx, w * 0.3, h * 0.42, h * 0.2, { turn: -0.25 });
    sticker(ctx, w * 0.68, h * 0.6, h * 0.17, { face: true, color: '#3d8fd6', turn: 0.2 });
    ctx.save();
    ctx.translate(w * 0.72, h * 0.22);
    ctx.rotate(0.1);
    ctx.fillStyle = INK;
    roundRect(ctx, -w * 0.13, -h * 0.07, w * 0.26, h * 0.14, h * 0.03);
    ctx.fill();
    letter(ctx, '</>', 0, 0, { size: h * 0.1, color: '#7ee2a8' });
    ctx.restore();
    ctx.save();
    ctx.translate(w * 0.25, h * 0.8);
    ctx.rotate(-0.08);
    ctx.fillStyle = '#f2c14e';
    roundRect(ctx, -w * 0.14, -h * 0.065, w * 0.28, h * 0.13, h * 0.02);
    ctx.fill();
    letter(ctx, 'LGTM', 0, 0, { size: h * 0.09, color: INK });
    ctx.restore();
    letter(ctx, 'π', w * 0.5, h * 0.85, { size: h * 0.14, color: '#e23b2e' });
  });
}

function banner() {
  return painted(640, 150, (ctx, w, h) => {
    ctx.fillStyle = '#22304a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e23b2e';
    ctx.fillRect(0, 0, w, h * 0.08);
    emblem(ctx, w * 0.09, h * 0.55, h * 0.66, { can: '#e23b2e', ink: '#0e1422', lens: '#cfe8ff' });
    letter(ctx, 'MET NERDS OM TAFEL', w * 0.56, h * 0.47, { size: h * 0.36, color: '#ffffff', maxWidth: w * 0.78 });
    letter(ctx, 'live from base camp', w * 0.56, h * 0.82, { size: h * 0.15, color: '#f2c14e', weight: 500 });
  });
}

function onAir() {
  return painted(128, 56, (ctx, w, h) => {
    ctx.fillStyle = '#ff4a3a';
    ctx.fillRect(0, 0, w, h);
    letter(ctx, 'ON AIR', w / 2, h / 2 + 2, { size: h * 0.55, color: '#fff4e8' });
  });
}

// A folding camp table, top at 0.66 m, its long side along local X and its front (the banner) at +Z.
export function podcastTable(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const W = 1.0, D = 0.6, Y = 0.66;
  // the slatted top and its aluminium frame
  for (let i = 0; i < 7; i++) {
    const z = -D / 2 + (i + 0.5) * D / 7;
    group.add(mesh(new THREE.BoxGeometry(W, 0.025, D / 7 - 0.012), wood('#c99a62', 'x'), { y: Y, z }));
  }
  const alu = toon(ALU);
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
    group.add(rod(new THREE.Vector3(x, 0, -D / 2 + 0.05), new THREE.Vector3(x, Y - 0.02, D / 2 - 0.05), 0.012, alu));
    group.add(rod(new THREE.Vector3(x, 0, D / 2 - 0.05), new THREE.Vector3(x, Y - 0.02, -D / 2 + 0.05), 0.012, alu));
  }
  group.add(rod(new THREE.Vector3(-W / 2 + 0.06, Y / 2, 0), new THREE.Vector3(W / 2 - 0.06, Y / 2, 0), 0.01, alu));
  // the banner hanging from the front edge
  const cloth = mesh(new THREE.PlaneGeometry(W - 0.04, 0.23), faceMaterial(banner()), { y: Y - 0.13, z: D / 2 + 0.006 });
  cloth.material.side = THREE.DoubleSide;
  group.add(cloth);
  // two microphones on desk stands, facing each other across the table
  for (const [side, color] of [[-1, '#e23b2e'], [1, '#3d8fd6']]) {
    const mic = new THREE.Group();
    mic.position.set(side * 0.3, Y + 0.012, -0.14);
    mic.add(mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.015, 14), toon(INK)));
    mic.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), toon('#4a4f5c'), { y: 0.08 }));
    const head = new THREE.Group();
    head.position.y = 0.17;
    head.rotation.x = -0.7;                                // tilted towards whoever sits behind it
    head.add(mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.12, 12), toon('#2c2f3a'), { y: 0.05 }));
    const foam = mesh(new THREE.SphereGeometry(0.048, 12, 9), toon(color), { y: 0.12 });
    foam.scale.y = 1.15;
    head.add(foam);
    mic.add(head);
    group.add(mic);
  }
  // mugs, one of them steaming, a thermos and a laptop
  const mugs = [[-0.12, 0.17, '#f4ead2'], [0.38, 0.17, '#f2c14e']];
  for (const [x, z, color] of mugs) {
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.085, 12), toon(color), { x, y: Y + 0.055, z }));
    const handle = mesh(new THREE.TorusGeometry(0.022, 0.007, 5, 10), toon(color), { x: x + 0.04, y: Y + 0.058, z });
    group.add(handle);
    const coffee = mesh(new THREE.CircleGeometry(0.03, 12), toon('#5a3a22', { outline: false }), { x, y: Y + 0.094, z, shadow: false });
    coffee.rotation.x = -Math.PI / 2;
    group.add(coffee);
  }
  group.add(mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.24, 12), toon('#d7322a'), { x: 0.42, y: Y + 0.13, z: -0.18 }));
  group.add(mesh(new THREE.CylinderGeometry(0.046, 0.044, 0.07, 12), toon(ALU), { x: 0.42, y: Y + 0.285, z: -0.18 }));
  const laptop = new THREE.Group();
  laptop.position.set(0.02, Y + 0.013, 0.02);
  laptop.rotation.y = Math.PI + 0.12;               // its screen to the hosts, its stickers to us
  laptop.add(mesh(new THREE.BoxGeometry(0.3, 0.014, 0.21), toon('#7d8696'), { y: 0.007 }));
  const lid = new THREE.Group();
  lid.position.set(0, 0.014, -0.105);
  lid.rotation.x = -0.32;
  const lidBox = mesh(new THREE.BoxGeometry(0.3, 0.2, 0.01), [toon('#7d8696'), toon('#7d8696'), toon('#7d8696'),
    toon('#7d8696'), toon('#2a3a5a'), faceMaterial(laptopLid())], { y: 0.1 });
  lid.add(lidBox);
  laptop.add(lid);
  group.add(laptop);
  // the ON AIR light, glowing
  const light = new THREE.MeshToonMaterial({ map: onAir(), gradientMap: RAMPS.world, emissive: '#ffffff' });
  light.emissiveMap = light.map;
  light.emissiveIntensity = 0.9;
  light.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.004, alpha: 1 };
  const box = mesh(new THREE.BoxGeometry(0.15, 0.065, 0.05), [toon(INK), toon(INK), toon(INK), toon(INK), light, toon(INK)],
    { x: -0.4, y: Y + 0.045, z: -0.2 });
  box.rotation.y = 0.25;
  group.add(box);
  // two folding stools behind it: the hosts face the audience
  for (const side of [-1, 1]) {
    const stool = new THREE.Group();
    stool.position.set(side * 0.3, 0, -0.55);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + 0.3;
      stool.add(rod(new THREE.Vector3(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17),
        new THREE.Vector3(-Math.cos(a) * 0.08, 0.4, -Math.sin(a) * 0.08), 0.011, alu));
    }
    const seat = mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.03, 3), toon(side < 0 ? '#e23b2e' : '#3d8fd6'), { y: 0.41 });
    seat.rotation.y = 0.3;
    stool.add(seat);
    group.add(stool);
  }
  world.group.add(group);
  feet(group, [[-0.44, -0.25], [0.44, -0.25], [-0.44, 0.25], [0.44, 0.25], [-0.3, -0.55], [0.3, -0.55]], 'podcast table',
    0.17);
  aim(world, group, yaw);
  steam(world, group, new THREE.Vector3(-0.12, Y + 0.1, 0.17));
  return group;
}

// Little puffs rising from a mug and fading.
function steam(world, parent, at) {
  const material = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: RAMPS.world, transparent: true,
    opacity: 0.6, depthWrite: false });
  material.userData.outlineParameters = { visible: false };
  const puffs = Array.from({ length: 4 }, (_, i) => {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), material.clone());
    puff.userData = { t: i / 4, noFade: true };
    parent.add(puff);
    return puff;
  });
  world.animated.push({
    update(dt, time) {
      for (const puff of puffs) {
        puff.userData.t = (puff.userData.t + dt * 0.45) % 1;
        const t = puff.userData.t;
        puff.position.set(at.x + 0.015 * Math.sin(time * 2 + t * 9), at.y + t * 0.22, at.z + 0.01 * Math.cos(time * 1.7 + t * 7));
        puff.scale.setScalar(0.6 + 1.6 * t);
        puff.material.opacity = 0.55 * Math.sin(Math.PI * t);
      }
    },
  });
}
