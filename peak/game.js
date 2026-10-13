// The rules: dents are the health, checkpoints pop them out, a fall into the abyss costs a dent and brings Mnot back
// to the last safe spot, and the fourth dent flattens the can: back to the last checkpoint. Reach the summit flag
// to win. Every mishap gets a joke (quips.js) and how many dents the can has.
import { quip } from './ui/quips.js';

export const MAX_DENTS = 4;
const HURT_IMPACT = 9;          // a landing this fast (m/s, about a 2.7 m drop) dents the can
const SAFE_TIME = 1.2;          // no new dent this soon after the last one
const FADE = { fall: 2.4, flat: 1.4 };   // seconds out before the fade: a fall gets its beat, drop and poof (fall.js)

export class Game {
  constructor({ player, world, hud, camera }) {
    this.player = player;
    this.world = world;
    this.hud = hud;
    this.camera = camera;
    this.dents = 0;
    this.checkpoint = world.checkpoints[0];
    this.time = 0;
    this.falls = 0;
    this.done = false;
    this.out = null;              // { reason: 'fall' | 'flat', cause, timer } while waiting to respawn
    this.safeTimer = 0;
    this.listeners = new Map();
    player.watcher = camera.camera?.position ?? null;      // Mnot looks at the camera before it drops
    player.on('lost', ({ reason, cause }) => {
      this.out = { reason, cause, timer: 0 };
      if (reason === 'fall') this.falls++;
    });
    player.on('land', ({ impact }) => { if (impact >= HURT_IMPACT) this.dent('landing'); });
    // the first plank, ice, loose ledge and wind gap explain themselves
    const taught = new Set();
    const teach = (what, title, line, seconds = 3.2) => {
      if (!taught.has(what) && !this.out) hud.toast(title, line, seconds);
      taught.add(what);
    };
    player.on('beam', () => teach('beam', 'Balance!', 'A / D to lean back · Shift to stand still'));
    player.on('ice', () => teach('ice', 'Ice!', 'It keeps sliding: steer against it · Shift grips', 3));
    // a pratfall on the ice costs nothing but pride: a joke, and the first time a hint
    player.on('pratfall', () => {
      const hint = taught.has('pratfall') ? '' : 'Steer in small taps · Shift grips';
      if (!this.out) hud.toast(quip('pratfall'), hint, 1.8, 'oops');
      taught.add('pratfall');
    });
    world.on('crack', () => teach('crack', 'Loose rock!', "Don't hang about", 2));
    world.on('gust', ({ at }) => {
      if (player.pos.distanceTo(at) < 4) teach('gust', 'Wind gap!', 'Watch the windsock · jump in the lull', 3);
    });
  }

  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(fn); }
  emit(name, data) { for (const fn of this.listeners.get(name) ?? []) fn(data); }

  // A hit: a rock, a hard landing. from is where it came from, for the dent's place on the can.
  dent(reason, from = null) {
    if (this.safeTimer > 0 || this.out || this.done) return false;
    this.dents++;
    this.safeTimer = SAFE_TIME;
    this.emit('dent', { reason, from, dents: this.dents });
    if (this.dents >= MAX_DENTS) this.player.lose('flat');
    else this.hud.toast(quip(reason), dentCount(this.dents), 1.6);
    return true;
  }

  popDents() {
    if (this.dents === 0) return;
    this.dents = 0;
    this.emit('pop');
  }

  update(dt) {
    if (!this.done) this.time += dt;
    this.safeTimer = Math.max(0, this.safeTimer - dt);
    if (this.out) { this.waitForRespawn(dt); return; }
    const p = this.player;
    if (!p.grounded) return;
    for (const cp of this.world.checkpoints) {
      if (cp.index <= this.checkpoint.index || p.pos.distanceTo(cp.at) > cp.radius) continue;
      this.checkpoint = cp;
      cp.flag.activate();
      const popped = this.dents > 0;
      this.popDents();
      this.hud.toast('Checkpoint', popped ? 'Dents popped out' : '');
      this.emit('checkpoint', cp);
    }
    const summit = this.world.summit;
    if (!this.done && summit && p.pos.distanceTo(summit.at) < summit.radius + 0.4) {
      this.done = true;
      p.celebrate = 4;
      this.hud.toast('PEAK MNOT', `Summit in ${clock(this.time)} · ${this.falls} ${this.falls === 1 ? 'fall' : 'falls'}`, 6);
      this.emit('summit');
    }
  }

  // Fallen: watch it drop into the clouds. Flattened: squash and wait. Then fade to white and come back.
  waitForRespawn(dt) {
    const o = this.out, p = this.player;
    o.timer += dt;
    if (o.reason === 'flat') p.squash = Math.max(0.16, p.squash - dt * 6);
    const fadeAt = FADE[o.reason];
    if (o.timer > fadeAt && !o.faded) { o.faded = true; this.hud.fade(true); }
    if (o.timer > fadeAt + 0.45) this.respawn();
  }

  respawn() {
    const { reason, cause } = this.out;
    this.out = null;
    if (reason === 'fall') this.dents++;
    const flat = this.dents >= MAX_DENTS;
    if (flat) {
      this.popDents();
      this.player.spawn(this.checkpoint.respawn, this.checkpoint.yaw);
      this.hud.toast(quip('flat'), 'Back to the last checkpoint, dents popped out', 2.8);
    } else {
      this.player.spawn(this.player.safe.pos.clone(), this.player.safe.yaw);
      this.emit('dent', { reason: 'fall', from: null, dents: this.dents });
      this.hud.toast(quip(cause ?? 'fall'), dentCount(this.dents), 2.2);
    }
    this.safeTimer = SAFE_TIME;
    this.camera.snap(this.player, this.world);
    this.hud.fade(false);
    this.emit('respawn', { flat });
  }
}

const dentCount = n => `Dent ${n} of ${MAX_DENTS}`;

export function clock(seconds) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
