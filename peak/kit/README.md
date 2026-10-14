# The mini game kit

What every mini game is built on, so a new one starts from the same base as the others: the stage and its light,
the frame loop and the preloader, the handle for tests, the HUD's moving parts, the title screen, the finish
party's beat and confetti, and the controller. The downhill (`peak/downhill/`) is built on it. The climb
(`peak/main.js`) came first and still has its own copies of the same things (it uses the kit's controller); it can
move onto the kit later.

The recipe for a whole new game (its page, its folder, the premise, sound, scores, the build and the checks) is the
`mini-game` skill in [.claude/skills/mini-game/](../../.claude/skills/mini-game/SKILL.md), with templates. A new
game also updates the page of all the games (`games.html`, at `/games`: its card, and its shot in
`peak/games/main.js`) and the viewer (`index.html`, at `/viewer`: its tab, `peak/<game>/viewer.js`, in `GAMES` in
`peak/viewer/tabs.js`), and sends its Plausible goals as `<Game>: <goal>` (`peak/README.md`, "Analytics"), so all
three keep up with the games.

| File | What |
|---|---|
| `stage.js` | `createStage({ manual, fov, fog, shadow })`: the renderer, the scene in the sky's colour with the haze, the camera, the ink outlines and the post-processing (`look/post.js`, adaptive except in `?manual`), the sky and sun lights. `aimSun(at)` moves the sun's shadow box along with the player, snapped to texels. Follows a resize |
| `warmup.js` | `warmUp(scene, render)`: every shader built behind the preloader, by drawing one frame with nothing culled and nothing hidden; painted shadow casters get a depth material of their own |
| `loop.js` | `startLoop({ manual, post, step, render })`: the frame loop (the post adapts, the game steps by at most 50 ms, a frame is drawn), and the preloader lifted after the first frame. `expose(name, api, { step, render })`: `window[name]`, with `step(seconds, dt)` and `render()` for the console and the tests |
| `hud.js` | `toaster(el)`: the toast, with `once(key, …)`, `said`, `left` and `update(dt)`. `pop(el)`: a card pops in again. `soundSwitch(sounds, button)`: the Sound button, and the audio unlocked on the first real key or tap (pointerup and touchend too, for phones) |
| `title.js` | `class TitleScreen`: the title screen's menu, tips, How to play, "press any key", the start on any key or tap (a movement key moves on that same frame) and the camera's glide into the game's camera. A game's title extends it with its shot (`frame()`) and its moment of leaving (`leaving(how)`) |
| `party.js` | `class Beat`: the finish party's clock, on the music's beat (`start(clock, lead)`, `update(dt, clock)`, `b` beats). `confetti(puffs, at)`: a burst of bright bits over the winner |
| `gamepad.js` | `class GamepadInput`: a controller (the Gamepad API's standard layout; Xbox, PlayStation, Switch). `poll()` once a step, then `stick`, `dpad`, `keys(held)` (the stick and D-pad as W A S D), `look` (the right stick as a camera drag), `down(b)`, `value(b)` (the triggers), `fresh` (pressed this step, by `BUTTON`), `used`, `rumble('bump' \| 'hit' \| 'cheer')`, the player's `settings` (kept in `localStorage`). With several connected, the one in use wins; everything lets go while the page isn't in front |
| `padmenu.js` | `class PadMenu`: the controller on the screen. Its chip in the corner, the card behind it (the buttons, Camera, Look speed and Rumble; the Menu button or a click), and the page's hints in the controller's buttons while it's in use (the help line, "Press A to …", How to play). `update(dt)` after `poll()` presses the title's buttons, the Hall of Fame's and the finish card's, and says (true) when the controller went to the page. `glyphs(names)` draws buttons |
| `pad.css` | The chip, the card and the button glyphs (A, ✕ or B, by the controller's maker); `body.pad` swaps the keyboard's hints (`key-only`) for the controller's (`pad-only`). A page links it after `kit.css` |
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
```

The page links `peak/ui/title.css`, `peak/ui/preload.css`, `peak/scores/scores.css`, `peak/kit/kit.css` and
`peak/kit/pad.css`, and
holds the markup: `#preload`, `#hud` (with `#toast`, `#sound`, `#help`), `#title-screen` and `#finish`. The
template in `.claude/skills/mini-game/templates/` has all of it.

## Changing the kit

Every mini game runs on these files, so a change here is a change to all of them. Add an option with a default
that keeps what the games do now, and check every game that uses the kit: its `?manual` shots, its test bot and its
console. Say so on the board.
