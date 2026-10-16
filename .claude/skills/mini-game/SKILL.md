---
name: mini-game
description: The recipe for a new Peak Mnot mini game, or a big change to one - the premise and the vibe, the page and its folder, the shared kit (stage, loop, HUD, title screen, finish party, controller, stats, levels), effects, sound and music, high scores with the Hall of Fame's ghost and replay, stats and their Plausible goals, the production build, performance and its ?perf probe, phones and controllers, tests and checks, and who does what. Use when making a new mini game, or when adding a title screen, finish party, HUD, sound, scores, controller support, stats or a page to one.
---

# A new mini game

Peak Mnot is a handful of mini games in one world: the climb (`peak.html`, `peak/`), the office-chair downhill
(`downhill.html`, `peak/downhill/`) and Reaction Run (`emoji.html`, `peak/emoji/`), and more to come. They share
the mountain, the look, Mnot, the HUD and the score server, so each new one feels like family and is built from the
same base. This is the recipe. Read
[docs/agents.md](../../../docs/agents.md#the-mini-games) first (the rules for every game, the team) and
[peak/kit/README.md](../../../peak/kit/README.md) (the shared base). The downhill is the worked example: when in doubt,
do what it does.

## 1. The premise and the vibe

- **One premise, lived all the way.** The climb is the nerds digging far too deep into a detail; the downhill is a
  €1,649 ergonomic office chair on a mountain, so knock-off chairs are the bowling pins and an office waits at the
  bottom. Every prop, sign, toast, tip and finish line comes out of the premise. Write it down in one sentence in the
  game's README before anything else, with the game's name and a tagline for the title.
- **The same world:** the range above the sea of clouds, the late-morning light, painted rock and snow, toon shading
  with ink outlines (`peak/look/`). A new place on the mountain, never a new style.
- **The same Mnot:** the model and clips from `models/mnot.glb` (`peak/mnot/mnot.js`), with the game's own poses on
  top in its own module (the downhill's `rider.js`). The glasses are the face: keep them in view.
- **The jokes:** short, dry, nerdy, true to the podcast; never grim. A fall is a pratfall. Signs and toasts talk
  about the premise ("Ergonomically certified for 0 km/h.").
- **The palette:** ink `#2b3352`, cream `#fff7e8`, red `#e23b2e`, teal `#22a98f`, gold `#ffc23d`, sky `#4aa8f0`,
  coral `#ff6a55`; the Fredoka font. They're CSS variables in `peak/kit/kit.css`.
- **Every shot is charming, in style, motivated by the story and clean**: nothing overlapping, clipping, floating or
  hiding Mnot (`.claude/agents/art-director.md`). The title shows the start, never the rest of the game: no spoilers.

## 2. The files

| File | What |
|---|---|
| `<game>.html` | The page: the stylesheets, `#preload`, `#hud`, `#title-screen`, `#finish`, the import map, the dev reload. From [templates/page.html](templates/page.html) |
| `peak/<game>/main.js` | The game: the stage, the world, the player, the camera, the HUD, the controls, the events and the loop. From [templates/main.js](templates/main.js) |
| `peak/<game>/title.js` | The title's shot and act, on the kit's `TitleScreen`. From [templates/title.js](templates/title.js) |
| `peak/<game>/party.js` | The finish party, on the kit's `Beat` (the downhill's is the example) |
| `peak/<game>/autopilot.js` | A test bot that plays the whole game through the same rules a player does |
| `peak/<game>/perf.js` | Its side of the perf probe (`peak/kit/perf.js`) for `<game>.html?perf`: where to time it, what's in its scene, the thank-you card's words and the party under it (step 8). From [templates/perf.js](templates/perf.js) |
| `peak/<game>/sfx.js`, `music.js` | The game's sounds and its variant of the climb's tune (Codex) |
| `peak/<game>/README.md` | The premise, the rules, the controls, the modules, who owns what, how to test. From [templates/README.md](templates/README.md) |
| `audio/<game>/` | Its effects, WAV masters and AAC `.m4a` (Codex) |
| `server/<game>.py`, `server/<game>.json` | Its high scores' checker and route (step 6); another level's route is `server/<game>-<level>.json` |
| `peak/<game>/playback.js` | Its replays for the Hall of Fame: a recorded run checked, watched on the game's own player and raced as a see-through ghost (step 6). The downhill's is the example |
| `peak/<game>/viewer.js` | Its tab in the animation viewer (`index.html`, live at `/viewer`): Mnot with what the game adds (the chair, the moves, the party), and a line in `GAMES` in `peak/viewer/tabs.js`. The downhill's is the example |
| `peak/<game>/analytics.js` | Its Plausible goals on the kit's `goals()`, each sent as `<Game>: <goal>` so a game's goals stay together. From [templates/analytics.js](templates/analytics.js), its check `tools/check_<game>_analytics.mjs` from [templates/check_analytics.mjs](templates/check_analytics.mjs) (step 6, "Stats") |
| `share-<game>.jpg` | Its link preview (Slack, Discord, WhatsApp): the title screen at 1200 x 630, a JPEG, with the logo, Mnot clear of it, and the tagline in place of the menu, linked from the page's `og:` and `twitter:` tags (the template has them), in `FILES` in `tools/build.mjs` and in the server test's list of plain files. The climb's `share.jpg` and the downhill's are the examples |
| `games.html`, `peak/games/<game>.jpg` | Its card on the page of all the games (`/games`), with `data-goal="Play <Game>"` (a `Games: Play <Game>` goal in Plausible too), in place of the "?" card or before it, and its shot from about a quarter of the way in (800 x 500, a JPEG, never the title or the finish: no spoilers) in `THUMBS` in `peak/games/main.js` |

**Every new game updates the page of all the games and the viewer**: a card and a shot on `games.html`, a tab in the
viewer, so neither is left showing only the games before it.

Also: one line in `PAGES` in `tools/build.mjs`, its own port in `.claude/launch.json` while it's being made (copy
the `downhill` entry), a row in the table in `docs/agents.md` ("The mini games"), and in `peak/README.md` if it adds
a shared module. A shared module that has to do more gets an option or an export, never a change in what the other
games see.

