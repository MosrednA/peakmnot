# Pocket Altitude — Peak Mnot music

An original cheeky alpine game theme composed for Peak Mnot at 104 BPM in D major: plucky marimba, pizzicato
strings, a warm tuba bass, little glockenspiel answers and short whistled phrases. The arrangement leaves full
bars of breathing room, with small changes across its 32-bar A/A'/B/A'' form.

| File | Use | Duration | Size |
|---|---|---|---|
| `peak-climb.mp3` | The mountain climb: light, bouncy and playful | 73.846 s | 1.035 MB |
| `peak-camp.mp3` | Title screen and resting at base camp: fewer notes, softer playing, no drum accents | 73.846 s | 1.035 MB |
| `peak-summit.mp3` | Short whistle/glockenspiel victory answer to the same theme | 6.015 s | 0.085 MB |

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
