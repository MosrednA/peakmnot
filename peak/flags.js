// Flags: the checkpoint flags (Mnot's emblem on slate blue, raised in red once reached), the summit flag in its
// cairn, with a gold fringe, a golden can on top and an altitude plaque, and strings of pennants that show the wind.
// They flutter at their own pace: the wave's phase is summed up frame by frame and the wind they feel is eased, so a
// gust swells them in smoothly. Their feet are checked to stand on rock (footing.js).
import * as THREE from 'three';
import { toon, RAMPS } from './look.js';
import { post, tube } from './beams.js';
import { painted, emblem, letter, nail } from './paint.js';
import { feet } from './footing.js';
import { faceMaterial } from './signs.js';

const RED = '#e23b2e', SLATE = '#8fa5bf';

// The cloth: weave, a hem at the pole with stitches, and the emblem.
function clothTexture(color, { can = '#ffffff', title = null, fringe = false, w = 256, h = 170 } = {}) {
  return painted(w, h, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    for (let i = -h; i < w; i += 5) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(0, 0, w * 0.07, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.setLineDash([h * 0.03, h * 0.025]);
    ctx.lineWidth = Math.max(1, h * 0.012);
    ctx.beginPath(); ctx.moveTo(w * 0.085, 0); ctx.lineTo(w * 0.085, h); ctx.stroke();
    ctx.setLineDash([]);
    if (title) {
      emblem(ctx, w * 0.27, h * 0.5, h * 0.68, { can });
      letter(ctx, title, w * 0.64, h * 0.5, { size: h * 0.27, color: '#ffffff', maxWidth: w * 0.5, line: 1.0,
        outline: 'rgba(90, 10, 10, 0.55)' });
    } else {
      emblem(ctx, w * 0.54, h * 0.5, h * 0.7, { can });
    }
    if (fringe) {
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(w * 0.955, 0, w * 0.045, h);
      ctx.fillStyle = '#b8862a';
      for (let y = 0; y < h; y += h / 14) ctx.fillRect(w * 0.962, y, w * 0.006, h / 28);
    }
  });
}

// Both sides of the cloth show the print the right way round, so the lettering reads whichever way it blows.
function clothMaterial(texture) {
  const material = new THREE.MeshToonMaterial({ map: texture, gradientMap: RAMPS.world, side: THREE.DoubleSide });
  material.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.003, alpha: 1 };
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('vMapUv', 'vec2(gl_FrontFacing ? vMapUv.x : 1.0 - vMapUv.x, vMapUv.y)'));
  };
  material.customProgramCacheKey = () => 'cloth';
  return material;
}

// A cloth on a pole, width × height, its left edge on the pole. update(dt, strength) ripples it.
function cloth(width, height, material) {
  const geometry = new THREE.PlaneGeometry(width, height, 12, 4);
  geometry.translate(width / 2, -height / 2, 0);
  const rest = geometry.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.userData.moving = true;
  const waves = 1.1 * Math.PI * 2 / Math.max(0.6, width);     // about one wave along the cloth
  let phase = Math.random() * 6, felt = 0.3;
  mesh.update = (dt, strength) => {
    felt = THREE.MathUtils.damp(felt, strength, 2.5, dt);     // the cloth takes ~0.4 s to fill with a gust
    phase += dt * Math.PI * 2 * (0.6 + 1.9 * felt);           // 0.6 Hz when calm, 2.5 Hz in a strong gust
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = rest[i], y = rest[i + 1], k = x / width;
      const ripple = Math.sin(x * waves - phase) + 0.3 * Math.sin(x * waves * 1.7 - phase * 1.6 + y * 4);
      pos[i + 2] = k * (0.05 + 0.1 * felt) * width * ripple;
      pos[i + 1] = y - k * k * 0.3 * height * (1 - felt);    // droops when the air is still
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  return mesh;
}

// The cloth turns to blow downwind.
function blowWith(pivot, wind, dt) {
  if (wind.strength < 0.02) return;
  const yaw = Math.atan2(-wind.dir.z, wind.dir.x);
  let d = yaw - pivot.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  pivot.rotation.y += d * (1 - Math.exp(-2 * dt));
}

// A few stones round a pole's foot, to hold it up.
function footStones(group, radius, seed = 1) {
  for (let i = 0; i < 4; i++) {
    const a = seed + i * 1.7, r = radius * (0.55 + 0.2 * Math.sin(seed * 3 + i));
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), toon(i % 2 ? '#9a9db0' : '#a9a5b4'));
    stone.scale.set(r * 0.9, r * 0.55, r * 0.75);
    stone.rotation.set(i, a, 0);
    stone.position.set(Math.cos(a) * radius, r * 0.3, Math.sin(a) * radius);
    stone.castShadow = true;
    group.add(stone);
  }
}

