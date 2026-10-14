"""Honest rides the downhill's checker once turned down, each on the route it was ridden on
(fixtures/downhill/honest-<fingerprint>.json.gz: whole runs, and stretches of others for the step checks), and the
cheats that what let them through (downhill_give.py: a push, a landing's snap, the snow's lift, the rounding) still
doesn't let through.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import copy
import gzip
import json
import math
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import downhill                                                     # noqa: E402
import downhill_give                                                # noqa: E402
from test_peak_scores import fixture                                # noqa: E402

T, X, Y, Z, VX, VY, VZ, MODE, FLAGS = range(9)          # a sample's columns (downhill.py)
HONEST = sorted((HERE / "fixtures" / "downhill").glob("honest-*.json.gz"))


def honest(fingerprint):
    data = json.loads(gzip.decompress((HERE / "fixtures" / "downhill" / f"honest-{fingerprint}.json.gz").read_bytes()))
    return downhill.Route(data["route"]), data


def verify(route, run, replay=None, claim=None):
    return downhill.verify(route, replay or run["replay"], claim or run["claim"], [tuple(s) for s in run["splits"]])


def steps(route, replay):
    """The step checks on a stretch of a run (on the snow, the way, the flights, the energy): None, or the Rejection."""
    c = downhill.Checker(route, replay, {}, [])
    try:
        c.where, hint = [], -1
        for x in c.samples:
            g = route.ground(x.x, x.z, hint)
            hint = g.i
            c.where.append(g)
        for check in (c.check_ground, c.check_motion, c.check_steps, c.check_energy):
            check()
    except downhill.Rejection as rejection:
        return rejection
    return None


def checked(route, run):
    """The checker after a whole run, for a look at its steps."""
    c = downhill.Checker(route, run["replay"], run["claim"], [tuple(s) for s in run["splits"]])
    c.run()
    return c


class HonestRides(unittest.TestCase):
    def test_every_honest_ride_holds_up(self):
        self.assertGreaterEqual(len(HONEST), 2)
        for path in HONEST:
            data = json.loads(gzip.decompress(path.read_bytes()))
            route = downhill.Route(data["route"])
            self.assertEqual(path.name, f"honest-{route.fingerprint[:12]}.json.gz")
            for run in data["runs"]:
                with self.subTest(path.name, why=run["why"]):
                    self.assertEqual(run["replay"]["route"], route.fingerprint)
                    self.assertIsNone(verify(route, run))
            for stretch in data.get("stretches", ()):
                with self.subTest(path.name, why=stretch["why"]):
                    self.assertEqual(stretch["replay"]["route"], route.fingerprint)
                    self.assertIsNone(steps(route, stretch["replay"]))


class StillCaught(unittest.TestCase):
    def setUp(self):
        self.route, self.data = honest("ff2e78f29561")
        self.run = self.data["runs"][0]                 # a rock's push

    def edited(self, run):
        return copy.deepcopy(run["replay"])

    def test_a_push_further_than_the_rock_reaches(self):
        c = checked(self.route, self.run)
        a, b = next((a, b) for a, b in zip(c.samples, c.samples[1:])
                    if math.dist((a.x, a.z), (b.x, b.z)) > max(a.speed, b.speed) * (b.t - a.t) and c.pushed(a, b))
        ex, ez = c.pushed(a, b)
        e = math.hypot(ex, ez)
        replay = self.edited(self.run)
        replay["samples"][b.i][X] += round(500 * ex / e)
        replay["samples"][b.i][Z] += round(500 * ez / e)
        self.assertEqual(verify(self.route, self.run, replay).reason, "teleport")

    def test_a_sidestep_away_from_anything(self):
        ride = fixture("downhill/ride")
        route, replay = downhill.Route(ride["route"]), copy.deepcopy(ride["replay"])
        x = replay["samples"][quiet(route, replay)]
        g = route.ground(x[X] / 1000, x[Z] / 1000, -1)
        rx, rz = route.right(g.s)
        x[X], x[Z] = x[X] + round(1000 * rx), x[Z] + round(1000 * rz)
        x[Y] = round(route.ground(x[X] / 1000, x[Z] / 1000, g.i).y * 1000)
        x[FLAGS] |= downhill.FLAG["land"]               # (a landing's snap is up, not across)
        self.assertEqual(verify(route, ride, replay).reason, "teleport")

    def test_a_landing_pays_for_no_speed(self):
        ride = fixture("downhill/ride")
        route, replay = downhill.Route(ride["route"]), copy.deepcopy(ride["replay"])
        x = replay["samples"][quiet(route, replay)]
        x[FLAGS] |= downhill.FLAG["land"]
        x[VX], x[VY], x[VZ] = (round(v * 1.05) for v in x[VX:VZ + 1])
        self.assertEqual(verify(route, ride, replay).reason, "antigravity")

    def test_a_landing_into_the_snow_earns_nothing(self):
        c = checked(self.route, self.data["runs"][2])   # the gorge's wall
        b = max((x for x in c.samples if x.has("land")), key=c.landing_credit)
        self.assertGreater(c.landing_credit(b), 1.0)
        n = c.where[b.i].normal
        b.vx, b.vy, b.vz = b.vx - 2 * n[0], b.vy - 2 * n[1], b.vz - 2 * n[2]
        self.assertEqual(c.landing_credit(b), 0.0)

    def test_the_gate_by_more_than_the_rounding(self):
        ride = fixture("downhill/ride")
        route, replay = downhill.Route(ride["route"]), copy.deepcopy(ride["replay"])
        x = replay["samples"][0]
        g = route.ground(x[X] / 1000, x[Z] / 1000, -1)
        x[X], x[Y], x[Z] = (round(v * 1000) for v in route.point(route.gate - 0.005, g.d))
        self.assertEqual(verify(route, ride, replay).reason, "start")

    def test_steering_up_a_bank_without_the_keys(self):
        route, data = honest("8022bb13c22e")
        stretch = next(s for s in data["stretches"] if s["why"].startswith("steering up a steep bank"))
        self.assertIsNone(steps(route, stretch["replay"]))
        replay = dict(stretch["replay"], inputs=[])
        self.assertEqual(steps(route, replay).reason, "antigravity")

    def test_the_credits_stop_at_their_work(self):
        c = checked(self.route, self.data["runs"][2])   # the gorge's wall
        b = max((x for x in c.samples if x.has("land")), key=c.landing_credit)
        a = c.samples[b.i - 1]
        self.assertGreater(c.credit(a, b), 1.0)
        c.work = downhill_give.WORK + 1
        self.assertEqual(c.credit(a, b), 0.0)

    def test_a_credit_only_where_it_matters(self):
        c = downhill.Checker(self.route, self.run["replay"], self.run["claim"], [tuple(s) for s in self.run["splits"]])
        asked, real = [], c.credit
        c.credit = lambda a, b, need=math.inf: asked.append(b.i) or real(a, b, need)
        c.run()
        self.assertLess(len(asked), 5)              # of 1482 steps

    def test_a_quicker_roll_where_the_snow_lifts(self):
        route, data = honest("8022bb13c22e")
        stretch = next(s for s in data["stretches"] if s["why"].startswith("rolling across a bank"))
        replay = copy.deepcopy(stretch["replay"])
        for x in replay["samples"][len(replay["samples"]) // 2:]:
            x[VX], x[VY], x[VZ] = (round(v * 1.05) for v in x[VX:VZ + 1])
        self.assertEqual(steps(route, replay).reason, "antigravity")


def quiet(route, replay):
    """A sample on the snow in the middle of the ride, away from any flag and any obstacle."""
    samples = replay["samples"]
    for i in range(len(samples) // 3, len(samples) - 2):
        x = samples[i]
        if x[MODE] != downhill.GROUND or any(s[FLAGS] for s in samples[i - 2:i + 3]):
            continue
        g = route.ground(x[X] / 1000, x[Z] / 1000, -1)
        if not list(route.near(g.s)) and abs(g.d) < 2 and x[VX] ** 2 + x[VZ] ** 2 > 25e6:
            return i
    raise AssertionError("no quiet sample")


if __name__ == "__main__":
    unittest.main()
