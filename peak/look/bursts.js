// Little bursts the world kicks up, in the toon style: soft puffs of snow, flakes and grit, stone chips that bounce
// away over the rock. A loose ledge taking a landing and giving way, a falling rock hitting the ground, pebbles
// trickling down before a rockfall, shavings off skidding feet, the can going through the clouds. Pooled: one
// instanced mesh per kind of bit with room for a fixed number, so a burst costs next to nothing; a full pool hands
// out its oldest bit again.
// bursts(world) gives the world's one set, which updates with the world.
import * as THREE from 'three';
import { toon } from './look.js';
import { random } from '../world/world.js';

const SNOW = new THREE.Color('#ffffff'), GRIT = new THREE.Color('#8d8798'), STONE = new THREE.Color('#7f7a86');
const ICE = new THREE.Color('#a8e0ff');
const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

// puffs: round and soft, with a cool shade so snow doesn't go grey; bits: tiny, no ink; chips: inked like the rock
const KINDS = {
  puff: { geometry: new THREE.IcosahedronGeometry(1, 1), material: () => toon('#ffffff', { emissive: '#4d5874' }),
    room: 140, shadow: false },
  bit: { geometry: new THREE.OctahedronGeometry(1, 0), material: () => toon('#ffffff', { outline: false }),
    room: 220, shadow: false },
  chip: { geometry: new THREE.DodecahedronGeometry(1, 0), material: () => toon('#ffffff', { outline: 'rock' }),
    room: 90, shadow: true },
};

export function bursts(world) {
  return world.bursts ??= new Bursts(world);
}

