// Little moments on top of the clips, for the eye only: they pick the clip Mnot stands about in (player.idleClip) and
// never touch the physics. Left standing on solid ground, Mnot fidgets: it pushes its glasses back up after a
// checkpoint or a close call on a beam, taps a foot while waiting for the gondola or for a loose ledge to grow back,
// looks up at the climb when the next checkpoint is well above, and otherwise does a random one after 4-6 s, never
// the same twice in a row. Not on a beam, ice, a loose ledge or anything moving, and not in the wind. Any input
// cancels a fidget at once. At the summit Mnot dances, in a burst of confetti, until the player moves on; while it
// dances it keeps player.celebrate up, which holds the camera's summit close-up. The title screen runs its own show,
// so nothing happens here while it's busy.
import * as THREE from 'three';
import { random } from '../world/world.js';
import { bursts } from '../look/bursts.js';
import { FALL_ANGLE } from './balance.js';

const FIDGETS = ['PushGlasses', 'TapFoot', 'LookUp'];
const IDLE = [4, 6];             // seconds standing still before a random fidget
const TAP = 1.4;                 // ... before tapping a foot while waiting, and between the taps
const LOOK = 1.8;                // ... before looking up at the climb ahead
const ASKED = 6;                 // a fidget a moment calls for, if Mnot stands still within this many seconds
const CLOSE_CALL = 0.75;         // a lean this far towards slipping off a beam (of FALL_ANGLE) is a close call
const CONFETTI = ['#e23b2e', '#ffc23d', '#4aa8f0', '#22a98f', '#ffffff', '#ff6a55'].map(c => new THREE.Color(c));

export class Moments {
  constructor({ player, game, world, weather, title = null }) {
    Object.assign(this, { player, game, world, weather, title });
    this.rand = random(4810);
    this.still = 0;               // seconds standing still and calm
    this.idle = this.pickIdle();
    this.playing = null;          // the fidget playing now
    this.last = null;             // the one before
    this.asked = null;            // { clip, after, left }
    this.looked = null;           // the checkpoint Mnot last looked up at the climb from
    this.gone = new Set();        // loose ledges that dropped away and aren't back yet
    this.edge = 0;                // the worst lean on the beam Mnot is on, of FALL_ANGLE
    this.dance = null;
    game.on('checkpoint', () => this.ask('PushGlasses', 0.6));
    game.on('summit', () => this.startDance());
    world.on('crumble', ({ solid }) => this.gone.add(solid));
    world.on('regrow', ({ solid }) => this.gone.delete(solid));
  }

  // Call once per step, after the player has moved.
  update(dt, intent) {
    const p = this.player;
    // a close call on a beam: once Mnot is safely off it, the glasses go back up
    if (p.mode === 'beam') this.edge = Math.max(this.edge, Math.abs(p.balance.lean) / FALL_ANGLE);
    else {
      if (this.edge >= CLOSE_CALL && p.mode === 'ground') this.ask('PushGlasses', 0.3);
      this.edge = 0;
    }
    if (this.asked && (this.asked.left -= dt) <= 0) this.asked = null;
    if (this.title?.busy) return;
    if (this.dance) { this.danceStep(dt, intent); return; }
    if (intent.move.lengthSq() > 0 || intent.jump || intent.careful || !this.calm()) {
      this.stop();
      this.still = 0;
      return;
    }
    this.still += dt;
    if (this.playing) {
      if (p.anim.current === this.playing && p.anim.finished) this.stop();
      return;
    }
    const clip = this.choose();
    if (clip && p.anim.has(clip)) p.idleClip = this.playing = this.last = clip;
  }

  // Standing still on solid ground, out of the wind, with nothing going on.
  calm() {
    const p = this.player, s = p.support;
    if (p.mode !== 'ground' || p.jumpPhase || p.speed > 0.05 || p.icy || p.skate.busy || p.squash < 1) return false;
    if (!s || s.loose || s.moving || this.game.out) return false;
    const wind = this.weather.windAt(p.pos);
    return !wind.jet && wind.strength < 0.4;
  }