// A stack of flat stones, size across at the bottom (a cairn; decor.js has them along the route too).
export function stoneStack(size = 0.4, count = 4) {
  const group = new THREE.Group();
  let y = 0;
  for (let i = 0; i < count; i++) {
    const r = size * (1 - i / (count + 1)) * 0.5, h = r * 0.55;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), toon(i % 2 ? '#9a9db0' : '#aaa6b6'));
    stone.scale.set(r, h, r * 0.9);
    stone.rotation.set(0.15 * Math.sin(i * 2.1), i * 1.7, 0.1 * Math.cos(i * 1.3));
    stone.position.set(0.02 * Math.sin(i * 2.4), y + h * 0.8, 0.02 * Math.cos(i * 1.9));
    stone.castShadow = true;
    y += h * 1.5;
    group.add(stone);
  }
  return group;
}

let flags = 0;

export function checkpointFlag(world, foot) {
  const seed = ++flags;
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 2.0, 8), toon('#d8dde6'));
  pole.position.y = 0.94;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), toon('#f2c14e'));
  knob.position.y = 1.97;
  const halyard = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.9, 4), toon('#f4ead2', { outline: false }));
  halyard.position.set(0.035, 0.99, 0);
  const pivot = new THREE.Group();
  const calm = clothMaterial(clothTexture(SLATE, { can: '#eef3f9' }));
  const proud = clothMaterial(clothTexture(RED));
  const flag = cloth(0.72, 0.48, calm);
  pivot.add(flag);
  group.add(pole, knob, halyard, pivot);
  footStones(group, 0.13, seed);
  pole.castShadow = knob.castShadow = true;
  world.group.add(group);
  feet(group, [[0, 0]], `checkpoint flag ${seed}`, 0.2);
  let raise = 0, active = false;
  const object = {
    group,
    get active() { return active; },
    activate() {
      if (active) return false;
      active = true;
      flag.material = proud;
      return true;
    },
    reset() { active = false; flag.material = calm; },
    update(dt, time, weather) {
      const wind = weather.windAt(foot);
      raise = THREE.MathUtils.damp(raise, active ? 1 : 0.45, 3, dt);
      pivot.position.y = 0.62 + 1.28 * raise;
      blowWith(pivot, wind, dt);
      flag.update(dt, wind.strength);
    },
  };
  world.animated.push(object);
  return object;
}

// A little enamel plate for the summit pole: the name, and the height, roughly.
function plaque() {
  const w = 0.44, h = 0.26;
  const front = painted(264, 156, (ctx, W, H) => {
    ctx.fillStyle = '#1f4f8f';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f4ead2';
    ctx.lineWidth = H * 0.035;
    ctx.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
    letter(ctx, 'PEAK MNOT', W / 2, H * 0.38, { size: H * 0.23, color: '#ffffff', maxWidth: W * 0.78 });
    letter(ctx, '4,810 m (ish)', W / 2, H * 0.68, { size: H * 0.16, color: '#f2c14e', maxWidth: W * 0.78 });
    for (const x of [H * 0.17, W - H * 0.17]) nail(ctx, x, H * 0.5, H * 0.035);
  });
  const metal = toon('#aab3c2');
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), [metal, metal, metal, metal, faceMaterial(front), metal]);
  plate.castShadow = true;
  return plate;
}

