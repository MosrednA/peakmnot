# Peak Mnot's score server

The high-score list for [Peak Mnot](../peak/README.md): a small server, Python's standard library and SQLite only,
that takes a climb from the game, checks it step by step against the route and Mnot's physics, and only then puts
the time on the board. In production the same server also serves the game, so page and API share one origin.

The game page's CSP permits the cookieless Plausible tracker and event requests at `https://stats.mosredna.eu`.
Inline scripts are allowed by their hashes. The [game analytics reference](../peak/README.md#analytics) lists the
goals and the exclusions for development and manual tests.

| File | What it does |
| --- | --- |
| `peak_scores.py` | The HTTP server: `/api/peak`, with `--static` the game's files too; security headers; the command line |
| `api.py` | The endpoints: rate limits, signatures and nonces, the checks on splits and the finish, the eggs |
| `verify.py` | The replay check: every step of a recorded climb against the route and the physics |
| `replayformat.py` | The replay's shape, checked before anything else reads it |
| `route.py`, `route.json` | The route as the game exported it (`peak/scores/routedata.js`), and the geometry questions about it |
| `store.py`, `db.py` | The data: runs, players, the board, the Hall of Shame; the schema and its migrations |
| `names.py`, `eggs.py` | The name filter, and what the server says to people poking at it |
| `perf.py` | The perf runs that `peak.html?perf` sends, kept as JSON lines ([docs/performance.md](../docs/performance.md)) |
| `export_route.py` | Refreshes `route.json` from the game (below) |
| `test_peak_scores.py`, `test_peak_parts.py`, `fixtures/` | The tests, and real recorded climbs they replay |
| `browser_bot.js` | An end-to-end check: a bot that climbs in a real browser and submits like a player |

## Running it

Next to the viewer (`python tools/dev_server.py` on port 5280), start the score server:

```sh
python -X utf8 server/peak_scores.py
```

It listens on `127.0.0.1:5281`. A page on port 5280 talks to it there; on any other origin the game uses
`/api/peak` on its own origin. `peak.html?manual` (tests and bots) never talks to the server. In development the
data lives in `data/` at the root (git-ignored), and without `PEAK_SECRET` the server makes a key in
`data/secret.key` the first time.

Settings come from the environment:

| Variable | Default | What for |
| --- | --- | --- |
| `DATA_DIR` | `data/` | Where the database (and the dev key) live; `/data` in the container |
| `PEAK_SECRET` | a generated `secret.key` | The key behind the player secrets' hashes and the hashed addresses. Required in production |
| `PEAK_SECRET_OLD` | empty | The previous key, only while rotating (below) |
| `ALLOWED_ORIGINS` | the viewer on 5280 | Origins that get CORS headers |
| `TRUSTED_PROXIES` | loopback | Networks whose `X-Forwarded-For` is believed (the right-most address that isn't theirs) |
| `HOST`, `PORT` | `127.0.0.1`, `5281` | Also `--host` and `--port` |

The command line also does housekeeping:

```sh
python server/peak_scores.py --backup data/backup.sqlite3   # a consistent copy, safe while the server runs
python server/peak_scores.py --reverify RUN_ID              # check a stored replay against today's route
python server/peak_scores.py --fixture latest --as NAME     # save a stored climb as a test fixture
```

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

`GET /api/peak/replay/RUN_ID` returns `{id, name, time, falls, dents, replay}` for that current best. The public
replay contains only `v`, `route`, `phase`, `samples` and `events`; it omits the raw inputs and the rest of the run
record. The route fingerprint lets the game check that a stored v1 replay matches its current route before playback.
Missing, unclaimed, shadow, house, and replaced best runs all return 404. This endpoint uses the same read rate limit
as the board.

`POST /api/peak/perf` takes a run of the perf probe (`peak.html?perf`, [docs/performance.md](../docs/performance.md)):
`{v: 1, text, …}`, at most 64 KB, 6 per address every 10 minutes. `perf.py` clips it (strings, numbers and three
levels deep only) and adds it as one line to `DATA_DIR/perf.jsonl` with the time, but no address; past 8 MB the file
moves to `perf.1.jsonl`. It needs no signature: a run is only numbers about a computer, and nothing reads them back.

### The house records

A fresh database comes with five slow, silly records (migration 2 in `db.py`): `while(true) climb()` 3:14.15,
`404: Peak Not Found` 4:04.0, `Dial-up Dave` 5:12.0, `git push --force` 6:28.3 and `Ctrl+Alt+Defeat` 13:37.0. They
are marked `house`: they rank by time like everyone else, so any climb faster than theirs goes above them, but
nobody can claim them or take their names (a look-alike name becomes a Mystery Can, with a note why). The game
shows them as ordinary rows, with their joke as a tooltip.

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
board or the shame list after a month.

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
`test_peak_parts.py` tests the name filter, the proxy addresses, the static files, the migrations and the checker.
Both replay the climbs in `fixtures/`, each with the route it was climbed on, so they keep testing the checker after
the route moves on (one test then skips, saying the fixtures are older than `route.json`).

To record a new fixture, climb for real with the browser bot against the dev servers: open
`http://127.0.0.1:5280/peak.html?keep=manual` (any "manual" in the address stops the live reload; this one doesn't
switch the game to manual) and run in the console:

```js
const bot = await import('/server/browser_bot.js'); bot.keepFrames(); await bot.drive(peak, { name: 'Bot Can' })
```

then `python -X utf8 server/peak_scores.py --fixture latest --as NAME`. `fixtures/climb` is such a climb
(1:17.88, no falls); `fixtures/falls` slid into the ring's hole once on purpose (`stumble: ['ring']`, 1:24.04).
The bot steers like `peak/dev/bots.js`'s `climb()` (round the ring too); teach it a new obstacle there first.
`keepFrames()` keeps the game going in a tab that's out of sight.

## Production

One container serves the game and the API: `Dockerfile` (python:3.12-slim, a non-root user, port 8080, a health
check on `/api/peak/health`), `docker-compose.yml` (the `peakmnot-data` volume, the environment) and `.mosdeploy.yml`
for MosDeploy at <https://peakmnot.mosredna.eu>. The image holds only `peak.html`, the favicons, the web
manifest, `sounds.js`, `music.js`, `peak/`, `models/mnot.glb`, the game's sounds and music, and the server; the
server serves only those files (an allowlist), with a Content-Security-Policy that hashes the page's inline scripts.

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
