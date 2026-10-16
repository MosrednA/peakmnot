// The plaza the cans meet on: a round of trodden snow on a shoulder of the mountain, a knee-high snow wall round it
// (sim.js PLAZA), three snowmen in big glasses who were here first (sim.js SNOWMEN), and a sign with the house rules.
import * as THREE from 'three';
import { toon } from '../look/look.js';
import { painted, planks, letter } from '../props/paint.js';
import { PLAZA, SNOWMEN, MAX_PLAYERS } from './sim.js';

const SNOW = '#f4f7ff', INK = '#2b3352';
const WALL = { h: 0.55, width: 1.1 };             // the snow wall round the plaza: how high, how wide at its foot (m)

export function buildPlaza(scene) {
  const group = new THREE.Group();
  group.name = 'the plaza';
  const snow = new THREE.Mesh(new THREE.CircleGeometry(70, 72).rotateX(-Math.PI / 2), toon(SNOW));
  snow.receiveShadow = true;
  snow.name = 'the snow';
  group.add(snow);
  // the trodden round inside the wall, a shade bluer
  const floor = new THREE.Mesh(new THREE.CircleGeometry(PLAZA.radius, 72).rotateX(-Math.PI / 2), toon('#e6edfb'));
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  group.add(floor);

  // the wall: a lathe of a soft mound, its inside face at PLAZA.radius, a little lumpy along the way round
  const r0 = PLAZA.radius, profile = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, a = t * Math.PI;
    profile.push(new THREE.Vector2(r0 + WALL.width * (1 - Math.cos(a)) / 2, WALL.h * Math.sin(a) ** 0.8));
  }
  const ring = new THREE.LatheGeometry(profile.reverse(), 96);   // outside in, so its faces look up and out
  const pos = ring.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const turn = Math.atan2(v.z, v.x);
    v.y *= 1 + 0.18 * Math.sin(turn * 7) * Math.sin(turn * 3 + 1);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  ring.computeVertexNormals();
  const wall = new THREE.Mesh(ring, toon(SNOW));
  wall.castShadow = wall.receiveShadow = true;
  wall.name = 'the snow wall';
  group.add(wall);

  for (const [i, s] of SNOWMEN.entries()) group.add(snowman(s, i));
  group.add(sign());
  scene.add(group);
  return group;
}

const SCARVES = ['#e23b2e', '#22a98f', '#ffc23d'];

// a snowman of three balls, coal eyes behind big round glasses (Mnot's), a carrot and a scarf, facing the middle
function snowman({ x, z, r }, i) {
  const man = new THREE.Group();
  man.name = 'a snowman';
  const white = toon(SNOW), ink = toon(INK), carrot = toon('#ff8a3d'), scarf = toon(SCARVES[i % SCARVES.length]);
  const balls = [[r, r * 0.85], [r * 0.72, r * 2.05], [r * 0.52, r * 2.95]];
  for (const [size, y] of balls) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), white);
    ball.position.y = y;
    ball.castShadow = ball.receiveShadow = true;
    man.add(ball);
  }
  const [hr, hy] = [balls[2][0], balls[2][1]];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), ink);
    eye.position.set(side * hr * 0.36, hy + hr * 0.18, hr * 0.9);
    const lens = new THREE.Mesh(new THREE.TorusGeometry(hr * 0.3, 0.022, 6, 20), ink);
    lens.position.set(side * hr * 0.36, hy + hr * 0.18, hr * 0.98);
    man.add(eye, lens);
  }
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, hr * 0.14, 6).rotateZ(Math.PI / 2), ink);
  bridge.position.set(0, hy + hr * 0.2, hr * 1.0);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 10).rotateX(Math.PI / 2), carrot);
  nose.position.set(0, hy - hr * 0.08, hr * 1.05);
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(balls[1][0] * 0.78, 0.07, 8, 24).rotateX(Math.PI / 2), scarf);
  wrap.position.y = hy - hr * 0.85;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.05), scarf);
  tail.position.set(balls[1][0] * 0.55, hy - hr * 1.25, balls[1][0] * 0.62);
  tail.rotation.z = 0.25;
  for (const m of [nose, wrap, tail]) m.castShadow = true;
  man.add(bridge, nose, wrap, tail);
  man.position.set(x, 0, z);
  man.rotation.y = Math.atan2(-x, -z);
  return man;
}

// the house rules on a board just outside the wall, at the far side from where the camera starts
function sign() {
  const W = 512, H = 300;
  const texture = painted(W, H, (ctx, w, h) => {
    planks(ctx, w, h, { count: 3, seed: 5 });
    letter(ctx, 'THE PLAZA', w / 2, h * 0.27, { size: 62, color: '#3b2618', maxWidth: w - 60 });
    letter(ctx, `max. ${MAX_PLAYERS} cans`, w / 2, h * 0.55, { size: 40, color: '#3b2618' });
    letter(ctx, 'bump gently', w / 2, h * 0.78, { size: 40, color: '#b0352a' });
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.88), new THREE.MeshToonMaterial({ map: texture }));
  board.position.y = 1.25;
  board.castShadow = true;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), toon('#8a5a32'));
  post.position.set(0, 0.62, -0.06);
  post.castShadow = true;
  const sign = new THREE.Group();
  sign.name = 'the sign';
  sign.add(board, post);
  sign.position.set(-2.6, 0, PLAZA.radius + 1.7);
  sign.rotation.y = Math.PI + 0.2;
  return sign;
}
