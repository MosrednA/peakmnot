// @ts-check
// Chair foley and downhill cues. Shares MnotSounds' gesture unlock, context, master and saved Sound preference.
import { unpadLoop } from '../../sounds.js';
/** @typedef {'piste'|'ice'|'bank'|'powder'} Surface */
/** @typedef {'rock'|'tree'|'wall'|'cabinet'|'desk'|'printer'|'pole'} CrashKind */
/** @typedef {'snowman'|'pin'|'knockoff'|'photographer'|'cooler'|'ficus'|'tree'} BumpKind */
/** @typedef {'lift'|'land-soft'|'land-hard'|'crash-rock'|'crash-tree'|'crash-metal'|'crash-desk'|'crash-printer'|
 * 'wheel'|'snowman'|'chair'|'photographer'|'cooler'|'ficus'|'strike'|'crowd'|'photo'|'pit'|'lost'|'splash'|'wrecked'|'finish'|'bonus'|'branches'|'bird'} ShotId */
/** @typedef {'roll-piste'|'roll-ice'|'roll-bank'|'roll-powder'|'wind'|'brake'|'swivel'|'scrape'} LoopId */
/** @typedef {ShotId|LoopId} SoundId */
/** @typedef {{active: boolean, speed: number, grounded: boolean, surface: Surface, brake: number,
 * spin: number, missing: number}} RideAudioState */
/** @typedef {{type: 'jump'|'photo'|'pit'|'lost'|'splash'|'wrecked'|'finish'|'bird'} |
 * {type: 'land', impact: number, air: number} | {type: 'crash', impulse: number, kind: CrashKind} |
 * {type: 'wheel', cause: string, left: number} | {type: 'bump', kind: BumpKind} |
 * {type: 'bowling', down: number} | {type: 'flight', distance: number, kLine: number} | {type: 'bonus', seconds: number}} DownhillCue */
/** @typedef {{source: AudioBufferSourceNode, gain: GainNode, level: number, rate: number}} Voice */
/** @typedef {{gain: number, rate: number}} LoopTarget */

/** @type {ReadonlyArray<ShotId>} */
const SHOTS = ['lift', 'land-soft', 'land-hard', 'crash-rock', 'crash-tree', 'crash-metal', 'crash-desk',
  'crash-printer', 'wheel', 'snowman', 'chair', 'photographer', 'cooler', 'ficus', 'strike', 'crowd', 'photo',
  'pit', 'lost', 'splash', 'wrecked', 'finish', 'bonus', 'branches', 'bird'];
