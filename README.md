# Mnot

A soda can with big glasses and rubber-hose arms and legs, rigged and animated for a browser game.

| File | What |
|---|---|
| `models/mnot.glb` | The game asset: one skinned mesh (9 materials), 15 bones, clips `Idle`, `Walk`, `Run`, `Wave` and the jump: `JumpStart`, `LeapStart`, `Fall`, `Land`, `LeapLand`, `LandHard`. |
| `models/mnot.blend` | The Blender file, with IK controls for the legs. Animate here. |
| `tools/build_mnot.py` | Builds both files from scratch (model, rig, weights, clips). |
| `index.html` | Viewer: toon look with an outline, clip buttons, laps, WASD to walk, Shift to run, Space to jump (or the Jump and High jump buttons), E to wave. |
| `tools/check_controls.js` | 24 deterministic Playwright browser checks for input, movement, jump timing and animation transitions. |
| `sounds.js` | Web Audio playback synchronized with foot contacts, push-off, flight and touchdown. |
| [`audio/README.md`](audio/README.md) | ElevenLabs sound palette, source metadata, processing and regeneration. |
| `tools/check_sounds.js` | Real-time Playwright checks for audio loading, event timing, muting and focus cleanup. |
| `tools/dev_server.py` | Local server with cache disabled and automatic browser reload when code, GLB or WAV sounds change. |
| [`peak/README.md`](peak/README.md) | Peak Mnot, the game: a mountain climb in `peak.html` and `peak/`. Open <http://127.0.0.1:5280/peak.html>. |

View it: `python tools/dev_server.py`, then open <http://127.0.0.1:5280/>.
The browser checks for source changes every 750 ms and reloads automatically. The version hash watches
`index.html`, `sounds.js`, `peak.html`, `peak/*.js`, GLB models and WAV sounds, including newly created Peak files.
Local responses use
`Cache-Control: no-store`, so edited code and models load fresh. After switching from the old static server,
refresh an already open tab once to enable live reload.

## Viewer controls

WASD / arrow keys move relative to the camera; Shift runs, Space jumps, E waves, M toggles sound, and dragging orbits the camera.
Audio starts after the first click or control key. The `Sound on` / `Sound off` button also toggles it, and the setting persists.
Footsteps follow the two contacts per stride, with no steps during flight or settling into Idle. Jump audio plays
at push-off, landing audio at ground contact. Fall sound accompanies the Fall animation during longer flights
(above the normal running jump height) or its clip preview, and fades out at touchdown or when leaving the preview.
Normal standing, walking and running jumps have only push-off and landing sounds. Wave greets when entering the gesture.
Movement accelerates and brakes smoothly. `THREE.AnimationMixer` plays the clips, and
`AnimationAction.crossFadeTo()` handles transitions. Run and Walk blend over 0.2 seconds and keep the same
stride phase; `setEffectiveTimeScale()` uses their blended stride length to follow actual travel speed.
Releasing movement starts an `IdleEnter` from the current rendered pose immediately. Its
`smootherstep` curve settles the limbs without leaving a slowed walking cycle playing during the stop.
Each arm, leg and the body have a duration based on the remaining joint rotation and hand/foot travel
(0.08–0.6 seconds; at least 0.18 seconds for the body), with the joints within each limb kept together.
Small movements settle sooner than a large swing.
The outgoing gait fades out over 0.06 seconds while still following travel speed, then the entry crossfades
into the Idle loop over 0.08 seconds. Wave-to-Idle uses the same eased settling.
`Land` and `LandHard` go straight into the Idle loop, because they already end in its pose.
When a fast reversal requests an animation still fading out, the latest request waits for that fade to finish
before reusing it. A third animation can interrupt a transition using the current outgoing influences, keeping
the combined weights at one. Finished outgoing actions are stopped.
The clip buttons preview animations in place at their original gait speed and also synchronize both gaits
during transitions. Stroll and Run laps start a circle from the current position and heading, without snapping
to a new radius.

Wave starts with a runtime `WaveEnter` clip that raises the arm from the current rendered pose over 0.5 seconds.
Its sampled `smootherstep` curve eases in and out, then crossfades into the original Wave loop over 0.12 seconds.
Idle and Wave entries share pose sampling. Interrupting either preserves the current pose; finished temporary
entry clips are uncached. The GLB and
Blender assets are unchanged.

The jump has three parts. A take-off clip pushes off; from its take-off moment the viewer flies the root up and
down under gravity (15 m/s²), and the clip's pose carries on in the air. When the take-off clip ends while Mnot is
still in the air, the `Fall` loop crossfades in. Touchdown picks the landing by impact speed and movement:
`LandHard` from 6 m/s (a fall of 1.2 m), `LeapLand` while moving, `Land` otherwise.

