// The downhill's tab in the viewer (index.html#downhill, peak/viewer/tabs.js): Mnot on the office chair in the studio,
// in the game's look, to try its moves one at a time: rolling laps, the tuck, the heels down, a spin on the swivel,
// the gas-lift jump, a crash, a wheel off and fresh casters, the title's acts, and the finish party on the music's
// beat. The chair, Mnot's pose on it, the party and the sounds are the game's own (chair.js, rider.js, party.js,
// sfx.js, music.js); only the ride is a stand-in, on a flat floor (StudioRide).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage } from '../kit/stage.js';
import { warmUp } from '../kit/warmup.js';
import { confetti } from '../kit/party.js';
import { toon } from '../look/look.js';
import { bursts } from '../look/bursts.js';
import { loadMnot } from '../mnot/mnot.js';
import { Chair, CHAIR, PRICE } from './chair.js';
import { Rider } from './rider.js';
import { Party } from './party.js';
import { G, FEEL } from './ride.js';
import { DownhillSfx } from './sfx.js';
import { DownhillMusic } from './music.js';

const UP = new THREE.Vector3(0, 1, 0);
const LAP = { radius: 3, speed: 4, tucked: 6.5 };      // the laps: m round, m/s sitting up and tucked in
const ACTS = { PushGlasses: null, Wave: 2.4, LookUp: null };   // the title's acts, s (null: the clip's length)
const CRASHES = ['desk', 'cabinet', 'printer', 'tree', 'rock'];
const PAPER = ['#ffffff', '#ffe45c', '#ff8fc0', '#7fd0ff', '#ffe45c', '#a8ec7a'].map(c => new THREE.Color(c));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _old = new THREE.Vector3();
const _q = new THREE.Quaternion(), _r = new THREE.Quaternion();

// The ride on a flat floor, with what the chair, the rider and the party read of ride.js's: rolling round in laps or
// rolling out to a stop, the seat on its swivel (the same bearing and pendulum, the feet keeping it turned along),
// the gas lift and the seat's rocking (the same springs), and what the chair feels (g less its acceleration).
class StudioRide {
  constructor(on) {
    this.on = on;                                 // { jump(), land(impact, air) }
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.tiltQ = new THREE.Quaternion();          // the floor is flat
    this.feel = new THREE.Vector3(0, -G, 0);
    this.rock = { x: 0, z: 0, vx: 0, vz: 0 };
    this.wheels = new Array(CHAIR.legs).fill(true);
    this.center = new THREE.Vector3();
    this.armsOut = 0;                             // set by the rider each frame
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.feel.set(0, -G, 0);
    Object.assign(this.rock, { x: 0, z: 0, vx: 0, vz: 0 });
    Object.assign(this, { grounded: true, airTime: 0, seatYaw: 0, seatL: 0, baseYaw: 0.3, baseSpin: 0, lift: 0,
      liftVel: 0, lever: 0, crouch: -1, out: false, done: false, laps: false, lapSpeed: 0, angle: 0, aim: 0,
      spinning: false, time: 0 });
  }

  get missing() { return this.wheels.filter(w => !w).length; }
  get speed() { return this.vel.length(); }
  get seatSpin() { return this.seatL / this.inertia; }
  get inertia() { return FEEL.inertia + FEEL.arms * this.armsOut; }

  // round a circle to the left, starting the way Mnot faces
  startLaps() {
    if (this.laps) return;
    const y = this.seatYaw;
    this.center.copy(this.pos).add(_a.set(Math.cos(y), 0, -Math.sin(y)).multiplyScalar(LAP.radius)).setY(0);
    this.angle = Math.atan2(this.pos.z - this.center.z, this.pos.x - this.center.x);
    this.lapSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.laps = true;
  }

  spin(rate) { this.seatL += rate * this.inertia; this.spinning = true; }

  // a knock from the side: the chair shoved, the seat turned and rocked
  knock(impulse) {
    const side = Math.random() < 0.5 ? -1 : 1, y = this.seatYaw;
    if (!this.laps) this.vel.add(_a.set(Math.cos(y), 0, -Math.sin(y)).multiplyScalar(side * impulse * 0.25));
    this.spin(side * impulse * 0.6);
    this.rock.vz += side * impulse * 0.5;
    this.rock.vx -= impulse * 0.3;
  }

