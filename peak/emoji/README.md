# Reaction Run

A prototype, at `/emoji` (`emoji.html`), with its card on the page of all the games (`/games`).

The thread wants its reactions, in order: Mnot slides about a snowy field full of the community's Slack emoji and
fetches the ones on the list, one after the other, without touching any other. The emoji stand about as thick die-cut
stickers, spinning over the snow between knee-high snow walls: a loose maze you can see over. Mnot is steered like a
shopping trolley on fresh snow, so it drifts wide in the turns, glides on when you let go and bonks off the walls,
and the wrong emoji are never far. Touch one, or a listed one too early, and it warps away while Mnot bumps back
off it and sees stars for a bit; the third time it slips and goes over flat on its back: the thread is ruined. Fetch
the last one (always out at a side) and every other emoji twists away, the snow shakes and gives way across a few
passages, and a big :peak-mnot: drops into the middle of the field in a beam of light; find the way round to it and
fetch it, and the clock stops, and Mnot dances with it over its head. Here and there the snow is
cracked across a passage: stepped on, it holds for two seconds, plenty to run across, then crumbles into a hole
behind Mnot, and that way back is gone. Run into a hole's edge and Mnot teeters there, arms wheeling: brake or steer
away to step back, or in it goes.

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
- The list's last one is always dealt in a side column, as near five steps from the middle as there is (`FAR` in
  `field.js`), so the run on to :peak-mnot: is about as long on every field.
- With the list done (the ▲ at its end), every other emoji twists away, from Mnot outwards, the camera shoots up to
  look over the field, and Mnot stops and flails for 1.2 s as the snow shakes: three to five passages on the way to
  the middle crack and give way one after another (`?finale=` 0 to 8 for a set number; `Field.collapse`), and
  :peak-mnot: drops into the middle cell (kept free of emoji) in a pale gold beam. Each one given way is on the
  shortest way left, so the way there is round them now, about eleven cells (twelve at most), and the middle can
  still be reached from anywhere, every crack gone. Fetching it is the finish.
- The clock runs from the first move to :peak-mnot:, peeking included.
- Two or three passages on the way are cracked (`?cracks=` at most, 0 to 6; 3). Stepped on (within `CRACK.near` of
  where the hole will be), a crack holds for two seconds (`CRACK.hold`): it creaks, a darker crack runs round the
  slab both ways from where Mnot stepped on, and the slab trembles harder and harder; when the ends meet, the slab
  breaks into chunks that tip and sink into the hole. The first crack stepped on in a page says so in a toast. At a
  run Mnot is long over by then: the run's first hole says "Made it!" with Mnot across it, "Gone!" with it back on
  the side it came from. Still on it as it goes, Mnot drops in up to its glasses, flails, and hops out on the side it
  came from, seeing stars for a moment; no try lost, only the time and the way through. A hole is shut both ways for
  good, so the way back is round. The cracks are only where the shortest way through crosses a passage straight on
  (a cell's run-up before it), at most twice, a few steps apart, and only so that the field can still be finished
  from anywhere with every one of them gone (`Field.crack`, `Field.finishable`), at worst the long way round.
- A hole's edge works like the climb's drops (`teeter.js`, after `peak/mnot/teeter.js`): a step that would take
  Mnot's middle over an open hole stops it at the edge instead, and so does a hole opening within 0.2 m of its
  middle while it's slow. It turns to face the hole and teeters, rocking out over it with its arms wheeling (the
  Teeter clip), for 1.1 s (`TEETER.time`; quicker running on into it): brake or steer away after the first 0.22 s
  (`TEETER.catch`) and it steps back with a wobble, or in it goes. A wrong one's bump knocks it off the edge.