| Part | Standing | Walking or running | Long flight |
|---|---|---|---|
| Take-off | `JumpStart`, leaves the ground at 0.12 s | `LeapStart`, a quick dip on the take-off leg, leaves the ground at 0.12 s; covers the whole flight | |
| Air | `Fall` after 0.33 s | (still `LeapStart`) | `Fall` |
| Landing | `Land`, into Idle | `LeapLand`, into Walk or Run from time 0 | `LandHard`, into Idle |

The heights are 0.6 standing and walking, 0.8 running; the High jump button jumps 2.2 and lands hard. Jump
selection uses this frame's movement input, so pressing W + Space together starts a walking `LeapStart`; adding
Shift makes it a running one. In the air, releasing movement retains momentum and direction changes steer
gradually. Braking starts at touchdown. Moving cuts a soft `Land` short after 0.1 s; a `LandHard` holds Mnot in
place for 0.5 s before moving or jumping works again. A Space press up to 120 ms before a jump is allowed again
queues the next jump; holding Space does not repeat. Clip previews and waving wait until a jump has finished.
Losing window focus clears held input and horizontal velocity and fades active sounds out. The camera follows height changes with a short lag.

For browser regression checks, run `tools/check_controls.js` with Playwright MCP's `browser_run_code_unsafe`
`filename` argument while the server is running on port 5280. It returns pass/fail and measured evidence for
all 24 checks, including the three-part jump (a high jump through `Fall` into `LandHard`, a moving landing
carrying on walking from the heel strike), Run-to-Walk phase synchronization, Idle settling based on remaining limb travel, Wave easing and cleanup,
fast preview reversals, jumps interrupting gait transitions, equal diagonal speed, and consistent
movement/turning at 30, 60 and 120 fps. The harness uses a
manual clock on its test page; use a new browser tab afterwards to try normal playback.
Run `tools/check_sounds.js` in a fresh Playwright tab for real-time audio checks using trusted clicks and keys.

## In three.js

Load it with `GLTFLoader` and play clips with an `AnimationMixer`. Mnot faces +Z and is about 1.67 units tall.
The clips walk in place; move the character yourself at the speeds stored on the `MnotRig` node
(`userData.walk_speed` 0.625, `userData.run_speed` 2.083 units per second), so the feet don't slide.
`index.html` shows all of this, plus the toon look (`MeshToonMaterial` with a two-tone ramp and `OutlineEffect`,
and unlit lenses).

The jump clips jump in place too: the root stays on the ground, and the game lifts it. The take-offs and landings
play once (`LoopOnce`, with `clampWhenFinished` so you can crossfade out of the last pose); `Fall` loops.

| Clip | Use | Length (s) |
|---|---|---|
| `JumpStart` | Standing take-off: crouch, push off, tuck; ends in the `Fall` pose. | 0.33 |
| `LeapStart` | Take-off on the move: off the left foot, legs split, the arms open out and flap at the top, the right foot reaches for the ground. Long enough for a whole walking or running jump. | 0.8 |
| `Fall` | Loop in the air: pedalling feet, flapping arms. | 0.8 |
| `Land` | Soft landing on the toes, knees give, into the Idle pose. | 0.33 |
| `LeapLand` | Landing on the move, out of `LeapStart`: ends on the left heel strike, where `Walk` and `Run` start. | 0.23 |
| `LandHard` | Hard landing: a deep squash, glasses slam down, slow recovery into the Idle pose. | 0.8 |

`MnotRig` stores what the clips were made for, in seconds, metres and m/s: `userData.jump_takeoff` and
`leap_takeoff`, both 0.12 (when the feet leave the ground), `jump_gravity` 15, `jump_height` 0.6,
`run_jump_height` 0.8, and `hard_landing_speed` 6. The clips are sampled at 60 fps: the take-offs and landings and
`Fall` have a key on every frame; `Idle`, `Walk`, `Run` and `Wave` keep a key per 30 fps frame with straight lines
between.

## Bones

`root` › `body` (the can) › `glasses`, `upper_arm_L/R` › `forearm` › `hand`, `thigh_L/R` › `shin` › `foot`.
`_L` is Mnot's own left (+X). In the `.blend`, the non-deforming `foot_ik_L/R` and `knee_pole_L/R` (bone collection
"Controls") drive the legs; the export bakes them into the deforming bones.

## Animating it yourself

Open `models/mnot.blend`, select `MnotRig`, Pose Mode, and make a new Action in the Action Editor (keep the fake
user on). Then export from Blender: File › Export › glTF 2.0, format glTF Binary, Data › Armature › "Export
Deformation Bones Only", Animation mode "Actions".

Don't rerun `tools/build_mnot.py` after that: it rebuilds the `.blend` from scratch and would throw away your own
actions. Run it only to change the model itself:

```
blender --background --factory-startup --python tools/build_mnot.py -- models
```
