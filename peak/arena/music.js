// @ts-check
// Pocket Altitude at 96 BPM: a soft continuing plaza loop on the shared Sound switch.
/** @typedef {{source:AudioBufferSourceNode, gain:GainNode}} Voice */
export class ArenaMusic {
  /** @param {import('../../sounds.js').MnotSounds} sounds */
  constructor(sounds) {
    this.sounds = sounds;
    this.disposed = false;
    this.ready = false;
    /** @type {string|null} */
    this.error = null;
    /** @type {number|null} */
    this.origin = null;
    /** @type {AudioBuffer|null} */
    this.buffer = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {Voice|null} */
    this.loop = null;
    /** @type {Set<Voice>} */
    this.voices = new Set();
    this.unsubscribe = sounds.onStateChange(() => this.sync());
  }

  get audible() {
    return !this.disposed && this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  sync() {
    try {
      if (!this.audible) { this.stop(); return; }
      const context = this.sounds.context, master = this.sounds.master;
      if (!context || !master || this.error) return;
      if (!this.loading) this.loading = fetch(new URL('../../audio/arena/plaza.mp3', import.meta.url))
        .then(async response => {
          if (!response.ok) throw new Error(`Cannot load plaza music: HTTP ${response.status}`);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (this.disposed) return;
          this.buffer = buffer;
          this.ready = true;
          this.sync();
        }).catch(error => { this.error = error instanceof Error ? error.message : 'Cannot decode plaza music'; });
      if (!this.buffer || this.loop) return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(gain); gain.connect(master);
      this.origin ??= context.currentTime;
      const voice = this.loop = { source, gain };
      this.voices.add(voice);
      source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(.25, context.currentTime, .2);
      source.start(0, (context.currentTime-this.origin) % this.buffer.duration);
    } catch (error) { this.error = error instanceof Error ? error.message : 'Cannot play plaza music'; }
  }

  loopTime() {
    const context = this.sounds.context;
    if (!this.audible || !this.loop || !this.buffer || !context || this.origin === null) return null;
    const time = context.currentTime-this.origin-.04;
    return (time % this.buffer.duration+this.buffer.duration) % this.buffer.duration;
  }

  stop() {
    this.loop = null;
    const context = this.sounds.context;
    if (!context) return;
    for (const voice of this.voices) {
      voice.gain.gain.setTargetAtTime(0, context.currentTime, .012);
      voice.source.stop(context.currentTime+.06);
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.unsubscribe();
    this.buffer = null;
  }

  get state() {
    return { ready: this.ready, playing: this.loop !== null, voices: this.voices.size,
      error: this.error, loopTime: this.loopTime() };
  }
}
