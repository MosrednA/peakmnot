// The cartoon fall into the abyss. Off an edge with nothing left to land on, Mnot hangs in the air for a beat, legs
// still running, then stops and turns to look at the camera (it knows), and drops: arms and legs flailing (pose.js),
// the can tumbling end over end, down into the sea of clouds far below, where it goes through with a white poof.
// The rules (game.js) fade out a little after that and bring it back.
// For the camera and sounds: player.hang is the seconds left of the beat (0 once it drops), and
// player.emit('drop') as the drop starts.
import * as THREE from 'three';
import { CLOUD_Y } from './clouds.js';
import { bursts } from './bursts.js';

const HANG = 0.5;             // seconds of the beat ...
const LOOK = 0.22;            // ... the last of which it spends looking at the camera
const GRAVITY = 30;           // a cartoon drop is quicker than a jump
const SPIN = 7;               // radians a second, end over end, once it gets going
const MIDDLE = 0.8;           // the can tumbles about its middle, this far above its feet
const CLEAR = 0.85;           // and keeps this far from cliff walls, so it doesn't tumble into one
const WIDEN = { by: 0.1, from: 3, per: 0.025 };   // the rock faces bulge out this far, more further down (rockmesh.js)

const _q = new THREE.Quaternion(), _m = new THREE.Vector3(), _p = new THREE.Vector3();

// Whether Mnot, in the air and coming down, could still land on anything: a rock or a plank it could steer to
// before it drops past it, given how fast it can go (generously: any way at its speed or a run, plus the wind).
export function canLand(player, { edge, reach, floor }) {
  const { world, pos, vy } = player, g = player.gravity;
  const speed = Math.max(player.speed, player.rig.run_speed) + 0.4 + 1.5 * player.last.jet;
  // how long until it drops past a height
  const time = y => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (pos.y - y)))) / g;
  for (const s of world.solids) {
    if (s.off || s.top > pos.y + reach || s.top < floor) continue;
    if (s.closest(pos.x, pos.z).d - edge <= (speed + (s.moving ? 1.5 : 0)) * time(s.top - reach)) return true;
  }
  for (const b of world.beams) {
    if (b === player.slipped) continue;
    for (let i = 0; i <= 16; i++) {
      const p = b.pointAt(i / 16, _p);
      if (p.y > pos.y + 0.02 || p.y < floor) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) - 0.3 <= speed * time(p.y - 0.02)) return true;
    }
  }
  return false;
}

export class Fall {
  constructor(player) {
    this.player = player;
    this.active = false;
    this.axis = new THREE.Vector3(1, 0, 0);
    this.angle = 0;
    this.spin = 0;
    this.through = false;       // gone through the clouds
    this.aim = null;            // open air to ease over to, out of a gap too narrow to tumble down
    this.retry = 0;
  }

  // Lost over the abyss: the beat first, unless it's already plummeting.
  start() {
    const p = this.player;
    this.active = true;
    this.angle = this.spin = 0;
    this.through = false;
    this.looking = false;
    this.aim = null;
    if (p.vy < -6) { p.hang = 0; this.drop(); return; }
    p.hang = HANG;
    p.vy = 0;
    p.anim.play('Run', 0.08);
    p.anim.setTimeScale('Run', 1.8);          // running on air, a bit frantic
  }

  stop() {
    this.active = false;
    this.angle = this.spin = 0;
    this.player.hang = 0;
  }

  update(dt) {
    const p = this.player;
    if (p.hang > 0) {
      p.hang = Math.max(0, p.hang - dt);
      p.vel.multiplyScalar(Math.exp(-7 * dt));    // the run goes nowhere
      p.pos.addScaledVector(p.vel, dt);
      if (p.hang < LOOK && !this.looking) {
        this.looking = true;
        p.anim.play('Idle', 0.06);
      }
      if (this.looking && p.watcher) {
        p.turnTowards(Math.atan2(p.watcher.x - p.pos.x, p.watcher.z - p.pos.z), 18, dt);
      }
      if (p.hang === 0) this.drop();
      return;
    }
    p.vy = Math.max(p.vy - GRAVITY * dt, -50);
    p.pos.addScaledVector(p.vel, dt);
    p.pos.y += p.vy * dt;
    this.clear(dt);
    this.spin = Math.min(SPIN, this.spin + dt * SPIN / 0.35);
    this.angle += this.spin * this.sign * dt;
    if (!this.through && p.pos.y + MIDDLE < CLOUD_Y + 2) {
      this.through = true;
      bursts(p.world).poof(_p.copy(p.pos).setY(CLOUD_Y + 2), { size: 1.5 });
    }
  }

  drop() {
    const p = this.player;
    // tumble about the line from the camera, so it reads as end over end from there
    if (p.watcher) this.axis.set(p.pos.x - p.watcher.x, 0, p.pos.z - p.watcher.z);
    else this.axis.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (this.axis.lengthSq() < 1e-6) this.axis.set(1, 0, 0);
    this.axis.normalize();
    this.sign = Math.random() < 0.5 ? -1 : 1;
    p.vel.multiplyScalar(0.3);
    p.anim.play('Fall', 0.12);
    p.emit('drop');
  }

  // Keep clear of the rock faces round the can. In a gap too narrow for that (they bulge out further down), ease
  // over to the nearest open air instead, so the can never tumbles into a rock and out of the camera's sight.
  clear(dt) {
    const p = this.player;
    if (this.room(p.pos.x, p.pos.z) >= CLEAR) { this.aim = null; return; }
    if (!this.aim || (this.retry -= dt) <= 0) {
      this.aim = this.findRoom(p.pos);
      this.retry = 0.25;
    }
    if (!this.aim) return;
    const k = 1 - Math.exp(-7 * dt);
    p.pos.x += (this.aim.x - p.pos.x) * k;
    p.pos.z += (this.aim.z - p.pos.z) * k;
  }

  // How far (x, z) is from the nearest rock face beside the can, allowing for the bulge.
  room(x, z) {
    const { world, pos } = this.player;
    let room = Infinity;
    for (const s of world.solids) {
      if (s.off || s.top <= pos.y || s.bottom >= pos.y + 1.6 || !s.near(x, z, CLEAR + 1)) continue;
      const bulge = WIDEN.by + WIDEN.per * Math.max(0, s.top - pos.y - WIDEN.from);
      room = Math.min(room, s.closest(x, z).d - bulge);
    }
    return room;
  }

  // The nearest spot round the can with room enough, rather on the camera's side, where no rock hides it; or null.
  findRoom(at) {
    const w = this.player.watcher, toward = w ? Math.atan2(w.z - at.z, w.x - at.x) : 0;
    let best = null, cost = Infinity;
    for (let r = 0.15; r <= 3 && r * 0.75 < cost; r += 0.15) {
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * 2 * Math.PI, x = at.x + r * Math.cos(a), z = at.z + r * Math.sin(a);
        const c = r * (1.25 - (w ? 0.5 * Math.cos(a - toward) : 0));
        if (c < cost && this.room(x, z) >= CLEAR) [best, cost] = [{ x, z }, c];
      }
    }
    return best;
  }

  // Turn Mnot's holder by the tumble, about the can's middle rather than its feet.
  turn(root) {
    if (!this.angle) return;
    _q.setFromAxisAngle(this.axis, this.angle);
    root.quaternion.premultiply(_q);
    _m.set(0, MIDDLE, 0);
    root.position.add(_m).sub(_m.applyQuaternion(_q));
  }
}
