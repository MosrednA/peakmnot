// @ts-check
/** @typedef {'walk-1'|'walk-2'|'walk-3'|'run-1'|'run-2'|'jump'|'land-soft'|'land-hard'|'wave'|'fall'} SoundId */
/** @typedef {'Walk'|'Run'} Gait */
/** @typedef {{source: AudioBufferSourceNode, gain: GainNode}} Voice */

/** @type {ReadonlyArray<SoundId>} */
const IDS = ['walk-1', 'walk-2', 'walk-3', 'run-1', 'run-2', 'jump', 'land-soft', 'land-hard', 'wave', 'fall'];
/** @type {Readonly<Record<SoundId, number>>} */
const LEVELS = { 'walk-1': 0.45, 'walk-2': 0.45, 'walk-3': 0.45, 'run-1': 0.4, 'run-2': 0.4,
  jump: 0.6, 'land-soft': 0.6, 'land-hard': 0.7, wave: 0.4, fall: 0.25 };
/** @type {Readonly<Record<Gait, ReadonlyArray<SoundId>>>} */
const STEPS = { Walk: ['walk-1', 'walk-2', 'walk-3'], Run: ['run-1', 'run-2'] };

// The effects load as AAC .m4a files made from the WAVs by tools/compress_audio.py (audio/README.md, "Formats").
// Each loop is stored with LOOP_PAD seconds of its other end on both sides, so the codec's edges land outside it.
export const LOOP_PAD = 0.2;

/**
 * A decoded loop without the padding tools/compress_audio.py wrapped around it, to play with loop = true.
 * @param {BaseAudioContext} context @param {AudioBuffer} padded
 */
export function unpadLoop(context, padded) {
  const pad = Math.round(LOOP_PAD * padded.sampleRate), length = padded.length - 2 * pad;
  const buffer = context.createBuffer(padded.numberOfChannels, length, padded.sampleRate);
  for (let c = 0; c < padded.numberOfChannels; c++) {
    buffer.copyToChannel(padded.getChannelData(c).subarray(pad, pad + length), c);
  }
  return buffer;
}

export class MnotSounds {
  /** @param {{effects?: ReadonlyArray<SoundId>}} [options] the effects to load: all for the climb, only the ones
   * it plays for another game (the downhill has its own and plays only the wave) */
  constructor({ effects = IDS } = {}) {
    this.ids = effects;
    this.enabled = localStorage.getItem('mnot.sound') !== 'off';
    this.ready = false;
    this.paused = false;
    /** @type {import('./music.js').PeakMusic|null} */
    this.music = null;
    /** @type {Set<() => void>} */
    this.stateListeners = new Set();
    /** @type {string|null} */
    this.error = null;
    /** @type {AudioContext|null} */
    this.context = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {Map<SoundId, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Map<AudioBufferSourceNode, GainNode>} */
    this.voices = new Map();
    /** @type {Voice|null} */
    this.fall = null;
    this.wantsFall = false;
    /** @type {Map<SoundId, number>} */
    this.counts = new Map(IDS.map(id => [id, 0]));
    /** @type {Map<Gait, number>} */
    this.lastStep = new Map();
    /** @type {Array<{id: SoundId, time: number}>} */
    this.pending = [];
    /** @type {Promise<void>|null} */
    this.loading = null;
    this.files = Promise.all(this.ids.map(async id => {
      const response = await fetch(new URL(`audio/${id}.m4a`, import.meta.url));
      if (!response.ok) throw new Error(`Cannot load ${id}: HTTP ${response.status}`);
      return { id, data: await response.arrayBuffer() };
    })).catch(error => {
      this.error = error instanceof Error ? error.message : 'Cannot load sound effects';
      return [];
    });
  }

