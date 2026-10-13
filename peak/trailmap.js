// The trailhead map at base camp: a roofed board with the route seen from the side, drawn from the route itself
// (the camera rail for the path, plus the checkpoints, beams, rockfall and summit), and a big "you are here".
// It is drawn in decor.js's dressRoute, once the whole route exists, so it keeps up when the route changes.
import * as THREE from 'three';
import { wood } from './wood.js';
import { painted, planks, chip, letter, roundRect, nail, emblem, sticker } from './paint.js';
import { board, paintBack, squarePost, snowStrip, aim } from './signs.js';
import { feet } from './footing.js';

export function trailMap(world, foot, yaw) {
  const group = new THREE.Group();
  group.position.copy(foot);
  group.userData.fade = true;
  const width = 1.3, height = 0.82, bottom = 0.62, depth = 0.05;
  const state = { world: null };
  const front = painted(1024, Math.round(1024 * height / width), (ctx, w, h) => drawMap(ctx, w, h, state.world));
  const back = paintBack(width, height, 3, 'Peak Mnot trail association · est. last episode');
  const sign = board(width, height, front, back, depth);
  sign.position.y = bottom + height / 2;
  group.add(sign);
  for (const x of [-(width / 2 + 0.03), width / 2 + 0.03]) {
    const post = squarePost(bottom + height + 0.2, 0.08);
    post.position.set(x, 0, 0);
    post.children[2].visible = false;                 // under the roof: no snow
    group.add(post);
  }
  // a little gable roof of two planks, with snow on it
  const roofY = bottom + height + 0.2;
  for (const side of [-1, 1]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.025, 0.2), wood('#8a5a34', 'x'));
    plank.position.set(0, roofY + 0.05, side * 0.075);
    plank.rotation.x = side * 0.55;
    plank.castShadow = true;
    const snow = snowStrip(width + 0.26, 0.17, 0.035, 7 + side);
    snow.position.set(0, roofY + 0.075, side * 0.075);
    snow.rotation.x = side * 0.55;
    group.add(plank, snow);
  }
  world.group.add(group);
  feet(group, [[-(width / 2 + 0.03), 0], [width / 2 + 0.03, 0]], 'trail map', 0.06);
  aim(world, group, yaw);
  group.userData.draw = (w) => { state.world = w; front.repaint(); };
  return group;
}

const INK = '#3b2618';

