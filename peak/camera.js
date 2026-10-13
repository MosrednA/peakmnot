// The camera shoots Mnot from the front-ish side, so the can and glasses stay in view. Each stretch of the route has
// its own shot on the world's rail (see route.js); planks and ropes are always shot from the front, and a celebration
// gets a close-up (at the summit a wider one, with the summit flag beside Mnot). The camera glides from shot to shot.
// Drag to look around (a finger too, through touch.js, which also pinches to zoom); it eases back after a moment. It
// never looks up from under the ledges, and rises over a rock rather than going into it. A portrait screen gets a
// wider lens.
// A fall gets its own shot: the camera stays by the ledge, rises and looks down over the edge, and watches the can
// tumble away into the clouds (pushing in a little on the cartoon moment it hangs in the air), then eases back.
import * as THREE from 'three';

const BEAM = { theta: THREE.MathUtils.degToRad(16), pitch: 0.2, distance: 3.9 };
const CLOSE = { theta: THREE.MathUtils.degToRad(12), pitch: 0.16, distance: 3.6 };
// at the summit from the left, the south: it looks across the wind (which blows north-ish), so the flag ahead of Mnot
// streams across the shot rather than at the lens
const SUMMIT = { theta: THREE.MathUtils.degToRad(-45), pitch: 0.1, distance: 5.6 };
const PITCH = { min: 0.08, max: 1.3 };     // the camera's tilt, shot and drag together
const PORTRAIT = { fov: 72, back: 1.25 };  // a tall screen's lens and step back (frame())
const BOXES = new WeakMap();        // the rocks' bounds, so a ray only tests the rocks it passes near
const _hit = new THREE.Vector3();

