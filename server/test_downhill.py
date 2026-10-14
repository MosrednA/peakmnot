"""The office-chair downhill on the shared score server: real rides recorded in the browser (fixtures/downhill/,
each with the route it was ridden on), the cheats its checker (downhill.py) turns down, and
the games side by side: a board each, one player in all of them.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import contextlib
import copy
import io
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import downhill                                                     # noqa: E402
import games                                                        # noqa: E402
from route import Route                                             # noqa: E402
from test_peak_scores import HOUSE, Climber, Server, fixture        # noqa: E402

HILL_HOUSE = len(games.DOWNHILL_HOUSE)
T, X, Y, Z, VX, VY, VZ, MODE, FLAGS = range(9)          # a sample's columns (downhill.py)


def rider(server, ride):
    return Climber(server, ride, game="downhill")


class RideTest(unittest.TestCase):
    def setUp(self):
        self.ride = fixture("downhill/ride")
        self.climb = fixture("climb")
        self.route = downhill.Route(self.ride["route"])
        self.server = Server(Route(self.climb["route"]), downhill_route=self.route)

    def tearDown(self):
        self.server.close()

    def board(self, game="downhill", me=None):
        return self.server.request("GET", f"/api/{game}/board?limit=50" + (f"&me={me}" if me else "")).json

    def tampered(self):
        return copy.deepcopy(self.ride["replay"])

    def shadow(self, replay=None, claim=None):
        """A cheat: it looks like a win, and the run is kept as the reason it isn't."""
        c = rider(self.server, self.ride)
        self.assertEqual(c.splits().status, 200)
        r = c.finish(replay=replay, claim=claim)
        self.assertEqual(r.status, 200, r.data)
        self.assertEqual(r.json["rank"], 1)
        self.assertTrue(r.json["psst"])
        return c, r, self.server.app.store.for_game("downhill").replay(c.run)[1]

    def quiet_sample(self, replay, after=0.3):
        """A sample on the snow in the middle of the ride, away from any flag and any obstacle."""
        samples = replay["samples"]
        for i in range(len(samples) // 3, len(samples) - 2):
            x = samples[i]
            if x[T] < after * samples[-1][T] or x[MODE] != downhill.GROUND or any(s[FLAGS] for s in samples[i - 2:i + 3]):
                continue
            g = self.route.ground(x[X] / 1000, x[Z] / 1000, -1)
            if not list(self.route.near(g.s)) and abs(g.d) < 2:
                return i
        self.fail("no quiet sample")


class TheRide(RideTest):
    def test_a_real_ride_goes_on_its_own_board(self):
        c = rider(self.server, self.ride)
        self.assertEqual(c.splits().status, 200)
        r = c.finish()
        self.assertEqual(r.status, 200, r.data)
        self.assertNotIn("psst", r.json)
        self.assertEqual(r.json["rank"], 1)
        r = c.claim("Test Chair")
        self.assertEqual((r.status, r.json["name"], r.json["rank"]), (200, "Test Chair", 1))
        self.assertEqual(self.server.app.store.for_game("downhill").replay(c.run)[1], "ok")
        board = self.board(me=r.json["player"])
        self.assertEqual(board["total"], HILL_HOUSE + 1)
        first = board["entries"][0]
        self.assertEqual((first["name"], first["time"], first["me"]), ("Test Chair", self.ride["claim"]["time"], True))
        self.assertEqual(first["replayId"], c.run)
        public = self.server.request("GET", f"/api/downhill/replay/{c.run}")
        self.assertEqual(public.status, 200)
        # the ghost's legs and lean follow the keys, so the downhill's public replay has them (the climb's doesn't)
        self.assertEqual(public.json["replay"]["inputs"], self.ride["replay"]["inputs"])
        self.assertEqual(sorted(public.json["replay"]), ["events", "inputs", "phase", "route", "samples", "v"])
        # the climb's board doesn't know it
        self.assertEqual(self.board("peak")["total"], HOUSE)
        self.assertEqual(self.server.request("GET", f"/api/peak/replay/{c.run}").status, 404)

    def test_spills_and_all(self):
        self.ride = fixture("downhill/spills")
        self.assertGreater(self.ride["claim"]["falls"], 0)
        r = rider(self.server, self.ride).all_the_way("Spilled Chair")
        self.assertEqual(r.status, 200, r.data)
        self.assertEqual(r.json["rank"], 1)

    def test_the_house_records(self):
        board = self.board()
        self.assertEqual(len(board["entries"]), HILL_HOUSE)
        self.assertEqual(sorted(e["name"] for e in board["entries"]), sorted(h[1] for h in games.DOWNHILL_HOUSE))
        self.assertTrue(all(e["house"] and e["quip"] for e in board["entries"]))
        self.assertGreater(min(e["time"] for e in board["entries"]), self.ride["claim"]["time"])

    def test_a_house_name_is_taken_in_every_game(self):
        r = Climber(self.server, self.climb).all_the_way("Out of Office")         # the downhill's, on the climb
        self.assertEqual(r.status, 200, r.data)
        self.assertNotEqual(r.json["name"], "Out of Office")
        r = rider(self.server, self.ride).all_the_way("Dial-up Dave")            # the climb's, on the downhill
        self.assertNotEqual(r.json["name"], "Dial-up Dave")

    def test_one_player_in_every_game(self):
        me = Climber(self.server, self.climb).all_the_way("Two Games").json
        r = rider(self.server, self.ride).all_the_way("Two Games", me["player"], me["secret"])
        self.assertEqual((r.status, r.json["player"], r.json["name"]), (200, me["player"], "Two Games"))
        for game, total in (("peak", HOUSE + 1), ("downhill", HILL_HOUSE + 1)):
            board = self.board(game, me["player"])
            self.assertEqual((board["total"], board["entries"][0]["name"], board["entries"][0]["me"]),
                             (total, "Two Games", True), game)
        # a new name in one game is the player's name in all of them
        rider(self.server, self.ride).all_the_way("Renamed Can", me["player"], me["secret"])
        self.assertEqual(self.board("peak", me["player"])["entries"][0]["name"], "Renamed Can")

    def test_a_run_is_its_own_games(self):
        c = rider(self.server, self.ride)
        c.game = "peak"                                 # the downhill's run, sent to the climb
        r = c.post("split", {"cp": 1, "t": self.ride["splits"][0][1]})
        self.assertEqual(r.status, 404)
        r = self.server.request("POST", "/api/downhill/run", {"v": 1, "route": self.climb["route"]["fingerprint"],
                                                              "t0": 0})
        self.assertEqual((r.status, r.json["error"]), (409, "route"))
        self.assertIn("ride", r.says())
        self.assertEqual(self.server.request("GET", "/api/nope/board").status, 404)

    def test_a_split_too_soon_and_a_skipped_pit(self):
        c = rider(self.server, self.ride)
        c.at(3000)                                      # 166 m to the first pit stop
        r = c.post("split", {"cp": 1, "t": 3000})
        self.assertEqual((r.status, r.json["error"]), (422, "too_fast_split"))
        self.assertIn("office chair", r.says())
        c = rider(self.server, self.ride)
        c.at(self.ride["splits"][1][1])
        r = c.post("split", {"cp": 2, "t": self.ride["splits"][1][1]})
        self.assertEqual((r.status, r.json["error"]), (422, "skipped_split"))
        self.assertIn("casters", r.says())

    def test_the_route_is_todays(self):
        today = downhill.Route.load().fingerprint
        stale = [name for name in ("ride", "spills") if fixture(f"downhill/{name}")["route"]["fingerprint"] != today]
        if stale:
            self.skipTest(f"downhill.json changed since {stale} were recorded: the checks here use the route they "
                          "were ridden on; record new ones to check today's (server/README.md, The downhill)")

    def test_reverify_and_fixture(self):
        import peak_scores
        c = rider(self.server, self.ride)
        c.all_the_way()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            peak_scores.reverify(self.server.app, c.run, "downhill")
        self.assertIn("now: ok", out.getvalue())
        _, claim, splits = peak_scores.stored_climb(self.server.app, "latest", "downhill")
        self.assertEqual((claim, splits), (self.ride["claim"], [tuple(s) for s in self.ride["splits"]]))


class Cheats(RideTest):
    def test_a_quicker_time(self):
        claim = dict(self.ride["claim"], time=self.ride["claim"]["time"] - 5000)
        _, r, verdict = self.shadow(claim=claim)
        self.assertEqual(verdict, "edited")
        self.assertIn("director's cut", r.json["psst"])

    def test_more_time_off(self):
        c = self.ride["claim"]
        _, r, verdict = self.shadow(claim=dict(c, time=c["time"] - 5000, bonus=c["bonus"] + 5000))
        self.assertEqual(verdict, "bonus")
        self.assertIn("judges", r.json["psst"])

    def test_a_longer_ski_jump(self):
        replay, c = self.tampered(), self.ride["claim"]
        flight = next(e for e in replay["events"] if e[1] == "flight")
        bowled = max([0] + [self.route.bonus["pins"].get(str(e[2]), 0) for e in replay["events"] if e[1] == "bowl"])
        flight[2] += 1500                               # 15 m further, and the bonus to go with it
        bonus = self.route.bonus_ms(bowled, flight[2] / 100)
        self.assertGreater(bonus, c["bonus"])
        claim = dict(c, bonus=bonus, time=c["clock"] - bonus)
        self.assertEqual(self.shadow(replay, claim)[2], "bonus")

    def test_a_jump_without_the_lever(self):
        replay = self.tampered()
        replay["events"] = [e for e in replay["events"] if e[1] != "space" or e[0] < 400]
        self.assertEqual(self.shadow(replay)[2], "spacebar")

    def test_floating(self):
        replay = self.tampered()
        replay["samples"][self.quiet_sample(replay)][Y] += 500
        self.assertEqual(self.shadow(replay)[2], "levitate")

    def test_a_teleport(self):
        replay = self.tampered()
        x = replay["samples"][self.quiet_sample(replay)]
        g = self.route.ground(x[X] / 1000, x[Z] / 1000, -1)
        ahead = self.route.point(g.s + 6, g.d)              # 6 m on down the piste, on the snow
        x[X], x[Z] = round(ahead[0] * 1000), round(ahead[2] * 1000)
        x[Y] = round(self.route.ground(ahead[0], ahead[2], g.i).y * 1000)
        self.assertEqual(self.shadow(replay)[2], "teleport")

    def test_a_faster_chair(self):
        replay = self.tampered()        # a tenth faster on the snow (in the air the steps would give it away)
        for x in replay["samples"]:
            if x[MODE] == downhill.GROUND:
                x[VX], x[VY], x[VZ] = (round(v * 1.1) for v in x[VX:VZ + 1])
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "antigravity")
        self.assertIn("roll down", r.json["psst"])

    def test_a_sped_up_ride(self):
        replay = copy.deepcopy(self.ride)               # the whole ride at 1.1 times the speed of life
        quick = lambda ms: round(ms / 1.1)              # noqa: E731
        for x in replay["replay"]["samples"]:
            x[T] = quick(x[T])
        for rows in (replay["replay"]["events"], replay["replay"]["inputs"]):
            for row in rows:
                row[0] = quick(row[0])
        clock = replay["replay"]["samples"][-1][T]
        replay["claim"] = dict(replay["claim"], clock=clock, time=max(0, clock - replay["claim"]["bonus"]))
        replay["splits"] = [[cp, quick(t)] for cp, t in replay["splits"]]
        self.ride = replay
        _, _, verdict = self.shadow(replay["replay"], replay["claim"])
        self.assertIn(verdict, ("teleport", "antigravity", "too_fast"))

    def test_a_respawn_somewhere_else(self):
        self.ride = fixture("downhill/spills")
        replay = self.tampered()
        x = next(x for x in replay["samples"] if x[FLAGS] & downhill.FLAG["respawn"])
        x[X] += 3000
        self.assertEqual(self.shadow(replay)[2], "respawn")

    def test_the_shame_is_the_games_own(self):
        claim = dict(self.ride["claim"], time=self.ride["claim"]["time"] - 5000)
        c, _, _ = self.shadow(claim=claim)
        c.claim("Cheaty Chair")
        hill = self.server.request("GET", "/api/downhill/shame").json
        self.assertEqual([e["name"] for e in hill["hallOfShame"]], ["Cheaty Chair"])
        self.assertIn("riders", hill["note"])
        self.assertEqual(self.server.request("GET", "/api/peak/shame").json["hallOfShame"], [])

    def test_every_rejection_has_words(self):
        for reason in ("edited", "bonus", "spacebar", "levitate", "teleport", "antigravity", "too_fast", "respawn",
                       "start", "finish", "skipped", "off_route", "timeline"):
            says = self.server.app.api.shadow_says(self.server.app.api.boards["downhill"],
                                                   downhill.checks.Rejection(reason))
            self.assertTrue(says, reason)
            self.assertNotIn("Peak Mnot detected", says, reason)


