# Mnot Downhill

The second mini game, in the same world as the climb: Mnot rides a very expensive ergonomic office chair down the
mountain, from just below the summit to a finish above the clouds. The chair rolls on five casters with nothing
scripted: gravity, the snow and Mnot's heels do the steering, and the gas lift is the jump. On the way down: a
slalom through rocks, a kicker over a crevasse, ice in a bend, moguls, rollers that throw a fast chair into hops (after
the pit stop at 488 m and after the river), a river in a gorge with ice floes to hop, a bowling lane with ten knock-off
chairs as pins, a ski jump with a K line, and an office at the bottom. The moguls and rollers reach over the banks and
rocks lie in the banks here and there, so the banks are no smooth way round. Pines line the run, and the forest stands
right across it: their branches only slow the chair and bend it off the trunk, needles fly and a few cling to Mnot,
and a pine's bird may land in the can's lid, dazed, before it flies off. It's a prototype. The production build has it
(`tools/build.mjs`), and the score server serves it at `/downhill`, next to the climb at `/`.

Play: `python tools/dev_server.py`, then open <http://127.0.0.1:5280/downhill.html>. The `downhill` entry in
`.claude/launch.json` serves the same folder on port 5293, for an agent that wants its own server. With the high
scores: the `games` entry runs the score server with both games on port 5294 (data in `data/local/`), so
<http://127.0.0.1:5294/downhill> is the downhill as it is in production; a page on 5293 talks to that server too.

| Key | |
|---|---|
| A / D, arrows | steer with the feet |
| W | push off, then tuck in (faster, less steering) |
| S, Shift | heels in the snow: brake |
| Space | pull the height lever: the gas lift jumps |
| R | a new run from the top |

On a touch screen: drag on the left half to steer (up pushes, down brakes), tap the right half to jump.

