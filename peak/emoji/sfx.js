// The game's own sounds, through the shared sound switch (sounds.js), so it mutes them too. main.js tells it what
// happens with cue({ type, … }) and how Mnot is doing every frame with update(dt, state); reset() when a run starts
// again. Codex's to fill: only `wrong` makes a sound yet, a placeholder buzzer made on the spot with Web Audio.
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
//   clear                      the list done: every other emoji twists away, one after another (over ~0.6 s)
//   peak                       :peak-mnot: lands in the middle of the field with a bump, half a second later
//   finish                     :peak-mnot: fetched: the clock stops, the dance
//   crack                      Mnot steps on a cracked passage: the snow creaks, and holds for half a second
//   hole    { under }          ... then gives way into a hole, behind Mnot (made it) or right under it (under true)
//   pit     { fresh }          Mnot drops into a hole up to its glasses (fresh: it gave way under it just now)
//   climb                      ... and lands back on the snow after a hop out, on the side it came from
// The state: { speed (m/s), skid (m/s sideways), braking, dizzy (s of stars left), peek (0..1) }
const LEVEL = 0.32;

export class EmojiSfx {
  constructor(sounds) {
    this.sounds = sounds;
  }

  cue(event) {
    if (event.type === 'wrong' || event.type === 'early') this.buzz();
  }

  update(dt, state) {}

  reset() {}

  // eh-eh: two short honks, the second lower, each a square wave and a slightly sour saw a little off it
  buzz() {
    const { sounds } = this, context = sounds.context;
    if (!sounds.enabled || sounds.paused || !sounds.master || context?.state !== 'running') return;
    const now = context.currentTime;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.connect(sounds.master);
    for (const [at, hz] of [[0, 196], [0.17, 147]]) {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(LEVEL, now + at + 0.012);
      gain.gain.setValueAtTime(LEVEL, now + at + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.16);
      gain.connect(filter);
      for (const [type, detune] of [['square', 0], ['sawtooth', 18]]) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = hz;
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(now + at);
        osc.stop(now + at + 0.18);
      }
    }
  }
}
