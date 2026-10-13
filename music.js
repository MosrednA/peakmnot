// @ts-check
/** @typedef {'climb'|'camp'|'summit'} MusicId */
/** @typedef {'climb'|'camp'} MusicScene */
/** @typedef {{id: MusicScene, source: AudioBufferSourceNode, gain: GainNode}} LoopVoice */
/** @typedef {{source: AudioBufferSourceNode, gain: GainNode}} StingVoice */

/** @type {ReadonlyArray<MusicId>} */
const IDS = ['climb', 'camp', 'summit'];
const LEVELS = { climb: 0.22, camp: 0.18, summit: 0.48 };
const FADE = 0.8;

export class PeakMusic {
  /** @param {import('./sounds.js').MnotSounds} sounds */
  constructor(sounds) {
    this.sounds = sounds;
    /** @type {MusicScene} */
    this.scene = 'climb';
    /** @type {Map<MusicId, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Set<LoopVoice>} */
    this.voices = new Set();
    /** @type {LoopVoice|null} */
    this.current = null;
    /** @type {StingVoice|null} */
    this.sting = null;
    /** @type {GainNode|null} */
    this.mix = null;
    /** @type {number|null} */
    this.origin = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {string|null} */
    this.error = null;
    this.ready = false;
    this.duckLevel = 1;
    this.counts = { climb: 0, camp: 0, summit: 0 };
    /** @type {Promise<Array<{id: MusicId, data: ArrayBuffer}>>|null} */
    this.files = null;
    this.unsubscribe = sounds.onStateChange(() => this.sync());
    this.sync();
    // The game's biggest download, and nothing on screen needs it: it starts once the first frame is up (two
    // animation frames from now, with the game built in between), or at the audio unlock if that comes first.
    requestAnimationFrame(() => requestAnimationFrame(() => this.download()));
  }

  download() {
    this.files ??= Promise.all(IDS.map(async id => {
      const response = await fetch(new URL(`audio/music/peak-${id}.mp3`, import.meta.url));
      if (!response.ok) throw new Error(`Cannot load ${id} music: HTTP ${response.status}`);
      return { id, data: await response.arrayBuffer() };
    })).catch(error => {
      this.fail(error);
      return [];
    });
    return this.files;
  }

  /** @param {unknown} error */
  fail(error) {
    this.error = error instanceof Error ? error.message : 'Cannot play background music';
  }

  get audible() {
    return this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  // Every call from a game event or sound lifecycle is contained: a music failure cannot stop the game.
  sync() {
    try {
      const context = this.sounds.context, master = this.sounds.master;
      if (!context || !master) return;
      if (!this.audible) {
        this.stop();
        return;
      }
      if (this.error) return;
      if (!this.mix) {
        this.mix = context.createGain();
        this.mix.gain.value = this.duckLevel;
        this.mix.connect(master);
      }
      if (!this.loading) {
        this.loading = this.download().then(async files => {
          await Promise.all(files.map(async ({ id, data }) => {
            this.buffers.set(id, await context.decodeAudioData(data));
          }));
          this.ready = this.buffers.size === IDS.length;
          this.sync();
        }).catch(error => this.fail(error));
      }
      if (!this.ready || this.current?.id === this.scene) return;
      this.startLoop();
    } catch (error) { this.fail(error); }
  }

  startLoop() {
    const context = this.sounds.context, buffer = this.buffers.get(this.scene);
    if (!context || !this.mix || !buffer) return;
    const now = context.currentTime;
    this.origin ??= now;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = true; // loop decoded PCM, avoiding HTML-media/MP3 restart gaps
    source.connect(gain);
    gain.connect(this.mix);
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(LEVELS[this.scene], now, FADE / 5);
    if (this.current) this.fadeOut(this.current, FADE);
    const voice = { id: this.scene, source, gain };
    this.current = voice;
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      if (this.current === voice) this.current = null;
      source.disconnect();
      gain.disconnect();
    };
    this.counts[this.scene]++;
    // Both arrangements have the same tempo, chords and length. Keep their bar position on a switch/resume.
    source.start(0, (now - this.origin) % buffer.duration);
  }

  /** @param {LoopVoice} voice @param {number} duration */
  fadeOut(voice, duration) {
    const now = this.sounds.context?.currentTime;
    if (now === undefined) return;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, duration / 5);
    voice.source.stop(now + duration);
  }

  stop() {
    if (!this.current && !this.sting) return;
    for (const voice of this.voices) this.fadeOut(voice, 0.08);
    this.current = null;
    if (this.sting && this.sounds.context) {
      const now = this.sounds.context.currentTime;
      this.sting.gain.gain.setTargetAtTime(0, now, 0.015);
      this.sting.source.stop(now + 0.08);
      this.sting = null;
    }
  }

  /** @param {MusicScene} scene */
  setScene(scene) {
    if (this.scene === scene) return;
    this.scene = scene;
    this.sync();
  }

  /** @param {number} level */
  duck(level) {
    this.duckLevel = level;
    this.updateMix();
  }

  updateMix() {
    try {
      if (!this.mix || !this.sounds.context) return;
      const now = this.sounds.context.currentTime;
      this.mix.gain.cancelScheduledValues(now);
      this.mix.gain.setTargetAtTime(this.sting ? 0.18 : this.duckLevel, now, 0.06);
    } catch (error) { this.fail(error); }
  }

  summit() {
    try {
      const context = this.sounds.context, master = this.sounds.master, buffer = this.buffers.get('summit');
      if (!this.audible || !context || !master || !buffer || this.sting) return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(master);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(LEVELS.summit, context.currentTime, 0.015);
      const voice = { source, gain };
      this.sting = voice;
      this.updateMix();
      source.onended = () => {
        if (this.sting === voice) this.sting = null;
        source.disconnect();
        gain.disconnect();
        this.updateMix();
      };
      source.start();
      this.counts.summit++;
    } catch (error) { this.fail(error); }
  }

  dispose() {
    this.unsubscribe();
    this.stop();
  }

  get state() {
    return { scene: this.scene, ready: this.ready, playing: this.current !== null, voices: this.voices.size,
      duck: this.sting ? 0.18 : this.duckLevel, stingPlaying: this.sting !== null, error: this.error,
      counts: { ...this.counts }, phase: this.origin === null || !this.sounds.context ? 0
        : (this.sounds.context.currentTime - this.origin) % (this.buffers.get(this.scene)?.duration ?? 1) };
  }
}
