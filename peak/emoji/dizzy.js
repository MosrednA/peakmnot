// Mnot seeing stars: a ring of little yellow stars circling over its head while it's dizzy from a wrong emoji, the
// ring wobbling as it goes, each star turning on its own. They grow in at the start and shrink away at the end.
import * as THREE from 'three';
import { toon } from '../look/look.js';

const COUNT = 5;
const RING = { r: 0.42, y: 1.92, speed: 4.2, tilt: 0.28 };   // m round, m over Mnot's feet, radians a second, wobble
const SIZE = 0.13;                                        // m from a star's middle to a point

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? SIZE * 0.45 : SIZE;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015,
    bevelSize: 0.012, bevelSegments: 1 });
  geometry.center();
  return geometry;
}

export class Dizzy {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'stars over Mnot';
    this.group.visible = false;
    const geometry = starGeometry(), material = toon('#ffd23f');
    this.stars = Array.from({ length: COUNT }, () => {
      const star = new THREE.Mesh(geometry, material);
      this.group.add(star);
      return star;
    });
    this.time = 0;
  }

  // at: Mnot's feet; left: seconds of dizziness left (nothing when 0); fade: the seconds it grows in and out over
  update(dt, at, left, fade = 0.3) {
    this.group.visible = left > 0;
    if (!this.group.visible) { this.time = 0; return; }
    this.time += dt;
    const size = Math.min(1, this.time / fade, left / fade);
    this.group.position.set(at.x, at.y + RING.y, at.z);
    this.group.rotation.set(RING.tilt * Math.sin(this.time * 3.1), this.time * RING.speed, RING.tilt * Math.cos(this.time * 2.3));
    this.stars.forEach((star, i) => {
      const a = i * Math.PI * 2 / COUNT;
      star.position.set(Math.cos(a) * RING.r, 0.05 * Math.sin(this.time * 9 + i * 2), Math.sin(a) * RING.r);
      star.rotation.set(0, -a + this.time * 2, this.time * 5 + i);
      star.scale.setScalar(Math.max(0.001, size * (0.85 + 0.15 * Math.sin(this.time * 11 + i))));
    });
  }
}
