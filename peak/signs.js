// Signs along the route: wooden boards on two posts behind them (never through the text), with a painted,
// hand-lettered face, a doodled back and a little snow on top, and a warning triangle for the rockfall. Trail signs
// stand tall, the board above Mnot's head, so in the shot it reads over the can rather than behind it. A sign can
// face the camera of its stretch: yaw 'camera' (aimed in decor.js's dressRoute, once the camera rail is known), and
// its feet are checked to stand on rock (footing.js).
import * as THREE from 'three';
import { toon, RAMPS } from './look.js';
import { wood } from './wood.js';
import { painted, planks, chip, letter, roundRect, doodle, nail } from './paint.js';
import { feet } from './footing.js';

const PX = 560;                     // canvas pixels per metre of sign
const POST = '#7a4f2e', BOARD = '#a8743f';
const BACKS = [['sticker', 'can'], ['tally', 'face'], ['P(fall) < 1', 'sticker'], ['can', 'nerds\nwere here'],
  ['face', '∑ = 42?'], ['sticker', 'tally']];
let signs = 0;

// A material for a painted face: toon-lit like the rest, with a little glow so it stays readable in the shade.
export function faceMaterial(texture) {
  const material = new THREE.MeshToonMaterial({ map: texture, gradientMap: RAMPS.world, emissive: '#ffffff',
    emissiveMap: texture, emissiveIntensity: 0.22 });
  material.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.004, alpha: 1 };
  return material;
}

// A lumpy strip of snow along X, length long, for the top of a board or a roof.
export function snowStrip(length, depth, thick = 0.035, seed = 1) {
  const r = depth / 2 + 0.008;
  const geometry = new THREE.CapsuleGeometry(r, Math.max(0.01, length - 2 * r), 4, 10);
  geometry.rotateZ(Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const lump = 1 + 0.25 * Math.sin(x * 23 + seed) * Math.sin(x * 7.1 + seed * 2);
    pos.setY(i, y < 0 ? y * 0.25 : y * lump * thick / r);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, toon('#f7faff'));
  mesh.castShadow = true;
  return mesh;
}

// A square post from the ground up to height, with a pointed cap and a cap of snow.
export function squarePost(height, size = 0.075) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(size, height + 0.12, size), wood(POST, 'y'));
  shaft.position.y = height / 2 - 0.06;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(size * 0.72, size * 0.7, 4), wood(POST, 'y'));
  cap.rotation.y = Math.PI / 4;
  cap.position.y = height + size * 0.35;
  const snow = new THREE.Mesh(new THREE.SphereGeometry(size * 0.55, 8, 5), toon('#f7faff'));
  snow.scale.y = 0.45;
  snow.position.y = height + size * 0.62;
  shaft.castShadow = cap.castShadow = true;
  group.add(shaft, cap, snow);
  return group;
}

// The painted front: a cream panel on planks, chipped at the edges, with a border, screws and the text.
function paintFront(text, { width, height, size, style, seed, background, color }) {
  const w = Math.min(1024, Math.round(width * PX)), h = Math.round(w * height / width);
  return painted(w, h, (ctx) => {
    planks(ctx, w, h, { count: Math.max(2, Math.round(height / 0.17)), seed, color: BOARD });
    const m = h * 0.07;
    const fontPx = size * 2 / 256 * h;                    // size: as in the old signs, px on a 256 px tall canvas / 2
    if (style === 'carved') {
      letter(ctx, text, w / 2, h / 2, { size: fontPx, color: '#fff3dc', maxWidth: w - 4 * m, outline: '#3b2214' });
      return;
    }
    const yellow = style === 'yellow';
    ctx.fillStyle = background ?? (yellow ? '#f5c518' : '#f4ead2');
    roundRect(ctx, m, m, w - 2 * m, h - 2 * m, h * 0.06);
    ctx.fill();
    chip(ctx, m, m, w - 2 * m, h - 2 * m, seed + 5, 30);
    ctx.strokeStyle = yellow ? '#1d1d26' : '#b4442e';
    ctx.lineWidth = h * 0.018;
    roundRect(ctx, m * 1.9, m * 1.9, w - 3.8 * m, h - 3.8 * m, h * 0.04);
    ctx.stroke();
    letter(ctx, text, w / 2, h / 2 + h * 0.01, { size: fontPx, color: color ?? (yellow ? '#1d1d26' : '#3b2618'),
      maxWidth: w - 6 * m });
    for (const [x, y] of [[m * 1.1, m * 1.1], [w - m * 1.1, m * 1.1], [m * 1.1, h - m * 1.1], [w - m * 1.1, h - m * 1.1]]) {
      nail(ctx, x, y, h * 0.022);
    }
  });
}

// The back: bare planks, braces and whatever people doodled on it.
export function paintBack(width, height, seed, extra) {
  const w = Math.min(1024, Math.round(width * PX)), h = Math.round(w * height / width);
  return painted(w, h, (ctx) => {
    planks(ctx, w, h, { count: Math.max(2, Math.round(height / 0.17)), seed: seed + 11, color: '#9a6a3a' });
    const [a, b] = BACKS[seed % BACKS.length];
    doodle(ctx, a, w * 0.3, h * 0.5, h * 0.55, seed);
    doodle(ctx, b, w * 0.7, h * 0.52, h * 0.5, seed + 1);
    if (extra) letter(ctx, extra, w / 2, h * 0.86, { size: h * 0.1, color: 'rgba(25, 25, 40, 0.75)', maxWidth: w * 0.8 });
  });
}

