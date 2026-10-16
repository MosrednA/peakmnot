"""Checks a recorded Reaction Run (peak/emoji/record.js) against its field and the game's rules (emoji.json, exported
by peak/emoji/routedata.js from main.js, field.js, stickers.js and cracks.js). Like the other games' checkers it
doesn't re-run the game; it checks that every step is one Mnot can take on that field. The field is one of the
board's, by its seed. Mnot starts at the start, never goes through a wall and never faster than its legs; it speeds
up only with the run key held, and slides the way the snow lets it: let go, straight on, slowing; running, turned by
where it faces. Every emoji it fetched was the list's next, in reach and standing; every wrong one it touched cost a
try, and none it ran into let it through. Every crack it stepped on gave way when it should, the passages at the end
too; it never walked over a hole, and out of one it dropped into, it climbed out on the side it came from. And it
fetched :peak-mnot: in the middle, once it had landed. The checks every game shares (the replay's shape, the
timeline, the splits, no teleports) are checks.py's.

verify(route, replay, claim, splits) returns None for a good run, or a checks.Rejection. The tolerances are the
rounding (mm, mm/s, ms, mrad) and the game's own steps (a frame, up to 1/20 s: peak/kit/loop.js), measured on honest
runs at 20 to 144 frames a second, with room; see server/README.md ("Reaction Run").
"""
import bisect
import collections
import json
import math
from pathlib import Path

import checks
from checks import Malformed, Rejection  # noqa: F401  (the API catches them from here too)

ROUTE_FILE = Path(__file__).resolve().parent / "emoji.json"
SNOW, PIT = 0, 3
FLAG = {"start": 1, "take": 2, "hit": 4, "crack": 8, "hole": 16, "pit": 32, "climb": 64, "bonk": 128, "finish": 256}
RUN, BRAKE, LEFT, RIGHT, PEEK = 1, 2, 4, 8, 16
FORMAT = checks.Format(FLAG, ("take", "hit", "crack", "hole", "pit", "bonk"), extra=((-3142, 3142),),
                       modes=(SNOW, PIT), keys=31, reach=10**5, speed=2 * 10**4)

STEP = 0.05                     # s: the longest step the game takes (a frame, at most this)
START_MS = 51                   # the first sample: the clock's first step
MAX_GAP = 0.155                 # s between samples: one every 0.1 s of the clock, on the step that gets there
SEGMENT_SLACK = 0.9             # a split quicker than this share of the stretch, straight and at top speed, is refused
CLIMB = {"past": 0.3, "room": 0.4}      # m (cracks.js, outside()): how far past the hole's edge Mnot climbs out, and
                                        # how far short of the ends of the crack
TOL = {
    "mm": 0.003,                # m: two positions to the mm, and a little
    "speed": 0.005,             # m/s: a speed from mm/s
    "ms": 0.002,                # s: two times to the ms
    "wall": 0.008,              # m: into a wall (the game pushes out of every wall twice a step)
    "slip": 0.006,              # m: sideways off the speeds' way, two positions and two speeds to the mm
    "dv": 0.01,                 # m/s: a change of speed from one sample to the next, on top of the snow's grip
    "trapezoid": 0.006,         # m: where a step goes from its speeds at either end
    "glide": 0.03,              # m/s: let go, sideways off the way Mnot was going
    "grip": 0.3,                # m/s: running, sideways off the way it faces, past the snow's grip
    "bump": 0.01,               # m/s: a wrong one's bump, against what it should be
}


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


