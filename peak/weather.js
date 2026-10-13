// Wind and snow. The wind has a slowly wandering direction and comes in gusts: calm, a build-up you can see in the
// streaks and pennants, a blow, and a calm again. Some places are windier (route zones). Snow comes in showers, and
// always falls near the top.
// A wind gap ('gust' zone) is different: the wind is funnelled through it in one direction, on a steady beat of
// lull, build-up, blow and drop that you can learn from its windsock, and it shoves Mnot hard in mid-air (player.js
// reads wind.jet). world.emit('gust', { at, zone }) when one starts to build up.
import * as THREE from 'three';
import { random } from './world.js';

const BASE_WIND = 0.3;   // windiness outside the zones
const BEAT = { lull: 3.4, rise: 0.8, blow: 1.8, drop: 0.7 };   // a wind gap's beat, in seconds

export class Weather {
  constructor(scene, world, seed = 5) {
    this.world = world;
    this.rand = random(seed);
    this.time = 0;
    this.heading = 0.35;            // the wind blows towards this yaw, wandering around it
    this.dir = new THREE.Vector3(1, 0, 0);
    this.gust = 0;                  // 0..1, the whole mountain
    this.phase = { name: 'calm', left: 4 };
    this.snow = 0;                  // 0..1 where the camera is
    this.shower = { on: false, left: 30 };
    this.flakes = new Snow(scene);
    this.streaks = new Streaks(scene);
    this.gaps = world.zones.filter(z => z.kind === 'gust');
    for (const zone of this.gaps) {
      zone.dir = new THREE.Vector3(Math.sin(zone.yaw), 0, Math.cos(zone.yaw));
      zone.at = new THREE.Vector3(zone.x, zone.y ?? 0, zone.z);
      zone.beat = { ...BEAT, ...zone.beat };
      zone.period = zone.beat.lull + zone.beat.rise + zone.beat.blow + zone.beat.drop;
      zone.rising = false;
      world.hazards.push({ kind: 'gust', zone, wait: pos => this.holdBack(zone, pos) });
    }
  }

  // A wind gap's own gust, 0..1, at time t: lull, build-up, blow, drop.
  beat(zone, t = this.time) {
    const b = zone.beat, p = ((t + (zone.offset ?? 0)) % zone.period + zone.period) % zone.period;
    if (p < b.lull) return 0;
    if (p < b.lull + b.rise) return THREE.MathUtils.smoothstep(p, b.lull, b.lull + b.rise);
    if (p < b.lull + b.rise + b.blow) return 1;
    return 1 - THREE.MathUtils.smoothstep(p, b.lull + b.rise + b.blow, zone.period);
  }

  // How much of the wind gaps' pull reaches pos (0..1), which one, and its gust there now.
  gapAt(pos) {
    let best = null;
    for (const zone of this.gaps) {
      if (Math.abs(pos.y - zone.at.y) > 2.5) continue;
      const d = Math.hypot(pos.x - zone.x, pos.z - zone.z);
      const reach = 1 - THREE.MathUtils.smoothstep(d, zone.radius * 0.6, zone.radius);
      if (reach <= 0 || best && reach <= best.reach) continue;
      best = { zone, reach, jet: reach * zone.strength * this.beat(zone) };
    }
    return best;
  }

  // For bots: before the gap, wait for a lull that lasts long enough to jump through.
  holdBack(zone, pos) {
    const rel = new THREE.Vector3(pos.x - zone.x, 0, pos.z - zone.z);
    if (Math.abs(pos.y - zone.at.y) > 1.2 || rel.length() > zone.radius || rel.dot(zone.dir) < 0.15) return false;
    for (let k = 0; k <= 1.6; k += 0.2) if (this.beat(zone, this.time + k) > 0.02) return true;
    return false;
  }

  // How hard the wind blows at a point, 0..1.
  strengthAt(pos) {
    const local = Math.max(BASE_WIND, this.world.zonesAt('wind', pos.x, pos.z));
    return THREE.MathUtils.clamp((0.12 + 0.88 * this.gust) * local * 1.25, 0, 1);
  }

  // jet: a wind gap's push (0..1), which shoves Mnot much harder than the strength alone
  windAt(pos) {
    const strength = this.strengthAt(pos), gap = this.gaps.length ? this.gapAt(pos) : null;
    if (!gap) return { dir: this.dir, strength, jet: 0 };
    const dir = this.dir.clone().lerp(gap.zone.dir, Math.min(1, gap.reach * 1.5)).normalize();
    return { dir, strength: Math.max(strength, gap.jet), jet: gap.jet };
  }

