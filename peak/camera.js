// The camera shoots Mnot from the front-ish side, so the can and glasses stay in view. Each stretch of the route has
// its own shot on the world's rail (see route.js); planks and ropes are always shot from the front, and the summit
// gets a close-up. The camera glides from shot to shot. Drag to look around; it eases back after a moment.
import * as THREE from 'three';

const BEAM = { theta: THREE.MathUtils.degToRad(16), pitch: 0.2, distance: 3.9 };
const SUMMIT = { theta: THREE.MathUtils.degToRad(12), pitch: 0.16, distance: 3.6 };

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
    this.target = new THREE.Vector3();
    this.lead = new THREE.Vector3();
    this.lastDrag = -Infinity;
    this.time = 0;
    this.ray = new THREE.Raycaster();
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.userYaw -= (e.clientX - drag.x) * 0.006;
      this.userPitch = THREE.MathUtils.clamp(this.userPitch + (e.clientY - drag.y) * 0.004, -0.5, 0.8);
      drag = { x: e.clientX, y: e.clientY };
      this.lastDrag = this.time;
    });
    const end = () => { drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), 0.55, 1.8);
    }, { passive: true });
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

  // The shot for where Mnot is: the way the route goes there, and the camera's angle, height and distance.
  shot(player, world) {
    const rail = world.railAt(player.pos);
    if (player.celebrate > 0) return { dir: new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), ...SUMMIT, lead: 0 };
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
    this.update(0, player, world);
  }

  update(dt, player, world) {
    this.time += dt;
    const s = this.shot(player, world);
    const p = player.pos;
    // follow, with a lag on height so jumps don't shake the view; a fall into the abyss is watched from the edge
    this.lead.lerp(s.dir.clone().multiplyScalar(s.lead), 1 - Math.exp(-2 * dt));
    if (player.mode !== 'out' || p.y > player.safe.pos.y - 1.5) {
      this.target.x = THREE.MathUtils.damp(this.target.x, p.x + this.lead.x, 10, dt);
      this.target.z = THREE.MathUtils.damp(this.target.z, p.z + this.lead.z, 10, dt);
      this.target.y = THREE.MathUtils.damp(this.target.y, p.y + 0.9, player.mode === 'air' ? 3 : 6, dt);
    }
    // glide to the shot; the player's own drag eases away after a while
    if (this.time - this.lastDrag > 2) {
      this.userYaw = THREE.MathUtils.damp(this.userYaw, 0, 1.2, dt);
      this.userPitch = THREE.MathUtils.damp(this.userPitch, 0, 1.2, dt);
    }
    const rate = player.mode === 'beam' ? 3 : 1.8;
    const yaw = lookYaw(s) + this.userYaw;
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * (1 - Math.exp(-rate * dt));
    this.pitch = THREE.MathUtils.damp(this.pitch, s.pitch, rate, dt);
    this.distance = THREE.MathUtils.damp(this.distance, s.distance, rate, dt);
    const pitch = THREE.MathUtils.clamp(this.pitch + this.userPitch, -0.3, 1.3);
    const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), -Math.sin(pitch),
      Math.cos(this.yaw) * Math.cos(pitch));
    // stay in front of rocks between the camera and Mnot
    const distance = this.distance * this.zoom;
    this.ray.set(this.target, look.clone().negate());
    this.ray.far = distance;
    const hit = this.ray.intersectObjects(world.blockers, false)[0];
    const reach = hit ? Math.max(0.9, hit.distance - 0.3) : distance;
    this.reach = reach < this.reach ? reach : THREE.MathUtils.damp(this.reach, reach, 2.5, dt);
    this.camera.position.copy(this.target).addScaledVector(look, -this.reach);
    this.camera.lookAt(this.target);
  }
}

// The camera sits at theta from the route's way (on its right) and looks back at Mnot.
function lookYaw({ dir, theta }) {
  const px = dir.x * Math.cos(theta) - dir.z * Math.sin(theta), pz = dir.z * Math.cos(theta) + dir.x * Math.sin(theta);
  return Math.atan2(-px, -pz);
}
