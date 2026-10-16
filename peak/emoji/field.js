// The emoji field: a grid of cells on the snow with low snow walls between some of them (a loose maze you can see
// over), an emoji standing on many of the cells, and where Mnot can walk. Made from a seed, so R brings the same
// field back and a link with ?seed= shows a friend the same one.
//
// The list is `order`: the emojis to fetch, in that order. Every other emoji on the field is a wrong one, and so is a
// listed one fetched too early. The field is only ever dealt so that each next one on the list can be reached from
// the one before without passing a cell with a wrong one on it (`clear`), so a run is never lost before it starts.
// The middle cell is kept free: when the list is done, the prize drops there (main.js). `rate` says how hard a field
// is to play, so random fields can be dealt alike. A few passages on the way are cracked (`crack`): crossed once,
// the snow gives way behind Mnot (cracks.js), so there's no way back through them; the field stays finishable with
// all of them gone, at worst the long way round.
//
// The walls cast no shadow while playing: their shadows from the sun and their contact shade are baked into the
// field's floor once it is dealt (`bake`), soft and clean; Mnot's and the emojis' shadows stay live.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from '../look/look.js';
import { SUN_DIR } from '../look/sky.js';

export const CELL = 3;                    // m a cell
const WALL = { h: 0.62, t: 0.42 };        // the snow walls: how high, how thick (m); Mnot can't step over them
const SPREAD = 3;                         // cells (rows and columns added) at least between one listed emoji and the next
const FREE = 1;                           // cells round the start kept free
const STRIDE = 3;                         // steps at least between two cracks on the way through
const EDGE = 1.5;                         // m of floor round the outer walls, for their shadows to fall on
// The baked light: px texels a metre; soft: how soft the walls' shadows are (m); reach, dark: how far the contact
// shade spreads from a wall's foot and how dark it is there; onSun: how much of it shades the sunlit snow too (on
// the sky's light it is all); foot: how dark a wall itself is at its foot
const BAKE = { px: 32, soft: 0.07, reach: 0.3, dark: 0.5, onSun: 0.45, foot: 0.84 };

