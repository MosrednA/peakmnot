"""The score server's parts on their own: the name filter, the caller's address behind a proxy, the static files and
their headers, the database's migrations, the perf runs, and the replay checker on the recorded climbs (fixtures/).
The API end to end is test_peak_scores.py.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import ipaddress
import json
import re
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import names                                               # noqa: E402
import peak_scores                                         # noqa: E402
import perf                                                # noqa: E402
import verify                                              # noqa: E402
from db import Database, MIGRATIONS                        # noqa: E402
from peak_scores import client_ip, networks, page_csp      # noqa: E402
from route import Route                                    # noqa: E402
from test_peak_scores import Server, fixture               # noqa: E402

FIXTURES = sorted(p.name.split(".")[0] for p in (HERE / "fixtures").glob("*.json.gz"))


class Names(unittest.TestCase):
    def test_ordinary_names_stay(self):
        for name in ("Mnot", "Bass Can", "Catering Can", "Assassin", "I <3 Mnot", "Zoë", "git push --force"):
            self.assertEqual(names.clean(name), (name, None), name)

    def test_tidied(self):
        self.assertEqual(names.clean("Ｍｎｏｔ")[0], "Mnot")                         # fullwidth
        self.assertEqual(names.clean("Mn‮ot​")[0], "Mnot")                # bidi and zero-width
        self.assertEqual(names.clean("  lots   of   space  ")[0], "lots of space")
        self.assertEqual(len(names.clean("A" * 50)[0]), names.MAX_LENGTH)
        self.assertLessEqual(len(names.clean("Z" + "́" * 30)[0]), 3)          # zalgo

    def test_empty_is_a_mystery(self):
        for raw in (None, "", "   ", "!!!", "\x07\x1b"):
            self.assertRegex(names.clean(raw)[0], r"^Mystery Can #\d{4}$", repr(raw))

    def test_rude(self):
        for raw in ("fuck", "Fuuuuck you", "sh1t", "f u c k", "KANKER", "klootzak!"):
            name, note = names.clean(raw)
            self.assertRegex(name, r"^Polite Can #\d{4}$", raw)
            self.assertTrue(note)

    def test_code_is_bobby(self):
        for raw in ("<script>alert(1)</script>", "x' OR '1'='1", "Robert'); DROP TABLE players;--", "${7*7}",
                    "{{constructor}}", "javascript:alert(1)", '"><svg onload=alert(1)>'):
            self.assertEqual(names.clean(raw)[0], "Little Bobby Cans", raw)

    def test_not_a_string(self):
        with self.assertRaises(ValueError):
            names.clean(["list"])

    def test_house_names_are_taken(self):
        house = ["Dial-up Dave", "while(true) climb()"]
        for raw in ("dial-up dave", "DIAL UP DAVE", "D1al-up Dave", "While(True) Climb()"):
            self.assertTrue(names.taken(raw, house), raw)
        self.assertFalse(names.taken("Dave", house))


class Addresses(unittest.TestCase):
    trusted = networks("127.0.0.1/32, 172.16.0.0/12")

    def test_only_a_trusted_proxy_is_believed(self):
        self.assertEqual(client_ip("203.0.113.9", "1.2.3.4", self.trusted), "203.0.113.9")
        self.assertEqual(client_ip("172.18.0.2", "1.2.3.4", self.trusted), "1.2.3.4")
        self.assertEqual(client_ip("172.18.0.2", "6.6.6.6, 1.2.3.4", self.trusted), "1.2.3.4")   # left is a lie
        self.assertEqual(client_ip("172.18.0.2", "1.2.3.4, 172.18.0.5", self.trusted), "1.2.3.4")
        self.assertEqual(client_ip("172.18.0.2", "nonsense", self.trusted), "172.18.0.2")
        self.assertEqual(client_ip("127.0.0.1", None, self.trusted), "127.0.0.1")
        self.assertIsInstance(self.trusted[1], ipaddress.IPv4Network)


class StaticFiles(unittest.TestCase):
    def setUp(self):
        self.server = Server(Route(fixture()["route"]), static=True)

    def tearDown(self):
        self.server.close()

    def test_the_game_is_served(self):
        r = self.server.request("GET", "/")
        self.assertEqual(r.status, 200)
        csp = r.headers["Content-Security-Policy"]
        self.assertIn("'sha256-", csp)
        directives = dict(part.strip().split(" ", 1) for part in csp.split(";") if part.strip())
        for kind in ("script-src", "connect-src"):
            self.assertIn("https://stats.mosredna.eu", directives[kind].split())
        self.assertNotIn("'unsafe-inline'", directives["script-src"])
        self.assertNotIn("unsafe-inline' https://cdn", csp)
        # only the mascot site may show the page in an iframe; everything else stays unframeable
        self.assertEqual(directives["frame-ancestors"].split(), ["https://mnot.nl", "https://*.mnot.nl"])
        self.assertNotIn("X-Frame-Options", r.headers)
        self.assertEqual(self.server.request("GET", "/peak/main.js").headers["X-Frame-Options"], "DENY")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["Referrer-Policy"], "no-referrer")
        tag = r.headers["ETag"]
        self.assertEqual(self.server.request("GET", "/peak.html", headers={"If-None-Match": tag}).status, 304)
        self.assertEqual(self.server.request("GET", "/peak/main.js").status, 200)
        self.assertEqual(self.server.request("HEAD", "/peak/scores/scores.css").status, 200)
        for path, kind in (("/favicon.png", "image/png"), ("/favicon.ico", "image/x-icon"),
                           ("/manifest.webmanifest", "application/manifest+json"), ("/share.jpg", "image/jpeg"),
                           ("/share-downhill.jpg", "image/jpeg"), ("/share-games.jpg", "image/jpeg")):
            icon = self.server.request("GET", path)
            self.assertEqual((icon.status, icon.headers["Content-Type"]), (200, kind), path)

    def test_the_code_loads_through_the_build(self):
        page = self.server.request("GET", "/").data
        build = re.search(rb'src="v/([0-9a-f]{12})/peak/main\.js"', page).group(1).decode()
        self.assertIn(f'href="v/{build}/peak/ui/title.css"'.encode(), page)
        self.assertIn(b'href="models/mnot.glb"', page)                  # the model and sounds load by the page's path
        self.assertIn(f"-{build}", self.server.request("GET", "/").headers["ETag"])
        for path in ("/peak/main.js", "/music.js", "/peak/world/world.js"):
            r = self.server.request("GET", f"/v/{build}{path}")
            self.assertEqual((r.status, r.headers["Cache-Control"]), (200, "public, max-age=31536000, immutable"))
        self.assertEqual(self.server.request("GET", "/v/000000000000/peak/main.js").headers["Cache-Control"], "no-cache")
        for path in (f"/v/{build}/server/api.py", f"/v/{build}/../server/api.py", f"/v/{build}/peak.html",
                     "/v/zz/peak/main.js", f"/v/{build}/api/peak/board"):
            self.assertIn(self.server.request("GET", path).status, (404, 418), path)

    def test_nothing_else_is(self):
        for path in ("/server/api.py", "/peak/../server/api.py", "/data/peak.sqlite3", "/.git/config",
                     "/server/route.json", "/index.html", "/tools/dev_server.py", "/peak/%2e%2e/server/db.py",
                     "/server/browser_bot.js", "/.mosdeploy.yml", "/docs/", "/models/README.md", "/favicon.svg"):
            self.assertIn(self.server.request("GET", path).status, (404, 418), path)

    def test_every_page_has_its_route(self):
        for path, file in (("/downhill", "downhill.html"), ("/games", "games.html"), ("/viewer", "index.html")):
            r = self.server.request("GET", path)
            self.assertEqual((r.status, r.headers["Content-Type"]), (200, "text/html; charset=utf-8"), path)
            self.assertIn(b"<title>", r.data)
            self.assertIn("'sha256-", r.headers["Content-Security-Policy"])
            page = re.sub(rb'v/[0-9a-f]{12}/peak/', b"peak/", r.data)     # the page itself, its code by the build
            self.assertEqual(page, (peak_scores.ROOT / file).read_bytes(), path)
        for path in ("/games.html", "/games/", "/viewer/x", "/peak/games/nothing.jpg", "/peak/games/climb.png"):
            self.assertIn(self.server.request("GET", path).status, (404, 418), path)
        build = re.search(rb'src="v/([0-9a-f]{12})/peak/games/main\.js"', self.server.request("GET", "/games").data)
        for path in ("/peak/games/climb.jpg", f"/v/{build.group(1).decode()}/peak/games/downhill.jpg"):
            r = self.server.request("GET", path)
            self.assertEqual((r.status, r.headers["Content-Type"]), (200, "image/jpeg"), path)

    def test_the_policy_hashes_each_inline_script(self):
        html = b"<script>a()</script><script type=module src=x.js></script><script type=importmap>{}</script>"
        self.assertEqual(len(re.findall(r"'sha256-", page_csp(html))), 2)

    def test_the_sounds_are_served(self):
        r = self.server.request("GET", "/audio/fall.m4a")
        self.assertEqual((r.status, r.headers["Content-Type"]), (200, "audio/mp4"))
        self.assertIn("https://cdn.jsdelivr.net", self.server.request("GET", "/").headers["Content-Security-Policy"])


class BuiltSite(unittest.TestCase):
    """The site as tools/build.mjs writes it (dist/), served from SITE_DIR."""
    PAGE = (b'<!doctype html><link rel="stylesheet" href="assets/peak-ABCDEFGH.css"><script>plausible()</script>'
            b'<script type="module" src="assets/peak-ABCD2345.js"></script>')

    def setUp(self):
        self.site = tempfile.TemporaryDirectory()
        site = Path(self.site.name)
        (site / "assets").mkdir()
        (site / "models").mkdir()
        for page in ("peak.html", "downhill.html", "games.html", "index.html"):
            (site / page).write_bytes(self.PAGE.replace(b"peak-", page.split(".")[0].encode() + b"-"))
        for name in ("peak-ABCD2345.js", "peak-ABCDEFGH.css", "fall-WXYZ2345.m4a", "camp-WXYZ2345.mp3", "loose.js",
                     "climb-WXYZ2345.jpg"):
            (site / "assets" / name).write_bytes(b"x")
        (site / "models" / "mnot.glb").write_bytes(b"glTF")
        patch = unittest.mock.patch.object(peak_scores, "SITE", site.resolve())
        patch.start()
        self.addCleanup(patch.stop)
        self.server = Server(Route(fixture()["route"]), static=True)

    def tearDown(self):
        self.server.close()
        self.site.cleanup()

    def test_the_page_is_served_as_built(self):
        r = self.server.request("GET", "/")
        self.assertEqual((r.status, r.data), (200, self.PAGE))           # no v/BUILD/: the names change themselves
        self.assertNotIn("jsdelivr", r.headers["Content-Security-Policy"])  # three.js comes with the code
        self.assertIn("'sha256-", r.headers["Content-Security-Policy"])
        self.assertEqual(self.server.request("GET", "/models/mnot.glb").headers["Cache-Control"], "no-cache")
        for path, name in (("/downhill", b"downhill"), ("/games", b"games"), ("/viewer", b"index")):
            r = self.server.request("GET", path)
            self.assertEqual((r.status, r.data), (200, self.PAGE.replace(b"peak-", name + b"-")), path)
        for path in ("/games.html", "/index.html"):
            self.assertIn(self.server.request("GET", path).status, (404, 418), path)

    def test_the_hashed_files_are_kept_for_good(self):
        for path, kind in (("/assets/peak-ABCD2345.js", "text/javascript; charset=utf-8"),
                           ("/assets/peak-ABCDEFGH.css", "text/css; charset=utf-8"),
                           ("/assets/climb-WXYZ2345.jpg", "image/jpeg"),
                           ("/assets/fall-WXYZ2345.m4a", "audio/mp4"), ("/assets/camp-WXYZ2345.mp3", "audio/mpeg")):
            r = self.server.request("GET", path)
            self.assertEqual((r.status, r.headers["Content-Type"], r.headers["Cache-Control"]),
                             (200, kind, "public, max-age=31536000, immutable"), path)
            self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")

    def test_nothing_else_is(self):
        for path in ("/assets/loose.js", "/assets/peak-abcd2345.js", "/assets/peak-ABCD2345.html", "/assets/",
                     "/assets/../peak.html", "/assets/sub/peak-ABCD2345.js", "/peak/main.js", "/server/api.py",
                     "/v/000000000000/server/api.py"):
            self.assertIn(self.server.request("GET", path).status, (404, 418), path)


class Migrations(unittest.TestCase):
    def test_numbered_and_run_once(self):
        numbers = [n for n, _ in MIGRATIONS]
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        with tempfile.TemporaryDirectory() as tmp:
            for _ in range(2):
                db = Database(Path(tmp) / "peak.sqlite3")
                self.assertEqual(db.version, len(MIGRATIONS))
                self.assertEqual(db.one("SELECT COUNT(*) FROM scores")[0], 5)
                self.assertEqual(db.one("PRAGMA journal_mode")[0], "wal")
                copy = Path(tmp) / "backup.sqlite3"
                db.backup(copy)
                db.close()
            self.assertGreater(copy.stat().st_size, 0)


class Checker(unittest.TestCase):
    def check(self, name):
        climb = fixture(name)
        route = Route(climb["route"])
        return verify.verify(route, climb["replay"], climb["claim"], [tuple(s) for s in climb["splits"]])

    def test_the_recorded_climbs_hold_up(self):
        for name in FIXTURES:
            rejection = self.check(name)
            self.assertIsNone(rejection, f"{name}: {rejection and (rejection.reason, rejection.detail, rejection.at)}")

    def test_the_route_is_todays(self):
        today = Route.load().fingerprint
        stale = [name for name in FIXTURES if fixture(name)["route"]["fingerprint"] != today]
        if stale:
            self.skipTest(f"route.json changed since {stale} were recorded: the checks above use the route they were "
                          "climbed on; record new ones to check today's (server/README.md, Testing)")

    def test_least_times_per_stretch(self):
        for name in FIXTURES:
            climb = fixture(name)
            times = [0] + [t for _, t in climb["splits"]] + [climb["claim"]["time"]]
            for (metres, least), t0, t1 in zip(Route(climb["route"]).segments(), times, times[1:]):
                self.assertGreater(least, 0)
                self.assertLess(least, (t1 - t0) / 1000 * 0.75, name)    # well under what a real climb took

    def test_a_fall_comes_back_where_it_stood(self):
        climb = fixture("falls")                                  # slid into the ring's hole once
        self.assertEqual(climb["claim"]["falls"], 1)
        back = next(i for i, row in enumerate(climb["replay"]["samples"]) if row[8] & verify.FLAG["respawn"])
        moved = [list(row) for row in climb["replay"]["samples"]]
        moved[back][1] += 5000                                    # 5 m to the side: nowhere it ever stood
        replay = dict(climb["replay"], samples=moved)
        rejection = verify.verify(Route(climb["route"]), replay, climb["claim"], [tuple(s) for s in climb["splits"]])
        self.assertEqual(rejection and rejection.reason, "respawn")

    def test_back_only_where_it_has_been(self):
        climb = fixture()
        checker = verify.Checker(Route(climb["route"]), climb["replay"], climb["claim"], climb["splits"])
        spots = {c["index"]: c["respawn"] for c in checker.route.checkpoints}
        checker.cp, checker.safe, checker.lost_reason = checker.route.checkpoints[1], [], {}

        def back_at(spot):
            checker.lost_at = verify.Sample([0, 0, 0, 0, 0, 0, 0, verify.OUT, verify.FLAG["lost"], -1], 0)
            row = [5000, *(round(v * 1000) for v in spot), 0, 0, 0, verify.GROUND, verify.FLAG["respawn"], -1]
            checker.check_respawn(None, verify.Sample(row, 1), 0.1)

        back_at(spots[0])
        back_at(spots[1])                                        # the checkpoints it reached
        for ahead in (2, 3):
            with self.assertRaises(verify.Rejection) as caught:
                back_at(spots[ahead])                            # one it never got to
            self.assertEqual(caught.exception.reason, "respawn")

    def test_a_jump_off_the_gondola_carries_its_climb(self):
        climb = fixture()
        checker = verify.Checker(Route(climb["route"]), climb["replay"], climb["claim"], climb["splits"])
        vy = round((checker.route.launch_run + 0.9 * checker.mover_climb) * 1000)
        self.assertGreater(checker.mover_climb, 0)

        def takeoff(ms):
            checker.last_mover = 32.933                           # the last sample on the pallet
            checker.check_takeoff(None, verify.Sample([ms, 0, 0, 0, 0, 0, vy, verify.AIR, verify.FLAG["jump"], -1], 1))

        takeoff(33033)               # a sample interval later: 0.10000000000000142 s in floats
        takeoff(33050)               # and a step more, when the frames run long
        with self.assertRaises(verify.Rejection) as caught:
            takeoff(33250)           # off the rock beside it a while later: nothing to carry
        self.assertEqual(caught.exception.reason, "antigravity")

    def test_a_late_coyote_jump_rises_above_the_plain_arc(self):
        climb = fixture()
        checker = verify.Checker(Route(climb["route"]), climb["replay"], climb["claim"], climb["splits"])
        g, launch, h = checker.route.gravity, checker.route.launch_run, verify.TICK
        edge = verify.Sample([25183, 1121, 4300, 35123, -1070, 1785, 0, verify.AIR, 0, -1], 0)    # just walked off

        def jump(ms, lift=0.0):
            dt = (ms - edge.ms) / 1000          # falling until the jump's step, then rising on the launch for it
            y = edge.y - g * (dt - h) ** 2 / 2 + launch * h - g * h * h / 2 + lift
            row = [ms, 1035, round(y * 1000), 35347, -1070, 1785, round((launch - g * h) * 1000), verify.AIR,
                   verify.FLAG["jump"], -1]
            checker.check_flight(edge, verify.Sample(row, 1), dt)

        jump(25233)                  # halfway through the coyote time
        jump(25283)                  # 0.1 s after the edge: 10 cm above the plain arc
        with self.assertRaises(verify.Rejection) as caught:
            jump(25283, 0.05)        # and 5 cm more
        self.assertEqual(caught.exception.reason, "antigravity")

    def test_ice_reaches_past_its_edge(self):
        rig = {"walk": 0.6, "run": 2, "gravity": 15, "jump": 0.6, "runJump": 0.8, "hard": 6}
        square = lambda x: [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1]]
        route = Route({"fingerprint": "-", "rig": rig, "beamSpeed": 0.5, "solids": [], "beams": [], "checkpoints": [],
                       "ice": [{"poly": square(0), "y": 0, "reach": 0.12}, {"poly": square(5), "y": 0}],
                       "summit": {"at": [0, 0, 0], "radius": 1}, "rail": [], "gusts": [], "movers": []})
        self.assertTrue(route.on_ice(1.1, 0, 0.5, margin=0))         # the ring's glaze: a slide goes over the lip
        self.assertFalse(route.on_ice(1.15, 0, 0.5, margin=0))
        self.assertFalse(route.on_ice(6.05, 0, 0.5, margin=0))        # a patch without reach (older exports)
        self.assertTrue(route.on_ice(6.05, 0, 0.5, margin=0.1))

    def test_a_touch_stick_steers(self):
        climb = fixture()
        checker = verify.Checker(Route(climb["route"]), climb["replay"], climb["claim"], climb["splits"])
        for mask, steered in ((32, True), (8, True), (16, False), (0, False)):
            checker.inputs = [(0, mask)]
            self.assertEqual(checker.keys_held(100, 200), steered, mask)
        replay = dict(climb["replay"], inputs=[[0, 63]])
        verify.parse(replay)
        with self.assertRaises(verify.Malformed):
            verify.parse(dict(replay, inputs=[[0, 64]]))

    def test_malformed(self):
        for replay in (None, [], {"v": 2}, {"v": 1, "route": "x", "phase": 0, "samples": [[0] * 9] * 3,
                                            "inputs": [], "events": []}):
            with self.assertRaises(verify.Malformed):
                verify.parse(replay)


class PerfRuns(unittest.TestCase):
    RUN = {"v": 1, "text": "Peak Mnot perf · a table", "gpu": "ANGLE (AMD Radeon)", "canvas": [2268, 1417],
           "frame": 22.123, "fps": 41.5, "by": "Mnot", "lines": [["frame", 22.1]] * 3}

    def setUp(self):
        self.server = Server(Route(fixture()["route"]))
        self.file = Path(self.server.tmp.name) / "perf.jsonl"

    def tearDown(self):
        self.server.close()

    def kept(self):
        return [json.loads(line) for line in self.file.read_text(encoding="utf-8").splitlines()]

    def test_a_run_is_kept_without_an_address(self):
        reply = self.server.request("POST", "/api/peak/perf", self.RUN)
        self.assertEqual(reply.status, 201)
        [run] = self.kept()
        self.assertEqual((run["text"], run["by"], run["frame"], run["canvas"]), (self.RUN["text"], "Mnot", 22.12,
                                                                                [2268, 1417]))
        self.assertNotIn("127.0.0.1", self.file.read_text(encoding="utf-8"))
        self.assertNotIn("v", run)

    def test_only_runs(self):
        for body in ({"v": 2, "text": "x"}, {"v": 1}, {"v": 1, "text": 5}, b"[1]", b"{"):
            reply = self.server.request("POST", "/api/peak/perf", body, {"Content-Type": "application/json"})
            self.assertEqual(reply.status, 400, body)
        big = dict(self.RUN, text="x" * (perf.MAX_BODY + 1))
        self.assertEqual(self.server.request("POST", "/api/peak/perf", big).status, 413)
        self.assertFalse(self.file.exists())

    def test_clipped(self):
        run = perf.keepable(dict(self.RUN, gpu="g" * 1000, deep={"a": {"b": {"c": {"d": 1}}}}, nan=float("nan"),
                                 many=list(range(500))), now=0)
        self.assertEqual((len(run["gpu"]), run["deep"], run["nan"], len(run["many"]), run["at"]),
                         (300, {"a": {"b": None}}, None, 120, "1970-01-01T00:00:00Z"))

    def test_rate(self):
        statuses = [self.server.request("POST", "/api/peak/perf", self.RUN).status for _ in range(8)]
        self.assertEqual(statuses, [201] * 6 + [429] * 2)

    def test_rolls_over(self):
        log = perf.PerfLog(self.file, quiet=True)
        self.file.write_text("x" * (perf.CAP - 10), encoding="utf-8")
        log.keep({"text": "new"})
        self.assertEqual(self.kept(), [{"text": "new"}])
        self.assertEqual(self.file.with_name("perf.1.jsonl").stat().st_size, perf.CAP - 10)


if __name__ == "__main__":
    unittest.main()