class Crack:
    """A crack across a passage (cracks.js): its middle on the line between two cells, and its frame there, along the
    passage (l) and across it (c)."""

    def __init__(self, key, route, finale):
        c, r = (int(v) for v in key[1:].split(","))
        x, z = route.centre(c, r)
        if key[0] == "e":
            self.x, self.z, self.axis = x - route.cell / 2, z, "x"
        else:
            self.x, self.z, self.axis = x, z + route.cell / 2, "z"
        self.key, self.finale = key, finale
        self.wide, self.half, self.body = route.crack["wide"], route.crack["depth"] / 2, route.body

    def frame(self, x, z):
        dx, dz = x - self.x, z - self.z
        return (dz, dx) if self.axis == "x" else (dx, dz)

    def place(self, l, c):
        return (self.x + c, self.z + l) if self.axis == "x" else (self.x + l, self.z + c)

    def edge(self, l):
        """m across from the middle to the hole's edge, l m along it."""
        k = 2 * l / self.wide
        return self.half * math.sqrt(max(0.0, 1 - k ** 6))

    def over(self, x, z, near=0.0):
        l, c = self.frame(x, z)
        return abs(l) < self.wide / 2 and abs(c) < self.edge(l) + near

    def outside(self, x, z, side):
        """Where Mnot, dropped in at x, z, climbs out on that side (-1 or 1, across)."""
        l, _ = self.frame(x, z)
        room = self.wide / 2 - self.body - CLIMB["room"]
        return self.place(clamp(l, -room, room), side * (self.half + self.body + CLIMB["past"]))


class Field:
    """One of the board's fields (field.js, layout()): its walls as boxes, as build() makes them, its emoji with
    their places on the list, and its cracks, the field's own first, then the passages giving way at the end."""

    def __init__(self, seed, data, route):
        self.seed = seed
        half, t = route.cell / 2, route.wall / 2
        self.boxes = []
        for key in data["walls"]:
            c, r = (int(v) for v in key[1:].split(","))
            x, z = route.centre(c, r)
            if key[0] == "e":
                self.boxes.append((x - half - t, z - half - t, x - half + t, z + half + t))
            else:
                self.boxes.append((x - half - t, z + half - t, x + half + t, z + half + t))
        w, d = route.cols / 2 * route.cell, route.rows * route.cell     # the edge all round
        self.boxes += [(-w - t, -t, w + t, t), (-w - t, d - t, w + t, d + t), (-w - t, -t, -w + t, d + t),
                       (w - t, -t, w + t, d + t)]
        self.emojis = [(*route.centre(c, r), listed) for c, r, listed in data["emojis"]]
        listed = sorted((e[2], i) for i, e in enumerate(self.emojis) if e[2] >= 0)
        self.order = [i for _, i in listed]
        if [n for n, _ in listed] != list(range(route.list)):
            raise ValueError(f"field {seed}: the list isn't 0..{route.list - 1}")
        self.cracks = [Crack(k, route, False) for k in data["cracks"]] + [Crack(k, route, True) for k in data["finale"]]

    def wall(self, x, z):
        """m from x, z to the nearest wall."""
        best = math.inf
        for x0, z0, x1, z1 in self.boxes:
            dx, dz = x - clamp(x, x0, x1), z - clamp(z, z0, z1)
            best = min(best, math.hypot(dx, dz))
        return best


