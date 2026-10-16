// @ts-check
// The game's own sounds, through the shared sound switch (sounds.js), so it mutes them too. main.js tells it what
// happens with cue({ type, … }) and how Mnot is doing every frame with update(dt, state); reset() when a run starts
// again. Effects load as padded AAC after the shared audio unlock. See audio/emoji/README.md.
//
// The cues:
//   start                      the run begins (the first move)
//   take    { n, of }          the n-th listed emoji fetched (1-based), of how many
//   wrong   { lives }          a wrong emoji touched: it warps away, Mnot bumps back and sees stars; lives left
//   early   { lives }          a listed one touched too early: the same, but it pops back in a moment later
//   out                        the third wrong one: Mnot slips and goes over backwards
//   fall                       ... and lands flat on its back
//   bonk    { speed, hard }    into a snow wall (m/s, and 0..1 how hard)
//   peek    { up }             the camera rising over the field (up true) or coming back down
//   clear                      the list done: every other emoji twists away, one after another (over ~0.7 s)
//   quake   { holes }          ... and the snow shakes for ~0.9 s, cracking across `holes` passages (3 to 5) that
//                              give way one after another over the next ~0.7 s (a `hole` cue each, finale true)
//   peak                       :peak-mnot: lands in the middle of the field with a bump, 0.6 s later, in a beam
//   finish                     :peak-mnot: fetched: the clock stops, the dance
//   crack                      Mnot steps on a cracked passage: the snow creaks, and holds for half a second
//   hole    { under, finale }  ... then gives way into a hole, behind Mnot (made it) or right under it (under true);
//                              finale: one of the passages giving way at the end of the list, not stepped on
//   pit     { fresh }          Mnot drops into a hole up to its glasses (fresh: it gave way under it just now)
//   climb                      ... and lands back on the snow after a hop out, on the side it came from
// The state: { speed (m/s), skid (m/s sideways), braking, dizzy (s of stars left), peek (0..1) }
import { unpadLoop } from '../../sounds.js';
/** @typedef {'start'|'take'|'wrong'|'early'|'out'|'fall'|'bonk'|'peek-up'|'peek-down'|'clear'|'peak'|'finish'|'crack'|'quake'|'hole'|'pit'|'climb'|'slide'|'skid'} SoundId */
/** @typedef {{type:'start'|'out'|'fall'|'clear'|'peak'|'finish'|'crack'|'climb'} | {type:'take', n:number, of:number} |
 * {type:'wrong'|'early', lives:number} | {type:'bonk', speed:number, hard:number} | {type:'peek', up:boolean} |
 * {type:'quake', holes:number} | {type:'hole', under:boolean, finale:boolean} | {type:'pit', fresh:boolean}} EmojiCue */
/** @typedef {{speed:number, skid:number, braking:boolean, dizzy:number, peek:number}} Motion */
/** @typedef {{source:AudioBufferSourceNode, gain:GainNode}} Voice */
/** @type {ReadonlyArray<SoundId>} */
const IDS = ['start', 'take', 'wrong', 'early', 'out', 'fall', 'bonk', 'peek-up', 'peek-down', 'clear',
  'peak', 'finish', 'crack', 'quake', 'hole', 'pit', 'climb', 'slide', 'skid'];
const clamp = (/** @type {number} */ n, /** @type {number} */ hi) => Number.isFinite(n) ? Math.max(0, Math.min(hi, n)) : 0;

export class EmojiSfx {
  /** @param {import('../../sounds.js').MnotSounds} sounds */
  constructor(sounds) {
    this.sounds = sounds;
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
    /** @type {Map<SoundId, number>} */
    this.last = new Map();
    /** @type {Array<{event:EmojiCue, at:number}>} */
    this.pending = [];
    /** @type {Motion} */
    this.motion = { speed:0, skid:0, braking:false, dizzy:0, peek:0 };
    this.unsubscribe = sounds.onStateChange(() => this.sync());
    this.onBlur = () => sounds.pause();
    this.onFocus = () => sounds.resume();
    addEventListener('blur', this.onBlur);
    addEventListener('focus', this.onFocus);
    this.sync();
  }

  get audible() {
    return !this.disposed && this.sounds.enabled && !this.sounds.paused && this.sounds.context?.state === 'running';
  }

  /** @param {unknown} error */
  fail(error) { this.error = error instanceof Error ? error.message : 'Cannot play Reaction Run effects'; }

