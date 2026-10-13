// The disco ball of the Konami party (moments.js): it drops in on a string over Mnot, spins, and throws coloured beams
// and spots of light about while the screen glows in time; when the party's over it flies back up. For the eye only.
// It adds no real lights (one more light makes every material compile again): the mirror tiles work out their own
// glints, and the beams and spots are see-through meshes.
import * as THREE from 'three';
import { noOutline } from '../look/look.js';
import { SUN_DIR } from '../look/scenery.js';

export const BEAT = 60 / 125;           // the party's tempo: seconds a beat
const COLORS = ['#ff4fa3', '#ffd23d', '#45d4ff', '#7dff6a', '#b06bff', '#ff8a3d'].map(c => new THREE.Color(c));
const HANG = 2.1;                       // the ball's middle over Mnot's feet
const RADIUS = 0.26;
const ROWS = 12, COLS = 20;             // the mirror tiles
const DROP = 0.8;                       // seconds to drop in, and to fly off
const TURN = 1.4;                       // radians a second
const BEAMS = 8, DOTS = 22;
const DOWN = new THREE.Vector3(0, -1, 0);
const TAU = 2 * Math.PI;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _h = new THREE.Vector3(), _k = new THREE.Vector3();

// fades from the tip (the ball) to nothing; a cone one metre long, as wide as `spread` at its end
function beamGeometry(spread) {
  const geometry = new THREE.ConeGeometry(spread, 1, 16, 1, true).translate(0, -0.5, 0);
  const pos = geometry.attributes.position, colors = [];
  for (let i = 0; i < pos.count; i++) colors.push(1, 1, 1, 0.5 * Math.pow(1 + pos.getY(i), 1.4));
  return geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
}

// a round spot of light lying flat, bright in the middle
function spotGeometry() {
  const geometry = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position, colors = [];
  for (let i = 0; i < pos.count; i++) colors.push(1, 1, 1, 0.85 * (1 - Math.hypot(pos.getX(i), pos.getZ(i))));
  return geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
}

