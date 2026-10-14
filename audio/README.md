# Mnot sounds

Peak Mnot also has an original alpine music theme, with climb/camp loops and a summit sting;
see [music/README.md](music/README.md) for the files, playback and loop verification.

The office-chair downhill has its own [foley palette and runtime API](downhill/README.md), with rolling, wind,
braking, swivel/damage loops and material/event cues. It shares the game's AudioContext and Sound preference.

Ten ElevenLabs `eleven_text_to_sound_v2` effects: three walking steps, two running steps, Jump, a soft landing,
a deeper cushioned landing, Wave bubbles and a seamless Fall balancing loop. The revised palette uses padded rubber
footfalls, a short rubber spring for Jump, warm low impacts and rounded bubbles. Prompts exclude metallic rattles,
creaks and crackle. Jump excludes wind and swooshes; Fall uses soft elastic flaps, gently wobbling pitch and tiny
rubber plips for understated cartoon slapstick.

`source/*.mp3` are the original generations. Each adjacent JSON records its prompt, requested duration, model and
reported character cost. `manifest.json` describes the prepared mono 22,050 Hz PCM WAV files. The API key is read
only by the generation script from `ELEVENLABS_API_KEY`; it is never included in the browser or saved assets.

Preparation removes DC and silent lead-ins, softens high frequencies with a low-pass filter, caps peaks at 0.35,
matches footstep levels and fades one-shot edges. Fall has a crossfaded loop seam. Web Audio adds a 0.55 master
gain and lower per-effect levels; small footstep pitch/volume variations avoid repeating an identical sample.
`preview.mp3` plays walking, running, Jump/Fall, both landings and Wave at the viewer's mix levels.
`fall-preview.mp3` plays two cycles of the current Fall sound at its in-game volume.

The viewer preloads all files, then unlocks and decodes audio on a real click or control key. M and the sound button
toggle a saved preference. Losing focus fades active voices out; returning restores audio after it has been unlocked.
Steps follow the shared Walk/Run foot phase, without duplicate contacts during a gait crossfade. Jump and landing
effects follow actual physics events. Fall audio starts with the Fall animation on flights above the normal running
jump height (0.8 units), or in its clip preview. Normal jumps keep the Fall pose silent. Once started, the sound
loops for as long as the pose continues and fades out when it ends. It has no fixed playback timeout.

Regenerate the palette (uses ElevenLabs credits):

```powershell
python tools/make_sounds.py --replace
python tools/prepare_sounds.py
python tools/compress_audio.py
```

Without `--replace`, existing outputs are reused. Pass names, e.g. `python tools/make_sounds.py wave --replace`,
to regenerate selected effects. Generation uses Python's standard library; preparation needs NumPy, SciPy,
SoundFile and FFmpeg. The dev server watches the WAVs, the `.m4a` files and `sounds.js` and reloads the viewer after
changes. Run `tools/check_sounds.js` via Playwright MCP's `browser_run_code_unsafe` filename argument in a fresh tab.

## Formats

The games load AAC in `.m4a` files, made from the prepared WAVs by `tools/compress_audio.py` (FFmpeg's AAC encoder,
48 kbit/s a channel, at the WAV's own rate). Every browser decodes it with Web Audio, Safari on iOS included, and the
ten effects shrink from 226 KB to 46 KB. The WAVs stay next to them as the masters: edit or regenerate those, then
run the tool again. Neither the production build nor the Docker image takes the WAVs along.

Browsers trim the encoder's delay at the start, so a one-shot keeps its length to the sample, but AAC can't end a
loop cleanly on its last sample. So the tool wraps every loop in 0.2 s of its own other end on both sides before it
encodes it, and `sounds.js` cuts that off again after decoding (`unpadLoop`, `LOOP_PAD`): the codec's edges land in
the padding, not on the seam. The loops are the sounds with `"loop": true` in the folder's `manifest.json` (or
`--loop NAME`). The tool checks that each file plays for exactly the WAV's length, and writes a file only when its
bytes change.

```powershell
python tools/compress_audio.py                  # audio/
python tools/compress_audio.py audio/downhill   # any folder of WAVs with its manifest.json
```

A game loads its sounds with `new URL('…', import.meta.url)`, so the production build finds and copies them.