  sync() {
    try {
      if (!this.audible) { this.stop(); return; }
      const context = this.sounds.context;
      if (!context || this.error) return;
      if (!this.loading) this.loading = Promise.all(IDS.map(async id => {
        const response = await fetch(new URL(`../../audio/emoji/${id}.m4a`, import.meta.url));
        if (!response.ok) throw new Error(`Cannot load Reaction Run ${id}: HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) this.buffers.set(id, id === 'slide' || id === 'skid' ? unpadLoop(context, buffer) : buffer);
      })).then(() => {
        if (this.disposed) return;
        this.ready = true;
        for (const item of this.pending.splice(0)) if (performance.now()-item.at < 250) this.cue(item.event);
        this.mix();
      }).catch(error => { this.fail(error); this.pending.length = 0; });
      if (this.ready) this.mix();
    } catch (error) { this.fail(error); }
  }

  /** @param {SoundId} id @param {number} level @param {number} rate @param {boolean} loop @returns {Voice|null} */
  play(id, level, rate, loop) {
    const context = this.sounds.context, buffer = this.buffers.get(id), master = this.sounds.master;
    if (!this.audible || !this.ready || !context || !buffer || !master || this.voices.size >= 20) return null;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.loop = loop;
    gain.gain.value = loop ? 0 : level;
    source.connect(gain); gain.connect(master);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start();
    this.counts.set(id, (this.counts.get(id) ?? 0)+1);
    return voice;
  }

  /** @param {EmojiCue} event */
  cue(event) {
    try {
      if (!this.audible || this.error) return;
      if (!this.ready) {
        if (this.pending.length < 8) this.pending.push({event, at:performance.now()});
        this.sync(); return;
      }
      const context = this.sounds.context;
      if (!context) return;
      let id = /** @type {SoundId} */ (event.type), level = .48, rate = 1;
      switch (event.type) {
        case 'peek': id = event.up ? 'peek-up' : 'peek-down'; level = .25; break;
        case 'take': rate = 2 ** (clamp((event.n-1)/Math.max(1, event.of-1), 1)*7/12); level = .52; break;
        case 'wrong': case 'early': rate = event.lives === 0 ? .88 : 1; break;
        case 'bonk': level = .18 + .4*clamp(event.hard, 1); rate = 1.15-.3*clamp(event.speed/10, 1); break;
        case 'hole': level = event.under ? .6 : .38; break;
        case 'pit': level = event.fresh ? .28 : .48; break;
        case 'finish': level = .24; break; // the music owns the longer victory answer
        case 'crack': level = .4; break;
      }
      if (!IDS.includes(id) || id === 'slide' || id === 'skid') return;
      if (context.currentTime-(this.last.get(id) ?? -Infinity) < (id === 'bonk' ? .12 : .045)) return;
      if (this.play(id, level, rate, false)) this.last.set(id, context.currentTime);
    } catch (error) { this.fail(error); }
  }

  mix() {
    const context = this.sounds.context;
    if (!this.audible || !this.ready || !context) return;
    const speed = clamp(this.motion.speed/9, 1), skid = clamp(Math.abs(this.motion.skid)/5, 1);
    const hush = 1-.85*clamp(this.motion.peek, 1);
    for (const id of /** @type {const} */ (['slide', 'skid'])) {
      const level = hush*(id === 'slide' ? .2*speed : .23*speed*Math.max(skid, this.motion.braking ? .65 : 0));
      let voice = this.loops.get(id);
      if (!voice && level > .002) {
        voice = this.play(id, 0, 1, true) ?? undefined;
        if (voice) this.loops.set(id, voice);
      }
      if (voice) {
        voice.gain.gain.setTargetAtTime(level, context.currentTime, .07);
        voice.source.playbackRate.setTargetAtTime(.8+.5*speed, context.currentTime, .1);
        if (level <= .002) {
          voice.source.stop(context.currentTime+.35);
          this.loops.delete(id);
        }
      }
    }
  }

  /** @param {number} dt @param {Motion} state */
  update(dt, state) {
    this.motion = state;
    try { this.mix(); } catch (error) { this.fail(error); }
  }

  stop() {
    this.pending.length = 0;
    this.loops.clear();
    const context = this.sounds.context;
    if (!context) return;
    for (const voice of this.voices) {
      voice.gain.gain.setTargetAtTime(0, context.currentTime, .015);
      voice.source.stop(context.currentTime+.09);
    }
  }

  reset() {
    this.motion = { speed:0, skid:0, braking:false, dizzy:0, peek:0 };
    this.last.clear();
    this.stop();
  }

  dispose() {
    this.disposed = true;
    this.reset();
    this.unsubscribe();
    removeEventListener('blur', this.onBlur);
    removeEventListener('focus', this.onFocus);
    this.buffers.clear();
  }

  get state() {
    return {ready:this.ready, audible:this.audible, error:this.error, voices:this.voices.size,
      loops:[...this.loops.keys()], counts:Object.fromEntries(this.counts)};
  }
}
