# Mnot Games

**One mountain. One can. Several bad ideas.**

![Mnot at base camp, on the title screen](docs/title.webp)

Mnot is the mascot of [Met Nerds om Tafel](https://metnerdsomtafel.nl/), a Dutch podcast about nerd stuff. Among
its listeners, "Peak Mnot" is the moment the nerds dig far too deep into a detail. The first game takes that literally:
get Mnot from base camp to the summit (4,810 m, ish) over loose ledges, ice, wind gaps, a gondola, wobbly planks and a
rope, while rocks come down.

The can is the health bar. Every fall or hit dents it, the fourth dent flattens it, and a checkpoint flag pops the
dents back out. The fastest climbs go on the Hall of Fame.

The repository now holds several mini games in that same world, sharing Mnot, the look, the controls' kit and one
score server. Each game has its own rules, page and Hall of Fame.

**Choose a game at <https://peakmnot.mosredna.eu/games>.** The climb remains at the site's root.

| Game | Play | Rules and code |
|---|---|---|
| Peak Mnot | [Climb the mountain](https://peakmnot.mosredna.eu/) | [The climb](peak/README.md): loose ledges, ice, wind, a gondola and balancing |
| Mnot Downhill (prototype) | [Ride the office chair](https://peakmnot.mosredna.eu/downhill) | [The downhill](peak/downhill/README.md): steering, casters, pit stops, bowling and a ski jump |

The shared [animation viewer](https://peakmnot.mosredna.eu/viewer) shows Mnot's rig and clips, and the downhill's
chair, moves and finish party in its own tab.

| | |
|---|---|
| ![Mnot balancing on the rope over the abyss](docs/rope.webp) | ![Mnot dancing on the summit in the confetti](docs/summit.webp) |

## How to play

These are the climb's controls; the downhill's are [below](#on-the-office-chair).

| Key | |
|---|---|
| WASD / arrows | Move. Right means "onwards" along the route, whatever the camera does |
| Shift | Careful steps: Mnot stops at an edge instead of walking off, and stands still on a plank or rope |
| Space | Jump. A running jump clears about 1 m of gap |
| A / D on a plank or rope | Lean back against the wobble |
| Drag, wheel | Look around and zoom |
| Trackpad: swipe with two fingers, pinch | Look around, zoom |
| M | Sound on/off |

On a phone or tablet: a stick under your left thumb (wherever it lands; a light thumb or small push is careful steps, a
fuller push runs), the round Jump button on the right, drag to look and pinch to zoom.

With a controller (Xbox, PlayStation or Switch): the left stick or the D-pad moves (a light push is careful steps, as
is LB), A jumps, the right stick looks around, the triggers zoom, View switches the sound, and Menu opens a card with
the buttons and the settings (camera, look speed, rumble). A small controller chip in the corner shows it's
connected, and the hints show its buttons. The sound still wants one click or key: browsers don't let a controller
start it.

Loose ledges crumble shortly after you land on them, so don't stop there. On ice Mnot keeps sliding: small taps steer
best. Wind gaps blow on a steady beat, and the windsock tells you when. The full rules are in
[peak/README.md](peak/README.md).

### On the office chair

| Key | |
|---|---|
| A / D, arrows | Steer with the feet |
| W | Push off, then tuck in: faster, but less steering |
| S, Shift | Heels in the snow: brake |
| Space | Pull the height lever: the gas lift jumps |
| R | A new run from the top |

On a touch screen, drag on the left half to steer (up pushes, down brakes) and tap the right half to jump. With a
controller, the left stick or the D-pad steers, RT pushes off and tucks in, LT brakes, A pulls the lever and Y is a
new run. A hard hit or landing costs a caster, the pit stops put fresh ones on, and the bowling lane and the ski jump
take time off the clock. The full rules are in [peak/downhill/README.md](peak/downhill/README.md).

## Run it yourself

You need Python 3 and a browser with WebGL 2. Playing and changing the game needs no build and nothing to install:
the game is plain JavaScript modules, and three.js comes from a CDN through an import map.

```bash
python tools/dev_server.py
```

Then open <http://127.0.0.1:5280/games.html> to choose a game. The climb is `peak.html`, the downhill is
`downhill.html`, and the viewer is at `/` (`index.html`). The dev server reloads open tabs when watched code,
models or sounds change. For the high scores, start the score server next to it (it listens on port 5281, and the
games find it there):

```bash
python -X utf8 server/peak_scores.py
```

To serve all the source pages and their scores on one origin, with the same routes as production:

```bash
python -X utf8 server/peak_scores.py --static --port 5294
```

Open <http://127.0.0.1:5294/games>. The climb is `/`, the downhill `/downhill`, and the viewer `/viewer`. The
route table and shared modules are explained in [the multi-game guide](docs/multi-game.md).

The live site runs a production build of the same files: [esbuild](https://esbuild.github.io/) bundles and minifies
each page's code, three.js goes in a file of its own that browsers keep between releases, and every file is named
after its content. The Docker image makes the build itself. To try it locally you need Node.js too:

```bash
npm ci
npm run build
```

Then point the score server at the built site (PowerShell):

```powershell
$env:SITE_DIR = 'dist'
python -X utf8 server/peak_scores.py --static --port 8080
```

In a POSIX shell, use `SITE_DIR=dist python -X utf8 server/peak_scores.py --static --port 8080` instead.

Then open <http://127.0.0.1:8080/>, with the other pages at `/downhill`, `/games` and `/viewer`.
[`tools/build.mjs`](tools/build.mjs) explains what it does, including the one line that adds a new page.

## What's in here

| Path | What |
|---|---|
| [`peak.html`, `peak/`](peak/README.md) | The climb, plus the shared modules that came from it: the look, Mnot, props, input, scores and replays |
| [`peak/kit/`](peak/kit/README.md) | The base for new games: stage, loop, preloader, HUD, title, finish party, controller and analytics |
| [`downhill.html`, `peak/downhill/`](peak/downhill/README.md) | The second mini game, a prototype in the same world: Mnot down the mountain on a very expensive office chair |
| [`server/`](server/README.md) | One high-score server and SQLite database; each game's checker verifies runs for its own board |
| [`models/`](models/README.md) | The shared Mnot model, rig and animation clips, built from code in Blender |
| [`games.html`, `peak/games/`](games.html) | The page of all the games, at `/games`: cards, screenshots and navigation goals |
| `index.html`, `peak/viewer/` | The animation viewer, at `/viewer`: Mnot, and a tab for each game ([models/README.md](models/README.md)) |
| [`sounds.js`, `music.js`, `audio/`](audio/README.md) | Sound effects, and the music, "Pocket Altitude" |
| `tools/` | The dev server, the production build, the Blender build script, browser checks and the sound scripts |
| [`AGENTS.md`](AGENTS.md) | The house rules for the AI agents that work on this repository |
| [`docs/`](docs/README.md) | The documentation index: [multi-game setup](docs/multi-game.md), [the team](docs/agents.md), [making a level](docs/making-a-level.md) and [performance](docs/performance.md) |

## How it's made

- **Analytics.** Cookieless Plausible counts public visits, each game's milestones and game selection on `/games`.
  The goals and development exclusions are documented in [peak/README.md](peak/README.md#analytics).
- **three.js**, with toon shading and outlines. There's no framework, and the bundler (esbuild) only runs for the
  live site: in development the browser loads the modules as they are.
- **Mnot is built from code.** `tools/build_mnot.py` builds the mesh, the rig, the skin weights and every clip in
  Blender (5.2, in the background). Nobody edits the `.glb` by hand: change the script and rebuild.
- **Small files.** Every module stays under about 400 lines and does one thing, and each folder documents its own.
- **Test bots.** `peak.html?manual` stops the clock, and `peak/dev/bots.js` has test players that balance on beams,
  survey the jumps and climb the whole route; in `downhill.html?manual`, `downhill.autopilot(true)` rides the whole
  piste. `tools/check_controls.js` runs deterministic browser checks on the viewer, and `tools/check_replays.js` and
  `tools/check_downhill_replays.js` race and watch recorded runs in both games.
- **AI agents.** Most of it was written by AI coding agents (Claude Code and Codex) working side by side in this
  folder, steered by a human with opinions. [AGENTS.md](AGENTS.md) is how they keep out of each other's way, and
  [docs/agents.md](docs/agents.md) introduces the team. The specialists (a level designer, an art director and
  more) are in `.claude/agents/`, ready to put to work on your own idea.

## About the high scores

One server shares players and names across games, while each game keeps its own board and run checker. The climb
uses `/api/peak/`, the downhill `/api/downhill/`; both use the same submission protocol and SQLite database.

The score server doesn't take the browser's word for anything. The climb records each run, and the server checks
every step against the route and Mnot's physics: standing on rock that is there, never faster than its legs (or the
ice, the wind and the gondola) allow, flying on real parabolas, and reaching every checkpoint. Only then does the
time go on the board. The downhill's checker verifies the piste, chair physics, pit stops and bonus before its time
counts. See [server/README.md](server/README.md#several-games).

Every run on a Hall of Fame can be raced or watched back, in both games: **Race ghost** puts a see-through Mnot on
the recorded run beside yours, at your own clock, and **Watch run** plays it again with pause, half and double speed
and a timeline. Watching never posts a score; a ghost race is a run like any other.

Every game is made for more than one level, even while it has one: `?level=` picks it, and each level after the
first gets its own board, replays and route on the server (`/api/<game>-<level>/`). The first level keeps the game's
own board, so nothing moves when a second one arrives. See [the multi-game guide](docs/multi-game.md#levels).

Yes, you can read the anti-cheat; that's the point. If you find a hole in it, please open an issue rather than
posting 0:01. The server has a few surprises for people who try anyway.

## Contributing

Ideas, bugs and pull requests are welcome.

- **Keep it small.** One idea per pull request. Match the style of the file you're in by hand: no formatter over a
  whole file, and keep each file's line endings (`index.html` and `tools/build_mnot.py` use CRLF, the rest LF).
- **Changing Mnot:** edit `tools/build_mnot.py` and rebuild. See [models/README.md](models/README.md).

  ```bash
  blender --background --factory-startup --python tools/build_mnot.py -- models
  ```

- **Changing the route or making a level:** start with [docs/making-a-level.md](docs/making-a-level.md). The score
  server checks climbs against an export of the route, so re-export `server/route.json` after a change (the
  downhill's is `server/downhill.json`, and another level of a game gets a file of its own:
  `python -X utf8 server/export_route.py <game> <level>`).
- **Adding a mini game:** start with [the multi-game guide](docs/multi-game.md) and follow the
  [mini-game skill and templates](.claude/skills/mini-game/SKILL.md). Build on the shared kit, then register the
  page, card, viewer tab, score checker, analytics and link preview together.
- **Before a pull request:** climb the route with `bots.climb` in `peak.html?manual` (see
  [peak/README.md](peak/README.md#testing-by-hand)), ride the piste with `downhill.autopilot(true)` in
  `downhill.html?manual` if the downhill or shared code changed, and run the score server's tests:

  ```bash
  python -m unittest discover server
  ```

## Credits

- Mnot and the "Peak Mnot" meme come from the [Met Nerds om Tafel](https://metnerdsomtafel.nl/) podcast and its
  listeners.
- Built with [three.js](https://threejs.org) and [Blender](https://www.blender.org). The font is
  [Fredoka](https://fonts.google.com/specimen/Fredoka).
- The sound effects were generated with ElevenLabs. The music was rendered with
  [FluidSynth](https://github.com/FluidSynth/fluidsynth) and S. Christian Collins'
  [GeneralUser GS](https://schristiancollins.com/generaluser.php).

## License

The code is under the [MIT License](LICENSE). Mnot's model, the sounds, the music and the images are under
[CC BY-NC-SA 4.0](LICENSE-ASSETS.md): remix them freely, but not for commercial use. The names "Mnot", "Peak Mnot"
and "Met Nerds om Tafel" belong to the podcast. Fork away, but don't present a fork as the official game.