  choose() {
    if (this.asked && this.still >= this.asked.after) {
      const { clip } = this.asked;
      this.asked = null;
      return clip;
    }
    if (this.still >= TAP && this.waiting()) return 'TapFoot';
    const here = this.game.checkpoint;
    if (this.looked !== here && this.still >= LOOK && this.climbAhead()) {
      this.looked = here;
      return 'LookUp';
    }
    if (this.still < this.idle) return null;
    this.idle = this.pickIdle();
    const pick = FIDGETS.filter(clip => clip !== this.last);
    return pick[Math.floor(this.rand() * pick.length)];
  }

  // Waiting for the gondola to come over, or for a loose ledge nearby to grow back.
  waiting() {
    const pos = this.player.pos;
    if (this.world.hazards.some(h => h.kind !== 'gust' && h.wait?.(pos))) return true;
    for (const solid of this.gone) {
      if (solid.closest(pos.x, pos.z).d < 2.2 && Math.abs(solid.top - pos.y) < 1.5) return true;
    }
    return false;
  }

  // The next checkpoint (or the summit) well above and not far off.
  climbAhead() {
    const pos = this.player.pos, index = this.game.checkpoint?.index ?? -1;
    const next = this.world.checkpoints.find(cp => cp.index > index)?.at ?? this.world.summit?.at;
    return !!next && next.y - pos.y > 2.5 && Math.hypot(next.x - pos.x, next.z - pos.z) < 30;
  }

  ask(clip, after) { this.asked = { clip, after, left: ASKED }; }

  pickIdle() { return IDLE[0] + (IDLE[1] - IDLE[0]) * this.rand(); }

  stop() {
    if (!this.playing) return;
    if (this.player.idleClip === this.playing) this.player.idleClip = null;
    this.playing = null;
    this.still = 0;
  }

  // ------------------------------------------------------------------ the summit

  startDance() {
    this.stop();
    this.asked = null;
    this.dance = { t: 0, still: 0, danced: false, more: false };
    this.confetti(70);
  }

  // Dance whenever Mnot stands still up there (a key still held from the climb runs on first); a move after
  // dancing ends it.
  danceStep(dt, intent) {
    const p = this.player, d = this.dance;
    d.t += dt;
    if (!this.game.done || p.mode === 'out' || this.game.out) { this.endDance(); return; }
    if (d.t > 0.45 && !d.more) {
      d.more = true;
      this.confetti(40);
    }
    const moving = intent.move.lengthSq() > 0 || intent.jump || p.mode !== 'ground';
    if (moving && d.danced) { this.endDance(); return; }
    if (!moving) d.still += dt;
    d.danced ||= d.still > 0.3;
    p.idleClip = p.anim.has('Dance') ? 'Dance' : null;
    if (!moving) p.celebrate = Math.max(p.celebrate, 0.5);
  }

  endDance() {
    this.player.idleClip = null;
    this.player.celebrate = 0;
    this.dance = null;
    this.still = 0;
  }

  // Confetti flying up off the can and fluttering down onto the summit, with a puff of snow at the feet.
  confetti(count) {
    const b = bursts(this.world), at = this.player.pos, r = this.rand;
    for (let i = 0; i < count; i++) {
      const a = 2 * Math.PI * r(), out = 0.6 + 1.6 * r();
      b.add('bit', { at: new THREE.Vector3(at.x, at.y + 1.75, at.z),
        vel: new THREE.Vector3(Math.cos(a) * out, 2.4 + 2.2 * r(), Math.sin(a) * out), gravity: 3, drag: 1.6, bounce: 0,
        size: 0.03 + 0.03 * r(), life: 2.2 + 1.4 * r(), color: CONFETTI[i % CONFETTI.length], spin: 5 + 10 * r() });
    }
    b.snow(at, { puffs: 8, flakes: 14, spread: 0.7, up: 1.3 });
  }
}
