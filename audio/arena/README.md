# Mnot Arena audio

Pocket Altitude — Plaza is a quiet 96 BPM, D major variation of the climb's theme, for hanging around on the
snowy plaza. The 32-bar, 80-second loop retains the marimba, pizzicato harmony and tuba bass, with soft vibraphone
and clarinet answers, a sparse beat and four bars of breathing room in each eight-bar lead phrase. The editable
score is `plaza.mid`; the stereo PCM master stays outside shipped audio. `plaza.mp3` is gapless 112 kbit/s stereo.
The middle of three rendered cycles keeps instrument tails across the seam, 40 ms before the downbeat, as in
[the original Pocket Altitude](../music/README.md) (also the FluidSynth / GeneralUser GS license).

| Cue | Sound |
|---|---|
| `join-self`, `join` | A can tab pop and fizz for me; a softer tab pop for a nearby visitor |
| `leave`, `idle` | A quiet closing ring, or a sleepy falling can resonance |
| `chat-self`, `chat` | Two distinct, very short tab/rim blips |
| `bump` | A hollow metallic can clonk with a soft body thump |
| `reel` | A quiet wavering can resonance while nearby cans are dazed |
| `dance` | A one-bar soda shaker/tab-click loop at 96 BPM, aligned with the music |
| `full`, `slow` | Small descending can notes for room/chat limits |
| `lost`, `back` | Falling/rising three-note can answers for the connection |

`peak/arena/music.js` and `sfx.js` share the existing `MnotSounds` context, master, saved Sound setting and pause
state. Both wait for the first trusted gesture with sound enabled. The kit handles keys and taps (including
pointerup/touchend); joining by click unlocks sound. The music continues when watching the room. Blur and mute
release all voices; returning preserves the music's phase. Errors are recorded in each player's `state` and
cannot stop the room or its movement. `dispose()` releases voices, listeners and decoded buffers.

Other visitors are heard only within **7 m of my can**, fading towards the edge. A spectator has no world
listener. Join uses the visitor's known spawn; chat and departure use its last drawn position, measured before
removal. My cues and room/connection UI use distance zero. There is at most one cue of each kind per frame,
with an additional 280 ms chat cooldown and 140 ms bump cooldown across frames. At most twelve effect voices
exist, including fading voices. All nearby dancers share one loop, all reeling cans another; their levels use
the nearest participant, so twelve cans cannot multiply their volume. Cues queued during initial decoding expire
after 250 ms. Jump, landing, footsteps and wave keep the climb's existing local-player sounds.

## Rebuild and check

```sh
python tools/make_arena_audio.py --fluidsynth PATH --soundfont PATH
python tools/compress_audio.py audio/arena
python tools/check_arena_audio.py
npm run build
node --test tools/check_arena_audio.mjs tools/check_arena.mjs
```

The generator reuses the project's MIDI reader and deterministic foley primitives; no network or paid service
is involved. Thirteen WAV files are editable effects masters; runtime loads their AAC `.m4a` versions.
`manifest.json` marks `dance` and `reel` for the compressor's 200 ms codec padding on each side; `unpadLoop()`
removes it after Web Audio decoding. Each resulting loop is exactly 2.5 seconds.

The temporary servers retry ports that Chromium blocks, for both the page and the room connection.

The Python checks measure decoded levels, finite samples, exact AAC playback lengths, loop seams, the 80-second
music period and retained theme/harmony. The Chromium checks start their own temporary page and room servers,
exercise the actual network and animation hooks, distance boundaries, simultaneous chat, voice limits, mute,
pause, returning musical phase, lost/back, spectators and disposal, plus the built page and a broken codec.
`PLAYWRIGHT` and `CHROME` can point to an
existing Playwright module/browser, as for `tools/check_arena.mjs`.

The hooks are in `peak/arena/main.js`; the room protocol and server require no audio changes.