With a controller (the kit's, `readPad` in `main.js`): the left stick or the D-pad steers (up pushes, down brakes), RT
pushes off and tucks in, LT brakes, A pulls the lever, Y is a new run, View the sound, Menu the controller's card.
It rumbles at a hard landing or knock, a lost wheel, a fall and the finish.

## The rules

- The clock starts at the gate (12 m down) and runs to the finish line at 1055 m, also while the chair is out after
  a fall, so a spill costs its time.
- Five casters. A hard hit (a rock, a pine's trunk, a pole, the office furniture, a wall of the gorge) or a hard
  landing takes one; with none left the chair is wrecked. The pit stops (at 178, 306, 488 and 760 m) put fresh
  casters on, and a fall or a wreck starts again at the last one passed.
- Time off the clock (`bonus.js`): a strike takes 5 s off, a spare (7, 8 or 9 pins down) 1.5, 2 or 3 s, and the ski
  jump 0.2 s a metre past 20 m, twice that past the K line at 50 m. A run counts its best bowl and its longest jump
  once.
- The board time is the clock less the bonus. Spills and lost wheels are counted and shown, like the climb's falls and
  dents.

The piste and where everything is along it are in `FEATURES` at the top of `track.js`.

## High scores

On the climb's score server, the same one (`server/README.md`, "Several games"): its own board under
`/api/downhill/`, the same player and name as on the climb's. `scores.js` uses the climb's run and board
(`createRun`, `createBoard` in `peak/scores/scores.js`) with the downhill's words. A run starts at the gate,
reports each pit stop as a split and sends the recorded run (`record.js`) at the finish, with the clock, the bonus,
the board time, the spills and the lost wheels; the server adds the bonus up again from the run and checks every
step against the piste and the chair's physics (`server/downhill.py`). The Hall of Fame starts with ten slow, silly
house records (`DOWNHILL_HOUSE` in `server/games.py`).

Every run on the board can be raced or watched from the Hall of Fame, as on the climb (the controls are
`peak/replays/controller.js`, shared): **Race ghost** (`downhill.html?ghost=ID`) rolls a see-through chair with Mnot
on it down the recorded run, at the player's own clock from the gate, and no start until it has loaded; **Watch run**
(`?replay=ID`) moves the page's own chair along it, with play, pause, half and double speed and a timeline. The
watched run is the live game's, told again: its sounds, puffs, toasts, lost casters, knocked-over props, bowling
score and finish card come from the same handlers, and past the finish the physics roll the chair out, heels down,
for the party. `playback.js` does the playing: `validate()` turns away a replay of another version or another piste,
`Recording` answers where the chair was at any moment (on the curve through each pair of samples' positions and
velocities, never across a put-back), `Driver` puts a ride there and tells its events in the order the physics do,
and `Ghost` is the see-through chair. Watching never records or posts a run; a ghost race is a run like any other.

The downhill has one level for now, and is ready for more (the kit's `levels.js`): `LEVELS` in `main.js` lists them,
the page picks one from `?level=`, and each other level has its own board, replays and route on the server
(`/api/downhill-<level>/`, `server/downhill-<level>.json`). The first level keeps `/api/downhill/`.

After changing the piste, its obstacles, the chair's feel or the bonus, export the route again, or the server
answers "route changed" and the game hides the scores:

```sh
python -X utf8 server/export_route.py downhill
```

and paste the line it prints into the console of `http://127.0.0.1:5280/downhill.html?manual` (another level:
`export_route.py downhill <level>`, which names the page with its `?level=`). A change to the
physics in `ride.js` may need `server/downhill.py` to follow: `python -m unittest discover server` replays the
recorded rides in `server/fixtures/downhill/`.

## Analytics

The climb's way ([peak/README.md](../README.md#analytics)): cookieless Plausible, on the public site only, the tracker
in `downhill.html`'s head for the views of `/downhill`, and `analytics.js` for the goals. Each starts with
`Downhill: `, so the downhill's goals stay together in the dashboard:

| Goal (event and display name) | When |
|---|---|
| `Downhill: Start` | The title hands over to the rider, once per page |
| `Downhill: Pit Stop 1` … `4` | Each pit stop, in a run that went through the gate; once per page each |
| `Downhill: Finish` | The finish line, once per page |
| `Downhill: Wrecked` | The chair is wrecked; each time, in a run |
| `Downhill: Off-Piste` | Mnot is lost off the piste; each time, in a run |
| `Downhill: Splash` | Mnot is lost in the river; each time, in a run |

A run is on from the gate to the finish, again after R; the party after the finish counts nothing. No names, times or
scores; localhost, other hosts and `?manual` send nothing. `node --test tools/check_downhill_analytics.mjs` checks
them.

## Modules

What it shares with the climb, imported and never copied: the backdrop and the post-processing (`look/scenery.js`,
`look/post.js`, `look/materials.js`, the gorge's painted rock), Mnot and its clips (`mnot/mnot.js`, `mnot/pose.js`),
the keys (`controls/input.js`), the sound switch and its unlock (`sounds.js`, which loads only Mnot's wave of
the climb's effects here), and the high-score helpers, the summit card and the Hall of Fame (`scores/scores.js`,
`scores/leaderboard.js`, `scores/scores.css`, in the downhill's own words). A shared module that has to do more gets
an option, and the climb behaves exactly as before. The stage and its light, the frame loop and the preloader, the
toast, the Sound button, the title screen's base, the party's beat and the confetti, and the HUD's CSS are the mini
game kit's (`peak/kit/`).

| Module | What |
|---|---|
| `main.js` | The page: the stage (`kit/stage.js`), the HUD, the controls, the events and the frame loop (physics at 120 Hz). The ski jump's photo, developed without waiting for the GPU (`develop()`). `?perf` runs the perf probe |
| `track.js` | The piste: a centreline sampled every half metre, the cross-section (dish, banks, powder, the drop), the features, and `ground(x, z)`, which the physics and the snow mesh both use |
| `ride.js` | The chair's physics: rolling, steering, braking, the jump, flights, the seat's swivel, crashes, lost wheels and falls; its events drive everything else |
| `chair.js` | The office chair's model and its pose (the base, the casters, the gas lift, the seat); at a pit stop the fresh casters fly in and pop on |
| `rider.js` | Mnot on the chair: the sitting pose on top of the clips, flopping legs, braking heels, flailing arms |
| `obstacles.js` | What stands on the piste (rocks, pines, snowmen, poles, signs, banners) and the debris that flies off it |
| `birds.js` | A pine's bird: out of the branches onto Mnot's head (the perch in `rider.js`), dazed, then off ahead of the chair; and the needles that cling to Mnot a moment |
| `office.js` | Office furniture: the knock-off chairs, cabinets, desks, the printer, water coolers and plants |
| `bowling.js` | The ten knock-off chairs as bowling pins, knocking each other over, and the score |
| `marks.js` | Paint on the snow: the bowling lane and the ski jump's distance lines (`K_LINE`) |
| `title.js` | The title screen, on the kit's `TitleScreen` (`peak/ui/title.css`): one slow shot of the chair at the top, the seat swivelling round to Mnot, and the props round the start (the box, the receipt, a plant, a water cooler) |
| `camera.js` | The chase camera, the river's higher shot, the finish framing |
| `party.js` | The finish party, on the music's beat (the kit's `Beat`) |
| `bonus.js` | Time off the clock for the bowling and the ski jump |
| `record.js`, `scores.js`, `routedata.js` | The high scores: the recorder, the server talk and the card, the route as data for the server |
| `playback.js` | The Hall of Fame's replays: a recorded run checked, played back on the page's own chair (Watch run) or on a see-through one (Race ghost) |
| `autopilot.js` | A test rider that rides the whole run through the same physics |
| `perf.js` | The downhill's side of the perf probe (`kit/perf.js`) for `downhill.html?perf`: the autopilot rides the run, timed stretch by stretch; what's in the scene, the thank-you card's words, and the finish party under the card ([docs/performance.md](../../docs/performance.md)) |
| `analytics.js` | The Plausible goals of public rides (above); excludes development and manual tests |
| `viewer.js` | The downhill's tab in the animation viewer (`index.html`, `/viewer`): Mnot on the chair, its moves and the party |
| `sfx.js`, `music.js` | The chair's sounds and the downhill's variant of the climb's tune (Codex) |

## Testing

- `downhill.html` opens on the title; `downhill.html?manual` skips it and stops the frame loop. In the console, `downhill.step(seconds, dt)` steps it (pass `dt`, a
  hidden tab has none of its own) and draws a frame; `downhill.render()` draws one.
- `downhill.autopilot(true)` lets the test rider go: it rides the whole run in about two minutes on the clock, with a
  fall or two. `downhill.autopilot(false)` after the finish lets the party start.
- `downhill.html?manual&scores` records and talks to the score server while you step it: step in real time
  (the server's clock bounds a run), say `downhill.step(0.1, 1 / 60)` every 100 ms.
- `downhill.html?manual&replay=ID` watches a run step by step (`downhill.replays` is the controls, `downhill.watch`
  the recording and its driver); `?ghost=ID` races one (`downhill.ghost`). `tools/check_downhill_replays.js` checks
  both with the dev server on 5280 and no score server: the autopilot rides a run, and the Hall of Fame and the
  replay API are routed to it (the chair on the recording, every event told once, jumps in time, pause and speed,
  the finish, a link that can't play, the ghost on the player's clock).
- `downhill.html?perf` times how this computer draws the ride (about two minutes) and sends it to the server, as
  the climb's `?perf` does; `node tools/perf.mjs --game downhill` runs it headless and prints the table
  ([docs/performance.md](../../docs/performance.md)).
- `downhill.restart()` is a new run from the top; `downhill.ride`, `downhill.track` and `downhill.chase` are there
  to look at.
- Check the console for errors after every reload, and look at the start, a fall, the river, the ski jump and the
  finish party.