// A board with a painted face and back, depth thick, centred on its own origin.
export function board(width, height, front, back, depth = 0.045) {
  const side = wood(BOARD, 'x');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
    [side, side, side, side, faceMaterial(front), faceMaterial(back)]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// A wooden sign on posts, facing yaw (radians, 0 = facing +Z; 'camera' to face this stretch's camera).
// options: width, height, size (text), bottom (the board's lower edge), style ('board', 'yellow', 'carved'),
// back (a line on the back).
export function signpost(world, foot, yaw, text, options = {}) {
  const seed = ++signs;
  const width = options.width ?? 1.1, height = options.height ?? 0.5;
  const size = options.size ?? 32, style = options.style ?? 'board';
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const bottom = options.bottom ?? 1.55, depth = 0.045;
  const sign = board(width, height, paintFront(text, { width, height, size, style, seed, ...options }),
    paintBack(width, height, seed, options.back), depth);
  sign.position.y = bottom + height / 2;
  group.add(sign);
  // posts behind the board, sticking out a little above it
  const xs = width > 0.75 ? [-(width / 2 - 0.13), width / 2 - 0.13] : [0];
  for (const x of xs) {
    const post = squarePost(bottom + height + 0.08);
    post.position.set(x, 0, -depth / 2 - 0.04);
    group.add(post);
  }
  const snow = snowStrip(width + 0.02, depth + 0.01, 0.03, seed);
  snow.position.y = bottom + height;
  group.add(snow);
  world.group.add(group);
  feet(group, xs.map(x => [x, -depth / 2 - 0.04]), text.split('\n')[0], 0.07);
  aim(world, group, yaw, options.turn);
  return group;
}

// Turn a prop to face the camera of its stretch once the rail is known (decor.js), or now by a fixed yaw.
export function aim(world, object, yaw, turn = 0) {
  if (yaw === 'camera') (world.aimed ??= []).push({ object, turn });
  else object.rotation.y = yaw;
}

// The warning triangle for falling rocks, on a metal pole, with a plate of small print under it.
export function warningSign(world, foot, yaw, small) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const r = 0.36, top = 1.62;
  const tri = painted(512, 512, (ctx) => {
    const cx = 256, cy = 256, R = 256;
    const corner = a => [cx + Math.cos(a) * R * 0.97, cy - Math.sin(a) * R * 0.97];
    const path = (k) => {
      ctx.beginPath();
      for (const a of [Math.PI / 2, Math.PI / 2 + 2.094, Math.PI / 2 + 4.189]) {
        const [x, y] = corner(a);
        ctx.lineTo(cx + (x - cx) * k, cy + (y - cy) * k);
      }
      ctx.closePath();
    };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#d7322a'; path(1); ctx.fill();
    ctx.fillStyle = '#fbf6ea'; path(0.72); ctx.fill();
    // the pictogram: a slope and rocks tumbling off it
    ctx.fillStyle = '#1d1d26';
    ctx.beginPath();
    ctx.moveTo(150, 360); ctx.lineTo(205, 205); ctx.lineTo(225, 205); ctx.lineTo(225, 360); ctx.closePath(); ctx.fill();
    for (const [x, y, s] of [[262, 235, 22], [300, 290, 30], [272, 340, 18]]) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) ctx.lineTo(x + Math.cos(k * 1.05 + s) * s, y + Math.sin(k * 1.05 + s) * s * 0.9);
      ctx.fill();
    }
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 3, Math.PI / 2), faceMaterial(tri));
  face.position.set(0, top, 0.012);
  const backing = new THREE.Mesh(new THREE.CircleGeometry(r, 3, Math.PI / 2), toon('#aab3c2'));
  backing.rotation.y = Math.PI;
  backing.position.set(0, top, 0.008);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, top + 0.1, 8), toon('#c3cad6'));
  pole.position.y = (top + 0.1) / 2 - 0.08;
  const plateW = 0.62, plateH = 0.34;
  const plateFront = painted(Math.round(plateW * PX), Math.round(plateH * PX), (ctx, w, h) => {
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1d1d26';
    ctx.lineWidth = h * 0.03;
    ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    letter(ctx, small, w / 2, h / 2, { size: h * 0.17, color: '#1d1d26', maxWidth: w * 0.86, weight: 600 });
  });
  const plateBack = painted(64, 32, (ctx, w, h) => { ctx.fillStyle = '#aab3c2'; ctx.fillRect(0, 0, w, h); });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, 0.012), [toon('#aab3c2'), toon('#aab3c2'),
    toon('#aab3c2'), toon('#aab3c2'), faceMaterial(plateFront), faceMaterial(plateBack)]);
  plate.position.set(0, top - r * 0.5 - 0.07 - plateH / 2, 0.03);
  const snow = snowStrip(0.16, 0.05, 0.03, 4);
  snow.position.set(0, top + r - 0.02, 0.01);
  for (const m of [face, pole, plate]) m.castShadow = true;
  group.add(face, backing, pole, plate, snow);
  world.group.add(group);
  feet(group, [[0, 0]], `warning: ${small.split('\n')[0]}`, 0.06);
  aim(world, group, yaw);
  return group;
}
