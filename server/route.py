"""The route as the game exported it (route.json, made by peak/scores/routedata.js): the solids Mnot can stand on, the
planks and the rope, the ice, checkpoints, the summit, the walking line, the wind gaps, the gondola's timetable and
the rig's numbers. Answers the geometry questions the replay checker (verify.py) asks."""
import json
import math
from pathlib import Path

ROUTE_FILE = Path(__file__).resolve().parent / "route.json"
# The least time a stretch between checkpoints can take (segments()): the splits that come in faster are refused.
SEGMENT = {"skip": 2.0, "fast": 4.0, "share": 0.9}


class Outline:
    """A convex outline in XZ; distance() is like Solid.closest().d in peak/world/world.js (< 0 inside)."""

    def __init__(self, poly):
        self.poly = [(float(x), float(z)) for x, z in poly]
        n = len(self.poly)
        self.cx = sum(p[0] for p in self.poly) / n
        self.cz = sum(p[1] for p in self.poly) / n
        self.edges = []
        for i, (ax, az) in enumerate(self.poly):
            bx, bz = self.poly[(i + 1) % n]
            length = math.hypot(bx - ax, bz - az)
            nx, nz = (bz - az) / length, -(bx - ax) / length
            if nx * ((ax + bx) / 2 - self.cx) + nz * ((az + bz) / 2 - self.cz) < 0:
                nx, nz = -nx, -nz
            self.edges.append((ax, az, bx, bz, nx, nz, length))
        self.radius = max(math.hypot(x - self.cx, z - self.cz) for x, z in self.poly)

    def distance(self, x, z, dx=0.0, dz=0.0):
        """Signed distance from the outline, moved by (dx, dz)."""
        x, z = x - dx, z - dz
        if math.hypot(x - self.cx, z - self.cz) > self.radius + 3:
            return math.hypot(x - self.cx, z - self.cz) - self.radius
        inside = max(nx * (x - ax) + nz * (z - az) for ax, az, _, _, nx, nz, _ in self.edges)
        if inside <= 0:
            return inside
        best = math.inf
        for ax, az, bx, bz, _, _, length in self.edges:
            t = min(1.0, max(0.0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (length * length)))
            best = min(best, math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)))
        return best


class Solid(Outline):
    def __init__(self, data, index):
        super().__init__(data["poly"])
        self.index = index
        self.top = float(data["top"])
        self.kind = data["kind"]
        self.loose = bool(data["loose"])
        self.moving = bool(data["moving"])


class Beam:
    def __init__(self, data, index):
        self.index = index
        self.kind = data["kind"]
        self.a, self.b = [float(v) for v in data["a"]], [float(v) for v in data["b"]]
        self.sag, self.dip = float(data["sag"]), float(data["dip"])
        dx, dz = self.b[0] - self.a[0], self.b[2] - self.a[2]
        self.length = math.hypot(dx, dz)
        self.dir = (dx / self.length, dz / self.length)
        self.right = (-self.dir[1], self.dir[0])

    def project(self, x, z):
        dx, dz = x - self.a[0], z - self.a[2]
        return ((dx * self.dir[0] + dz * self.dir[1]) / self.length, dx * self.right[0] + dz * self.right[1])

    def height(self, s):
        """The walking surface at s without Mnot on it; Mnot's weight dips a rope by up to dip_at(s) more."""
        return self.a[1] + (self.b[1] - self.a[1]) * s - self.sag * 4 * s * (1 - s)

    def dip_at(self, s):
        s = min(1.0, max(0.0, s))
        return self.dip * 4 * s * (1 - s)


class Mover:
    """A gondola: its pallet's outline (offsets from its centre) and timetable (centre x, top, z every step s)."""

    def __init__(self, data):
        self.solid = int(data["solid"])
        self.outline = Outline(data["offsets"])
        self.period = float(data["period"])
        self.step = float(data["step"])
        self.points = [tuple(float(v) for v in p) for p in data["points"]]
        n = len(self.points)
        speeds = [math.hypot(self.points[(i + 1) % n][0] - p[0], self.points[(i + 1) % n][2] - p[2]) / self.step
                  for i, p in enumerate(self.points)]
        climbs = [(self.points[(i + 1) % n][1] - p[1]) / self.step for i, p in enumerate(self.points)]
        self.top_speed = max(speeds)
        self.top_climb = max(0.0, max(climbs))
        xs, zs = [p[0] for p in self.points], [p[2] for p in self.points]
        self.span = (min(xs), max(xs), min(zs), max(zs), min(p[1] for p in self.points))

    def at(self, t):
        """Where the pallet's centre is at world time t: (x, top, z)."""
        u = (t % self.period) / self.step
        i = int(u)
        f = u - i
        n = len(self.points)
        a, b = self.points[i % n], self.points[(i + 1) % n]
        return tuple(a[k] + (b[k] - a[k]) * f for k in range(3))

    def distance(self, x, z, t):
        cx, _, cz = self.at(t)
        return self.outline.distance(x, z, cx, cz)

    def near_path(self, x, y, z, margin):
        x0, x1, z0, z1, low = self.span
        r = self.outline.radius + margin
        return x0 - r <= x <= x1 + r and z0 - r <= z <= z1 + r and y >= low - margin - 1


