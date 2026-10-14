// The piste for the office-chair descent (prototype): a centreline from the summit down to a finish above the
// clouds, sampled every half metre, and a cross-section round it: a groomed piste with a slight dish, snow banks that
// rise either side and tilt into the bends, a strip of deep powder on top of them, and the drop beyond. Along the
// way: a kicker before a crevasse, ice in a bend, moguls, rollers, a meltwater river in a gorge with ice floes to
// hop, more rollers, a bowling lane and a ski jump (the pins, the office and the rest stand in obstacles.js). The
// chair's physics asks ground(x, z) for the height, the slope and the surface; the snow mesh is drawn from the same
// function, so what you see is what you ride on.
import * as THREE from 'three';
import { toon } from '../look/look.js';
import { rock } from '../look/materials.js';

export const STEP = 0.5;                       // metres between centreline samples
export const PISTE = 6.5;                      // half the groomed width
export const BANK = 7, BANK_HEIGHT = 4.2;      // the banks beyond the piste: how wide, how high
export const POWDER = 7;                       // the deep snow on top of the banks
export const EDGE = PISTE + BANK + POWDER;     // past this the mountain drops away

// The centreline: x, y, z, from the summit (a flat start) down long S-bends, then straight where the river, the
// bowling lane and the ski jump need it (the jump's drop is added on top, see JUMP), to the finish and a runout.
const PATH = [
  [0, 193, -12], [0, 192.6, 0], [2, 189.5, 18], [9, 184, 45], [20, 178.5, 75], [24, 173, 105], [16, 167, 138],
  [2, 161, 170], [-8, 155.5, 200], [-10, 150, 232], [-5, 144, 265], [8, 138, 300], [19, 132, 335], [18, 126.5, 368],
  [6, 121, 400], [-6, 116, 435], [-10, 112, 465], [-7, 109, 490], [-4.5, 106, 512], [-4, 103.5, 530], [-4, 99.5, 560],
  [-4, 95.5, 590], [-4, 93, 610], [1, 90.5, 632], [8, 88.5, 650], [14, 87.3, 665], [20, 86.1, 680], [26, 84.9, 695],
  [30.5, 83.2, 712], [32, 81, 730], [32, 79.2, 760], [32, 77.4, 790], [32, 75.6, 820], [32, 73.8, 850], [32, 72, 880],
  [27, 70, 905], [18, 68, 930], [13, 66, 955], [14, 64.5, 980], [16, 63.5, 1005], [17, 63, 1030],
  [17.5, 63, 1050],
];

// Where things are along the piste, in metres from the top (s).
export const FEATURES = {
  pits: [6, 178, 306, 488, 760],                    // the start and the pit stops: fresh wheels, and where you respawn
  gate: 12,                                         // the clock starts here
  kicker: { from: 213, to: 221, height: 1.3 },      // a ramp up to the lip of...
  crevasse: { from: 221, to: 226.5, depth: 9 },     // ...a crevasse right across, banks and all
  ice: { from: 322, to: 354 },
  moguls: { from: 416, to: 452, height: 0.32 },
  // waves right across the piste, a little askew, that throw a fast chair into hops: after the pit, after the river
  rollers: [{ from: 494, to: 548, height: 0.3, length: 8 }, { from: 660, to: 684, height: 0.27, length: 7 }],
  river: { from: 574, to: 647 },                    // a gorge with a meltwater river: hop the floes (FLOES)
  lane: { from: 692, to: 723 },                     // a bowling lane, down to...
  pins: 724,                                        // ...ten cheap chairs standing like pins (the head pin's s)
  jump: { lip: 816 },                               // a ski jump: its shape is JUMP, about the lip
  office: { from: 948, to: 1032 },
  finish: 1055,
};

// The ski jump, as extra steepness on top of the centreline's own (metres down per metre along) at metres from the
// lip: the in-run steepens, the table flattens to a lip that points a little up, the knoll falls away under it, the
// landing hill gets steeper further down (so a long jump lands as softly as a short one), and it eases out flat.
// Tuned on a point mass with the ride's physics, and measured in the game: off the lip at 85 to 90 km/h, a jump with
// the lever flies 50 to 55 m tucked (W held through the flight), 43 m sitting up and 18 m without it, 4 m over the
// snow, and lands at under 5 m/s into it (a wheel goes at 10): the hill steepens to 50 degrees to meet a long flight.
const JUMP = [[-56, 0], [-48, 0.6], [-14, 0.6], [-3, -0.11], [0, -0.11], [4, 0.1], [24, 0.35], [44, 0.9], [56, 1.2],
  [84, 0]];

