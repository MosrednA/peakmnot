# Pocket Altitude — Peak Mnot music

An original cheeky alpine game theme composed for Peak Mnot at 104 BPM in D major: plucky marimba, pizzicato
strings, a warm tuba bass, little glockenspiel answers and short whistled phrases. The arrangement leaves full
bars of breathing room, with small changes across its 32-bar A/A'/B/A'' form.

| File | Use | Duration | Size |
|---|---|---|---|
| `peak-climb.mp3` | The mountain climb: light, bouncy and playful | 73.846 s | 1.035 MB |
| `peak-camp.mp3` | Title screen and resting at base camp: fewer notes, softer playing, no drum accents | 73.846 s | 1.035 MB |
| `peak-summit.mp3` | Short whistle/glockenspiel victory answer to the same theme | 6.015 s | 0.085 MB |
| `peak-downhill.mp3` | Office-chair downhill: the same theme at 120 BPM, with extra bass pickups and a light brush shuffle | 64.000 s | 0.897 MB |
| `peak-downhill-finish.mp3` | A faster vibraphone/whistle answer to the summit theme | 4.400 s | 0.063 MB |

The adjacent `.mid` files are the editable scores. `manifest.json` records exact durations, tempo, instrumentation,
renderer and file sizes. Only compressed 112 kbit/s stereo MP3s are loaded by the browser; all WAV masters and the
render helper are in `.mnot-qa/music/`, outside shipped `audio/`. No API key or synthesis dependencies ship to the game.

The music was composed locally after ElevenLabs' Music API returned `paid_plan_required` for the existing SFX key.
It was rendered with [FluidSynth](https://github.com/FluidSynth/fluidsynth) and S. Christian Collins'
[GeneralUser GS 2.0.3](https://schristiancollins.com/generaluser.php). The SoundFont stays in the local build cache.
Its [license](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) permits music
creation and publication and includes the author's notes about its samples.

## Playback

`music.js` owns decoded Web Audio loops and a summit one-shot, borrowing `MnotSounds.context` and its master gain.
`sounds.js` publishes unlock, mute and focus changes through `onStateChange()`. Peak alone attaches music, so the
original animation viewer continues to load effects only. A real gesture must unlock audio before any music starts.
The MP3s, the game's biggest download, start once the first frame is on screen, or at the unlock if that is sooner.
The existing Sound button and M toggle control effects and music together, retaining the saved preference.

`peak/audio.js` wires the game events. Music is quieter than foreground effects and crossfades over 0.8 seconds.
Both loop arrangements share their tempo, harmony and duration; switches keep the same bar position. At base camp,
standing still within 3 units of its checkpoint selects the calmer arrangement. Walking out selects the climb.
`lost` ducks the backing to 24%; `respawn` restores it. `summit` plays the sting and briefly ducks the loop underneath.
Muting or losing focus releases the loop voices; returning starts at the continuing musical phase. Music errors
are recorded in `sounds.music.state.error` and do not stop game simulation or other effects.

The title setup in `peak/main.js` calls `audio.attachTitle(title)`. This subscribes to `show` and `start`, and reads
`body.title-up` immediately so it catches a title already shown. Manual-mode tests need no title.

## Loop construction

The scores are rendered for three identical cycles. The middle cycle includes instrument/reverb tails from the
preceding cycle, avoiding an artificial silent start. The first 25 ms ease from the following cycle's matching
continuation into the chosen take, keeping the musical length intact. Static level adjustment preserves dynamics.
LAME gapless metadata is retained in the MP3; playback loops decoded PCM rather than restarting a media element.
Browser QA checks the decoded duration and an OfflineAudioContext render across each loop boundary, along with
unlock, scene changes, mute/focus cleanup, mishap ducking and the summit sting.

To re-render locally, use the existing helper `python .mnot-qa/music/compose.py` (NumPy, SoundFile, FFmpeg,
FluidSynth and GeneralUser GS required). For a fresh setup, the committed MIDIs are the source scores; render each
three times at 44,100 Hz, select its middle 32 bars and preserve matching tails at the seam. A normalised fade-out
or a full intro/outro will break the repeatable game loop.

## Desk to Piste: the downhill variation

The downhill keeps every original note from `peak-climb.mid`, including the melody and harmony, at 120 BPM instead
of 104. Quiet tuba pickups and shuffled brush-kit hats add drive. A vibraphone takes the whistle's phrases in the
second and fourth eight-bar sections, an elevator-lounge wink; the first and third sections keep the whistle.
The finish uses the original summit answer, played by vibraphone with a quiet whistle doubling it. The two MP3s
together are under 1 MB; their editable MIDIs and `downhill-manifest.json` sit beside them. PCM masters stay in
`.mnot-qa/music/downhill/`. The arrangement uses the same FluidSynth/GeneralUser GS renderer and license as above.

Reproduce it with `python tools/make_downhill_music.py`. The source is the committed climb/summit MIDIs; the helper
does not need the older local composer. It expects the existing renderer/SoundFont cache, or explicit
`--fluidsynth PATH --soundfont PATH` pointing to FluidSynth and GeneralUser GS. Run
`python tools/check_downhill_music.py` for score identity, tempo, decoded lengths, headroom and file size.
`tools/check_downhill_music.js` checks the actual browser PCM loop boundary and music lifecycle on the dev server.

The player is `peak/downhill/music.js`, separate from the climb's player. It shares `MnotSounds.context`, master and
Sound preference. Both files load only after an audible unlock; the title requests the tune too, so it starts
when sound is unlocked and continues into the run. The waiting state remains silent until `music.start()`.

```js
import { DownhillMusic } from './music.js';
const music = new DownhillMusic(sounds);
music.start();     // title / begin() / the gate's start event; duplicate calls keep the same phase
music.duck(.24);   // lost or wrecked
music.duck(1);     // respawn; the continuing musical phase is preserved
music.finish();    // finish: play the short answer once over the continuing run tune
music.loopTime();  // seconds into the musical loop (0 at its downbeat), or null when not playing
music.reset();     // restart: clear the old voices and musical origin
music.start();     // start the new run after reset
music.dispose();  // level disposal: unsubscribe, release nodes and decoded buffers
```

Use `music.finish()` in place of the SFX palette's small finish fanfare; the existing Wave cue can remain. The run
tune continues through the finish party at its original phase, with the sting on top. `loopTime()` uses the shared
AudioContext clock and returns the position within the 64-second musical cycle; divide by 0.5 for beats at 120 BPM,
then take modulo 8 for the two-bar dance. It compensates for the MP3 take's 40 ms lead-in before the first downbeat.
It returns null before playback, while muted or focus-paused, and after reset. Muting or losing focus releases
voices while the internal phase continues; resuming keeps the musical phase. A completed sting is not replayed on unmute.
The player exposes `music.state` for QA, and contains load/audio-device errors without interrupting gameplay or SFX.
