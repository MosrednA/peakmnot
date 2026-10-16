# Downhill sound effects

Thirty-three original, reproducible mono PCM16 WAVs at 22,050 Hz, about 1.3 MiB in total. The palette is made with
filtered noise, damped material resonances, pneumatic air, liquid bubbles and a short original finish fanfare.
`tools/make_downhill_sounds.py` regenerates the files and `manifest.json`; it uses NumPy, SciPy, SoundFile and FFmpeg.
It makes no remote calls. The wordless crowd is a small synthesised vowel chorus, not a recorded audience.

One-shots have softened edges and peaks at most 0.35. Eight two-second loops cover the four snow/ice surfaces,
wind, heels braking, swivel bearings and bare legs scraping. Loop endpoints match, and the runtime fades changes
over about 80 ms. Casters quieten as wheels are lost; the scrape grows per missing wheel. Airborne chairs keep wind
and swivel but lose the ground-contact loops. The soundtrack is deliberately sparse: ambience sits below impacts.

`preview.mp3` is a listening reel at approximately the game mix levels: lift, landings, material crashes, wheel,
snowman, chairs, cooler, ficus, pine branches, bird, camera, pit, strike/crowd, bonus, lost/splash, wrecked and finish;
then two cycles of each loop.
The game loads only AAC `.m4a` effects, after an audio unlock, and does not load the reel or manifest. WAVs remain
the editable masters. Run `python tools/compress_audio.py audio/downhill` after regenerating them; the manifest
marks the eight loops. Compression wraps those loops in 0.2 s of matching audio on each end, which the runtime
removes with `unpadLoop` from `sounds.js` after decoding. The 33 AAC files total 245 KB (18% of their WAV masters).
Production builds include the `.m4a` files and omit WAVs.

## Runtime API

`peak/downhill/sfx.js` exports `DownhillSfx` and the pure `downhillLoopMix(state)` helper. The module shares the
existing `MnotSounds` instance; it creates no separate AudioContext or Sound preference. It adds trusted
`pointerup`/`touchend` unlocks and blur/focus handling. Missing/undecodable assets set `sfx.error` and keep the game
running. `sfx.state` exposes readiness, active loops, voice counts and per-file play counts for QA.

```js
import { DownhillSfx } from './sfx.js';
const sfx = new DownhillSfx(sounds);
ride.on('jump', () => sfx.cue({ type: 'jump' }));
ride.on('land', ({ impact, air }) => sfx.cue({ type: 'land', impact, air }));
ride.on('crash', ({ impulse, kind }) => sfx.cue({ type: 'crash', impulse, kind }));
ride.on('wheel', ({ cause, left }) => sfx.cue({ type: 'wheel', cause, left }));
ride.on('bump', ({ kind }) => sfx.cue({ type: 'bump', kind }));
obstacles.birds.onTakeoff = () => sfx.cue({ type: 'bird' });
// Add to the existing callbacks; preserve their HUD, photo and physics work.
obstacles.pins.onScore = down => { /* existing score work */ sfx.cue({ type: 'bowling', down }); };
ride.on('flight', ({ distance }) => sfx.cue({ type: 'flight', distance, kLine: K_LINE }));
// In snap(), after checking that a photograph is actually taken:
sfx.cue({ type: 'photo' });
// pit/lost/splash/wrecked/finish callbacks: sfx.cue({ type: 'pit' }), etc.

// Once per rendered frame, after the ride/rider update:
sfx.update({
  active: playing && !ride.done && !ride.out,
  speed: ride.speed, grounded: ride.grounded, surface: ride.under.surface,
  brake: rider.brake, spin: ride.seatSpin, missing: ride.missing,
});
// Before restart/respawn; decoded assets remain available:
sfx.reset();
// When disposing a level (removes listeners and releases nodes):
sfx.dispose();
```

Use downhill cues in place of the climb's jump/land/fall effects to avoid duplicate impacts. The existing Wave
sound can remain on finish; the downhill cue adds a brief fanfare. `flight` takes the level's current `K_LINE`
explicitly so larger jump layouts do not keep an old applause threshold. `bowling` adds a strike/cheer only for ten
pins; individual pin/knockoff impacts already use `bump`. `splash` is for entering the river, `cooler` for its spill.
Banner poles (`crash.kind === 'pole'`) use the metal clang. Unknown crash/bump kinds are silently ignored, so a
new obstacle without a sound mapping cannot interrupt the ride. River entry uses `splash` alone; use `lost` for
the crevasse and off-piste falls. Pine branches (`bump.kind === 'tree'`) use a soft 0.48 s needle rustle, while a
trunk collision keeps `crash-tree`. The bird's three short ascending/descending tweets play only when its perched
animation takes off from Mnot's head, after the dazed pause. Resetting before takeoff cancels that moment naturally;
there is no wall-clock timer. Both cues share the existing cooldown, mute and focus behavior.
For time taken off the clock, call `sfx.cue({ type: 'bonus', seconds })`. A 0.36 s D-major bell/clock answer gets
a little louder as the saved seconds grow, capped at 20 s and kept below the strike/crowd. Zero, negative and
non-finite values stay silent; playback pitch is fixed so it sits with Pocket Altitude. With the new downhill music,
use its `music.finish()` instead of the palette's small finish fanfare.

Run `node --test tools/check_downhill_sounds.mjs` for PCM, AAC asset presence/size, seams and mix contracts. Run
`tools/check_downhill_sounds.js` in a fresh Playwright tab with the shared dev server on 5280 for real gesture
unlock, AAC decode and loop padding/seams, material cues, mute/focus/reset, node bounds and asset-error handling.
