"""The high-score logic on top of db.py: runs and their rolling nonces, splits, verdicts and replays, players, the
board and the Hall of Shame. No HTTP here (that's api.py), and no physics (verify.py).

The board: one entry per player, their best climb. Faster time wins; on the same time (to the millisecond) fewer
falls; then whoever got there first. Dents are shown, not ranked: they pop out at every checkpoint anyway. The house
records (db.py, migration 2) are players too, marked house: nobody can claim, improve or take the name of one.
A showcased climb (migration 3) is the other way round: its replay plays by link, but it's never on the board.
"""
import gzip
import hashlib
import hmac
import json
import secrets
import time
import zlib

RUN_TTL = 3 * 3600              # a run must finish within this many seconds of starting
CLAIM_TTL = 3600                # and be claimed (named) within this many seconds of finishing
KEEP_RUNS = 7 * 86400           # unfinished and unclaimed runs are forgotten after a week
KEEP_REPLAYS = 30 * 86400       # replays that aren't on the board, the shame list or showcased, after a month

BOARD_SELECT = (
    "SELECT s.player_id, s.time_ms, s.falls, s.dents, s.achieved, p.name, p.house, p.quip, "
    "CASE WHEN p.house = 0 AND r.id IS NOT NULL AND rp.run_id IS NOT NULL THEN s.run_id END AS replay_id, "
    "RANK() OVER (ORDER BY s.time_ms, s.falls, s.achieved) AS rank "
    "FROM scores s JOIN players p ON p.id = s.player_id "
    "LEFT JOIN runs r ON r.id = s.run_id AND r.player_id = s.player_id AND r.state = 'claimed' "
    "AND r.verdict = 'ok' AND r.time_ms = s.time_ms AND r.falls = s.falls AND r.dents = s.dents "
    "LEFT JOIN replays rp ON rp.run_id = s.run_id AND rp.verdict = 'ok' "
)


def token(n=18):
    return secrets.token_urlsafe(n)


def body_hash(raw):
    return hashlib.sha256(raw).hexdigest()


