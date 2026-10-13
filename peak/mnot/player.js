// Moving Mnot around the mountain: running, careful steps, jumps with the rig's own timing, walls and ledges, and
// handing over to Balance on planks and ropes and to Skate on ice. Rules (dents, checkpoints, respawns) live in
// game.js; the player only reports what happened through on()/emit().
import * as THREE from 'three';
import { Balance } from './balance.js';
import { Pose } from './pose.js';
import { Fall, canLand } from './fall.js';
import { Skate } from './skate.js';

const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.24, HEIGHT = 1.6;
const STEP_UP = 0.26, STEP_DOWN = 0.32;   // climbed or stepped down without a jump
const EDGE = 0.1;                         // the feet may stand this far past a rock's edge
const SEAM = 0.02;                        // careful steps cross a gap this narrow between two rocks
const AIR_REACH = 0.14;                   // a jump that comes up just short of a ledge still lands on it
const COYOTE = 0.12;                      // seconds after walking off an edge in which a jump still works
const BUFFER = 0.14;                      // seconds a jump press is remembered before touchdown
const BEAM_CATCH = 0.6;                  // how far to the side of a beam's end stepping off still gets onto it
const LOST_DROP = 9;                      // falling this far below the last safe spot means the abyss for sure
const GRIP = { moving: 14, still: 22 };   // how fast the speed follows the keys on rock (ice: skate.js)
const JET = { air: 1.5, ground: 0.35, ice: 1.1 };      // m/s pushed by a wind gap's full gust (weather.js)
// Seconds into a landing before moving cuts it short, and before the next jump is allowed.
const MOVE_LAG = { Land: 0.1, LeapLand: 0, LandHard: 0.5 }, JUMP_LAG = { LandHard: 0.45 };

