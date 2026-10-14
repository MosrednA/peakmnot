# The multi-game setup

Mnot Games is a collection of mini games in one mountain world. Each has its own page, mechanics and score board,
while Mnot, the visual style and common game infrastructure are shared. The climb came first, so shared modules
still live under `peak/`; that folder name does not mean every module belongs only to the climb.

See [the documentation index](README.md) for the detailed references and [the front page](../README.md) to play or
run the project.

## Pages and routes

| Page | Source dev server (5280) | Score server with `--static` and production | Entry module |
|---|---|---|---|
| Choose a game | `/games.html` | `/games` | `peak/games/main.js` |
| Peak Mnot, the climb | `/peak.html` | `/` | `peak/main.js` |
| Mnot Downhill, prototype | `/downhill.html` | `/downhill` | `peak/downhill/main.js` |
| Model and animation viewer | `/` or `/index.html` | `/viewer` | `peak/viewer/main.js` |

The site's root still opens the climb. `/games` is the shared selection page, with a card and an in-game screenshot
for each game. `games.html` stores the links and `data-goal`; `peak/games/main.js` supplies the screenshots through
`THUMBS` and switches links to source filenames on the development servers (5280 and 5293).

The viewer starts with Mnot's rig and clips. Additional tabs show what a game adds: the downhill's chair, rider
moves and finish party. `peak/viewer/tabs.js` registers these in `GAMES` and loads each game's `viewer.js` on first
use. `#downhill` opens that tab directly. The climb uses the base Mnot tab.

`server/peak_scores.py` maps the public routes in `PAGES`; game names come from `server/games.py`. The build lists
the source pages separately in `PAGES` in `tools/build.mjs`. Development needs no build; production bundles each
page and shares common chunks, including three.js, between pages.

## Shared code and game ownership

| Location | Responsibility |
|---|---|
| `models/`, `tools/build_mnot.py` | One Mnot mesh, rig and set of clips; change the generator and rebuild |
| `peak/kit/` | Stage, shader warm-up, frame loop, preloader, test handle, HUD helpers, title, party beat, controller and analytics goals |
| `peak/look/`, `peak/props/` | Shared mountain look, scenery, materials, effects and reusable props |
| `peak/mnot/`, `peak/controls/` | Model loading and reusable input alongside climb-specific player and camera behavior |
| `peak/scores/` | Shared run submission, player identity and leaderboard, alongside the climb's recorder and route export |
| `sounds.js`, `music.js`, `audio/` | Shared audio infrastructure and palette; games keep their own sound hooks and music variants |
| `peak/downhill/` or `peak/<game>/` | A game's world, physics, camera, poses, title, finish party, recording and sound hooks |
| `server/` | One API and database, with a route export and replay checker for each game |

New games use [the kit](../peak/kit/README.md), as the downhill does. The climb predates it and still owns its stage,
loop, title and HUD implementation; it already uses the kit's controller. Do not assume every climb module is a
generic kit API. Import reusable pieces directly and keep a game's physics and rules in its own folder.

Every game keeps the same toon look, Mnot model, cream cards, Fredoka typography and dry podcast humor. Each has a
title screen, controls for keyboard, touch and controller, a Hall of Fame and a finish party. The premise decides
the props, jokes, sounds and mechanics; [the team guide](agents.md#the-mini-games) describes the style and ownership.

## Scores, stats and assets

One score server provides `/api/peak/` for the climb and `/api/downhill/` for the downhill. Players and names are
shared; runs and rankings belong to their game's board. The browser uses `createRun()` and `createBoard()` from
`peak/scores/scores.js`. Each game records its own run and exports its own route for its checker. See
[the server reference](../server/README.md#several-games) for registration and verification.

Every run on a board can be raced and watched from its Hall of Fame. `peak/replays/controller.js` is shared: it
loads `GET /api/<game>/replay/ID`, checks it with the game's `validate()`, and gives the page the controls (play,
pause, speed, the timeline, Back to Hall, Hide ghost). The player on the recording is the game's own: the climb's
`peak/replays/playback.js`, the downhill's `peak/downhill/playback.js` (passed as `createActor`). `?ghost=ID` races a
see-through copy at the player's clock; `?replay=ID` watches the run on the page's own player, and never records or
posts anything.

## Levels

Every game is made for more than one level, even while it has one. A level is a short id (`a-z`, `0-9`; `''` is the
first). The page keeps its ids in `LEVELS` in its `main.js` and picks one from `?level=` with `pickLevel()`
(`peak/kit/levels.js`); an id it doesn't have opens the first. On the server each level is a board of its own, with
its runs, replays and route: the first is the game itself (`/api/<game>/`, `server/<game>.json`, the climb's
`server/route.json`), so a game keeps its board when it grows a second level, and each other one is
`/api/<game>-<level>/`, checked against `server/<game>-<level>.json` and listed in `LEVELS` in `server/games.py`.
Links to a level, its Hall of Fame, a ghost or a replay keep its `?level=`, so a run is always raced and watched
on the level it was made on. Both games have one level for now.

Plausible counts pageviews on the same site and groups goals by game: `Climb: …`, `Downhill: …` and navigation
goals `Games: …`. New games use `goals('<Game>', { manual })` from `peak/kit/analytics.js`; the climb keeps its
original event names with prefixed display names to preserve history. Local and manual tests send no goals. See
[the analytics reference](../peak/README.md#analytics).

Load code-owned assets with `new URL('…', import.meta.url)` so the production build finds and hashes them. Page
assets linked by name, including `share-<game>.jpg`, go in `FILES` in `tools/build.mjs`. Keep exported route data
explicit: function and class names change under minification and must never determine an obstacle's identity.

## Adding a game

Follow [the mini-game skill](../.claude/skills/mini-game/SKILL.md) and its templates. A complete game includes:

1. `<game>.html` and `peak/<game>/`, with its own README, kit-based entry, world, player, camera, title and finish.
2. Keyboard, touch and controller support, sound hooks and a music variant, plus `?manual`, deterministic stepping
   and an autopilot that completes the course.
3. A route export, server checker, registration in `server/games.py`, board integration and recorded test fixtures,
   the Hall of Fame's ghost and replay (`peak/<game>/playback.js`), and `LEVELS` with `pickLevel()` from the start.
4. A page entry in the production build, a local preview entry in `.claude/launch.json`, and assets referenced in
   the form the build supports.
5. A card in `games.html`, its screenshot in `peak/games/` and `THUMBS`, and its navigation goal in Plausible.
6. A viewer module and registration in `peak/viewer/tabs.js`, plus the page's tracker, game goals and analytics check.
7. A link preview image, the page's Open Graph and Twitter tags, the build's plain-file entry and server coverage.
8. Updated documentation tables and the checks in [the team guide](agents.md#checks-before-handing-over), including
   regression checks for other games when shared code changes.

For another stretch of the climb, use [Making a level](making-a-level.md). For the downhill's course and physics,
use [its README](../peak/downhill/README.md). Their route exports and server checkers must stay in step with the game.