class Levels(RideTest):
    """A second level of the downhill (games.py): a board, runs and replays of its own under /api/downhill-two/,
    checked against its own route, and the same player as everywhere. Here it is the same piste under another
    fingerprint, so the fixture's ride can be ridden on it."""

    TWO = "2" * 64

    def setUp(self):
        self.ride = fixture("downhill/ride")
        self.climb = fixture("climb")
        self.route = downhill.Route(self.ride["route"])
        two = downhill.Route(dict(self.ride["route"], fingerprint=self.TWO))
        self.server = Server(Route(self.climb["route"]), downhill_route=self.route, levels={"downhill": {"two": two}})
        self.level = dict(self.ride, route=dict(self.ride["route"], fingerprint=self.TWO),
                          replay=dict(self.ride["replay"], route=self.TWO))

    def test_a_level_has_its_own_board(self):
        health = self.server.request("GET", "/api/downhill-two/health").json
        self.assertEqual(health["route"], self.TWO[:12])
        self.assertEqual(self.board("downhill-two")["total"], HILL_HOUSE)        # the house records, as on any board
        c = Climber(self.server, self.level, game="downhill-two")
        r = c.all_the_way("Level Chair")
        self.assertEqual((r.status, r.json["rank"]), (200, 1), r.data)
        board = self.board("downhill-two", me=r.json["player"])
        self.assertEqual((board["total"], board["entries"][0]["replayId"]), (HILL_HOUSE + 1, c.run))
        public = self.server.request("GET", f"/api/downhill-two/replay/{c.run}")
        self.assertEqual((public.status, public.json["replay"]["route"]), (200, self.TWO))
        self.assertIn("inputs", public.json["replay"])
        # the first level doesn't know it, and the same player rides there under the same name
        self.assertEqual(self.board()["total"], HILL_HOUSE)
        self.assertEqual(self.server.request("GET", f"/api/downhill/replay/{c.run}").status, 404)
        first = rider(self.server, self.ride)
        first.splits()
        first.finish(player=r.json["player"])
        mine = first.claim("Level Chair", player=r.json["player"], secret=r.json["secret"])
        self.assertEqual((mine.status, mine.json["player"]), (200, r.json["player"]), mine.data)
        self.assertEqual(self.board(me=r.json["player"])["entries"][0]["name"], "Level Chair")

    def test_a_run_for_another_level(self):
        for game, route in (("downhill-two", self.ride["route"]["fingerprint"]), ("downhill", self.TWO)):
            r = self.server.request("POST", f"/api/{game}/run", {"v": 1, "route": route, "t0": 0})
            self.assertEqual(r.status, 409, game)

    def test_no_such_level(self):
        for path in ("/api/downhill-three/board", "/api/peak-two/board", "/api/downhill-Two/board",
                     "/api/downhill-/board", f"/api/downhill-{'x' * 17}/board"):
            self.assertEqual(self.server.request("GET", path).status, 404, path)

    def test_a_level_is_a_short_name(self):
        with self.assertRaises(ValueError):
            games.load(self.climb_route(), self.route, levels={"downhill": {"Two": self.route}})

    def climb_route(self):
        return Route(self.climb["route"])


if __name__ == "__main__":
    unittest.main()
