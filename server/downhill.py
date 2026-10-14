"""Checks a recorded downhill run (peak/downhill/record.js) against the piste (downhill.json, exported by
peak/downhill/routedata.js) and the chair's physics (peak/downhill/ride.js, track.js). Like the climb's verify.py it
doesn't re-run the game (the pins and the seat's swing aren't in the record); it checks that every step is something
the chair can do. It rolls on the snow that is there and flies on parabolas off it; it never has more energy than the
drop, the feet, the gas lift and the steering give it, less what the snow and the air take at the very least; it
never rolls through a rock or a pine; a spill puts it back at the last pit stop; it jumps only when the lever was
pulled; the time off the clock is what the bowling and the ski jump earned; and it passes every pit stop and the
finish. The checks every game shares (the replay's shape, the timeline, the splits, no teleports) are checks.py's.

verify(route, replay, claim, splits) returns None for a good run, or a checks.Rejection. The tolerances are the
rounding (mm, mm/s, ms) and the game's own steps, measured on honest runs at 30 to 144 frames a second, with room;
see server/README.md ("The downhill"). What the game does to a step by itself beyond its speeds (an obstacle's push,
a landing's snap, the snow's own lift) is worked out for that step in downhill_give.py.
"""
import collections
import json
import math
from pathlib import Path

import checks
from checks import Malformed, Rejection  # noqa: F401  (the API catches them from here too)
from downhill_give import Give, Window

ROUTE_FILE = Path(__file__).resolve().parent / "downhill.json"
GROUND, AIR, OUT = 0, 1, 3
FLAG = {"jump": 1, "land": 2, "crash": 4, "wheel": 8, "lost": 16, "respawn": 32, "pit": 64, "finish": 128,
        "start": 256, "bump": 512}
PUSH, BRAKE, LEFT, RIGHT = 1, 2, 4, 8
ALL_WHEELS = 31
FORMAT = checks.Format(FLAG, {"space", "bowl", "wheel", "wrecked", "lost", "bump", "pit", "flight"},
                       extra=((-3142, 3142), (0, ALL_WHEELS)), modes=(GROUND, AIR, OUT), keys=15, reach=2 * 10**6)

TOP_SPEED = 40.0                # m/s: faster than the chair goes anywhere, the ski jump's landing hill included
SEGMENT_FAST = 45.0             # m/s: a split between pit stops quicker than this is refused before any replay
STEP = 1 / 120                  # the physics' step (main.js), the longest it gets is 1.5 times that
START_MS = 20                   # the first sample: the step the chair passes the gate
START_SPEED = 8.0               # m/s at the gate: paddled off from a standstill 6 m above it
MAX_GAP = 0.15                  # seconds between samples in play (the recorder takes one every 0.1)
REACH = 0.1                     # m: the rounding and the snow's give, for how far a step goes past its speeds
RESPAWN = 1.5                   # seconds from a spill to the respawn (main.js: 1.6 for a wreck, 1.8 for a fall)
SPACE_BEFORE_JUMP = 0.4         # seconds: the lever's crouch is 0.07, a frame either side
SETTLE_GIVE = 0.3               # seconds: the pins' clock runs with the frames, the run's with the steps
OFF_PISTE = 3.0                 # m past the edge, in the air, before a run is somewhere else altogether
TOL = {
    "ground": 0.01,             # m: a sample on the snow is at its height
    "pushed": 0.6,              # m: or near it, when an obstacle or a wall moved it after the snow did
    "inside": 0.05,             # m: into a rock or a pine
    "trapezoid": 0.06,          # m: where a step goes from its speeds at either end
    "gravity": 0.08,            # m/s: a flight's fall from one sample to the next
    "air_steer": 0.08,          # m/s: and its turn, on top of what the feet can do in the air
    "energy": 0.12,             # J/kg from one sample to the next, on top of the rounding
    "window": 0.6,              # J/kg over WINDOW seconds
    "crash": 1.0,               # J/kg more for a step with a knock (pushed out of it)
    "flight": 0.1,              # m: a ski jump's distance against where it landed
    "pit": 0.05,                # m: where a pit stop or the finish is passed
}
WINDOW = 2.0


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def js_round(x):
    """Math.round: halves go up."""
    return math.floor(x + 0.5)


class Ground:
    __slots__ = ("i", "s", "d", "y", "rim", "hole", "water", "normal", "surface")


class Obstacle:
    """Something hard on the piste (obstacles.js): a rock, a pine, a pole or a piece of the office."""

    def __init__(self, row, route):
        self.kind, self.x, self.y, self.z, self.r, self.top = row[0], *map(float, row[1:6])
        self.size, self.tall = (float(row[6]), float(row[7])) if self.kind == "tree" else (0.0, 0.0)
        _, self.s, _ = route.locate(self.x, self.z)