class Route:
    """The game as the page exported it: the field's shape, Mnot's moves and the rules, and the board's fields by
    seed. checkpoints: the start, then each of the list's emoji (a split comes in for each)."""

    def __init__(self, data):
        self.data = data
        self.fingerprint = data["fingerprint"]
        f = data["field"]
        self.cols, self.rows, self.cell, self.wall = f["cols"], f["rows"], f["cell"], f["wall"]
        self.start, self.peak = self.centre(*f["start"]), self.centre(*f["peak"])
        m = data["mnot"]
        self.body, self.run, self.bonk, self.lives, self.hit, self.pit = (m[k] for k in
                                                                           ("body", "run", "bonk", "lives", "hit", "pit"))
        self.touch, self.warp, self.prize, self.finale = data["touch"], data["warp"], data["prize"], data["finale"]
        self.crack, self.quake = data["crack"], data["quake"]
        run = self.run
        self.top_speed = run["top"]
        # m/s²: the most the snow changes Mnot's speed by, running into the opposite of where it goes, or braking
        self.accel = run["top"] * max(2 * run["grip"], run["brake"], run["glide"])
        self.start_speed = run["top"] * (1 - math.exp(-run["grip"] * STEP))       # after the clock's first step
        # running with the same keys held: how fast it can turn (steering, and a bonk's spin on top), and how fast the
        # snow's pull can change (m/s³), by the way it faces turning and the speed closing in on it
        self.spin = run["turn"] + run["top"] * self.bonk["spin"]
        self.jerk = run["grip"] * (run["top"] * self.spin + 2 * run["top"] * run["grip"])
        self.list = data["deal"]["list"]
        self.checkpoints = list(range(self.list + 1))
        self.fields = {int(seed): Field(int(seed), layout, self) for seed, layout in data["fields"].items()}

    @classmethod
    def load(cls, path=ROUTE_FILE):
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def centre(self, c, r):
        """The middle of a cell on the snow, as (x, z) (field.js)."""
        return ((self.cols - 1) / 2 - c) * self.cell, (r + 0.5) * self.cell

    def segments(self):
        """For each stretch, the start to the list's first and each to the next, then the last to :peak-mnot:
        (metres, the least seconds it can take): on the board's field where it's shortest, in a straight line, from
        touching one to touching the next."""
        least = [math.inf] * (self.list + 1)
        for field in self.fields.values():
            spots = [self.start] + [field.emojis[i][:2] for i in field.order] + [self.peak]
            for n, (a, b) in enumerate(zip(spots, spots[1:])):
                reach = (self.touch if n else 0) + (self.touch if n < self.list else self.prize["touch"])
                least[n] = min(least[n], max(0.0, math.dist(a, b) - reach))
        wait = self.finale["drop"] + self.prize["fall"] - STEP      # :peak-mnot: lands first
        out = [(m, SEGMENT_SLACK * m / self.top_speed) for m in least]
        out[-1] = (out[-1][0], max(out[-1][1], wait))
        return out