  async unlock() {
    this.paused = false;
    if (!this.context) {
      const context = this.context = new AudioContext();
      this.master = context.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      this.master.connect(context.destination);
      this.loading = this.files.then(async files => {
        await Promise.all(files.map(async ({ id, data }) => {
          const buffer = await context.decodeAudioData(data);
          this.buffers.set(id, id === 'fall' ? unpadLoop(context, buffer) : buffer);
        }));
        this.ready = this.buffers.size === this.ids.length;
        const pending = this.pending.splice(0);
        for (const event of pending) if (performance.now() - event.time < 250) this.play(event.id);
        if (this.wantsFall) this.startFall();
      }).catch(error => {
        this.error = error instanceof Error ? error.message : 'Cannot decode sound effects';
        this.pending.length = 0;
      });
    }
    if (this.enabled && this.context.state === 'suspended') await this.context.resume();
    this.master?.gain.setTargetAtTime(this.enabled ? 0.55 : 0, this.context.currentTime, 0.01);
    this.notifyStateChange();
  }

  resume() {
    if (this.context) void this.unlock();
  }

  /** @param {() => void} listener */
  onStateChange(listener) {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  notifyStateChange() {
    for (const listener of this.stateListeners) listener();
  }

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem('mnot.sound', enabled ? 'on' : 'off');
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.context.currentTime, 0.01);
    }
    if (!enabled) this.stopAll();
    else void this.unlock();
    this.notifyStateChange();
  }

  pause() {
    this.paused = true;
    this.stopAll();
    if (this.context && this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
    this.notifyStateChange();
  }

  stopAll() {
    this.pending.length = 0;
    this.stopFall();
    if (!this.context) return;
    for (const [source, gain] of this.voices) {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setTargetAtTime(0, this.context.currentTime, 0.008);
      source.stop(this.context.currentTime + 0.04);
    }
  }

  /** @param {SoundId} id @param {number} rate @returns {Voice|null} */
  makeVoice(id, rate) {
    if (!this.enabled || this.paused || !this.ready || this.context?.state !== 'running' || !this.master) return null;
    const buffer = this.buffers.get(id);
    if (!buffer) return null;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain);
    gain.connect(this.master);
    this.voices.set(source, gain);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    return { source, gain };
  }

  /** @param {SoundId} id */
  play(id) {
    if (!this.enabled || this.paused) return;
    if (!this.ready) {
      if (this.context && !this.error) {
        this.pending.push({ id, time: performance.now() });
        this.pending = this.pending.slice(-4);
      }
      return;
    }
    const voice = this.makeVoice(id, 1);
    if (!voice) return;
    voice.gain.gain.value = LEVELS[id];
    voice.source.start();
  }

  /** @param {Gait} gait */
  step(gait) {
    const choices = STEPS[gait], previous = this.lastStep.get(gait);
    const next = previous === undefined ? 0 : (previous + 1 + Math.floor(Math.random() * (choices.length - 1))) % choices.length;
    const id = choices[next];
    this.lastStep.set(gait, next);
    const voice = this.makeVoice(id, 0.97 + Math.random() * 0.06);
    if (!voice) return;
    voice.gain.gain.value = LEVELS[id] * (0.94 + Math.random() * 0.12);
    voice.source.start();
  }

  startFall() {
    this.wantsFall = true;
    if (this.fall) return;
    const voice = this.makeVoice('fall', 1);
    if (!voice || !this.context) return;
    this.fall = voice;
    voice.source.loop = true;
    voice.gain.gain.setValueAtTime(0, this.context.currentTime);
    voice.gain.gain.linearRampToValueAtTime(LEVELS.fall, this.context.currentTime + 0.06);
    voice.source.start();
  }

  stopFall() {
    this.wantsFall = false;
    if (!this.fall || !this.context) return;
    const voice = this.fall;
    this.fall = null;
    voice.gain.gain.cancelScheduledValues(this.context.currentTime);
    voice.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.012);
    voice.source.stop(this.context.currentTime + 0.05);
  }

  get state() {
    return { enabled: this.enabled, ready: this.ready, context: this.context?.state ?? 'locked',
      fallPlaying: this.fall !== null, voices: this.voices.size, error: this.error,
      counts: Object.fromEntries(this.counts) };
  }
}
