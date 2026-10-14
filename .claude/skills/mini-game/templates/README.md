# My Game

TEMPLATE for `peak/<game>/README.md`: the downhill's (`peak/downhill/README.md`) is the full example.

The premise in one sentence: Mnot, the mountain, and the one idea every prop, sign, toast and tip comes out of. Then
a paragraph on what the game is: where on the mountain, what the player does, how it ends.

It's built on the mini game kit (`peak/kit/`) and shares the climb's look, Mnot and the score server.

| Key | |
|---|---|
| WASD / arrows | walk |
| R | start again |
| M | sound on/off |

| Touch | |
|---|---|
| … | … |

## The rules

What counts, what costs, how a run ends, what the clock does.

## High scores

The board at `/api/<game>/`: what's recorded, what the checker (`server/<game>.py`) checks, the house records.
The Hall of Fame's Race ghost (`?ghost=ID`) and Watch run (`?replay=ID`): what the ghost is and what watching shows.
The levels (`LEVELS` in `main.js`, `?level=`): one for now, each other one with its board `/api/<game>-<level>/`.

## Modules

What it shares with the other games, imported and never copied: the kit (`peak/kit/`), the look (`peak/look/`),
Mnot (`peak/mnot/`), the keys (`peak/controls/input.js`), the sound switch (`sounds.js`) and the high scores
(`peak/scores/`).

| Module | What |
|---|---|
| `main.js` | The page: the stage, the world, the player, the camera, the HUD, the controls, the events and the loop |
| `title.js` | The title screen: the shot at the start and Mnot's act |
| `party.js` | The finish party, on the music's beat |
| `perf.js` | The perf probe's side of the game, for `mygame.html?perf` (`peak/kit/perf.js`, `docs/performance.md`) |
| `autopilot.js` | A test bot that plays the whole game through the same rules |
| `playback.js` | The Hall of Fame's replays: a recorded run checked, watched and raced as a ghost |
| `sfx.js`, `music.js` | The game's sounds and its variant of the climb's tune (Codex) |

## Who owns what

| Agent | Its files in `peak/<game>/` |
|---|---|
| `level-designer` | … |
| `art-director` | … |
| `look-dev` | … |
| `animator` | … |
| `score-keeper` | … |
| `mobile` | … |
| Codex | `sfx.js`, `music.js`, `audio/<game>/` |

## Testing

- `<game>.html` opens on the title; `<game>.html?manual` skips it and stops the frame loop. In the console,
  `<game>.step(seconds, dt)` steps it (pass `dt`: a hidden tab has none of its own) and draws a frame;
  `<game>.render()` draws one.
- `<game>.autopilot(true)` lets the test bot play it through.
- `<game>.html?perf` times how this computer draws it and sends the run to the server; `node tools/perf.mjs --game
  <game>` runs it headless (`docs/performance.md`).
- `<game>.html?manual&replay=ID` watches a run step by step, `?ghost=ID` races one; `tools/check_<game>_replays.js`
  checks both on a run the test bot rode.
- Check the console for errors after every reload, and look at the title, the start, a mishap and the finish party.
