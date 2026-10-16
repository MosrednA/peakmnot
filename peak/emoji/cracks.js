// The cracks in the snow (where: field.js, crack()): a jagged crack across a passage. Once Mnot steps on it, the snow
// holds for two seconds, time enough to cross even at a walk, and shows it running out: the crack widens and runs
// round the slab that will drop, the two ends of it closing in on the far side, and the snow trembles harder and
// crumbles faster. When the crack has gone all the way round, the slab breaks up and falls in, and the passage is a
// hole, shut both ways from then on. Still on it, Mnot drops in and scrambles out on the side it came from (main.js);
// at its edge, it teeters (teeter.js). update() says what happened; main.js does the rest (the fall, the sounds,
// telling the field the passage is shut). When the list is done, a few more passages crack open by themselves and
// give way (field.js, collapse(); quake()). The hole is flat, painted on the snow, but its far wall and bottom shift
// with the camera as a real pit's would, and the slab's chunks sink through the snow into it.
import * as THREE from 'three';
import { noOutline, toon } from '../look/look.js';
import { CELL, seeded } from './field.js';

// depth: m across the hole at its middle; hold: s the snow holds once stepped on; near: m before the hole's edge that
// Mnot's middle sets it off
export const CRACK = { depth: 1.05, hold: 2, near: 0.15 };
// the list done: s before the first of the passages giving way cracks, between one and the next (the nearest to Mnot
// first), and how long each holds
export const QUAKE = { wait: 0.1, apart: 0.08, hold: 0.3 };
const WIDE = CELL;                                // m along the passage: wall to wall
const OPEN = 0.22;                                // s the hole takes to open
const BRINK = 0.3;                                // m short of the hole's ends that Mnot goes over its edge
const PIT = 0.8;                                  // m deep, as the camera sees it
const STEPS = 16;                                 // points along each side of the hole's outline
const ZIGS = 9;                                   // the crack's zigs and zags
const SHAKE = 0.035;                              // m: the snow's trembling, at the end of the hold
const BANDS = [0, 5, 11, STEPS];                  // the slab's chunks: along the passage, between these points, and
const THICK = 0.18;                               // a side of the crack each; m thick,
const FALL = 0.75;                                // s from the slab giving way until its chunks are all under the snow
// the hole's depth along it (k from -1 to 1, end to end): full in the middle, closing at the ends
const profile = k => Math.sqrt(Math.max(0, 1 - k ** 6));
const back = g => 1 + 2.7 * (g - 1) ** 3 + 1.7 * (g - 1) ** 2;      // 0 to 1, a little too far and back
const flat = color => noOutline(new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true,
  polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
// the crack and the one running round the slab, then the hole: its icy rim, its far wall from the top down, and its
// bottom, drawn in that order; and the slab's chunks, snow as the field's is
const LOOK = { crack: flat('#5b6f9e'), fuse: flat('#3f5285'), rim: flat('#cfe3f8'), wall: flat('#7891c4'),
  low: flat('#3d5487'), deep: flat('#161d36') };
const ORDER = { crack: 1, fuse: 1, rim: 1, wall: 2, low: 3, deep: 4 };
const SNOW = toon('#f4f7ff');

const hash = key => [...key].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);
const _p = new THREE.Vector3(), _at = new THREE.Vector2();

