// @ts-check
// The plaza's can foley. World cues require distance from my can; a spectator hears only music/UI.
import { unpadLoop } from '../../sounds.js';
/** @typedef {'join-self'|'join'|'leave'|'idle'|'chat-self'|'chat'|'bump'|'full'|'slow'|'lost'|'back'} Cue */
/** @typedef {Cue|'reel'|'dance'} SoundId */
/** @typedef {{source:AudioBufferSourceNode, gain:GainNode}} Voice */
/** @type {ReadonlyArray<SoundId>} */
const IDS = ['join-self', 'join', 'leave', 'idle', 'chat-self', 'chat', 'bump', 'full', 'slow', 'lost', 'back',
  'reel', 'dance'];
export const HEAR = 7;
export class ArenaSfx {
  /** @param {import('../../sounds.js').MnotSounds} sounds @param {import('./music.js').ArenaMusic} music */
  constructor(sounds, music) {
    this.sounds = sounds;
    this.music = music;
    this.ready = false;
    this.disposed = false;
    /** @type {string|null} */
    this.error = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {Map<SoundId, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Set<Voice>} */
    this.voices = new Set();
    /** @type {Map<SoundId, Voice>} */
    this.loops = new Map();
    /** @type {Map<SoundId, number>} */
    this.counts = new Map();
    /** @type {Map<Cue, number>} */
    this.last = new Map();
    /** @type {Set<Cue>} */
    this.frameCues = new Set();
    /** @type {Array<{type:Cue, distance:number, at:number}>} */
    this.pending = [];
    this.motion = { reel: 0, dance: 0 };
    this.unsubscribe = sounds.onStateChange(() => this.sync());
    this.onBlur = () => sounds.pause();
    this.onFocus = () => sounds.resume();
    addEventListener('blur', this.onBlur);
    addEventListener('focus', this.onFocus);
  }

  get audible() {
    return !this.disposed && this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  sync() {
    try {
      if (!this.audible) { this.stop(); return; }
      const context = this.sounds.context;
      if (!context || this.error) return;
      if (!this.loading) this.loading = Promise.all(IDS.map(async id => {
        const response = await fetch(new URL(`../../audio/arena/${id}.m4a`, import.meta.url));
        if (!response.ok) throw new Error(`Cannot load plaza ${id}: HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) this.buffers.set(id, id === 'dance' || id === 'reel' ? unpadLoop(context, buffer) : buffer);
      })).then(() => {
        if (this.disposed) return;
        this.ready = true;
        for (const e of this.pending.splice(0)) if (performance.now()-e.at < 250) this.cue(e.type, e.distance);
        this.mix();
      }).catch(error => { this.fail(error); this.pending.length = 0; });
      if (this.ready) this.mix();
    } catch (error) { this.fail(error); }
  }

  /** @param {unknown} error */
  fail(error) { this.error = error instanceof Error ? error.message : 'Cannot play plaza effects'; }

  /** @param {number} distance */
  level(distance) {
    return Number.isFinite(distance) && distance >= 0 && distance < HEAR ? (1-distance/HEAR)**1.5 : 0;
  }

  // Also called before a manual step. Network cues between frames share the same short cooldowns.
  beginFrame() { this.frameCues.clear(); }

  /** @param {Cue} type @param {number} distance */
  cue(type, distance) {
    try {
      const context = this.sounds.context, level = this.level(distance);
      if (!this.audible || this.error || !level || !context || !IDS.includes(type)) return;
      if (!this.ready) {
        if (this.pending.length < 8) this.pending.push({ type, distance, at: performance.now() });
        return;
      }
      const gap = type === 'chat' || type === 'chat-self' ? .28 : type === 'bump' ? .14 : .12;
      if (this.frameCues.has(type) || context.currentTime-(this.last.get(type) ?? -Infinity) < gap) return;
      const voice = this.play(type, level*(type === 'join' || type === 'leave' ? .3 : .55), false, 0);
      if (voice) { this.last.set(type, context.currentTime); this.frameCues.add(type); }
    } catch (error) { this.fail(error); }
  }

  /** @param {SoundId} id @param {number} level @param {boolean} loop @param {number} offset */
  play(id, level, loop, offset) {
    const context = this.sounds.context, master = this.sounds.master, buffer = this.buffers.get(id);
    if (!this.audible || !this.ready || !context || !master || !buffer || this.voices.size >= 12) return null;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = loop;
    gain.gain.value = loop ? 0 : level;
    source.connect(gain); gain.connect(master);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(0, offset % buffer.duration);
    this.counts.set(id, (this.counts.get(id) ?? 0)+1);
    return voice;
  }

  /** @param {{reel:number, dance:number}} motion already attenuated nearest-can levels */
  update(motion) { this.motion = motion; try { this.mix(); } catch (error) { this.fail(error); } }

  mix() {
    const context = this.sounds.context;
    if (!this.audible || !this.ready || !context || this.error) return;
    for (const id of /** @type {const} */ (['reel', 'dance'])) {
      const amount = Math.max(0, Math.min(1, this.motion[id]));
      let voice = this.loops.get(id);
      if (!amount) {
        if (voice) { this.fade(voice); this.loops.delete(id); }
        continue;
      }
      if (!voice) {
        const made = this.play(id, 0, true, id === 'dance' ? this.music.loopTime() ?? 0 : 0);
        if (!made) continue;
        voice = made; this.loops.set(id, voice);
      }
      voice.gain.gain.setTargetAtTime(amount*(id === 'dance' ? .2 : .24), context.currentTime, .045);
    }
  }

  /** @param {Voice} voice */
  fade(voice) {
    const context = this.sounds.context;
    if (!context) return;
    voice.gain.gain.setTargetAtTime(0, context.currentTime, .012);
    voice.source.stop(context.currentTime+.06);
  }

  stop() {
    this.pending.length = 0;
    this.loops.clear();
    for (const voice of this.voices) this.fade(voice);
  }

  dispose() {
    this.disposed = true;
    this.stop(); this.unsubscribe(); this.buffers.clear();
    removeEventListener('blur', this.onBlur);
    removeEventListener('focus', this.onFocus);
  }

  get state() {
    return { ready: this.ready, voices: this.voices.size, loops: [...this.loops.keys()], error: this.error,
      counts: Object.fromEntries(this.counts) };
  }
}
