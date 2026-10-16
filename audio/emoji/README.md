# Reaction Run audio

Original, locally synthesised cartoon foley and a 112 BPM variation of Pocket Altitude in D major. No paid calls.
The theme retains the climb's melody and harmony, with marimba, pizzicato strings, tuba, music box and clarinet,
quiet shuffled hats and bass pickups. The 32-bar run repeats through the finish dance; the summit answer plays
once over it. Editable scores are `run.mid` and `answer.mid`. See [the original theme](../music/README.md) for the
FluidSynth / GeneralUser GS renderer and SoundFont license. Music PCM masters stay in `.mnot-qa/emoji/`.

| Cues | Sound |
|---|---|
| `start`, `take` | A small lift and a wooden pop; each listed emoji raises the pop towards a fifth |
| `wrong`, `early`, `out`, `fall` | Two distinct falling rubber notes, a long slip and a soft snowy flop |
| `bonk` | A dull rubber/snow bump, stronger and lower at speed; limited to one every 120 ms |
| `peek { up }` | Quiet up/down glissandi |
| `clear`, `peak`, `finish` | A ripple of disappearing stickers, the prize's snow thump, a small bright pop under the music answer |
| `crack`, `quake`, `hole` | Three dry ticks, then two seconds of creaking and crackling, harder and quicker as the hold runs out; a low snowy rumble; the collapse, its chunks thudding into the hole |
| `teeter`, `steady` | At a hole's edge: whooshes of the wheeling arms and a wavering "whoa" that rocks with Mnot, cut short when it's saved or drops in; saved, two quick steps and a "phew" |
| `pit`, `climb` | A muffled drop and a hop back out |
| `slide`, `skid` | Two-second seamless snow loops; speed controls level/rate, lateral slip and braking raise the skid, peeking quietens both |

`peak/emoji/sfx.js` and `music.js` use `MnotSounds.context`, its master, saved Sound preference and pause state.
The kit unlocks audio with a trusted key/tap, including pointerup/touchend. The game's palette and music load only
after this unlock with sound enabled. Mute/focus pause releases voices; unmute keeps the music's phase. Reset
clears pending cues, loops and the musical origin while retaining decoded assets. `dispose()` also unsubscribes
and frees buffers. `state` reports loading errors, voices and cue counts for QA. Effects are capped at 20 voices;
only cues younger than 250 ms survive initial decoding. Music errors cannot interrupt gameplay.

Rebuild with:

```sh
python tools/make_emoji_audio.py --fluidsynth PATH --soundfont PATH
python tools/compress_audio.py audio/emoji
```

`--foley` instead of the two paths renders the effects alone and keeps the music as it is (no FluidSynth needed).
The effects share one seeded random generator, so a new one goes after the others in `foley()`, leaving them as
they were.

The helper reuses the downhill's MIDI reader and deterministic foley primitives. WAV effects are editable masters;
runtime uses AAC `.m4a`. `manifest.json` marks `slide` and `skid` for 200 ms codec padding on both ends, removed by
`unpadLoop()` after decoding. Music uses gapless 112 kbit/s stereo MP3s rendered for three cycles and cut from the
middle cycle with matching tails at the seam (40 ms before the downbeat).

Checks: `python tools/check_emoji_audio.py` measures PCM/AAC levels, lengths, loop seams and score identity;
`tools/check_emoji_audio.js` runs in a fresh Playwright page on the worktree server (5296), covering trusted unlock,
every cue, movement, mute/pause/reset, music phase, the finish answer and a whole autopilot run.