## 3. The base: the kit

`peak/kit/` is what every game has, so a new game never copies it from another one:

- `createStage()` for the renderer, scene, camera, ink, post-processing and light; `stage.aimSun(player)` each frame.
- `warmUp(scene, render)` once everything is in the scene, then `startLoop()`; `expose('<game>', …)` for the tests.
- `toaster()`, `pop()`, `soundSwitch()` for the HUD; `kit.css` for its look.
- `TitleScreen` for the title; `Beat` and `confetti()` for the finish party.
- `GamepadInput` and `PadMenu` (with `pad.css`) for the controller, which every game has (step 10).
- `goals('<Game>', { manual })` for its Plausible goals, which every game has too (step 6, "Stats").
- `probe()` (`perf.js`, with `thanks.js`) for `?perf`, which every game has as well (step 8, "Performance").

Change the kit only with an option whose default keeps every game as it is, and check every game (its README says
how).

## 4. The title screen and the finish party

- **The title** opens the game (never in `?manual`): the logo spelled in bobbing letters, a tagline card, one slow
  shot of Mnot at the start with something to watch (an act every few seconds: `PushGlasses`, `Wave`), the menu
  (Start, Hall of Fame, How to play, Sound), tips going round (premise jokes, each a real tip), "Press any key". Any
  key or tap starts; a movement key moves on that same frame. The camera glides into the game's camera. The HUD stays
  hidden until then (`title-up`). The title shows only the start: no spoilers of what's further on.
