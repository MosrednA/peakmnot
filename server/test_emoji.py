"""Reaction Run on the shared score server: real runs recorded in the browser (fixtures/emoji/: the route they were
run on, a run with two wrong ones touched, peeks, teetering on a hole's edge (saved once, over the edge once) and a
drop into a hole, at a frame rate all over the place; a clean one; one with three drops over a hole's edge and a
bonk), the cheats its checker (emoji.py) turns down, and its board beside the others.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import contextlib
import copy
import io
import math
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import emoji                                                        # noqa: E402
import games                                                        # noqa: E402
from route import Route                                             # noqa: E402
from test_peak_scores import HOUSE, Climber, Server, fixture        # noqa: E402

EMOJI_HOUSE = len(games.EMOJI_HOUSE)
T, X, Y, Z, VX, VY, VZ, MODE, FLAGS, YAW = range(10)    # a sample's columns (emoji.py)
ROUTE = fixture("emoji/route")


def recorded(name):
    """A run from fixtures/emoji/, with the route it was run on: route.json.gz there, unless it has its own (one
    that --fixture saved)."""
    run = fixture(f"emoji/{name}")
    run.setdefault("route", ROUTE)
    return run


def runner(server, run):
    return Climber(server, run, game="emoji")


class RunTest(unittest.TestCase):
    def setUp(self):
        self.run = recorded("run")
        self.route = emoji.Route(ROUTE)
        self.field = self.route.fields[self.run["replay"]["seed"]]
        self.server = Server(Route(fixture("climb")["route"]), emoji_route=self.route)

    def tearDown(self):
        self.server.close()

    def board(self, game="emoji", me=None):
        return self.server.request("GET", f"/api/{game}/board?limit=50" + (f"&me={me}" if me else "")).json

    def tampered(self):
        return copy.deepcopy(self.run["replay"])

    def shadow(self, replay=None, claim=None, splits=None):
        """A cheat: it looks like a win, and the run is kept as the reason it isn't."""
        c = runner(self.server, self.run)
        self.assertEqual(c.splits(splits).status, 200)
        r = c.finish(replay=replay, claim=claim)
        self.assertEqual(r.status, 200, r.data)
        self.assertEqual(r.json["rank"], 1)
        self.assertTrue(r.json["psst"])
        return c, r, self.server.app.store.for_game("emoji").replay(c.run)[1]

    def quiet(self, replay, around=0, clear=0.9, running=False, speed=0.0):
        """A sample on the snow in the middle of the run, with no flag and no wall near it or `around` either side
        (and running all the while at `speed` m/s at least, if asked)."""
        s = replay["samples"]
        for i in range(len(s) // 3, len(s) - around - 3):
            near = s[i - around - 2:i + around + 3]
            if any(x[MODE] != emoji.SNOW or x[FLAGS] for x in near):
                continue
            if running and not all(self.keys(replay, x[T]) & emoji.RUN for x in near):
                continue
            if any(math.hypot(x[VX], x[VZ]) / 1000 < speed for x in near):
                continue
            if all(self.field.wall(x[X] / 1000, x[Z] / 1000) > clear for x in near):
                return i
        self.fail("no quiet sample")

    @staticmethod
    def keys(replay, t):
        """The keys held at t ms."""
        held = 0
        for at, keys in replay["inputs"]:
            if at > t:
                break
            held = keys
        return held

    def in_a_wall(self, replay):
        """A sample on the snow put in the middle of the wall nearest it."""
        s, best = replay["samples"], None
        for i in range(len(s) // 4, len(s) - 3):
            x = s[i]
            if x[MODE] != emoji.SNOW or any(y[FLAGS] for y in s[i - 2:i + 3]):
                continue
            px, pz = x[X] / 1000, x[Z] / 1000
            for x0, z0, x1, z1 in self.field.boxes:
                if x1 - x0 < z1 - z0:
                    to = ((x0 + x1) / 2, min(max(pz, z0), z1))
                else:
                    to = (min(max(px, x0), x1), (z0 + z1) / 2)
                d = math.hypot(to[0] - px, to[1] - pz)
                if best is None or d < best[0]:
                    best = (d, i, to)
        _, i, (x, z) = best
        s[i][X], s[i][Z] = round(x * 1000), round(z * 1000)


class TheRun(RunTest):
    def test_a_real_run_goes_on_its_own_board(self):
        c = runner(self.server, self.run)
        self.assertEqual(c.splits().status, 200)
        r = c.finish()
        self.assertEqual(r.status, 200, r.data)
        self.assertNotIn("psst", r.json)
        self.assertEqual(r.json["rank"], 1)
        r = c.claim("Test Runner")
        self.assertEqual((r.status, r.json["name"], r.json["rank"]), (200, "Test Runner", 1))
        self.assertEqual(self.server.app.store.for_game("emoji").replay(c.run)[1], "ok")
        board = self.board(me=r.json["player"])
        self.assertEqual(board["total"], EMOJI_HOUSE + 1)
        first = board["entries"][0]
        self.assertEqual((first["name"], first["time"], first["falls"], first["dents"], first["me"]),
                         ("Test Runner", self.run["claim"]["time"], 2, 1, True))
        self.assertEqual(first["replayId"], c.run)
        # the ghost and the watching run in the field the seed deals, with the keys leaning Mnot
        public = self.server.request("GET", f"/api/emoji/replay/{c.run}")
        self.assertEqual(public.status, 200)
        self.assertEqual(sorted(public.json["replay"]), ["events", "inputs", "phase", "route", "samples", "seed", "v"])
        self.assertEqual(public.json["replay"]["seed"], self.run["replay"]["seed"])
        self.assertEqual(public.json["replay"]["inputs"], self.run["replay"]["inputs"])
        # the other boards don't know it
        self.assertEqual(self.board("peak")["total"], HOUSE)
        self.assertEqual(self.server.request("GET", f"/api/downhill/replay/{c.run}").status, 404)

    def test_every_recorded_run(self):
        for name in ("run", "clean", "pits"):
            run = recorded(name)
            c = runner(self.server, run)
            r = c.all_the_way(f"Runner {name}")
            self.assertEqual(r.status, 200, (name, r.data))
            self.assertEqual(self.server.app.store.for_game("emoji").replay(c.run)[1], "ok", name)
        self.assertEqual(self.board()["total"], EMOJI_HOUSE + 3)

    def test_the_house_records(self):
        board = self.board()
        self.assertEqual(len(board["entries"]), EMOJI_HOUSE)
        self.assertEqual(sorted(e["name"] for e in board["entries"]), sorted(h[1] for h in games.EMOJI_HOUSE))
        self.assertTrue(all(e["house"] and e["quip"] for e in board["entries"]))
        slowest = max(recorded(name)["claim"]["time"] for name in ("run", "clean", "pits"))
        self.assertGreater(min(e["time"] for e in board["entries"]), slowest)
        # three wrong ones and you're out: a house record never has more than two
        self.assertTrue(all(h[4] < self.route.lives for h in games.EMOJI_HOUSE))

    def test_a_split_too_soon_and_a_skipped_one(self):
        c = runner(self.server, self.run)
        c.at(600)                                       # five metres to the first one
        r = c.post("split", {"cp": 1, "t": 600})
        self.assertEqual((r.status, r.json["error"]), (422, "too_fast_split"))
        self.assertIn("sliding", r.says())
        c = runner(self.server, self.run)
        c.at(self.run["splits"][1][1])
        r = c.post("split", {"cp": 2, "t": self.run["splits"][1][1]})
        self.assertEqual((r.status, r.json["error"]), (422, "skipped_split"))
        self.assertIn("list", r.says())

    def test_the_route_is_todays(self):
        if emoji.Route.load().fingerprint != ROUTE["fingerprint"]:
            self.skipTest("emoji.json changed since the fixtures were recorded: the checks here use the route they "
                          "were run on; record new ones to check today's (server/README.md, Reaction Run)")

    def test_reverify_and_fixture(self):
        import peak_scores
        c = runner(self.server, self.run)
        c.all_the_way()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            peak_scores.reverify(self.server.app, c.run, "emoji")
        self.assertIn("now: ok", out.getvalue())
        _, claim, splits = peak_scores.stored_climb(self.server.app, "latest", "emoji")
        self.assertEqual((claim, splits), (self.run["claim"], [tuple(s) for s in self.run["splits"]]))


class Cheats(RunTest):
    def test_a_quicker_time(self):
        _, r, verdict = self.shadow(claim=dict(self.run["claim"], time=self.run["claim"]["time"] - 5000))
        self.assertEqual(verdict, "edited")
        self.assertIn("director's cut", r.json["psst"])

    def test_fewer_wrong_ones_and_holes(self):
        for less in ("falls", "dents"):
            claim = dict(self.run["claim"], **{less: self.run["claim"][less] - 1})
            self.assertEqual(self.shadow(claim=claim)[2], "edited", less)

    def test_out_of_tries(self):
        replay = self.tampered()
        i = self.quiet(replay)
        replay["samples"][i][FLAGS] |= emoji.FLAG["hit"]
        replay["events"].append([replay["samples"][i][T], "hit", 0])
        replay["events"].sort(key=lambda e: e[0])
        claim = dict(self.run["claim"], falls=self.run["claim"]["falls"] + 1)
        self.assertEqual(claim["falls"], self.route.lives)
        self.assertEqual(self.shadow(replay, claim)[2], "tries")

    def test_a_practice_field(self):
        replay = self.tampered()
        replay["seed"] = max(self.route.fields) + 1000
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "practice")
        self.assertIn("Practice", r.json["psst"])

    def test_floating(self):
        replay = self.tampered()
        replay["samples"][self.quiet(replay)][Y] += 400
        self.assertEqual(self.shadow(replay)[2], "levitate")

    def test_too_fast(self):
        replay = self.tampered()
        x = replay["samples"][self.quiet(replay, running=True, speed=3)]
        x[VX], x[VZ] = x[VX] * 3, x[VZ] * 3
        _, r, verdict = self.shadow(replay)
        self.assertEqual(verdict, "too_fast")
        self.assertIn("can-lengths", r.json["psst"])

    def test_through_a_wall(self):
        replay = self.tampered()
        self.in_a_wall(replay)
        self.assertEqual(self.shadow(replay)[2], "wall")

    def test_speeding_up_without_running(self):
        replay = self.tampered()
        replay["inputs"] = [[t, keys & ~emoji.RUN] for t, keys in replay["inputs"]]
        self.assertEqual(self.shadow(replay)[2], "moonwalk")

    def test_sliding_sideways(self):
        # a stretch nudged sideways, smoothly, its speeds left as they were: where it went isn't what they say
        replay = self.tampered()
        s, i = replay["samples"], self.quiet(replay, around=5)
        for k in range(-5, 6):
            s[i + k][X] += round(250 * math.cos(k / 5 * math.pi / 2) ** 2)
        self.assertEqual(self.shadow(replay)[2], "drift")

    def test_a_wrong_one_taken_out(self):
        # the bump goes with the wrong one: without it, the speeds don't add up
        replay = self.tampered()
        hit = next(e for e in replay["events"] if e[1] == "hit")
        replay["events"].remove(hit)
        for x in replay["samples"]:
            if x[T] == hit[0]:
                x[FLAGS] &= ~emoji.FLAG["hit"]
        claim = dict(self.run["claim"], falls=self.run["claim"]["falls"] - 1)
        self.assertIn(self.shadow(replay, claim)[2], ("drift", "teleport", "dodge"))

    def test_fetched_from_afar(self):
        replay = self.tampered()
        s = replay["samples"]
        take = next(e for e in replay["events"] if e[1] == "take" and e[2] == 2)
        j = next(k for k, x in enumerate(s) if x[T] == take[0])
        early = next(k for k in range(j - 1, 0, -1) if s[k][T] <= take[0] - 1000 and not s[k][FLAGS])
        s[j][FLAGS] &= ~emoji.FLAG["take"]
        s[early][FLAGS] |= emoji.FLAG["take"]
        take[0] = s[early][T]
        replay["events"].sort(key=lambda e: e[0])
        splits = [[cp, take[0] if cp == 2 else t] for cp, t in self.run["splits"]]
        _, r, verdict = self.shadow(replay, splits=splits)
        self.assertEqual(verdict, "grab")
        self.assertIn("rubber", r.json["psst"])

    def test_a_crack_that_never_gives_way(self):
        replay = self.tampered()
        hole = next(e for e in replay["events"] if e[1] == "hole")
        replay["events"].remove(hole)
        for x in replay["samples"]:
            if x[T] == hole[0]:
                x[FLAGS] &= ~emoji.FLAG["hole"]
        self.assertEqual(self.shadow(replay)[2], "crack")

    def test_a_drop_taken_out(self):
        # on the snow where it was down in the hole, and out of it with no hop
        replay = self.tampered()
        pit = next(e for e in replay["events"] if e[1] == "pit")
        replay["events"].remove(pit)
        for x in replay["samples"]:
            x[FLAGS] &= ~(emoji.FLAG["pit"] | emoji.FLAG["climb"])
            x[MODE] = emoji.SNOW
        claim = dict(self.run["claim"], dents=self.run["claim"]["dents"] - 1)
        self.assertIn(self.shadow(replay, claim)[2], ("drift", "teleport", "hole"))

    def rims(self, replay):
        """The run's teeters, (the sample it was caught on, the one it ended on: saved or over), by index."""
        s, out, at = replay["samples"], [], None
        for i, x in enumerate(s):
            if at is not None and x[FLAGS] & (emoji.FLAG["steady"] | emoji.FLAG["pit"]):
                out.append((at, i))
                at = None
            if x[FLAGS] & emoji.FLAG["rim"]:
                at = i
        self.assertTrue(out, "no teeter in the run")
        return out

    def test_teetering_where_no_hole_is(self):
        # caught at an edge out on the snow, on the run, after the hole it names opened and nowhere near it
        replay = self.tampered()
        rim = next(e for e in replay["events"] if e[1] == "rim")
        s, k = replay["samples"], self.field.cracks[rim[2]]
        i = next(i for i in range(len(s)) if s[i][T] > rim[0] + 2000 and s[i][MODE] == emoji.SNOW
                 and not any(x[FLAGS] for x in s[i - 2:i + 3]) and k.gap(s[i][X] / 1000, s[i][Z] / 1000) > 1)
        s[i][FLAGS] |= emoji.FLAG["rim"]
        replay["events"].append([s[i][T], "rim", rim[2]])
        replay["events"].sort(key=lambda e: e[0])
        self.assertEqual(self.shadow(replay)[2], "rim")

    def test_saved_with_no_teeter(self):
        replay = self.tampered()
        replay["samples"][self.quiet(replay)][FLAGS] |= emoji.FLAG["steady"]
        self.assertEqual(self.shadow(replay)[2], "rim")

    def test_saved_too_soon(self):
        # the save moved up to the sample after the catch, before the moment the game lets it
        replay = self.tampered()
        s = replay["samples"]
        at, end = next((a, b) for a, b in self.rims(replay) if s[b][FLAGS] & emoji.FLAG["steady"])
        s[end][FLAGS] &= ~emoji.FLAG["steady"]
        s[at + 1][FLAGS] |= emoji.FLAG["steady"]
        self.assertEqual(self.shadow(replay)[2], "rim")

    def test_walking_off_the_rim(self):
        # never saved: it stands on the edge, then walks off as if it hadn't been teetering
        replay = self.tampered()
        s = replay["samples"]
        _, end = next((a, b) for a, b in self.rims(replay) if s[b][FLAGS] & emoji.FLAG["steady"])
        s[end][FLAGS] &= ~emoji.FLAG["steady"]
        self.assertEqual(self.shadow(replay)[2], "rim")

    def test_over_the_edge_somewhere_else(self):
        # off the rim and into the hole 40 cm along it from where it teetered, nearer the hole's middle
        replay = self.tampered()
        s = replay["samples"]
        at, end = next((a, b) for a, b in self.rims(replay) if s[b][FLAGS] & emoji.FLAG["pit"])
        k = self.field.cracks[next(e[2] for e in replay["events"] if e[1] == "rim" and e[0] == s[at][T])]
        l, _ = k.frame(s[at][X] / 1000, s[at][Z] / 1000)
        dl = -400 if l > 0 else 400
        for x in s[end:]:
            if x[MODE] == emoji.SNOW:
                break
            x[X if k.axis == "z" else Z] += dl
        self.assertIn(self.shadow(replay)[2], ("rim", "pit"))

    def test_a_start_somewhere_else(self):
        replay = self.tampered()
        replay["samples"][0][X] += 1000
        self.assertEqual(self.shadow(replay)[2], "start")

    def test_the_shame_is_the_games_own(self):
        c, _, _ = self.shadow(claim=dict(self.run["claim"], time=self.run["claim"]["time"] - 5000))
        c.claim("Cheaty Can")
        shame = self.server.request("GET", "/api/emoji/shame").json
        self.assertEqual([e["name"] for e in shame["hallOfShame"]], ["Cheaty Can"])
        self.assertIn("runners", shame["note"])
        self.assertEqual(self.server.request("GET", "/api/peak/shame").json["hallOfShame"], [])

    def test_every_rejection_has_words(self):
        for reason in ("edited", "timeline", "too_fast", "teleport", "wall", "drift", "moonwalk", "grab", "dodge",
                       "hole", "pit", "levitate", "crack", "rim", "tries", "practice", "start", "finish",
                       "skipped"):
            says = self.server.app.api.shadow_says(self.server.app.api.boards["emoji"], emoji.Rejection(reason))
            self.assertTrue(says, reason)
            self.assertNotIn("Peak Mnot detected", says, reason)
            self.assertNotIn("climb", says, reason)


if __name__ == "__main__":
    unittest.main()