  step(dt, intent) {
    this.time += dt;
    _old.copy(this.vel);
    const braking = intent.brake && this.grounded;
    if (this.laps) {
      // the speed round the circle: pushed up to the lap's, or down by the heels
      const want = braking ? 0 : intent.tuck ? LAP.tucked : LAP.speed;
      const rate = braking ? 7 : 3;
      this.lapSpeed += THREE.MathUtils.clamp(want - this.lapSpeed, -rate * dt, rate * dt);
      this.angle -= this.lapSpeed / LAP.radius * dt;
      this.pos.x = this.center.x + LAP.radius * Math.cos(this.angle);
      this.pos.z = this.center.z + LAP.radius * Math.sin(this.angle);
      this.vel.x = this.lapSpeed * Math.sin(this.angle);
      this.vel.z = -this.lapSpeed * Math.cos(this.angle);
    } else {
      // rolling out to a stop, sooner with the heels down
      const flat = Math.hypot(this.vel.x, this.vel.z), slow = this.grounded ? (braking ? 8 : 1.4) : 0;
      const k = flat > 0 ? Math.max(0, flat - slow * dt) / flat : 0;
      this.vel.x *= k; this.vel.z *= k;
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    }
    this.jumpStep(dt, intent);
    if (!this.grounded) {
      this.vel.y -= G * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        const impact = -this.vel.y;
        this.pos.y = this.vel.y = 0;
        this.grounded = true;
        this.on.land(impact, this.airTime);
      }
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    this.feel.set(0, -G, 0).addScaledVector(_b.subVectors(this.vel, _old), -1 / dt);
    this.spinSeat(dt, braking);
    this.springs(dt);
  }

  // as ride.js's: a quick crouch, then the gas lift pops the chair up
  jumpStep(dt, intent) {
    if (intent.jump && this.grounded && this.crouch < 0) { this.crouch = 0; this.lever = 1; }
    if (this.crouch >= 0) {
      this.crouch += dt;
      if (this.crouch >= 0.07) {
        this.crouch = -1;
        if (this.grounded) {
          this.vel.y += FEEL.jump;
          this.liftVel += 1.6;
          this.grounded = false;
          this.on.jump();
        }
      }
    }
    this.lever = Math.max(0, this.lever - dt * 3);
  }

  // The seat: ride.js's pendulum and bearing, and the feet holding it turned along the way it rolls (or swaying
  // lazily, standing still) unless it's been spun; a spin is left to run down, quicker with the heels down.
  spinSeat(dt, braking) {
    const I = this.inertia, forward = _a.set(Math.sin(this.seatYaw), 0, Math.cos(this.seatYaw));
    let torque = _b.copy(forward).multiplyScalar(-FEEL.offset).cross(this.feel).dot(UP);
    const rel = this.seatL / I - this.baseSpin;
    if (this.spinning && Math.abs(rel) < 1.2) { this.spinning = false; this.aim = this.seatYaw; }
    if (braking) this.seatL *= Math.exp(-FEEL.brakeCalm * dt);
    if (!this.spinning && this.grounded) {
      const flat = Math.hypot(this.vel.x, this.vel.z);
      if (flat > 0.3) this.aim = Math.atan2(this.vel.x, this.vel.z);
      const sway = flat > 0.3 ? 0 : 0.14 * Math.sin(this.time * 0.8);
      const off = this.aim + sway - this.seatYaw;
      torque += 2 * Math.atan2(Math.sin(off), Math.cos(off)) - 0.9 * rel;
    }
    let bearing = -FEEL.bearing * rel;
    bearing -= Math.sign(rel) * Math.min(FEEL.stiction, Math.abs(rel) * I / dt);
    this.seatL += (torque + bearing) * dt;
    this.seatYaw += this.seatL / I * dt;
    // the star turns a little with the bearing's pull, and its casters scrub it out
    this.baseSpin += -bearing / FEEL.baseInertia * dt;
    this.baseSpin *= Math.exp(-(this.grounded ? FEEL.scrub : 0.3) * dt);
    this.baseYaw += this.baseSpin * dt;
  }

