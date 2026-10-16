# Mnot Arena

A proof of concept, on the site at `/arena` (with a push, see "Live"), but not on `/games` yet.

A plaza in the snow, a little way up the mountain, where every visitor is a can. Type a name and you're in: walk
about, say something (it shows in the log and over your can), wave, dance, jump, and bump into the others; a hard
bump sends both cans reeling. Up to 12 cans; everyone else watches until a spot frees up. Nobody is alone there:
three bots keep a lone visitor company, and one makes room for each person more. It's the first online piece of the
games: one server decides where every can is, and every page shows the same plaza.

It's built on the mini game kit (`peak/kit/`) and shares the climb's look and Mnot, with sounds and music of its
own. No title, party, scores or `?perf` yet: those come when it becomes a game (the `mini-game` skill).

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
  which pages may connect besides local ones; `ARENA_BOTS` (3) how many bots keep a lone visitor company.
  `/arena/health` says who's in.

A page from a local dev server talks to the room server on this computer, port 5298; anywhere else, to its own host.
`?server=host:port` points it at another one; `?lag=200` holds every message 100 ms each way, to play as if the
server were far away. To try it as it runs live, through the score server (see "Live"): `npm run build`, the room
server, then `ARENA_UPSTREAM=127.0.0.1:5298 SITE_DIR=dist python -X utf8 server/peak_scores.py --static --port 8080`
and <http://127.0.0.1:8080/arena?server=127.0.0.1:8080>.