// One crack's shapes, in its own frame: x along the passage, y across it (the shapes lie flat once turned).
function shapes(key) {
  const rand = seeded(hash(key));
  const jag = Array.from({ length: 2 * (STEPS + 1) }, () => rand() - 0.5);
  // the hole's edges at half-depth d (m), jagged by j (m) times the same jags each time, so they nest: each side end
  // to end, STEPS + 1 points, meeting at the ends
  const edges = (d, j) => {
    const top = [], bottom = [];
    for (let i = 0; i <= STEPS; i++) {
      const x = -WIDE / 2 + WIDE * i / STEPS, k = profile(2 * x / WIDE);
      top.push(new THREE.Vector2(x, (d + j * jag[i]) * k));
      bottom.push(new THREE.Vector2(x, -(d + j * jag[STEPS + 1 + i]) * k));
    }
    return { top, bottom };
  };
  // ... and the hole as one outline, round from end to end and back
  const round = ({ top, bottom }) => [...top, ...bottom.slice(1, -1).reverse()];
  const ring = (d, j) => new THREE.Shape(round(edges(d, j)));
  // the crack: a zigzag along the middle, widest there, and a few thin forks off it
  const line = [], under = [], ends = [], forks = [];
  for (let i = 0; i <= ZIGS; i++) {
    const x = -WIDE / 2 + 0.3 + (WIDE - 0.6) * i / ZIGS, k = profile(2 * x / WIDE);
    const mid = (i % 2 ? 1 : -1) * (0.03 + 0.09 * rand()) * k, w = 0.05 * (0.3 + k);
    line.push(new THREE.Vector2(x, mid + w));
    under.push(new THREE.Vector2(x, mid - w));
    ends.push(new THREE.Vector2(x, mid));
  }
  for (let n = 0; n < 3; n++) {
    const from = ends[1 + Math.floor(rand() * (ZIGS - 1))], side = rand() < 0.5 ? -1 : 1;
    const a = side * (0.5 + 0.6 * rand()), length = 0.22 + 0.25 * rand();
    const to = new THREE.Vector2(from.x + Math.cos(a) * length * (rand() < 0.5 ? -1 : 1), from.y + Math.sin(a) * length);
    forks.push(new THREE.Shape([new THREE.Vector2(from.x - 0.035, from.y), to, new THREE.Vector2(from.x + 0.035, from.y)]));
  }
  const half = CRACK.depth / 2, edge = edges(half, 0.12);
  // the slab, in chunks: a band along the passage on one side of the crack, from the hole's edge to the crack's
  // middle, a little in from each other all round; hinge: how far across its outer edge is (it swings down off it)
  const chunks = [];
  for (const [side, points] of [[1, edge.top], [-1, edge.bottom]]) {
    for (let b = 0; b < BANDS.length - 1; b++) {
      const from = BANDS[b], to = BANDS[b + 1], outer = points.slice(from, to + 1);
      const inner = [to < STEPS && points[to], from > 0 && points[from]].filter(Boolean);
      const all = [...outer, ...inner.map(p => new THREE.Vector2(p.x, 0))];
      const mid = all.reduce((m, p) => m.add(p), new THREE.Vector2()).divideScalar(all.length);
      chunks.push({ side, shape: new THREE.Shape(all.map(p => p.clone().lerp(mid, 0.06))), x: mid.x,
        hinge: outer.reduce((m, p) => m + Math.abs(p.y), 0) / outer.length, middle: from > 0 && to < STEPS });
    }
  }
  return { crack: [new THREE.Shape([...line, ...under.reverse()]), ...forks], rim: ring(half + 0.09, 0.14),
    hole: new THREE.Shape(round(edge)), fuse: round(edge), chunks };
}

// The crack running round the slab: a jagged band along the hole's outline (a closed loop of points), a quad a
// stretch, drawn in the order fuse() sets.
function fuseGeometry(loop) {
  const positions = [], n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n], len = Math.max(1e-6, a.distanceTo(b));
    const w = 0.022 + 0.012 * Math.abs(Math.sin(i * 2.3)), nx = -(b.y - a.y) / len * w, ny = (b.x - a.x) / len * w;
    // flat on the snow: shape x along, y across (as ShapeGeometry turned flat: -z)
    positions.push(a.x + nx, 0, -(a.y + ny), a.x - nx, 0, -(a.y - ny), b.x + nx, 0, -(b.y + ny),
      b.x - nx, 0, -(b.y - ny));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Array(6 * n).fill(0));
  geometry.setDrawRange(0, 0);
  return geometry;
}

// A chunk of the slab, its hinge at the pivot: snow as thick as THICK, its top a little above the snow.
function chunkMesh(c) {
  const geometry = new THREE.ExtrudeGeometry(c.shape, { depth: THICK, bevelEnabled: false, curveSegments: 1 })
    .translate(-c.x, -c.side * c.hinge, 0.02 - THICK).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, SNOW), pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.userData = { x: c.x, z: -c.side * c.hinge, side: c.side, roll: 0, delay: 0, middle: c.middle };
  return pivot;
}

