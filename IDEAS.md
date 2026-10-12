# Ideas

Game ideas for Mnot, the mascot of the Met Nerds om Tafel podcast. The game itself is not chosen yet.

## Direction under consideration

The user is considering a cosy puzzle game. The setting, mechanics and title are still open.

### Proposal: Mnot: After Hours

After a recording, Mnot comes to life on the podcast table. Small sound pulses need to find their way back
to a microphone. The player walks between desk objects, pushing and rotating little sound modules to
connect a route. Each solved puzzle adds a musical layer and makes the studio feel more alive.

- Feel: warm desk lamps, plants, oversized mugs and books, soft clicks and fizz, a calm pace.
- Start with one compact tabletop diorama and one mechanic: push and rotate sound-routing pieces.
- Prototype three short puzzles: learn to turn a piece, move a piece into place, then combine both actions.
- This is a design proposal, not an approved game plan. Keep the earlier ideas below for comparison.

## Liked

### Dents as the health bar

Every hit puts a visible dent in the can, so the can itself is the health bar and no extra UI is needed.

- The dent shows where Mnot was hit: on the front, back, a side or the lid.
- Health goes from a fresh can, to a few dents, to crumpled, to flattened (game over, with a squashed pose).
- A refill pops the dents back out with a fizz: a soda fountain, a vending machine, a cold can from the fridge.
- Build: each dent is a morph target (shape key) on the can, exported in the .glb and blended in three.js with
  `morphTargetInfluences`. A dent can then grow in gradually and sit at its own spot. The toon shading and outline
  show the dents without extra work.
- It fits almost any of the ideas below: a platformer, a brawler, the funfair can-toss dodge game.

## Other ideas so far

- Tabletop platformer on the podcast table, with fizz: running and jumping builds pressure, the tab releases it as a
  boost jump.
- Escape from the fridge: stealth, hiding when the door opens.
- Deposit panic: Mnot runs from the can deposit machine (or saves other cans from the bin).
- Mnot inside the PC case: a roguelite against literal bugs, with the CPU, RAM and GPU as levels.
- Podcast Overcooked: co-op chaos keeping a recording going.
- Rolling: Mnot tips over and rolls, mini-golf over the desk.
- Mnotchi: a virtual pet that grows with every episode listened.
- Secret codes in episodes that unlock skins (flavours, glasses).
- A level editor for listeners; the best table is featured in an episode.