To fill the room: `node bots.mjs 5` in `arena/` (count, then the server's address if it isn't the local one). The
bots wander, run at someone to bump them, jump, wave, dance and say something now and then, as the room's own do,
but they come in over the line as people do, so the room's own make way for them. Ctrl+C takes them home.

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
| `peak/arena/sfx.js`, `music.js` | Can foley within 7 m, bounded crowd cues and the 96 BPM Pocket Altitude plaza loop; `audio/arena/README.md` covers the assets, rebuilding them and their checks |
| `arena/server.mjs` | The room server: a WebSocket at `/arena/ws`, the steady clock, the limits per connection |
| `arena/room.mjs` | The room: who's in, joining, chat, the step and its snapshot. Knows nothing of sockets |
| `arena/words.mjs` | Names and chat lines made safe and polite (the score server's word lists) |
| `arena/brain.mjs` | What a bot does: wander, bump someone, jump, wave, dance, say something, greet a newcomer |
| `arena/bots.mjs` | Cans that aren't people, coming in over the line, for testing |
| `arena/room.test.mjs` | The room's tests |
| `arena/server.test.mjs` | The room server over real sockets: who may connect, and how many from one address |
| `arena/Dockerfile` | The room server's container, live (see "Live") |
| `server/arena.py` | The score server passing `/arena/ws` and `/arena/health` on to the room server, live |
| `tools/check_arena.mjs` | The page with several visitors at once, in headless Chromium |

## How it plays online

- **The server decides.** It steps the room 30 times a second (`TICK`) with `sim.js` and sends every page a
  snapshot: 4 bytes and 21 a can, so a full room is about 7.7 KB a second to each visitor.
- **A page sends what its player does**, every step: 6 bytes (the stick, a jump, an emote, a number). The server
  steps a can once for each input its page sent, never more, and one a step: it keeps a few in hand before it walks
  on them (`LIMITS.buffer`), so inputs that come in unevenly (wifi, a page's uneven frames) still make an even walk
  for the others. It starts with 2; each time the can runs dry after a short gap it keeps one more (up to 6, 200
  ms), and after 10 calm seconds one fewer. A long gap (a hiccup, a page in the background) doesn't count: after
  one, the can catches up at most 3 steps a step (`LIMITS.catchUp`), no more than it saved up while it waited (20,
  `LIMITS.bank`), so sending more never makes a can faster. With none, the can waits where it is, and after 15
  steps it goes on without (standing still, coming down from a jump). My own can doesn't wait for any of this (next
  point): the buffer only puts the others' view of it a few steps behind.
- **My can doesn't wait for the server.** The page runs it ahead with the same `sim.js`, on the frames' own clock
  (the time they show on the screen, so it moves as evenly as they come; past the kit's cap on a slow frame, all
  the time that went by). Each snapshot says which of my inputs the server has used: the page starts again from the
  server's can, plays the inputs it hasn't used yet on top, and moves the step being drawn by any difference, which
  eases out in a tenth of a second. Mostly there's none.
- **The others** are drawn 3 steps (100 ms) behind the server's clock, between two snapshots, so they move
  smoothly however the snapshots arrive.
- **The bots** are the server's own (`fill` in `room.mjs`, thinking with `brain.mjs`): 3 with one person or nobody
  yet, one fewer for each person more, none from four. The last to come makes room when a person joins (the line
  says so), and one comes back when a person goes. They're cans like any other in the snapshot, named "(bot)", with
  the colours from the far end, so people get the first ones; one waves and says hello when a person comes in. They
  never doze off, don't count as people (the page's count, a full room, `/arena/health`'s `playing`), and with
  nobody connected the room doesn't step, so they wait where they are.
- **The limits** (`LIMITS` in `room.mjs`, `server.mjs`): 12 cans, 48 connections in all, names 16 characters and
  chat lines 140 (rude words fizz), 4 lines in a row then one every 1.5 s, 120 messages a second a connection, 2 KB a
  message, 5 minutes without walking or talking and a can goes back to watching, 4 connections from one address
  (`PER_ADDRESS`; this computer's has none). Only pages from local hosts and `ARENA_ORIGINS` may connect.
- **Joining a full room** costs no hitch: the warm-up draws twice (three.js builds the shadows' shaders before it
  counts the lights), so a can coming in builds no new shader.

## Checks

- `npm test` in `arena/`: the room (joining, the bots, names, a full room, chat, walking, an uneven line, late and
  bursty inputs, emotes, bumps, the wall, idling, the wire, and the page's prediction against the server), and the
  room server on a port of its own (the pages that may connect, the limit per address, the bots).
- The score server's tests (`server/test_arena.py`): the WebSocket passed on both ways with the visitor's address,
  `/arena/health`, the room server down, too many lines at once, the page's policy.
- `node --test tools/check_arena.mjs`: four visitors in headless Chromium against a room server of its own, on free
  ports: the join card, joining, a name taken, chat, walking (my can and what the others see agree), jumping, waving,
  dancing, a bump both pages agree on, playing from far away (`?lag=200`), a full room and a spot freeing up,
  leaving, the line dropping and coming back, and the bots (on a room server started with them; the rest runs
  without). About 90 s. Set `PLAYWRIGHT` to Playwright's `index.mjs` if it
  isn't installed here, and `CHROME` to a browser if Playwright's own doesn't match.
- The sounds: `python tools/check_arena_audio.py`, and `npm run build`, then `node --test tools/check_arena_audio.mjs`.

## Live

The page is at <https://peakmnot.mosredna.eu/arena> (`PAGES` in `tools/build.mjs` and in `server/peak_scores.py`),
and talks to its own host, `wss://peakmnot.mosredna.eu/arena/ws`. On the way in:

- Cloudflare and the proxy on the server pass the WebSocket upgrade on, to the one port MosDeploy gives the site:
  the score server's container. MosDeploy routes a host, not a path.
- The score server passes `/arena/ws` and `/arena/health` on to the room server (`server/arena.py`, at most 64 lines
  at once), with the visitor's address in `X-Forwarded-For` (as `TRUSTED_PROXIES` reads it), for the limit per
  address. `ARENA_UPSTREAM` says where; without it, both are 404.
- The room server runs in a container of its own (`arena/Dockerfile`, the `arena` service in `docker-compose.yml`)
  on the score server's network (`network_mode: service:app`): no port of its own, only the score server reaches
  it, on 127.0.0.1:5298. `ARENA_ORIGINS` is the site. A deploy builds and starts both. When the score server's
  container starts again (a crash, a restart), it has a new network; the room server notices that the score server
  at `BESIDE` no longer answers, stops, and Docker starts it again beside it, a few seconds later. Only recreating
  the score server's container alone (`docker compose up -d --force-recreate app`) leaves it stopped: then
  `docker compose up -d` brings it back.
- The page's policy lets it connect to `wss://` its own host (older Safari doesn't count that as `'self'`).

<https://peakmnot.mosredna.eu/arena/health> says who's in, and from how many addresses (none shown).

Still to come before it's a game: a title, the card on `/games`, a viewer tab, Plausible goals,
`?perf`, phones checked (the `mini-game` skill).