export class Cracks {
  constructor(puffs) {
    this.puffs = puffs;
    this.group = new THREE.Group();
    this.group.name = 'the cracks';
    this.list = [];
  }

  // The field's cracks, all whole again, and the passages that give way at the end, not cracked yet. state: 'whole',
  // 'going' (stepped on, or quaking), 'open' or 'hidden' (one of those at the end); t: s in it; hold: s it holds once
  // going; side: the side of it Mnot was last on, off it (-1 or 1, across); from: the side Mnot stepped on it from
  set(field) {
    this.clear();
    for (const key of [...field.cracks, ...field.finale]) {
      const { at, axis } = field.boundary(key);
      const holder = new THREE.Group();
      holder.position.copy(at).setY(0.012);
      holder.rotation.y = axis === 'x' ? Math.PI / 2 : 0;
      const shape = shapes(key), mesh = (name, from = name) => {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape[from]).rotateX(-Math.PI / 2), LOOK[name]);
        m.renderOrder = ORDER[name];
        return m;
      };
      const line = mesh('crack'), hole = new THREE.Group(), low = mesh('low', 'hole'), deep = mesh('deep', 'hole');
      hole.add(mesh('rim'), mesh('wall', 'hole'), low, deep);
      // the crack round the slab, trembling with the crack itself; the slab's chunks, the middle ones going first
      const fuse = new THREE.Mesh(fuseGeometry(shape.fuse), LOOK.fuse), slab = new THREE.Group();
      fuse.renderOrder = ORDER.fuse;
      slab.add(line, fuse);
      const rand = seeded(hash(key) ^ 0x5bd1e995), chunks = new THREE.Group();
      for (const c of shape.chunks) {
        const pivot = chunkMesh(c);
        Object.assign(pivot.userData, { roll: (rand() - 0.5) * 0.5, delay: (c.middle ? 0 : 0.05) + 0.04 * rand() });
        chunks.add(pivot);
      }
      holder.add(slab, hole, chunks);
      this.group.add(holder);
      const finale = field.finale.includes(key);
      const k = { key, at, axis, holder, slab, line, fuse, loop: shape.fuse, hole, low, deep, chunks, finale,
        state: finale ? 'hidden' : 'whole', t: 0, hold: CRACK.hold, side: 0, from: 0, puff: 0 };
      this.list.push(k);
      this.look(k, 0, null);
    }
  }

  clear() {
    for (const k of this.list) {
      k.holder.removeFromParent();
      k.holder.traverse(o => o.geometry?.dispose());
    }
    this.list = [];
  }

  // a point's place in a crack's frame: along the passage (l) and across it (c), m from its middle
  frame(k, pos) {
    const dx = pos.x - k.at.x, dz = pos.z - k.at.z;
    return k.axis === 'x' ? { l: dz, c: dx } : { l: dx, c: dz };
  }
  // ... and back, as a point on the snow
  place(k, l, c, to) {
    return k.axis === 'x' ? to.set(k.at.x + c, 0, k.at.z + l) : to.set(k.at.x + l, 0, k.at.z + c);
  }

  // Is `pos` over the crack's hole (or within `near` m of its edge)?
  over(k, pos, near = 0) {
    const { l, c } = this.frame(k, pos);
    return Math.abs(l) < WIDE / 2 && Math.abs(c) < CRACK.depth / 2 * profile(2 * l / WIDE) + near;
  }

  // Is `pos` across the crack from the side Mnot stepped on it from?
  crossed(k, pos) {
    return Math.sign(this.frame(k, pos).c) === -k.from;
  }

  // The crack not given way yet that `pos` is over, or within `near` m of, if any.
  near(pos, near) {
    return this.list.find(k => (k.state === 'whole' || k.state === 'going') && this.over(k, pos, near)) ?? null;
  }

  // The open hole `pos` is over, if any.
  hole(pos) {
    return this.list.find(k => k.state === 'open' && this.over(k, pos)) ?? null;
  }

  // m across from `pos` to the crack's hole's edge (less than 0 over it; Infinity past its ends).
  gap(k, pos) {
    const { l, c } = this.frame(k, pos);
    return Math.abs(l) < WIDE / 2 ? Math.abs(c) - CRACK.depth / 2 * profile(2 * l / WIDE) : Infinity;
  }

  // The way across to the hole from `pos`, from the side it's on.
  toward(k, pos, to = new THREE.Vector3()) {
    const side = Math.sign(this.frame(k, pos).c) || k.side || 1;
    return k.axis === 'x' ? to.set(-side, 0, 0) : to.set(0, 0, -side);
  }

  // Just over the hole's edge (`inward` m in), straight across from `pos`, short of its ends.
  brink(k, pos, inward, to = new THREE.Vector3()) {
    const { l, c } = this.frame(k, pos), side = Math.sign(c) || k.side || 1;
    const along = THREE.MathUtils.clamp(l, BRINK - WIDE / 2, WIDE / 2 - BRINK);
    return this.place(k, along, side * Math.max(0, CRACK.depth / 2 * profile(2 * along / WIDE) - inward), to);
  }

  // The list done: the passages that give way at the end crack, one after another from `pos` out, and go.
  quake(pos) {
    const far = k => Math.hypot(k.at.x - pos.x, k.at.z - pos.z);
    this.list.filter(k => k.finale).sort((a, b) => far(a) - far(b)).forEach((k, i) => {
      Object.assign(k, { state: 'going', t: -QUAKE.wait - i * QUAKE.apart, hold: QUAKE.hold });
      this.fuse(k, pos);
    });
  }

  // Watching a run (main.js): a crack stepped on ('going', where Mnot is: pos) or given way ('open') when the
  // recording says, unless it has already. True if it hadn't.
  force(k, state, pos) {
    if (k.state === 'open' || state === 'going' && k.state !== 'whole') return false;
    Object.assign(k, { state, t: 0 });
    if (state === 'going') {
      k.from = Math.sign(this.frame(k, pos).c) || 1;
      this.fuse(k, pos);
    }
    if (state === 'open') this.burst(k, 7, { puffs: 2, flakes: 6, up: 0.9 });
    return true;
  }

  // The crack round the slab starts nearest `pos` (where Mnot stepped on it) and runs both ways round at once, so its
  // ends meet on the far side as the snow gives way.
  fuse(k, pos) {
    const n = k.loop.length, index = k.fuse.geometry.index;
    let from = 0;
    if (pos) {
      k.holder.updateWorldMatrix(true, false);
      const p = k.holder.worldToLocal(_p.copy(pos)), at = _at.set(p.x, -p.z);
      for (let i = 1; i < n; i++) if (k.loop[i].distanceToSquared(at) < k.loop[from].distanceToSquared(at)) from = i;
    }
    const far = i => { const d = (((i + 0.5 - from) % n) + n) % n; return Math.min(d, n - d); };
    [...Array(n).keys()].sort((a, b) => far(a) - far(b)).forEach((s, j) =>
      index.array.set([4 * s, 4 * s + 1, 4 * s + 2, 4 * s + 1, 4 * s + 3, 4 * s + 2], 6 * j));
    index.needsUpdate = true;
  }

  // Where Mnot (radius r) in the crack's hole climbs out: on the side it came from, clear of the edge.
  outside(k, pos, r, to = new THREE.Vector3()) {
    const { l, c } = this.frame(k, pos), side = k.side || Math.sign(c) || 1;
    const room = WIDE / 2 - r - 0.4;
    return this.place(k, THREE.MathUtils.clamp(l, -room, room), side * (CRACK.depth / 2 + r + 0.3), to);
  }
  // ... where it sinks in: a little further in from where it went over the edge
  inside(k, pos, to = new THREE.Vector3()) {
    const { l, c } = this.frame(k, pos);
    return this.place(k, THREE.MathUtils.clamp(l, -0.8, 0.8), 0.3 * c, to);
  }
  // ... and a point well past it from the side Mnot came from, to run for (the bot)
  beyond(k, pos, to = new THREE.Vector3()) {
    const { l, c } = this.frame(k, pos), side = k.side || Math.sign(c) || 1;
    return this.place(k, THREE.MathUtils.clamp(l, -0.6, 0.6), -side * (CRACK.depth / 2 + 1.2), to);
  }

  // Mnot at `pos` (null while it can't set one off), seen by `camera`. Returns what happened, as [what, crack]:
  // 'stepped' (one starts to go), 'opened' (one gives way) and 'under' (Mnot is over an open hole: it drops in).
  update(dt, pos, camera) {
    const happened = [];
    for (const k of this.list) {
      k.t += dt;
      if (pos && !this.over(k, pos)) k.side = Math.sign(this.frame(k, pos).c) || k.side;
      if (k.state === 'whole' && pos && this.over(k, pos, CRACK.near)) {
        Object.assign(k, { state: 'going', t: 0, from: k.side || Math.sign(this.frame(k, pos).c) || 1 });
        this.fuse(k, pos);
        happened.push(['stepped', k]);
      } else if (k.state === 'going' && k.t >= k.hold) {
        Object.assign(k, { state: 'open', t: 0 });
        happened.push(['opened', k]);
        this.burst(k, 7, { puffs: 2, flakes: 6, up: 0.9 });
      }
      if (k.state === 'open' && pos && this.over(k, pos)) happened.push(['under', k]);
      this.look(k, dt, camera);
    }
    return happened;
  }

  look(k, dt, camera) {
    const going = k.state === 'going' && k.t >= 0, open = k.state === 'open';
    k.line.visible = k.state === 'whole' || going;
    k.fuse.visible = going;
    k.hole.visible = open;
    k.chunks.visible = open && k.t < FALL;
    if (going) {
      // the crack widening, and running round the slab both ways: when its ends meet, the slab goes
      const g = Math.min(1, k.t / k.hold);
      k.line.scale.z = 1 + 2.5 * g * g;
      k.fuse.geometry.setDrawRange(0, 6 * Math.ceil(k.loop.length * (0.1 + 0.9 * g)));
      // the snow trembling harder as it goes, and crumbling along the crack faster
      const shake = SHAKE * g * g;
      k.slab.position.set(shake * Math.sin(k.t * 83), 0, shake * Math.sin(k.t * 97 + 1.3));
      k.puff -= dt;
      if (k.puff <= 0) {
        k.puff = 0.15 - 0.09 * g;
        this.burst(k, 1, { puffs: 1, flakes: 2 + Math.round(2 * g), size: 0.4, up: 0.3, spread: 0.2 });
      }
    } else if (open) {
      if (k.chunks.visible) this.crumble(k);
      k.hole.scale.z = Math.max(0.05, back(Math.min(1, k.t / OPEN)));     // opening out of the crack
      // the pit: seen from one side, its bottom (and the lower half of its wall) slides toward that side and the far
      // wall shows, as far as the opening lets it
      const half = CRACK.depth / 2, c = camera ? this.frame(k, camera.position).c : 0;
      const slide = THREE.MathUtils.clamp(c * PIT / (Math.max(0.5, camera?.position.y ?? 1) + PIT), -2 * half, 2 * half);
      for (const [layer, part] of [[k.low, 0.5], [k.deep, 1]]) {
        layer.position.z = slide * part / 2;
        layer.scale.z = Math.max(1e-3, 1 - Math.abs(slide * part) / (2 * half));
      }
    } else {
      k.line.scale.z = 1;
      k.slab.position.set(0, 0, 0);
    }
  }

  // The slab breaking up as it goes (k.t s ago): each chunk swings down off the hole's edge like a trapdoor, then drops
  // through the snow into the hole, the middle ones first.
  crumble(k) {
    for (const c of k.chunks.children) {
      const u = c.userData, s = Math.max(0, k.t - u.delay);
      const swing = Math.min(1.5, 16 * s * s), drop = s > 0.08 ? 4.9 * (s - 0.08) ** 2 : 0;
      c.position.set(u.x, -drop, u.z * (1 - 0.15 * Math.min(1, s / 0.3)));
      c.rotation.set(u.side * swing, 0, u.roll * swing);
    }
  }

  // snow puffs along a crack
  burst(k, n, opts) {
    const at = new THREE.Vector3();
    for (let i = 0; i < n; i++) this.puffs.snow(this.place(k, (Math.random() - 0.5) * (WIDE - 0.6), 0, at), opts);
  }
}
