// Paint on the snow: the bowling lane's markings, and the distance lines down the ski jump's landing hill. Each is a
// canvas texture on a sheet that follows the snow a couple of centimetres above it. The canvas runs down the piste
// (y grows with s) and across it (x grows with d, to the right going down), so text is painted upside down to read
// right way up from the chair coming down.
import * as THREE from 'three';
import { RAMPS } from '../look/look.js';
import { painted, letter } from '../props/paint.js';
import { FEATURES, PISTE } from './track.js';

// A sheet over the snow from s = from to to and d = left to right, painted by draw(ctx, w, h, y(s), x(d)).
export function decal(track, { from, to, left, right, scale = 48, draw }) {
  const w = Math.min(2048, Math.round((right - left) * scale)), h = Math.min(2048, Math.round((to - from) * scale));
  const map = painted(w, h, (ctx, w, h) => draw(ctx, w, h, s => (s - from) / (to - from) * h,
    d => (d - left) / (right - left) * w));
  const rows = Math.ceil((to - from) / 0.5), cols = Math.ceil((right - left) / 0.5);
  const positions = [], uvs = [], index = [], p = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    track.point(from + (to - from) * i / rows, left + (right - left) * j / cols, p);
    positions.push(p.x, p.y + 0.025, p.z);
    uvs.push(j / cols, 1 - i / rows);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, e = c + 1;
    index.push(a, b, c, b, e, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshToonMaterial({ map, gradientMap: RAMPS.world, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Text on the snow, upside down on the canvas so it reads from up the hill.
function words(ctx, text, x, y, options) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  letter(ctx, text, 0, 0, options);
  ctx.restore();
}

// The lane: a warm strip between two gutters, the foul line, the guide dots and arrows, and a spot for every pin.
export function laneMarks(track) {
  const L = FEATURES.lane, half = 2.2;
  return decal(track, { from: L.from, to: FEATURES.pins + 3.5, left: -2.9, right: 2.9, scale: 40,
    draw(ctx, w, h, y, x) {
      ctx.fillStyle = 'rgba(236, 196, 140, 0.32)';
      ctx.fillRect(x(-half), 0, x(half) - x(-half), h);
      ctx.fillStyle = 'rgba(79, 134, 198, 0.55)';
      ctx.fillRect(x(-2.7), 0, x(-half) - x(-2.7), h);
      ctx.fillRect(x(half), 0, x(2.7) - x(half), h);
      ctx.fillStyle = 'rgba(208, 53, 42, 0.85)';
      ctx.fillRect(x(-half), y(L.from + 0.6), x(half) - x(-half), 6);
      ctx.fillStyle = 'rgba(43, 51, 82, 0.6)';
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(x(k * 0.75), y(L.from + 3), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      // the arrows point down the lane, at the pins
      for (let k = -3; k <= 3; k++) {
        const cx = x(k * 0.55), tip = y(L.from + 11 + Math.abs(k) * 0.9), size = 16;
        ctx.beginPath();
        ctx.moveTo(cx, tip);
        ctx.lineTo(cx - size * 0.6, tip - size * 1.4);
        ctx.lineTo(cx + size * 0.6, tip - size * 1.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(43, 51, 82, 0.35)';
      ctx.lineWidth = 3;
      for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) {
        ctx.beginPath();
        ctx.arc(x((k - row / 2) * 1.1), y(FEATURES.pins + row * 1.1 * 0.866), 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      words(ctx, '€49 each', x(0), y(L.from + 6), { size: 42, color: 'rgba(43, 51, 82, 0.55)' });
    } });
}

// Where down the landing hill a jump of D metres lands: the spot D metres from the lip in a straight line.
export function landingAt(track, D) {
  const J = FEATURES.jump, lip = track.point(J.lip, 0), p = new THREE.Vector3();
  let lo = J.lip, hi = J.lip + 90;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (track.point(mid, 0, p).distanceTo(lip) < D) lo = mid; else hi = mid;
  }
  return lo;
}

// The landing hill's distance lines every five metres, a number every ten, and the red K line: a jump with the
// lever pulled right at the lip, tucked all the way down, gets there.
export const K_LINE = 50;
export function hillMarks(track) {
  const J = FEATURES.jump, from = J.lip + 6, to = J.lip + 72;
  return decal(track, { from, to, left: -PISTE, right: PISTE, scale: 32,
    draw(ctx, w, h, y, x) {
      for (let D = 10; D <= 80; D += 5) {
        const s = landingAt(track, D);
        if (s > to - 0.5) break;
        const k = D === K_LINE, lw = k ? 9 : D % 10 ? 3 : 5;
        ctx.fillStyle = k ? 'rgba(226, 59, 46, 0.9)' : 'rgba(47, 111, 208, 0.7)';
        ctx.fillRect(0, y(s) - lw / 2, w, lw);
        if (D % 10 === 0 || k) for (const side of [-1, 1]) {
          words(ctx, k ? `K ${D}` : `${D}`, x(side * 4.6), y(s) + 26, { size: 40, color: k ? '#e23b2e' : '#2f6fd0' });
        }
      }
    } });
}