// The summit: a tall pole in a cairn, a big flag with a gold fringe, a golden can with glasses on top and a plaque.
// yaw is the way the can and the plaque face (the summit camera); the flag itself blows with the wind.
export function summitFlag(world, foot, { yaw = 0, height = 2.5 } = {}) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, height, 10), toon('#d8dde6'));
  pole.position.y = height / 2;
  const holder = new THREE.Group();
  holder.rotation.y = yaw;
  const sign = plaque();
  sign.position.set(0, 1.3, 0.055);
  holder.add(stoneStack(0.8, 5), sign);
  const trophy = new THREE.Group();
  trophy.position.y = height + 0.1;
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.19, 14), toon('#f2c14e'));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), toon('#d9a53a'));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.095;
  trophy.add(can, rim);
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 4), toon('#1d1d26'));
    lens.rotation.z = Math.PI / 4;
    lens.position.set(side * 0.034, 0.025, 0.068);
    trophy.add(lens);
  }
  const pivot = new THREE.Group();
  pivot.position.y = height - 0.06;
  const flag = cloth(1.3, 0.82, clothMaterial(clothTexture(RED, { title: 'PEAK\nMNOT', fringe: true, w: 512, h: 324 })));
  pivot.add(flag);
  group.add(pole, holder, trophy, pivot);
  pole.castShadow = can.castShadow = true;
  world.group.add(group);
  feet(group, [[0, 0]], 'summit flag', 0.3);
  let spin = 0;
  const object = {
    group,
    update(dt, time, weather) {
      const wind = weather.windAt(foot);
      blowWith(pivot, wind, dt);
      flag.update(dt, Math.max(0.35, wind.strength));
      spin += dt * 0.6;
      trophy.rotation.y = yaw + 0.4 * Math.sin(spin);     // the can turns to look round, now and then
      trophy.position.y = height + 0.1 + 0.015 * Math.sin(spin * 2.3);
    },
  };
  world.animated.push(object);
  return object;
}

// A string of little pennants between two posts. They flutter with the wind, so you can see a gust coming.
// posts: which ends get a post; an end without one is tied to something already standing there (a flag pole).
export function pennants(world, a, b, { colors = [RED, '#f2c14e', '#ffffff', '#3d8fd6'], posts = [true, true] } = {}) {
  const root = new THREE.Group();
  root.userData.fade = true;
  world.group.add(root);
  const pa = a.clone().setY(a.y + 1.3), pb = b.clone().setY(b.y + 1.3);
  const ends = [a, b].filter((p, i) => posts[i]);
  for (const p of ends) root.add(post(p, 1.4, 0.035));
  feet(root, ends.map(p => [p.x, p.y, p.z]), 'pennants', 0.05);
  const points = [], count = Math.max(3, Math.round(pa.distanceTo(pb) / 0.32));
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push(pa.clone().lerp(pb, t).setY(pa.y + (pb.y - pa.y) * t - 0.25 * Math.sin(Math.PI * t)));
  }
  const line = new THREE.CatmullRomCurve3(points);
  root.add(tube(points, 0.008));
  const flags = [], across = new THREE.Vector3(-(pb.z - pa.z), 0, pb.x - pa.x).normalize();
  for (let i = 1; i < count; i++) {
    const p = line.getPointAt(i / count);
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.09, 0, 0),
      new THREE.Vector3(0.09, 0, 0), new THREE.Vector3(0, -0.2, 0)]);
    geometry.computeVertexNormals();
    const flag = new THREE.Mesh(geometry, toon(colors[i % colors.length], { side: THREE.DoubleSide, outline: false }));
    flag.position.copy(p);
    flag.lookAt(p.clone().add(across));      // local X runs along the string, local Z across it
    flag.userData = { phase: i * 0.9, rest: flag.quaternion.clone(), moving: true };
    flags.push(flag);
    root.add(flag);
  }
  const swing = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), middle = pa.clone().lerp(pb, 0.5);
  let phase = 0, felt = 0, side = 1;
  const object = {
    update(dt, time, weather) {
      const wind = weather.windAt(middle);
      // a turn about the string lifts the pennants downwind
      const toward = wind.dir.dot(across);
      felt = THREE.MathUtils.damp(felt, wind.strength * Math.abs(toward), 2.5, dt);
      if (Math.abs(toward) > 0.2) side = Math.sign(toward);
      phase += dt * Math.PI * 2 * (0.8 + 2.2 * felt);
      for (const flag of flags) {
        const angle = -side * (0.1 + 1.1 * felt) + 0.25 * (0.3 + felt) * Math.sin(phase + flag.userData.phase);
        flag.quaternion.copy(flag.userData.rest).multiply(swing.setFromAxisAngle(X, angle));
      }
    },
  };
  world.animated.push(object);
  return object;
}
