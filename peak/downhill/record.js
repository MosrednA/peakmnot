// Records a run for the score server (server/downhill.py checks it): from the gate to the finish line, the chair's
// position and velocity every 0.1 s of the run's clock, and on every step something happened (a jump, a landing, a
// crash, a lost wheel, a fall, a pit stop, the finish), with what the player pressed and what the run scored.
//
//   { v: 1, route: fingerprint, phase: 0,
//     samples: [[t ms, x, y, z mm, vx, vy, vz mm/s, mode, flags, seat yaw mrad, wheels], ...],
//     inputs: [[t ms, key mask], ...], events: [[t ms, name, argument], ...] }
//
// t is the run's clock (ride.time, which runs from the gate and on while the chair is out). mode: 0 on the snow,
// 1 in the air, 3 out (fallen in). flags: what happened since the sample before (FLAG; crash includes brushing a wall
// too steep to ride, which takes the chair back where it was). wheels: a bit for each caster
// still on. The key mask: 1 push, 2 brake, 4 left, 8 right. An event that comes with a flag has its sample's time;
// 'space' and 'bowl' have the moment they happened.
export const FLAG = { jump: 1, land: 2, crash: 4, wheel: 8, lost: 16, respawn: 32, pit: 64, finish: 128, start: 256,
  bump: 512 };
const EVERY = 0.1;                    // seconds of the run's clock between samples
const MAX_SAMPLES = 30000;            // about 50 minutes: past that the run is too long for the board (server too)
const ms = s => Math.round(s * 1000);
const mm = v => Math.round(v * 1000);

export class Recorder {
  constructor(ride, pits) {
    this.ride = ride;
    this.pits = pits;
    this.reset();
    const on = (name, fn) => ride.on(name, data => { if (this.state === 'recording') fn(data ?? {}); });
    ride.on('start', () => { if (this.state === 'idle') { this.state = 'recording'; this.flag('start'); } });
    on('jump', () => this.flag('jump'));
    on('land', () => this.flag('land'));
    on('crash', () => this.flag('crash'));
    on('wall', () => this.flag('crash'));
    on('wheel', ({ cause }) => this.flag('wheel', ['wheel', String(cause).slice(0, 16)]));
    on('wrecked', () => this.later.push(['wrecked', 0]));
    on('lost', ({ water }) => this.flag('lost', ['lost', water ? 'water' : 'drop']));
    on('bump', ({ kind }) => this.flag('bump', ['bump', String(kind).slice(0, 16)]));
    on('pit', ({ s }) => this.flag('pit', ['pit', this.pits.indexOf(s)]));
    on('flight', ({ distance }) => this.later.push(['flight', Math.round(distance * 100)]));
    on('finish', () => this.flag('finish'));
  }

  // A new run: nothing recorded until the chair passes the gate.
  reset() {
    this.state = 'idle';              // 'idle' → 'recording' → 'done' (or 'full')
    this.samples = [];
    this.inputs = [];
    this.events = [];
    this.flags = 0;
    this.later = [];                  // events for the next sample
    this.last = -Infinity;
    this.mask = -1;
  }

  get recording() { return this.state === 'recording'; }

  flag(name, event) {
    this.flags |= FLAG[name];
    if (event) this.later.push(event);
  }

  // An event at this moment, not tied to a sample: Space, the bowling's score.
  event(name, arg = 0) {
    if (this.recording) this.events.push([ms(this.ride.time), name, arg]);
  }

  // After each physics step: a sample if something happened or it's been long enough.
  step() {
    if (!this.recording) return;
    if (this.flags || this.ride.time - this.last >= EVERY - 1e-9) this.sample();
  }

  // After the respawn (main.js puts the chair back between steps): its sample, right away.
  respawned() {
    if (!this.recording) return;
    this.flags |= FLAG.respawn;
    this.sample();
  }

  // What the player wants this frame.
  input(intent) {
    if (!this.recording) return;
    if (intent.jump) this.event('space');
    const mask = (intent.push ? 1 : 0) | (intent.brake ? 2 : 0) | (intent.steer < -0.05 ? 4 : 0)
      | (intent.steer > 0.05 ? 8 : 0);
    if (mask !== this.mask) { this.mask = mask; this.inputs.push([ms(this.ride.time), mask]); }
  }

  sample() {
    const r = this.ride, t = ms(r.time), p = r.pos, v = r.vel;
    const yaw = Math.round(1000 * Math.atan2(Math.sin(r.seatYaw), Math.cos(r.seatYaw)));
    const wheels = r.wheels.reduce((m, on, i) => m | (on ? 1 << i : 0), 0);
    this.samples.push([t, mm(p.x), mm(p.y), mm(p.z), mm(v.x), mm(v.y), mm(v.z), r.out ? 3 : r.grounded ? 0 : 1,
      this.flags, yaw, wheels]);
    for (const [name, arg] of this.later) this.events.push([t, name, arg]);
    const finished = this.flags & FLAG.finish;
    this.flags = 0;
    this.later.length = 0;
    this.last = r.time;
    if (finished) this.state = 'done';
    else if (this.samples.length >= MAX_SAMPLES) this.state = 'full';
  }

  data(route) {
    return { v: 1, route, phase: 0, samples: this.samples, inputs: this.inputs, events: this.events };
  }
}