  update(dt, focus, camera) {
    this.time += dt;
    const t = this.time;
    const yaw = this.heading + 0.5 * Math.sin(t * 0.05) + 0.25 * Math.sin(t * 0.13 + 1);
    this.dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.stepGusts(dt);
    this.stepShowers(dt);
    for (const zone of this.gaps) {
      const rising = this.beat(zone) > 0 && this.beat(zone, t - dt) === 0;
      if (rising) this.world.emit('gust', { at: zone.at, zone });
    }
    const snowZone = this.world.zonesAt('snow', focus.x, focus.z);
    const wantSnow = Math.max(this.shower.on ? 0.8 : 0, snowZone);
    this.snow = THREE.MathUtils.damp(this.snow, wantSnow, 0.6, dt);
    const wind = this.windAt(focus);
    this.flakes.update(dt, camera.position, wind.dir, wind.strength, this.snow);
    this.streaks.update(dt, focus, wind.dir, wind.strength, this.rand);
  }

  // calm → rising → blowing → falling → calm, each for a random while
  stepGusts(dt) {
    const p = this.phase;
    p.left -= dt;
    if (p.name === 'rising') this.gust = Math.min(1, this.gust + dt / 0.9);
    if (p.name === 'falling') this.gust = Math.max(0, this.gust - dt / 1.2);
    if (p.left > 0) return;
    const next = { calm: 'rising', rising: 'blowing', blowing: 'falling', falling: 'calm' }[p.name];
    const length = { calm: 3 + 5 * this.rand(), rising: 0.9, blowing: 1 + 2 * this.rand(), falling: 1.2 }[next];
    this.phase = { name: next, left: length };
  }

  stepShowers(dt) {
    const s = this.shower;
    s.left -= dt;
    if (s.left > 0) return;
    s.on = !s.on;
    s.left = s.on ? 15 + 12 * this.rand() : 35 + 40 * this.rand();
  }
}

// Snowflakes in a box that travels with the camera, drifting with the wind.
class Snow {
  constructor(scene) {
    this.count = 1600;
    this.size = new THREE.Vector3(26, 16, 26);
    const rand = random(12);
    this.positions = new Float32Array(this.count * 3);
    this.speeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (rand() - 0.5) * this.size.x;
      this.positions[i * 3 + 1] = (rand() - 0.5) * this.size.y;
      this.positions[i * 3 + 2] = (rand() - 0.5) * this.size.z;
      this.speeds[i] = 0.6 + 0.7 * rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({ size: 0.09, map: flakeTexture(), transparent: true, depthWrite: false,
      opacity: 0, color: '#ffffff' });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.time = 0;
  }

  update(dt, center, dir, wind, amount) {
    this.time += dt;
    this.material.opacity = amount;
    this.points.visible = amount > 0.01;
    if (!this.points.visible) return;
    const p = this.positions, s = this.size, drift = 0.5 + 4 * wind;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      p[k] += (dir.x * drift + 0.2 * Math.sin(this.time * 1.3 + i)) * dt;
      p[k + 1] -= this.speeds[i] * dt;
      p[k + 2] += (dir.z * drift + 0.2 * Math.cos(this.time * 1.1 + i * 1.7)) * dt;
      // wrap around the box around the camera
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? center.x : a === 1 ? center.y : center.z, half = (a === 0 ? s.x : a === 1 ? s.y : s.z) / 2;
        if (p[k + a] < c - half) p[k + a] += half * 2;
        else if (p[k + a] > c + half) p[k + a] -= half * 2;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

function flakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// White streaks racing past in a gust, so you can see it coming and which way it blows.
class Streaks {
  constructor(scene) {
    this.count = 46;
    this.items = [];
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 6);
    this.colors = new Float32Array(this.count * 8);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    for (let i = 0; i < this.count; i++) this.items.push({ life: 0, max: 1, pos: new THREE.Vector3(), len: 1 });
  }

  update(dt, focus, dir, strength, rand) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < this.count; i++) {
      const s = this.items[i];
      s.life += dt;
      if (s.life > s.max) {
        // respawn upwind of the focus, only when the wind is up
        s.life = 0;
        s.max = 0.5 + 0.6 * rand();
        s.on = rand() < (strength - 0.25) * 1.6;
        s.len = 0.8 + 1.4 * rand();
        s.pos.copy(focus).addScaledVector(dir, -6 - 4 * rand()).addScaledVector(side, (rand() - 0.5) * 12);
        s.pos.y += -2 + 5 * rand();
      }
      s.pos.addScaledVector(dir, (7 + 7 * strength) * dt);
      const k = i * 6, fade = s.on ? Math.sin(Math.PI * s.life / s.max) * 0.7 : 0;
      this.positions[k] = s.pos.x; this.positions[k + 1] = s.pos.y; this.positions[k + 2] = s.pos.z;
      this.positions[k + 3] = s.pos.x - dir.x * s.len;
      this.positions[k + 4] = s.pos.y;
      this.positions[k + 5] = s.pos.z - dir.z * s.len;
      this.colors.set([1, 1, 1, fade, 1, 1, 1, 0], i * 8);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