// shuffled in place, with a random 0..1
function shuffled(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
  // list: how many emojis to fetch; wrong: how many others stand about; cracks: how many cracked passages at most;
  // names: the sticker sheet's names; look: false only plans the field (the maze and the deal) without making its
  // snow and walls, to rate it
  constructor({ cols = 9, rows = 7, seed = 1, open = 0.5, list = 5, wrong = 24, cracks = 3, names, look = true }) {
    Object.assign(this, { cols, rows, seed });
    const rand = seeded(seed);
    this.start = [Math.floor(cols / 2), 0];
    this.peak = [Math.floor(cols / 2), Math.floor(rows / 2)];
    this.holes = new Set();                       // the cracked passages given way in this run (main.js): shut
    this.walls = this.maze(rand, open);
    this.deal(rand, names, list, wrong);
    this.crack(rand, cracks);
    this.group = new THREE.Group();
    this.group.name = 'the emoji field';
    if (look) this.boxes = this.build();
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
  // the wall between two cells next to each other (where there is one or not)
  edge([c, r], [a, b]) { return c !== a ? this.wallKey(Math.min(c, a), r, 'e') : this.wallKey(c, Math.min(r, b), 'n'); }
  // where a wall stands (or would): the middle of the line between its two cells, and the axis across that line
  boundary(key) {
    const [c, r] = key.slice(1).split(',').map(Number), at = this.centre(c, r);
    return key[0] === 'e' ? { at: at.setX(at.x - CELL / 2), axis: 'x' } : { at: at.setZ(at.z + CELL / 2), axis: 'z' };
  }
  // the cells next to a cell that no wall and no shut passage (a Set of wall keys) shuts off
  *ways(c, r, shut = this.holes) {
    const open = (a, b, side) => !this.walls.has(this.wallKey(a, b, side)) && !shut.has(this.wallKey(a, b, side));
    if (c + 1 < this.cols && open(c, r, 'e')) yield [c + 1, r];
    if (c > 0 && open(c - 1, r, 'e')) yield [c - 1, r];
    if (r + 1 < this.rows && open(c, r, 'n')) yield [c, r + 1];
    if (r > 0 && open(c, r - 1, 'n')) yield [c, r - 1];
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

  // The shortest way from one cell to another past no blocked cell (a Set of keys; the goal itself may be one) and no
  // shut passage, as a list of cells from the first step to the goal, or null.
  route(from, to, blocked = new Set(), shut = this.holes) {
    const goal = this.key(...to), back = new Map([[this.key(...from), null]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      if (this.key(c, r) === goal) {
        const way = [];
        for (let at = [c, r]; at && this.key(...at) !== this.key(...from); at = back.get(this.key(...at))) way.unshift(at);
        return way;
      }
      for (const [a, b] of this.ways(c, r, shut)) {
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

  // The cells to stay off on the way to the list's n-th in a run that goes right: every emoji but that one and the
  // ones fetched before it.
  standing(n, emojis = this.emojis) {
    return new Set(emojis.filter((e, i) => i !== this.order[n] && !(e.listed >= 0 && e.listed < n))
      .map(e => this.key(...e.cell)));
  }

  // Can the list be fetched in order, from the start, past no wrong emoji?
  clear(emojis) {
    let at = this.start;
    for (let n = 0; n < this.order.length; n++) {
      const goal = emojis[this.order[n]].cell;
      if (!this.route(at, goal, this.standing(n, emojis))) return false;
      at = goal;
    }
    return true;
  }

  // Every cell Mnot can get to from `from` past no blocked cell and no shut passage, as keys.
  reach(from, blocked, shut) {
    const seen = new Set([this.key(...from)]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const [a, b] of this.ways(...queue[i], shut)) {
        const k = this.key(a, b);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k);
        queue.push([a, b]);
      }
    }
    return seen;
  }

  // The legs of a run that goes right: each goal (the listed ones, then the middle) and the cells to stay off on the
  // way to it.
  legs() {
    return [...this.order.map((i, n) => [this.emojis[i].cell, this.standing(n)]), [this.peak, new Set()]];
  }

  // The steps of a run that goes right, the shortest way: [from, to] cells, through the list and on to the middle.
  path() {
    const steps = [];
    let at = this.start;
    for (const [goal, blocked] of this.legs()) {
      for (const cell of this.route(at, goal, blocked, new Set()) ?? []) {
        steps.push([at, cell]);
        at = cell;
      }
      at = goal;
    }
    return steps;
  }

  // Can the field still be finished with the passages in `shut` gone, from anywhere Mnot can get to on the way? On
  // each leg, every cell it can reach with them all still there (and the emojis to stay off stood clear of) must
  // reach the leg's goal without them.
  finishable(shut) {
    let at = this.start;
    for (const [goal, blocked] of this.legs()) {
      const back = this.reach(goal, blocked, shut);
      for (const k of this.reach(at, blocked, new Set())) if (!back.has(k)) return false;
      at = goal;
    }
    return true;
  }

  // The cracked passages (wall keys), up to `count`: on the shortest way through, crossed at most twice (the second
  // time, it's the way round), the first time straight on (a cell's run-up before it), not out of the start nor into
  // the middle, a few steps apart, and only so that the field stays finishable with all of them gone.
  crack(rand, count) {
    const steps = this.path(), crossed = new Map(), first = new Map();
    steps.forEach((step, i) => {
      const key = this.edge(...step);
      crossed.set(key, (crossed.get(key) ?? 0) + 1);
      if (!first.has(key)) first.set(key, i);
    });
    const start = this.key(...this.start), peak = this.key(...this.peak);
    const picks = [];
    for (const [key, i] of first) {
      const [a, b] = steps[i], before = steps[i - 1]?.[0];
      const straight = before && b[0] - a[0] === a[0] - before[0] && b[1] - a[1] === a[1] - before[1];
      if (straight && crossed.get(key) <= 2 && this.key(...a) !== start && this.key(...b) !== peak) picks.push(i);
    }
    this.cracks = [];
    const taken = [];
    for (const i of shuffled(picks, rand)) {
      if (this.cracks.length >= count) break;
      if (taken.some(j => Math.abs(i - j) < STRIDE)) continue;
      const key = this.edge(...steps[i]);
      if (!this.finishable(new Set([...this.cracks, key]))) continue;
      this.cracks.push(key);
      taken.push(i);
    }
  }

  // How hard the field is to play: the cells on the shortest way through the list and on to the middle (round the
  // cracks crossed already), each one that passes right by an emoji to stay off (one in a cell next to it, no wall
  // between) counted twice more, and each turn on the way half more.
  rate() {
    let at = this.start, cells = 0, close = 0, turns = 0;
    const gone = new Set(), cracked = new Set(this.cracks);
    for (const [goal, blocked] of this.legs()) {
      let from = at, heading = null;
      for (const cell of this.route(at, goal, blocked, gone) ?? []) {
        const way = `${cell[0] - from[0]},${cell[1] - from[1]}`;
        if (heading && way !== heading) turns++;
        heading = way;
        if (cracked.has(this.edge(from, cell))) gone.add(this.edge(from, cell));
        from = cell;
        cells++;
        if ([...this.ways(...cell, gone)].some(([c, r]) => blocked.has(this.key(c, r)))) close++;
      }
      at = goal;
    }
    return cells + 2 * close + 0.5 * turns;
  }

  // The emojis: `list` of them to fetch, spread over the field, then up to `wrong` others, each kept only if the
  // list can still be fetched past them (a later listed one can shut the way to an earlier one too). Every sticker
  // is on the field once.
  deal(rand, names, list, wrong) {
    const shuffle = a => shuffled(a, rand);
    const near = ([c, r], [a, b]) => Math.abs(c - a) + Math.abs(r - b);
    const cells = [];
    const peak = this.key(...this.peak);
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) if (near([c, r], this.start) > FREE && this.key(c, r) !== peak) cells.push([c, r]);
    }
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

  // The packed snow of the field with the walls' light baked in, its walls (one instanced mesh) and their boxes for
  // walking into.
  build() {
    const w = this.cols * CELL, d = this.rows * CELL;
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

    const width = w + 2 * EDGE, depth = d + 2 * EDGE;
    this.baked = this.bake(boxes, width, depth);
    this.floorMaterial = toon('#eaf1fb').clone();
    this.floorMaterial.aoMap = this.baked;
    this.floorMaterial.onBeforeCompile = bakedLight;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), this.floorMaterial);
    floor.position.set(0, 0.01, d / 2);
    floor.receiveShadow = true;                       // Mnot's and the emojis' shadows
    floor.name = 'the field';
    this.group.add(floor);

    // a little darker at the foot, where a wall meets the snow
    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
    const y = geometry.attributes.position, shade = new Float32Array(y.count * 3);
    for (let i = 0; i < y.count; i++) shade.fill(THREE.MathUtils.lerp(BAKE.foot, 1, THREE.MathUtils.smoothstep(y.getY(i), -0.5, 0.2)), i * 3, i * 3 + 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const walls = new THREE.InstancedMesh(geometry, toon('#f7faff', { vertexColors: true }), boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      m.makeScale(b.x1 - b.x0, WALL.h, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, WALL.h / 2, (b.z0 + b.z1) / 2);
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = false;                         // baked into the floor instead
    walls.receiveShadow = true;                       // Mnot's and the emojis' shadows
    walls.name = 'the snow walls';
    this.group.add(walls);
    return boxes;
  }

  // The walls' light on a floor `width` by `depth` m round the field, as a texture over it: red the contact shade
  // (1 open snow, darker at a wall's foot), green the sun (0 in a wall's shadow). A wall's shadow is its foot swept
  // away from the sun as far as its height throws it. Both are painted soft on a canvas: white shapes drawn off the
  // canvas, brought in as their own blurred shadow (the one blur every browser's canvas has).
  bake(boxes, width, depth) {
    const px = Math.min(BAKE.px, 2048 / Math.max(width, depth));
    const cw = Math.ceil(width * px), ch = Math.ceil(depth * px);
    const left = -width / 2, near = this.rows * CELL / 2 - depth / 2;
    const paint = (soft, shapes) => {
      const canvas = document.createElement('canvas');
      Object.assign(canvas, { width: cw, height: ch });
      const g = canvas.getContext('2d', { willReadFrequently: true });
      Object.assign(g, { fillStyle: '#fff', shadowColor: '#fff', shadowBlur: 2 * soft * px, shadowOffsetX: cw * 2 });
      g.beginPath();
      for (const shape of shapes) {
        shape.forEach(([x, z], k) => g[k ? 'lineTo' : 'moveTo']((x - left) * px - cw * 2, (z - near) * px));
        g.closePath();
      }
      g.fill();
      return g.getImageData(0, 0, cw, ch).data;
    };
    const foot = b => [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
    const sx = -SUN_DIR.x / SUN_DIR.y * WALL.h, sz = -SUN_DIR.z / SUN_DIR.y * WALL.h;
    const shadow = b => hull([...foot(b), ...foot(b).map(([x, z]) => [x + sx, z + sz])]);
    const sun = paint(BAKE.soft, boxes.map(shadow)), feet = paint(BAKE.reach / 2, boxes.map(foot));

    const canvas = document.createElement('canvas');
    Object.assign(canvas, { width: cw, height: ch });
    const g = canvas.getContext('2d');
    const image = g.createImageData(cw, ch), out = image.data;
    for (let i = 0; i < out.length; i += 4) {
      const close = Math.min(1, 2 * feet[i + 3] / 255);
      const ao = 1 - BAKE.dark * close * close;
      out[i] = 255 * ao;
      out[i + 1] = 255 * (1 - sun[i + 3] / 255) * (1 - BAKE.onSun * (1 - ao));
      out[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);      // its top row the field's near edge (flipY)
    texture.anisotropy = 8;
    return texture;
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
    this.baked?.dispose();
    this.floorMaterial?.dispose();
  }
}

// The convex hull of points [x, z], one way round (Andrew's monotone chain), so every shadow winds the same way and
// they fill as one.
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

// The floor's light from its baked texture (the aoMap): the sun through the walls' baked shadows (green), and where
// a live shadow (Mnot's, an emoji's) falls on a baked one, the darker of the two rather than both; the contact shade
// (red) on the sky's light, as any aoMap, and part of it on the sun's. The stage's sun is a DirectionalLight.
const SUN_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const SUN_INFO = 'getDirectionalLightInfo( directionalLight, directLight );';
function bakedLight(shader) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const at = chunk.indexOf(SUN_INFO);
  if (at < 0 || !chunk.includes(SUN_SHADOW)) {
    console.warn('field.js: three\'s sun light changed; the baked shadows are off');
    return;
  }
  const sun = chunk.slice(at)
    .replace(SUN_INFO, `${SUN_INFO}\n\t\tsunLit = bakedSun;`)
    .replace(SUN_SHADOW, SUN_SHADOW.replace('directLight.color *= ', 'sunLit = min( sunLit, ').replace(/;$/, ' );'))
    .replace('RE_Direct(', 'directLight.color *= sunLit;\n\t\tRE_Direct(');
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
    `float bakedSun = texture2D( aoMap, vAoMapUv ).g;\nfloat sunLit;\n${chunk.slice(0, at)}${sun}`);
}
