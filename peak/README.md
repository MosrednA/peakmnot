# Peak Mnot

"Peak Mnot" is the community's name for the moment the nerds dig far too deep into a detail. The game takes it
literally: Mnot climbs a mountain from base camp to the summit. Mnot jumps over gaps between ledges, hops over loose
ledges before they crumble, slides on ice, times jumps through wind gaps, rides a gondola, balances over planks and
a rope in the wind, and dodges falling rocks. The can itself is the health bar: every fall or hit dents it, and a
checkpoint pops the dents out again.

Play: `python tools/dev_server.py`, then open <http://127.0.0.1:5280/peak.html>. The title screen comes first: any
key, a click or Start begins the climb (`?manual` skips it).

| Key | |
|---|---|
| WASD / arrows | move. Right means "onwards" along the route, whatever the camera does |
| Shift | careful steps: Mnot stops at an edge instead of walking off. On a plank or rope it stands still |
| Space | jump. A running jump clears about 1 m of gap and 0.5 m of height |
| A / D on a plank or rope | lean back against the wobble |
| drag, wheel | look around and zoom. The camera eases back after a moment |
| trackpad: two-finger swipe, pinch | look around, zoom (the camera, not the page). `camera.js` tells a swipe from a mouse wheel by its first event |
| M | sound on/off |

On touch screens (`touch.js`, `touch.css`; they show on a coarse pointer or the first touch and hide at a key press):

