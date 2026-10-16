# Reaction Run (working title)

A prototype on its own branch (`emoji-maze`), not live and not on the games page yet.

The thread wants its reactions, in order: Mnot slides about a snowy field full of the community's Slack emoji and
fetches the ones on the list, one after the other, without touching any other. The emoji stand about as thick die-cut
stickers, spinning over the snow between knee-high snow walls: a loose maze you can see over. Mnot is steered like a
shopping trolley on fresh snow, so it drifts wide in the turns, glides on when you let go and bonks off the walls,
and the wrong emoji are never far. Touch one, or a listed one too early, and it warps away while Mnot bumps back
off it and sees stars for a bit; the third time it slips and goes over flat on its back: the thread is ruined. Fetch
the last one and it dances.

It's built on the mini game kit (`peak/kit/`) and shares the climb's look and Mnot.

| Key | |
|---|---|
| A D / ← → | steer |
| W / ↑ | run |
| S / ↓ | brake |
| Space (held) | peek: look over the whole field (Mnot stops to look) |
| R | this field again |
| N | a new field |

| Touch | |
|---|---|
| drag on the field | sideways steers, up runs, down brakes |
| hold the list | peek |

A controller steers and runs with the left stick or the D-pad, peeks with LB or RB; Y is this field again, X a new
one.

## The rules

- The list at the top (5 emoji, `?list=` 1 to 12) is the order. The one to fetch now is big and bobs; in the field it
  hops when Mnot comes close, and the others lean back out of reach.
- Three tries (the hearts by the clock). Touching an emoji that isn't the next on the list costs one: one that isn't
  on it warps away for good, a listed one too early warps away and pops back a moment later. Mnot bumps back off it,
  reels for half a second and sees stars for two more, its steering wandering a little; for a moment after, no other
  emoji counts. The third is out.
- The clock runs from the first move to the last emoji, peeking included.
- A field is dealt from a seed (`?seed=`, shown in the HUD): R brings the same one back, N the next. It's only ever
  dealt so that each next listed one can be reached from the one before past no wrong one (`Field.clear`), so a run
  is never lost before it starts. `?wrong=` sets how many others stand about (24), `?open=` how open the maze is (0 a
  real maze, 1 no walls; 0.5).

## The emoji

`tools/emoji_atlas.py` makes the sticker sheet from the mnot-emojis repository (<https://mnot-emojis.mosredna.eu/>),
expected next to this one (`--src` for elsewhere):

```bash
python tools/emoji_atlas.py --src ../mnot-emojis
```

It cuts each pick out with a white rim into a 128 px cell of `emojis.webp`, traces its outline, and writes both the
names and the outlines to `sheet.js`; the game extrudes each outline into a token (`stickers.js`). The picks are in
`PICKS` in the script: snacks, things and a handful of parrots that look alike on purpose (for harder levels). No
photos of real people and no politics, but a few are someone else's character or logo (Clippy, the bitcoin coin), and
the repository is public: which emoji go live is a choice to make before it does.

## Modules

What it shares with the other games, imported and never copied: the kit (`peak/kit/`), the look (`peak/look/`),
Mnot (`peak/mnot/`), the keys (`peak/controls/input.js`) and the sound switch (`sounds.js`).

| Module | What |
|---|---|
| `main.js` | The page: the stage, Mnot on the snow (steering, sliding, bonks, the fall), the camera over the shoulder and the peek, the list, the controls, the test bot and the loop |
| `field.js` | The field from a seed: the maze, the emoji dealt on it, the ways round (`route`), the walls to bonk into |
| `stickers.js` | The emoji as spinning extruded tokens, what they do near Mnot, taken and wrong; the list's stickers in CSS |
| `sheet.js`, `emojis.webp` | Made by `tools/emoji_atlas.py`: the stickers and their outlines |
| `dizzy.js` | The stars circling over Mnot's head after a wrong one |
| `sfx.js`, `music.js` | The game's own sounds (cued by `main.js`: the list of cues is at the top of `sfx.js`) and its tune; Codex's. Only a placeholder buzzer for a wrong one so far |
| `title.js` | The title screen: the shot at the start, the tips and Mnot's act |

## Testing

- `emoji.html` opens on the title; `emoji.html?manual` skips it and stops the frame loop. In the console,
  `emoji.step(seconds, dt)` steps it and `emoji.render()` draws a frame.
- `emoji.autopilot(true)` lets the test bot play: the shortest way to the next listed one past every other
  (`field.route`), steering and braking for the corners. It finishes fields 1 to 14 without a bonk.
- A local server of its own: the `emoji` entry in `.claude/launch.json` (port 5296).

## Not yet

- High scores and a Hall of Fame (a board, a checker, replays), analytics, `?perf`.
- Sound of its own and a tune (Codex, `sfx.js` and `music.js`): for now the climb's landings and wave, and a
  placeholder buzzer.
- A tab in the viewer, a card on the games page, a share image, the final name.
- The production build: `emoji.html` in `PAGES` in `tools/build.mjs`, and `.webp` in its `TYPES` (and in the server's
  hashed assets).
- Phones: the drag steering and the list peek are untested on a real phone.

## Ideas

- **Field of the day:** one seed a day for everybody, and a collection: every emoji you ever fetched in an
  emoji-dex.
- **Memory:** the list shows for a few seconds and then hides; peeking shows the field, not the list.
- **Lookalikes:** a list of parrots in a field full of parrots.
- **Restless emoji:** a party parrot that dances from cell to cell, two that swap places when you look away.
- **Bad snow:** ice patches (no grip at all), a snowplough lane that pushes, drifts that slow you.
- **Notifications:** an @channel bubble that chases Mnot; touching it is out too.
- **A conga line:** the fetched emoji follow Mnot in a wobbly trail that mustn't touch a wrong one either.