class Bursts {
  constructor(world) {
    this.world = world;
    this.rand = random(23);
    this.pools = {};
    for (const [name, kind] of Object.entries(KINDS)) {
      const mesh = new THREE.InstancedMesh(kind.geometry, kind.material(), kind.room);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, SNOW);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = kind.shadow;
      world.group.add(mesh);
      this.pools[name] = { name, mesh, room: kind.room, bits: [] };
    }
    world.animated.push(this);
  }

  // A bit: where, how fast, how big, for how long. gravity pulls it down, drag slows it, and with bounce (0 settles,
  // up to 1) it lands on the rocks; land(pos) is called when it first does.
  add(kind, { at, vel = _v.set(0, 0, 0), size, life, gravity = 0, drag = 0, bounce = null, color = SNOW, spin = 0,
    land = null }) {
    const pool = this.pools[kind];
    if (pool.bits.length >= pool.room) pool.bits.shift();
    const r = this.rand;
    pool.bits.push({ pos: at.clone(), vel: vel.clone(), size, life, gravity, drag, bounce, color, land, age: 0,
      axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), angle: TAU * r(), spin });
  }

  // Snow kicked up off the ground at a spot: puffs rolling out low, flakes (and some grit) flying up and settling.
  snow(at, { puffs = 6, flakes = 8, spread = 0.45, size = 1, grit = 0.25, up = 1 } = {}) {
    const r = this.rand;
    for (let i = 0; i < puffs; i++) {
      const a = TAU * (i + r()) / puffs, out = spread * (1.6 + 1.4 * r());
      this.add('puff', { at: _s.set(at.x + Math.cos(a) * 0.08, at.y + 0.06, at.z + Math.sin(a) * 0.08),
        vel: _v.set(Math.cos(a) * out, (0.3 + 0.5 * r()) * up, Math.sin(a) * out), drag: 3.2,
        size: (0.1 + 0.08 * r()) * size, life: 0.55 + 0.35 * r() });
    }
    for (let i = 0; i < flakes; i++) {
      const a = TAU * r(), out = 0.4 + 1.1 * r();
      this.add('bit', { at: _s.set(at.x, at.y + 0.05, at.z),
        vel: _v.set(Math.cos(a) * out, (1.4 + 1.8 * r()) * up, Math.sin(a) * out), gravity: 10, drag: 1.2,
        bounce: 0, size: (0.022 + 0.022 * r()) * size, life: 0.9 + 0.6 * r(), color: r() < grit ? GRIT : SNOW,
        spin: 8 });
    }
  }

  // Stone chips flying out of a spot (or from anywhere within spread of it) and bouncing away over the rock, or with
  // fall, dropping off into the deep.
  chips(at, { count = 5, speed = 1.8, size = 1, fall = false, up = 1, spread = 0 } = {}) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const a = TAU * (i + r()) / count, out = speed * (0.5 + 0.6 * r()), d = spread * Math.sqrt(r());
      this.add('chip', { at: _s.set(at.x + Math.cos(a) * d, at.y + 0.06, at.z + Math.sin(a) * d),
        vel: _v.set(Math.cos(a) * out, (1.8 + 1.8 * r()) * up, Math.sin(a) * out), gravity: 14,
        bounce: fall ? null : 0.4, size: (0.035 + 0.035 * r()) * size, life: fall ? 1.6 : 1.1 + 0.5 * r(),
        color: r() < 0.25 ? GRIT : STONE, spin: 9 + 6 * r() });
    }
  }

  // A few crumbs off a lip: from a spot on the edge, nudged outwards (out: a flat unit vector), falling away.
  crumbs(at, out, { count = 2, grit = 0.4 } = {}) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const push = 0.15 + 0.35 * r();
      this.add('bit', { at: _s.set(at.x + out.x * 0.04, at.y, at.z + out.z * 0.04),
        vel: _v.set(out.x * push, 0.4 * r(), out.z * push), gravity: 11, size: 0.02 + 0.025 * r(), life: 1.1,
        color: r() < grit ? GRIT : SNOW, spin: 6 });
    }
  }

  // Dust settling: a couple of small low puffs where something light lands.
  dust(at, { count = 2, size = 1 } = {}) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const a = TAU * r();
      this.add('puff', { at: _s.set(at.x, at.y + 0.03, at.z), vel: _v.set(Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.5),
        drag: 3, size: (0.04 + 0.03 * r()) * size, life: 0.45 + 0.2 * r() });
    }
  }

  // Pebbles and dust trickling down onto a spot from above it, spread over radius.
  trickle(at, radius, { height = 3, pebble = true } = {}) {
    const r = this.rand, a = TAU * r(), d = radius * Math.sqrt(r());
    const x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
    if (pebble) {
      this.add('chip', { at: _s.set(x, at.y + height * (0.8 + 0.4 * r()), z), vel: _v.set(0, -2, 0), gravity: 15,
        bounce: 0.3, size: 0.03 + 0.03 * r(), life: 1.4, color: r() < 0.3 ? GRIT : STONE, spin: 10,
        land: pos => this.dust(pos, { count: 1 }) });
    } else {
      this.add('bit', { at: _s.set(x, at.y + height * (0.5 + 0.5 * r()), z), vel: _v.set(0, -1, 0), gravity: 6,
        drag: 1.5, bounce: 0, size: 0.018 + 0.016 * r(), life: 1.4, color: r() < 0.5 ? GRIT : SNOW, spin: 5 });
    }
  }

  // Ice shavings from skidding feet: tiny white and pale blue bits thrown on the way the feet slide, now and then
  // a wisp of frost.
  shavings(at, vel) {
    const r = this.rand, speed = Math.hypot(vel.x, vel.z) || 1;
    for (let i = 0; i < 2; i++) {
      const k = 0.35 + 0.5 * r(), side = (r() - 0.5) * 1.4;
      this.add('bit', { at: _s.set(at.x + (r() - 0.5) * 0.18, at.y + 0.03, at.z + (r() - 0.5) * 0.18),
        vel: _v.set(vel.x * k - vel.z / speed * side, 0.5 + 0.8 * r(), vel.z * k + vel.x / speed * side),
        gravity: 7, drag: 2.5, size: 0.014 + 0.014 * r(), life: 0.3 + 0.25 * r(), color: r() < 0.5 ? SNOW : ICE,
        spin: 10 });
    }
    if (r() < 0.3) {
      this.add('puff', { at: _s.set(at.x, at.y + 0.04, at.z), vel: _v.set(vel.x * 0.3, 0.2, vel.z * 0.3), drag: 3,
        size: 0.035 + 0.025 * r(), life: 0.35 + 0.15 * r() });
    }
  }

  // A big round poof of cloud, where something drops through the cloud tops.
  poof(at, { size = 1, count = 9 } = {}) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const a = TAU * (i + r()) / count, out = (2.5 + 2 * r()) * size;
      this.add('puff', { at: _s.set(at.x, at.y, at.z), vel: _v.set(Math.cos(a) * out, (1.5 + 2 * r()) * size,
        Math.sin(a) * out), drag: 2.4, size: (0.55 + 0.45 * r()) * size, life: 1.1 + 0.5 * r() });
    }
    this.add('puff', { at: _s.set(at.x, at.y + 0.4 * size, at.z), vel: _v.set(0, 2 * size, 0), drag: 2,
      size: 1.1 * size, life: 1.2 });
  }

  update(dt) {
    for (const pool of Object.values(this.pools)) {
      const { mesh } = pool;
      let n = 0;
      for (const bit of pool.bits) {
        bit.age += dt;
        if (bit.age >= bit.life) continue;
        this.move(bit, dt);
        const k = bit.age / bit.life;
        // puffs swell, linger and shrink away; bits and chips just shrink at the end
        const grow = pool.name !== 'puff' ? (k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25)
          : k < 0.2 ? 1 - (1 - k / 0.2) ** 2 : k < 0.5 ? 1 : 1 - ((k - 0.5) / 0.5) ** 2;
        _m.compose(bit.pos, _q.setFromAxisAngle(bit.axis, bit.angle), _s.setScalar(Math.max(1e-4, bit.size * grow)));
        mesh.setMatrixAt(n, _m);
        mesh.setColorAt(n, bit.color);
        n++;
      }
      if (n < pool.bits.length) pool.bits = pool.bits.filter(bit => bit.age < bit.life);
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  move(bit, dt) {
    bit.vel.y -= bit.gravity * dt;
    if (bit.drag) bit.vel.multiplyScalar(Math.exp(-bit.drag * dt));
    bit.pos.addScaledVector(bit.vel, dt);
    bit.angle += bit.spin * dt;
    if (bit.bounce === null || bit.vel.y > 0) return;
    const ground = this.world.ground(bit.pos.x, bit.pos.z, bit.pos.y + 0.3, 0);
    if (!ground || bit.pos.y - bit.size > ground.top) return;
    bit.pos.y = ground.top + bit.size;
    if (bit.land) { bit.land(bit.pos); bit.land = null; }
    if (bit.vel.y < -1.2 && bit.bounce > 0) {
      bit.vel.set(bit.vel.x * 0.6, -bit.vel.y * bit.bounce, bit.vel.z * 0.6);
      bit.spin *= 0.6;
    } else {
      // settled: slide to a stop
      bit.vel.set(bit.vel.x * Math.exp(-10 * dt), 0, bit.vel.z * Math.exp(-10 * dt));
      bit.spin *= Math.exp(-10 * dt);
    }
  }
}