export class FollowCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.yaw = 0;              // the direction the camera looks, 0 = +Z
    this.pitch = 0.3;          // looking down
    this.distance = 5;
    this.userYaw = 0;          // the player's own turn and tilt from dragging, eased away when idle
    this.userPitch = 0;
    this.zoom = 1;
    this.reach = this.distance;  // pulled in when a rock is in the way
    this.lift = 0;             // extra tilt that takes the camera up over a rock behind it
    this.lens = camera.fov;    // the field of view on a landscape screen
    this.fov = camera.fov;     // ... and on this one (frame())
    this.back = 1;             // a step back on a tall screen
    this.fall = null;          // the fall shot, while Mnot drops into the abyss
    this.blend = null;         // easing from the fall shot back to the normal one
    this.target = new THREE.Vector3();
    this.lead = new THREE.Vector3();
    this.lastDrag = -Infinity;
    this.time = 0;
    this.ray = new THREE.Raycaster();
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;      // fingers and pens: touch.js
      drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.look(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => this.zoomBy(Math.exp(e.deltaY * 0.001)), { passive: true });
  }

  // Look around by a drag of dx, dy pixels (the mouse, or a finger from touch.js). With guard ({ player, world }) a
  // drag never swings the shot round to the back of the can: past about 100° off its front it only turns back.
  look(dx, dy, guard = null) {
    const yaw = this.userYaw - dx * 0.006;
    if (!guard || this.seen(guard, yaw) > -0.17 || this.seen(guard, yaw) >= this.seen(guard, this.userYaw)) {
      this.userYaw = yaw;
    }
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + dy * 0.004, PITCH.min - this.pitch, PITCH.max - this.pitch);
    this.lastDrag = this.time;
  }

  zoomBy(k) { this.zoom = THREE.MathUtils.clamp(this.zoom * k, 0.55, 1.8); }

  // How much of the can's front the shot would show with this turn of the player's own (1 the face, -1 the back).
  seen({ player, world }, userYaw) {
    const yaw = lookYaw(this.shot(player, world)) + userYaw;
    return -(Math.sin(yaw) * Math.sin(player.yaw) + Math.cos(yaw) * Math.cos(player.yaw));
  }

  // The flat direction the camera looks.
  forward(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  // The flat direction of the shot the camera is gliding to, with the player's own turn: the controls follow this
  // rather than the camera itself, so they don't flip halfway while it swings round a corner or off a plank.
  heading(player, world, target = new THREE.Vector3()) {
    const yaw = lookYaw(this.shot(player, world)) + this.userYaw;
    return target.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  // Round a bend Mnot turns sooner than the camera can follow, and on a left turn the camera has the long way round:
  // while it sees much less of the can's front than its shot will (seen: 1 looking at the face, -1 at the back), it
  // swings up to two and a half times as fast, so the glasses stay in view.
  hurry(player, yaw) {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const seen = -(Math.sin(this.yaw) * fx + Math.cos(this.yaw) * fz), will = -(Math.sin(yaw) * fx + Math.cos(yaw) * fz);
    const { smoothstep } = THREE.MathUtils;
    return 1 + 1.5 * smoothstep(will - seen, 0.15, 0.6) * (1 - smoothstep(seen, 0.2, 0.6));
  }

  // The shot for where Mnot is: the way the route goes there, and the camera's angle, height and distance.
  shot(player, world) {
    const rail = world.railAt(player.pos);
    if (player.celebrate > 0) {
      const top = world.summit && player.pos.distanceTo(world.summit.at) < world.summit.radius + 1.5;
      return { dir: new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), ...(top ? SUMMIT : CLOSE), lead: 0 };
    }
    if (player.mode === 'beam') {
      // from the beam's far end, the way up the route
      const b = player.balance.beam, sign = Math.sign(b.dir.dot(rail.dir)) || 1;
      return { dir: b.dir.clone().multiplyScalar(sign), ...BEAM, lead: 0 };
    }
    return { ...rail, lead: 0.7 * Math.sin(rail.theta) };
  }

  snap(player, world) {
    const s = this.shot(player, world);
    this.userYaw = this.userPitch = 0;
    this.yaw = lookYaw(s);
    this.pitch = s.pitch;
    this.distance = s.distance;
    this.lead.copy(s.dir).multiplyScalar(s.lead);
    this.target.copy(player.pos).add(this.lead).y += 0.9;
    this.reach = Infinity;
    this.lift = 0;
    this.endFall();
    this.update(0, player, world);
  }

  // A portrait screen sees little across: a wider lens and a step back keep Mnot and the next ledge in the shot.
  // From square up (any desktop window) nothing changes.
  frame(aspect) {
    const narrow = THREE.MathUtils.smoothstep(1 - aspect, 0, 0.45);
    this.fov = this.lens + (PORTRAIT.fov - this.lens) * narrow;
    this.back = 1 + (PORTRAIT.back - 1) * narrow;
  }

  update(dt, player, world) {
    this.time += dt;
    this.frame(this.camera.aspect);
    const s = this.shot(player, world);
    const p = player.pos;
    // follow, with a lag on height so jumps don't shake the view; a fall into the abyss is watched from the edge
    this.lead.lerp(s.dir.clone().multiplyScalar(s.lead), 1 - Math.exp(-2 * dt));
    if (!this.fall && this.falling(player)) this.startFall(player);
    else if (this.fall && (player.mode === 'ground' || player.mode === 'beam')) this.endFall();
    if (!this.fall) {
      this.target.x = THREE.MathUtils.damp(this.target.x, p.x + this.lead.x, 10, dt);
      this.target.z = THREE.MathUtils.damp(this.target.z, p.z + this.lead.z, 10, dt);
      this.target.y = THREE.MathUtils.damp(this.target.y, p.y + 0.9, player.mode === 'air' ? 3 : 6, dt);
    }
    // glide to the shot; the player's own drag eases away after a while
    if (this.time - this.lastDrag > 2) {
      this.userYaw = THREE.MathUtils.damp(this.userYaw, 0, 1.2, dt);
      this.userPitch = THREE.MathUtils.damp(this.userPitch, 0, 1.2, dt);
    }
    const yaw = lookYaw(s) + this.userYaw;
    const rate = player.mode === 'beam' ? 3 : 1.8 * this.hurry(player, yaw);
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * (1 - Math.exp(-rate * dt));
    this.pitch = THREE.MathUtils.damp(this.pitch, s.pitch, rate, dt);
    this.distance = THREE.MathUtils.damp(this.distance, s.distance, rate, dt);
    const distance = this.distance * this.zoom * this.back;
    const tilt = THREE.MathUtils.clamp(this.pitch + this.userPitch, PITCH.min, PITCH.max);
    // a rock right behind the camera: tilt up until there's room, rather than going into it
    let lift = 0;
    for (let k = 0; k <= 6; k++) {
      lift = Math.min(PITCH.max, tilt + 0.12 * k) - tilt;
      const hit = this.cast(world, tilt + lift, distance);
      if (!hit || hit.distance > Math.min(distance, 1.7)) break;
    }
    this.lift = dt === 0 || lift > this.lift ? THREE.MathUtils.damp(this.lift, lift, 8, dt || 1) :
      THREE.MathUtils.damp(this.lift, lift, 1.5, dt);
    const pitch = tilt + this.lift;
    const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), -Math.sin(pitch),
      Math.cos(this.yaw) * Math.cos(pitch));
    // stay in front of rocks between the camera and Mnot
    const hit = this.cast(world, pitch, distance);
    const reach = hit ? Math.max(0.9, hit.distance - 0.3) : distance;
    this.reach = reach < this.reach ? reach : THREE.MathUtils.damp(this.reach, reach, 2.5, dt);
    this.camera.position.copy(this.target).addScaledVector(look, -this.reach);
    this.camera.lookAt(this.target);
    if (this.fall) this.fallShot(dt, player, world);
    else if (this.blend) this.blendBack(dt, world);
    else this.zoomTo(1);
  }

  // ------------------------------------------------------------------ the fall shot

  // Over the edge: well below the last safe spot and dropping, or hanging in the air for the cartoon beat.
  falling(player) {
    if (player.hang > 0) return true;
    return (player.mode === 'out' || player.mode === 'air') && player.vy < -0.5 && player.squash >= 1 &&
      player.pos.y < player.safe.pos.y - 0.9;
  }

  // The lookout: a little out past the can, over the abyss so the face below it stays in view, off to the side the
  // camera was on (never right over the can), and a little above the ledge. If rocks hide the drop from there, it
  // tries the other spots round the can (beside it, a little back, the other side) and then higher up.
  startFall(player) {
    const can = player.pos, out = new THREE.Vector3(player.vel.x, 0, player.vel.z);
    if (out.lengthSq() < 0.25) out.set(can.x - player.safe.pos.x, 0, can.z - player.safe.pos.z);
    if (out.lengthSq() < 0.01) this.forward(out);
    out.normalize();
    const from = this.camera.position.clone(), across = new THREE.Vector3(-out.z, 0, out.x);
    const offset = new THREE.Vector3(from.x - can.x, 0, from.z - can.z);
    const ahead = THREE.MathUtils.clamp(offset.dot(out) * 0.5, 1.4, 2.8);
    const side = offset.dot(across), aside = THREE.MathUtils.clamp(Math.abs(side) * 0.7, 2.8, 3.4) * (side < 0 ? -1 : 1);
    const y = Math.max(player.safe.pos.y, can.y) + 1.9;
    const spots = [[ahead, aside], [0, aside * 1.1], [-1.2, aside], [ahead, -aside], [0, -aside * 1.1], [ahead + 1.5, 0]]
      .map(([a, b]) => can.clone().addScaledVector(out, a).addScaledVector(across, b).setY(y));
    this.fall = { time: 0, from, spots, at: spots[0].clone(), goal: spots[0].clone(), next: 0,
      aim: this.target.clone(), push: 0 };
    this.blend = null;
  }

  // The fall is over: Mnot landed somewhere, or came back (snap); ease from the fall shot to the normal one.
  endFall() {
    if (!this.fall) return;
    this.blend = { time: 0, from: this.camera.position.clone(), aim: this.fall.aim.clone(), fov: this.camera.fov };
    this.fall = null;
  }

  // Swoop to the lookout and turn to follow the can down; every tenth of a second, check the lookout still sees it.
  fallShot(dt, player, world) {
    const f = this.fall, can = player.pos.clone();
    can.y += 0.7;
    f.time += dt;
    f.aim.lerp(can, 1 - Math.exp(-12 * dt));
    if (f.time >= f.next) {
      f.next = f.time + 0.1;
      f.goal = this.lookout(world, f, can) ?? f.goal;
    }
    f.at.lerp(f.goal, 1 - Math.exp(-4 * dt));
    const rise = THREE.MathUtils.smoothstep(f.time, 0, 0.7);
    this.camera.position.lerpVectors(f.from, f.at, rise).y += 0.7 * Math.sin(Math.PI * rise);   // up and over
    // the cartoon beat, hanging in the air before the drop: push in on it
    f.push = THREE.MathUtils.damp(f.push, player.hang > 0 ? 1 : 0, player.hang > 0 ? 7 : 2.5, dt);
    this.camera.position.lerp(f.aim, 0.12 * f.push);
    this.camera.lookAt(f.aim);
    this.zoomTo(1 - 0.16 * f.push);
  }

  // The first lookout, lowest first, with a clear view of the can and of where it's about to drop (or at least of
  // the can, deep down in a crevice).
  lookout(world, f, can) {
    const drop = [0, 4, 12].map(d => can.clone().setY(Math.min(can.y, f.spots[0].y - 1.6) - d));
    let budget = 30;                // rays; past that, keep the lookout it has
    for (const sees of [drop, drop.slice(0, 1)]) {
      for (let k = 0; k <= 10; k++) {
        for (const [i, spot] of f.spots.entries()) {
          const up = k - (i < 3 ? 0 : 2);         // the other side of the can only if this side needs a climb
          if (up < 0 || up > 8) continue;
          const at = spot.clone();
          at.y += 0.6 * up;
          if (sees.every(p => --budget > 0 && this.clear(world, p, at))) return at;
          if (budget <= 0) return null;
        }
      }
    }
    return null;
  }

  // Glide back to the normal shot, unless it's far or round a rock (back at a checkpoint): then cut.
  blendBack(dt, world) {
    const b = this.blend;
    if (b.time === 0 && (b.from.distanceTo(this.camera.position) > 12 || !this.clear(world, b.from,
      this.camera.position))) b.time = Infinity;
    b.time += dt;
    const k = THREE.MathUtils.smootherstep(b.time, 0, 0.9);
    if (k >= 1) {
      this.blend = null;
      this.zoomTo(1);
      return;
    }
    this.camera.position.lerpVectors(b.from, this.camera.position, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(b.aim, this.target, k));
    this.camera.fov = THREE.MathUtils.lerp(b.fov, this.fov, k);
    this.camera.updateProjectionMatrix();
  }

  // Nothing solid on the line from a to b.
  clear(world, a, b) {
    const d = new THREE.Vector3().subVectors(b, a), far = d.length();
    this.ray.set(a, d.divideScalar(far));
    this.ray.far = far + 0.4;
    return !this.first(world);
  }

  // The first rock along this.ray, testing only the rocks whose box it passes through.
  first(world) {
    const { ray, far } = this.ray;
    let best;
    for (const mesh of world.blockers) {
      let box = BOXES.get(mesh);
      if (!box) BOXES.set(mesh, box = new THREE.Box3().setFromObject(mesh));
      if (!box.containsPoint(ray.origin) && !(ray.intersectBox(box, _hit) && _hit.distanceTo(ray.origin) <= far)) continue;
      const hit = this.ray.intersectObject(mesh, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  zoomTo(k) {
    const fov = this.fov * k;
    if (Math.abs(this.camera.fov - fov) < 1e-4) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // The first rock on the line from Mnot back to where the camera would be at this tilt.
  cast(world, pitch, distance) {
    const back = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch),
      -Math.cos(this.yaw) * Math.cos(pitch));
    this.ray.set(this.target, back);
    this.ray.far = distance;
    return this.first(world);
  }
}

// The camera sits at theta from the route's way (on its right) and looks back at Mnot.
export function lookYaw({ dir, theta }) {
  const px = dir.x * Math.cos(theta) - dir.z * Math.sin(theta), pz = dir.z * Math.cos(theta) + dir.x * Math.sin(theta);
  return Math.atan2(-px, -pz);
}