class Checker(checks.Checker):
    format = FORMAT
    checkpoint = "take"
    out = PIT
    max_gap = MAX_GAP
    reach = TOL["mm"]

    def __init__(self, route, replay, claim, splits, stats=None):
        super().__init__(route, replay, claim, splits)
        seed = replay.get("seed")
        if type(seed) is not int or not 0 <= seed <= 2**31:
            raise Malformed("seed")
        self.seed, self.field = seed, None
        self.top_speed = route.top_speed + TOL["speed"]
        self.stats = stats              # calibration: the largest value each check saw, when given a dict
        self.input_ms = [t for t, _ in self.inputs]
        self.by_ms = collections.defaultdict(list)
        for x in self.samples:
            self.by_ms[x.ms].append(x)

    def keys_held(self, t0, t1):
        """checks.Checker's, by bisection: a run can hold thousands of key changes."""
        i, j = bisect.bisect_right(self.input_ms, t0), bisect.bisect_right(self.input_ms, t1)
        mask = self.inputs[i - 1][1] if i else 0
        for _, keys in self.inputs[i:j]:
            mask |= keys
        return mask

    def steady(self, t0, t1, bits):
        """Whether the keys in bits stay as they were at t0 (ms) until t1."""
        i, j = bisect.bisect_right(self.input_ms, t0), bisect.bisect_left(self.input_ms, t1)
        first = (self.inputs[i - 1][1] if i else 0) & bits
        return all(keys & bits == first for _, keys in self.inputs[i:j])

    def beyond(self, name, value, limit, reason, sample=None, detail=""):
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
        self.field = self.route.fields.get(self.seed)
        if self.field is None:
            self.fail("practice", None, f"field {self.seed} isn't one of the board's")
        self.check_start()
        self.check_flags()
        self.check_splits()
        self.check_claim()
        self.with_sample = collections.defaultdict(list)       # sample index: its events, (name, argument)
        for t, name, arg in self.events:
            self.with_sample[self.sample_at(t, name).i].append((name, arg))
        self.walls = [self.field.wall(x.x, x.z) for x in self.samples]
        self.check_ground()
        self.check_motion()
        self.check_steps()
        self.check_cracks()
        self.check_pits()
        self.check_touches()
        self.check_finish()

    def sample_at(self, t, name):
        """The sample an event came with: the one at its time, with its flag."""
        found = self.by_ms.get(t, ())
        flagged = [x for x in found if x.has(name)]
        if not flagged:
            self.fail("edited", found[0] if found else None, f"a {name} without its sample")
        return flagged[0]

    def at_sample(self, name):
        return [(t, arg, self.sample_at(t, name)) for t, event, arg in self.events if event == name]

    def names(self, x):
        return {name for name, _ in self.with_sample.get(x.i, ())}

    # ------------------------------------------------------------------ the run as a whole

    def check_start(self):
        """The clock starts with Mnot's first step: the first sample is that step's, from a standstill at the start,
        and the only one with the start flag."""
        first = self.samples[0]
        if not first.has("start") or any(x.has("start") for x in self.samples[1:]):
            self.fail("start", first, "no start at the beginning")
        if first.ms > START_MS or first.mode != SNOW:
            self.fail("start", first, "the clock started late")
        moved = math.hypot(first.x - self.route.start[0], first.z - self.route.start[1])
        self.beyond("start", moved, self.route.start_speed * STEP + TOL["mm"], "start", first)
        self.beyond("start_speed", first.speed, self.route.start_speed + TOL["speed"], "start", first)

    def check_claim(self):
        """The board's numbers are the replay's: the clock at :peak-mnot:, the wrong ones touched and the holes
        dropped into; and a run with all its tries gone is over before the end."""
        c, last = self.claim, self.samples[-1]
        hits = sum(1 for e in self.events if e[1] == "hit")
        pits = sum(1 for e in self.events if e[1] == "pit")
        if c.get("time") != last.ms:
            self.fail("edited", last, "the time isn't the replay's")
        if c.get("falls") != hits or c.get("dents") != pits:
            self.fail("edited", last, "the wrong ones or the holes aren't the replay's")
        if hits >= self.route.lives:
            self.fail("tries", last, f"{hits} wrong ones")

    def check_ground(self):
        """On the snow, flat, and out of the walls: pushed out of them every step, as round as Mnot is."""
        for x, wall in zip(self.samples, self.walls):
            if x.y != 0 or x.vy != 0:
                self.fail("levitate", x, f"at {x.y:.3f} m, {x.vy:.3f} m/s up")
            if x.mode == SNOW or x.has("pit"):
                self.beyond("wall", self.route.body - wall, TOL["wall"], "wall", x, f"{wall:.3f} m from a wall")
        for _, arg, x in self.at_sample("bonk"):    # a hard one, against a wall, just pushed out of it
            if arg < round(self.route.bonk["from"] * 100) - 1 or self.walls[x.i] > self.route.body + TOL["mm"]:
                self.fail("edited", x, "a bonk that isn't one")

    # ------------------------------------------------------------------ getting about

    def give(self, a, b):
        """Up to top speed all the way (the samples' speeds at either end can be less), and a wall's push."""
        dt = b.t - a.t
        near = min(self.walls[a.i], self.walls[b.i]) < self.route.body + self.top_speed * dt + 0.05
        return max(0.0, self.top_speed - max(a.speed, b.speed)) * dt + (0.01 if near else 0.0)

    def near_wall(self, a, b, dt):
        reach = self.route.body + max(a.speed, b.speed) * dt + self.route.accel * dt * dt / 2 + 0.02
        return min(self.walls[a.i], self.walls[b.i]) < reach

    def check_steps(self):
        """From one sample to the next on the snow: never more change of speed than the snow's grip gives (a wall's
        bounce and a wrong one's bump aside); faster only with the run key; where it went, what its speeds say; and
        the way it slides: let go, straight on along the way it was going; running, turned by where it faces."""
        r, bounce = self.route, 1 + self.route.bonk["bounce"]
        for a, b in zip(self.samples, self.samples[1:]):
            if a.mode != SNOW:
                continue
            dt = b.t - a.t
            names = self.names(b)
            if dt <= 0 or "hit" in names or b.mode == PIT:
                continue                # the bump, the drop into a hole: a speed out of nowhere, checked there
            dvx, dvz = b.vx - a.vx, b.vz - a.vz
            dv = math.hypot(dvx, dvz)
            wall = self.near_wall(a, b, dt)
            allow = r.accel * dt + TOL["dv"]
            if wall:
                # each wall it slid along or bounced off turned back what ran into it, and some
                bonks = sum(arg / 100 for name, arg in self.with_sample.get(b.i, ()) if name == "bonk")
                allow += bounce * (2 * r.accel * dt + 2 * r.bonk["from"] + bonks)
            self.beyond("accel", dv, allow, "drift", b)
            if b.speed > a.speed + TOL["speed"] and not self.keys_held(a.ms, b.ms) & RUN:
                self.fail("moonwalk", b, f"{a.speed:.2f} to {b.speed:.2f} m/s without running")
            ex = b.x - a.x - (a.vx + b.vx) / 2 * dt
            ez = b.z - a.z - (a.vz + b.vz) / 2 * dt
            allow = r.accel * dt * dt / 4 + dv * STEP / 2 + TOL["trapezoid"]
            if wall:
                allow += (allow + bounce * (2 * r.accel * dt + 2 * r.bonk["from"])) * dt / 2 + 0.02
            self.beyond("trapezoid", math.hypot(ex, ez), allow, "teleport", b)
            if not wall and self.steady(a.ms, b.ms, RUN):
                self.check_slide(a, b, dt, dvx, dvz, ex, ez, self.steady(a.ms, b.ms, 31))

    def check_slide(self, a, b, dt, dvx, dvz, ex, ez, keyed):
        """Between two samples running all along, or not running all along, and no wall in reach: sideways, where
        Mnot went is what its speeds say, near enough to the mm (the give the trapezoid check needs for the keys
        and the stick is all along the way; steering only turns it, smoothly). keyed, the same keys held all along:
        let go (or braking), the snow only slows Mnot, the way it was going; running, its speed across where it
        faces fades at the snow's grip, whatever the stick says about how fast."""
        r = self.route
        mx, mz = (a.vx + b.vx) / 2, (a.vz + b.vz) / 2
        steps = math.hypot(dvx, dvz) * STEP / 2     # the game's steps, each going by the speed at its end
        if not self.keys_held(a.ms, a.ms) & RUN:
            speed = math.hypot(mx, mz)
            if speed > 0.1:
                if keyed:
                    self.beyond("glide", abs(dvx * mz - dvz * mx) / speed, TOL["glide"], "drift", b)
                self.beyond("slip", abs(ex * mz - ez * mx) / speed, steps + TOL["slip"], "drift", b)
            return
        yaw = a.extra[0] / 1000 + wrap((b.extra[0] - a.extra[0]) / 1000) / 2
        nx, nz = math.cos(yaw), -math.sin(yaw)      # across where it faces (ahead: sin, cos)
        if keyed:
            across = dvx * nx + dvz * nz
            expected = -r.run["grip"] * dt * (mx * nx + mz * nz)
            self.beyond("grip", abs(across - expected), TOL["grip"], "drift", b)
        # the pull's smooth change, and a stick's throttle jumping about, which pulls along where it faces (turned
        # by up to half the step's spin either side of the middle)
        stick = r.run["grip"] * r.top_speed * math.sin(min(r.spin * dt / 2, 1)) * dt * dt / 8
        self.beyond("slip", abs(ex * nx + ez * nz), r.jerk * dt ** 3 / 12 + stick + steps + TOL["slip"], "drift", b)

    # ------------------------------------------------------------------ the cracks and the holes

    def check_cracks(self):
        """A crack is stepped on once, from the snow, at its edge; it gives way as long after as the snow holds; the
        passages at the end give way after the list is done, one after another from Mnot out; and Mnot is never on
        a crack's edge before it was stepped on, nor over a hole on the snow."""
        r, cracks, s = self.route, self.field.cracks, self.samples
        self.cracked, self.opened = {}, {}
        takes = [x for _, _, x in self.checkpoints]
        last_take = takes[-1] if len(takes) == r.list else None
        for t, name, arg in self.events:
            if name not in ("crack", "hole"):
                continue
            x = self.sample_at(t, name)
            if not 0 <= arg < len(cracks):
                self.fail("edited", x, f"crack {arg}")
            k = cracks[arg]
            if name == "crack":
                if k.finale or arg in self.cracked:
                    self.fail("crack", x, f"crack {arg} stepped on twice")
                if x.mode != SNOW and not x.has("pit") or not k.over(x.x, x.z, r.crack["near"] + TOL["mm"]):
                    self.fail("crack", x, f"crack {arg} stepped on from afar")
                self.cracked[arg] = x
                continue
            if arg in self.opened:
                self.fail("crack", x, f"crack {arg} gave way twice")
            if k.finale:
                if last_take is None or x.ms < last_take.ms:
                    self.fail("crack", x, f"passage {arg} gave way before the list was done")
                lo, hi = self.quaking(k, last_take)
            else:
                if arg not in self.cracked:
                    self.fail("crack", x, f"crack {arg} gave way without a step on it")
                lo = hi = self.cracked[arg].t + r.crack["hold"]
            self.beyond("hold", lo - TOL["ms"] - x.t, 0, "crack", x, f"crack {arg} gave way early")
            self.beyond("hold", x.t - hi - STEP - TOL["ms"], 0, "crack", x, f"crack {arg} held too long")
            self.opened[arg] = x
        end = s[-1].t
        for i, k in enumerate(cracks):
            if i in self.opened:
                continue
            due = self.cracked[i].t + r.crack["hold"] if i in self.cracked else \
                self.quaking(k, last_take)[1] if k.finale and last_take else None
            if due is not None and due + STEP + TOL["ms"] < end:
                self.fail("crack", s[-1], f"crack {i} never gave way")
        for x in s:
            if x.mode != SNOW:
                continue
            for i, k in enumerate(cracks):
                if not k.finale and k.over(x.x, x.z, r.crack["near"] - TOL["mm"]) and \
                        (i not in self.cracked or self.cracked[i].ms > x.ms):
                    self.fail("crack", x, f"over crack {i} and it held")
                if i in self.opened and self.opened[i].ms <= x.ms and k.over(x.x, x.z, -TOL["mm"]):
                    self.fail("hole", x, f"over hole {i}")

    def quaking(self, k, take):
        """When a passage at the end gives way, at the earliest and latest: after the list's last emoji, in turn by
        how far it is from where Mnot fetched it (the nearest first; a tie either way)."""
        q = self.route.quake
        far = lambda c: math.hypot(c.x - take.x, c.z - take.z)    # noqa: E731
        mine = far(k)
        rest = [far(c) for c in self.field.cracks if c.finale and c is not k]
        first = sum(1 for d in rest if d < mine - TOL["mm"])
        last = sum(1 for d in rest if d < mine + TOL["mm"])
        return tuple(take.t + q["wait"] + q["hold"] + n * q["apart"] for n in (first, last))

    def check_pits(self):
        """Into an open hole, over it, from the snow; in it as long as the drop, the flailing and the hop out take;
        and out on the side it came from, clear of the edge."""
        p, cracks, s = self.route.pit, self.field.cracks, self.samples
        stay = p["down"] + p["stay"] + p["out"]
        pit = None                      # (the sample it dropped in on, the crack, the sides it may come out)
        for x in s:
            if x.has("climb"):
                if pit is None:
                    self.fail("pit", x, "out of a hole it wasn't in")
                at, k, sides = pit
                waited = x.t - at.t
                self.beyond("pit", stay - TOL["ms"] - waited, 0, "pit", x, f"out after {waited:.2f} s")
                self.beyond("pit", waited - stay - STEP - TOL["ms"], 0, "pit", x, f"out after {waited:.2f} s")
                off = min(math.hypot(x.x - ox, x.z - oz) for ox, oz in (k.outside(at.x, at.z, side) for side in sides))
                self.beyond("climb", off, TOL["mm"], "pit", x, f"out {off:.3f} m off where it climbs out")
                if x.mode != (PIT if x.has("pit") else SNOW):
                    self.fail("pit", x, "out of a hole and still in one")
                pit = None
            if x.has("pit"):
                into = [arg for name, arg in self.with_sample.get(x.i, ()) if name == "pit"]
                if pit is not None or len(into) != 1 or not 0 <= into[0] < len(cracks) or x.mode != PIT:
                    self.fail("pit", x, "into a hole from a hole")
                k = cracks[into[0]]
                if into[0] not in self.opened or self.opened[into[0]].ms > x.ms:
                    self.fail("pit", x, f"into hole {into[0]} before it opened")
                if not k.over(x.x, x.z, TOL["mm"]):
                    self.fail("pit", x, f"into hole {into[0]} from beside it")
                pit = (x, k, self.came_from(k, x))
            elif not x.has("climb"):
                if (x.mode == PIT) != (pit is not None):
                    self.fail("pit", x, "in a hole without dropping in" if pit is None else "out without climbing")
                if pit and x.t - pit[0].t > stay + STEP + TOL["ms"]:
                    self.fail("pit", x, "too long in a hole")

    def came_from(self, k, x):
        """The sides of the hole Mnot came from (cracks.js keeps the last it was on, off it): the side of the last
        sample before it was over the hole, and any it may have been on, off it, between that one and the drop."""
        s, i = self.samples, x.i - 1
        while i >= 0 and s[i].mode == SNOW and k.over(s[i].x, s[i].z):
            i -= 1
        if i < 0 or s[i].mode != SNOW:
            return (-1, 1)
        sides = set()
        for a, b in zip(s[i:x.i], s[i + 1:x.i + 1]):
            for u in (0, 0.25, 0.5, 0.75, 1):
                l, c = k.frame(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u)
                if abs(l) >= k.wide / 2 or abs(c) > k.edge(l) - 0.05:
                    sides.add(1 if c > 0 else -1)
                    if abs(c) < 0.01:
                        sides.update((-1, 1))
        return tuple(sides) or (-1, 1)

    # ------------------------------------------------------------------ the emoji

    def check_touches(self):
        """Every emoji fetched is the list's next, in reach and standing; every wrong one touched is in reach,
        standing and not the next, a while after the last; and none in reach was let off: in Mnot's reach, the first
        standing one (in the field's order) is touched there, once the last wrong one's while is over."""
        r, f = self.route, self.field
        touch, safe, back = r.touch, r.hit["safe"], r.warp["back"] + 0.3
        self.gone, self.blinked = {}, collections.defaultdict(list)     # emoji: ms it went for good; ms it blinked
        takes = {x.i for _, _, x in self.checkpoints}
        hits = [(x, arg) for _, arg, x in self.at_sample("hit")]
        touches = sorted([(x.ms, 0, "take", arg, x) for _, arg, x in self.checkpoints]
                         + [(x.ms, 1, "hit", arg, x) for x, arg in hits], key=lambda e: e[:2])
        n, last = 0, None
        for _, _, what, i, x in touches:
            if what == "take":          # the n-th (check_splits: in order)
                self.check_reach(x, f.order[i - 1], "take")
                self.gone[f.order[i - 1]] = x.ms
                n = i
                continue
            if not 0 <= i < len(f.emojis):
                self.fail("edited", x, f"emoji {i}")
            listed = f.emojis[i][2]
            if n == r.list or 0 <= listed <= n or i in self.gone:
                self.fail("grab", x, f"emoji {i} touched gone or as the next")
            self.check_reach(x, i, "hit")
            if last is not None:
                self.beyond("safe", safe - STEP - TOL["ms"] - (x.t - last.t), 0, "grab", x, "touched while safe")
            last = x
            ex, ez, _ = f.emojis[i]
            dx, dz = x.x - ex, x.z - ez
            d = math.hypot(dx, dz)
            if d > 0.01:                # bumped straight back off it
                bump = math.hypot(x.vx - dx / d * r.hit["bump"], x.vz - dz / d * r.hit["bump"])
                self.beyond("bump", bump, TOL["bump"] + r.hit["bump"] * 0.001 / d, "edited", x, "a bump that isn't one")
            if listed > n:
                self.blinked[i].append(x.ms)
            else:
                self.gone[i] = x.ms
        ends = [x.ms for _, _, x in self.checkpoints]
        hit_ms = [x.ms for x, _ in hits]
        for x in self.samples:
            if x.mode != SNOW or x.i in takes or x.has("hit"):
                continue
            n = sum(1 for t in ends if t <= x.ms)
            if n == r.list:
                break
            before = [t for t in hit_ms if t < x.ms]
            if before and x.t - before[-1] / 1000 < safe + STEP + TOL["ms"]:
                continue                # maybe still safe
            for i, (ex, ez, listed) in enumerate(f.emojis):
                d = math.hypot(x.x - ex, x.z - ez)
                if d >= touch + TOL["mm"]:
                    continue
                standing = self.standing(i, listed, n, x, back)
                if standing is False:
                    continue
                if standing is None or d > touch - TOL["mm"] or listed == n:
                    break               # can't tell, or the next: the first in reach is what Mnot touches
                self.fail("dodge", x, f"through emoji {i} without touching it")

    def check_reach(self, x, i, what):
        """A touch on the snow (or as Mnot drops into a hole), within reach, of one standing: a blinked one is back
        a moment later."""
        ex, ez, _ = self.field.emojis[i]
        if x.mode != SNOW and not x.has("pit"):
            self.fail("edited", x, f"a {what} from a hole")
        d = math.hypot(x.x - ex, x.z - ez)
        self.beyond("reach", d - self.route.touch, TOL["mm"], "grab", x, f"a {what} {d:.2f} m off")
        back = self.route.warp["back"] + 0.3
        for t in self.blinked.get(i, ()):
            if t < x.ms:
                self.beyond("back", back - STEP - TOL["ms"] - (x.ms - t) / 1000, 0, "grab", x,
                            f"a {what} of one that blinked away {(x.ms - t) / 1000:.2f} s before")

    def standing(self, i, listed, n, x, back):
        """Whether emoji i stands at sample x, n fetched: True, False, or None if the game's steps can't tell."""
        if 0 <= listed < n or i in self.gone and self.gone[i] <= x.ms:
            return False
        blinked = [t for t in self.blinked.get(i, ()) if t <= x.ms]
        if blinked:
            since = x.t - blinked[-1] / 1000
            if since < back - STEP - TOL["ms"]:
                return False
            if since < back + STEP + TOL["ms"]:
                return None
        return True

    def check_finish(self):
        """:peak-mnot: fetched in the middle, on the snow, after it landed there."""
        r, last = self.route, self.samples[-1]
        take = self.checkpoints[-1][2]
        wait = r.finale["drop"] + r.prize["fall"] - STEP - TOL["ms"]
        self.beyond("landed", wait - (last.t - take.t), 0, "finish", last, "fetched before it landed")
        d = math.hypot(last.x - r.peak[0], last.z - r.peak[1])
        self.beyond("prize", d - r.prize["touch"], TOL["mm"], "finish", last, f"fetched {d:.2f} m off")
        if last.mode != SNOW:
            self.fail("finish", last, "fetched from a hole")


def verify(route, replay, claim, splits):
    """None if the run holds up, else the Rejection. Raises Malformed for a replay that isn't one."""
    try:
        Checker(route, replay, claim, splits).run()
    except Rejection as rejection:
        return rejection
    return None


def calibrate(route, replay, claim, splits):
    """How close an honest run comes to each limit: {check: (value - limit, value, ms)}, the closest first. A run
    the checks turn down outright (not by a limit) raises its Rejection."""
    stats = {}
    Checker(route, replay, claim, splits, stats=stats).run()
    return dict(sorted(stats.items(), key=lambda kv: -kv[1][0]))