- A field is dealt from a seed (shown in the HUD): R brings the same one back, N a new one. A new one is random, but
  about as hard as any other: random seeds are rated (`Field.rate`: the cells on the shortest way through the list
  and on to the middle, round the cracks crossed already and the passages given way at the end, those right by an
  emoji to stay off counted twice more, turns half more) until one lands in the middle of what the first 48 seeds'
  fields rate (35% to 65% of the way from easiest to hardest; `RATED`, `BAND` in `main.js`) and has at least two
  cracks (`CRACKED`) and three passages giving way at the end (`GIVEN`). The bot's times on such fields are within a
  few seconds of each other. `?seed=` deals that one, and N then the next seed, so a test or a shared link stays put
  (a seed's field may have fewer of either).
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

## High scores, replays and stats

- **The board.** Only the board's fields count: the seeds 1 to 2000 a random deal can give, with the default deal
  (`counts()` in `main.js`). A `?seed=` past them, or another deal (`?list=` and the rest), is practice: the card says
  so, and nothing is sent. From the first move the run is recorded (`record.js`); at :peak-mnot: it goes up to the
  score server, which checks it against that field (`server/emoji.py`,
  [server/README.md](../../server/README.md#reaction-run)) and ranks it by the time, then the wrong ones touched; the
  holes dropped into are shown too. The finish card and the Hall of Fame are the climb's (`peak/scores/`), in the
  thread's words, with seven house records so a fresh board isn't empty.
- **Race ghost** (`?ghost=ID`) deals the run's field and runs a see-through Mnot along the recording at the player's
  clock; the start waits until it has loaded. **Watch run** (`?replay=ID`) moves the page's own Mnot along it, its
  fetches, wrong ones, cracks, holes and bonks told again through the game's own handlers, so the sounds, toasts and
  finish card are the game's; nothing is recorded or sent. Both are `playback.js`, with the climb's controls
  (`peak/replays/controller.js`): pause, 2×, scrubbing, Hide ghost.
- **Stats:** cookieless Plausible, on the public site only (`analytics.js`, on the kit's `goals()`):
  `Reaction Run: Start` and `Finish` once a page, `List Done` once a page as the list is done, and `Wrong One`, `Out`
  and `Hole` each time they happen; the games page sends `Games: Play Reaction Run`. Never in `?manual` or a watched
  run, and only the goal's name: no names, times or scores.
- **`?perf`** times how this computer draws the field at five spots (`perf.js`: the start, over the field, the
  middle, the list done, the finish) and sends the run to the server; `node tools/perf.mjs --game emoji` runs it
  headless ([docs/performance.md](../../docs/performance.md)).

## Modules

What it shares with the other games, imported and never copied: the kit (`peak/kit/`), the look (`peak/look/`),
Mnot (`peak/mnot/`), the keys (`peak/controls/input.js`) and the sound switch (`sounds.js`).

| Module | What |
|---|---|
| `main.js` | The page: the stage, Mnot on the snow (steering, sliding, bonks, the fall), the camera over the shoulder and the peek, the list, the controls, the test bot and the loop |
| `field.js` | The field from a seed: the maze, the emoji dealt on it, the cracks (`crack`) and the passages giving way at the end (`collapse`), the ways round (`route`), how hard it is (`rate`), the walls to bonk into. The walls cast no live shadow: their shadows and contact shade are baked into the floor once a field is dealt (`bake`, a canvas texture as its `aoMap`), so they stay clean; Mnot's and the emojis' shadows stay live |
| `stickers.js` | The emoji as spinning extruded tokens, what they do near Mnot, taken and wrong, swept away; the prize dropping in, its beacon, and held up; the list's stickers in CSS |
| `cracks.js` | The cracks in the snow: stepped on (the crack round the slab and its trembling), giving way (the slab's chunks tipping into the hole), the holes (flat on the snow, their far wall and bottom shifting with the camera as a pit's would), how far a point is from a hole's edge, and the passages cracking by themselves at the end (`quake`); says what happened, and `main.js` drops Mnot in and hops it out |
| `teeter.js` | Teetering on a hole's edge: how long, when braking or steering saves Mnot, and how far it tips out; `main.js` catches Mnot there and poses it |
| `sheet.js`, `emojis.webp` | Made by `tools/emoji_atlas.py`: the stickers and their outlines |
| `dizzy.js` | The stars circling over Mnot's head after a wrong one |
| `sfx.js`, `music.js` | Cartoon cues and speed/skid snow loops, plus Pocket Altitude at 112 BPM with a finish answer over the continuing tune; all through the shared Sound switch. Assets, rebuild and QA: [audio/emoji/README.md](../../audio/emoji/README.md) |
| `title.js` | The title screen: the shot at the start, the tips and Mnot's act |
| `record.js` | The run recorded for the score server: where Mnot is every 0.1 s, the keys and what happened |
| `scores.js` | The high scores: the run handed out at the clock's start, the fetches reported, the finish card and the Hall of Fame |
| `routedata.js` | The game as data for the server (`server/emoji.json`: the rules and every board field) and its fingerprint |
| `playback.js` | Race ghost and Watch run: the recording checked, Mnot moved along it, seeking to any moment |
| `analytics.js` | The Plausible goals |
| `perf.js` | Its side of the perf probe, for `emoji.html?perf` |
| `viewer.js` | Its tab in the viewer (`index.html#emoji`): Mnot in the studio among the tokens, a button for each move (laps, a fetch, too early, a wrong one, out, a bonk, a hole, the title's acts, the finale) |

## Testing

- `emoji.html` opens on the title; `emoji.html?manual` skips it and stops the frame loop. In the console,
  `emoji.step(seconds, dt)` steps it and `emoji.render()` draws a frame.
- `emoji.autopilot(true)` lets the test bot play: the shortest way to the next listed one past every other
  (`field.route`, round the holes), then to :peak-mnot:, steering and braking for the corners, and flat out across a
  crack. It finishes fields 1 to 12 and random ones without a wrong one or a hole (a bonk at most; now and then a
  hole opens just ahead of it on its way back and it teeters on the edge and steps back), the run from the last
  listed one to :peak-mnot: 10 to 15 s on every one; with every crack open from the start (`k.state = 'open'` and
  `field.holes`), or with every crack's `hold` near 0 so that it drops into them, it still finishes them all, the
  long way round.
- `tools/check_emoji_replays.js` (on 5280, no score server, as the downhill's): the bot's run on field 11 raced as a
  ghost and watched back, its sounds and Mnot on the recording, jumps in time, the finish, the Hall's buttons.
  `node --test tools/check_emoji_analytics.mjs` checks the goals, `tools/check_gamepad.js` plays it with a
  controller, and `python -m unittest discover server` checks the server's side with real runs
  (`server/fixtures/emoji/`).
- The production build has it: `emoji.html` in `PAGES` in `tools/build.mjs`, `.webp` in its `TYPES` and in the
  server's hashed assets.

## Not yet

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
