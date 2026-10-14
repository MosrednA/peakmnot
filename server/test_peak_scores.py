"""The score server, end to end: a temp database, a fake clock, real HTTP on a free port, and real climbs recorded in
the browser by server/browser_bot.js (fixtures/*.json.gz, each with the route it was climbed on). The other parts
(names, addresses, static files, the checker on its own) are in test_peak_parts.py.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import contextlib
import copy
import gzip
import hashlib
import hmac
import http.client
import io
import json
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from peak_scores import App, networks     # noqa: E402
from route import Route                   # noqa: E402

ORIGIN = "http://127.0.0.1:5280"
HOUSE = 5                                 # house records in a fresh database (db.py, migration 2)


def fixture(name="climb"):
    return json.loads(gzip.decompress((HERE / "fixtures" / f"{name}.json.gz").read_bytes()))


class Clock:
    def __init__(self):
        self.now = 1_800_000_000.0

    def __call__(self):
        return self.now


class Reply:
    def __init__(self, status, headers, data):
        self.status, self.headers, self.data = status, headers, data
        try:
            self.json = json.loads(data)
        except ValueError:
            self.json = None

    def says(self):
        return self.headers.get("X-Mnot-Says")


class Server:
    """The score server in a temp folder, on a free port."""

    def __init__(self, route, static=False, downhill_route=None, levels=None):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.app = App(self.tmp.name, [b"k" * 32], [ORIGIN], networks("127.0.0.1/32"), static=static, route=route,
                       clock=self.clock, quiet=True, downhill_route=downhill_route, levels=levels)
        self.httpd = self.app.serve("127.0.0.1", 0)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.db.close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        h = {"Origin": ORIGIN, **(headers or {})}
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(method, path, body=body, headers=h)
        res = conn.getresponse()
        reply = Reply(res.status, res.headers, res.read())
        conn.close()
        return reply

    def raw(self, text):
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as s:
            s.sendall(text.encode())
            return s.recv(65536).decode("latin-1")


class Climber:
    """A game talking to the server: a run, signed requests, the clock moved along with the climb (or another game's
    run: test_downhill.py)."""

    def __init__(self, server, climb, t0=0, game="peak"):
        self.server, self.climb, self.game = server, climb, game
        self.start = server.clock.now
        r = server.request("POST", f"/api/{game}/run", {"v": 1, "route": climb["route"]["fingerprint"], "t0": t0})
        assert r.status == 201, r.data
        self.run, self.nonce, self.prev = r.json["run"], r.json["nonce"], None

    def at(self, ms):
        self.server.clock.now = self.start + ms / 1000 + 0.3

    def post(self, action, data, zipped=False, nonce=None, sig=None):
        body = json.dumps(data).encode()
        if zipped:
            return self.send(action, gzip.compress(body, mtime=0), "application/gzip", nonce, sig)
        return self.send(action, body, "application/json", nonce, sig)

    def send(self, action, body, kind, nonce=None, sig=None):
        sig = sig or hmac.new((nonce or self.nonce).encode(), body, hashlib.sha256).hexdigest()
        r = self.server.request("POST", f"/api/{self.game}/run/{self.run}/{action}", body,
                                {"Content-Type": kind, "X-Mnot-Sig": sig})
        if r.status == 200 and r.json and "nonce" in r.json and r.headers.get("X-Mnot-Replay") is None:
            self.prev, self.nonce = self.nonce, r.json["nonce"]
        return r

    def splits(self, splits=None):
        r = None
        for cp, t in splits or self.climb["splits"]:
            self.at(t)
            r = self.post("split", {"cp": cp, "t": t})
            if r.status != 200:
                break
        return r

    def finish(self, replay=None, claim=None, player=None):
        claim = claim or self.climb["claim"]
        self.at(claim.get("clock", claim["time"]))
        return self.post("finish", {**claim, "player": player, "replay": replay or self.climb["replay"]}, zipped=True)

    def claim(self, name, player=None, secret=None):
        return self.post("claim", {"name": name, "player": player, "secret": secret})

    def all_the_way(self, name="Test Can", player=None, secret=None):
        self.splits()
        self.finish(player=player)
        return self.claim(name, player, secret)


class ScoreTest(unittest.TestCase):
    climb_name = "climb"

    def setUp(self):
        self.climb = fixture(self.climb_name)
        self.server = Server(Route(self.climb["route"]))

    def tearDown(self):
        self.server.close()

    def board(self, me=None):
        return self.server.request("GET", "/api/peak/board?limit=50" + (f"&me={me}" if me else "")).json


class TheClimb(ScoreTest):
    def test_a_real_climb_goes_on_the_board(self):
        c = Climber(self.server, self.climb)
        self.assertEqual(c.splits().status, 200)
        r = c.finish()
        self.assertEqual(r.status, 200, r.data)
        self.assertEqual(r.json["rank"], 1)
        self.assertNotIn("psst", r.json)
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{c.run}").status, 404)
        r = c.claim("Test Can")
        self.assertEqual(r.status, 200)
        self.assertEqual((r.json["name"], r.json["rank"], r.json["improved"]), ("Test Can", 1, True))
        self.assertTrue(r.json["secret"])
        self.assertEqual(self.server.app.store.replay(c.run)[1], "ok")
        board = self.board(r.json["player"])
        self.assertEqual(board["entries"][0]["name"], "Test Can")
        self.assertTrue(board["entries"][0]["me"])
        self.assertEqual(board["entries"][0]["replayId"], c.run)
        self.assertEqual(board["total"], HOUSE + 1)
        public = self.server.request("GET", f"/api/peak/replay/{c.run}")
        self.assertEqual(public.status, 200, public.data)
        self.assertEqual(set(public.json), {"id", "name", "time", "falls", "dents", "replay"})
        self.assertEqual(public.json["id"], c.run)
        self.assertEqual(public.json["replay"], {key: self.climb["replay"][key]
                                                  for key in ("v", "route", "phase", "samples", "events")})
        self.assertNotIn("inputs", public.json["replay"])
        self.assertNotIn("secret", public.json)
        self.assertNotIn("nonce", public.json)
        self.assertNotIn("ip_hash", public.json)

    def test_my_replay_is_included_when_my_best_is_below_the_top_page(self):
        first = Climber(self.server, self.climb).all_the_way("First Can").json
        second_climber = Climber(self.server, self.climb)
        second = second_climber.all_the_way("Second Can").json
        board = self.server.request("GET", f"/api/peak/board?limit=1&me={second['player']}").json
        self.assertEqual(board["entries"][0]["name"], "First Can")
        self.assertEqual(board["me"]["name"], "Second Can")
        self.assertEqual(board["me"]["rank"], 2)
        self.assertEqual(board["me"]["replayId"], second_climber.run)
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{second_climber.run}").status, 200)

    def test_house_and_missing_replays_are_not_public(self):
        board = self.board()
        self.assertTrue(all(entry["replayId"] is None for entry in board["entries"]))
        for run_id in ("house-pi", "missing_123"):
            self.assertEqual(self.server.request("GET", f"/api/peak/replay/{run_id}").status, 404)

    def test_a_best_without_a_retained_replay_has_no_replay_id(self):
        climber = Climber(self.server, self.climb)
        claim = climber.all_the_way("Can Without Replay").json
        with self.server.app.db.tx() as c:
            c.execute("DELETE FROM replays WHERE run_id = ?", (climber.run,))
        board = self.board(claim["player"])
        self.assertIsNone(board["entries"][0]["replayId"])
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{climber.run}").status, 404)

    def test_the_house_records_sit_below_a_real_climb(self):
        board = self.board()
        self.assertEqual(len(board["entries"]), HOUSE)
        self.assertTrue(all(e["house"] and e["quip"] for e in board["entries"]))
        self.assertGreater(min(e["time"] for e in board["entries"]), 3 * 60 * 1000)
        Climber(self.server, self.climb).all_the_way()
        entries = self.board()["entries"]
        self.assertEqual([e.get("house", False) for e in entries], [False] + [True] * HOUSE)
        self.assertEqual([e["rank"] for e in entries], list(range(1, HOUSE + 2)))

    def test_the_house_records_are_seeded_once(self):
        import games
        app = self.server.app
        again = App(self.server.tmp.name, [b"k" * 32], [ORIGIN], [], route=app.route, quiet=True)
        try:                                            # a restart runs the migrations and the seeding again: nothing new
            rows = again.db.all("SELECT s.game, COUNT(*) AS n FROM scores s JOIN players p ON p.id = s.player_id "
                                "WHERE p.house = 1 GROUP BY s.game ORDER BY s.game")
            self.assertEqual({r["game"]: r["n"] for r in rows}, {"peak": HOUSE, "downhill": len(games.DOWNHILL_HOUSE)})
            self.assertEqual(again.db.one("SELECT COUNT(*) FROM players WHERE house = 1")[0],
                             HOUSE + len(games.DOWNHILL_HOUSE))
        finally:
            again.db.close()

    def test_a_showcased_climb_plays_by_link_but_stays_off_the_board(self):
        import peak_scores
        app = self.server.app
        path = Path(self.server.tmp.name) / "replay.json"

        def showcase(replay, name="AI Mnot"):
            path.write_text(json.dumps(replay), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = peak_scores.showcase(app, str(path), name)
            return code, out.getvalue()

        code, said = showcase(self.climb["replay"])
        self.assertEqual(code, 0, said)
        run_id = said.rsplit("replay=", 1)[1].strip()
        public = self.server.request("GET", f"/api/peak/replay/{run_id}")
        self.assertEqual(public.status, 200, public.data)
        self.assertEqual([public.json[k] for k in ("name", "time", "falls", "dents")],
                         ["AI Mnot"] + [self.climb["claim"][k] for k in ("time", "falls", "dents")])
        self.assertEqual(public.json["replay"], {key: self.climb["replay"][key]
                                                  for key in ("v", "route", "phase", "samples", "events")})
        self.assertEqual(self.board()["total"], HOUSE)                 # not on the board
        self.assertTrue(all(e["name"] != "AI Mnot" for e in self.board()["entries"]))
        self.server.clock.now += 365 * 86400                           # and never forgotten
        app.store.purge()
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{run_id}").status, 200)
        edited = copy.deepcopy(self.climb["replay"])
        edited["samples"][len(edited["samples"]) // 2][1] += 5000      # 5 m (in mm) sideways in a tenth of a second
        self.assertEqual(showcase(edited)[0], 1)
        self.assertEqual(showcase(self.climb["replay"], "")[0], 1)
        self.assertEqual(app.db.one("SELECT COUNT(*) FROM showcase")[0], 1)

    def test_nobody_claims_a_house_record(self):
        c = Climber(self.server, self.climb)
        c.splits()
        c.finish()
        r = c.claim("Dial-up Dave", player="house-56k", secret="!")
        self.assertEqual((r.status, r.json["error"]), (403, "house"))
        r = c.claim("d1al up DAVE")                       # its name neither
        self.assertEqual(r.status, 200)
        self.assertTrue(r.json["name"].startswith("Mystery Can #"))
        self.assertIn("house record", r.json["nameNote"])
        self.assertEqual(len([e for e in self.board()["entries"] if e["name"] == "Dial-up Dave"]), 1)

    def test_a_best_only_gets_better(self):
        first_climber = Climber(self.server, self.climb)
        first = first_climber.all_the_way("First Name").json
        me, secret = first["player"], first["secret"]
        again = Climber(self.server, self.climb).all_the_way("New Name", me, secret).json
        self.assertEqual((again["improved"], again["name"], again["player"]), (False, "New Name", me))
        self.assertNotIn("secret", again)
        store = self.server.app.store
        best_run_id = None
        for time_ms, better in ((90000, False), (60000, True)):
            run_id, _ = store.new_run("x", 0)
            if better:
                claim = {"time": time_ms, "falls": 0, "dents": 0}
                replay = gzip.compress(json.dumps(self.climb["replay"], separators=(",", ":")).encode())
                store.finish(store.run(run_id), b"{}", claim, "ok", None, replay, {})
                best_run_id = run_id
            else:
                with store.db.tx() as c:
                    c.execute("UPDATE runs SET state = 'verified', time_ms = ?, falls = 0, dents = 0 WHERE id = ?",
                              (time_ms, run_id))
            _, response = store.claim(store.run(run_id), b"{}", me, secret, "New Name")
            self.assertEqual(response["improved"], better)
        self.assertEqual(store.best(me)["time"], 60000)
        self.assertEqual(sum(1 for e in self.board()["entries"] if not e.get("house")), 1)
        self.assertEqual(self.board()["entries"][0]["replayId"], best_run_id)
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{best_run_id}").json["time"], 60000)
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{first_climber.run}").status, 404)

    def test_a_lost_answer_can_be_asked_again(self):
        c = Climber(self.server, self.climb)
        c.splits()
        first = c.finish()
        retry = c.finish()                                # signed with the new nonce: a second finish
        self.assertEqual((retry.status, retry.json["error"]), (418, "duplicate"))
        c = Climber(self.server, self.climb)
        c.splits()
        first = c.finish()
        again = c.post("finish", {**self.climb["claim"], "player": None, "replay": self.climb["replay"]},
                       zipped=True, nonce=c.prev)         # the same request again, as if its answer got lost
        self.assertEqual((again.status, again.headers.get("X-Mnot-Replay")), (200, "1"))
        self.assertEqual(again.json, first.json)


class Cheats(ScoreTest):
    def shadow(self, replay=None, claim=None, splits=None):
        c = Climber(self.server, self.climb)
        self.assertEqual(c.splits(splits).status, 200)
        r = c.finish(replay=replay, claim=claim)
        self.assertEqual(r.status, 200, r.data)
        self.assertEqual(r.json["rank"], 1)               # it looks like a win...
        self.assertTrue(r.json["psst"])
        self.assertEqual(r.says(), r.json["psst"])
        return c, r, self.server.app.store.replay(c.run)[1]

    def tampered(self):
        return copy.deepcopy(self.climb["replay"])

    def test_a_teleport_is_shadowed_and_shamed(self):
        replay = self.tampered()
        solids = self.server.app.route.solids
        ground = [i for i, s in enumerate(replay["samples"]) if s[7] == 0 and s[0] > 5000 and not solids[s[9]].moving]
        i, j = ground[0], ground[len(ground) // 2]
        replay["samples"][i][1:4] = replay["samples"][j][1:4]
        c, r, verdict = self.shadow(replay)
        self.assertIn(verdict, ("teleport", "too_fast"))
        r = c.claim("Speedy")
        self.assertEqual((r.status, r.json["rank"]), (200, 1))
        fake = r.json["player"]
        self.assertTrue(self.board(fake)["entries"][0]["me"])           # their own board still says #1
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{c.run}").status, 404)
        self.assertTrue(all(entry["replayId"] is None for entry in self.board()["entries"]))
        self.assertNotIn("Speedy", [e["name"] for e in self.board()["entries"]])   # nobody else's does
        shame = self.server.request("GET", "/api/peak/shame").json["hallOfShame"]
        self.assertEqual((shame[0]["name"], shame[0]["reason"]), ("Speedy", verdict))

    def test_flying_is_detected(self):
        replay = self.tampered()
        flights = [i for i, (a, b) in enumerate(zip(replay["samples"], replay["samples"][1:]))
                   if a[7] == 1 and b[7] == 1]
        replay["samples"][flights[0] + 1][2] += 300
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "antigravity")
        self.assertIn("Peak Mnot detected", r.json["psst"])

    def test_a_squeezed_clock_is_too_fast(self):
        replay, k = self.tampered(), 0.8
        for row in replay["samples"] + replay["inputs"] + replay["events"]:
            row[0] = round(row[0] * k)
        claim = dict(self.climb["claim"], time=replay["samples"][-1][0])
        splits = [(cp, round(t * k)) for cp, t in self.climb["splits"]]
        _, r, verdict = self.shadow(replay, claim, splits)
        self.assertIn(verdict, ("too_fast", "antigravity"))

    def test_jumps_need_space(self):
        replay = self.tampered()
        replay["events"] = [e for e in replay["events"] if e[1] != "space"]
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "spacebar")

    def test_moving_needs_keys(self):
        replay = self.tampered()
        replay["inputs"] = []
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "moonwalk")
        self.assertIn("Shift", r.json["psst"])

    def test_the_claim_must_be_the_replays(self):
        claim = dict(self.climb["claim"], falls=self.climb["claim"]["falls"] + 1)
        _, r, verdict = self.shadow(claim=claim)
        self.assertEqual(verdict, "edited")

    def test_a_split_too_soon(self):
        c = Climber(self.server, self.climb)
        c.at(3000)
        r = c.post("split", {"cp": 1, "t": 3000})
        self.assertEqual((r.status, r.json["error"]), (422, "too_fast_split"))
        self.assertIn("can-lengths a second", r.says())
        self.assertEqual(c.post("split", {"cp": 1, "t": 30000}).json["error"], "burned")

    def test_a_split_from_the_future(self):
        c = Climber(self.server, self.climb)
        c.at(1000)
        r = c.post("split", {"cp": 1, "t": 60000})
        self.assertEqual((r.status, r.json["error"]), (422, "time_travel"))

    def test_skipping_a_checkpoint(self):
        c = Climber(self.server, self.climb)
        c.at(60000)
        self.assertEqual(c.post("split", {"cp": 2, "t": 59000}).json["error"], "skipped_split")
        c = Climber(self.server, self.climb)
        self.assertEqual(c.finish().json["error"], "skipped_split")

    def test_signatures_and_nonces(self):
        c = Climber(self.server, self.climb)
        c.at(20000)
        self.assertEqual(c.post("split", {"cp": 1, "t": 19000}, sig="0" * 64).status, 418)
        self.assertEqual(c.post("split", {"cp": 1, "t": 19000}, sig="nope").json["error"], "teapot")
        self.assertEqual(c.post("split", {"cp": 1, "t": 19000}).status, 200)       # not burned by a bad sig
        r = c.post("split", {"cp": 2, "t": 19500}, nonce=c.prev)                   # an old nonce, a new body
        self.assertEqual((r.status, r.json["error"]), (418, "stale"))
        r = c.post("split", {"cp": 1, "t": 19000}, nonce=c.prev)                   # an old nonce, the same body
        self.assertEqual((r.status, r.headers.get("X-Mnot-Replay")), (200, "1"))

    def test_a_claimed_run_is_spent(self):
        c = Climber(self.server, self.climb)
        c.all_the_way()
        r = c.claim("Twice")
        self.assertEqual((r.status, r.json["error"]), (418, "duplicate"))

    def test_someone_elses_secret(self):
        owner = Climber(self.server, self.climb).all_the_way("Owner").json
        c = Climber(self.server, self.climb)
        c.splits()
        c.finish()
        r = c.claim("Thief", owner["player"], "guess")
        self.assertEqual((r.status, r.json["error"]), (403, "forged_secret"))
        r = c.claim("Thief")                               # the run isn't burned: as a new player it's fine
        self.assertEqual((r.status, r.json["name"]), (200, "Thief"))
        self.assertNotEqual(r.json["player"], owner["player"])

    def test_names_that_are_code(self):
        c = Climber(self.server, self.climb)
        c.splits()
        c.finish()
        r = c.claim("<img src=x onerror=alert(1)>")
        self.assertEqual(r.json["name"], "Little Bobby Cans")
        self.assertIn("Bobby Tables", r.json["nameNote"])

    def test_an_expired_run(self):
        c = Climber(self.server, self.climb)
        c.at(4 * 3600 * 1000)
        self.assertEqual(c.post("split", {"cp": 1, "t": 19000}).status, 410)

    def test_payloads_that_are_too_big_or_broken(self):
        c = Climber(self.server, self.climb)
        r = self.server.request("POST", f"/api/peak/run/{c.run}/split", b"x" * (600 * 1024),
                                {"Content-Type": "application/json", "X-Mnot-Sig": "0" * 64})
        self.assertEqual((r.status, r.json["error"]), (413, "oversized"))
        c.splits()
        bomb = gzip.compress(b'{"replay": "' + b"0" * (3 * 1024 * 1024) + b'"}')     # 3 MB in about 3 kB
        r = c.send("finish", bomb, "application/gzip")
        self.assertEqual((r.status, r.json["error"]), (413, "oversized"))
        c = Climber(self.server, self.climb)
        c.splits()
        r = c.finish(replay={"v": 1, "samples": "lots"})
        self.assertEqual((r.status, r.json["error"]), (400, "malformed"))
        r = self.server.request("POST", "/api/peak/run", b"{not json", {"Content-Type": "application/json"})
        self.assertEqual(r.status, 400)
        reply = self.server.raw("POST /api/peak/run HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n")
        self.assertTrue(reply.startswith("HTTP/1.1 400"))

    def test_a_stale_page(self):
        r = self.server.request("POST", "/api/peak/run", {"v": 1, "route": "an old one", "t0": 0})
        self.assertEqual((r.status, r.json["error"]), (409, "route"))


class Limits(ScoreTest):
    def test_reading_too_often(self):
        for _ in range(120):
            self.assertEqual(self.server.request("GET", "/api/peak/board").status, 200)
        r = self.server.request("GET", "/api/peak/board")
        self.assertEqual((r.status, r.json["error"]), (429, "rate"))
        self.assertIn("not a CDN", r.says())
        self.assertTrue(r.headers.get("Retry-After"))

    def test_starting_too_often(self):
        for _ in range(30):
            Climber(self.server, self.climb)
        r = self.server.request("POST", "/api/peak/run", {"v": 1, "route": self.climb["route"]["fingerprint"], "t0": 0})
        self.assertEqual(r.status, 429)


class Eggs(ScoreTest):
    def test_the_jokes(self):
        get = lambda path: self.server.request("GET", path)
        self.assertIn("Robots may not climb", get("/robots.txt").data.decode())
        self.assertEqual(get("/.well-known/mnot").json["species"], "soda can (330 ml)")
        for path in ("/wp-login.php", "/.env", "/api/peak/admin", "/api/peak/admin/users"):
            r = get(path)
            self.assertEqual((r.status, r.json["error"]), (418, "probe"), path)
        self.assertEqual(self.server.request("PUT", "/api/peak/board").status, 405)
        self.assertEqual(get("/api/peak/nothing").status, 404)
        self.assertTrue(all(get(p).says() for p in ("/api/peak/health", "/api/peak/board", "/nope")))

    def test_cors_only_for_the_game(self):
        ok = self.server.request("OPTIONS", "/api/peak/run")
        self.assertEqual(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN)
        evil = self.server.request("OPTIONS", "/api/peak/run", headers={"Origin": "https://evil.example"})
        self.assertIsNone(evil.headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main()
