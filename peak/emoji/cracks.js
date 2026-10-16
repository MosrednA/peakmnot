// The cracks in the snow (where: field.js, crack()): a jagged crack across a passage that holds for a moment once
// Mnot steps on it, then gives way into a hole, shut both ways from then on. Running, Mnot is over before it goes;
// too slow, it drops in and scrambles out on the side it came from (main.js), and the way round is the only way now.
// update() says what happened; main.js does the rest (the fall, the sounds, telling the field the passage is shut).
// When the list is done, a few more passages crack open by themselves and give way (field.js, collapse(); quake()).
// The hole is flat, painted on the snow, but its far wall and bottom shift with the camera as a real pit's would.
import * as THREE from 'three';
import { noOutline } from '../look/look.js';
import { CELL, seeded } from './field.js';

// depth: m across the hole at its middle; hold: s the snow holds once stepped on; near: m before the hole's edge that
// Mnot's middle sets it off
export const CRACK = { depth: 1.05, hold: 0.45, near: 0.15 };
// the list done: s before the first of the passages giving way cracks, between one and the next (the nearest to Mnot
// first), and how long each holds
const QUAKE = { wait: 0.1, apart: 0.08, hold: 0.3 };
const WIDE = CELL;                                // m along the passage: wall to wall
const OPEN = 0.22;                                // s the hole takes to open
const PIT = 0.8;                                  // m deep, as the camera sees it
const STEPS = 16;                                 // points along each side of the hole's outline
const ZIGS = 9;                                   // the crack's zigs and zags
// the hole's depth along it (k from -1 to 1, end to end): full in the middle, closing at the ends
const profile = k => Math.sqrt(Math.max(0, 1 - k ** 6));
const back = g => 1 + 2.7 * (g - 1) ** 3 + 1.7 * (g - 1) ** 2;      // 0 to 1, a little too far and back
const flat = color => noOutline(new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true,
  polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
// the crack, then the hole: its icy rim, its far wall from the top down, and its bottom, drawn in that order
const LOOK = { crack: flat('#5b6f9e'), rim: flat('#cfe3f8'), wall: flat('#7891c4'), low: flat('#3d5487'),
  deep: flat('#161d36') };
const ORDER = { crack: 1, rim: 1, wall: 2, low: 3, deep: 4 };

const hash = key => [...key].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

// One crack's shapes, in its own frame: x along the passage, y across it (the shapes lie flat once turned).
function shapes(key) {
  const rand = seeded(hash(key));
  const jag = Array.from({ length: 2 * (STEPS + 1) }, () => rand() - 0.5);
  // round the hole at half-depth d (m), its edges jagged by j (m) times the same jags each time, so they nest
  const ring = (d, j) => {
    const top = [], bottom = [];
    for (let i = 0; i <= STEPS; i++) {
      const x = -WIDE / 2 + WIDE * i / STEPS, k = profile(2 * x / WIDE);
      top.push(new THREE.Vector2(x, (d + j * jag[i]) * k));
      if (i > 0 && i < STEPS) bottom.push(new THREE.Vector2(x, -(d + j * jag[STEPS + 1 + i]) * k));
    }
    return new THREE.Shape([...top, ...bottom.reverse()]);
  };
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
  const half = CRACK.depth / 2;
  return { crack: [new THREE.Shape([...line, ...under.reverse()]), ...forks], rim: ring(half + 0.09, 0.14),
    hole: ring(half, 0.12) };
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
  // going; side: the side of it Mnot was last on, off it (-1 or 1, across)
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
      holder.add(line, hole);
      this.group.add(holder);
      const finale = field.finale.includes(key);
      const k = { key, at, axis, holder, line, hole, low, deep, finale, state: finale ? 'hidden' : 'whole', t: 0,
        hold: CRACK.hold, side: 0, puff: 0 };
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

  // The crack not given way yet that `pos` is over, or within `near` m of, if any.
  near(pos, near) {
    return this.list.find(k => (k.state === 'whole' || k.state === 'going') && this.over(k, pos, near)) ?? null;
  }

  // The list done: the passages that give way at the end crack, one after another from `pos` out, and go.
  quake(pos) {
    const far = k => Math.hypot(k.at.x - pos.x, k.at.z - pos.z);
    this.list.filter(k => k.finale).sort((a, b) => far(a) - far(b)).forEach((k, i) =>
      Object.assign(k, { state: 'going', t: -QUAKE.wait - i * QUAKE.apart, hold: QUAKE.hold }));
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
        Object.assign(k, { state: 'going', t: 0 });
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
    k.hole.visible = open;
    if (going) {
      // the crack widening and trembling, the snow crumbling along it
      const g = Math.min(1, k.t / k.hold);
      k.line.scale.z = 1 + 2.5 * g * g;
      k.line.position.z = 0.03 * g * Math.sin(k.t * 90);
      k.puff -= dt;
      if (k.puff <= 0) {
        k.puff = 0.07;
        this.burst(k, 1, { puffs: 1, flakes: 2, size: 0.4, up: 0.3, spread: 0.2 });
      }
    } else if (open) {
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
      k.line.position.z = 0;
    }
  }

  // snow puffs along a crack
  burst(k, n, opts) {
    const at = new THREE.Vector3();
    for (let i = 0; i < n; i++) this.puffs.snow(this.place(k, (Math.random() - 0.5) * (WIDE - 0.6), 0, at), opts);
  }
}
