// Little moments on top of the clips, for the eye only: they pick the clip Mnot stands about in (player.idleClip) and
// never touch the physics. Left standing on solid ground, Mnot fidgets: it pushes its glasses back up after a
// checkpoint or a close call on a beam or at the edge of a drop, taps a foot while waiting for the gondola or for a
// loose ledge to grow back, looks up at the climb when the next checkpoint is well above, and otherwise does a random
// one after 4-6 s, never the same twice in a row. Not on a beam, ice, a loose ledge or anything moving, and not in the
// wind. Any input cancels a fidget at once. At the summit Mnot dances, in a burst of confetti, until the player moves
// on; while it dances it keeps player.celebrate up, which holds the camera's summit close-up. The title screen runs its
// own show, so nothing happens here while it's busy. The Konami code (controls/konami.js) throws a party: a disco ball
// drops in (props/disco.js), confetti flies, and Mnot dances at full speed with a pirouette every bar, for a few
// seconds or until the player moves on.
import * as THREE from 'three';
import { random } from '../world/world.js';
import { bursts } from '../look/bursts.js';
import { Disco, BEAT } from '../props/disco.js';
import { FALL_ANGLE } from './balance.js';

const FIDGETS = ['PushGlasses', 'TapFoot', 'LookUp'];
const IDLE = [4, 6];             // seconds standing still before a random fidget
const TAP = 1.4;                 // ... before tapping a foot while waiting, and between the taps
const LOOK = 1.8;                // ... before looking up at the climb ahead
const ASKED = 6;                 // a fidget a moment calls for, if Mnot stands still within this many seconds
const CLOSE_CALL = 0.75;         // a lean this far towards slipping off a beam (of FALL_ANGLE) is a close call
const CONFETTI = ['#e23b2e', '#ffc23d', '#4aa8f0', '#22a98f', '#ffffff', '#ff6a55'].map(c => new THREE.Color(c));
const PARTY = 6.5;               // seconds the Konami party lasts
const HARD = 1.6;                // how much faster Mnot dances at the party
const TAU = 2 * Math.PI;

export class Moments {
  // hud, camera and dom (the canvas) are for the party's toast and disco ball; model is the can inside its holder
  constructor({ player, game, world, weather, title = null, hud = null, camera = null, dom = null, model = null }) {
    Object.assign(this, { player, game, world, weather, title, hud, camera, dom, model });
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
    this.party = null;            // { t, still, danced, dancing, next, twirling }
    this.disco = null;            // the ball, made at the first party
    this.spin = 0;                // Mnot's pirouette, on top of its own turn
    game.on('checkpoint', () => this.ask('PushGlasses', 0.6));
    player.on('steady', () => this.ask('PushGlasses', 0.3));       // back from the edge of a drop
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
    this.disco?.update(dt, p.pos);
    if (this.party) this.partyStep(dt, intent);
    this.twirl(dt);
    if (this.title?.busy) return;
    if (this.dance) { this.danceStep(dt, intent); return; }
    if (this.party) return;
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
    if (p.teeter.active) return false;
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

  // Confetti flying up off the can (or out of the disco ball) and fluttering down, with a puff of snow at the feet.
  confetti(count, { from = null, up = 2.4 } = {}) {
    const b = bursts(this.world), at = this.player.pos, r = this.rand;
    const start = from ?? new THREE.Vector3(at.x, at.y + 1.75, at.z);
    for (let i = 0; i < count; i++) {
      const a = 2 * Math.PI * r(), out = 0.6 + 1.6 * r();
      b.add('bit', { at: start, vel: new THREE.Vector3(Math.cos(a) * out, up + 2.2 * r(), Math.sin(a) * out),
        gravity: 3, drag: 1.6, bounce: 0, size: 0.03 + 0.03 * r(), life: 2.2 + 1.4 * r(),
        color: CONFETTI[i % CONFETTI.length], spin: 5 + 10 * r() });
    }
    if (!from) b.snow(at, { puffs: 8, flakes: 14, spread: 0.7, up: 1.3 });
  }

  // ------------------------------------------------------------------ the Konami party

  // Anywhere but in a fall. Mnot dances whenever it stands still on the ground (a key still held from the code walks
  // on first), with the camera's close-up; a move after dancing ends the party, and so does the clock. The code again
  // keeps it going.
  startParty() {
    const p = this.player;
    if (p.mode === 'out' || this.game.out) return;
    this.disco ??= new Disco({ world: this.world, camera: this.camera, dom: this.dom });
    this.disco.start(p.pos);
    if (this.party) { this.party.t = 0; return; }
    this.stop();
    this.asked = null;
    this.party = { t: 0, still: 0, danced: false, dancing: 0, next: 0.5, twirling: false };
    p.anim.setTimeScale('Dance', HARD);
    this.hud?.toast('Disco mode!', '↑↑↓↓←→←→BA: no 30 lives, sorry', 3, 'summit');
    this.confetti(50);
    p.emit('party', { seconds: PARTY });
  }

  partyStep(dt, intent) {
    const p = this.player, party = this.party;
    party.t += dt;
    party.twirling = false;
    if (party.t >= party.next) {                  // a shower out of the ball every other beat
      party.next += 2 * BEAT;
      this.confetti(14, { from: this.disco.ballAt(), up: 0.4 });
    }
    const moving = intent.move.lengthSq() > 0 || intent.jump || p.mode !== 'ground';
    if (party.t >= PARTY || p.mode === 'out' || this.game.out || moving && party.danced) { this.endParty(); return; }
    if (moving || this.dance || this.title?.busy) return;      // the summit dance or the title has Mnot already
    party.still += dt;
    party.danced ||= party.still > 0.3;
    p.idleClip = p.anim.has('Dance') ? 'Dance' : null;
    p.celebrate = Math.max(p.celebrate, 0.5);
    // a pirouette on the last beat of every bar
    party.dancing += dt;
    party.twirling = true;
    const bar = 4 * BEAT, into = party.dancing % bar;
    this.spin = TAU * (Math.floor(party.dancing / bar) + THREE.MathUtils.smootherstep(into, bar - BEAT, bar));
  }

  endParty() {
    const p = this.player;
    if (!this.dance) {
      if (p.idleClip === 'Dance') p.idleClip = null;
      p.celebrate = 0;
    }
    p.anim.setTimeScale('Dance', 1);
    this.disco.leave();
    this.party = null;
    this.still = 0;
    p.emit('partyover');
  }

  // The pirouette turns the can inside its holder, so the player's own turn stays as it is. Once Mnot stops dancing, a
  // pirouette under way finishes.
  twirl(dt) {
    if (!this.model || !this.spin && !this.party?.twirling) return;
    if (!this.party?.twirling) {
      const end = Math.ceil(this.spin / TAU - 1e-6) * TAU;
      this.spin = Math.min(end, this.spin + dt * TAU / BEAT);
      if (this.spin >= end) this.spin = 0;
    }
    this.model.rotation.y = this.spin % TAU;
  }
}