class Route:
    def __init__(self, data):
        self.data = data
        self.fingerprint = data["fingerprint"]
        rig = data["rig"]
        self.gravity = float(rig["gravity"])
        self.run_speed = float(rig["run"])
        self.walk_speed = float(rig["walk"])
        self.launch_stand = math.sqrt(2 * self.gravity * float(rig["jump"]))
        self.launch_run = math.sqrt(2 * self.gravity * float(rig["runJump"]))
        self.beam_speed = float(data["beamSpeed"])
        self.slide_max = float(data.get("slideMax", 3.2))
        self.solids = [Solid(s, i) for i, s in enumerate(data["solids"])]
        self.beams = [Beam(b, i) for i, b in enumerate(data["beams"])]
        # (outline, top, reach): the game counts ice up to reach metres past the outline (the ring's, so a slide
        # goes over the lip rather than stopping on it)
        self.ice = [(Outline(i["poly"]), float(i["y"]), float(i.get("reach", 0))) for i in data["ice"]]
        self.checkpoints = sorted(data["checkpoints"], key=lambda c: c["index"])
        self.summit = data["summit"]
        self.rail = [tuple(float(v) for v in p) for p in data["rail"]]
        self.gusts = data["gusts"]
        self.movers = [Mover(m) for m in data["movers"]]
        self.moving = {m.solid: m for m in self.movers}

    @classmethod
    def load(cls, path=ROUTE_FILE):
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    # ------------------------------------------------------------------ what's under the feet

    def standing_on(self, x, y, z, t, edge, tol, lag=0.0):
        """The solid whose top is at y (within tol) with (x, z) within edge of it, at world time t; or None.
        lag allows for a moving pallet being a step ahead of the feet riding it."""
        for s in self.solids:
            if s.index in self.moving:
                m = self.moving[s.index]
                for when in (t, t - lag):
                    cx, top, cz = m.at(when)
                    if abs(top - y) <= tol + lag * m.top_climb and m.outline.distance(x, z, cx, cz) <= edge + lag * m.top_speed:
                        return s
            elif abs(s.top - y) <= tol and s.distance(x, z) <= edge:
                return s
        return None

    def on_ice(self, x, y, z, margin=0.15):
        """On ice, or within margin of where the game still counts it as ice."""
        return any(abs(iy - y) < 0.07 and outline.distance(x, z) <= reach + margin for outline, iy, reach in self.ice)

    def beam_at(self, x, z, index=None, lateral=0.9, ends=0.06):
        beams = [self.beams[index]] if index is not None and 0 <= index < len(self.beams) else self.beams
        for b in beams:
            s, lat = b.project(x, z)
            if -ends <= s <= 1 + ends and abs(lat) <= lateral:
                return b, s, lat
        return None

    def gust_reach(self, x, y, z, margin=0.6):
        return any(abs(y - g["y"]) < 2.5 and math.hypot(x - g["x"], z - g["z"]) < g["radius"] + margin
                   for g in self.gusts)

    def near_mover(self, x, y, z, margin=2.0):
        return any(m.near_path(x, y, z, margin) for m in self.movers)

    # ------------------------------------------------------------------ the walking line

    def rail_distance(self, x, z):
        """Horizontal distance from the camera rail, which runs along the walking line."""
        best = math.inf
        for (ax, _, az), (bx, _, bz) in zip(self.rail, self.rail[1:]):
            dx, dz = bx - ax, bz - az
            t = min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
            best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
        return best

    def progress(self, x, y, z):
        """How far along the walking line (metres) the nearest point to (x, y, z) is; heights tell stacked
        stretches apart, as in railAt()."""
        best, along, done = math.inf, 0.0, 0.0
        for (ax, ay, az), (bx, by, bz) in zip(self.rail, self.rail[1:]):
            dx, dy, dz = bx - ax, by - ay, bz - az
            length = math.hypot(dx, dz)
            t = min(1.0, max(0.0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)))
            d = math.hypot(x - ax - dx * t, 2 * (y - ay - dy * t), z - az - dz * t)
            if d < best:
                best, along = d, done + t * length
            done += length
        return along

    def beams_between(self, p0, p1):
        """Metres of plank and rope between two points along the walking line, and how many beams."""
        lo, hi = sorted((p0, p1))
        total, count = 0.0, 0
        for b in self.beams:
            a = self.progress(*b.a)
            e = self.progress(*b.b)
            part = max(0.0, min(hi, max(a, e)) - max(lo, min(a, e)))
            total += part
            count += part > 0
        return total, count

    def segments(self):
        """For each stretch, checkpoint to checkpoint and the last one to the summit: (metres, the least seconds
        it can take). Planks and the rope go at walking pace, less SEGMENT['skip'] metres each (a jump can land
        part-way along); the rest at SEGMENT['fast'], faster than Mnot ever goes; all of it times SEGMENT['share']."""
        points = [self.progress(*c["at"]) for c in self.checkpoints] + [self.progress(*self.summit["at"])]
        out = []
        for p0, p1 in zip(points, points[1:]):
            beams, count = self.beams_between(p0, p1)
            rest = max(0.0, p1 - p0 - beams)
            least = max(0.0, beams - SEGMENT["skip"] * count) / self.beam_speed + rest / SEGMENT["fast"]
            out.append((p1 - p0, least * SEGMENT["share"]))
        return out
