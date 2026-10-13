# Making a level

How the climb is put together, and how to change a stretch or build a new one. It's written for people and for agents
alike; the [`level-designer`](../.claude/agents/level-designer.md) agent works from it.

## The idea

The route is data. [`peak/world/route.js`](../peak/world/route.js) builds the whole mountain in one function,
`buildRoute(world)`, from base camp to the summit:

- **Rock pillars**: a flat top on a convex outline, about 70 m deep. The lip you see is exactly where the rock ends
  for Mnot, so what looks walkable is walkable.
- **Things on and between the rocks**: planks, a rope, loose ledges, ice, a gondola.
- **Zones** where something happens: wind, a wind gap, falling rocks, snow.
- **Checkpoints and the summit.**
- **Props**: signs, flags, the camp. `dressRoute(world)` at the end fits them onto their ledges.
- **A camera rail** at the bottom, which picks the shot for each stretch.

Everything else reads this data. The physics asks `world.js` what's under Mnot's feet. The trail map at base camp
draws itself from the route. The score server checks every climb against an export of it.

## Directions and units

- Metres and seconds. `y` is up.
- The route mostly climbs north (+z), with a cliff to the east (+x). Base camp is round the origin; the summit is at
  about (3, 8.4, 75).
- Yaw is in radians, and 0 faces +z. Props also take `'camera'` as a yaw: they turn to face their stretch's camera.

## What Mnot can do

Design with these numbers. The rig in `models/mnot.glb` carries the speeds and jumps (see
[models/README.md](../models/README.md)), and `peak/mnot/player.js` has the rest.

| | |
|---|---|
| Running | 2.08 m/s |
| Careful steps (Shift) | 0.625 m/s. Mnot stops at an edge instead of walking off |
| Running jump | Clears about **1 m of gap** and **0.5 m of height** |
| Standing jump | Peaks 0.6 m up |
| Gravity | 15 m/s² |
| Step up | Up to 0.26 m without a jump |
| Step down | Up to 0.32 m just walks down |
| Edge | The feet may stand 0.1 m past a rock's lip |
| Hard landing | A drop of about 2.7 m dents the can |
| Headroom | Mnot's collision is 1.6 m tall: a rock lower than that overhead is a wall |

The route keeps well inside the limits: **gaps of 0.6–0.9 m, rises of at most 0.4 m**. A gap a player only clears on
a perfect jump isn't fun on a phone.

## The building blocks

All of these are already imported in `route.js`.

| Call | What it makes |
|---|---|
| `rock(world, x0, x1, z0, z1, y, { chamfer, seed, rot })` | A rock pillar from its extents, its top at `y`. `chamfer` cuts the corners (default 0.3), `seed` picks its look, `rot` turns it (degrees) |
| `world.board(a, b, width = 0.8)` | A board walk: walk on it, no balancing |
| `world.plank(a, b, { width, wobble })` | A plank to balance on, from point `a` to `b` (its ends rest on ledges; `dressRoute` fits them). More `wobble`, more sway |
| `world.rope(a, b, { sag, wobble })` | A tightrope: it sags, dips under Mnot and swings in the wind |
| `looseLedge(world, x0, x1, z0, z1, y, { delay, gone })` | A loose ledge: it shakes when landed on, drops after `delay` (0.85 s) and comes back `gone` (3.2 s) later |
| `icePatch(world, x0, x1, z0, z1, y, { drift: [dx, dz] })` | Ice on top of a rock: Mnot slides, and `drift` creeps it towards a side (often an edge) |
| `ringRock(world, { center, inner, outer, y, pads })` | A ring of ice round a sinkhole, with rock pads to get on and off (`ring.js` explains the angles) |
| `gondola(world, a, b, feet, { travel, pause, offset })` | A pallet on a cable from `a` to `b`, the posts at `feet`; it waits `pause` s at each end and takes `travel` s across |
| `world.zone('wind', x, z, radius, strength)` | Windier here: the gusts sway the beams and can shove Mnot |
| `world.zone('gust', x, z, radius, strength, { y, yaw, offset })` | A wind gap: a steady beat of lull, gust and calm, blowing towards `yaw`. Put a `windsock` beside it so players can read the beat |
| `world.zone('rockfall', x, z, radius, strength, { minX, maxX, minZ, maxZ, top })` | Rocks fall in this box, each with a growing warning shadow first. Pair it with a `warningSign` |
| `world.zone('snow', x, z, radius, strength)` | Snow showers |
| `checkpoint(world, respawn, yaw, flagAt)` | A checkpoint: where Mnot comes back, which way it faces, and where its flag stands. They count in order; the first is base camp |
| `world.summit = { at, radius, flag: summitFlag(…) }` | The finish |
| `signpost(world, foot, 'camera', text, { size, width, height, bottom })` | A trail sign with a joke on it. Lines split on `\n` |
| `warningSign`, `windsock`, `pennants`, `tent`, `podcastTable`, `snackStash`, `trailMap` | More props (`peak/props/`). `onRock(world, foot, label)` puts a foot on the rock under it |

