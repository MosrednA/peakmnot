// The game's tune: a variation on the climb's (the downhill's music.js is the example), through the shared sound
// switch (sounds.js). Codex's to fill; silent for now. main.js calls start() when a run begins, duck(level) when
// it goes wrong (0.24) or comes right again (1), finish() for the dance at the end, and reset() before a run starts
// again.
export class EmojiMusic {
  constructor(sounds) {
    this.sounds = sounds;
  }

  start() {}

  duck(level) {}

  finish() {}

  reset() {}
}
