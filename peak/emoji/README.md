# Reaction Run (working title)

A prototype on its own branch (`emoji-maze`), not live and not on the games page yet.

The thread wants its reactions, in order: Mnot slides about a snowy field full of the community's Slack emoji and
fetches the ones on the list, one after the other, without touching any other. The emoji stand about as thick die-cut
stickers, spinning over the snow between knee-high snow walls: a loose maze you can see over. Mnot is steered like a
shopping trolley on fresh snow, so it drifts wide in the turns, glides on when you let go and bonks off the walls,
and the wrong emoji are never far. Touch one, or a listed one too early, and it warps away while Mnot bumps back
off it and sees stars for a bit; the third time it slips and goes over flat on its back: the thread is ruined. Fetch
the last one and every other emoji twists away, the camera rises, and a big :peak-mnot: drops into the middle of the
field; fetch that one and the clock stops, and Mnot dances with it over its head. Here and there the snow is
cracked across a passage: it holds just long enough to run across, then gives way behind Mnot, and that way back is
gone.

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
- With the list done (the ▲ at its end), every other emoji twists away, one after another from Mnot outwards, and
  :peak-mnot: drops into the middle cell (kept free of emoji), while the camera looks over the field for two seconds;
  Mnot can steer on meanwhile. Fetching it is the finish.
- The clock runs from the first move to :peak-mnot:, peeking included.
- Two or three passages on the way are cracked (`?cracks=` at most, 0 to 6; 3). Stepped on, a crack holds for 0.45 s
  and then gives way into a hole: at a run Mnot is over by then, and the hole opens behind it. Too slow (or walking
  into a hole later), Mnot drops in up to its glasses, flails, and hops out on the side it came from, seeing stars
  for a moment; no try lost, only the time and the way through. A hole is shut both ways for good, so the way back
  is round. The cracks are only where the shortest way through crosses a passage straight on (a cell's run-up before
  it), at most twice, a few steps apart, and only so that the field can still be finished from anywhere with every
  one of them gone (`Field.crack`, `Field.finishable`), at worst the long way round.
- A field is dealt from a seed (shown in the HUD): R brings the same one back, N a new one. A new one is random, but
  about as hard as any other: random seeds are rated (`Field.rate`: the cells on the shortest way through the list
  and on to the middle, round the cracks crossed already, those right by an emoji to stay off counted twice more,
  turns half more) until one lands in the middle of what the first 48 seeds' fields rate (35% to 65% of the way from
  easiest to hardest; `RATED`, `BAND` in `main.js`) and has at least two cracks (`CRACKED`). The bot's times on such
  fields are within a few seconds of each other. `?seed=` deals that one, and N then the next seed, so a test or a
  shared link stays put (a seed's field may have fewer cracks).
- It's only ever dealt so that each next listed one can be reached from the one before past no wrong one
  (`Field.clear`), so a run is never lost before it starts. `?wrong=` sets how many others stand about (24), `?open=`
  how open the maze is (0 a real maze, 1 no walls; 0.5).

## The emoji

`tools/emoji_atlas.py` makes the sticker sheet from the mnot-emojis repository (<https://mnot-emojis.mosredna.eu/>),
expected next to this one (`--src` for elsewhere):

```bash
python tools/emoji_atlas.py --src ../mnot-emojis
```

It cuts each pick out with a white rim into a 128 px cell of `emojis.webp`, traces its outline, and writes both the
names and the outlines to `sheet.js`; the game extrudes each outline into a token (`stickers.js`). The picks are in
`PICKS` in the script: snacks, things and a handful of parrots that look alike on purpose (for harder levels), and
:peak-mnot:, the prize at the end of every list (never dealt on the field). No
photos of real people and no politics, but a few are someone else's character or logo (Clippy, the bitcoin coin), and
the repository is public: which emoji go live is a choice to make before it does.

## Modules

What it shares with the other games, imported and never copied: the kit (`peak/kit/`), the look (`peak/look/`),
Mnot (`peak/mnot/`), the keys (`peak/controls/input.js`) and the sound switch (`sounds.js`).

| Module | What |
|---|---|
| `main.js` | The page: the stage, Mnot on the snow (steering, sliding, bonks, the fall), the camera over the shoulder and the peek, the list, the controls, the test bot and the loop |
| `field.js` | The field from a seed: the maze, the emoji dealt on it, the ways round (`route`), how hard it is (`rate`), the walls to bonk into. The walls cast no live shadow: their shadows and contact shade are baked into the floor once a field is dealt (`bake`, a canvas texture as its `aoMap`), so they stay clean; Mnot's and the emojis' shadows stay live |
| `stickers.js` | The emoji as spinning extruded tokens, what they do near Mnot, taken and wrong, swept away; the prize dropping in, and held up; the list's stickers in CSS |
| `cracks.js` | The cracks in the snow: stepped on, giving way, the holes (flat on the snow, their far wall and bottom shifting with the camera as a pit's would); says what happened, and `main.js` drops Mnot in and hops it out |
| `sheet.js`, `emojis.webp` | Made by `tools/emoji_atlas.py`: the stickers and their outlines |
| `dizzy.js` | The stars circling over Mnot's head after a wrong one |
| `sfx.js`, `music.js` | The game's own sounds (cued by `main.js`: the list of cues is at the top of `sfx.js`) and its tune; Codex's. Only a placeholder buzzer for a wrong one so far |
| `title.js` | The title screen: the shot at the start, the tips and Mnot's act |

## Testing

- `emoji.html` opens on the title; `emoji.html?manual` skips it and stops the frame loop. In the console,
  `emoji.step(seconds, dt)` steps it and `emoji.render()` draws a frame.
- `emoji.autopilot(true)` lets the test bot play: the shortest way to the next listed one past every other
  (`field.route`, round the holes), then to :peak-mnot:, steering and braking for the corners, and flat out across a
  crack. It finishes fields 1 to 12 and random ones without a bonk, a wrong one or a hole; with every crack open from
  the start (`k.state = 'open'` and `field.holes`), or with `CRACK.hold` near 0 so that it drops into every one, it
  still finishes them all, the long way round.
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
