// Canvas painting for the props: wooden boards with grain, nails and chipped paint, hand-lettered text in Fredoka,
// the Mnot emblem (a can with big glasses) for flags and stickers, and doodles for the backs of signs. No image
// files. Every canvas is painted at once and again when the font arrives, so no sign keeps a fallback font.
import * as THREE from 'three';
import { random } from '../world/world.js';

export const font = (size, weight = 700) => `${weight} ${Math.round(size)}px Fredoka, system-ui, sans-serif`;

const painters = [];
let fredoka = false;
function repaint() {
  if (fredoka || !document.fonts?.check('700 40px Fredoka')) return;
  fredoka = true;
  for (const paint of painters) paint();
}
document.fonts?.load('700 40px Fredoka').then(repaint, () => {});
document.fonts?.addEventListener('loadingdone', repaint);
document.fonts?.ready.then(repaint);

// A texture of w × h pixels, painted by draw(ctx, w, h). draw is called again when the font has loaded.
export function painted(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const paint = () => {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
    ctx.restore();
    texture.needsUpdate = true;
  };
  paint();
  painters.push(paint);
  texture.repaint = paint;
  return texture;
}

// ------------------------------------------------------------------ wood

const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

// Planks across the canvas, each its own tone, with grain, a knot now and then, the gaps between them and nails.
export function planks(ctx, w, h, { color = '#a8743f', count = 3, seed = 1, nails = true, vertical = false } = {}) {
  const rand = random(seed);
  ctx.save();
  if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); [w, h] = [h, w]; }
  const ph = h / count;
  for (let i = 0; i < count; i++) {
    const y0 = i * ph;
    ctx.fillStyle = shade(color, 0.9 + 0.2 * rand());
    ctx.fillRect(0, y0, w, ph);
    // grain: long wavy lines
    for (let g = 0; g < 9; g++) {
      const y = y0 + ph * (0.08 + 0.84 * rand()), amp = ph * 0.05 * rand(), f = 0.004 + 0.01 * rand(), phase = rand() * 6;
      ctx.strokeStyle = `rgba(70, 38, 18, ${0.12 + 0.18 * rand()})`;
      ctx.lineWidth = 1 + 2 * rand();
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + amp * Math.sin(x * f + phase) + amp * 0.5 * Math.sin(x * f * 3.1));
      ctx.stroke();
    }
    if (rand() < 0.6) {
      const kx = w * (0.15 + 0.7 * rand()), ky = y0 + ph * (0.3 + 0.4 * rand()), kr = ph * (0.06 + 0.06 * rand());
      for (let r = 3; r >= 1; r--) {
        ctx.strokeStyle = `rgba(80, 40, 16, ${0.25 + 0.1 * r})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * r * 1.6, kr * r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(70, 34, 14, 0.7)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr, kr * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // the gap to the next plank: a dark seam with a light edge under it
    ctx.fillStyle = 'rgba(40, 20, 8, 0.75)';
    ctx.fillRect(0, y0, w, Math.max(2, ph * 0.035));
    ctx.fillStyle = 'rgba(255, 230, 190, 0.18)';
    ctx.fillRect(0, y0 + Math.max(2, ph * 0.035), w, Math.max(1, ph * 0.02));
    if (nails) for (const x of [w * 0.045, w * 0.955]) nail(ctx, x, y0 + ph / 2, Math.max(3, ph * 0.05));
  }
  ctx.restore();
}

export function nail(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(30, 24, 22, 0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220, 220, 230, 0.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120, 60, 30, 0.25)';      // a rust streak
  ctx.fillRect(x - r * 0.3, y + r, r * 0.6, r * 2.5);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Paint chipped off along the edges of a painted panel: flecks of bare wood.
export function chip(ctx, x, y, w, h, seed = 3, amount = 26, wood = '#9a6a3a') {
  const rand = random(seed);
  ctx.save();
  for (let i = 0; i < amount; i++) {
    const side = Math.floor(rand() * 4), t = rand();
    const px = side < 2 ? x + t * w : x + (side === 2 ? 0 : w), py = side >= 2 ? y + t * h : y + (side === 0 ? 0 : h);
    const r = Math.min(w, h) * (0.008 + 0.025 * rand());
    ctx.fillStyle = shade(wood, 0.85 + 0.3 * rand());
    ctx.beginPath();
    ctx.ellipse(px, py, r * (1 + rand()), r, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ text

// Lines of text centred on (x, y), shrunk to fit maxWidth.
export function letter(ctx, text, x, y, { size, color = '#3b2618', maxWidth = Infinity, line = 1.15, weight = 700,
  align = 'center', outline = null, outlineWidth = 0 } = {}) {
  const lines = String(text).split('\n');
  ctx.font = font(size, weight);
  const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  if (widest > maxWidth) size *= maxWidth / widest;
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const ly = y + (i - (lines.length - 1) / 2) * size * line;
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outline;
      ctx.lineWidth = outlineWidth || size * 0.18;
      ctx.strokeText(l, x, ly);
    }
    ctx.fillStyle = color;
    ctx.fillText(l, x, ly);
  });
  return size;
}

// ------------------------------------------------------------------ the emblem

// Mnot's face: a can with a rim and pull tab and big black glasses, centred on (x, y), h tall.
export function emblem(ctx, x, y, h, { can = '#ffffff', ink = '#1d1d26', lens = 'rgba(200, 235, 255, 0.95)',
  line = null } = {}) {
  const w = h * 0.62, top = y - h / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  // the can, with a darker band under the rim
  if (line) { ctx.strokeStyle = line; ctx.lineWidth = h * 0.06; roundRect(ctx, x - w / 2, top, w, h, w * 0.18); ctx.stroke(); }
  ctx.fillStyle = can;
  roundRect(ctx, x - w / 2, top, w, h, w * 0.18);
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(x - w / 2 + w * 0.06, top + h * 0.12, w * 0.88, h * 0.05);
  ctx.strokeStyle = ink;
  ctx.lineWidth = h * 0.035;
  ctx.beginPath();
  ctx.ellipse(x, top + h * 0.06, w * 0.36, h * 0.035, 0, 0, Math.PI * 2);
  ctx.stroke();
  // the glasses: two thick square frames, wider than the can
  const gw = w * 0.62, gh = h * 0.27, gy = top + h * 0.36;
  for (const side of [-1, 1]) {
    const gx = x + side * gw * 0.56 - gw / 2;
    ctx.fillStyle = ink;
    roundRect(ctx, gx - h * 0.03, gy - h * 0.03, gw + h * 0.06, gh + h * 0.06, h * 0.07);
    ctx.fill();
    ctx.fillStyle = lens;
    roundRect(ctx, gx + h * 0.02, gy + h * 0.02, gw - h * 0.04, gh - h * 0.04, h * 0.04);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.ellipse(gx + gw * 0.3, gy + gh * 0.32, gw * 0.12, gh * 0.11, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.fillRect(x - w * 0.12, gy + gh * 0.25, w * 0.24, h * 0.035);
  // a smile
  ctx.strokeStyle = ink;
  ctx.lineWidth = h * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, top + h * 0.7, w * 0.16, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.restore();
}

// A round sticker, slightly turned: the podcast's initials, or the emblem.
export function sticker(ctx, x, y, r, { text = 'MNOT', color = '#e23b2e', ink = '#ffffff', turn = -0.2, face = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.arc(r * 0.06, r * 0.08, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
  if (face) emblem(ctx, 0, 0, r * 1.2, { can: ink, ink: '#1d1d26' });
  else letter(ctx, text, 0, r * 0.04, { size: r * 0.62, color: ink, maxWidth: r * 1.5 });
  ctx.restore();
}

// Marker doodles for the back of a sign.
export function doodle(ctx, kind, x, y, s, seed = 1) {
  const rand = random(seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rand() - 0.5) * 0.3);
  ctx.strokeStyle = ctx.fillStyle = 'rgba(25, 25, 40, 0.8)';
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.lineCap = ctx.lineJoin = 'round';
  if (kind === 'sticker') sticker(ctx, 0, 0, s * 0.5, { turn: 0.15 });
  else if (kind === 'face') sticker(ctx, 0, 0, s * 0.5, { face: true, color: '#3d8fd6', turn: -0.1 });
  else if (kind === 'can') {
    roundRect(ctx, -s * 0.18, -s * 0.4, s * 0.36, s * 0.8, s * 0.06);
    ctx.stroke();
    for (const side of [-1, 1]) {
      roundRect(ctx, side * s * 0.12 - s * 0.1, -s * 0.15, s * 0.2, s * 0.14, s * 0.03);
      ctx.stroke();
    }
    letter(ctx, 'was here', s * 0.55, s * 0.32, { size: s * 0.2, color: 'rgba(25, 25, 40, 0.8)', align: 'left' });
  } else if (kind === 'tally') {
    letter(ctx, 'tries:', -s * 0.2, -s * 0.2, { size: s * 0.2, color: 'rgba(25, 25, 40, 0.8)', align: 'right' });
    for (let i = 0; i < 7; i++) {
      const tx = (i % 5) * s * 0.08 + Math.floor(i / 5) * s * 0.5;
      ctx.beginPath();
      ctx.moveTo(tx, -s * 0.35);
      ctx.lineTo(tx + s * 0.02, -s * 0.05);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-s * 0.04, -s * 0.12);
    ctx.lineTo(s * 0.38, -s * 0.28);
    ctx.stroke();
  } else {
    letter(ctx, kind, 0, 0, { size: s * 0.28, color: 'rgba(25, 25, 40, 0.78)' });
  }
  ctx.restore();
}