class Store:
    def __init__(self, db, keys, clock=time.time):
        """keys: the server's secret keys, newest first (an older one only checks player secrets during a
        rotation; see README)."""
        self.db = db
        self.keys = [k if isinstance(k, bytes) else k.encode() for k in keys]
        self.clock = clock

    def mac(self, purpose, value, key=None):
        return hmac.new(key or self.keys[0], f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()

    def ip_hash(self, ip):
        return self.mac("ip", ip)[:20]

    # ------------------------------------------------------------------ runs

    def new_run(self, ip_hash, t0):
        run_id, nonce, now = token(12), token(18), self.clock()
        with self.db.tx() as c:
            c.execute("INSERT INTO runs (id, nonce, ip_hash, created, t0, state) VALUES (?, ?, ?, ?, ?, 'open')",
                      (run_id, nonce, ip_hash, now, t0))
        return run_id, nonce

    def run(self, run_id):
        return self.db.one("SELECT * FROM runs WHERE id = ?", (run_id,))

    def expired(self, run):
        now = self.clock()
        if run["state"] in ("open",):
            return now - run["created"] > RUN_TTL
        if run["state"] in ("verified", "shadow"):
            return now - (run["finished"] or run["created"]) > CLAIM_TTL
        return False

    def reply(self, c, run_id, raw, status, response):
        """Swap the nonce for a fresh one and remember this answer, so a retry of the same request (with the nonce
        it was signed with) gets the same answer. Inside the request's transaction."""
        nonce = token(18)
        response = dict(response, nonce=nonce)
        text = json.dumps(response, separators=(",", ":"))
        c.execute("UPDATE runs SET prev_nonce = nonce, nonce = ?, last_hash = ?, last_status = ?, last_response = ? "
                  "WHERE id = ?", (nonce, body_hash(raw), status, text, run_id))
        return status, response

    def burn(self, run_id):
        with self.db.tx() as c:
            # the nonce stays, so whoever sends the next request with it hears that the run is burned
            c.execute("UPDATE runs SET state = 'burned', prev_nonce = NULL WHERE id = ?", (run_id,))

    def add_split(self, run, raw, cp, t):
        splits = json.loads(run["splits"])
        splits.append([cp, t, round((self.clock() - run["created"]) * 1000)])
        with self.db.tx() as c:
            c.execute("UPDATE runs SET splits = ? WHERE id = ?", (json.dumps(splits), run["id"]))
            return self.reply(c, run["id"], raw, 200, {"ok": True})

    def finish(self, run, raw, claim, verdict, details, replay_gz, response):
        """Store the climb's verdict and its replay; verdict is 'ok' or the reason it was turned down."""
        now = self.clock()
        state = "verified" if verdict == "ok" else "shadow"
        with self.db.tx() as c:
            c.execute("UPDATE runs SET state = ?, time_ms = ?, falls = ?, dents = ?, verdict = ?, finished = ? "
                      "WHERE id = ?", (state, claim["time"], claim["falls"], claim["dents"], verdict, now, run["id"]))
            c.execute("INSERT OR REPLACE INTO replays (run_id, data, verdict, details, created) VALUES (?, ?, ?, ?, ?)",
                      (run["id"], replay_gz, verdict, details, now))
            return self.reply(c, run["id"], raw, 200, response)

    # ------------------------------------------------------------------ players

    def player(self, player_id):
        if not isinstance(player_id, str) or len(player_id) > 40:
            return None
        return self.db.one("SELECT * FROM players WHERE id = ?", (player_id,))

    def check_secret(self, player, secret):
        if not isinstance(secret, str) or len(secret) > 100:
            return False
        for key in self.keys:
            if hmac.compare_digest(self.mac("player", secret, key), player["secret_hash"]):
                if key is not self.keys[0]:          # rotated: re-key it with the new secret
                    with self.db.tx() as c:
                        c.execute("UPDATE players SET secret_hash = ? WHERE id = ?",
                                  (self.mac("player", secret), player["id"]))
                return True
        return False

    def house_names(self):
        return [row["name"] for row in self.db.all("SELECT name FROM players WHERE house = 1")]

    def best(self, player_id):
        row = self.db.one("SELECT time_ms, falls, dents, achieved FROM scores WHERE player_id = ?", (player_id,))
        return row and {"time": row["time_ms"], "falls": row["falls"], "dents": row["dents"]}

    # ------------------------------------------------------------------ the board

    def rank_of(self, time_ms, falls, achieved, exclude=None):
        """1 + the entries ahead of this climb, leaving out exclude (a player's own entry)."""
        row = self.db.one("SELECT COUNT(*) FROM scores WHERE (time_ms < ? OR time_ms = ? AND falls < ? OR "
                          "time_ms = ? AND falls = ? AND achieved < ?) AND player_id IS NOT ?",
                          (time_ms, time_ms, falls, time_ms, falls, achieved, exclude))
        return row[0] + 1

    def total(self):
        return self.db.one("SELECT COUNT(*) FROM scores")[0]

    def verdict(self, player_id, time_ms, falls):
        """Where a climb just checked would rank, and the player's best so far."""
        known = self.player(player_id) if player_id else None
        best = self.best(player_id) if known and not known["house"] else None
        others = self.total() - (1 if best else 0)
        return {"rank": self.rank_of(time_ms, falls, self.clock(), exclude=player_id), "total": others + 1,
                "best": best}

    def entry(self, row, me):
        entry = {"rank": row["rank"], "name": row["name"], "time": row["time_ms"], "falls": row["falls"],
                 "dents": row["dents"], "me": row["player_id"] == me, "replayId": row["replay_id"]}
        if row["house"]:
            entry.update(house=True, quip=row["quip"])
        return entry

    def board(self, limit=10, me=None):
        rows = self.db.all(BOARD_SELECT + "ORDER BY s.time_ms, s.falls, s.achieved LIMIT ?", (limit,))
        entries = [self.entry(r, me) for r in rows]
        mine = None
        if me and not any(e["me"] for e in entries):
            row = self.db.one(BOARD_SELECT + "WHERE s.player_id = ?", (me,))
            if row:
                mine = dict(self.entry(dict(row, rank=self.rank_of(row["time_ms"], row["falls"], row["achieved"],
                                                                     exclude=me)), me))
            else:
                return self.shadow_board(limit, me) or {"entries": entries, "me": None, "total": self.total()}
        return {"entries": entries, "me": mine, "total": self.total()}

    def claim(self, run, raw, player_id, secret, name):
        """Put a checked climb on the board: a new player, or a better time (and the name) for one we know."""
        now = self.clock()
        new_secret = None
        with self.db.tx() as c:
            if player_id is None:
                player_id, new_secret = secrets.token_hex(8), token(24)
                c.execute("INSERT INTO players (id, secret_hash, name, created, updated) VALUES (?, ?, ?, ?, ?)",
                          (player_id, self.mac("player", new_secret), name, now, now))
            else:
                c.execute("UPDATE players SET name = ?, updated = ? WHERE id = ?", (name, now, player_id))
            old = c.execute("SELECT time_ms, falls FROM scores WHERE player_id = ?", (player_id,)).fetchone()
            improved = old is None or (run["time_ms"], run["falls"]) < (old["time_ms"], old["falls"])
            if improved:
                c.execute("INSERT INTO scores (player_id, time_ms, falls, dents, run_id, achieved) "
                          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET time_ms = excluded.time_ms, "
                          "falls = excluded.falls, dents = excluded.dents, run_id = excluded.run_id, "
                          "achieved = excluded.achieved",
                          (player_id, run["time_ms"], run["falls"], run["dents"], run["id"], now))
            c.execute("UPDATE runs SET state = 'claimed', player_id = ?, claimed = ? WHERE id = ?",
                      (player_id, now, run["id"]))
            mine = c.execute("SELECT time_ms, falls, dents, achieved FROM scores WHERE player_id = ?",
                             (player_id,)).fetchone()
            rank = 1 + c.execute("SELECT COUNT(*) FROM scores WHERE (time_ms < ? OR time_ms = ? AND falls < ? OR "
                                 "time_ms = ? AND falls = ? AND achieved < ?) AND player_id IS NOT ?",
                                 (mine["time_ms"], mine["time_ms"], mine["falls"], mine["time_ms"], mine["falls"],
                                  mine["achieved"], player_id)).fetchone()[0]
            response = {"player": player_id, "name": name, "rank": rank, "improved": improved,
                        "best": {"time": mine["time_ms"], "falls": mine["falls"], "dents": mine["dents"]}}
            if new_secret:
                response["secret"] = new_secret
            status, response = self.reply(c, run["id"], raw, 200, response)
        response["board"] = self.board(10, player_id)
        return status, response

    # ------------------------------------------------------------------ the Hall of Shame

    def shame(self, run, raw, name, reason, extra):
        """A climb that didn't add up, claimed anyway: it goes on the shame list, and its climber is told they're
        number one (and their own board keeps saying so)."""
        now, fake = self.clock(), secrets.token_hex(8)
        with self.db.tx() as c:
            c.execute("INSERT INTO shame (run_id, ip_hash, player_id, name, claimed_ms, reason, created) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)", (run["id"], run["ip_hash"], fake, name, run["time_ms"], reason, now))
            c.execute("UPDATE runs SET state = 'claimed', claimed = ? WHERE id = ?", (now, run["id"]))
            response = {"player": fake, "secret": token(24), "name": name, "rank": 1, "improved": True,
                        "best": {"time": run["time_ms"], "falls": run["falls"], "dents": run["dents"]}, **extra}
            status, response = self.reply(c, run["id"], raw, 200, response)
        response["board"] = self.shadow_board(10, fake)
        return status, response

    def shadow_board(self, limit, fake):
        row = self.db.one("SELECT name, claimed_ms FROM shame WHERE player_id = ?", (fake,))
        if not row:
            return None
        real = self.board(limit - 1)
        top = {"rank": 1, "name": row["name"], "time": row["claimed_ms"], "falls": 0, "dents": 0,
               "me": True, "replayId": None}
        entries = [top] + [dict(e, rank=e["rank"] + 1) for e in real["entries"]]
        return {"entries": entries, "me": None, "total": real["total"] + 1}

    def hall_of_shame(self, limit=20):
        rows = self.db.all("SELECT name, claimed_ms, reason, created FROM shame ORDER BY id DESC LIMIT ?", (limit,))
        return [{"name": r["name"], "claimed": r["claimed_ms"], "reason": r["reason"],
                 "when": time.strftime("%Y-%m-%d", time.gmtime(r["created"]))} for r in rows]

    # ------------------------------------------------------------------ housekeeping

    def purge(self):
        now = self.clock()
        with self.db.tx() as c:
            c.execute("DELETE FROM runs WHERE created < ? AND id NOT IN (SELECT run_id FROM scores)", (now - KEEP_RUNS,))
            c.execute("DELETE FROM replays WHERE created < ? AND run_id NOT IN (SELECT run_id FROM scores) AND "
                      "run_id NOT IN (SELECT run_id FROM shame WHERE run_id IS NOT NULL) AND "
                      "run_id NOT IN (SELECT run_id FROM showcase)", (now - KEEP_REPLAYS,))

    def showcase(self, name, claim, replay_gz):
        """Keep a checked climb to be shown by link only, never on the board; returns its id for the link."""
        run_id, now = token(12), self.clock()
        with self.db.tx() as c:
            c.execute("INSERT INTO replays (run_id, data, verdict, details, created) VALUES (?, ?, 'ok', NULL, ?)",
                      (run_id, replay_gz, now))
            c.execute("INSERT INTO showcase (run_id, name, time_ms, falls, dents, created) VALUES (?, ?, ?, ?, ?, ?)",
                      (run_id, name, claim["time"], claim["falls"], claim["dents"], now))
        return run_id

    def replay(self, run_id):
        row = self.db.one("SELECT data, verdict, details FROM replays WHERE run_id = ?", (run_id,))
        return row and (json.loads(gzip.decompress(row["data"])), row["verdict"], row["details"])

    def public_replay(self, run_id):
        """Return only a claimed player's current, verified best replay, or a showcased one, and its public fields."""
        row = self.db.one(
            "SELECT p.name, s.time_ms, s.falls, s.dents, rp.data "
            "FROM scores s JOIN players p ON p.id = s.player_id "
            "JOIN runs r ON r.id = s.run_id AND r.player_id = s.player_id "
            "JOIN replays rp ON rp.run_id = s.run_id "
            "WHERE s.run_id = ? AND p.house = 0 AND r.state = 'claimed' AND r.verdict = 'ok' "
            "AND rp.verdict = 'ok' AND r.time_ms = s.time_ms AND r.falls = s.falls AND r.dents = s.dents",
            (run_id,)) or self.db.one(
            "SELECT sc.name, sc.time_ms, sc.falls, sc.dents, rp.data FROM showcase sc "
            "JOIN replays rp ON rp.run_id = sc.run_id WHERE sc.run_id = ? AND rp.verdict = 'ok'", (run_id,))
        if not row:
            return None
        try:
            replay = json.loads(gzip.decompress(row["data"]))
        except (OSError, EOFError, ValueError, UnicodeDecodeError, RecursionError, zlib.error):
            return None
        if not isinstance(replay, dict) or any(key not in replay for key in ("v", "route", "phase", "samples", "events")):
            return None
        return {"id": run_id, "name": row["name"], "time": row["time_ms"], "falls": row["falls"],
                "dents": row["dents"],
                "replay": {key: replay[key] for key in ("v", "route", "phase", "samples", "events")}}
