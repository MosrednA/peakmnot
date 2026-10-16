// Records a run for the score server (server/emoji.py checks it): from the clock's first step to :peak-mnot:, where
// Mnot is and how fast it goes every 0.1 s of the run's clock, and on every step something happened (an emoji
// fetched or a wrong one touched, a crack stepped on or given way, a drop into a hole and the hop out, a bonk, the
// finish), with what the player asked for and the field's seed.
//
//   { v: 1, route: fingerprint, phase: 0, seed,
//     samples: [[t ms, x, y, z mm, vx, vy, vz mm/s, mode, flags, yaw mrad], ...],
//     inputs: [[t ms, key mask], ...], events: [[t ms, name, argument], ...] }
//
// t is the run's clock (player.time, which runs from the first move, in a hole too). mode: 0 on the snow, 3 in a
// hole (from the drop to the hop out). flags: what happened since the sample before (FLAG). The key mask is what
// Mnot went by (main.js, slide()): 1 run, 2 brake, 4 left, 8 right, and 16 peeking. Each event has its step's
// sample, the time and the flag of it: take (its place on the list, from 1), hit (a wrong one, or a listed one too
// early: the emoji's index in the field's), crack (one stepped on: its index, the field's cracks first and then the
// passages giving way at the end, as cracks.js lists them), hole (one given way), pit (Mnot dropped into one) and
// bonk (a hard one: cm/s into the wall).
export const FLAG = { start: 1, take: 2, hit: 4, crack: 8, hole: 16, pit: 32, climb: 64, bonk: 128, finish: 256 };
export const MODE = { snow: 0, pit: 3 };
export const KEY = { run: 1, brake: 2, left: 4, right: 8, peek: 16 };
const EVERY = 0.1;                    // seconds of the run's clock between samples
const MAX_SAMPLES = 30000;            // about 50 minutes: past that the run is too long for the board (server too)
const ms = s => Math.round(s * 1000);
const mm = v => Math.round(v * 1000);

export class Recorder {
  constructor(player) {
    this.player = player;
    this.reset();
  }

  // A new run: nothing recorded until the clock starts.
  reset() {
    this.state = 'idle';              // 'idle' → 'recording' → 'done' (or 'over': out, or 'full')
    this.samples = [];
    this.inputs = [];
    this.events = [];
    this.flags = 0;
    this.later = [];                  // events for the next sample
    this.last = -Infinity;
    this.mask = -1;
  }

  get recording() { return this.state === 'recording'; }

  // Something that happened this step, and its event's argument (none for the start, the hop out and the finish).
  mark(name, arg) {
    if (this.state !== 'idle' && this.state !== 'recording') return;
    this.flags |= FLAG[name];
    if (arg !== undefined) this.later.push([name, arg]);
  }

  // What Mnot went by this step: want (main.js: steer, throttle, brake) and whether the camera peeks. Any throttle
  // at all is running (the snow grips then, and the server checks the slide by it), any brake braking.
  input(want, peek) {
    if (!this.recording) return;
    const mask = (want.throttle > 0 ? KEY.run : 0) | (want.brake > 0 ? KEY.brake : 0)
      | (want.steer > 0.05 ? KEY.left : 0) | (want.steer < -0.05 ? KEY.right : 0) | (peek ? KEY.peek : 0);
    if (mask !== this.mask) { this.mask = mask; this.inputs.push([ms(this.player.time), mask]); }
  }

  // At the end of each step: the clock's first one starts the record; then a sample if something happened or it's
  // been long enough. Out (the third wrong one), the record stops.
  step() {
    const p = this.player;
    if (this.state === 'idle' && p.time > 0) {
      this.state = 'recording';
      this.flags |= FLAG.start;
    }
    if (!this.recording) return;
    if (this.flags || p.time - this.last >= EVERY - 1e-9) this.sample();
    if (p.out && this.recording) this.state = 'over';
  }

  sample() {
    const p = this.player, t = ms(p.time);
    const yaw = Math.round(1000 * Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)));
    this.samples.push([t, mm(p.pos.x), mm(p.pos.y), mm(p.pos.z), mm(p.vel.x), mm(p.vel.y), mm(p.vel.z),
      p.pit ? MODE.pit : MODE.snow, this.flags, yaw]);
    for (const [name, arg] of this.later) this.events.push([t, name, arg]);
    const finished = this.flags & FLAG.finish;
    this.flags = 0;
    this.later.length = 0;
    this.last = p.time;
    if (finished) this.state = 'done';
    else if (this.samples.length >= MAX_SAMPLES) this.state = 'full';
  }

  data(route, seed) {
    return { v: 1, route, phase: 0, seed, samples: this.samples, inputs: this.inputs, events: this.events };
  }
}
