# Peak Mnot

"Peak Mnot" is the community's name for the moment the nerds dig far too deep into a detail. The game takes it
literally: Mnot climbs a mountain from base camp to the summit. Mnot jumps over gaps between ledges, balances over
planks and a rope in the wind, and dodges falling rocks. The can itself is the health bar: every fall or hit dents
it, and a checkpoint pops the dents out again.

Play: `python tools/dev_server.py`, then open <http://127.0.0.1:5280/peak.html>.

| Key | |
|---|---|
| WASD / arrows | move. Right means "onwards" along the route, whatever the camera does |
| Shift | careful steps: Mnot stops at an edge instead of walking off. On a plank or rope it stands still |
| Space | jump. A running jump clears about 1 m of gap and 0.5 m of height |
| A / D on a plank or rope | lean back against the wobble |
| drag, wheel | look around and zoom. The camera eases back after a moment |
| M | sound on/off |

## The rules

- **Dents.** A rock hit, a hard landing (about 2.7 m) or a fall into the abyss dents the can. A fall also brings
  Mnot back to the last safe spot.
- **Flattened.** The fourth dent flattens the can, and Mnot goes back to the last checkpoint.
- **Checkpoints.** The four flags pop all the dents out.
- **Jokes.** Every mishap shows a short joke (`quips.js`) and the dent count.

## Modules

Each file starts with a comment on what it does. In order of the frame loop:

| File | What |
|---|---|
| `main.js` | Renderer, scene and frame loop; wires the modules together. `?manual` stops the loop for tests |
| `route.js` | The climb as data: rocks, planks, the rope, checkpoints, signs, wind/snow/rockfall zones, the camera rail |
| `world.js` | Keeps the mountain's solids and beams and answers the player's questions: the ground under a point, walls, beams, `railAt` |
| `rockmesh.js` | The rock pillars' meshes: one closed surface each, with `aDrop` (metres below the lip) for the shader |
| `materials.js` | The painted rock: sediment layers, cracks, lichen, dripping snow, the lip's ink line, haze. Also the shared GLSL noise |
| `beams.js` | How the board walk, planks and the tightrope look (`world.js` keeps their collisions) |
| `wood.js` | Wood grain and twisted rope materials |
| `decor.js` | Flags, signs, tent, cairns, wind pennants |
| `scenery.js` | Sky, the sea of clouds and the far peaks (no collisions) |
| `look.js` | The shared toon look: stepped light and ink outlines |
| `mnot.js` | Loads `models/mnot.glb` and blends its clips; the rig carries its own speeds and jump timing |
| `input.js` | Keys turned into a move, relative to the camera's shot and the route (see below) |
| `player.js` | Running, careful steps, jumps, walls and ledges; hands over to `balance.js` on beams |
| `balance.js` | The beam balance: an upside-down pendulum, tuned in `FEEL` |
| `pose.js` | Procedural pose on top of the clips: feet together on a beam, arms out and flapping when slipping or falling |
| `camera.js` | The follow camera: one shot per stretch, gliding between them |
| `weather.js` | Wind gusts with a wandering direction, snow showers |
| `rocks.js` | Rockfall: a growing warning shadow inside a ring, then the rock |
| `dents.js` | Dents as morph targets built at load time from the can's own meshes; they spring in and pop out |
| `game.js` | The rules: dents, checkpoints, respawns, the summit |
| `quips.js` | The jokes for falls, rocks, hard landings and getting flattened |
| `hud.js` | Toasts, the balance meter, the respawn fade, the stats line |
| `audio.js` | Ties `sounds.js` (Codex) to game events |
| `bots.js` | Test players for tuning; nothing in the game imports it |

## The camera and the controls

The front of the can with the glasses is Mnot's face, so the camera mostly shoots from in front or from the side,
never from behind:

- **The rail.** The route has a camera rail at the bottom of `route.js`: points along the walking line, each with a
  shot. `jump` is three-quarter from the front, for platforming. `side` is 2.5D along the cliff. `rockfall` is high
  up, to see the warning shadows.
- **Where the camera sits.** It always stands on the route's right and glides from shot to shot. `railAt` blends
  the direction within 0.8 m of a corner, so turns are smooth.
- **Beams.** Planks and the rope are always shot from the front (`BEAM` in `camera.js`).

The controls follow the shot the camera is gliding to (`follow.heading`), not the camera itself, so they never flip
halfway while it swings round a corner or off a plank. On top of that, `input.js` swaps the screen axis closest to
the route for the route itself: right means exactly onwards, round corners too, even when the camera looks at the
path at an angle. Holding only that key also steers gently back to the walking line (lane assist), and a held key
keeps meaning onwards until it is let go.

## Tuning with the bots

Open `peak.html?manual`, then in the console:

```js
bots = await import('./peak/bots.js')
bots.survey(peak, { delays: [0.3, 0.4, 0.5], tries: 5, anticipate: 0 })   // ~25 s
bots.cross(peak, 'rope', { delay: 0.4 })
bots.climb(peak, { seconds: 120 })                                        // the whole route, with a log
FEEL = (await import('./peak/balance.js')).FEEL                           // change values live, then survey again
```

A bot sees the lean `delay` seconds late, like a person. Each crossing takes about half a second; keep one console
call under about 45 s.

The current balance, as `bots.survey` reports it (crossings out of 5):

| Reaction time | plank | rope | steep plank |
|---|---|---|---|
| 0.3 s | 4–5 | 5 | 5 |
| 0.4 s | 5 | 5 | 5 |
| 0.5 s | 5 | 1 | 4 |

The plank is the tutorial, the rope is the real test, and the steep plank in the wind is the finale. `bots.climb`
reaches the summit in about 61 s with no falls; the dents along the way come from rocks.

## Testing by hand

`window.peak` holds the modules and the renderer, plus `step(seconds)`, `render()` and `key(code, down)`. `bots.look(peak, [x, y, z], yaw)` puts Mnot somewhere with the camera on its shot there. For example:

```js
peak.player.spawn(new peak.THREE.Vector3(0.4, 4.3, 33.7), 0)   // checkpoint 2, before the rope
peak.follow.snap(peak.player, peak.world)
peak.key('KeyD', true); peak.step(2); peak.key('KeyD', false)
```

Between `bots.climb` runs, reset with `player.celebrate = 0`, `game.done = false`, `game.time = 0`,
`game.falls = 0`, `game.popDents()` and `game.checkpoint = world.checkpoints[0]`.
