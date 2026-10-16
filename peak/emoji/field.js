// The emoji field: a grid of cells on the snow with low snow walls between some of them (a loose maze you can see
// over), an emoji standing on many of the cells, and where Mnot can walk. Made from a seed, so R brings the same
// field back and a link with ?seed= shows a friend the same one.
//
// The list is `order`: the emojis to fetch, in that order. Every other emoji on the field is a wrong one, and so is a
// listed one fetched too early. The field is only ever dealt so that each next one on the list can be reached from
// the one before without passing a cell with a wrong one on it (`clear`), so a run is never lost before it starts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from '../look/look.js';

export const CELL = 3;                    // m a cell
const WALL = { h: 0.62, t: 0.42 };        // the snow walls: how high, how thick (m); Mnot can't step over them
const SPREAD = 3;                         // cells (rows and columns added) at least between one listed emoji and the next
const FREE = 1;                           // cells round the start kept free

// mulberry32: a small seeded random, 0..1
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Field {
  // cols × rows cells; open: the part of a perfect maze's inner walls knocked through (0 a real maze, 1 no walls);
  // list: how many emojis to fetch; wrong: how many others stand about; names: the sticker sheet's names
  constructor({ cols = 9, rows = 7, seed = 1, open = 0.5, list = 5, wrong = 24, names }) {
    Object.assign(this, { cols, rows, seed });
    const rand = seeded(seed);
    this.start = [Math.floor(cols / 2), 0];
    this.walls = this.maze(rand, open);
    this.deal(rand, names, list, wrong);
    this.group = new THREE.Group();
    this.group.name = 'the emoji field';
    this.boxes = this.build();
  }

  // ------------------------------------------------------------------ cells

  key(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  // The middle of a cell on the snow. Column 0 is on the left of the screen (the camera looks along +z, so its right
  // is -x), row 0 nearest the camera.
  centre(c, r, to = new THREE.Vector3()) { return to.set(((this.cols - 1) / 2 - c) * CELL, 0, (r + 0.5) * CELL); }
  cellAt(pos) {
    return [THREE.MathUtils.clamp(Math.round((this.cols - 1) / 2 - pos.x / CELL), 0, this.cols - 1),
      THREE.MathUtils.clamp(Math.floor(pos.z / CELL), 0, this.rows - 1)];
  }

  // the wall between a cell and the next to its east (+c) or north (+r)
  wallKey(c, r, side) { return `${side}${c},${r}`; }
  // the cells next to a cell that a wall doesn't shut off
  *ways(c, r) {
    if (c + 1 < this.cols && !this.walls.has(this.wallKey(c, r, 'e'))) yield [c + 1, r];
    if (c > 0 && !this.walls.has(this.wallKey(c - 1, r, 'e'))) yield [c - 1, r];
    if (r + 1 < this.rows && !this.walls.has(this.wallKey(c, r, 'n'))) yield [c, r + 1];
    if (r > 0 && !this.walls.has(this.wallKey(c, r - 1, 'n'))) yield [c, r - 1];
  }

  // A perfect maze (a depth-first carve from the start), then a part of its inner walls knocked through, so there
  // are loops and ways round. The outer edge is walled all round.
  maze(rand, open) {
    const walls = new Set();
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (c + 1 < this.cols) walls.add(this.wallKey(c, r, 'e'));
        if (r + 1 < this.rows) walls.add(this.wallKey(c, r, 'n'));
      }
    }
    const seen = new Set([this.key(...this.start)]), stack = [this.start];
    while (stack.length) {
      const [c, r] = stack[stack.length - 1];
      const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]
        .filter(([a, b]) => this.inside(a, b) && !seen.has(this.key(a, b)));
      if (!next.length) { stack.pop(); continue; }
      const [a, b] = next[Math.floor(rand() * next.length)];
      walls.delete(a > c || b > r ? this.wallKey(c, r, a > c ? 'e' : 'n') : this.wallKey(a, b, a < c ? 'e' : 'n'));
      seen.add(this.key(a, b));
      stack.push([a, b]);
    }
    for (const wall of [...walls]) if (rand() < open) walls.delete(wall);
    return walls;
  }

  // The shortest way from one cell to another past no blocked cell (a Set of keys; the goal itself may be one), as
  // a list of cells from the first step to the goal, or null.
  route(from, to, blocked = new Set()) {
    const goal = this.key(...to), back = new Map([[this.key(...from), null]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      if (this.key(c, r) === goal) {
        const way = [];
        for (let at = [c, r]; at && this.key(...at) !== this.key(...from); at = back.get(this.key(...at))) way.unshift(at);
        return way;
      }
      for (const [a, b] of this.ways(c, r)) {
        const k = this.key(a, b);
        if (back.has(k) || (blocked.has(k) && k !== goal)) continue;
        back.set(k, [c, r]);
        queue.push([a, b]);
      }
    }
    return null;
  }

  // The cells to stay off on the way to the list's n-th: every emoji still standing but that one.
  blocked(n, emojis = this.emojis) {
    const keep = this.order[n];
    return new Set(emojis.filter((e, i) => i !== keep && !e.taken).map(e => this.key(...e.cell)));
  }

  // Can the list be fetched in order, from the start, past no wrong emoji?
  clear(emojis) {
    let at = this.start;
    for (let n = 0; n < this.order.length; n++) {
      const goal = emojis[this.order[n]].cell;
      const blocked = new Set(emojis.filter((e, i) => i !== this.order[n] && !(e.listed >= 0 && e.listed < n))
        .map(e => this.key(...e.cell)));
      if (!this.route(at, goal, blocked)) return false;
      at = goal;
    }
    return true;
  }

  // The emojis: `list` of them to fetch, spread over the field, then up to `wrong` others, each kept only if the
  // list can still be fetched past them (a later listed one can shut the way to an earlier one too). Every sticker
  // is on the field once.
  deal(rand, names, list, wrong) {
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const near = ([c, r], [a, b]) => Math.abs(c - a) + Math.abs(r - b);
    const cells = [];
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < this.rows; r++) if (near([c, r], this.start) > FREE) cells.push([c, r]);
    shuffle(cells);
    const pool = shuffle([...names]);
    this.emojis = [];
    this.order = [];
    let last = this.start;
    for (let n = 0; n < list && cells.length; n++) {
      const fits = cell => {
        this.order.push(this.emojis.length);
        this.emojis.push({ cell, listed: n });
        const ok = this.clear(this.emojis);
        this.emojis.pop();
        this.order.pop();
        return ok;
      };
      // the first cell far enough from the last that keeps the list fetchable, else the first that keeps it so
      let i = cells.findIndex(cell => near(cell, last) >= SPREAD && fits(cell));
      if (i < 0) i = cells.findIndex(fits);
      if (i < 0) break;
      const [cell] = cells.splice(i, 1);
      this.order.push(this.emojis.length);
      this.emojis.push({ name: pool.pop(), cell, listed: n });
      last = cell;
    }
    for (const cell of cells) {
      if (this.emojis.length - this.order.length >= wrong || !pool.length) break;
      const emoji = { name: pool[pool.length - 1], cell, listed: -1 };
      if (!this.clear([...this.emojis, emoji])) continue;
      pool.pop();
      this.emojis.push(emoji);
    }
    for (const e of this.emojis) e.at = this.centre(...e.cell);
  }

  // ------------------------------------------------------------------ the snow

  // The packed snow of the field, its walls (one instanced mesh) and their boxes for walking into.
  build() {
    const w = this.cols * CELL, d = this.rows * CELL;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.2, d + 1.2).rotateX(-Math.PI / 2), toon('#eaf1fb'));
    floor.position.set(0, 0.01, d / 2);
    floor.receiveShadow = true;
    floor.name = 'the field';
    this.group.add(floor);

    const boxes = [];
    const along = (x0, z0, x1, z1) => boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
    const t = WALL.t / 2, half = CELL / 2;
    for (const wall of this.walls) {
      const [c, r] = wall.slice(1).split(',').map(Number);
      const at = this.centre(c, r);
      if (wall[0] === 'e') along(at.x - half - t, at.z - half - t, at.x - half + t, at.z + half + t);
      else along(at.x - half - t, at.z + half - t, at.x + half + t, at.z + half + t);
    }
    const x = (this.cols / 2) * CELL;                 // the edge all round
    along(-x - t, -t, x + t, t);
    along(-x - t, d - t, x + t, d + t);
    along(-x - t, -t, -x + t, d + t);
    along(x - t, -t, x + t, d + t);

    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
    const walls = new THREE.InstancedMesh(geometry, toon('#f7faff'), boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      m.makeScale(b.x1 - b.x0, WALL.h, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, WALL.h / 2, (b.z0 + b.z1) / 2);
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = walls.receiveShadow = true;
    walls.name = 'the snow walls';
    this.group.add(walls);
    return boxes;
  }

  // Keeps a round body of radius r out of the walls (pushed out the shortest way), on the snow. Returns the push, so
  // the game can bounce off a wall it ran into.
  collide(pos, r) {
    const x0 = pos.x, z0 = pos.z;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.boxes) {
        const x = THREE.MathUtils.clamp(pos.x, b.x0, b.x1), z = THREE.MathUtils.clamp(pos.z, b.z0, b.z1);
        const dx = pos.x - x, dz = pos.z - z, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-6) { pos.x = x + dx / d * r; pos.z = z + dz / d * r; continue; }
        // the middle inside a box: out by the nearest side
        const out = [[b.x0 - r - pos.x, 0], [b.x1 + r - pos.x, 0], [0, b.z0 - r - pos.z], [0, b.z1 + r - pos.z]]
          .sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0];
        pos.x += out[0];
        pos.z += out[1];
      }
    }
    return new THREE.Vector3(pos.x - x0, 0, pos.z - z0);
  }

  get middle() { return new THREE.Vector3(0, 0, this.rows * CELL / 2); }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => o.geometry?.dispose());
  }
}
