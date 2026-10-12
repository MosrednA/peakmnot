// Props along the route: checkpoint flags, the summit flag, signs, a tent, cairns and strings of pennants that show
// the wind. Each returns its object; the ones that move are in world.animated with an update(dt, time, weather).
import * as THREE from 'three';
import { toon } from './look.js';

const RED = '#e23b2e';

// A small cloth on a pole that flaps in the wind. width × height, split so it can ripple.
function cloth(width, height, color) {
  const geometry = new THREE.PlaneGeometry(width, height, 8, 3);
  geometry.translate(width / 2, -height / 2, 0);
  const rest = geometry.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geometry, toon(color, { side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.update = (time, strength) => {
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = rest[i], k = x / width;
      pos[i + 2] = k * (0.08 + 0.12 * strength) * Math.sin(x * 9 - time * (5 + 9 * strength)) * width;
      pos[i + 1] = rest[i + 1] - k * k * 0.25 * height * (1 - strength);   // droops when the air is still
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
  pivot.rotation.y += d * (1 - Math.exp(-3 * dt));
}

export function checkpointFlag(world, foot) {
  const group = new THREE.Group();
  group.position.copy(foot);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.9, 8), toon('#d8dde6'));
  pole.position.y = 0.95;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#f2c14e'));
  knob.position.y = 1.92;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.12, 9), toon('#6d6f86'));
  base.position.y = 0.04;
  const pivot = new THREE.Group();
  pivot.position.y = 1.85;
  const flag = cloth(0.7, 0.45, '#9fb3c8');
  pivot.add(flag);
  group.add(pole, knob, base, pivot);
  for (const m of [pole, knob, base]) m.castShadow = true;
  world.group.add(group);
  let raise = 0, active = false;
  const object = {
    group,
    get active() { return active; },
    activate() {
      if (active) return false;
      active = true;
      flag.material = toon(RED, { side: THREE.DoubleSide });
      return true;
    },
    reset() { active = false; flag.material = toon('#9fb3c8', { side: THREE.DoubleSide }); },
    update(dt, time, weather) {
      const wind = weather.windAt(foot);
      raise = THREE.MathUtils.damp(raise, active ? 1 : 0.45, 3, dt);
      pivot.position.y = 0.6 + 1.25 * raise;
      blowWith(pivot, wind, dt);
      flag.update(time, wind.strength);
    },
  };
  world.animated.push(object);
  return object;
}

export function summitFlag(world, foot) {
  const group = new THREE.Group();
  group.position.copy(foot);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.2, 8), toon('#d8dde6'));
  pole.position.y = 1.6;
  const pivot = new THREE.Group();
  pivot.position.y = 3.1;
  const flag = cloth(1.5, 0.9, RED);
  pivot.add(flag);
  const stones = cairn(world, foot.clone(), 0.9, 4);
  group.add(pole, pivot);
  pole.castShadow = true;
  world.group.add(group);
  const object = {
    group, stones,
    update(dt, time, weather) {
      const wind = weather.windAt(foot);
      blowWith(pivot, wind, dt);
      flag.update(time, Math.max(0.45, wind.strength));
    },
  };
  world.animated.push(object);
  return object;
}

// A flat panel with text, drawn on a canvas.
export function sign(text, { width = 1, height = 0.5, background = '#f4ead2', color = '#4a3424', size = 48 } = {}) {
  const canvas = document.createElement('canvas');
  const scale = 256 / height;
  canvas.width = Math.round(width * scale);
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  ctx.font = `700 ${size * 2}px system-ui, "Segoe UI", sans-serif`;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 2.3);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.userData.outlineParameters = { visible: false };
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

// A wooden sign on a post, facing yaw (radians, 0 = facing +Z).
export function signpost(world, foot, yaw, text, options = {}) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.rotation.y = yaw;
  const width = options.width ?? 1.1, height = options.height ?? 0.5;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 7), toon('#8a5a34'));
  post.position.y = 0.6;
  const board = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.05), toon('#a8743f'));
  board.position.y = 1.1;
  const face = sign(text, { width, height, ...options });
  face.position.set(0, 1.1, 0.028);
  group.add(post, board, face);
  post.castShadow = board.castShadow = true;
  world.group.add(group);
  return group;
}

export function tent(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.rotation.y = yaw;
  const shape = new THREE.Shape([new THREE.Vector2(-0.8, 0), new THREE.Vector2(0.8, 0), new THREE.Vector2(0, 1.05)]);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false }), toon('#f08a24'));
  body.position.z = -0.8;
  const door = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.28, 0),
    new THREE.Vector2(0.28, 0), new THREE.Vector2(0, 0.6)])), toon('#4a3a5a', { outline: false }));
  door.position.z = 0.805;
  group.add(body, door);
  body.castShadow = true;
  world.group.add(group);
  return group;
}

// A stack of flat stones.
export function cairn(world, foot, size = 0.4, count = 4) {
  const group = new THREE.Group();
  group.position.copy(foot);
  let y = 0;
  for (let i = 0; i < count; i++) {
    const r = size * (1 - i / (count + 1)) * 0.5, h = r * 0.55;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), toon('#9a9db0'));
    stone.scale.set(r, h, r * 0.9);
    stone.rotation.y = i * 1.7;
    stone.position.y = y + h * 0.8;
    stone.castShadow = true;
    y += h * 1.5;
    group.add(stone);
  }
  world.group.add(group);
  return group;
}

// A string of little pennants between two posts. They flutter with the wind, so you can see a gust coming.
export function pennants(world, a, b, colors = [RED, '#f2c14e', '#ffffff', '#3d8fd6']) {
  const pa = a.clone().setY(a.y + 1.3), pb = b.clone().setY(b.y + 1.3);
  world.post(a, 1.4, 0.035);
  world.post(b, 1.4, 0.035);
  const points = [], count = Math.max(3, Math.round(pa.distanceTo(pb) / 0.32));
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push(pa.clone().lerp(pb, t).setY(pa.y + (pb.y - pa.y) * t - 0.25 * Math.sin(Math.PI * t)));
  }
  const line = new THREE.CatmullRomCurve3(points);
  world.ropeMesh(points, 0.008);
  const flags = [], across = new THREE.Vector3(-(pb.z - pa.z), 0, pb.x - pa.x).normalize();
  for (let i = 1; i < count; i++) {
    const p = line.getPointAt(i / count);
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.09, 0, 0),
      new THREE.Vector3(0.09, 0, 0), new THREE.Vector3(0, -0.2, 0)]);
    geometry.computeVertexNormals();
    const flag = new THREE.Mesh(geometry, toon(colors[i % colors.length], { side: THREE.DoubleSide, outline: false }));
    flag.position.copy(p);
    flag.lookAt(p.clone().add(across));      // local X runs along the string, local Z across it
    flag.userData = { phase: i * 0.9, rest: flag.quaternion.clone() };
    flags.push(flag);
    world.group.add(flag);
  }
  const swing = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), middle = pa.clone().lerp(pb, 0.5);
  const object = {
    update(dt, time, weather) {
      const wind = weather.windAt(middle);
      // a turn about the string lifts the pennants downwind
      const s = wind.strength * Math.abs(wind.dir.dot(across)), side = Math.sign(wind.dir.dot(across)) || 1;
      for (const flag of flags) {
        const angle = -side * (0.1 + 1.1 * s) + 0.25 * (0.3 + s) * Math.sin(time * (4 + 8 * s) + flag.userData.phase);
        flag.quaternion.copy(flag.userData.rest).multiply(swing.setFromAxisAngle(X, angle));
      }
    },
  };
  world.animated.push(object);
  return object;
}
