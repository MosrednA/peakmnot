// The chase camera: behind the chair and above it, looking down the run, so the seat can spin as it likes and the
// camera sees Mnot from every side. It trails along the piste's way down, swung a little towards where the chair is
// actually going, pulls back and widens with speed, rises over the river to show the floes coming, shakes on a
// crash, never dips into the snow, and stays put to watch when the chair goes over an edge. Past the finish it pulls
// back and looks at the chair's feet, so the whole party (party.js) is in the frame above the finish card.
import * as THREE from 'three';
import { FEATURES } from './track.js';

const _dir = new THREE.Vector3(), _want = new THREE.Vector3(), _look = new THREE.Vector3(), _flat = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.fov = camera.fov;
    this.trauma = 0;
    this.time = 0;
    this.finish = 0;      // 0..1: eased into the finish framing once the run is done
    this.frame = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3() };
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  // Where it wants to be for the ride now.
  aim(ride) {
    const f = this.track.frame(ride.s, this.frame), speed = ride.speed;
    _flat.copy(ride.vel).setY(0);
    _dir.copy(f.tangent);
    if (_flat.lengthSq() > 4) _dir.lerp(_flat.normalize(), 0.35).normalize();
    // over the river: higher, further back and looking further ahead, so the next floe is in sight before the hop
    const R = FEATURES.river, smooth = THREE.MathUtils.smoothstep;
    const river = smooth(ride.s, R.from - 58, R.from - 28) * (1 - smooth(ride.s, R.to - 4, R.to + 14));
    const riding = 1 - this.finish, fin = this.finish;
    const back = (3.5 + 0.07 * Math.min(speed, 25) + 2 * river) * riding + 5.6 * fin;
    const up = (1.45 + 0.025 * Math.min(speed, 25) + 2.8 * river) * riding + 1.8 * fin;
    _want.copy(ride.pos).addScaledVector(_dir, -back).setY(ride.pos.y + up);
    _look.copy(ride.pos).addScaledVector(_dir, (3 + 7 * river) * riding)
      .setY(ride.pos.y + (0.75 - 1.4 * river) * riding - 0.05 * fin);
    return speed;
  }

  // Straight to where it wants to be, wherever the chair is now (a respawn, a new run, a test), looking for the snow
  // under it afresh.
  snap(ride) {
    this.finish = ride.done ? 1 : 0;
    this.hint = -1;
    this.aim(ride);
    this.pos.copy(_want);
    this.look.copy(_look);
    this.dir.copy(_dir);
    this.place(0);
  }

  update(dt, ride) {
    this.time += dt;
    if (ride.out) {
      // over the edge: stay, and watch it go
      this.look.lerp(ride.pos, 1 - Math.exp(-6 * dt));
      this.place(dt);
      return;
    }
    this.finish = THREE.MathUtils.damp(this.finish, ride.done ? 1 : 0, 1.4, dt);
    const speed = this.aim(ride);
    // slower up and down than across, so a jump lifts the chair in the frame
    const y = THREE.MathUtils.damp(this.pos.y, _want.y, 3, dt);
    this.pos.lerp(_want, 1 - Math.exp(-7 * dt));
    this.pos.y = y;
    this.look.lerp(_look, 1 - Math.exp(-9 * dt));
    this.fov = THREE.MathUtils.damp(this.fov, 50 + Math.min(16, 0.8 * speed), 3, dt);
    this.place(dt);
  }

  place(dt) {
    const c = this.camera;
    c.position.copy(this.pos);
    // never in the snow: at least a metre above it
    const under = this.track.ground(c.position.x, c.position.z, this.hint ?? -1, this.probe ??= { normal: new THREE.Vector3() });
    this.hint = under.i;
    const ground = under.y;
    if (c.position.y < ground + 1) { c.position.y = ground + 1; this.pos.y = c.position.y; }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma, t = this.time * 31;
    c.position.x += shake * 0.25 * Math.sin(t * 1.1);
    c.position.y += shake * 0.2 * Math.sin(t * 1.7 + 1);
    c.lookAt(this.look);
    c.rotateZ(shake * 0.06 * Math.sin(t * 0.9 + 2));
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}
