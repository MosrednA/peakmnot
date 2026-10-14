# Peak Mnot's score server

The high-score lists for [Peak Mnot](../peak/README.md) and its other mini games (the office-chair
[downhill](../peak/downhill/README.md)): a small server, Python's standard library and SQLite only, that takes a run
from a game, checks it step by step against the route and the game's physics, and only then puts the time on that
game's board. In production the same server also serves the games, so pages and API share one origin. Below, "a
climb" is the climb's run; the downhill's works the same way ("Several games", "The downhill").

The game page's CSP permits the cookieless Plausible tracker and event requests at `https://stats.mosredna.eu`.
Inline scripts are allowed by their hashes. The [game analytics reference](../peak/README.md#analytics) lists the
goals and the exclusions for development and manual tests.

| File | What it does |
| --- | --- |
| `peak_scores.py` | The HTTP server: `/api/<game>`, with `--static` the games' files too; security headers; the command line |
| `games.py` | The games: each one's route, checker, house records and words (below, "Several games") |
| `api.py` | The endpoints: rate limits, signatures and nonces, the checks on splits and the finish, the eggs |
| `verify.py` | The climb's replay check: every step of a recorded climb against the route and the physics |
| `replayformat.py` | The climb's replay shape, checked before anything else reads it |
| `route.py`, `route.json` | The route as the game exported it (`peak/scores/routedata.js`), and the geometry questions about it |
| `checks.py` | What every game's checker shares: the replay's shape and the checks that hold for any run |
| `downhill.py`, `downhill.json` | The downhill's checker and its route (`peak/downhill/routedata.js`): the piste, the obstacles, the chair's feel |
| `store.py`, `db.py` | The data: runs, players, the board, the Hall of Shame; the schema and its migrations |
| `names.py`, `eggs.py` | The name filter, and what the server says to people poking at it |
| `perf.py` | The perf runs that `peak.html?perf` sends, kept as JSON lines ([docs/performance.md](../docs/performance.md)) |
| `export_route.py` | Refreshes `route.json` (or `downhill.json`) from the game (below) |
| `test_peak_scores.py`, `test_peak_parts.py`, `test_downhill.py`, `fixtures/` | The tests, and real recorded climbs and rides they replay |
| `browser_bot.js` | An end-to-end check: a bot that climbs in a real browser and submits like a player |

## Running it

Next to the viewer (`python tools/dev_server.py` on port 5280), start the score server:

```sh
python -X utf8 server/peak_scores.py
```

It listens on `127.0.0.1:5281`. A page on port 5280 talks to it there (one on 5293, the downhill's own preview, to
port 5294); on any other origin a game uses `/api/<game>` on its own origin. The `games` entry in
`.claude/launch.json` runs it with `--static` on 5294, data in `data/local/`: both games and their boards on one
origin, as in production, at <http://127.0.0.1:5294/> and <http://127.0.0.1:5294/downhill>. `peak.html?manual`
(tests and bots) never talks to the server. In development the data lives in `data/` at the root (git-ignored), and
without `PEAK_SECRET` the server makes a key in `data/secret.key` the first time.

Settings come from the environment:

| Variable | Default | What for |
| --- | --- | --- |
| `DATA_DIR` | `data/` | Where the database (and the dev key) live; `/data` in the container |
| `PEAK_SECRET` | a generated `secret.key` | The key behind the player secrets' hashes and the hashed addresses. Required in production |
| `PEAK_SECRET_OLD` | empty | The previous key, only while rotating (below) |
| `ALLOWED_ORIGINS` | the viewer on 5280, the downhill's preview on 5293 | Origins that get CORS headers |
| `TRUSTED_PROXIES` | loopback | Networks whose `X-Forwarded-For` is believed (the right-most address that isn't theirs) |
| `HOST`, `PORT` | `127.0.0.1`, `5281` | Also `--host` and `--port` |
| `SITE_DIR` | the repository | What `--static` serves: the source as it is, or a production build (`dist/`, below) |

The command line also does housekeeping:

```sh
python server/peak_scores.py --backup data/backup.sqlite3   # a consistent copy, safe while the server runs
python server/peak_scores.py --reverify RUN_ID              # check a stored replay against today's route
python server/peak_scores.py --fixture latest --as NAME     # save a stored climb as a test fixture
python server/peak_scores.py --fixture latest --as NAME --game downhill   # a ride, in fixtures/downhill/
python server/peak_scores.py --showcase FILE --as NAME      # keep a recorded climb to be played by link only (the climb)
```

`--showcase` takes a replay as the game records it (`-` reads it from stdin), reads the time, falls, dents and splits
off it, checks it like a finish, and prints the id for `peak.html?replay=ID`. It's for climbs that aren't a
player's, such as a bot's: the link plays it, but it's never on the board or in the Hall of Fame,
and housekeeping keeps it. In the container:
`docker compose exec -T app python server/peak_scores.py --showcase - --as NAME < replay.json`.

## How a climb gets on the board

1. **Start.** When the climb begins, the game asks for a run: `POST /api/peak/run` with the route's fingerprint and
   its clock. It gets a run id and a nonce. If the route has changed since the page loaded, the answer is 409
   "route changed", and the game simply hides the scores.
2. **Checkpoints.** At each flag the game sends a split, `POST /api/peak/run/ID/split` with `{cp, t}`. The server
   checks that it's the next checkpoint, later than the last one, not ahead of the server's own clock for this run,
   and not quicker than that stretch can be done.
3. **Summit.** `POST /api/peak/run/ID/finish` sends the time, the falls and dents, and the recorded climb, gzipped
   (`peak/scores/replay.js`: Mnot's position, speed and state about ten times a second, every key change and every game
   event). The server checks the splits and the clock again, then the replay (`verify.py`, below), and answers with
   the rank the climb would get.
4. **Name.** The summit card asks for a name (optional; empty becomes "Mystery Can #1234").
   `POST /api/peak/run/ID/claim` puts the climb on the board. The first claim makes a player: a public id, and a
   secret that stays in the browser's `localStorage` (the server keeps only a keyed hash of it). One entry per
   player: a later climb replaces it only when it's faster (fewer falls breaks a tie), and the name can change
   every time.

Every request after the first is signed: `X-Mnot-Sig` is HMAC-SHA256 of the body, keyed with the run's current
nonce, and every answer carries the next nonce. That isn't a secret from the player (the page has the nonce); it
makes each request single-use and in order. If an answer gets lost, the same request with the previous nonce gets
the same answer again (`X-Mnot-Replay: 1`). Runs expire three hours after they start.

Reading needs no signature: `GET /api/peak/board?limit=10&me=PLAYER_ID` (the top of the board, plus your own entry
if it's further down), `GET /api/peak/shame` (the Hall of Shame) and `GET /api/peak/health`. Board entries include
`replayId` only when the row is a player's current claimed best and its verified replay is retained; house and shadow
entries, and rows without a retained replay, have `replayId: null`.

`GET /api/peak/replay/RUN_ID` returns `{id, name, time, falls, dents, replay}` for that current best, for the Hall
of Fame's Race ghost and Watch run (`peak/replays/`). The public replay holds only the fields its game's `Game.replay`
lists (`games.py`): for the climb `v`, `route`, `phase`, `samples` and `events`, without the raw inputs and the rest
of the run record; the downhill adds its `inputs`, which pose the rider (heels down to brake, tucked in). The route
fingerprint lets the game check that a stored v1 replay matches its current route before playback.
Missing, unclaimed, shadow, house, and replaced best runs all return 404; a showcased climb (above) returns 200
without a board entry. This endpoint uses the same read rate limit as the board.

`POST /api/peak/perf` takes a run of the perf probe (`peak.html?perf`, [docs/performance.md](../docs/performance.md)):
`{v: 1, text, …}`, at most 64 KB, 6 per address every 10 minutes. `perf.py` clips it (strings, numbers and three
levels deep only) and adds it as one line to `DATA_DIR/perf.jsonl` with the time, but no address; past 8 MB the file
moves to `perf.1.jsonl`. It needs no signature: a run is only numbers about a computer, and nothing reads them back.

### The house records

Each board comes with slow, silly records, put in place (or brought up to date) at every start from `games.py`.
The climb's five: `while(true) climb()` 3:14.15, `404: Peak Not Found` 4:04.0, `Dial-up Dave` 5:12.0,
`git push --force` 6:28.3 and `Ctrl+Alt+Defeat` 13:37.0; the downhill's ten, from `Out of Office` 2:42.0 to
`O(n!) Slalom` 14:40.0. They are marked `house`: they rank by time like everyone else, so any run faster than theirs
goes above them, but nobody can claim them or take their names, in any game (a look-alike name becomes a Mystery
Can, with a note why). The games show them as ordinary rows, with their joke as a tooltip.

## Several games

One server, one database, one API: every game in `games.py` has a board under `/api/<game>/` (`peak` for the climb,
`downhill`), with the same endpoints, signatures, limits and eggs. What's a game's own is listed there: its route
(what its runs are checked against), its checker, its house records, its words (a game may say the jokes its own
way) and the numbers its finish sends. A run belongs to the game it was started in: another game's API doesn't know
it. Players are shared: one player, with one secret and one name, in every game, and a new name in one game is the
name in all of them (`peakmnot.player` in the browser).

Every game is made for more than one level, even while it has one. A level is a board of its own, with its runs,
its replays and its route: `/api/<game>-<level>/` (`board_name()` in `games.py`; a level id is `a-z` and `0-9`, at
most 16), checked by the game's checker against `<game>-<level>.json`. The first level is the game itself,
`/api/<game>/` and `<game>.json` (the climb's `route.json`), so a game keeps its board when it grows a second level.
The levels after the first are in `LEVELS` in `games.py`, in the order the game offers them; the page picks one from
`?level=` (`peak/kit/levels.js`) and sends its runs to that level's board. A new level is: its id in `LEVELS` and in
the page's own list, and its route exported, `python -X utf8 server/export_route.py <game> <level>` (the page is then
opened with `?level=<level>&manual`). `--reverify` and `--fixture` take a level as `--game <game>-<level>`.

A new game is:

1. its route as data, exported from the game like the climb's (`export_route.py`, with the game's entry in
   `GAMES` there), and a checker for its runs, `server/<game>.py`, on `checks.py`: the replay's shape (`Format`),
   the timeline, the flags, the splits and the motion are there for any game; the game adds its own physics;
2. a `Game` in `games.load()`, with its house records and any words of its own, and its name in `NAMES`;
3. its page, `<game>.html`, which the server then serves at `/<game>` (and `tools/build.mjs` builds, one line in
   `PAGES`), with its card on the page of all the games and its tab in the viewer (the `mini-game` skill);
4. in the page, `createRun()` and `createBoard()` from `peak/scores/scores.js` for `apiBase(location, '<game>')`;
5. tests: real recorded runs in `fixtures/<game>/`, and the cheats its checker turns down (`test_downhill.py`);
6. what its replay endpoint gives (`Game.replay`), so the page can race and watch its runs (`peak/replays/`).

## The downhill

`downhill.py` checks a ride against `downhill.json`: the piste's centreline and cross-section, the river and its
floes, the obstacles, the chair's feel and the bonus, as `peak/downhill/routedata.js` exports them. It ports the
game's own geometry (`track.js`, `obstacles.js`) and checks every step against `ride.js`'s physics:

- the ride starts at the gate, slowly, and ends past the finish line; it passes each pit stop in order, on the
  sample its flag is on, and the splits say the same;
- on the ground the chair is on the snow (to a centimetre), in the air never below it, never inside a rock or a
  pine's trunk (its branches only slow the chair), and never off the piste;
- in the air it moves as its speed says, falls with gravity less no more air drag than a tucked rider has, and
  steers no more than the chair can there;
- step by step and over every two seconds, it never has more energy than the slope gave it, less the least
  drag and rolling resistance, plus what pushing off (only at the top), steering and the gas lift can add;
- a jump comes only after the lever (Space), within 0.4 s;
- after a spill it's back only after the game's wait, at the last pit stop, at rest, on five fresh casters; a lost
  caster is counted where it comes off;
- the bonus is the replay's own: its best bowl (a pin was hit, and the pins were counted when they settle) and its
  longest ski jump (from the lip, measured where it landed); the claim's clock is the last sample, the board time
  the clock less the bonus, and the spills and lost wheels match.

The least time of a stretch is its length at 45 m/s (`downhill.py`, `SEGMENT_FAST`): about 3.7, 2.8, 4.0, 6.0 and
6.6 s between the gate, the pit stops and the finish; the recorded test ride took 18.7, 8.8, 17.2, 22.4 and 35.6.
After changing the piste, the obstacles, the chair's feel or the bonus, export the route again:
`python -X utf8 server/export_route.py downhill`, and paste the line into the console of
`http://127.0.0.1:5280/downhill.html?manual`.

## The replay check

`verify.py` doesn't run the game again; it checks that every step of the recording is something the game can do:

- the climb starts at base camp and ends on the summit, on the route the server knows;
- on the ground, Mnot stands on rock that is there, or on the gondola where the timetable has it at that moment;
- it never goes faster than its legs, the ice, the wind, a wind gap's jet or the gondola allow: step by step, and
  added up over every second, so the rounding allowance per step can't be stacked into a faster climb;
- in the air it follows the exact parabola (gravity 15 m/s²), and a jump comes only after Space was pressed;
- moving at all needs steering, a key or the touch stick (or ice, wind or a ride to explain it);
- planks and the rope are crossed at the balance speed;
- after a fall it comes back only after the fade, and only at a checkpoint it has reached or somewhere it stood;
- the checkpoints come in order, at the times the splits said, and the falls and the time match the claim.

The tolerances are the recording's rounding (mm, mm/s, ms) plus a little: 3 cm per step, 4% and 6 cm over a second,
0.3 m/s of wind on the ground and 0.5 in the air. Each stretch between checkpoints also has a least time
(`route.py`, `SEGMENT`): the planks and the rope at balance speed less a jump's worth, the rest at 4 m/s, times 0.9.
On the route of 2026-10-13 that is about 9, 5, 8 and 12 seconds; the recorded test climb took 18, 17, 13 and 31.

A climb that fails the check is not refused. Its answer looks like a triumph (rank #1, and the board the cheater
sees has them on top), but the real board stays clean, and the climb goes to the Hall of Shame. Every replay is
stored for audits (`--reverify`).

## The threat model

**Impossible**, each with a test:

- posting a time without a climb that holds up step by step, or changing the time, falls or dents of one;
- teleporting, flying, standing on air, speeding up, moving without keys, jumping without Space, skipping a
  checkpoint, respawning further up, riding a gondola that isn't there;
- slowing down or speeding up a whole recording: the parabolas and speeds stop fitting;
- splits from the future, a finish faster than the server's own clock for the run, reused nonces, replayed or
  edited requests, a second claim of the same climb;
- taking over someone else's entry (their secret is needed) or a house record;
- injection and junk: parameterized SQL, names shown as text only and filtered, size limits on bodies (512 KB) and
  on what they unzip to (2 MB), rate limits per address (hashed) and per player.

**Only hard**, and accepted:

- a bot or a perfect script that plays by the rules of the physics: the server checks physics, not humanity. It
  still has to climb in real time, because the server's clock bounds the run;
- playing in slow motion: the game's time is what counts, so it only makes the climb easier, not faster;
- picking a convenient gondola moment: the recording says where the gondola's timetable started, which saves at
  most the wait for one crossing;
- shaving walking within the wind allowance: squeezing the flat stretches after the gondola by up to a tenth saves
  about a second; more than that is caught;
- many identities: clearing `localStorage` makes a new player; the rate limits slow that down;
- seeing through the shadow ban: the real board is public. The Hall of Shame is a joke, not the defence.

Nothing depends on the code being secret: the one secret is `PEAK_SECRET`, from the environment, which keys the
hashes of player secrets and addresses. The tolerances, the checks and the jokes can all be read; that's the point.

## Easter eggs

They're in `eggs.py`, and the tests poke at all of them. No spoilers here: try something silly against a local
server and read the answers, including the headers.

## The database

One SQLite file, `DATA_DIR/peak.sqlite3`, with `-wal` and `-shm` files next to it while the server runs: `data/` in
development, the `peakmnot-data` volume (mounted at `/data`) in production. It holds the players (public id, a hash
of the secret, the name), the board (one best climb per player), the runs (with a hashed address, never the
address itself) and the replays, gzipped. Unfinished and unclaimed runs go after a week; replays that aren't on the
board, the shame list or showcased after a month.

- **Backup:** `python server/peak_scores.py --backup FILE` copies it consistently while the server runs. In the
  container: `docker compose exec app python server/peak_scores.py --backup /data/backup.sqlite3`, then
  `docker compose cp app:/data/backup.sqlite3 .`.
- **Restore:** stop the server, put the copy in place as `peak.sqlite3`, remove any `-wal` and `-shm`, start it.
  Restore with the same `PEAK_SECRET`: with another key, players can't prove their entries are theirs (their
  browsers quietly start new ones).
- **A migration:** to add a table or column, append `(next number, SQL)` to `MIGRATIONS` in `db.py`. Each runs
  once, in order, at start, and `schema_version` remembers which ran. Never edit or reorder one that has shipped.

## The route

The server checks climbs against `route.json`, an export of the game's route (`peak/scores/routedata.js`). After
changing `peak/world/route.js` (solids, beams, ice, checkpoints, gondola, wind gaps) or the rig's speeds and jumps, refresh it:

```sh
python -X utf8 server/export_route.py
```

and paste the line it prints into the console of `http://127.0.0.1:5280/peak.html?manual`. Until then the server
answers "route changed" and the game hides the scores. Commit `route.json` with the route change.

## Testing

```sh
python -m unittest discover server
```

`test_peak_scores.py` runs the API on a temporary database: a real climb, every cheat above, the limits, the eggs.
`test_peak_parts.py` tests the name filter, the proxy addresses, the static files (from the source and from a
build), the migrations and the checker.
Both replay the climbs in `fixtures/`, each with the route it was climbed on, so they keep testing the checker after
the route moves on (one test then skips, saying the fixtures are older than `route.json`).
`test_downhill.py` does the same for the downhill with the rides in `fixtures/downhill/` (`ride`: 1:31.61 on the
board, no spills; `spills`: two), the cheats its checker turns down, and the two games side by side: a board each,
the house records, one player in both, a run that only its own game knows.

To record a new fixture, climb for real with the browser bot against the dev servers: open
`http://127.0.0.1:5280/peak.html?keep=manual` (any "manual" in the address stops the live reload; this one doesn't
switch the game to manual) and run in the console:

```js
const bot = await import('/server/browser_bot.js'); bot.keepFrames(); await bot.drive(peak, { name: 'Bot Can' })
```

then `python -X utf8 server/peak_scores.py --fixture latest --as NAME`. For a ride, the downhill's autopilot in
`downhill.html?manual&scores` stepped in real time ([its README](../peak/downhill/README.md#testing)), then
`--fixture latest --as NAME --game downhill`. `fixtures/climb` is such a climb
(1:17.88, no falls); `fixtures/falls` slid into the ring's hole once on purpose (`stumble: ['ring']`, 1:24.04).
The bot steers like `peak/dev/bots.js`'s `climb()` (round the ring too); teach it a new obstacle there first.
`keepFrames()` keeps the game going in a tab that's out of sight.

## Production

One container serves the game and the API: `Dockerfile` (python:3.12-slim, a non-root user, port 8080, a health
check on `/api/peak/health`), `docker-compose.yml` (the `peakmnot-data` volume, the environment) and `.mosdeploy.yml`
for MosDeploy at <https://peakmnot.mosredna.eu>. The Dockerfile's first stage (node:24-bookworm-slim) runs
`npm ci` and the production build, `tools/build.mjs`; so building the image needs the npm registry, and nothing
else changes on the host. The image holds only what the build wrote, the games' pages (`peak.html`, `downhill.html`),
the page of all the games (`games.html`) and the viewer (`index.html`), the favicons, the web manifest,
`models/mnot.glb` and `assets/`, and the server. The downhill is at `/downhill`, the page of all the games at
`/games` and the viewer at `/viewer` (`PAGES` in `peak_scores.py`; a route names its file, so it needs no line in
`STATIC`). The server serves only those files (an allowlist), with a
Content-Security-Policy that hashes the page's inline scripts.

In `assets/` every file is named after its content (`peak-HASH.js`, `three-HASH.js`, `fall-HASH.m4a`), so it is
served as immutable, and only the page itself is checked on every visit. Run from the source (no `SITE_DIR`), the
server sends the page's links into `peak/` through `v/BUILD/` instead, a path that changes with the code. To try
the image's site without Docker: `npm ci`, `npm run build`, then
`SITE_DIR=dist python -X utf8 server/peak_scores.py --static --port 8080`.

1. Onboard the project on MosDeploy (type compose, project `peakmnot`). It hands out a loopback port: put it in
   place of `12099` in `docker-compose.yml` and `.mosdeploy.yml` (marked `PORT_PLACEHOLDER`).
2. Set `PEAK_SECRET` in MosDeploy's environment, a long random value, for example from
   `python -c "import secrets; print(secrets.token_hex(32))"`. Never put it in a file in the repository.
   `PEAK_SECRET_OLD` stays empty; `TRUSTED_PROXIES` defaults to loopback and Docker's private networks, where the
   reverse proxy reaches the container from.
3. Deploy. Without MosDeploy: `PEAK_SECRET=... docker compose up -d --build`, with a TLS proxy in front of the port
   that sets `X-Forwarded-For`.
4. Check `https://peakmnot.mosredna.eu/api/peak/health`: `{"ok":true,"route":"…","db":2}`.

If a CDN ever sits in front of the proxy, add its address ranges to `TRUSTED_PROXIES`, or every visitor shares the
CDN's addresses and its rate limits.

**Rotating the key:** set `PEAK_SECRET_OLD` to the current key and `PEAK_SECRET` to a new one. A returning player's
secret still checks against the old key and is re-keyed with the new one on their next claim. After a few weeks
clear `PEAK_SECRET_OLD`; players who haven't been back by then start a new entry, and their old one stays on the
board.