The camera rail comes last: `rail(x, y, z, shot)` adds a point on the walking line with one of the shots:

| Shot | For |
|---|---|
| `jump` | Three-quarter from the front: platforming |
| `side` | Side-on, 2.5D, along a cliff |
| `rockfall` | High up, to see the warning shadows |
| `bend` | More from the front, where the route turns left |
| `ring` | High and nearly straight in front, for steering round the ring |

The camera always sits on the route's right, so the way up runs to the right of the screen. It never shoots Mnot
from behind: the glasses are the face. Planks and the rope are always shot from the front (`camera.js`).

## A new stretch, step by step

The ledges east of checkpoint 1 were made like this.

1. **Sketch it in numbers.** List the ledges as `x0, x1, z0, z1, y`, with 0.6–0.9 m gaps and at most 0.4 m up
   between them (here gaps of 0.6–0.7 m, each 0.3–0.4 m up). Leave the checkpoint ledges where they are; the props
   and the score server rely on them.
2. **Add the rocks** in `route.js`, in order along the climb:

   ```js
   rock(world, 2.5, 4.3, 24.0, 25.2, 1.5);
   looseLedge(world, 4.9, 6.4, 24.4, 25.4, 1.9);
   rock(world, 7.0, 8.35, 24.2, 26.2, 2.3);     // into the cliff: no slot to slip down
   ```

3. **Give it a shot.** Add `rail(...)` points where the walking line turns or the shot should change. Here the
   route turns east, so `rail(3.4, 1.5, 24.6, shot.jump)` keeps the three-quarter shot along the new way.
4. **Add a sign** if it helps: beside the path, never between the camera and Mnot, with a short, dry, nerdy joke,
   like `signpost(world, v(x, y, z), 'camera', 'Loose rock ahead.\nDon\'t stand there\noverthinking it.')`.
5. **Try it** with the bots (below), then the whole climb.
6. **Export the route** for the score server (below), and update the rules in
   [peak/README.md](../peak/README.md) if a player needs to know something new.

## Rules of thumb

- **Teach, then test.** Each trick shows up first where a slip costs little: rock all round the first ice, a slow
  first loose ledge, the first wind gap narrow. Then use it for real higher up. Base camp to checkpoint 1 is the
  tutorial, and the last stretch to the summit is the hardest.
- **Telegraph everything.** A loose ledge looks cracked, a wind gap has a windsock, falling rocks cast a shadow first.
  The first time each trick shows up, `game.js` shows a tip (`teach(...)`).
- **Be generous.** Timing windows sized for people on a trackpad or a phone, not for bots.
- **No hairlines.** Where Mnot walks from one rock onto the next, let them overlap by a few centimetres. Where a
  ledge runs along a wall, put it right into the wall, so there's no slot to slip down.
- **Keep the lip honest.** Anything you build must look exactly as big as its collision.
- **Every mishap gets a joke** in `peak/ui/quips.js`: short, dry, nerdy ("Gravity 1, Mnot 0.").
- **Mind the length.** The test bot climbs the whole route in about 75–100 s; a person takes a few minutes.

## A new mechanic

Look at `crumble.js` (loose ledges) or `movers.js` (the gondola) for the pattern:

- **Collision.** A `Solid` (a convex outline with a top) or a `Beam` from `world.js`, pushed onto `world.solids` or
  `world.beams`.