// The route seen from the side: distance along the camera rail across, height up (stretched, it's a map).
function drawMap(ctx, w, h, world) {
  planks(ctx, w, h, { count: 4, seed: 21, color: '#a8743f' });
  const m = h * 0.05;
  ctx.fillStyle = '#f3e7c6';
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, h * 0.04);
  ctx.fill();
  chip(ctx, m, m, w - 2 * m, h - 2 * m, 9, 24);
  letter(ctx, 'PEAK MNOT', w * 0.07, h * 0.14, { size: h * 0.11, color: '#b4442e', align: 'left' });
  letter(ctx, '4,810 m · about one episode (unedited)', w * 0.07, h * 0.24,
    { size: h * 0.045, color: '#5a4030', align: 'left', weight: 500 });
  sticker(ctx, w * 0.6, h * 0.16, h * 0.075, { turn: 0.25 });
  for (const [x, y] of [[m * 1.3, m * 1.3], [w - m * 1.3, m * 1.3], [m * 1.3, h - m * 1.3], [w - m * 1.3, h - m * 1.3]]) {
    nail(ctx, x, y, h * 0.014);
  }
  if (!world || world.rail.length < 2) return;
  // the rail as a profile
  const pts = [];
  let s = 0;
  world.rail.forEach((r, i) => {
    if (i > 0) s += Math.hypot(r.at.x - world.rail[i - 1].at.x, r.at.z - world.rail[i - 1].at.z);
    pts.push({ s, y: r.at.y, at: r.at });
  });
  const L = s, top = Math.max(...pts.map(p => p.y));
  const X = v => w * 0.1 + (v / L) * w * 0.74, Y = v => h * 0.84 - (v / top) * h * 0.5;
  const along = (P, height = true) => {   // a world point's place on the profile
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i].at, b = pts[i + 1].at, abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1;
      const u = THREE.MathUtils.clamp(((P.x - a.x) * abx + (P.z - a.z) * abz) / len2, 0, 1);
      const d = Math.hypot(P.x - a.x - abx * u, P.z - a.z - abz * u) + (height ? 2 * Math.abs(P.y - (a.y + (b.y - a.y) * u)) : 0);
      if (!best || d < best.d) best = { d, s: pts[i].s + u * (pts[i + 1].s - pts[i].s), y: a.y + (b.y - a.y) * u };
    }
    return { x: X(best.s), y: Y(best.y) };
  };
  // far peaks, then the mountain: its flank under the route, a peak over the summit, and snow up high
  ctx.save();
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, h * 0.04);
  ctx.clip();
  ctx.fillStyle = '#d5ddec';
  for (const [x, y, k] of [[0.3, 0.42, 0.18], [0.62, 0.36, 0.2], [0.95, 0.46, 0.16]]) {
    ctx.beginPath();
    ctx.moveTo(w * (x - k), h); ctx.lineTo(w * x, h * y); ctx.lineTo(w * (x + k), h); ctx.fill();
  }
  const peak = { x: X(L) + w * 0.025, y: Y(top) - h * 0.1 };
  const flank = [{ x: m, y: h * 0.9 }, ...pts.map(p => ({ x: X(p.s), y: Y(p.y) + h * 0.012 })), peak,
    { x: peak.x + w * 0.05, y: peak.y + h * 0.12 }, { x: w - m, y: h * 0.62 }, { x: w - m, y: h }, { x: m, y: h }];
  const body = () => { ctx.beginPath(); for (const p of flank) ctx.lineTo(p.x, p.y); ctx.closePath(); };
  const grad = ctx.createLinearGradient(0, peak.y, 0, h);
  grad.addColorStop(0, '#8e98b8');
  grad.addColorStop(1, '#6d7898');
  ctx.fillStyle = grad;
  body();
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, 0);
  for (let x = w; x >= 0; x -= w / 24) ctx.lineTo(x, Y(top * 0.55) + Math.sin(x * 0.05) * h * 0.02 + (x / w) * h * 0.04);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#4f5878';
  ctx.lineWidth = h * 0.006;
  body();
  ctx.stroke();
  ctx.fillStyle = '#eef2f8';                            // the sea of clouds at the foot
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.ellipse(m + i * w * 0.11, h * 0.93 + (i % 2) * h * 0.02, w * 0.075, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // the route, dashed
  ctx.strokeStyle = '#d7322a';
  ctx.lineWidth = h * 0.012;
  ctx.setLineDash([h * 0.025, h * 0.018]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const p of pts) ctx.lineTo(X(p.s), Y(p.y));
  ctx.stroke();
  ctx.setLineDash([]);
  // labels go above or below the route, wherever they don't run into another
  const taken = [];
  const label = (text, x, y, size = h * 0.034) => {
    ctx.font = `600 ${size}px Fredoka, system-ui, sans-serif`;
    const lw = Math.max(...text.split('\n').map(l => ctx.measureText(l).width)) + size * 0.5;
    const lh = size * 1.2 * text.split('\n').length;
    for (const dy of [-h * 0.075, h * 0.07, -h * 0.13, h * 0.12]) {
      const r = { x: x - lw / 2, y: y + dy - lh / 2, w: lw, h: lh };
      if (taken.some(t => r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h)) continue;
      taken.push(r);
      ctx.fillStyle = 'rgba(243, 231, 198, 0.85)';
      roundRect(ctx, r.x, r.y, r.w, r.h, size * 0.3);
      ctx.fill();
      letter(ctx, text, x, y + dy, { size, color: INK, weight: 600 });
      return;
    }
  };
  // you are here (first, so it gets its place)
  const here = along(world.checkpoints[0]?.respawn ?? world.rail[0].at);
  taken.push({ x: here.x - h * 0.02, y: here.y - h * 0.2, w: h * 0.22, h: h * 0.17 });
  ctx.fillStyle = '#d7322a';
  ctx.beginPath(); ctx.arc(here.x, here.y, h * 0.024, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = h * 0.008; ctx.stroke();
  letter(ctx, 'YOU ARE\nHERE', here.x + h * 0.01, here.y - h * 0.12, { size: h * 0.045, color: '#d7322a', align: 'left' });
  // checkpoints: little flags with their number
  world.checkpoints.forEach((cp, i) => {
    if (i === 0) return;
    const p = along(cp.respawn);
    ctx.strokeStyle = INK;
    ctx.lineWidth = h * 0.007;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - h * 0.075); ctx.stroke();
    ctx.fillStyle = '#3d8fd6';
    ctx.beginPath(); ctx.moveTo(p.x, p.y - h * 0.075); ctx.lineTo(p.x + h * 0.055, p.y - h * 0.06);
    ctx.lineTo(p.x, p.y - h * 0.045); ctx.fill();
    letter(ctx, String(i), p.x + h * 0.022, p.y - h * 0.06, { size: h * 0.026, color: '#ffffff' });
    taken.push({ x: p.x - h * 0.01, y: p.y - h * 0.08, w: h * 0.07, h: h * 0.08 });
  });
  for (const b of world.beams) {
    const a = along(b.a), c = along(b.b);
    ctx.strokeStyle = b.kind === 'rope' ? '#b8913f' : '#7a4f2e';
    ctx.lineWidth = h * (b.kind === 'rope' ? 0.008 : 0.016);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + c.x) / 2, (a.y + c.y) / 2 + (b.kind === 'rope' ? h * 0.035 : 0), c.x, c.y);
    ctx.stroke();
    label(b.kind === 'rope' ? 'rope\n(wobbly)' : b.wobble > 1.5 ? 'steep plank' : 'plank', (a.x + c.x) / 2, (a.y + c.y) / 2);
  }
  for (const z of world.zones.filter(z => z.kind === 'rockfall')) {
    const p = along(new THREE.Vector3(z.x, 0, z.z), false);
    ctx.fillStyle = '#d7322a';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - h * 0.16); ctx.lineTo(p.x + h * 0.045, p.y - h * 0.085); ctx.lineTo(p.x - h * 0.045, p.y - h * 0.085);
    ctx.closePath();
    ctx.fill();
    letter(ctx, '!', p.x, p.y - h * 0.11, { size: h * 0.045, color: '#ffffff' });
    taken.push({ x: p.x - h * 0.05, y: p.y - h * 0.17, w: h * 0.1, h: h * 0.09 });
    label('falling\nrocks', p.x, p.y + h * 0.02);
  }
  if (world.summit) {
    const p = along(world.summit.at);
    emblem(ctx, peak.x, peak.y - h * 0.075, h * 0.1, { can: '#e23b2e', line: '#ffffff' });
    taken.push({ x: peak.x - h * 0.05, y: peak.y - h * 0.13, w: h * 0.1, h: h * 0.11 });
    label('the summit\n(and a flag)', p.x - w * 0.02, p.y);
  }
  letter(ctx, 'Map not to scale. Scale not to map.', w * 0.5, h - m * 1.8, { size: h * 0.032, color: '#5a4030', weight: 500 });
}