class Route:
    """The piste as the game exported it, and the questions the checker asks of it: track.js's ground (the height,
    the slope and the surface under a point) on the same centreline, and where the obstacles are."""

    def __init__(self, data):
        self.data = data
        self.fingerprint = data["fingerprint"]
        self.g = float(data["g"])
        self.feel = data["feel"]
        self.soft_pines = "needles" in self.feel        # a pine's branches slow the chair, only its trunk is hard
        f = self.features = data["features"]
        self.checkpoints = list(f["pits"])
        self.gate, self.finish, self.lip_s = f["gate"], f["finish"], f["jump"]["lip"]
        p = data["piste"]
        self.step, self.piste, self.bank, self.bank_height = p["step"], p["piste"], p["bank"], p["bankHeight"]
        self.edge = p["edge"]
        self.bumpy = p.get("bumpy", self.piste)      # how far across the moguls and rollers reach (before: the piste)
        self.river, self.floes = data["river"], data["floes"]
        line = data["line"]
        self.px, self.py, self.pz = line["px"], line["py"], line["pz"]
        self.tx, self.tz, self.hs, self.tilt = line["tx"], line["tz"], line["hs"], line["tilt"]
        self.count = len(self.px)
        self.length = (self.count - 1) * self.step
        self.lip = tuple(data["lip"])
        self.chair, self.pine, self.pins, self.bonus = data["chair"], data["pine"], data["pins"], data["bonus"]
        self.top_speed = TOP_SPEED
        self.buckets = collections.defaultdict(list)
        for row in data["hard"]:
            o = Obstacle(row, self)
            self.buckets[math.floor(o.s)].append(o)

    @classmethod
    def load(cls, path=ROUTE_FILE):
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def segments(self):
        """For each stretch, the gate to the first pit stop, pit stop to pit stop and the last one to the finish:
        (metres, the least seconds it can take)."""
        marks = [self.gate] + self.checkpoints[1:] + [self.finish]
        return [(b - a, (b - a) / SEGMENT_FAST) for a, b in zip(marks, marks[1:])]

    # ------------------------------------------------------------------ track.js

    def locate(self, x, z, hint=-1):
        """The nearest spot on the centreline: (sample index, s, d), as Track.locate()."""
        px, pz, n = self.px, self.pz, self.count
        lo, hi = (0, n - 1) if hint < 0 else (max(0, hint - 30), min(n - 1, hint + 30))
        best, best_d = lo, math.inf
        for i in range(lo, hi + 1):
            dx, dz = x - px[i], z - pz[i]
            dd = dx * dx + dz * dz
            if dd < best_d:
                best, best_d = i, dd
        if hint >= 0 and best in (lo, hi) and lo > 0 and hi < n - 1 and best_d > 900:
            return self.locate(x, z)
        i = best
        u = (x - px[i]) * self.tx[i] + (z - pz[i]) * self.tz[i]
        k = clamp(i if u >= 0 else i - 1, 0, n - 2)
        f = 0.0
        for _ in range(3):
            f = self.across(k, x, z)
            if f < 0 and k > 0:
                k -= 1
            elif f > 1 and k < n - 2:
                k += 1
            else:
                break
        f = clamp(f, -math.inf if k == 0 else 0, math.inf if k == n - 2 else 1)
        tx = self.tx[k] + (self.tx[k + 1] - self.tx[k]) * f
        tz = self.tz[k] + (self.tz[k + 1] - self.tz[k]) * f
        length = math.hypot(tx, tz)
        cx = px[k] + (px[k + 1] - px[k]) * f
        cz = pz[k] + (pz[k + 1] - pz[k]) * f
        s = clamp((k + f) * self.step, 0, self.length)
        return (k + 1 if f > 0.5 else k), s, (-(x - cx) * tz + (z - cz) * tx) / length

    def across(self, k, x, z):
        ax, az = x - self.px[k], z - self.pz[k]
        dx, dz = self.px[k + 1] - self.px[k], self.pz[k + 1] - self.pz[k]
        ex, ez = self.tx[k + 1] - self.tx[k], self.tz[k + 1] - self.tz[k]
        a = -(dx * ex + dz * ez)
        b = ax * ex + az * ez - (dx * self.tx[k] + dz * self.tz[k])
        c = ax * self.tx[k] + az * self.tz[k]
        b = b or 1e-12
        if abs(a) < 1e-9:
            return -c / b
        root = math.sqrt(max(0.0, b * b - 4 * a * c))
        f1, f2, guess = (-b + root) / (2 * a), (-b - root) / (2 * a), -c / b
        return f1 if abs(f1 - guess) < abs(f2 - guess) else f2

    def sample(self, s):
        f = clamp(s / self.step, 0, self.count - 1)
        i = min(self.count - 2, math.floor(f))
        k = f - i
        return self.py[i] + (self.py[i + 1] - self.py[i]) * k, self.tilt[i] + (self.tilt[i + 1] - self.tilt[i]) * k

    def gorge(self, s):
        r = self.features["river"]
        if not r["from"] - 16 < s < r["to"] + 12:
            return 0.0
        return smooth(r["from"] - 16, r["from"] - 3, s) * (1 - smooth(r["to"] + 2, r["to"] + 12, s))

    def on_floe(self, s, d):
        for start, end, left, right in self.floes:
            ragged = 0.45 * math.sin(d * 1.7 + start) + 0.3 * math.sin(d * 3.1 - start * 0.7)
            side = 0.35 * math.sin(s * 1.3 + left) + 0.25 * math.sin(s * 2.9 + right)
            if start + ragged < s < end - ragged and left + side < d < right - side:
                return True
        return False

    def surface_height(self, s, d):
        """The snow's height at (s, d), the rim's (before a hole), whether it's a hole and whether it's water."""
        y, tilt = self.sample(s)
        f, P, B, W = self.features, self.piste, self.bank, self.river["width"]
        K, C, M, R = f["kicker"], f["crevasse"], f["moguls"], f["river"]
        a = abs(d)
        h = 0.01 * min(a, P) ** 2
        if a > P:
            h += self.bank_height * smooth(0, B, a - P)
        if a > P + B:
            h += 0.05 * (a - P - B) + 0.12 * math.sin(s * 0.41 + d * 0.7) * math.sin(s * 0.13)
        gorge = self.gorge(s)
        if gorge > 0:
            wall = self.river["wall"] * smooth(W, W + 1.6, a) + 0.6 * max(0.0, a - W - 1.6)
            h += gorge * (wall - h)
        h += y
        h += tilt * clamp(d, -self.edge, self.edge)
        if K["from"] < s <= K["to"]:
            t = (s - K["from"]) / (K["to"] - K["from"])
            h += K["height"] * t ** 1.6 * (1 - smooth(P + 0.2, P + 1.4, a))
        if M["from"] < s < M["to"] and a < self.bumpy:
            fade = smooth(M["from"], M["from"] + 5, s) * (1 - smooth(M["to"] - 5, M["to"], s)) * \
                (1 - smooth(self.bumpy - 1.5, self.bumpy, a))
            h += M["height"] * fade * math.sin(0.8 * s + 0.6 * d) * math.sin(0.9 * d - 0.25 * s + 0.6)
        for B in f.get("rollers", ()):                 # (a route from before them has none)
            if B["from"] < s < B["to"] and a < self.bumpy:
                fade = smooth(B["from"], B["from"] + 4, s) * (1 - smooth(B["to"] - 4, B["to"], s)) * \
                    (1 - smooth(self.bumpy - 1.5, self.bumpy, a))
                h += B["height"] * fade * math.sin(2 * math.pi * (s - B["from"]) / B["length"] + 0.12 * d)
        rim = h
        hole = C["from"] < s < C["to"] and a < self.edge
        if hole:
            h -= C["depth"]
        water = R["from"] < s < R["to"] and a < W + 0.4 and not self.on_floe(s, d)
        if water:
            h, hole = y - self.river["bed"], True
        if a > self.edge:
            h, hole = y - 80, True
        return h, rim, hole, water

    def height(self, s, d):
        return self.surface_height(s, d)[0]

    def surface(self, s, d):
        a, ice = abs(d), self.features["ice"]
        if ice["from"] < s < ice["to"] and a < self.piste + 1.5:
            return "ice"
        if a < self.piste + 0.4:
            return "piste"
        return "bank" if a < self.piste + self.bank else "powder"

    def ground(self, x, z, hint=-1):
        """Everything under a point, as Track.ground()."""
        g = Ground()
        g.i, g.s, g.d = self.locate(x, z, hint)
        g.y, g.rim, g.hole, g.water = self.surface_height(g.s, g.d)
        e, s, d, i = 0.15, g.s, g.d, g.i
        dhds = (self.height(s + e, d) - self.height(s - e, d)) / (2 * e * self.hs[i] / self.step)
        dhdd = (self.height(s, d + e) - self.height(s, d - e)) / (2 * e)
        tx, tz = self.tx[i], self.tz[i]
        nx, ny, nz = -(dhds * tx - dhdd * tz), 1.0, -(dhds * tz + dhdd * tx)
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        g.normal = (nx / length, ny / length, nz / length)
        g.surface = self.surface(s, d)
        return g

    def right(self, s):
        """The way to the right across the piste at s, flat."""
        f = clamp(s / self.step, 0, self.count - 1)
        i = min(self.count - 2, math.floor(f))
        k = f - i
        tx = self.tx[i] + (self.tx[i + 1] - self.tx[i]) * k
        tz = self.tz[i] + (self.tz[i + 1] - self.tz[i]) * k
        length = math.hypot(tx, tz)
        return -tz / length, tx / length

    def point(self, s, d):
        """A point on the snow at (s, d), as Track.point()."""
        f = clamp(s / self.step, 0, self.count - 1)
        i = min(self.count - 2, math.floor(f))
        k = f - i
        rx, rz = self.right(s)
        x = self.px[i] + (self.px[i + 1] - self.px[i]) * k + rx * d
        z = self.pz[i] + (self.pz[i + 1] - self.pz[i]) * k + rz * d
        return x, self.height(s, d), z

    # ------------------------------------------------------------------ obstacles.js and ride.js

    def near(self, s):
        """The obstacles the game looks at from s (Obstacles.near() looks 3 m either way; 2 here, for the rounding)."""
        for b in range(math.floor(s) - 2, math.floor(s) + 3):
            yield from self.buckets.get(b, ())

    def pine_reach(self, o, lo, hi):
        trunk = self.pine["trunk"]
        r = trunk["radius"] * o.size if lo < trunk["height"] * o.tall else 0.0
        for radius, height, y in self.pine["tiers"]:
            bottom, top = y * o.tall, (y + height) * o.tall
            if hi < bottom or lo > top:
                continue
            r = max(r, radius * o.size * (1 - (max(lo, bottom) - bottom) / (top - bottom)))
        return r

    def reach(self, o, y):
        """How close the chair's axis comes to o with its seat at height y before they touch (Ride.collide()), or
        None if it passes over or under. A pine's trunk, where its branches are soft (soft_pines)."""
        if y > o.top - 0.05:
            return None
        body, r = self.chair["radius"], o.r
        if o.kind == "rock":
            dy = clamp(o.y, y + 0.08, y + 1.4) - o.y
            if abs(dy) >= o.r:
                return None
            r = math.sqrt(o.r * o.r - dy * dy)
        elif o.kind == "tree":
            if self.soft_pines:
                return self.pine["trunk"]["radius"] * o.size + body
            return self.branches(o, y)
        return r + body

    def branches(self, o, y):
        """How close the chair's axis comes to a pine's branches with its seat at height y: those at Mnot's height
        meet the can and the armrests, those lower down the star of casters."""
        return max(self.pine_reach(o, y - o.y + 0.45, y - o.y + 1.6) + self.chair["body"],
                   self.pine_reach(o, y - o.y, y - o.y + 0.45) + self.chair["radius"])

    def flight_bonus(self, metres):
        """Seconds off for a ski jump (bonus.js jumpBonus())."""
        b = self.bonus
        return js_round(10 * b["metre"] * (max(0, metres - b["from"]) + max(0, metres - b["kLine"]))) / 10

    def bonus_ms(self, bowled, metres):
        return js_round(1000 * bowled) + js_round(1000 * self.flight_bonus(metres))


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