function glow(color, opacity) {
  return noOutline(new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

export class Disco {
  constructor({ world, camera, dom = null }) {
    Object.assign(this, { world, camera });
    this.group = new THREE.Group();               // over Mnot's feet
    this.hang = new THREE.Group();                // the ball and its string, dropping in and flying off
    this.spinner = new THREE.Group();             // turns with the ball: the beams
    this.ball = this.makeBall();
    const metal = new THREE.MeshBasicMaterial({ color: '#59606b' });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.07, 10), metal);
    cap.position.y = RADIUS + 0.02;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 12, 4), noOutline(metal.clone()));
    string.position.y = RADIUS + 6;
    this.hang.add(this.ball, cap, string, this.spinner);
    this.group.add(this.hang);
    this.floor = new THREE.Group();               // the spots, where the light lands
    this.group.visible = this.floor.visible = false;
    world.group.add(this.group, this.floor);

    // beams with a spot each, and small dots from the tiles in between; each points down and out from the ball
    const spot = spotGeometry();
    this.lights = [];
    for (let i = 0; i < BEAMS + DOTS; i++) {
      const beam = i < BEAMS;
      const color = beam || i % 3 === 0 ? COLORS[i % COLORS.length] : new THREE.Color('#ffffff');
      const tilt = beam ? (i % 2 ? 0.95 : 0.6) : 0.35 + 0.8 * ((i * 0.618) % 1);
      const around = beam ? (i / BEAMS) * TAU : i * 2.4;
      const out = Math.sin(tilt);
      const dir = new THREE.Vector3(out * Math.cos(around), -Math.cos(tilt), out * Math.sin(around));
      const light = { dir, spread: 0.09, size: beam ? 0.14 : 0.06, base: beam ? 0.8 : 0.75 };
      light.spot = new THREE.Mesh(spot, glow(color, light.base));
      this.floor.add(light.spot);
      if (beam) {
        light.beam = new THREE.Mesh(beamGeometry(light.spread), glow(color, 0.35));
        light.beam.quaternion.setFromUnitVectors(DOWN, light.dir);
        this.spinner.add(light.beam);
      }
      this.lights.push(light);
    }
    for (const o of [this.group, this.floor]) o.traverse(m => { m.frustumCulled = false; });

    this.wash = dom ? this.makeWash(dom) : null;
    this.state = null;                            // 'in' | 'on' | 'off', or null when it's away
    this.t = 0;
    this.time = 0;
    this.turn = 0;
    this.near = [];                               // the rocks round about, where the light can land
    this.nearAt = new THREE.Vector3(Infinity, 0, 0);
  }

  // A ball of mirror tiles in rows: each tile shines by itself, catching the sun or a coloured light as it turns.
  makeBall() {
    const geometry = new THREE.SphereGeometry(RADIUS, COLS, ROWS).toNonIndexed();
    const pos = geometry.attributes.position, tiles = new Map();
    for (let f = 0; f < pos.count / 3; f++) {
      _v.set(0, 0, 0);
      for (let k = 0; k < 3; k++) _v.add(_k.fromBufferAttribute(pos, 3 * f + k));
      _v.normalize();
      const row = Math.min(ROWS - 1, Math.floor(Math.acos(THREE.MathUtils.clamp(_v.y, -1, 1)) / Math.PI * ROWS));
      const col = Math.floor((Math.atan2(_v.z, -_v.x) + TAU) % TAU / TAU * COLS) % COLS;
      const key = row * COLS + col;
      if (!tiles.has(key)) {
        tiles.set(key, { n: new THREE.Vector3(), faces: [], shade: 0.45 + 0.3 * ((key * 0.618) % 1) });
      }
      const tile = tiles.get(key);
      tile.n.add(_v);
      tile.faces.push(f);
    }
    this.tiles = [...tiles.values()];
    for (const tile of this.tiles) tile.n.normalize();
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  // The coloured glow round the edges of the screen, on top of the picture but under the text.
  makeWash(dom) {
    if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', mixBlendMode: 'screen',
      display: 'none' });
    dom.after(el);
    return el;
  }

  get busy() { return this.state !== null; }

  // Where the ball is now, in the world.
  ballAt(target = new THREE.Vector3()) { return this.ball.getWorldPosition(target); }

  start(feet) {
    if (this.state === 'on') return;
    if (this.state !== 'in') {
      this.t = 0;
      if (this.state === null) this.group.position.copy(feet);
    }
    this.state = 'in';
    this.group.visible = this.floor.visible = true;
  }

  leave() {
    if (this.state === null || this.state === 'off') return;
    this.state = 'off';
    this.t = 0;
  }

  update(dt, feet) {
    if (!this.state) return;
    this.t += dt;
    this.time += dt;
    const g = this.group.position, follow = 1 - Math.exp(-6 * dt);
    g.x += (feet.x - g.x) * follow;
    g.z += (feet.z - g.z) * follow;
    g.y += (feet.y - g.y) * follow;
    let drop = 0, level = 1;
    const k = Math.min(1, this.t / DROP);
    if (this.state === 'in') {
      const s = 2.2, b = k - 1;                   // back out: past the mark and settle
      drop = 4 * (1 - (1 + (s + 1) * b * b * b + s * b * b));
      level = k;
      if (k >= 1) this.state = 'on';
    } else if (this.state === 'off') {
      drop = 5 * k * k * k;
      level = 1 - k;
      if (k >= 1) { this.hide(); return; }
    }
    this.hang.position.y = HANG + drop + 0.04 * Math.sin(this.time * 2.1);
    this.turn = (this.turn + dt * TURN) % TAU;
    this.ball.rotation.y = this.spinner.rotation.y = this.turn;
    this.shine();
    this.cast(level);
    this.glowScreen(level);
  }

  hide() {
    this.state = null;
    this.group.visible = this.floor.visible = false;
    if (this.wash) this.wash.style.display = 'none';
  }

  // Each tile: a mirror, darker facing down, glinting where it throws the sun or the coloured light at the camera.
  shine() {
    const centre = this.ballAt(_k);
    const view = _v.copy(this.camera.position).sub(centre).normalize();
    const sun = _h.copy(SUN_DIR).normalize().add(view).normalize();
    const a = this.time * 2.3;
    const party = new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)).normalize().add(view).normalize();
    const color = COLORS[Math.floor(this.time / BEAT) % COLORS.length];
    const colors = this.ball.geometry.attributes.color, array = colors.array, q = this.ball.quaternion;
    for (const tile of this.tiles) {
      const n = _n.copy(tile.n).applyQuaternion(q);
      const base = tile.shade * (0.7 + 0.3 * n.y);
      const glint = 2.2 * Math.pow(Math.max(0, n.dot(sun)), 90);
      const tint = 1.6 * Math.pow(Math.max(0, n.dot(party)), 30);
      const r = base * 0.92 + glint + tint * color.r, gr = base * 0.95 + glint + tint * color.g;
      const b = base + glint + tint * color.b;
      for (const f of tile.faces) {
        for (let i = 9 * f; i < 9 * f + 9; i += 3) { array[i] = r; array[i + 1] = gr; array[i + 2] = b; }
      }
    }
    colors.needsUpdate = true;
  }

  // Where each beam and dot lands: on the rock round Mnot's feet, else nowhere (the beam fades out into the air).
  cast(level) {
    const centre = this.ballAt(_k), feet = this.group.position;
    if (this.nearAt.distanceToSquared(feet) > 4) {
      this.near = this.world.solids.filter(s => s.near(feet.x, feet.z, 7));
      this.nearAt.copy(feet);
    }
    const turn = this.turn, c = Math.cos(turn), s = Math.sin(turn);
    for (const light of this.lights) {
      const d = light.dir, dx = d.x * c + d.z * s, dz = -d.x * s + d.z * c;    // turned with the ball
      let along = (centre.y - feet.y) / -d.y;
      const rock = this.floorAt(centre.x + dx * along, centre.z + dz * along, feet.y);
      if (rock) along = (centre.y - rock.top) / -d.y;
      if (light.beam) {
        light.beam.scale.setScalar(rock ? along : Math.min(along, 3));
        light.beam.material.opacity = 0.35 * level;
      }
      light.spot.visible = !!rock;
      if (!rock) continue;
      light.spot.position.set(centre.x + dx * along, rock.top + 0.015, centre.z + dz * along);
      const size = light.size * along;
      light.spot.scale.set(size, 1, size / -d.y);                  // stretched where the light comes in low
      light.spot.rotation.y = Math.atan2(dx, dz);
      light.spot.material.opacity = light.base * level;
    }
  }

  floorAt(x, z, feetY) {
    let best = null;
    for (const s of this.near) {
      if (s.off || s.top > feetY + 0.35 || s.top < feetY - 1.5 || (best && s.top < best.top)) continue;
      if (s.closest(x, z).d <= 0) best = s;
    }
    return best;
  }

  // Two coloured lights sweeping round the edges of the screen, a little brighter on every beat.
  glowScreen(level) {
    const el = this.wash;
    if (!el) return;
    if (level <= 0) { el.style.display = 'none'; return; }
    const beat = Math.floor(this.time / BEAT), pulse = Math.exp(-5 * (this.time % BEAT));
    const css = c => `#${c.getHexString()}`, a = this.time * 1.3;
    const one = COLORS[beat % COLORS.length], two = COLORS[(beat + 3) % COLORS.length];
    const x = 50 + 55 * Math.cos(a), y = 50 + 55 * Math.sin(a);
    el.style.display = '';
    el.style.background = `radial-gradient(circle at ${x}% ${y}%, ${css(one)} 0, transparent 40%), `
      + `radial-gradient(circle at ${100 - x}% ${100 - y}%, ${css(two)} 0, transparent 40%)`;
    el.style.opacity = level * (0.18 + 0.16 * pulse);
  }
}
