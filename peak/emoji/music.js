// @ts-check
// Pocket Altitude's Reaction Run variant: a continuing PCM loop with a finish answer, under the shared Sound switch.
/** @typedef {'run'|'finish'} MusicId */
/** @typedef {'waiting'|'run'|'finished'} Scene */
/** @typedef {{source: AudioBufferSourceNode, gain: GainNode}} Voice */
/** @type {Readonly<Record<MusicId, string>>} */
const FILES = { run: 'run.mp3', finish: 'answer.mp3' };
const LOOP_LEVEL = 0.22, FINISH_LEVEL = 0.48;
const DOWNBEAT = 0.04; // the rendered loop begins 40 ms before the score's first beat

export class EmojiMusic {
  /** @param {import('../../sounds.js').MnotSounds} sounds */
  constructor(sounds) {
    this.sounds = sounds;
    /** @type {Scene} */
    this.scene = 'waiting';
    this.disposed = false;
    this.ready = false;
    this.duckLevel = 1;
    /** @type {string|null} */
    this.error = null;
    /** @type {number|null} */
    this.origin = null;
    /** @type {GainNode|null} */
    this.mix = null;
    /** @type {Voice|null} */
    this.loop = null;
    /** @type {Voice|null} */
    this.sting = null;
    /** @type {Set<Voice>} */
    this.voices = new Set();
    /** @type {Map<MusicId, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Promise<void>|null} */
    this.loading = null;
    this.counts = { run: 0, finish: 0 };
    this.unsubscribe = sounds.onStateChange(() => this.sync());
    this.sync();
  }

  get audible() {
    return !this.disposed && this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  /** @param {unknown} error */
  fail(error) { this.error = error instanceof Error ? error.message : 'Cannot play Reaction Run music'; }

  // Shared state callbacks are contained: a codec or audio-device failure cannot interrupt a physics step.
  sync() {
    try {
      if (!this.audible) { this.stopVoices(); return; }
      const context = this.sounds.context, master = this.sounds.master;
      if (!context || !master || this.error) return;
      if (!this.mix) {
        this.mix = context.createGain();
        this.mix.gain.value = this.duckLevel;
        this.mix.connect(master);
      }
      if (!this.loading) {
        /** @type {ReadonlyArray<MusicId>} */
        const ids = ['run', 'finish'];
        this.loading = Promise.all(ids.map(async id => {
          const response = await fetch(new URL(`../../audio/emoji/${FILES[id]}`, import.meta.url));
          if (!response.ok) throw new Error(`Cannot load Reaction Run ${id} music: HTTP ${response.status}`);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!this.disposed) this.buffers.set(id, buffer);
        })).then(() => {
          if (this.disposed) return;
          this.ready = true;
          this.sync();
        }).catch(error => this.fail(error));
      }
      if (this.ready && this.scene !== 'waiting' && !this.loop) this.startLoop();
    } catch (error) { this.fail(error); }
  }

  /** @param {MusicId} id @param {GainNode} output @returns {Voice|null} */
  voice(id, output) {
    const context = this.sounds.context, buffer = this.buffers.get(id);
    if (!context || !buffer || !this.audible || this.voices.size >= 6) return null;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.connect(gain); gain.connect(output);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      if (this.sting === voice) this.sting = null;
      source.disconnect(); gain.disconnect();
    };
    return voice;
  }

  startLoop() {
    const context = this.sounds.context, buffer = this.buffers.get('run');
    if (!context || !this.mix || !buffer) return;
    const voice = this.voice('run', this.mix);
    if (!voice) return;
    this.origin ??= context.currentTime;
    this.loop = voice;
    voice.source.loop = true;
    voice.gain.gain.value = 0;
    voice.gain.gain.setTargetAtTime(LOOP_LEVEL, context.currentTime, 0.14);
    voice.source.start(0, (context.currentTime - this.origin) % buffer.duration);
    this.counts.run++;
  }

  /** @param {Voice} voice @param {number} duration */
  fadeOut(voice, duration) {
    const context = this.sounds.context;
    if (!context) return;
    voice.gain.gain.cancelScheduledValues(context.currentTime);
    voice.gain.gain.setTargetAtTime(0, context.currentTime, duration / 5);
    voice.source.stop(context.currentTime + duration);
  }

  stopVoices() {
    this.loop = null;
    this.sting = null;
    for (const voice of this.voices) this.fadeOut(voice, 0.08);
  }

  // Safe to call from begin() and the later gate/start event: repeated starts do not restart the tune.
  start() {
    if (this.disposed) return;
    if (this.scene !== 'run') {
      this.scene = 'run';
      this.origin = this.sounds.context?.currentTime ?? null;
    }
    this.sync();
  }

  /** @param {number} level */
  duck(level) {
    this.duckLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
    try {
      const context = this.sounds.context;
      if (context && this.mix) {
        this.mix.gain.cancelScheduledValues(context.currentTime);
        this.mix.gain.setTargetAtTime(this.duckLevel, context.currentTime, 0.08);
      }
    } catch (error) { this.fail(error); }
  }

  finish() {
    if (this.disposed || this.scene === 'finished') return;
    this.scene = 'finished';
    try {
      // Keep the run's beat and phase through the finish party; the short answer plays on top.
      this.sync();
      const context = this.sounds.context, master = this.sounds.master;
      if (!this.audible || !this.ready || !context || !master || this.error) return;
      const voice = this.voice('finish', master);
      if (!voice) return;
      this.sting = voice;
      voice.gain.gain.value = 0;
      voice.gain.gain.setTargetAtTime(FINISH_LEVEL, context.currentTime, 0.015);
      voice.source.start();
      this.counts.finish++;
    } catch (error) { this.fail(error); }
  }

  // Seconds into the playing musical loop, with zero on its first downbeat; null while silent.
  loopTime() {
    const context = this.sounds.context, buffer = this.buffers.get('run');
    if (!this.audible || !this.loop || !this.ready || !context || !buffer || this.origin === null) return null;
    const time = context.currentTime - this.origin - DOWNBEAT;
    return (time % buffer.duration + buffer.duration) % buffer.duration;
  }

  // Decoded assets survive a reset. A restart gets a new musical origin; a normal respawn only needs duck(1).
  reset() {
    this.scene = 'waiting';
    this.origin = null;
    this.duck(1);
    this.stopVoices();
  }

  dispose() {
    this.disposed = true;
    this.reset();
    this.unsubscribe();
    this.mix?.disconnect();
    this.buffers.clear();
  }

  get state() {
    const context = this.sounds.context, duration = this.buffers.get('run')?.duration ?? 1;
    return { scene: this.scene, ready: this.ready, playing: this.loop !== null, stingPlaying: this.sting !== null,
      voices: this.voices.size, duck: this.duckLevel, error: this.error, counts: { ...this.counts },
      phase: this.origin === null || !context ? 0 : (context.currentTime - this.origin) % duration,
      loopTime: this.loopTime() };
  }
}
