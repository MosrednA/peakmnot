# The mini game kit

What every mini game is built on, so a new one starts from the same base as the others: the stage and its light,
the frame loop and the preloader, the handle for tests, the HUD's moving parts, the title screen, the finish
party's beat and confetti, the controller, the stats' goals, the levels and the perf probe. The downhill
(`peak/downhill/`) is built on it. The climb (`peak/main.js`) came first and still has its own copies of the same
things (it uses the kit's controller, levels and perf probe); it can move onto the kit later.

The recipe for a whole new game (its page, its folder, the premise, sound, scores, the build and the checks) is the
`mini-game` skill in [.claude/skills/mini-game/](../../.claude/skills/mini-game/SKILL.md), with templates. A new
game also updates the page of all the games (`games.html`, at `/games`: its card, and its shot in
`peak/games/main.js`) and the viewer (`index.html`, at `/viewer`: its tab, `peak/<game>/viewer.js`, in `GAMES` in
`peak/viewer/tabs.js`), and sends its Plausible goals as `<Game>: <goal>` (`peak/README.md`, "Analytics"), so all
three keep up with the games.

Every game is made for more than one level from the start, even while it has one (`levels.js`, below): its scores,
its Hall of Fame and its replays go to the board of the level being played, and a link to a level, a ghost or a
replay keeps its `?level=`. Every game's Hall of Fame races and watches its runs, on the climb's replay controls
(`peak/replays/controller.js`, which takes a game's own player, as the downhill's `playback.js` is).

| File | What |
|---|---|
| `stage.js` | `createStage({ manual, fov, fog, shadow })`: the renderer, the scene in the sky's colour with the haze, the camera, the ink outlines and the post-processing (`look/post.js`, adaptive except in `?manual`), the sky and sun lights. `aimSun(at)` moves the sun's shadow box along with the player, snapped to texels. Follows a resize |
| `warmup.js` | `warmUp(scene, render)`: every shader built behind the preloader, by drawing one frame with nothing culled and nothing hidden; painted shadow casters get a depth material of their own |
| `loop.js` | `startLoop({ manual, post, step, render })`: the frame loop (the post adapts, the game steps by at most 50 ms, a frame is drawn), and the preloader lifted after the first frame. `expose(name, api, { step, render })`: `window[name]`, with `step(seconds, dt)` and `render()` for the console and the tests |
| `hud.js` | `toaster(el)`: the toast, with `once(key, …)`, `said`, `left` and `update(dt)`. `pop(el)`: a card pops in again. `soundSwitch(sounds, button)`: the Sound button, and the audio unlocked on the first real key or tap (pointerup and touchend too, for phones) |
| `title.js` | `class TitleScreen`: the title screen's menu, tips, How to play, "press any key", the start on any key or tap (a movement key moves on that same frame) and the camera's glide into the game's camera (`round: true` swings it round the player, for a title shot from the front). A game's title extends it with its shot (`frame()`) and its moment of leaving (`leaving(how)`) |
| `party.js` | `class Beat`: the finish party's clock, on the music's beat (`start(clock, lead)`, `update(dt, clock)`, `b` beats). `confetti(puffs, at)`: a burst of bright bits over the winner |
| `gamepad.js` | `class GamepadInput`: a controller (the Gamepad API's standard layout; Xbox, PlayStation, Switch). `poll()` once a step, then `stick`, `dpad`, `keys(held)` (the stick and D-pad as W A S D), `look` (the right stick as a camera drag), `down(b)`, `value(b)` (the triggers), `fresh` (pressed this step, by `BUTTON`), `used`, `rumble('bump' \| 'hit' \| 'cheer')`, the player's `settings` (kept in `localStorage`). With several connected, the one in use wins; everything lets go while the page isn't in front |
| `padmenu.js` | `class PadMenu`: the controller on the screen. Its chip in the corner, the card behind it (the buttons, Camera, Look speed and Rumble; the Menu button or a click), and the page's hints in the controller's buttons while it's in use (the help line, "Press A to …", How to play). `update(dt)` after `poll()` presses the title's buttons, the Hall of Fame's and the finish card's, and says (true) when the controller went to the page. `glyphs(names)` draws buttons |
| `pad.css` | The chip, the card and the button glyphs (A, ✕ or B, by the controller's maker); `body.pad` swaps the keyboard's hints (`key-only`) for the controller's (`pad-only`). A page links it after `kit.css` |
| `analytics.js` | `goals(game, { manual })`: the game's Plausible goals, a `send(name)` that counts `<game>: <name>` on the public site only (null on localhost, staging and `?manual`, so the game doesn't listen there); a blocked tracker never interrupts. The tracker itself is in the page's head. The downhill, `/games` and the template use it |
| `levels.js` | `pickLevel(levels)`: the level the page is asked for with `?level=`, one of the game's ids (`''` is the first, the one the page opens on), else its first. `boardName(game, level)`: that level's board on the score server, the game's own name for the first and `<game>-<level>` for the others (`server/games.py`). `levelUrl(level)`: a link to a level of this page. A game keeps `LEVELS` in its `main.js`, passes the level to `apiBase(location, '<game>', level)` for its scores and replays, and exports each level's route with `export_route.py <game> <level>` |
| `perf.js` | `probe(game, { name, what, long, board, spots, things, card, frame, settle })`: the perf probe for `<game>.html?perf` ([docs/performance.md](../../docs/performance.md)). It puts the game at each spot (`{ label, go() }`, a handful) and times 4 s of its frames there, then the frame's parts and what each thing in the scene costs (`things()`: a Map of label to objects), held still at the slowest spot. The table goes in `window.peakPerf` (for `tools/perf.mjs`) and to `/api/<board>/perf` (`board`: the game's on the score server), and the card thanks the player. A game's own side is its `perf.js` (the climb's `peak/dev/perf.js`, the downhill's `peak/downhill/perf.js`); its `main.js` loads it for `?perf` and treats that as `?manual` |
| `thanks.js`, `thanks.css` | The end of a perf run: `share(run, board)` sends it, `thank(run, box, card)` shows the card, with a nerdy joke and another on request, the raw numbers behind a button and the game's party playing under it. `card`: `pictures`, `way` (up, down), `wobble`, `play` (the button back to the game), the game's own `jokes`, `dance()` and `more()` (another burst of confetti). It loads its CSS itself |
| `kit.css` | The HUD's look: the palette as CSS variables, the cards, the time, the Sound button, the help line, the toast and its pop, the panel and the finish card. A page links it after `peak/ui/title.css` and adds its own parts inline |

## How a game uses it

```js
const stage = createStage({ manual, fov: 52, fog: [70, 460], shadow: { half: 28, far: 110, ahead: 18, back: 50 } });
const { renderer, scene, camera, post, render } = stage;
// … the game's world, player and camera …
const toast = toaster(document.getElementById('toast'));
soundSwitch(sounds, document.getElementById('sound'));
const title = new Title({ camera, dom: renderer.domElement, … });   // extends TitleScreen
const pad = new GamepadInput();
const padMenu = new PadMenu(pad, { sounds, controls: [['move dpad', 'walk'], ['a', 'jump']], help: [['move', 'walk']] });
const track = goals('My Game', { manual });     // in peak/<game>/analytics.js: track?.('Start'), track?.('Finish')
const LEVELS = [''];                            // one level for now; another is its id here and in server/games.py
const level = pickLevel(LEVELS);                // ?level=, for the world, the scores and the replays

function step(dt) {
  pad.poll();
  if (pad.connected && !padMenu.update(dt)) { /* … the controller's stick and buttons, as the game's input … */ }
  // … the game …
  title.update(dt);          // before the player is posed
  // … the game's camera …
  title.place(dt);           // after it
  stage.aimSun(player.pos);
  toast.update(dt);
}

if (!manual) title.show();
step(1 / 60);
warmUp(scene, render);
render();
startLoop({ manual, post, step, render });
expose('mygame', { THREE, scene, camera, title, … }, { step, render });
if (perf) import('./perf.js').then(m => m.probe(window.mygame));   // ?perf (also ?manual): the game's side of perf.js
```

The page links `peak/ui/title.css`, `peak/ui/preload.css`, `peak/scores/scores.css`, `peak/kit/kit.css` and
`peak/kit/pad.css`, and
holds the markup: `#preload`, `#hud` (with `#toast`, `#sound`, `#help`), `#title-screen` and `#finish`. The
template in `.claude/skills/mini-game/templates/` has all of it.

## Changing the kit

Every mini game runs on these files, so a change here is a change to all of them. Add an option with a default
that keeps what the games do now, and check every game that uses the kit: its `?manual` shots, its test bot and its
console. Say so on the board.