- **The finish** stops the clock, pops the finish card (`#finish`: the time, the game's own numbers, a verdict in the
  premise's words, how to go again) with confetti (`confetti(puffs, at)`) and the climb's wave sound, and starts a
  party: Mnot turns to the camera and dances on the music's beat (`Beat`, from `music.loopTime()`), in a loop of two
  bars that fits the premise (the downhill's lowrider hops, swivel spins and paper). The animator makes it.
- **Toasts** for the moments: the start, a checkpoint (`'checkpoint'`, mint), a mishap (`'oops'`, coral). A thing
  that happens often says its joke once (`toast.once`). Never two toasts over each other: check `toast.left`.

## 5. Effects, props and sound

- **Effects:** puffs, snow, chips, bits and debris from `peak/look/bursts.js` (pooled; the downhill's
  `obstacles.puffs`). Everything that flies comes down and goes away.
- **Props:** toon materials and ramps (`peak/look/look.js` `toon`, `RAMPS`), painted signs and labels
  (`peak/props/paint.js` `painted`, `letter`; `peak/props/signs.js`), ink outlines on (off for flat prints). Signs
  stand beside the way, face the player and say one joke.
- **Sound** is Codex's: brief it on the board and by message with the game's events (`ride.on('jump')` …) and what
  each should sound like. The game loads only its own sounds: `new MnotSounds({ effects: [...] })` picks which of the
  climb's effects it wants, `sfx.js` loads the game's own from `audio/<game>/` with `new URL('…', import.meta.url)`,
  AAC `.m4a` made by `tools/compress_audio.py`. The music is a variant of "Pocket Altitude" with a finish version;
  it waits for the first frame and the sound's unlock. The Sound button and the unlock are the kit's
  (`soundSwitch`).

## 6. High scores

A board of its own on the one score server (`server/README.md`, "Several games"):

1. the route as data (`peak/<game>/routedata.js`), exported by `server/export_route.py` (an entry in `GAMES`), and a
   checker `server/<game>.py` on `server/checks.py` that replays the run against the route and the game's physics;
2. a `Game` in `server/games.py` `load()`, with house records (so a fresh board isn't empty) and its words, and its
   name in `NAMES`;
3. the page, which the server then serves at `/<game>`;
4. in the game, `createRun()` and `createBoard()` from `peak/scores/scores.js` for `apiBase(location, '<game>')`, a
   recorder of the inputs, and the finish card's form; the Hall of Fame button on the title (`#hall-of-fame`);
5. tests: real recorded runs in `server/fixtures/<game>/` and the cheats the checker turns down;
6. **the Hall of Fame's ghost and replay**, from the start: `replays: true` in the board's words, so every run on it
   gets **Race ghost** and **Watch run**, and the climb's controls (`peak/replays/controller.js`) with the game's own
   player in `peak/<game>/playback.js`: `validate(replay, fingerprint)`, an actor that seeks to any moment of the
   run (`createActor`), and the page wired for `?ghost=ID` (a see-through copy of the player at the player's clock;
   no start until it has loaded) and `?replay=ID` (the page's own player on the recording, its events told again
   through the live handlers, so the sounds, toasts and finish card are the game's; nothing recorded or posted).
   The server's `Game.replay` lists the fields the replay endpoint gives (the inputs too, if they pose the player).
   A check routes the board and the replay API to a run its test bot rode (`tools/check_downhill_replays.js`,
   `tools/check_emoji_replays.js`);
7. **levels**, from the start, even with one: `const LEVELS = ['']` and `pickLevel(LEVELS)` (`peak/kit/levels.js`) in
   `main.js`, the level passed to the scores (`apiBase(location, '<game>', level)`) and to the replays, and the world
   built for it. On the server the first level is the game's own board, `/api/<game>/`, and each other one has its
   own, `/api/<game>-<level>/`, with its own route file (`export_route.py <game> <level>`) and its id in `LEVELS` in
   `server/games.py`. Links to a level, its Hall of Fame, a ghost or a replay keep its `?level=`, so a run is
   always raced and watched on the level it was ridden on.

The score-keeper does this. `?manual` sends nothing unless `&scores`; watching a run never does.

### Stats

Every game counts its visitors and its moments in cookieless Plausible, all on the one site `peakmnot.mosredna.eu`
([peak/README.md](../../../peak/README.md#analytics), "Analytics"):

1. the tracker in the page's head (the template has it): pageviews on the public site only, never in `?manual`;
2. `peak/<game>/analytics.js` from [templates/analytics.js](templates/analytics.js), on the kit's
   `goals('<Game>', { manual })` (`peak/kit/analytics.js`, null off the public site, so nothing even listens there):
   `Start` and `Finish` once a page, and the game's own moments, a checkpoint once and a mishap each time (the
   downhill's is the example). Only the goal's name: never names, player ids, times or scores;
3. its check, `tools/check_<game>_analytics.mjs` from [templates/check_analytics.mjs](templates/check_analytics.mjs),
   added to the analytics row in `docs/agents.md` and the command in `peak/README.md`;
4. its card on `/games` names `data-goal="Play <Game>"` (`peak/games/analytics.js` sends it as `Games: Play <Game>`);
5. every goal as a **Custom event** goal in Plausible, or the dashboard won't show it: in
   [Settings → Goals](https://stats.mosredna.eu/peakmnot.mosredna.eu/settings/goals), Add goal → Custom event, the
   event name exactly as sent (`My Game: Start`; pick "Create …"), the display name fills itself in. `Games: Play
   <Game>` too. With the user's go an agent does this in the user's own Chrome (Claude in Chrome, where they're signed
   in); otherwise list the goals for the user to add;
6. a look as if live before handing over: in Playwright, route `https://peakmnot.mosredna.eu/**` to the local score
   server (5294 serves the repository), set `window.__plausible = true` in an init script (the tracker skips
   automated browsers otherwise), and fulfil its POSTs to `https://stats.mosredna.eu/api/**` yourself, so the real
   tracker runs and nothing reaches the real stats. Each goal should show up once, at its moment.

## 7. The build

Development needs no build: the page loads the modules as they are, three.js from the import map. The live site is
`npm run build` (`tools/build.mjs`): one line in `PAGES` gives the page its own bundle, shared chunks and its CSS in
one file. Load every file from code with `new URL('…', import.meta.url)` so the build finds, hashes and copies it;
a file the page links by name goes in `FILES`. Check the built page: serve `dist/` with
`SITE_DIR=dist python server/peak_scores.py --static --port <free port>`, open `/<game>` and start a run: the server
takes it (201) only when the built page's route fingerprint is its own. The build renames functions and classes, so
never take data from a `.name` (the downhill's office did, and its live board took no runs until f3f5e8d).

## 8. Performance

What made the climb and the downhill smooth (`docs/performance.md`) comes with the kit; keep it that way:

- every shader built behind the preloader (`warmUp`): a thing that's hidden or not set up yet is in the scene for
  the warm-up; no new light in play;
- the adaptive post (`createStage`), so a slow GPU draws fewer pixels; never in `?manual`, for the tests;
- one material per look, shared; instanced meshes for the many (trees, rocks); pooled effects;
- nothing far ahead drawn when it's not needed (hide it by distance, as `obstacles.update` does);
- small AAC sounds, music after the first frame, the game's own assets only.

Every game has `?perf` from the start, as the climb and the downhill do: `<game>.html?perf` times how any computer
draws it and sends the run to the server, and `node tools/perf.mjs --game <game>` runs it headless. The game's side
is its `perf.js` (the template's: Mnot put at a few spots on the way to the flag); `main.js` treats `?perf` as
`?manual` and loads it. Its `board` is the game's on the score server, where the run goes; the server takes the runs
once `perf=True` is in the game's `Game` in `server/games.py`. Its spots are a handful (five or so keep the run to
about a minute), each a jump there with Mnot standing or parked, never a bot playing through: a bot can come off and
take the run with it. Pick them where the game is dearest to draw (the most in view, the effects); its `things()`
names what's in the scene, so the table says what costs.

Time it on the desktop GPU and on the integrated one (`--igpu --size 1512x945 --dpr 2`), and on a phone. A speed-up
that changes the picture is the art director's call. Compare shots pixel for pixel before and after.

## 9. Phones

The mobile agent's (`.claude/agents/mobile.md`): touch controls that need no buttons to learn (the downhill: drag on
the left half to steer, tap the right half to jump), `viewport-fit=cover` and the safe areas, the title's "Tap
anywhere", a portrait layout (the 560 px media queries), no browser gesture in the way (`touch-action: none` on the
canvas), and the audio unlocked by a real tap (`soundSwitch` listens to pointerup and touchend too).

## 10. The controller

Every game plays with a controller too, from the kit, so they all look and feel the same (the climb and the downhill
are the examples, `peak/main.js` and `peak/downhill/main.js`, both `readPad`):

- **Reading it:** `const pad = new GamepadInput()` (`peak/kit/gamepad.js`), and `pad.poll()` once a step. Then
  `pad.stick` (the left stick, y up, with `push` past the dead zone), `pad.dpad`, `pad.keys(held)` (the stick and the
  D-pad as the W A S D they point at, true for a light push), `pad.look` (the right stick as a camera drag, pixels a
  second, after the Camera and Look speed settings), `pad.down(b)`, `pad.value(b)` (the triggers, 0..1),
  `pad.fresh` (the buttons pressed this step, by `BUTTON`) and `pad.used`. Everything lets go while the page isn't
  in front. A key or a touch hands the hints back to them.
- **On the screen:** `const padMenu = new PadMenu(pad, { controls, help, press, settings, sounds })`
  (`peak/kit/padmenu.js`): the chip in the corner while one is connected (its name for a moment), the card behind it
  (the Menu button), and the page's hints in the controller's own buttons (A, ✕ or B; `pad.css` draws them): the
  help line, "Press A to …" (`press`), How to play. `controls` and `help` say what the buttons do, `[buttons, what]`
  (button names as in `glyphs()`). `settings` is `['rumble']`, plus `'invert'` and `'speed'` when the right stick
  turns a camera. Call `padMenu.update(dt)` right after `pad.poll()`: true means the controller went to the page this
  step (the card, the title's buttons, the Hall of Fame, the finish card), and the game reads nothing from it.
- **The same buttons everywhere:** the left stick and the D-pad move or steer; A is the game's one action (the jump);
  on the title A is Start, Y the Hall of Fame and X How to play; B closes; Y plays again; View switches the sound;
  Menu opens the card. The triggers are for what's analogue (the downhill's push and brake, the climb's zoom), the
  right stick looks around if the camera can. A controller press on the title starts the game the way a key does.
- **Rumble** at the moments that hurt or cheer: `pad.rumble('bump')` (a hard landing, a knock), `'hit'` (a crash, a
  lost wheel), `'cheer'` (the finish). Only while the controller is in use and Rumble is on.
- **The page** links `peak/kit/pad.css` after `kit.css`. A keyboard-only hint gets `class="key-only"`, and the
  controller's button beside it `<i class="pg pg-y pad-only"></i>` (the downhill's finish card).
- **The sound** can't start from a controller: browsers wait for a click or a key. The card and "Press A" say so
  while it waits.
- **Checks:** `tools/check_gamepad.js` plays every game with a fake controller; add the new game's buttons to it.

## 11. Testing and checks

- `?manual`: no title, no loop; `window.<game>.step(seconds, dt)` moves it the same way every time; `render()` draws.
  A test bot (`<game>.autopilot(true)`) plays it through.
- Deterministic shots: open `?manual`, seed `Math.random` before the page's scripts run, step to fixed spots,
  screenshot, and compare before and after a change that shouldn't change the picture.
- No errors in the console, on the title and while playing, nor while racing a ghost and watching a run.
- Before a commit, every check in [docs/agents.md](../../../docs/agents.md#checks-before-handing-over) passes, in
  every game the change touches, and the game's README says what changed.

## 12. Who does what

The specialists in `.claude/agents/` work on every game; a brief names the game (docs/agents.md, "A brief that
works"):

| Agent | In a new game |
|---|---|
| `level-designer` | The course or arena, its mechanics and physics, the test bot, the route export |
| `art-director` | Every shot: props, signs, the camera, the title's shot; checks the vibe |
| `look-dev` | The scene and light, materials, the page's CSS, the frame rate |
| `animator` | Mnot's poses and clips for the game, the title's acts, the finish party |
| `score-keeper` | The recorder, the server's checker and board, the finish card's scores |
| `mobile` | Touch controls, small screens, phones |
| Codex | Sounds and music |

Follow AGENTS.md: look first, patch in place, commit only your own files by name, keep line endings, and say on the
board what you're touching. Only the coordinator or the user pushes; a push to `main` deploys.