// The river: the banks close in as rock walls (a gorge, too steep to ride round it), and between them water with ice
// floes, their tops level with the piste. Each floe is [from, to, left, right] in s and d; the gaps between them want
// the lever. One floe is split down the middle: pick a side.
export const RIVER = { width: PISTE + 1, wall: 5.5, water: 0.5, bed: 2.6 };
export const FLOES = [[578, 590.5, -9, 9], [595, 607, -9, -0.6], [595, 607, 1.6, 9], [612, 623.5, -2.6, 9],
  [629, 641, -9, 9]];

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ICY = new THREE.Color('#bfe0fb'), LIP = new THREE.Color('#4f86c6'), ROCK = new THREE.Color('#8f8aa8');
const BED = new THREE.Color('#2c5a96'), FLOE = new THREE.Color('#e4f2ff');

// The ski jump's extra steepness u metres from its lip, eased between the points of JUMP.
function jumpGrade(u) {
  if (u <= JUMP[0][0] || u >= JUMP[JUMP.length - 1][0]) return 0;
  let k = 0;
  while (u > JUMP[k + 1][0]) k++;
  const [u0, e0] = JUMP[k], [u1, e1] = JUMP[k + 1];
  return e0 + (e1 - e0) * smooth(u0, u1, u);
}

// Whether (s, d) is on a floe: inside one's box, its edges broken up a little so they look like ice.
function onFloe(s, d) {
  for (const [from, to, left, right] of FLOES) {
    const ragged = 0.45 * Math.sin(d * 1.7 + from) + 0.3 * Math.sin(d * 3.1 - from * 0.7);
    const side = 0.35 * Math.sin(s * 1.3 + left) + 0.25 * Math.sin(s * 2.9 + right);
    if (s > from + ragged && s < to - ragged && d > left + side && d < right - side) return true;
  }
  return false;
}

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(PATH.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    curve.arcLengthDivisions = 4000;
    const n = Math.floor(curve.getLength() / STEP);
    const points = curve.getSpacedPoints(n);
    this.count = points.length;
    this.length = (this.count - 1) * STEP;
    this.px = new Float32Array(this.count); this.py = new Float32Array(this.count); this.pz = new Float32Array(this.count);
    this.tx = new Float32Array(this.count); this.tz = new Float32Array(this.count);
    this.hs = new Float32Array(this.count);          // horizontal length of the segment to the next sample
    this.tilt = new Float32Array(this.count);        // the banking: height gained per metre to the right
    this.probe = {};
    points.forEach((p, i) => { this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z; });
    const heading = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.count - 1, i + 1);
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      heading[i] = Math.atan2(dx, dz);
      if (i < this.count - 1) this.hs[i] = Math.hypot(this.px[i + 1] - this.px[i], this.pz[i + 1] - this.pz[i]);
    }
    this.hs[this.count - 1] = this.hs[this.count - 2];
    // the ski jump's drop, summed down the way
    let drop = 0;
    for (let i = 1; i < this.count; i++) {
      drop += jumpGrade((i - 0.5) * STEP - FEATURES.jump.lip) * this.hs[i - 1];
      this.py[i] -= drop;
    }
    // the bends bank: the outside rises, by the curvature smoothed over 15 m either way
    const span = Math.round(15 / STEP);
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - span), b = Math.min(this.count - 1, i + span);
      const turn = Math.atan2(Math.sin(heading[b] - heading[a]), Math.cos(heading[b] - heading[a])) / ((b - a) * STEP);
      // turning towards +x (heading growing) is a left turn here: the outside is on the right
      this.tilt[i] = THREE.MathUtils.clamp(turn * 10, -0.15, 0.15);
    }
  }

  // The nearest spot on the centreline: sample index i, s (metres from the top) and d (metres to the right).
  // hint: the last index found, so a moving thing only searches nearby.
  locate(x, z, hint = -1, out = {}) {
    const window = hint < 0 ? this.count : 30;
    const from = hint < 0 ? 0 : Math.max(0, hint - window), to = hint < 0 ? this.count - 1 : Math.min(this.count - 1, hint + window);
    let best = from, bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const dx = x - this.px[i], dz = z - this.pz[i], dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (hint >= 0 && (best === from || best === to) && from > 0 && to < this.count - 1 && bestD > 900) {
      return this.locate(x, z, -1, out);           // far off the window: look everywhere
    }
    // between two samples the way down turns smoothly from one's tangent to the next one's, and the spot is where
    // the line across at that turn passes through the point: so s and d run on without a step from one sample to
    // the next, even far out to the side of a bend
    const i = best, u = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
    let k = THREE.MathUtils.clamp(u >= 0 ? i : i - 1, 0, this.count - 2), f = 0;
    for (let hop = 0; hop < 3; hop++) {
      f = this.across(k, x, z);
      if (f < 0 && k > 0) k--;
      else if (f > 1 && k < this.count - 2) k++;
      else break;
    }
    f = THREE.MathUtils.clamp(f, k === 0 ? -Infinity : 0, k === this.count - 2 ? Infinity : 1);
    const tx = this.tx[k] + (this.tx[k + 1] - this.tx[k]) * f, tz = this.tz[k] + (this.tz[k + 1] - this.tz[k]) * f;
    const l = Math.hypot(tx, tz);
    const cx = this.px[k] + (this.px[k + 1] - this.px[k]) * f, cz = this.pz[k] + (this.pz[k + 1] - this.pz[k]) * f;
    out.i = f > 0.5 ? k + 1 : k;
    out.s = THREE.MathUtils.clamp((k + f) * STEP, 0, this.length);
    out.d = (-(x - cx) * tz + (z - cz) * tx) / l;   // right = (-tz, tx)
    return out;
  }

  // Where along the segment from sample k to k + 1 (0..1) the point lies: the f at which the point is straight
  // across from the segment, with the tangent turning linearly along it. A quadratic in f.
  across(k, x, z) {
    const ax = x - this.px[k], az = z - this.pz[k];
    const dx = this.px[k + 1] - this.px[k], dz = this.pz[k + 1] - this.pz[k];
    const ex = this.tx[k + 1] - this.tx[k], ez = this.tz[k + 1] - this.tz[k];
    const a = -(dx * ex + dz * ez), b = ax * ex + az * ez - (dx * this.tx[k] + dz * this.tz[k]);
    const c = ax * this.tx[k] + az * this.tz[k];
    if (Math.abs(a) < 1e-9) return -c / b;
    const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
    const f1 = (-b + root) / (2 * a), f2 = (-b - root) / (2 * a), guess = -c / b;
    return Math.abs(f1 - guess) < Math.abs(f2 - guess) ? f1 : f2;
  }

  // The centreline's height and tilt at s, between samples.
  sample(s) {
    const f = THREE.MathUtils.clamp(s / STEP, 0, this.count - 1), i = Math.min(this.count - 2, Math.floor(f)), k = f - i;
    return { y: this.py[i] + (this.py[i + 1] - this.py[i]) * k, tilt: this.tilt[i] + (this.tilt[i + 1] - this.tilt[i]) * k };
  }

  // The snow's height at (s, d), and whether it's a hole (the crevasse, the river) with the rim's height.
  surfaceHeight(s, d, out = {}) {
    const { y, tilt } = this.sample(s);
    const a = Math.abs(d), K = FEATURES.kicker, C = FEATURES.crevasse, M = FEATURES.moguls, R = FEATURES.river;
    let h = 0.01 * Math.min(a, PISTE) ** 2;                         // the dish: 0.42 m up at the piste's edge
    if (a > PISTE) h += BANK_HEIGHT * smooth(0, BANK, a - PISTE);   // the banks, flat on top
    if (a > PISTE + BANK) h += 0.05 * (a - PISTE - BANK) + 0.12 * Math.sin(s * 0.41 + d * 0.7) * Math.sin(s * 0.13);
    const gorge = this.gorge(s);
    if (gorge > 0) {
      // the walls, then the mountainside going on up behind them; the river's bed between them is flat
      const wall = RIVER.wall * smooth(RIVER.width, RIVER.width + 1.6, a) + 0.6 * Math.max(0, a - RIVER.width - 1.6);
      h += gorge * (wall - h);
    }
    h += y;
    h += tilt * THREE.MathUtils.clamp(d, -EDGE, EDGE);
    if (s > K.from && s <= K.to) {
      const t = (s - K.from) / (K.to - K.from);
      h += K.height * t ** 1.6 * (1 - smooth(PISTE + 0.2, PISTE + 1.4, a));
    }
    if (s > M.from && s < M.to && a < PISTE + 0.5) {
      const fade = smooth(M.from, M.from + 5, s) * (1 - smooth(M.to - 5, M.to, s)) * (1 - smooth(PISTE - 1.5, PISTE, a));
      h += M.height * fade * Math.sin(0.8 * s + 0.6 * d) * Math.sin(0.9 * d - 0.25 * s + 0.6);
    }
    for (const B of FEATURES.rollers) {
      if (s > B.from && s < B.to && a < PISTE + 0.5) {
        const fade = smooth(B.from, B.from + 4, s) * (1 - smooth(B.to - 4, B.to, s)) * (1 - smooth(PISTE - 1.5, PISTE, a));
        h += B.height * fade * Math.sin(2 * Math.PI * (s - B.from) / B.length + 0.12 * d);
      }
    }
    out.rim = h;
    out.hole = s > C.from && s < C.to && a < EDGE;
    if (out.hole) h -= C.depth;
    out.water = s > R.from && s < R.to && a < RIVER.width + 0.4 && !onFloe(s, d);
    if (out.water) { h = y - RIVER.bed; out.hole = true; }
    if (a > EDGE) { h = y - 80; out.hole = true; }
    out.y = h;
    return out;
  }

  height(s, d) { return this.surfaceHeight(s, d).y; }

  // How much of the gorge there is at s: the banks turn into its walls over the metres before the river, and back
  // after it.
  gorge(s) {
    const R = FEATURES.river;
    return s > R.from - 16 && s < R.to + 12 ? smooth(R.from - 16, R.from - 3, s) * (1 - smooth(R.to + 2, R.to + 12, s)) : 0;
  }

  // Whether (s, d) is the river's water, between the floes.
  wet(s, d) { return this.surfaceHeight(s, d, this.probe).water; }

  surface(s, d) {
    const a = Math.abs(d), I = FEATURES.ice;
    if (s > I.from && s < I.to && a < PISTE + 1.5) return 'ice';
    if (a < PISTE + 0.4) return 'piste';
    return a < PISTE + BANK ? 'bank' : 'powder';
  }

  // Everything the physics needs under a point: the height y, the normal, the surface, where it is (s, d, i), and
  // for the crevasse the rim's height.
  ground(x, z, hint = -1, out = { normal: new THREE.Vector3() }) {
    const at = this.locate(x, z, hint, out);
    this.surfaceHeight(at.s, at.d, out);
    // the slope from the height either way along and across, turned into the world
    const e = 0.15, i = at.i;
    const dhds = (this.height(at.s + e, at.d) - this.height(at.s - e, at.d)) / (2 * e * this.hs[i] / STEP);
    const dhdd = (this.height(at.s, at.d + e) - this.height(at.s, at.d - e)) / (2 * e);
    const tx = this.tx[i], tz = this.tz[i], rx = -tz, rz = tx;
    out.normal.set(-(dhds * tx + dhdd * rx), 1, -(dhds * tz + dhdd * rz)).normalize();
    out.surface = this.surface(at.s, at.d);
    return out;
  }

  // The flat frame at s: the centreline point, the way down (tangent) and right.
  frame(s, out = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() }) {
    const f = THREE.MathUtils.clamp(s / STEP, 0, this.count - 1), i = Math.min(this.count - 2, Math.floor(f)), k = f - i;
    out.pos.set(this.px[i] + (this.px[i + 1] - this.px[i]) * k, this.sample(s).y, this.pz[i] + (this.pz[i + 1] - this.pz[i]) * k);
    out.tangent.set(this.tx[i] + (this.tx[i + 1] - this.tx[i]) * k, 0, this.tz[i] + (this.tz[i + 1] - this.tz[i]) * k).normalize();
    out.right.set(-out.tangent.z, 0, out.tangent.x);
    return out;
  }

  // A point on the snow at (s, d).
  point(s, d, target = new THREE.Vector3()) {
    const { pos, right } = this.frame(s);
    target.copy(pos).addScaledVector(right, d);
    target.y = this.height(s, d);
    return target;
  }

  // The snow as meshes in 50 m chunks, so the ones behind the camera are culled.
  meshes() {
    const group = new THREE.Group();
    group.name = 'piste';
    const columns = [];
    for (let d = -PISTE; d <= PISTE + 1e-6; d += 0.5) columns.push(d);
    for (let k = 1; k <= 10; k++) { const d = PISTE + BANK * k / 10; columns.push(d, -d); }
    for (let k = 1; k <= 5; k++) { const d = PISTE + BANK + POWDER * k / 5; columns.push(d, -d); }
    for (const d of [RIVER.width - 0.5, RIVER.width, RIVER.width + 0.4, RIVER.width + 0.8, RIVER.width + 1.6]) {
      columns.push(d, -d);
    }
    columns.push(EDGE + 0.6, -EDGE - 0.6, EDGE + 4, -EDGE - 4);
    columns.sort((a, b) => a - b);
    const material = toon('#ffffff', { vertexColors: true, outline: 'rock' });
    const rows = Math.round(50 / STEP);
    for (let start = 0; start < this.count - 1; start += rows) {
      const end = Math.min(this.count - 1, start + rows);
      group.add(this.chunk(start, end, columns, material));
    }
    group.add(this.river(), this.gorgeWalls());
    return group;
  }

  // The rows the gorge's rock walls are drawn for (gorgeWalls), which the snow leaves out.
  gorgeRows() {
    const R = FEATURES.river;
    return [Math.ceil((R.from - 16) / STEP), Math.floor((R.to + 12) / STEP)];
  }

  // The gorge's walls in the climb's painted rock (materials.js): layers, cracks and lichen, snow dripping over the
  // lip. The same surface the chair rides (it only meets the foot), on more points, nudged in and out a little so
  // the facets read as rock; its edges are the snow's own points, so the two meet without a seam. Where the gorge
  // fades in and out, the snow line comes down over the wall until it's all snow.
  gorgeWalls() {
    const W = RIVER.width, [i0, i1] = this.gorgeRows();
    const profile = [0, 0.2, 0.38, 0.4, 0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.45, 1.6].map(x => W + x);
    const n = profile.length, positions = [], drops = [], index = [], probe = {};
    const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
    const heights = new Array(n);
    for (const side of [-1, 1]) {
      const base = drops.length;
      for (let i = i0; i <= i1; i++) {
        const s = i * STEP, rx = -this.tz[i], rz = this.tx[i], g = this.gorge(s);
        profile.forEach((a, k) => { heights[k] = this.surfaceHeight(s, side * a, probe).y; });
        const lip = heights[n - 1];
        profile.forEach((a, k) => {
          let d = side * a, y = heights[k];
          if (k > 0 && k < n - 1) {
            // out of the surface along its normal across the wall, more higher up, where the chair can't get to
            const slope = (heights[k + 1] - heights[k - 1]) / (profile[k + 1] - profile[k - 1]), len = Math.hypot(slope, 1);
            const rise = y - heights[0];
            const jag = 0.55 * Math.sin(s * 0.9 + k * 1.3 + side * 2.1) * Math.sin(s * 0.37 - k * 0.7 + side)
              + 0.45 * (2 * hash(s * 2.3 + side * 17, k * 3.1) - 1);
            const push = 0.16 * g * smooth(0.15, 1.2, rise) * jag;
            d -= side * push * slope / len;
            y += push / len;
          }
          positions.push(this.px[i] + rx * d, y, this.pz[i] + rz * d);
          drops.push(lip - y - 7 * (1 - g));
        });
      }
      for (let r = 0; r < i1 - i0; r++) {
        for (let k = 0; k < n - 1; k++) {
          const a = base + r * n + k, b = a + 1, c = a + n, e = c + 1;
          if (side > 0) index.push(a, b, c, b, e, c); else index.push(a, c, b, b, c, e);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aDrop', new THREE.Float32BufferAttribute(drops, 1));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, rock());
    mesh.name = 'gorge walls';
    mesh.receiveShadow = true;                    // like the snow, it casts none: the bank past it isn't in its lee
    return mesh;
  }

  // The river's water: level across, running down with the gorge, a little see-through, with white foam round the
  // floes and along the walls.
  river() {
    const R = FEATURES.river, positions = [], colors = [], index = [];
    const water = new THREE.Color('#5aaeea'), foam = new THREE.Color('#f4fbff'), color = new THREE.Color();
    const from = Math.floor((R.from - 1) / STEP), to = Math.ceil((R.to + 1) / STEP), across = [];
    for (let d = -RIVER.width - 0.5; d <= RIVER.width + 0.5 + 1e-6; d += 0.5) across.push(d);
    for (let i = from; i <= to; i++) {
      const s = i * STEP, y = this.py[i] - RIVER.water, rx = -this.tz[i], rz = this.tx[i];
      for (const d of across) {
        positions.push(this.px[i] + rx * d, y, this.pz[i] + rz * d);
        let near = Math.abs(d) > RIVER.width - 0.6;
        for (const [ds, dd] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) near ||= !this.wet(s + ds, d + dd);
        color.copy(water).lerp(foam, near ? 0.7 : 0);
        colors.push(color.r, color.g, color.b);
      }
    }
    const n = across.length;
    for (let i = 0; i < to - from; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = a + n, e = c + 1;
        index.push(a, b, c, b, e, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, toon('#ffffff', { vertexColors: true, outline: false, transparent: true,
      opacity: 0.86 }));
    mesh.name = 'river';
    mesh.receiveShadow = true;
    return mesh;
  }

  chunk(start, end, columns, material) {
    const C = FEATURES.crevasse, K = FEATURES.kicker, J = FEATURES.jump, R = FEATURES.river;
    const positions = [], colors = [], index = [];
    const color = new THREE.Color(), probe = {};
    const nc = columns.length, W = RIVER.width, [g0, g1] = this.gorgeRows();
    const wall = j => Math.sign(columns[j]) === Math.sign(columns[j + 1]) && Math.abs(columns[j]) >= W - 1e-6
      && Math.abs(columns[j + 1]) >= W - 1e-6 && Math.abs(columns[j]) <= W + 1.6 + 1e-6
      && Math.abs(columns[j + 1]) <= W + 1.6 + 1e-6;
    for (let i = start; i <= end; i++) {
      const s = i * STEP, rx = -this.tz[i], rz = this.tx[i];
      columns.forEach((d, j) => {
        const a = Math.abs(d);
        let y;
        if (a > EDGE) y = this.sample(s).y + this.tilt[i] * Math.sign(d) * EDGE + (a > EDGE + 1 ? -40 : -3);
        else y = this.surfaceHeight(s, d, probe).y;
        positions.push(this.px[i] + rx * d, y, this.pz[i] + rz * d);
        const surface = this.surface(s, d);
        if (a > EDGE) color.set('#8f8aa8');                                   // the rock face of the drop
        else if (probe.water) color.copy(BED);
        else if (probe.hole) color.set(probe.rim - y > C.depth * 0.5 ? '#4f86c6' : '#86bce9');
        else if (surface === 'ice') color.set(j % 2 ? '#bfe2fb' : '#d2ecff');
        else if (surface === 'piste') color.setScalar(j % 2 ? 1 : 0.93);    // corduroy from the groomer
        else if (surface === 'powder') color.setRGB(0.95, 0.97, 1);
        else color.setScalar(1);
        if (s > K.from && s <= K.to && a < PISTE + 1) color.lerp(new THREE.Color('#9cc4ee'), s > K.to - 0.6 ? 0.8 : 0.25);
        // the gorge: rock where its walls are steep, snow on top; the floes icy
        const gorge = this.gorge(s);
        if (gorge > 0 && a > RIVER.width + 0.2 && a < RIVER.width + 1.7) color.lerp(ROCK, gorge);
        if (s > R.from && s < R.to && a < RIVER.width + 0.4 && !probe.water) color.lerp(FLOE, 0.7);
        // the ski jump: two icy tracks down the in-run, and a blue lip
        const u = s - J.lip;
        if (u > -44 && u < 0 && Math.abs(a - 0.75) < 0.3) color.lerp(ICY, 0.8);
        if (u > -1 && u <= 0 && a < PISTE) color.lerp(LIP, 0.85);
        colors.push(color.r, color.g, color.b);
      });
    }
    for (let i = 0; i < end - start; i++) {
      const walled = start + i >= g0 && start + i + 1 <= g1;       // the gorge's rock walls stand there instead
      for (let j = 0; j < nc - 1; j++) {
        if (walled && wall(j)) continue;
        const a = i * nc + j, b = a + 1, c = a + nc, e = c + 1;
        index.push(a, b, c, b, e, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}