export class Player {
  constructor(world, mnot) {
    this.world = world;
    this.root = mnot.root;
    this.anim = mnot.animator;
    this.rig = mnot.rig;
    this.gravity = this.rig.jump_gravity;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();       // horizontal
    this.vy = 0;
    this.yaw = 0;
    this.mode = 'ground';                 // 'ground', 'air', 'beam' or 'out' (lost or flattened, waiting to respawn)
    this.fall = new Fall(this);           // the cartoon fall into the abyss (fall.js)
    this.hang = 0;                        // seconds left of its beat in mid-air, before the drop
    this.watcher = null;                  // where the camera is, for the look at it before the drop
    this.jumpPhase = null;                // null, 'takeoff', 'air' or 'landing'
    this.launchSpeed = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.support = null;                  // the rock under the feet
    this.slipped = null;                  // the beam just slipped off, which can't catch Mnot again
    this.moving = false;
    this.listeners = new Map();
    this.balance = new Balance(this);
    this.skate = new Skate(this);         // sliding and wobbling on ice
    this.pose = new Pose(mnot);           // feet on the rope, arms out, flapping
    this.tilt = { axis: new THREE.Vector3(1, 0, 0), angle: 0, toppling: 0 };
    this.squash = 1;                      // 1 is a whole can; the rules squash it when it's flattened
    this.celebrate = 0;                   // seconds of waving left, at the summit
    this.idleClip = null;                 // a clip to stand about in instead (moments.js, title.js): visual only
    this.safe = { pos: new THREE.Vector3(), yaw: 0 };
    this.safeTime = 0;
    this.icy = false;                     // standing on ice
    this.carried = new THREE.Vector3();   // the speed of the platform under the feet
    this.last = { support: null, icy: false, jet: 0 };   // what Mnot last stood on, and the gust since, for jokes
  }

  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(fn); }
  emit(name, data) { for (const fn of this.listeners.get(name) ?? []) fn(data); }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get grounded() { return this.mode === 'ground' && this.jumpPhase !== 'takeoff' || this.mode === 'beam'; }

  spawn(pos, yaw) {
    this.balance.leave();
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.mode = 'ground';
    this.jumpPhase = null;
    this.support = this.world.ground(pos.x, pos.z, pos.y + STEP_UP, EDGE);
    this.tilt.angle = this.tilt.toppling = 0;
    this.slipped = null;
    this.squash = 1;
    this.fall.stop();
    this.skate.stop();
    this.safe.pos.copy(pos);
    this.safe.yaw = yaw;
    this.anim.play('Idle', 0);
    this.place();
  }

  // input: { move: world-space Vector3 (length ≤ 1), careful, jump (pressed this frame) }
  // wind: { dir: unit Vector3, strength: 0..1 here }
  update(dt, input, wind) {
    this.jumpBuffer = input.jump ? BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.moving = input.move.lengthSq() > 0;
    this.celebrate = Math.max(0, this.celebrate - dt);
    // a moving platform carries whoever stands on it
    if (this.mode === 'ground' && this.support) {
      this.pos.add(this.support.moved);
      this.carried.copy(this.support.moved).divideScalar(dt);
    } else this.carried.set(0, 0, 0);
    if (this.mode === 'air') this.last.jet = Math.max(this.last.jet, wind.jet ?? 0);
    if (this.mode === 'out') this.drift(dt);
    else if (this.mode === 'beam') this.balance.update(dt, input, wind);
    else this.move(dt, input, wind);
    if (this.mode !== 'beam' && this.mode !== 'out') this.animate(input);
    this.skate.update(dt, input);
    this.anim.update(dt);
    if (this.jumpPhase === 'takeoff' && this.anim.time >= this.takeoffTime()) this.launch();
    if (this.jumpPhase === 'landing' && this.anim.finished) this.jumpPhase = null;
    if (this.jumpPhase === 'air' && this.anim.finished) this.anim.play('Fall', 0.25);
    this.updateTilt(dt);
    this.place();
    this.pose.update(dt, this);
  }

  // ------------------------------------------------------------------ on the ground and in the air

  move(dt, input, wind) {
    const onGround = this.mode === 'ground';
    const landing = this.jumpPhase === 'landing' ? this.anim.current : null;
    if (landing && this.moving && this.anim.time >= (MOVE_LAG[landing] ?? Infinity)) this.jumpPhase = null;
    const stopped = this.jumpPhase === 'landing' && landing === 'LandHard';

    if (this.jumpBuffer > 0 && this.canJump()) this.startJump(input);
    else if (this.jumpBuffer > 0 && this.mode === 'air' && this.coyote > 0 && !this.jumpPhase) this.coyoteJump();

    const top = stopped ? 0 : input.careful ? this.rig.walk_speed : this.rig.run_speed;
    const desired = new THREE.Vector3().copy(input.move).multiplyScalar(top);
    const ice = onGround ? this.world.iceAt(this.pos.x, this.pos.z, this.pos.y) : null, icy = !!ice;
    if (icy && !this.icy) this.emit('ice');
    this.icy = icy;
    if (onGround && (icy || this.skate.busy)) this.skate.slide(dt, input, desired, ice, top);
    else if (onGround) this.vel.lerp(desired, 1 - Math.exp(-GRIP[this.moving ? 'moving' : 'still'] * dt));
    else if (this.moving) this.vel.lerp(desired.setLength(this.rig.run_speed * input.move.length()), 1 - Math.exp(-4 * dt));
    if (!icy && this.vel.lengthSq() < 0.0002) this.vel.set(0, 0, 0);      // (ice creeps downhill from a standstill)

    // a strong gust shoves Mnot on the ground, harder in the air and in a wind gap; careful steps hold on
    const jet = wind.jet ?? 0, ground = 0.6 * Math.max(0, wind.strength - 0.55) + JET[icy ? 'ice' : 'ground'] * jet;
    const push = onGround ? (input.careful ? 0 : ground) : 0.5 * wind.strength + JET.air * jet;
    const before = this.pos.clone();
    this.pos.x += (this.vel.x + wind.dir.x * push) * dt;
    this.pos.z += (this.vel.z + wind.dir.z * push) * dt;
    const hit = this.world.pushOut(this.pos, RADIUS, this.pos.y + (onGround ? STEP_UP : AIR_REACH), this.pos.y + HEIGHT);
    if (hit) {
      const into = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (into < 0) { this.vel.x -= into * hit.nx; this.vel.z -= into * hit.nz; }
    }
    if (onGround && input.careful && !this.footing(this.pos)) this.holdEdge(before);
    // on ice Mnot faces where it wants to go, whichever way it slides (down after a pratfall, skate.js turns it)
    const free = !this.skate.busy;
    if (free && icy && this.moving) this.turnTowards(Math.atan2(input.move.x, input.move.z), 10, dt);
    else if (free && this.speed > 0.05) this.turnTowards(Math.atan2(this.vel.x, this.vel.z), onGround ? 18 : 8, dt);

    if (this.mode === 'ground') this.followGround(dt);
    else this.fly(dt);
  }

  // Something to stand on at p: a rock under the middle of the feet, or a plank or rope.
  footing(p) {
    const solid = this.world.ground(p.x, p.z, this.pos.y + STEP_UP, SEAM);
    if (solid && solid.top >= this.pos.y - STEP_DOWN) return true;
    return !!this.world.beam(p.x, p.z, this.pos.y - STEP_DOWN, this.pos.y + STEP_UP);
  }

  // Careful steps slide along an edge instead of going over it.
  holdEdge(before) {
    const tryX = before.clone().setX(this.pos.x), tryZ = before.clone().setZ(this.pos.z);
    if (this.footing(tryX)) { this.pos.copy(tryX); this.vel.z = 0; }
    else if (this.footing(tryZ)) { this.pos.copy(tryZ); this.vel.x = 0; }
    else { this.pos.copy(before); this.vel.set(0, 0, 0); }
  }

  followGround(dt) {
    const solid = this.world.ground(this.pos.x, this.pos.z, this.pos.y + STEP_UP, EDGE);
    if (solid && solid.top >= this.pos.y - STEP_DOWN) {
      this.pos.y = solid.top;
      this.stand(solid);
      this.trackSafe(dt);
      return;
    }
    // stepping off near a plank or rope's end gets Mnot onto it, even a little to the side (Balance eases it in)
    const beam = this.world.beam(this.pos.x, this.pos.z, this.pos.y - STEP_DOWN, this.pos.y + STEP_UP, BEAM_CATCH);
    if (beam) { this.balance.enter(beam, this.speed, 0); return; }
    // walked off the edge
    this.mode = 'air';
    this.vy = 0;
    this.support = null;
    if (this.jumpPhase === 'takeoff') this.launch();     // pushed off right at the edge
    else {
      this.jumpPhase = null;
      this.coyote = COYOTE;
      this.anim.play('Fall', 0.3);
    }
  }

  // On a rock: a loose ledge starts to crumble, and the jokes remember it.
  stand(solid) {
    this.support = solid;
    solid.touch?.(this);
    this.last.support = solid;
    this.last.icy = this.world.icy(this.pos.x, this.pos.z, solid.top);
    this.last.jet = 0;
  }

  fly(dt) {
    const prevY = this.pos.y;
    this.pos.y += this.vy * dt - this.gravity * dt * dt / 2;
    this.vy -= this.gravity * dt;
    if (this.vy <= 0) {
      const solid = this.world.ground(this.pos.x, this.pos.z, prevY + AIR_REACH, EDGE);
      if (solid && this.pos.y <= solid.top) {
        this.pos.y = solid.top;
        this.touchDown(-this.vy, solid);
        return;
      }
      const beam = this.world.beam(this.pos.x, this.pos.z, this.pos.y - 0.02, prevY + 0.02, 0.28);
      if (beam && beam.beam !== this.slipped) {
        this.jumpPhase = null;
        this.balance.enter(beam, this.speed, -this.vy);
        this.emit('land', { hard: false, impact: -this.vy, beam: true });
        return;
      }
    }
    // nothing left to land on: that's the abyss
    const floor = this.safe.pos.y - LOST_DROP;
    if (this.pos.y < floor) this.lose('fall');
    else if (this.vy < 0 && !this.coyote && !canLand(this, { edge: EDGE, reach: AIR_REACH, floor })) this.lose('fall');
  }

  // ------------------------------------------------------------------ jumping

  takeoffTime() {
    return this.anim.current === 'JumpStart' ? this.rig.jump_takeoff : this.rig.leap_takeoff;
  }

  canJump() {
    if (this.mode !== 'ground' || this.skate.busy) return false;
    return !this.jumpPhase || this.jumpPhase === 'landing' && this.anim.time >= (JUMP_LAG[this.anim.current] ?? 0);
  }

  startJump(input) {
    const moving = this.speed > 0.25 || this.moving;
    const running = moving && !input.careful;
    this.anim.play(moving ? 'LeapStart' : 'JumpStart', moving ? 0.1 : 0.06, { restart: true });
    this.launchSpeed = Math.sqrt(2 * this.gravity * (running ? this.rig.run_jump_height : this.rig.jump_height));
    this.jumpPhase = 'takeoff';
    this.jumpBuffer = 0;
  }

  // Jump a moment after running off an edge: straight into the flight of a running jump.
  coyoteJump() {
    this.anim.play('LeapStart', 0.08, { restart: true, at: this.rig.leap_takeoff });
    this.launchSpeed = Math.sqrt(2 * this.gravity * this.rig.run_jump_height);
    this.jumpBuffer = 0;
    this.launch();
  }

  launch() {
    this.mode = 'air';
    this.jumpPhase = 'air';
    this.vy = this.launchSpeed + Math.max(0, this.carried.y);
    this.vel.x += this.carried.x;     // jumping off a moving platform keeps its speed
    this.vel.z += this.carried.z;
    this.support = null;
    this.coyote = 0;
    this.emit('jump');
  }

  touchDown(impact, solid) {
    this.mode = 'ground';
    this.vy = 0;
    this.stand(solid);
    this.tilt.toppling = 0;
    this.slipped = null;
    const hard = impact >= this.rig.hard_landing_speed;
    const clip = hard ? 'LandHard' : this.moving ? 'LeapLand' : 'Land';
    this.anim.play(clip, clip === 'LeapLand' ? 0.08 : 0.05, { restart: true });
    this.jumpPhase = 'landing';
    this.emit('land', { hard, impact });
    if (!hard && this.jumpBuffer > 0) this.startJump({ careful: false });
  }

  // ------------------------------------------------------------------ lost, respawn, looks

  lose(reason) {
    if (this.mode === 'out') return;
    this.balance.leave();
    this.mode = 'out';
    this.jumpPhase = null;
    this.emit('lost', { reason, cause: reason === 'fall' ? this.cause() : reason });
    if (reason === 'fall') this.fall.start();
  }

  // What a fall was down to, for the joke: a ledge that crumbled, a gust in a wind gap, ice, a missed gondola.
  cause() {
    const { support, icy, jet } = this.last;
    if (support?.loose && support.off) return 'crumble';
    if (jet > 0.3) return 'gust';
    if (icy) return 'ice';
    if (support?.moving || this.world.hazards.some(h => h.covers?.(this.pos))) return 'gondola';
    return 'fall';
  }

  // A falling rock's bonk: a hop away from where it landed.
  knock(away) {
    if (this.mode === 'out' || this.mode === 'beam') return;
    this.mode = 'air';
    this.support = null;
    this.jumpPhase = null;
    this.vy = 3.2;
    this.vel.copy(away).setY(0).normalize().multiplyScalar(1.4);     // not so far it knocks Mnot off the edge
    this.anim.play('Fall', 0.1);
  }

  // While out, a fall carries on (fall.js) until the rules respawn Mnot.
  drift(dt) {
    if (this.fall.active) { this.fall.update(dt); return; }
    if (this.squash < 1) return;
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y += this.vy * dt;
    this.vy = Math.max(this.vy - this.gravity * dt, -25);
  }

  // Remember a spot to come back to after a fall: well inside a rock, standing still or walking.
  trackSafe(dt) {
    if (this.jumpPhase || !this.support || this.support.loose || this.support.moving || this.icy) {
      this.safeTime = 0;
      return;
    }
    this.safeTime += dt;
    if (this.safeTime < 0.3 || this.support.closest(this.pos.x, this.pos.z).d > -0.28) return;
    this.safe.pos.copy(this.pos);
    this.safe.yaw = this.yaw;
  }

  animate(input) {
    if (this.jumpPhase || this.mode !== 'ground' || this.skate.busy) return;
    const gait = input.careful ? 'Walk' : 'Run';
    // on ice the feet stay planted while it slides, and scrabble faster than it goes when pushing
    if (this.moving || this.speed > 0.1 && !this.icy) this.anim.play(gait, 0.15);
    else this.anim.play(this.idleClip ?? (this.celebrate > 0 ? 'Wave' : 'Idle'), 0.2);
    const scrabble = this.icy && this.moving && !input.careful;
    const pace = scrabble ? Math.max(1.5 * this.speed, this.rig.run_speed) : this.speed;
    this.anim.setGaitSpeed(pace, { Walk: this.rig.walk_speed, Run: this.rig.run_speed });
  }

  // An about-turn goes round by the camera, so it shows the face and not the back of the can.
  turnTowards(yaw, rate, dt) {
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    let d = wrap(yaw - this.yaw);
    if (Math.abs(d) > 2.5 && this.watcher) {
      const face = wrap(Math.atan2(this.watcher.x - this.pos.x, this.watcher.z - this.pos.z) - this.yaw);
      if (d > 0 ? face < 0 || face > d : face > 0 || face < d) d -= Math.sign(d) * 2 * Math.PI;
    }
    this.yaw += d * (1 - Math.exp(-rate * dt));
  }

  // On a beam the lean tilts the whole can about its feet; after a slip it topples further while it falls. On ice
  // the wobble leans it (skate.js).
  updateTilt(dt) {
    const t = this.tilt;
    if (this.mode === 'beam' || this.skate.tilting) return;
    if (t.toppling) t.angle = THREE.MathUtils.clamp(t.angle + t.toppling * dt * 2.2, -1.5, 1.5);
    else t.angle = THREE.MathUtils.damp(t.angle, 0, 7, dt);
  }

  place() {
    this.root.position.copy(this.pos);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    this.root.quaternion.setFromAxisAngle(this.tilt.axis, this.tilt.angle).multiply(yawQ);
    this.fall.turn(this.root);
    this.skate.place(this.root);
    const s = this.squash;
    this.root.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5);
  }
}