  // as ride.js's: the gas spring, and the seat rocking away from the pull
  springs(dt) {
    const L = FEEL.lift, R = FEEL.rock, r = this.rock;
    const load = -this.feel.y - G;
    const target = this.crouch >= 0 ? -0.06 : 0;
    this.liftVel += (-L.k * (this.lift - target) - L.c * this.liftVel - load * L.give) * dt;
    this.lift = THREE.MathUtils.clamp(this.lift + this.liftVel * dt, -0.09, 0.08);
    const f = _a.copy(this.feel).applyQuaternion(_q.setFromAxisAngle(UP, this.seatYaw).invert());
    const down = Math.max(2, -f.y);
    const wantX = THREE.MathUtils.clamp(Math.atan2(-f.z, down) * R.lean, -0.25, 0.25);
    const wantZ = THREE.MathUtils.clamp(Math.atan2(f.x, down) * R.lean, -0.25, 0.25);
    r.vx += (R.k * (wantX - r.x) - R.c * r.vx) * dt;
    r.vz += (R.k * (wantZ - r.z) - R.c * r.vz) * dt;
    r.x += r.vx * dt; r.z += r.vz * dt;
  }
}

// The tab: its own canvas and buttons in a section of the page. sounds: the viewer's, for its Sound switch.
export async function createTab({ sounds }) {
  const section = document.createElement('section');
  section.hidden = true;
  section.innerHTML = `
    <div class="info"><b>Downhill</b> · Mnot on a ${PRICE} office chair, in the game's look<br>Space to jump ·
      W to tuck · S to brake · A / D to spin the seat · E to wave · P to party · M to mute · drag to orbit</div>
    <div class="ui">
      <div class="group" role="group" aria-label="Ride"><button data-do="sit">Sit</button><button
        data-do="laps">Roll laps</button><button data-do="tuck">Tuck</button><button
        data-do="brake">Brake</button></div>
      <div class="group" role="group" aria-label="Moves"><button data-do="spin">Spin</button><button
        data-do="jump">Jump</button><button data-do="crash">Crash</button></div>
      <div class="group" role="group" aria-label="Wheels"><button data-do="wheel">Lose a wheel</button><button
        data-do="fix">Fresh casters</button></div>
      <div class="group" role="group" aria-label="Acts"><button data-act="PushGlasses">Push glasses</button><button
        data-act="Wave">Wave</button><button data-act="LookUp">Look up</button></div>
      <div class="group"><button data-do="party">Party</button></div>
      <div class="group"><button data-do="sound">Sound on</button></div>
    </div>`;
  document.body.appendChild(section);

  const stage = createStage({ fov: 38, shadow: { half: 4, near: 0.5, far: 40, bias: -0.0005, back: 12 } });
  const { renderer, scene, camera, post, render } = stage;
  section.prepend(renderer.domElement);
  // the studio: the Mnot tab's dark floor and grid, in the game's light
  scene.background = new THREE.Color('#20242b');
  scene.fog = new THREE.Fog('#20242b', 9, 24);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    toon('#2b3139', { outline: false }));
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(80, 80, '#3b434d', '#343b44');
  grid.position.y = 0.002;
  grid.material.userData.outlineParameters = { visible: false };
  scene.add(floor, grid);
  const world = { group: new THREE.Group(), animated: [], ground: () => ({ top: 0 }) };
  scene.add(world.group);
  const puffs = bursts(world);

  const chair = new Chair();
  scene.add(chair.root);
  const mnot = await loadMnot();
  const rider = new Rider(mnot, chair);
  const sfx = new DownhillSfx(sounds);
  const music = new DownhillMusic(sounds);
  const party = new Party();
  const ride = new StudioRide({
    jump: () => sfx.cue({ type: 'jump' }),
    land: (impact, air) => { rider.land(impact); sfx.cue({ type: 'land', impact, air }); },
  });

  camera.position.set(2.2, 1.6, 4.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.8, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 1.5;
  controls.maxDistance = 12;

  // ------------------------------------------------------------------ what the buttons and keys do

  const held = new Set(), toggled = { tuck: false, brake: false };
  let jump = false, act = null, actLeft = 0, partying = false, shown = false, idle = true;
  const loose = [];                                  // casters that came off, rolling about on the floor
  function stopParty() {
    if (!partying) return;
    partying = false;
    party.reset();
    ride.done = false;
    ride.aim = ride.seatYaw;
    music.reset();
  }
  function startParty() {
    partying = true;
    ride.laps = false;
    ride.done = true;
    sounds.play('wave');
    music.start();
    music.finish();
    confetti(puffs, ride.pos);
  }
  // the feet turn the seat round to the camera, as for a photo
  function faceCamera() {
    ride.spinning = false;
    ride.aim = Math.atan2(camera.position.x - ride.pos.x, camera.position.z - ride.pos.z);
  }
  function loseWheel() {
    const left = ride.wheels.flatMap((on, i) => on ? [i] : []);
    if (!left.length) return;
    const index = left[Math.floor(Math.random() * left.length)];
    ride.wheels[index] = false;
    const caster = chair.dropWheel(index);
    scene.add(caster);
    loose.push({ caster, spin: (Math.random() - 0.5) * 12, vel: ride.vel.clone().multiplyScalar(0.85)
      .add(_a.set(Math.random() - 0.5, 2.5 + Math.random() * 2, Math.random() - 0.5)) });
    sfx.cue({ type: 'wheel', cause: 'viewer', left: left.length - 1 });
    if (left.length === 1) sfx.cue({ type: 'wrecked' });
  }
  function fresh() {
    ride.wheels.fill(true);
    chair.fix();
    for (const { caster } of loose.splice(0)) scene.remove(caster);
    sfx.cue({ type: 'pit' });
  }
  const DO = {
    sit: () => { stopParty(); ride.laps = false; faceCamera(); },
    laps: () => { stopParty(); ride.startLaps(); },
    tuck: () => { toggled.tuck = !toggled.tuck; },
    brake: () => { toggled.brake = !toggled.brake; },
    spin: (dir = 1) => { stopParty(); ride.spin(dir * 12); },
    jump: () => { stopParty(); jump = true; },
    crash: () => {
      stopParty();
      const impulse = 5 + 3 * Math.random();
      ride.knock(impulse);
      rider.crash(impulse);
      sfx.cue({ type: 'crash', impulse, kind: CRASHES[Math.floor(Math.random() * CRASHES.length)] });
    },
    wheel: loseWheel,
    fix: fresh,
    party: () => { if (partying) stopParty(); else startParty(); },
    sound: () => { sounds.setEnabled(!sounds.enabled); refresh(); },
  };
  function play(name) {
    stopParty();
    if (!ride.laps) faceCamera();
    act = name;
    actLeft = ACTS[name] ?? mnot.animator.actions.get(name)?.getClip().duration ?? 2;
  }
  section.querySelectorAll('[data-do]').forEach(b => { b.onclick = () => { DO[b.dataset.do](); refresh(); }; });
  section.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => { play(b.dataset.act); refresh(); }; });
  const button = name => section.querySelector(`[data-do="${name}"]`);
  function refresh() {
    button('sit').classList.toggle('on', !ride.laps && !partying);
    button('laps').classList.toggle('on', ride.laps);
    button('tuck').classList.toggle('on', toggled.tuck || held.has('KeyW'));
    button('brake').classList.toggle('on', toggled.brake || held.has('KeyS'));
    button('party').classList.toggle('on', partying);
    for (const b of section.querySelectorAll('[data-act]')) b.classList.toggle('on', b.dataset.act === act);
    button('sound').textContent = sounds.enabled ? 'Sound on' : 'Sound off';
    button('sound').setAttribute('aria-pressed', String(sounds.enabled));
  }

  const KEYS = new Set(['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'KeyP', 'KeyM']);
  addEventListener('keydown', e => {
    if (!shown || !KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey
      || e.target.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
    e.preventDefault();
    if (e.isTrusted) void sounds.unlock();
    held.add(e.code);
    if (!e.repeat) {
      if (e.code === 'Space') DO.jump();
      if (e.code === 'KeyA' || e.code === 'KeyD') DO.spin(e.code === 'KeyA' ? 1 : -1);
      if (e.code === 'KeyE') play('Wave');
      if (e.code === 'KeyP') DO.party();
      if (e.code === 'KeyM') DO.sound();
    }
    refresh();
  });
  addEventListener('keyup', e => { if (held.delete(e.code)) refresh(); });
  addEventListener('blur', () => { held.clear(); refresh(); });

  // ------------------------------------------------------------------ the frame

  const feet = [new THREE.Vector3(), new THREE.Vector3()], before = new THREE.Vector3();
  let spray = 0, lift = 0;
  function step(dt) {
    if (!(dt > 0)) return;
    const intent = { tuck: toggled.tuck || held.has('KeyW'), brake: toggled.brake || held.has('KeyS'), jump };
    jump = false;
    before.copy(ride.pos);
    ride.step(dt, intent);
    if (act && (actLeft -= dt) <= 0) { act = null; refresh(); }
    rider.act = act;
    // the party poses the seat, the lift and a hop of the whole chair, as in the game (main.js)
    const dance = partying ? party.update(dt, ride, camera, music.loopTime()) : null;
    if (dance) {
      Object.assign(ride, { seatYaw: dance.yaw, seatL: 0, lift: dance.lift, liftVel: 0 });
      if (dance.paper) throwPaper();
      if (dance.landed) rider.land(dance.landed);
    }
    rider.party = dance;
    rider.update(dt, ride, intent);
    chair.pose(ride, dt);
    if (dance) chair.root.position.y += dance.hop;
    sfx.update({ active: shown, speed: dance ? 0 : ride.speed, grounded: ride.grounded, surface: 'piste',
      brake: rider.brake, spin: dance ? dance.spin : ride.seatSpin, missing: ride.missing });
    // heels down while rolling: snow off the feet, as in the game
    spray += dt;
    if (rider.brake > 0.5 && ride.grounded && ride.speed > 1.5 && spray > 1 / 30) {
      spray = 0;
      chair.root.updateMatrixWorld(true);
      for (const at of rider.feet(feet)) {
        at.y = Math.min(at.y, 0.08);
        for (let k = 0; k < 3; k++) {
          puffs.add('bit', { at, size: 0.02 + 0.02 * Math.random(), life: 0.6 + 0.4 * Math.random(), gravity: 10,
            drag: 1.5, bounce: 0, spin: 8, vel: _a.copy(ride.vel).multiplyScalar(0.75)
              .add(_b.set(Math.random() - 0.5, 1 + 1.5 * Math.random(), Math.random() - 0.5)) });
        }
      }
    }
    for (const bit of loose) roll(bit, dt);
    for (const a of world.animated) a.update(dt);
    // the camera comes along with the chair, after a jump's height with a short lag (as in the Mnot tab)
    const moved = _a.subVectors(ride.pos, before);
    const rise = THREE.MathUtils.damp(lift, ride.pos.y, 6, dt);
    moved.y = rise - lift;
    lift = rise;
    camera.position.add(moved);
    controls.target.add(moved);
    controls.update();
    stage.aimSun(ride.pos);
  }

  // a sheaf of paper and sticky notes, thrown up over the chair at the party's spin (main.js throws the same)
  function throwPaper() {
    for (let i = 0; i < 40; i++) {
      puffs.add('bit', { at: ride.pos.clone().setY(ride.pos.y + 1.4), color: PAPER[i % PAPER.length], gravity: 1.8,
        drag: 2.6, spin: 7, size: 0.06 + 0.04 * Math.random(), life: 2.6 + Math.random(), bounce: 0,
        vel: new THREE.Vector3((Math.random() - 0.5) * 7, 1.5 + Math.random() * 1.8, (Math.random() - 0.5) * 7) });
    }
  }

  // a loose caster: it flies, bounces and rolls to a stop on the floor
  function roll(bit, dt) {
    const { caster, vel } = bit;
    vel.y -= G * dt;
    caster.position.addScaledVector(vel, dt);
    caster.rotateOnWorldAxis(_b.set(vel.z, 0, -vel.x).normalize(), bit.spin * dt);
    if (caster.position.y < 0.075 && vel.y < 0) {
      caster.position.y = 0.075;
      vel.y = vel.y < -1 ? -vel.y * 0.45 : 0;
      vel.x *= 0.7; vel.z *= 0.7;
      bit.spin *= vel.y ? 0.6 : Math.exp(-6 * dt);
    }
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  function frame(timestamp) {
    if (!shown) { idle = true; return; }
    timer.update(timestamp);
    post.adapt(timer.getDelta());
    step(Math.min(timer.getDelta(), 0.05));
    render();
    requestAnimationFrame(frame);
  }

  step(1 / 60);
  warmUp(scene, render);
  refresh();
  const tab = {
    show() {
      section.hidden = false;
      shown = true;
      refresh();
      if (idle) { idle = false; timer.reset(); requestAnimationFrame(frame); }
    },
    hide() {
      section.hidden = true;
      shown = false;
      stopParty();
      held.clear();
      sfx.update({ active: false, speed: 0, grounded: true, surface: 'piste', brake: 0, spin: 0, missing: 0 });
      refresh();
    },
  };
  // for debugging and tests
  window.downhillViewer = { THREE, renderer, scene, camera, ride, chair, rider, party, sfx, music, step, render,
    do: (name, ...args) => { DO[name](...args); refresh(); }, act: name => { play(name); refresh(); } };
  return tab;
}
