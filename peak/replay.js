// Records a climb for the score server, which checks it against the route (server/verify.py): Mnot's state about
// ten times a second and at every change (a jump, a landing, a beam, a fall, a respawn, a checkpoint), the keys as
// they change, and the game's events. Nothing here is trusted; it just has to be true.
// The climb starts when the title screen resets game.time (or at the first step without one). Before that the
// world's clocks already run, so `phase` says how far: the gondola's timetable is game time + phase.
const MODES = { ground: 0, air: 1, beam: 2, out: 3 };
export const FLAG = { jump: 1, land: 2, beam: 4, slip: 8, lost: 16, respawn: 32, checkpoint: 64, summit: 128, knock: 256 };
const KEYBITS = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8 };
const CAREFUL = 16;
const STICK = 32;               // a move without a movement key (a touch stick): the server only asks "was it steered?"
const EVERY = 0.1;              // seconds between samples, besides the ones at every change
const MAX_SAMPLES = 30000;      // about 45 minutes: longer climbs don't go on the board
const mm = v => Math.round(v * 1000);

export class Recorder {
  constructor({ player, game, world, onBegin = () => {} }) {
    Object.assign(this, { player, game, world, onBegin });
    this.state = 'idle';         // 'idle' → 'waiting' (title up) → 'recording' → 'done' | 'full'
    this.world_time = 0;         // seconds stepped since the page loaded: the world's clocks
    this.phase = 0;
    this.lastGame = 0;
    this.samples = [];
    this.inputs = [];
    this.events = [];
    this.pending = [];           // events this step, stamped with the step's end
    this.flags = 0;
    this.mask = -1;
    this.lastT = -Infinity;
    this.lastMode = -1;
    this.wasAir = false;
    this.lastVy = 0;
    const flag = bit => () => { this.flags |= bit; };
    const note = (name, arg = 0) => { if (this.state === 'recording') this.pending.push([name, arg]); };
    player.on('jump', flag(FLAG.jump));
    player.on('land', flag(FLAG.land));
    player.on('beam', flag(FLAG.beam));
    player.on('slip', flag(FLAG.slip));
    player.on('lost', ({ reason }) => { this.flags |= FLAG.lost; note('lost', reason); });
    game.on('respawn', ({ flat }) => { this.flags |= FLAG.respawn; note('respawn', flat ? 1 : 0); });
    game.on('checkpoint', (cp) => { this.flags |= FLAG.checkpoint; note('cp', cp.index); });
    game.on('dent', ({ reason }) => {
      if (reason === 'rock') this.flags |= FLAG.knock;
      note('dent', reason);
    });
    game.on('summit', () => { this.flags |= FLAG.summit; note('summit'); });
  }

  get recording() { return this.state === 'recording'; }

  // The climb starts (again, if the clock went back to 0): a clean recording, and a fresh run from the server.
  begin() {
    this.state = 'recording';
    this.phase = this.world_time - this.game.time;
    this.samples = [];
    this.inputs = [];
    this.events = [];
    this.pending.length = 0;
    this.flags = 0;
    this.mask = -1;
    this.lastT = -Infinity;
    this.lastMode = -1;
    this.onBegin(this);
  }

  // Once per step, at its end: intent is input.read()'s frame.
  step(dt, intent) {
    this.world_time += dt;
    const game = this.game, titleUp = document.body.classList.contains('title-up');
    const restarted = game.time < this.lastGame - 1e-9;      // the title's start resets game.time
    this.lastGame = game.time;
    // a bonk from a falling rock in mid-air changes the arc without changing the mode: sample it
    const air = this.player.mode === 'air';
    if (air && this.wasAir && this.player.vy > this.lastVy + 0.5) this.flags |= FLAG.knock;
    this.wasAir = air;
    this.lastVy = this.player.vy;
    if (titleUp && this.state !== 'done' && this.state !== 'full') this.state = 'waiting';
    else if (this.state === 'idle' || this.state === 'waiting' || restarted && this.recording) this.begin();
    if (this.state !== 'recording') { this.flags = 0; this.pending.length = 0; return; }
    const t = mm(game.time);
    let mask = intent.careful ? CAREFUL : 0;
    for (const key of intent.held ?? []) mask |= KEYBITS[key] ?? 0;
    if (!(mask & 15) && intent.move?.lengthSq() > 1e-6) mask |= STICK;
    if (mask !== this.mask) { this.inputs.push([t, mask]); this.mask = mask; }
    if (intent.jump) this.events.push([t, 'space', 0]);
    for (const [name, arg] of this.pending) this.events.push([t, name, arg]);
    this.pending.length = 0;
    const mode = MODES[this.player.mode] ?? 3;
    const due = this.flags || mode !== this.lastMode || (mode !== 3 && game.time - this.lastT >= EVERY - 1e-6);
    if (due) this.sample(t, mode);
    if (this.flags & FLAG.summit) this.state = 'done';
    else if (this.samples.length >= MAX_SAMPLES) this.state = 'full';
    this.flags = 0;
  }

  // [time ms, x, y, z (mm), vx, vz, vy (mm/s), mode, flags, support (solid or beam index, -1)]
  sample(t, mode) {
    const p = this.player, w = this.world;
    const support = mode === 0 ? w.solids.indexOf(p.support) : mode === 2 ? w.beams.indexOf(p.balance.beam) : -1;
    this.samples.push([t, mm(p.pos.x), mm(p.pos.y), mm(p.pos.z), mm(p.vel.x), mm(p.vel.z), mm(p.vy), mode, this.flags,
      support]);
    this.lastT = this.game.time;
    this.lastMode = mode;
  }

  // What the server gets with the result.
  data(route) {
    return { v: 1, route, phase: mm(this.phase), samples: this.samples, inputs: this.inputs, events: this.events };
  }
}