| Touch | |
|---|---|
| Left thumb, anywhere on the left half | a floating stick: a full push runs, a small push is careful steps, a resting thumb stands still (Shift alone). It holds the keys it points at (8 ways), so onwards, the lane assist, leaning and the score replay work as with keys |
| Jump button, bottom right | Space |
| Tilt on a plank or rope | lean (A / D); let go and Mnot walks on |
| Drag elsewhere, pinch | look around (never round to the can's back), zoom |

Phones start at pixel ratio 1 with a 1024 shadow map, and on the lowest steps redraw the sun's shadows every other
frame (`post.js`); portrait gets a wider lens and a step back (`camera.js`).

## The rules

- **Dents.** A rock hit, a hard landing (about 2.7 m) or a fall into the abyss dents the can. A fall also brings
  Mnot back to the last safe spot.
- **Flattened.** The fourth dent flattens the can, and Mnot goes back to the last checkpoint.
- **Checkpoints.** The four flags pop all the dents out.
- **Jokes.** Every mishap shows a short joke (`quips.js`) and the dent count. A fall gets a joke about what caused
  it: a crumbled ledge, teetering too long, ice, a gust or a missed gondola.
- **Falling.** Off an edge with nothing left to land on, Mnot hangs in mid-air for a beat, legs still running, looks
  at the camera, and drops, tumbling and flailing, through the clouds far below (`fall.js`). Then the fade.
- **On the edge.** Left standing still right at the rim of a drop (the feet just past the edge), or shoved there by
  the wind, Mnot teeters: it turns to the drop and rocks out over it and back, arms wheeling, and goes over after
  1.1 s (sooner in a gust) unless you step back from the edge or hold Shift. Walking or running off, a run-up and a
  jump (also from a teeter), careful steps, step-downs, ice and anything moving never teeter (`teeter.js`).
- **Loose ledges.** A cracked chunk of rock on a point starts to shake when Mnot lands on it and drops away 0.85 s
  later (the first one, still in the tutorial, takes 1.3 s). It is back 3.2 s after that. Don't stop on one.
- **Ice.** Glossy blue patches with cracks and skid marks. Mnot keeps its speed and the keys only push a little, so
  stopping and turning take steering against the slide; each patch also tilts a little (the streaks run downhill)
  and creeps Mnot towards its low side, often an edge. Careful steps (Shift) grip, slowly. Pushing hard against the
  slide or across it, going too fast, a hard landing or a bump fills a wobble meter (the balance meter, while on ice):
  the can leans and shakes, the arms windmill. Full, and Mnot does a pratfall onto its back and slides on, up again
  after 0.85 s: no dent, unless the slide carries it over an edge. Small taps steer best (`skate.js`).
- **The ring.** Right after checkpoint 3 the way leads round a sinkhole on a ring of ice that slopes down into it
  (`ring.js`): on at a rock pad on the near side, round either way, off at the pad on the far side. Going straight
  slides Mnot into the hole or off the outside. Slowly does it: at about 1 m/s the pull into the hole does most of
  the turning, and small taps keep Mnot off the lips. The camera looks from high up in front here, so the keys are
  plain screen directions and down is onwards.
- **Wind gaps.** The wind funnels through a gap on a steady beat: a 3.4 s lull, 0.8 s building, 1.8 s blowing, 0.7 s
  dropping. A windsock beside it hangs limp in the lull and streams out in the gust, which blows a jump back.
- **Gondola.** A pallet on a cable shuttles up to checkpoint 2: it waits 1.8 s at each end and takes 3 s across.
  Mnot rides along standing on it; a jump off it keeps its speed.
- **Introductions.** Each trick shows up first where a slip costs little, with a tip the first time (`game.js`):
  base camp to checkpoint 1 stays gentle, checkpoint 1 to 2 mixes them, and the last stretch to the summit is
  hardest.

## High scores

At the summit a card shows the time, falls and dents, and the rank the climb would get; a name is optional (empty
becomes "Mystery Can #1234"). The best climb per browser stays on the board and only gets better; the name can
change every time. The trophy in the HUD and the title's Hall of Fame button open the board. Behind it is the score
server in [`server/`](../server/README.md), which checks every step of the recorded climb before a time counts:
start it next to the viewer with `python -X utf8 server/peak_scores.py`. Without it, or with `?manual`, the game
simply shows no scores. After changing the route or the rig's speeds, re-export `server/route.json` (see there).

Hall entries with a retained verified run offer **Race ghost** and **Watch run**. Racing starts a normal score-eligible
climb with a named ghost beside Mnot; it can be hidden with the on-screen toggle. Watching opens a spectator replay
with play/pause, restart, 0.5×/1×/2× speed and scrubbing. These pages use `?ghost=RUN_ID` and `?replay=RUN_ID` links;
the Hall buttons make them. The viewer does not run live physics, record a climb or submit scores. House entries and
entries whose replay is unavailable show why no replay action is offered.
The v1 viewer derives Mnot's animation and follow-camera motion from recorded position/state samples. A continuous
stride phase keeps the feet in step through speed changes; turns and clip changes ease instead of snapping. Beam
motion uses recorded positions (v1 stores zero beam velocity), with the live game's narrow stance and balancing arms.
Jump crouches use the rig's takeoff timing. Animation, heading and blends are evaluated at absolute replay time, so
pausing, changing speed and backward scrubbing reproduce the same pose. Watch run also rebuilds loose-ledge shaking,
drops and regrowth from the recorded support indices. V1 does not record the original camera gestures, balance lean
or ice pratfall poses, and the viewer does not recreate the snow and grit particle bursts. The gondola follows the
replay's stored phase in Watch run and the new climb's clock in Race ghost. Racing keeps the normal live ledge physics.

## Analytics

The public game uses cookieless Plausible at `stats.mosredna.eu`. The tracker in `peak.html` counts pageviews;
`analytics.js` listens to the title, game and player events for these custom goals:

| Goal name (exact, including capitals) | When |
|---|---|
| `Start Climb` | The title hands over to the player, once per page |
| `Checkpoint 1 Reached` | The first checkpoint is reached, once |
| `Checkpoint 2 Reached` | The second checkpoint is reached, once |
| `Checkpoint 3 Reached` | The third checkpoint is reached, once |
| `Summit Reached` | The climb reaches the summit, once |
| `Fall` | Mnot is lost into the abyss; each fall, without counting its respawn again |
| `Flattened` | The fourth dent flattens the can; each time |

The goals are configured under [Settings → Goals](https://stats.mosredna.eu/peakmnot.mosredna.eu/settings/goals),
with **Show in dashboard** enabled. Conversion counts appear after a matching event is received. When adding a
goal, create the matching **Custom event** in Plausible too: sending an event alone does not add a dashboard goal
([Plausible's guide](https://plausible.io/docs/custom-event-goals)).

Events before the climb or after the summit are ignored. Analytics sends no custom properties, names, player ids,
replays or scores. Only `peakmnot.mosredna.eu` is tracked; localhost, other hosts, the animation viewer and `?manual`
are excluded. Missing or blocked analytics does not stop the game. The production page's CSP allows only the
Plausible host in addition to its existing script and connection sources; inline scripts still require hashes.

Run `node --test tools/check_analytics.mjs` for the event checks and `python -m unittest discover server` for the
production CSP check.

## Modules

Each file starts with a comment on what it does. `main.js` builds the scene, wires the modules together
and runs the frame loop; `game.js` holds the rules and `audio.js` hooks up the sound. The rest sit in folders by topic,
each with its CSS next to it.

| File | What |
|---|---|
| `main.js` | Renderer, scene, light and frame loop; wires the modules together; builds every shader behind the preloader. `?manual` stops the loop for tests, `?perf` runs the perf probe |
| `game.js` | The rules: dents, checkpoints, respawns, the summit, a tip the first time each trick shows up |
| `audio.js` | Ties `sounds.js` (Codex) to game events |
| `analytics.js` | Plausible goals for public climbs; excludes development and manual tests |
| `replays/controller.js` | Loads a Hall replay and provides ghost-race or spectator controls; watched runs do not score |
| `replays/playback.js` | Validates and samples a recorded run, then creates its animated replay actor |
| `replays/motion.js` | Continuous stride phase, eased headings and deterministic clip blends for existing v1 runs |
| `replays/loose-ledges.js` | Reconstructs replay contacts with crumbling ledges from recorded support indices |

### `world/`: the mountain and what happens on it

| File | What |
|---|---|
| `world.js` | Keeps the mountain's solids (some moving or crumbling) and beams and answers the player's questions: the ground under a point, walls, beams, `railAt`. Also the things that move each frame (`animated`), what a bot should wait for (`hazards`) and the world's events |
| `route.js` | The climb as data: rocks, loose ledges, ice, the ring, the gondola, planks, the rope, checkpoints, signs, wind/snow/rockfall/wind-gap zones, the camera rail |
| `crumble.js` | Loose ledges: shake when landed on, drop away, come back |
| `ice.js` | Icy patches over a rock top, a rounded box (`icePatch`) or an arc of a ring (`iceArc`): a slab that tilts towards its drift, and a glossy glaze (a highlight that moves with the camera, cracks, skid marks, frost). An arc stays slippery a little past its lips, so a slide goes over the edge |
| `ring.js` | The ring: a rock with a sinkhole down the middle, two rock pads on its rim and ice between them, icicles and slowly turning mist in the hole. Its collision is convex pieces meeting on radial seams; `world.rings` tells the bots where it is |
| `beams.js` | How the board walk, planks and the tightrope look, fitted to the ledges they span (`world.js` keeps their collisions) |
| `movers.js` | The gondola: a pallet on a cable that shuttles between two ledges and carries Mnot along |
| `weather.js` | Wind gusts with a wandering direction, snow showers, and the wind gaps' steady beat |
| `rocks.js` | Rockfall: a growing warning shadow with pebbles trickling down onto it, then the rock, in a burst of snow and chips |

### `mnot/`: the can: moving, balancing, sliding, falling, dents and fidgets

| File | What |
|---|---|
| `mnot.js` | Loads `models/mnot.glb` and blends its clips (the jump parts and the fidgets play once); the rig carries its own speeds and jump timing |
| `player.js` | Running, careful steps, jumps, walls and ledges, riding what moves; hands over to `skate.js` on ice, to `balance.js` on beams, to `teeter.js` on the rim of a drop and to `fall.js` off the edge |
| `teeter.js` | Teetering on the rim of a drop when standing still or shoved by the wind: the `Teeter` clip, the can rocking out over the edge, the save (a step back or Shift) and going over |
| `balance.js` | The beam balance: an upside-down pendulum, tuned in `FEEL` |
| `skate.js` | Mnot on ice: the slide and its drift, the wobble meter, the lean, the pratfall, the shavings and the `skid` event |
| `fall.js` | The cartoon fall: the beat in mid-air, the look at the camera, the tumble down through the clouds, eased away from rock faces so the can never tumbles inside one |
| `pose.js` | Procedural pose on top of the clips: feet together on a beam, arms out and flapping and legs kicking when slipping or falling, arms windmilling and panicky steps on ice |
| `dents.js` | Dents as morph targets built at load time from the can's own meshes; they spring in and pop out |
| `moments.js` | For the eye only: idle fidgets (`PushGlasses` after a checkpoint, a close call on a beam or a save on the edge, `TapFoot` while waiting for the gondola or a ledge to grow back, `LookUp` at the climb ahead, a random one after 4–6 s), never on a beam, ice, a loose ledge or in the wind, cancelled by any input; the summit `Dance` and confetti; the Konami party (a faster `Dance` with a pirouette every bar, the disco ball, confetti, for 6.5 s or until Mnot moves on). It sets `player.idleClip`, the clip Mnot stands about in |

### `controls/`: keys, touch and the camera

| File | What |
|---|---|
| `input.js` | Keys turned into a move, relative to the camera's shot and the route (see below) |
| `konami.js` | The Konami code on the keyboard (up up down down left right left right B A), for the party in `moments.js` |
| `touch.js` | Touch controls (styled in `touch.css`): the floating stick, the Jump button, finger look and pinch, touch wording, the on-screen keyboard |
| `camera.js` | The follow camera: one shot per stretch, gliding between them; close-ups for a celebration, and its own shot for a fall |

### `look/`: the picture and the backdrop

| File | What |
|---|---|
| `post.js` | The picture after the scene: ink outlines and MSAA, bloom, the colour grade; adapts the pixel ratio |
| `look.js` | The shared toon look: stepped light and ink outlines |
| `materials.js` | The painted rock: sediment layers, cracks, lichen, dripping snow, the lip's ink line, haze; fine detail fades with distance so it never shimmers. Also the shared GLSL noise |
| `rockmesh.js` | The rock pillars' meshes: one closed surface each, with `aDrop` (metres below the lip) for the shader |
| `bursts.js` | Pooled toon bits: snow puffs, flakes, grit, stone chips, ice shavings off skidding feet, the poof in the clouds |
| `scenery.js` | Puts the backdrop together (no collisions): sky, clouds, the range and a few birds |
| `sky.js` | The sky dome (gradient, sun, glow, wisps), the sun's direction, and the sky GLSL the backdrop fades into |
| `clouds.js` | The cloud sea: toon puffs (one instanced mesh), the floor of cloud tops, gaps down to the valleys |
| `range.js` | The snowy peaks all round: ridges and gullies, snow caps, warm strata, blue with distance |

### `props/`: the things along the route

| File | What |
|---|---|
| `decor.js` | The props' front door: cairns, the snack stash, a bench, the lost mic; `dressRoute` fits the beams, turns signs to their stretch's camera and checks every prop's footing |
| `signs.js` | Trail signs on two posts behind the board (painted face, doodled back, snow on top), standing tall so they read over Mnot; the rockfall warning triangle |
| `flags.js` | Checkpoint flags (raised once reached), the summit flag in its cairn with a plaque and a golden can, wind pennants; the cloth prints read the right way round from both sides |
| `camp.js` | Base camp: the podcast's tent and table |
| `trailmap.js` | The trail map board at base camp, drawn from the route itself |
| `windsock.js` | The windsock beside a wind gap, showing its beat |
| `paint.js` | Canvas textures for the props: planks, chipped paint, hand lettering, doodles, nails |
| `wood.js` | Wood grain and twisted rope materials |
| `footing.js` | Props stand on rock: each lists its feet, and one that would stand over a gap, in a wall, on a board walk, a loose ledge or the gondola is nudged in toward its ledge's middle (with `?manual`, the console says so) |
| `fade.js` | Props between the camera and Mnot dissolve (a dither), so nothing hides the can |
| `disco.js` | The Konami party's disco ball: drops in on a string, spins, throws coloured beams and spots onto the rock, and glows round the screen's edges (not with reduced motion). No real lights, so no shaders compile |

### `ui/`: on the screen

| File | What |
|---|---|
| `hud.js` | Toasts (checkpoint, summit, tip, oops), the balance meter (on beams, and the wobble meter on ice), the respawn fade, the stats card with a can per dent |
| `title.js` | The title screen (styled in `title.css`): orbit shots round Mnot waving and fidgeting, rotating tips, How to play; the glide into the follow camera at the start. Resets `game.time` to 0 then |
| `quips.js` | The jokes for falls (by what caused them), rocks, hard landings, pratfalls and getting flattened |
| `preload.css` | The preloader in `peak.html`: a can with big glasses hopping while the code, the model and the shaders load; `main.js` lifts it once the first frame is on screen |

### `scores/`: the high scores (see `server/`)

| File | What |
|---|---|
| `scores.js` | The high scores: asks the score server for a run at the start, sends the splits and the recorded climb, the summit card with the name field (styled in `scores.css`) |
| `replay.js` | Records the climb for the server's check: Mnot's position, speed and state about ten times a second, the keys and the game's events |
| `leaderboard.js` | The Hall of Fame panel (the HUD trophy and the title's button), replay actions for eligible rows, and the board on the summit card; names go in as text only |
| `routedata.js` | The route as plain data for the server (`server/route.json`) and its fingerprint |

### `kit/`: the base every mini game is built on

The other mini games (the downhill so far) build on it; the climb has its own copies of the same things in `main.js`
and `ui/`. Its README ([kit/README.md](kit/README.md)) has the API, and the `mini-game` skill
(`.claude/skills/mini-game/`) the recipe for a new game.

| File | What |
|---|---|
| `stage.js` | The renderer, the scene, the camera, the ink, the post-processing and the light; the sun's shadow box follows the player |
| `warmup.js` | Every shader built behind the preloader |
| `loop.js` | The frame loop, the preloader lifted after the first frame, and `window.<game>` with `step()` for the tests |
| `hud.js` | The toast, a card popping in, the Sound button and the audio unlock |
| `title.js` | The title screen: the menu, the tips, any key or tap starts, the glide into the game's camera |
| `party.js` | The finish party's beat on the music, and confetti |
| `kit.css` | The HUD's look |

### `dev/`: for tuning and tests

| File | What |
|---|---|
| `bots.js` | Test players for tuning; nothing in the game imports it |
| `perf.js` | The perf probe for `peak.html?perf`: times how this computer draws the climb and sends the run to the server ([docs/performance.md](../docs/performance.md)) |
| `thanks.js`, `thanks.css` | The end of a perf run: Mnot dances on the summit, a card says thank you with a nerdy joke, and the raw numbers sit behind a button |

## Events

For sounds (`audio.js`), tips and jokes. Listen with `on(name, fn)`:

| Who | Event | When |
|---|---|---|
| `player` | `jump` | a jump |
| | `land` `{ hard, impact, beam }` | landing; `impact` is the speed down |
| | `beam` `{ beam }`, `slip` | stepping onto a plank or rope; toppling off it |
| | `ice` | stepping onto ice |
| | `skid` `{ speed }` | a skid starts on ice: sliding with the feet planted, or pushing across or against the slide |
| | `pratfall` | the wobble meter on ice is full and the feet go: Mnot lands on its back |
| | `teeter`, `steady` | Mnot starts teetering on the rim of a drop; a step back or Shift saves it |
| | `lost` `{ reason, cause }` | the abyss (`reason` `'fall'`, `cause` `'crumble'`, `'teeter'`, `'gust'`, `'ice'`, `'gondola'` or `'fall'`) |
| | `drop` | the beat in mid-air is over and the can starts to drop (`player.hang` counts the beat down) |
| | `party` `{ seconds }`, `partyover` | the Konami code's disco starts (at most `seconds` long, 125 beats a minute); it's over |
| `world` | `crack` / `crumble` / `regrow` `{ at, solid }` | a loose ledge starts to shake / drops away / is back |
| | `gondola` `{ at, moving }` | the gondola sets off (`moving` true) or docks |
| | `gust` `{ at, zone }` | a wind gap's gust starts to build up |
| `game` | `dent` `{ reason, from, dents }`, `pop` | a dent; the dents popping out |
| | `checkpoint`, `summit`, `respawn` `{ flat }` | |
| `rocks` | `onImpact(fn)`, `fn({ hit, at })` | a falling rock lands; `hit` when it got Mnot |
| `title` | `show` | the title screen comes up (page load; never with `?manual` or after a respawn). `body` has the class `title-up` while it's up |
| | `start` `{ how }` | the climb begins, as the camera's glide starts (`how`: `'move'`, `'pointer'`, `'key'` or `'button'`) |

## The camera and the controls

The front of the can with the glasses is Mnot's face, so the camera mostly shoots from in front or from the side,
never from behind:

- **The rail.** The route has a camera rail at the bottom of `route.js`: points along the walking line, each with a
  shot. `jump` is three-quarter from the front, for platforming. `side` is 2.5D along the cliff. `rockfall` is high
  up, to see the warning shadows. `bend` is more from the front, where the route turns left and the camera has the
  long way round. `ring` is high up and nearly straight in front, the hole in view, so Mnot comes round the ring
  facing the camera.
- **Where the camera sits.** It always stands on the route's right and glides from shot to shot. `railAt` blends
  the direction within 0.8 m of a corner, so turns are smooth. When Mnot turns sooner than the camera can follow and
  it sees much less of the face than its shot will, it swings faster (`hurry`).
- **Beams.** Planks and the rope are always shot from the front (`BEAM` in `camera.js`).
- **Celebrations.** A wave gets a close-up from the front (`CLOSE`); at the summit a wider one from the south
  (`SUMMIT`), looking across the wind so the summit flag streams across the shot beside Mnot.
- **The title screen.** While it's up, `title.js` moves the camera (orbit shots round Mnot, after the follow camera
  has placed itself). At the start it glides into the live follow camera over 1.5 s: it swings round Mnot, riding
  along as Mnot sets off, while its look point comes down to Mnot in the first half. The field of view stays.
- **Falls.** The camera stays by the ledge, rises and looks down over the edge to watch the can tumble into the
  clouds, pushes in a little on the beat in mid-air, then eases back to the rail.
- **Props in the shot.** Signs face their stretch's camera (`'camera'` as the yaw) and stand tall, the board above
  Mnot's head; anything left between the camera and Mnot dissolves (`fade.js`).

The controls follow the shot the camera is gliding to (`follow.heading`), not the camera itself, so they never flip
halfway while it swings round a corner or off a plank. On top of that, `input.js` swaps the screen axis closest to
the route for the route itself: right means exactly onwards, round corners too, even when the camera looks at the
path at an angle. Holding only that key also steers gently back to the walking line (lane assist), and a held key
keeps meaning onwards until it is let go or the camera swings too far round. Where the camera looks from nearly
straight in front (the ring), down is the screen axis closest to the route, so down means onwards there and the
other keys are plain screen directions.

## The picture

Late morning, high above a sea of clouds: a warm sun from the left-behind, a cool sky filling the shadows.

- **Passes** (`post.js`): the scene and OutlineEffect's ink go into one multisampled half-float buffer, a gentle
  bloom picks out the sun and the snow, and one grade pass adds it, tints shadows cool and highlights warm, rolls off
  highlights (colours below 0.9 stay as painted), adds a blue vignette and writes sRGB. `peak.render()` still draws
  the whole picture.
- **Quality adapts.** Pixel ratios 1.5 → 1.25 → 1 → 0.85 → 0.7 (never above the screen's): a step down after 1.5 s
  of slow frames (over 1/48 s), a step up after 6 s of quick ones, at most twice back up. The bloom goes below 1.
  `?manual` keeps the first ratio. `peak.post.ratio` shows the current one.
- **Backdrop.** Everything in the distance fades into the sky's own colour (`sky.js` shares its GLSL with
  `clouds.js` and `range.js`). The range keeps its tips around the horizon as seen from the route, so Mnot stands
  higher than nearly all of it; hero peaks sit where the camera looks on the way up (`HEROES` in `range.js`).
- **Cost:** on a desktop GPU about 1 ms a frame, less than `render()`'s JS (1.3–2.3 ms for 360–570 draw calls); on
  an integrated GPU at a retina laptop's size about 21 ms, nearly all pixels. Every shader is built behind the
  preloader (`main.js`), and the sky is drawn after the solid things so they hide its pixels. `peak.html?perf`
  measures any computer: see [docs/performance.md](../docs/performance.md).

## Tuning with the bots

Open `peak.html?manual`, then in the console:

```js
bots = await import('./peak/dev/bots.js')
bots.survey(peak, { delays: [0.3, 0.4, 0.5], tries: 5, anticipate: 0 })   // ~25 s
bots.cross(peak, 'rope', { delay: 0.4 })
bots.climb(peak, { seconds: 180 })                                        // the whole route, with a log
FEEL = (await import('./peak/mnot/balance.js')).FEEL                      // change values live, then survey again
```

A bot sees the lean `delay` seconds late, like a person. Each crossing takes about half a second; keep one console
call under about 45 s.

The current balance, as `bots.survey` reports it (crossings out of 5):

| Reaction time | plank | rope | steep plank |
|---|---|---|---|
| 0.3 s | 4–5 | 5 | 5 |
| 0.4 s | 5 | 5 | 5 |
| 0.5 s | 5 | 1 | 4 |

The plank is the tutorial, the rope is the real test, and the steep plank in the wind is the finale. The rope's
numbers move a little with the weather's gusts at the time.

`bots.climb` reaches the summit with no falls; how long it takes depends on where the gondola and the wind gaps
are in their beat when it gets there, and the dents along the way come from rocks (last run from base camp: 77.5 s,
no falls, one dent from a rock). It holds whichever key means onwards on the shot (right, or down at the ring).
Before a hazard it asks `world.hazards` whether to wait (`wait(pos)`): for the gondola to dock, for a lull in a wind
gap. On ice it counter-steers: it aims for 2 m/s onwards and back towards the line, presses the keys that push the
slide closest to that, and coasts while the wobble meter is over 0.55. On the ring (`world.rings`) it goes round the
shorter way to the far pad at 1.2 m/s along the middle of the ice, so the pull into the hole does most of the
turning, and takes careful steps while the meter is over 0.5.

## Testing by hand

`window.peak` holds the modules (with `title` and `moments`) and the renderer, plus `step(seconds)`, `render()` and `key(code, down)`. `bots.look(peak, [x, y, z], yaw)` puts Mnot somewhere with the camera on its shot there. For example:

```js
peak.player.spawn(new peak.THREE.Vector3(0.4, 4.3, 33.7), 0)   // checkpoint 2, before the rope
peak.follow.snap(peak.player, peak.world)
peak.key('KeyD', true); peak.step(2); peak.key('KeyD', false)
```

Between `bots.climb` runs, reset with `player.celebrate = 0`, `game.done = false`, `game.time = 0`,
`game.falls = 0`, `game.popDents()` and `game.checkpoint = world.checkpoints[0]`.

`tools/check_gondola.js` (a Playwright snippet, like `tools/check_controls.js`) rides the gondola on uneven steps
(1/60 s and 1/120 s, 1/30 s and 1/240 s): the carry must be the pallet's own speed, and a jump off it may gain no more
than the pallet's climb, or the score server rightly rejects the climb.
