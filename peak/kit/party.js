// What every mini game's finish party is made of: a clock on the music's beat, so the dance lands on the tune, and
// confetti over the winner (look/bursts.js's pooled bits). The dance itself is the game's own (the downhill's is
// peak/downhill/party.js); the music gives the clock (its loopTime(): seconds into its loop, or null while it's off).

import * as THREE from 'three';

// Beats since the dance began, b: negative while it swings into place, and the first beat lands on one of the
// tune's. While the music plays the dance is eased back onto its beat if it drifts (never so hard it runs
// backwards); while it's off, the dance keeps its own time.
export class Beat {
  constructor(seconds = 0.5) {     // a beat: 0.5 s is 120 BPM
    this.seconds = seconds;
    this.b = 0;
    this.lead = 1;                 // the beats the swing into place takes
  }

  // the swing into place takes at least `lead` seconds, and ends on the tune's next beat after that
  start(clock, lead) {
    const tune = clock === null ? null : clock / this.seconds;
    this.b = tune === null ? -lead / this.seconds : -(Math.ceil(tune + lead / this.seconds) - tune);
    this.lead = -this.b;
    return this.b;
  }

  update(dt, clock) {
    const tune = clock === null ? null : clock / this.seconds;
    this.b += dt / this.seconds;
    if (tune !== null) { const off = tune - this.b; this.b += (off - Math.round(off)) * Math.min(1, 3 * dt); }
    return this.b;
  }
}

// A burst of confetti from `at`, up and out, in random bright colours (or `colors`), fluttering down.
export function confetti(puffs, at, { count = 90, colors = null, up = 2.5 } = {}) {
  for (let i = 0; i < count; i++) {
    const color = colors ? colors[i % colors.length] : new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
    puffs.add('bit', { at: at.clone().setY(at.y + up), color, gravity: 4, drag: 1.5, spin: 6,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7),
      size: 0.05, life: 3 + Math.random() * 2, bounce: 0 });
  }
}