- **A look that matches it.** `rockMesh(solid, rand)` paints rock like every other ledge. `wood(color, axis)` from
  `peak/props/wood.js` gives wood grain.
- **Moving every frame.** Push an object with `update(dt, time, weather)` onto `world.animated`.
- **Telling the bot to wait.** Push `{ wait: pos => … }` onto `world.hazards`.
- **Telling the rest of the game.** Emit an event (`world.emit('name', data)`) for sounds and tips, and list it under
  "Events" in [peak/README.md](../peak/README.md).
- **Moving Mnot in a new way** (a bounce, a push, a ride) is a change in `player.js` or its helpers. It's also a change
  for the score server: see below.

## Testing with the bots

Start the dev server (`python tools/dev_server.py`) and open <http://127.0.0.1:5280/peak.html?manual>. `?manual`
stops the clock and the live reload, so you step the game yourself. Then, in the console:

```js
bots = await import('./peak/dev/bots.js')
bots.look(peak, [0.4, 1.2, 24.6])          // Mnot at checkpoint 1, the camera on its shot; then take a screenshot
peak.key('KeyD', true); peak.step(1.5); peak.key('KeyD', false); peak.render()   // walk onwards for 1.5 s
bots.climb(peak, { seconds: 180 })         // the whole route, with a log of falls, checkpoints and dents
bots.survey(peak)                          // how players with quick and slow reactions do on each beam
```

Good spots for `bots.look`:

| Spot | |
|---|---|
| Base camp | `[0, 0, -0.6]` |
| Checkpoint 1 | `[0.4, 1.2, 24.6]` |
| The cliff ledges | `[7.7, 2.65, 27.6]` |
| Checkpoint 2, before the rope | `[0.4, 4.3, 33.7]` |
| Checkpoint 3, before the ring | `[0.4, 4.5, 42.4]` |
| The rockfall steps | `[0.4, 4.72, 51.0]` |
| The steep plank | `[2.7, 6.8, 64.95]` |
| The summit | `[3.0, 8.4, 75.35]` |

Between two `bots.climb` runs, reset the game:

```js
const { player, game, world } = peak
player.celebrate = 0; game.done = false; game.time = 0; game.falls = 0; game.popDents()
game.checkpoint = world.checkpoints[0]; player.spawn(world.checkpoints[0].respawn.clone(), 0); peak.follow.snap(player, world)
```

- **Teach the bot** your stretch if it can't get through. `bots.climb` holds "onwards", jumps at gaps and rises,
  balances on beams, waits for `world.hazards` and steers round the ring. It's a test tool, so it may know the
  mechanics. `server/browser_bot.js` steers the same way.
- **Look at it** from the camera at every new spot, and drag the view a little (`bots.look`'s `userYaw` and
  `userPitch`): nothing should float, clip or hide Mnot. With `?manual`, the console reports a prop that had to be
  moved onto its ledge.
- **Play it yourself** without `?manual`, on a keyboard and, if you can, on a phone.

## The high scores

The score server only believes a climb that holds up step by step against its copy of the route,
`server/route.json`. A route change therefore takes three more steps:

1. **Export the route.** Run `python -X utf8 server/export_route.py`, open `peak.html?manual`, and paste the line it
   prints into the console. Commit `route.json` with the route change. Until then the server answers "route changed"
   and the game hides the scores. The least time per stretch follows from the route by itself.
2. **Run the server's tests:** `python -m unittest discover server`. They replay recorded climbs, each on the route it
   was climbed on. After a big change one test skips until there's a fresh recording; `server/README.md` says how to
   record one with the browser bot.
3. **Teach the checker** about a new way to move. `server/verify.py` checks every step of a climb against the
   physics: standing on rock that is there, never faster than the legs, the ice, the wind or a ride allow, flying on
   true parabolas. If your mechanic moves Mnot in a way it doesn't know, every honest climb ends up in the Hall of
   Shame. Export what it needs in `peak/scores/routedata.js`, teach `verify.py`, and add a test.

## Your own mountain

To try a whole different route without touching the real one, copy `route.js` to a file of your own and point the
`buildRoute` import in `peak/main.js` at it while you play. Keep base camp's checkpoint first and a summit last. A
second mountain in the real game would need a way to pick one and a board per route; open an issue first, so we can
talk it through.