class Checker(Give, checks.Checker):
    format = FORMAT
    checkpoint = "pit"
    out = OUT
    max_gap = MAX_GAP
    reach = REACH

    def __init__(self, route, replay, claim, splits, stats=None):
        super().__init__(route, replay, claim, splits)
        self.top_speed = route.top_speed
        self.stats = stats              # calibration: the largest value each check saw, when given a dict

    def over(self, name, value, limit, reason, sample=None, detail=""):
        """Fails when value is past limit; in calibration, notes how close it came."""
        if self.stats is not None:
            best = self.stats.get(name)
            if best is None or value - limit > best[0]:
                self.stats[name] = (value - limit, value, sample.ms if sample else None)
            return
        if value > limit:
            self.fail(reason, sample, detail or f"{name} {value:.3f} > {limit:.3f}")

    def run(self):
        self.check_timeline()
        self.where = []
        hint = -1
        for x in self.samples:
            g = self.route.ground(x.x, x.z, -1 if x.has("respawn") else hint)    # (as Ride.reset() looks)
            hint = g.i
            self.where.append(g)
        self.check_start()
        self.check_flags()
        self.check_splits()
        self.events_at = collections.defaultdict(list)
        for t, name, arg in self.events:
            if name in ("wheel", "wrecked", "lost", "pit", "bump", "flight"):
                self.events_at[self.sample_at(t, name).i].append((name, arg))
        self.check_claim()
        self.check_progress()
        self.check_falls()
        self.check_wheels()
        self.check_jumps()
        self.check_ground()
        self.check_motion()
        self.check_steps()
        self.check_energy()
        self.check_flights()
        self.check_bowling()

    def sample_at(self, t, name):
        """The sample an event came with: the one at its time, with its flag if it has one."""
        found = [x for x in self.samples_by_ms.get(t, ())]
        if not found:
            self.fail("edited", None, f"a {name} without its sample")
        if name in FLAG:
            found = [x for x in found if x.has(name)] or found
        return found[0]

    @property
    def samples_by_ms(self):
        if not hasattr(self, "_by_ms"):
            self._by_ms = collections.defaultdict(list)
            for x in self.samples:
                self._by_ms[x.ms].append(x)
        return self._by_ms

    def at_sample(self, name):
        return [(t, arg, self.sample_at(t, name)) for t, event, arg in self.events if event == name]

    def flagged(self, x, *names):
        return any(x.has(n) for n in names)

    # ------------------------------------------------------------------ the run as a whole

    def check_start(self):
        """The clock starts at the gate: the first sample is the step the chair passed it, from a standstill at
        the top, and the only one with the start flag."""
        first, g = self.samples[0], self.where[0]
        if not first.has("start") or any(x.has("start") for x in self.samples[1:]):
            self.fail("start", first, "no start at the beginning")
        if first.ms > START_MS or first.mode == OUT:
            self.fail("start", first, "the clock started late")
        if not self.route.gate - 0.001 < g.s <= self.route.gate + START_SPEED * 1.5 * STEP + TOL["pit"]:
            self.fail("start", first, f"started at {g.s:.2f} m")
        self.over("start_speed", first.speed, START_SPEED, "start", first)

    def check_claim(self):
        """The board's numbers are the replay's: the clock at the finish, the bonus from the best bowl and the
        longest ski jump, the time the clock less the bonus, the spills and the lost wheels."""
        c, last = self.claim, self.samples[-1]
        if c.get("clock") != last.ms:
            self.fail("edited", last, "the clock isn't the replay's")
        pins = self.route.bonus["pins"]
        bowled = max([0] + [pins.get(str(arg), 0) for t, name, arg in self.events if name == "bowl"])
        jumped = max([0] + [arg / 100 for t, name, arg in self.events if name == "flight"])
        bonus = self.route.bonus_ms(bowled, jumped)
        if c.get("bonus") != bonus:
            self.fail("bonus" if (c.get("bonus") or 0) > bonus else "edited", last, f"bonus {c.get('bonus')} {bonus}")
        if c.get("time") != max(0, last.ms - bonus):
            self.fail("edited", last, "the time isn't the clock less the bonus")
        falls = sum(1 for e in self.events if e[1] in ("lost", "wrecked"))
        dents = sum(1 for e in self.events if e[1] == "wheel")
        if c.get("falls") != falls or c.get("dents") != dents:
            self.fail("edited", last, "the spills or the wheels aren't the replay's")

    def check_progress(self):
        """Every pit stop is passed on the sample that says so, and the finish on the last: before them, the
        chair never got further down."""
        marks = self.route.checkpoints[1:] + [self.route.finish]
        names = ["pit"] * (len(marks) - 1) + ["finish"]
        k = 0
        for x, g in zip(self.samples, self.where):
            if x.mode == OUT:
                continue
            give = TOL["pushed"] if self.flagged(x, "crash", "bump") else TOL["pit"]
            passed = x.has(names[k]) if k < len(marks) else False
            if passed:
                if g.s < marks[k] - give:
                    self.fail(names[k] if names[k] == "finish" else "skipped", x, f"passed {marks[k]} at {g.s:.2f}")
                k += 1
            elif k < len(marks) and g.s > marks[k] + give:
                self.fail("finish" if names[k] == "finish" else "skipped", x, f"past {marks[k]} at {g.s:.2f}")
        if self.samples[-1].mode == OUT:
            self.fail("finish", self.samples[-1], "finished while out")

    def check_falls(self):
        """A spill (into a hole, or a wreck: every wheel gone) and then, at least RESPAWN seconds later, back on the
        snow at the last pit stop, standing still with fresh wheels. Out of play only after a fall, and until then."""
        checkpoint, fell, out = self.route.checkpoints[0], None, False
        pits = self.route.checkpoints
        for x, g in zip(self.samples, self.where):
            happened = self.events_at.get(x.i, ())
            if x.has("respawn"):
                if fell is None:
                    self.fail("respawn", x, "back without a spill")
                if x.t - fell < RESPAWN - 1e-9:
                    self.fail("respawn", x, f"back after {x.t - fell:.2f} s")
                px, py, pz = self.route.point(checkpoint, 0)
                if math.dist((x.x, x.y, x.z), (px, py, pz)) > TOL["ground"] * 2 or x.speed > 0.002 or \
                        x.mode != GROUND or x.extra[1] != ALL_WHEELS:
                    self.fail("respawn", x, f"back at {g.s:.2f}, {g.d:.2f}, not the pit stop at {checkpoint}")
                fell, out = None, False
            elif out and x.mode != OUT:
                self.fail("respawn", x, "back in play without a respawn")
            for name, arg in happened:
                if name == "pit":
                    checkpoint = pits[arg]
                elif name in ("lost", "wrecked"):
                    fell = x.t if fell is None else fell
                if name == "lost":
                    if x.mode != OUT or arg not in ("water", "drop"):
                        self.fail("edited", x, "a fall that isn't one")
                    out = True
                elif name == "wrecked" and x.extra[1] != 0 and not x.has("pit"):
                    self.fail("edited", x, "wrecked with wheels on")
            if x.mode == OUT and not out:
                self.fail("edited", x, "out of play without a fall")

    def check_wheels(self):
        """A wheel goes with a wheel event, one each, and they all come back at a pit stop or a respawn."""
        wheels = self.samples[0].extra[1]
        for x in self.samples[1:]:
            lost = sum(1 for name, _ in self.events_at.get(x.i, ()) if name == "wheel")
            now = x.extra[1]
            if self.flagged(x, "pit", "respawn"):
                if now != ALL_WHEELS:
                    self.fail("edited", x, "a pit stop without fresh wheels")
            elif now & ~wheels or bin(wheels).count("1") - bin(now).count("1") != lost:
                self.fail("edited", x, "a wheel came off without a word, or came back")
            wheels = now

    def check_jumps(self):
        """Every jump after the lever was pulled (Space, a tap), one pull each."""
        pulls = [t for t, name, _ in self.events if name == "space"]
        used = set()
        for x in self.samples:
            if not x.has("jump"):
                continue
            found = [k for k, t in enumerate(pulls)
                     if x.ms - SPACE_BEFORE_JUMP * 1000 <= t <= x.ms and k not in used]
            if found:
                used.add(found[-1])
            elif x.ms > SPACE_BEFORE_JUMP * 1000:      # (pulled before the gate, before the record began)
                self.fail("spacebar", x, "a jump without the lever")

    def check_ground(self):
        """On the snow, at its height; in the air, above it; nowhere in play below a hole's rim (it would have
        fallen), never far past the edge, and never inside a rock or a pine (its trunk, where the branches are soft)."""
        for x, g in zip(self.samples, self.where):
            if x.mode == OUT:
                continue
            pushed = self.flagged(x, "crash", "bump")
            limit = TOL["pushed"] if pushed else TOL["ground"]
            if abs(g.d) > self.route.edge + OFF_PISTE:
                self.fail("off_route", x, f"{g.d:.1f} m across")
            # (the snow under anywhere x can have been: its position is rounded, and it may have just been pushed)
            if g.hole:
                below = self.lowest(x, lambda h: h.rim - 1.2 - x.y if h.hole else -math.inf, limit)
                self.over("rim", below, limit, "levitate", x, "below the rim, still riding")
            if x.mode == GROUND:
                above, below = self.lowest(x, lambda h: x.y - h.y, limit), self.lowest(x, lambda h: h.y - x.y, limit)
                self.over("ground_above", above, limit, "levitate", x, f"{above:.3f} m above the snow")
                self.over("ground_below", below, limit, "edited", x, f"{below:.3f} m in the snow")
            else:
                self.over("air_below", self.lowest(x, lambda h: h.y - x.y, limit), limit, "edited", x)
            for o in self.route.near(g.s):
                reach = self.route.reach(o, x.y)
                if reach is not None:
                    inside = reach - math.hypot(x.x - o.x, x.z - o.z)
                    self.over("inside", inside, TOL["pushed"] if pushed else TOL["inside"], "teleport", x,
                              f"inside a {o.kind}")

    def jumps(self, a, b):
        return b.has("respawn")

    def give(self, a, b):
        give = TOL["pushed"] if self.flagged(b, "crash", "bump") else 0.0
        if math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) > max(a.speed, b.speed) * (b.t - a.t) + REACH + give:
            give += self.moved_by_game(a, b)        # (worked out only when it's needed)
        return give

    def check_steps(self):
        """From one sample to the next, with nothing happening in between: the chair goes where its speeds at
        either end take it, and in the air it falls as a thrown thing does, slowed by the air and turned only a
        little by the feet."""
        G, feel = self.route.g, self.route.feel
        for a, b in zip(self.samples, self.samples[1:]):
            dt = b.t - a.t
            # (on the snow, each step that meets it takes the speed into it away, so only a flight is that exact;
            # and a rock or a pine it leans on nudges it without a crash)
            if a.mode != AIR or b.mode != AIR or b.flags or dt <= 0 or self.touching(a) or self.touching(b):
                continue
            bx, bz = self.unpushed(a, b)
            for p0, v0, v1, p1 in ((a.x, a.vx, b.vx, bx), (a.y, a.vy, b.vy, b.y), (a.z, a.vz, b.vz, bz)):
                self.over("trapezoid", abs(p1 - p0 - (v0 + v1) / 2 * dt), TOL["trapezoid"], "teleport", b)
            vm = ((a.vx + b.vx) / 2, (a.vy + b.vy) / 2, (a.vz + b.vz) / 2)
            speed = math.sqrt(dot(vm, vm))
            dv = (b.vx - a.vx, b.vy - a.vy + G * dt, b.vz - a.vz)
            # the air's drag is k |v| v, k between tucked and sitting up: what's left over is gravity's (down) and
            # the feet's (across)
            k0, k1 = feel["tuck"], feel["drag"]
            drag = [speed * vm[j] * dt for j in range(3)]
            lo, hi = sorted((dv[1] + k0 * drag[1], dv[1] + k1 * drag[1]))
            fall = 0.0 if lo <= 0 <= hi else min(abs(lo), abs(hi))
            across = drag[0] * drag[0] + drag[2] * drag[2]
            k = clamp(-(dv[0] * drag[0] + dv[2] * drag[2]) / across, k0, k1) if across > 0 else k0
            turn = math.hypot(dv[0] + k * drag[0], dv[2] + k * drag[2])
            self.over("gravity", fall, TOL["gravity"], "antigravity", b)
            steer = feel["steer"]["air"] * dt + TOL["air_steer"]
            if turn > steer:
                steer += self.nudge(a, b)
            self.over("air_steer", turn, steer, "antigravity", b)

    def check_energy(self):
        """Never more energy than the chair can have. From one sample to the next its energy per kilogram (the
        speed's and the height's) grows by no more than the feet's steering and paddling and the gas lift put in,
        less what the snow and the air take at the very least, and the rounding; and over WINDOW seconds too, so
        that allowance can't be stacked into a faster run."""
        G, feel, route = self.route.g, self.route.feel, self.route
        P, B = route.piste, route.bank
        ice = route.features["ice"]
        window, total = Window(self, WINDOW, TOL["window"]), 0.0
        for a, b in zip(self.samples, self.samples[1:]):
            dt = b.t - a.t
            if a.mode == OUT or b.mode == OUT or b.has("respawn") or dt <= 0:
                window.clear()
                total = 0.0
                continue
            ga, gb = self.where[a.i], self.where[b.i]
            va, vb = a.speed, b.speed
            rise = 0.5 * (vb * vb - va * va) + G * (b.y - a.y)
            keys = self.keys_held(a.ms, b.ms)
            on_snow = a.mode == GROUND and b.mode == GROUND and not self.flagged(b, "land", "jump")
            in_air = a.mode == AIR and b.mode == AIR and not self.flagged(b, "land", "jump")
            inner = 0.0 if ga.d * gb.d < 0 else min(abs(ga.d), abs(gb.d))
            # the feet: steering across the piste, as hard as the snow under it lets them
            if in_air:
                steer = feel["steer"]["air"]
            elif on_snow:
                steer = feel["steer"]["piste" if inner < P + 0.4 else "bank" if inner < P + B else "powder"]
            else:
                steer = max(feel["steer"].values())
            if not keys & (LEFT | RIGHT):
                steer *= 0.05
            ra, rb = route.right(ga.s), route.right(gb.s)
            lateral = max(abs(a.vx * ra[0] + a.vz * ra[1]), abs(b.vx * rb[0] + b.vz * rb[1])) + 0.5
            if not in_air:      # (on the snow the feet push along it: across a bank, harder than its width says)
                lateral /= min(self.tilt(ga, ra), self.tilt(gb, rb))
            gain = steer * lateral * dt
            if keys & PUSH and not in_air and min(va, vb) < feel["pushTop"] + 0.5:
                gain += feel["push"] * feel["pushTop"] * dt
            if b.has("jump"):
                gain += self.lift(b)
            # the snow and the air, at the very least
            v = min(va, vb)
            loss = 0.9 * feel["tuck"] * v ** 3 * dt
            if on_snow and v > 0.5:
                icy = ice["from"] - 1 < max(ga.s, gb.s) and min(ga.s, gb.s) < ice["to"] + 1 and inner < P + 1.5
                roll = feel["roll"]["ice"] if icy else \
                    feel["roll"]["piste" if inner < P + 0.4 else "bank" if inner < P + B else "powder"]
                missing = 5 - bin(a.extra[1]).count("1")
                roll += 0.05 * missing
                loss += 0.9 * roll * G * min(ga.normal[1], gb.normal[1]) * v * dt
            slack = 0.015 + 0.0018 * max(va, vb) + (TOL["crash"] if self.flagged(b, "crash", "bump") else 0.0)
            if self.at_rim(a) or self.at_rim(b):
                slack += G * max(abs(a.vy), abs(b.vy)) * dt
            excess = rise - gain + loss - slack
            # less what the game gave it by itself (downhill_give.py), worked out only where it makes a difference
            owed = excess > 0
            if owed and (excess > TOL["energy"] or self.stats is not None):
                excess, owed = self.credited(a, b, excess), False
            self.over("energy", excess, TOL["energy"], "antigravity", b, f"{excess:.2f} J/kg too much")
            total = window.add(b.t, excess, (a, b) if owed else None)
            self.over("energy_window", total, TOL["window"], "antigravity", b, f"{total:.2f} J/kg too much")

    def lift(self, x):
        """The most energy the gas lift put in on the step that ends at x: FEEL.jump along the snow's normal under
        the step before (at a hole's rim that normal leans right over, so a jump there throws the chair forward)."""
        lift, best = self.route.feel["jump"], -math.inf
        v = (x.vx, x.vy, x.vz)
        for share in (0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75):
            g = self.route.ground(x.x - x.vx * STEP * share, x.z - x.vz * STEP * share, self.where[x.i].i)
            best = max(best, dot(v, g.normal))
        # from v - lift n before it to v after: lift (v . n) - lift^2 / 2
        return max(0.5 * lift * lift, lift * best - 0.5 * lift * lift) + 2.0

    def at_rim(self, x):
        """Whether x is at a hole's rim (the crevasse, the river between the floes, the drop past the edge). The
        snow's normal there is half the rim's, half the hole's, so a step that meets the snow can be lifted onto
        the rim without the speed into it taken away: the game gains a little height there, honestly."""
        g = self.where[x.i]
        if g.normal[1] < 0.7:
            return True
        return any(self.route.surface_height(g.s + ds, g.d + dd)[2] != g.hole
                   for ds, dd in ((0.5, 0), (-0.5, 0), (0, 0.5), (0, -0.5)))

    def touching(self, x):
        """Whether x is up against a rock or a pine (or nearly), which pushes it about without a crash, or in a pine's
        branches (or nearly), which slow it."""
        for o in self.route.near(self.where[x.i].s):
            reach = self.route.reach(o, x.y)
            if o.kind == "tree" and reach is not None:
                reach = self.route.branches(o, x.y)
            if reach is not None and math.hypot(x.x - o.x, x.z - o.z) < reach + 0.3:
                return True
        return False

    def check_flights(self):
        """A ski jump's distance is from the lip to where it came down, in one flight from the lip."""
        lip, at = self.route.lip, self.route.lip_s
        for t, cm, x in self.at_sample("flight"):
            if type(cm) is not int or not x.has("land"):
                self.fail("edited", x, "a ski jump without a landing")
            self.over("flight", abs(math.dist((x.x, x.y, x.z), lip) - cm / 100), TOL["flight"], "bonus", x,
                      "a ski jump that's longer than it flew")
            # back through the flight to the last sample on the snow: it took off in between, off the lip
            k = x.i - 1
            while k > 0 and self.samples[k].mode == AIR and not self.samples[k].has("land"):
                k -= 1
            off, first = self.samples[k], self.samples[k + 1]
            if first is x or off.mode != GROUND:
                self.fail("bonus", x, "a ski jump that didn't fly")
            give = TOL["pushed"]
            if not (self.where[first.i].s > at - 6 - give and self.where[off.i].s < at + 2 + give):
                self.fail("bonus", x, "a ski jump that didn't take off from the lip")

    def check_bowling(self):
        """A bowl's score comes the pins' settle time after the chair knocks the first one (sooner for a strike),
        and a respawn stands them all up again."""
        settle = self.route.pins["settle"]
        respawns = collections.deque(x.ms for x in self.samples if x.has("respawn"))
        knocked = None
        for t, name, arg in self.events:
            while respawns and respawns[0] <= t:
                respawns.popleft()
                knocked = None
            if name == "bump" and arg == "pin" and knocked is None:
                knocked = t
            elif name == "bowl":
                if type(arg) is not int or not 0 <= arg <= 10:
                    self.fail("edited", None, "a bowl that isn't one")
                if knocked is None:
                    self.fail("bonus", None, "bowled without touching a pin")
                wait = (t - knocked) / 1000
                if wait > settle + SETTLE_GIVE or wait < 0 or arg < 10 and wait < settle - SETTLE_GIVE:
                    self.fail("bonus", None, f"the pins scored after {wait:.2f} s")
                knocked = None


def verify(route, replay, claim, splits):
    """None if the run holds up, else the Rejection. Raises Malformed for a replay that isn't one."""
    try:
        Checker(route, replay, claim, splits).run()
    except Rejection as rejection:
        return rejection
    return None
