// Wind and snow. The wind has a slowly wandering direction and comes in gusts: calm, a build-up you can see in the
// streaks and pennants, a blow, and a calm again. Some places are windier (route zones). Snow comes in showers, and
// always falls near the top.
import * as THREE from 'three';
import { random } from './world.js';

const BASE_WIND = 0.3;   // windiness outside the zones

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
  }

  // How hard the wind blows at a point, 0..1.
  strengthAt(pos) {
    const local = Math.max(BASE_WIND, this.world.zonesAt('wind', pos.x, pos.z));
    return THREE.MathUtils.clamp((0.12 + 0.88 * this.gust) * local * 1.25, 0, 1);
  }

  windAt(pos) {
    return { dir: this.dir, strength: this.strengthAt(pos) };
  }

  update(dt, focus, camera) {
    this.time += dt;
    const t = this.time;
    const yaw = this.heading + 0.5 * Math.sin(t * 0.05) + 0.25 * Math.sin(t * 0.13 + 1);
    this.dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.stepGusts(dt);
    this.stepShowers(dt);
    const snowZone = this.world.zonesAt('snow', focus.x, focus.z);
    const wantSnow = Math.max(this.shower.on ? 0.8 : 0, snowZone);
    this.snow = THREE.MathUtils.damp(this.snow, wantSnow, 0.6, dt);
    const strength = this.strengthAt(focus);
    this.flakes.update(dt, camera.position, this.dir, strength, this.snow);
    this.streaks.update(dt, focus, this.dir, strength, this.rand);
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
