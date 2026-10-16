# Mnot Arena

A proof of concept, local only: not in the build's `PAGES`, not on `/games`, not live.

A plaza in the snow, a little way up the mountain, where every visitor is a can. Type a name and you're in: walk
about, say something (it shows in the log and over your can), wave, dance, jump, and bump into the others; a hard
bump sends both cans reeling. Up to 12 cans; everyone else watches until a spot frees up. It's the first online
piece of the games: one server decides where every can is, and every page shows the same plaza.

It's built on the mini game kit (`peak/kit/`) and shares the climb's look and Mnot. No title, party, scores,
sounds of its own or `?perf` yet: those come when it becomes a game (the `mini-game` skill).

| Key | |
|---|---|
| W A S D / arrows | walk (Shift: slowly) |
| Space | jump |
| E | wave |
| Q | dance |
| Enter | chat (Enter sends, Escape closes) |

| Touch | |
|---|---|
| drag on the left half | walk |
| tap the right half | jump |
| the buttons | wave, dance, jump, chat |

A controller walks with the left stick; A jumps, X waves, Y dances, View switches the sound.

## Running it

The page and the room server are two things:

- the page, `arena.html`, from any static server: the `arena` entry in `.claude/launch.json` (port 5297), or the
  shared dev server (`python tools/dev_server.py`, then <http://127.0.0.1:5280/arena.html>);
- the room server, `arena/server.mjs` (Node 22 or newer, `npm install` in `arena/` once): the `arena-server` entry
  (port 5298), or `npm start` in `arena/`. `PORT` and `HOST` say where it listens; `ARENA_ORIGINS` (comma separated)
  which pages may connect besides local ones. `/arena/health` says who's in.

A page from a local dev server talks to the room server on this computer, port 5298; anywhere else, to its own host.
`?server=host:port` points it at another one; `?lag=200` holds every message 100 ms each way, to play as if the
server were far away.

To fill the room: `node bots.mjs 5` in `arena/` (count, then the server's address if it isn't the local one). The
bots wander, run at someone to bump them, jump, wave, dance and say something now and then. Ctrl+C takes them home.

## The files

| File | What |
|---|---|
| `arena.html` | The page: the HUD (the count, Leave, Sound, the chat log and box, the buttons), the join card, the tags |
| `peak/arena/main.js` | The page: the stage, the room as this page knows it, my can ahead of the server, the others, the camera |
| `peak/arena/sim.js` | The rules, shared by the page and the server: a can's step, the wall, the snowmen, the bumps |
| `peak/arena/protocol.js` | What goes over the line: inputs and snapshots in bytes, the rest JSON |
| `peak/arena/net.js` | The page's WebSocket: comes back when it drops, the round trip, `?lag` |
| `peak/arena/cans.js` | The cans: Mnot's model cloned and painted one of 12 colours, its clips, the name tags and chat bubbles |
| `peak/arena/plaza.js` | The plaza: the floor, the snow wall, three snowmen with glasses, the sign |
| `arena/server.mjs` | The room server: a WebSocket at `/arena/ws`, the steady clock, the limits per connection |
| `arena/room.mjs` | The room: who's in, joining, chat, the step and its snapshot. Knows nothing of sockets |
| `arena/words.mjs` | Names and chat lines made safe and polite (the score server's word lists) |
| `arena/bots.mjs` | Cans that aren't people, for testing |
| `arena/room.test.mjs` | The room's tests |
| `tools/check_arena.mjs` | The page with several visitors at once, in headless Chromium |

## How it plays online

- **The server decides.** It steps the room 30 times a second (`TICK`) with `sim.js` and sends every page a
  snapshot: 4 bytes and 21 a can, so a full room is about 7.7 KB a second to each visitor.
- **A page sends what its player does**, every step: 6 bytes (the stick, a jump, an emote, a number). The server
  steps a can once for each input its page sent, never more: it saves up to 8 steps (`LIMITS.bank`) for inputs that
  came in late or all at once after a hiccup, so sending more never makes a can faster. With none, the can waits
  where it is, and after 8 steps it goes on without (standing still, coming down from a jump): a page in the
  background.
- **My can doesn't wait for the server.** The page runs it ahead with the same `sim.js`, on the real clock (not the
  frame's, which the kit caps). Each snapshot says which of my inputs the server has used: the page starts again
  from the server's can, plays the inputs it hasn't used yet on top, and eases out any difference in a tenth of a
  second. Mostly there's none.
- **The others** are drawn 3 steps (100 ms) behind the server's clock, between two snapshots, so they move
  smoothly however the snapshots arrive.
- **The limits** (`LIMITS` in `room.mjs`, `server.mjs`): 12 cans, 48 connections in all, names 16 characters and
  chat lines 140 (rude words fizz), 4 lines in a row then one every 1.5 s, 120 messages a second a connection, 2 KB a
  message, 5 minutes without walking or talking and a can goes back to watching. Only pages from local hosts and
  `ARENA_ORIGINS` may connect.
- **Joining a full room** costs no hitch: the warm-up draws twice (three.js builds the shadows' shaders before it
  counts the lights), so a can coming in builds no new shader.

## Checks

- `npm test` in `arena/`: the room (joining, names, a full room, chat, walking, late and bursty inputs, emotes,
  bumps, the wall, idling, the wire, and the page's prediction against the server).
- `node --test tools/check_arena.mjs`: four visitors in headless Chromium against a room server of its own, on free
  ports: the join card, joining, a name taken, chat, walking (my can and what the others see agree), jumping, waving,
  dancing, a bump both pages agree on, playing from far away (`?lag=200`), a full room and a spot freeing up,
  leaving, and the line dropping and coming back. About 80 s. Set `PLAYWRIGHT` to Playwright's `index.mjs` if it
  isn't installed here, and `CHROME` to a browser if Playwright's own doesn't match.

## Going live (not done)

- The room server as a second service next to the score server, behind the same host at `/arena/ws`, so the page
  needs no other address. The proxy in front has to pass the WebSocket upgrade on that path.
- `ARENA_ORIGINS` set to the site, a limit on connections per address, and a line in `PAGES` in `tools/build.mjs`.
- Then the rest of a game: a title, sounds (Codex), the card on `/games`, a viewer tab, Plausible goals, `?perf`,
  phones checked (the `mini-game` skill).