/** @type {ReadonlyArray<LoopId>} */
const LOOPS = ['roll-piste', 'roll-ice', 'roll-bank', 'roll-powder', 'wind', 'brake', 'swivel', 'scrape'];
/** @type {Readonly<Record<CrashKind, ShotId>>} */
const CRASH = { rock: 'crash-rock', wall: 'crash-rock', tree: 'crash-tree', cabinet: 'crash-metal', pole: 'crash-metal', desk: 'crash-desk', printer: 'crash-printer' };
/** @type {Readonly<Record<BumpKind, ShotId>>} */
const BUMP = { snowman: 'snowman', pin: 'chair', knockoff: 'chair', photographer: 'photographer', cooler: 'cooler', ficus: 'ficus', tree: 'branches' };
const clamp = (/** @type {number} */ x, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
/** @returns {RideAudioState} */
const idle = () => ({ active: false, speed: 0, grounded: true, surface: 'piste', brake: 0, spin: 0, missing: 0 });

// Pure mix targets: rolling changes with the surface; brakes/scrapes need ground, and wind opens up in the air.
/** @param {RideAudioState} state @returns {Map<LoopId, LoopTarget>} */
export function downhillLoopMix(state) {
  const targets = new Map(LOOPS.map(id => [id, { gain: 0, rate: 1 }]));
  if (!state.active) return targets;
  const speed = clamp(state.speed, 0, 32), roll = Math.min(1, speed / 20), motion = Math.min(1, speed / 3);
  const spinning = clamp(Math.abs(state.spin), 0, 18) / 15;
  if (state.grounded) {
    const id = /** @type {LoopId} */ (`roll-${state.surface}`);
    const softness = state.surface === 'powder' ? 0.6 : state.surface === 'bank' ? 0.8 : 1;
    const wheels = Math.sqrt(1 - clamp(state.missing, 0, 5) / 5);
    targets.set(id, { gain: 0.27 * roll * softness * wheels, rate: 0.65 + speed / 30 });
    targets.set('brake', { gain: 0.34 * clamp(state.brake, 0, 1) * motion * (state.surface === 'ice' ? 0.4 : 1), rate: 0.8 + speed / 55 });
    targets.set('scrape', { gain: 0.23 * clamp(state.missing, 0, 5) / 5 * motion, rate: 0.8 + speed / 38 });
  }
  targets.set('wind', { gain: 0.2 * (speed / 32) ** 1.35 * (state.grounded ? 0.75 : 1), rate: 0.8 + speed / 80 });
  targets.set('swivel', { gain: 0.13 * Math.min(1, spinning), rate: 0.7 + 0.6 * spinning });
  return targets;
}

export class DownhillSfx {
  /** @param {import('../../sounds.js').MnotSounds} sounds */
  constructor(sounds) {
    this.sounds = sounds;
    this.ready = false;
    this.disposed = false;
    /** @type {string|null} */
    this.error = null;
    /** @type {GainNode|null} */
    this.mix = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {Map<SoundId, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Map<AudioBufferSourceNode, Voice>} */
    this.voices = new Map();
    /** @type {Map<LoopId, Voice>} */
    this.loops = new Map();
    /** @type {Map<SoundId, number>} */
    this.counts = new Map();
    /** @type {Map<ShotId, number>} */
    this.lastCue = new Map();
    /** @type {Array<{id: ShotId, gain: number, at: number}>} */
    this.pending = [];
    this.ride = idle();
    this.targets = downhillLoopMix(this.ride);
    this.unsubscribe = sounds.onStateChange(() => this.sync());
    // Touch pointerdown does not unlock audio on every browser. Keep the release gesture with this module.
    this.onGesture = (/** @type {Event} */ e) => {
      if (e.isTrusted) void sounds.unlock().catch(error => this.fail(error));
    };
    this.onBlur = () => sounds.pause();
    this.onFocus = () => sounds.resume();
    addEventListener('pointerup', this.onGesture, { capture: true });
    addEventListener('touchend', this.onGesture, { capture: true });
    addEventListener('blur', this.onBlur);
    addEventListener('focus', this.onFocus);
    this.sync();
  }

  get audible() {
    return !this.disposed && this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  /** @param {unknown} error */
  fail(error) { this.error = error instanceof Error ? error.message : 'Cannot play downhill audio'; }

  sync() {
    if (!this.audible) { this.stopVoices(); return; }
    const context = this.sounds.context, master = this.sounds.master;
    if (!context || !master || this.error) return;
    if (!this.mix) { this.mix = context.createGain(); this.mix.connect(master); }
    if (!this.loading) {
      // Load after a real audio unlock, so this palette does not compete with the GLB on a slow connection.
      this.loading = Promise.all([...SHOTS, ...LOOPS].map(async id => {
        const response = await fetch(new URL(`../../audio/downhill/${id}.m4a`, import.meta.url));
        if (!response.ok) throw new Error(`Cannot load downhill ${id}: HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) this.buffers.set(id, LOOPS.includes(/** @type {LoopId} */ (id)) ? unpadLoop(context, buffer) : buffer);
      })).then(() => {
        if (this.disposed) return;
        this.ready = true;
        const pending = this.pending.splice(0);
        for (const cue of pending) if (performance.now() - cue.at < 250) this.play(cue.id, cue.gain);
        this.applyLoops();
      }).catch(error => { this.fail(error); this.pending.length = 0; });
    }
    if (this.ready) this.applyLoops();
  }

  /** @param {SoundId} id @param {number} level @param {number} rate @returns {Voice|null} */
  voice(id, level, rate) {
    const context = this.sounds.context, buffer = this.buffers.get(id);
    if (!this.audible || !this.ready || !context || !this.mix || !buffer || this.voices.size >= 24) return null;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = 0;
    source.connect(gain); gain.connect(this.mix);
    const voice = { source, gain, level, rate };
    this.voices.set(source, voice);
    source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    return voice;
  }

  /** @param {Voice} voice */
  fadeOut(voice) {
    const context = this.sounds.context;
    if (!context) return;
    voice.gain.gain.cancelScheduledValues(context.currentTime);
    voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.018);
    voice.source.stop(context.currentTime + 0.12);
  }

  /** @param {ShotId} id @param {number} gain */
  play(id, gain) {
    // Physics can introduce a new obstacle before its foley exists; reject missing/inherited lookup values too.
    if (typeof id !== 'string' || !SHOTS.includes(id)) return;
    if (!this.audible || this.error) return;
    if (!this.ready) {
      this.pending.push({ id, gain, at: performance.now() });
      this.pending = this.pending.slice(-4);
      return;
    }
    const context = this.sounds.context;
    if (!context) return;
    const cooldown = id.startsWith('crash-') || id === 'chair' ? 0.055 : 0.12;
    if (context.currentTime - (this.lastCue.get(id) ?? -Infinity) < cooldown || this.voices.size - this.loops.size >= 12) return;
    const voice = this.voice(id, clamp(gain, 0, 0.85), ['finish', 'crowd', 'bonus'].includes(id) ? 1 : 0.97 + Math.random() * 0.06);
    if (!voice) return;
    this.lastCue.set(id, context.currentTime);
    voice.gain.gain.setTargetAtTime(voice.level, context.currentTime, 0.002);
    voice.source.start();
  }

  /** @param {DownhillCue} cue */
  cue(cue) {
    switch (cue.type) {
      case 'jump': this.play('lift', 0.65); break;
      case 'land':
        if (cue.impact > 1) this.play(cue.impact > 6 ? 'land-hard' : 'land-soft', 0.35 + clamp(cue.impact, 0, 12) / 28);
        break;
      case 'crash': this.play(CRASH[cue.kind], 0.35 + clamp(cue.impulse, 0, 12) / 25); break;
      case 'wheel': this.play('wheel', 0.65); break;
      case 'bump': this.play(BUMP[cue.kind], 0.55); break;
      case 'bird': this.play('bird', 0.42); break;
      case 'bowling': if (cue.down === 10) this.play('strike', 0.7); break;
      case 'flight': if (cue.distance >= cue.kLine) this.play('crowd', 0.6); break;
      case 'photo': this.play('photo', 0.6); break;
      case 'pit': this.play('pit', 0.5); break;
      case 'splash': this.play('splash', 0.7); break;
      case 'lost': this.play('lost', 0.5); break;
      case 'wrecked': this.play('wrecked', 0.65); break;
      case 'finish': this.play('finish', 0.7); break;
      case 'bonus': {
        const seconds = clamp(cue.seconds, 0, 20);
        if (seconds > 0) this.play('bonus', 0.2 + 0.22 * Math.sqrt(seconds / 20));
        break;
      }
    }
  }

  /** @param {RideAudioState} state */
  update(state) {
    this.ride = state;
    this.targets = downhillLoopMix(state);
    if (this.ready && this.audible) this.applyLoops();
  }

  applyLoops() {
    if (!this.audible || !this.ready) return;
    const context = this.sounds.context;
    if (!context) return;
    for (const [id, target] of this.targets) {
      let voice = this.loops.get(id);
      if (target.gain < 0.002) {
        if (voice) { this.loops.delete(id); this.fadeOut(voice); }
        continue;
      }
      if (!voice) {
        if (target.gain < 0.006) continue;
        const created = this.voice(id, target.gain, target.rate);
        if (!created) continue;
        voice = created;
        this.loops.set(id, voice);
        voice.source.loop = true;
        voice.gain.gain.setTargetAtTime(target.gain, context.currentTime, 0.08);
        voice.source.start();
      } else {
        if (Math.abs(voice.level - target.gain) > 0.003) {
          voice.gain.gain.setTargetAtTime(target.gain, context.currentTime, 0.08);
          voice.level = target.gain;
        }
        if (Math.abs(voice.rate - target.rate) > 0.005) {
          voice.source.playbackRate.setTargetAtTime(target.rate, context.currentTime, 0.1);
          voice.rate = target.rate;
        }
      }
    }
  }

  stopVoices() {
    this.pending.length = 0;
    this.loops.clear();
    for (const voice of this.voices.values()) this.fadeOut(voice);
  }

  reset() {
    this.ride = idle();
    this.targets = downhillLoopMix(this.ride);
    this.lastCue.clear();
    this.stopVoices();
  }

  dispose() {
    this.disposed = true;
    this.reset();
    this.unsubscribe();
    removeEventListener('pointerup', this.onGesture, { capture: true });
    removeEventListener('touchend', this.onGesture, { capture: true });
    removeEventListener('blur', this.onBlur);
    removeEventListener('focus', this.onFocus);
    this.mix?.disconnect();
    this.buffers.clear();
  }

  get state() {
    return { ready: this.ready, audible: this.audible, error: this.error, voices: this.voices.size,
      loops: [...this.loops.keys()], targets: Object.fromEntries(this.targets), counts: Object.fromEntries(this.counts) };
  }
}
