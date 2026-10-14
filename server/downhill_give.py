"""What the chair's physics (peak/downhill/ride.js, track.js) does to a step beyond what its speeds at either end
say, for downhill.py's checks. Each allowance is the game's own doing, worked out from the route (its snow, its
obstacles, the chair's feel) for the step at hand, so it holds where the game does it and nowhere else:

- The rounding: a sample's position is in whole millimetres, so at a floe's edge the snow under the recorded point
  can be the water 2.6 m below the floe the chair sits on, a millimetre away (least()).
- A push off an obstacle: Ride.collide() puts the chair back out of a rock, a pine or a piece of the office along
  the line from its axis, as far out as the obstacle reaches at the seat's height, in the air too. Coming down past
  a rock's or a cabinet's top, or into a pine's wider branches lower down, that reach grows under the chair and
  shoves it sideways in one step, without a crash (the flag is for a knock of more than 0.6 m/s into it). On the
  snow the chair is put back on it a step later, higher if the push went uphill (pushed(), push_credit()).
- The landing snap: a step that ends in the snow puts the chair on it (pos.y = under.y), up to FEEL.wall higher,
  and takes away only the speed into the snow. On even snow that is a millimetre; at a sharp edge (a floe's, the
  gorge's, the powder's at the bank's top) it lifts the chair for free (snap_way(), landing_credit()).
- The snow's own lift: rolling, each step goes along track.js's normal and is put back on the snow. That normal
  takes the slope along the centreline as it is on the centreline, so far across a bend it is off and a chair
  rolling there is lifted a little every step (or flies a little); and where the powder starts, at the bank's top,
  its bumps start at full height, a step in the snow of up to 12 cm (snow_credit()).
- Steering on a bank: ride.js puts the feet's push across onto the snow and makes it a whole push again, so where
  the snow leans across, the feet do more work than the speed across says (tilt()).

check_energy asks for the credits only where they change its verdict (Window), and a run's credits make at most
WORK calls to the route's ground(), so a replay made to ask on every step costs a few seconds at most.
"""
import collections
import math

ROUND = 0.0005          # m: how far a recorded position is from the chair's at most (whole millimetres)
PUSH_TOL = 0.08         # m: a push's line out of an obstacle against the path and its reach (the mean speed's way
                        # is off by at most half the knock's change of speed over half the step: 0.65 * 0.075)
NUDGE = 0.65            # m/s: a knock under the crash flag (J <= 0.6 along the axis's line, ride.js) with the
                        # friction along the obstacle (FEEL.grip, 0.4 J): 0.6 * sqrt(1 + 0.4^2)
LEAN = 0.04             # m: how far an obstacle pushes a chair leaning on it in a sample, besides its reach growing:
                        # the first touch (under 0.48 m/s, else a crash) for a step, and then what gravity, the feet
                        # and the paddling (25 m/s^2 at most) put back into it a step at a time, over MAX_GAP
VN = 0.02               # m/s: the rounding of a speed along the snow's normal
STEP = 1 / 120          # the physics' step; a frame's steps are 0.25 to 1.5 times it
SHARES = (0.25, 0.5, 0.75, 1.0, 1.25, 1.5)
GROUND = 0              # a sample's mode on the snow (downhill.py)
WORK = 120000           # ground() calls a run's credits may make, about 3 s: one costs 10 on average and 450 at the
                        # very most, honest runs ask for one or none (check_energy only asks where it matters), so
                        # only a replay made to ask on every step comes near, and past it the credit is nothing


def hypot(x, z):
    return math.sqrt(x * x + z * z)


class Give:
    """Mixed into downhill.Checker: needs self.route, self.where (the ground under each sample) and self.samples."""

    work = 0                # ground() calls the credits have made (WORK)

    def under(self, x, z, hint):
        """The snow under (x, z) for a credit, counted against WORK."""
        self.work += 1
        return self.route.ground(x, z, hint)

    # ------------------------------------------------------------------ the ground under a sample

    def lowest(self, x, value, limit):
        """value(the snow under x), or, past limit, the least of it under anywhere x can have been (least())."""
        found = value(self.where[x.i])
        return found if found <= limit else self.least(x, value)

    def least(self, x, value):
        """The least of value(ground) under x, under the corners of the millimetre its position was rounded to,
        and, if it is up against an obstacle, along the line it was pushed out on in its last step."""
        route, hint = self.route, self.where[x.i].i
        best = value(self.where[x.i])
        for dx, dz in ((-ROUND, -ROUND), (-ROUND, ROUND), (ROUND, -ROUND), (ROUND, ROUND)):
            best = min(best, value(route.ground(x.x + dx, x.z + dz, hint)))
        far = 1.5 * STEP * math.hypot(x.vx, x.vz) + 0.05
        for o in route.near(self.where[x.i].s):
            reach, dist = route.reach(o, x.y), hypot(x.x - o.x, x.z - o.z)
            if reach is None or dist > reach + 0.01 or dist < 1e-6:
                continue
            ux, uz = (x.x - o.x) / dist, (x.z - o.z) / dist
            for k in range(1, int(far / 0.01) + 1):
                best = min(best, value(route.ground(x.x - ux * k * 0.01, x.z - uz * k * 0.01, hint)))
        return best

    # ------------------------------------------------------------------ obstacles

    def heights(self, a, b):
        """The seat's heights between a and b, a couple of centimetres apart (over the top of a flight too)."""
        lo, hi = min(a.y, b.y) - 0.02, max(a.y, b.y) + 0.02
        if a.vy > 0:
            hi = max(hi, a.y + a.vy * a.vy / (2 * self.route.g) + 0.02)
        n = min(80, math.ceil((hi - lo) / 0.02))
        return [lo + (hi - lo) * k / n for k in range(n + 1)]

    def obstacles_on(self, a, b):
        """The obstacles the chair can have touched between a and b: (obstacle, its least and its most reach at
        the heights it passed through, 0 where it passes over), for those that reach the way from a to b."""
        if not hasattr(self, "_on"):
            self._on = {}
        if (a.i, b.i) in self._on:
            return self._on[a.i, b.i]
        found, seen, heights = [], set(), None
        for g in (self.where[a.i], self.where[b.i]):
            for o in self.route.near(g.s):
                if id(o) in seen:
                    continue
                seen.add(id(o))
                heights = heights or self.heights(a, b)
                reaches = [self.route.reach(o, y) or 0.0 for y in heights]
                far = max(reaches)
                if far > 0 and self.off_path(o, a, b) < far + PUSH_TOL:
                    found.append((o, min(reaches), far))
        self._on[a.i, b.i] = found
        return found

    @staticmethod
    def off_path(o, a, b):
        """How far o's axis is from the straight way from a to b."""
        dx, dz = b.x - a.x, b.z - a.z
        length = dx * dx + dz * dz
        f = 0.0 if length == 0 else max(0.0, min(1.0, ((o.x - a.x) * dx + (o.z - a.z) * dz) / length))
        return hypot(a.x + dx * f - o.x, a.z + dz * f - o.z)

    def pushed(self, a, b):
        """The shove an obstacle gave the chair between a and b, (ex, ez), if one explains it, else None. What the
        speeds don't account for (b's place less a's and the mean speed's way) must point out from an obstacle's
        axis from a spot on the way the chair went without it, and end no further out than it reaches at a height
        the chair passed through."""
        dt = b.t - a.t
        ex = b.x - a.x - (a.vx + b.vx) / 2 * dt
        ez = b.z - a.z - (a.vz + b.vz) / 2 * dt
        e = hypot(ex, ez)
        if e < 0.03 or dt <= 0:
            return None
        ux, uz = ex / e, ez / e
        for o, _, far in self.obstacles_on(a, b):
            for k in range(21):
                px = a.x + (b.x - ex - a.x) * k / 20 - o.x
                pz = a.z + (b.z - ez - a.z) * k / 20 - o.z
                t = px * ux + pz * uz
                if t > -PUSH_TOL and abs(px * uz - pz * ux) < PUSH_TOL and t + e < far + PUSH_TOL:
                    return ex, ez
        return None

    def unpushed(self, a, b):
        """Where b would be, across (x, z), without an obstacle's push between a and b."""
        dt = b.t - a.t
        if max(abs(b.x - a.x - (a.vx + b.vx) / 2 * dt), abs(b.z - a.z - (a.vz + b.vz) / 2 * dt)) < 0.03:
            return b.x, b.z
        ex, ez = self.pushed(a, b) or (0.0, 0.0)
        return b.x - ex, b.z - ez

    def nudge(self, a, b):
        """How much an obstacle can have turned the chair between a and b without a crash (m/s)."""
        return NUDGE if self.obstacles_on(a, b) else 0.0

    def moved_by_game(self, a, b):
        """Metres from a to b that the game put the chair on by itself: a push out of an obstacle and a landing."""
        return self.snap_way(a, b) + hypot(*(self.pushed(a, b) or (0.0, 0.0)))

    def push_credit(self, a, b):
        """Energy (J/kg) the snow can have given back after obstacles pushed the chair out along the way: the push,
        at most how much further out they reach at the heights it passed through and LEAN, uphill, at the snow's
        steepest at either end."""
        push = sum(far - least + LEAN for _, least, far in self.obstacles_on(a, b))
        if not push:
            return 0.0
        slope = max(math.sqrt(max(0.0, 1 - g.normal[1] ** 2)) / g.normal[1]
                    for g in (self.where[a.i], self.where[b.i]))
        return self.route.g * push * slope

    # ------------------------------------------------------------------ landings

    def snap_cap(self, x):
        """How far up a landing's snap can lift the chair: FEEL.wall above where it was, which is the speed's way
        down during the step (b's, with what the snow took away put back) above where it got to."""
        return self.route.feel["wall"] + 1.5 * STEP * (max(0.0, -x.vy) + math.sqrt(2 * self.route.g)) + 0.002

    def snap_way(self, a, b):
        """Metres of the way from a to b that a landing in between explains, up and down only. The snap onto the
        snow lifted the chair up to snap_cap(); and before it, it fell faster than its speed at either end says
        (the snow took that away), at most G dt^2 / 2 further down."""
        if not b.has("land"):
            return 0.0
        dt, up = b.t - a.t, b.y - a.y
        shift = min(up, self.snap_cap(b)) if up > 0 else max(up, -self.route.g * dt * dt / 2)
        return math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) - math.dist((a.x, a.y, a.z), (b.x, b.y - shift, b.z))

    def landing_credit(self, b):
        """Energy (J/kg) a landing's snap at b can have given the chair: G times the lift, less the speed into the
        snow it took away (lam^2 / 2), the most over the step's length and every speed into the snow lam that
        leaves b's speed. Before the step the chair was in the air, so on or above the snow; it went along b's
        speed with lam along the snow's normal put back, and was lifted onto the snow, at most FEEL.wall above
        where it was. b's speed then goes along the snow or away from it: one into the snow is no landing the
        game made, and earns nothing."""
        G, wall = self.route.g, self.route.feel["wall"]
        hint = self.where[b.i].i
        grounds = [self.where[b.i]] + [self.under(b.x + dx, b.z + dz, hint)
                                       for dx in (-ROUND, ROUND) for dz in (-ROUND, ROUND)]
        n = max((g.normal for g in grounds), key=lambda n: b.vx * n[0] + b.vy * n[1] + b.vz * n[2])
        along = b.vx * n[0] + b.vy * n[1] + b.vz * n[2]
        if along < -VN:
            return 0.0
        top = math.sqrt(2 * G * self.snap_cap(b))
        lams = [top * k / 12 for k in range(13)] if along < VN else [0.0]
        best = 0.0
        for share in SHARES:
            dt = share * STEP
            for lam in lams:
                vx, vy, vz = b.vx - lam * n[0], b.vy - lam * n[1], b.vz - lam * n[2]
                was = self.under(b.x - vx * dt, b.z - vz * dt, hint).y
                lift = min(wall + max(0.0, -vy) * dt, b.y - (was + vy * dt))
                best = max(best, G * lift - lam * lam / 2)
        return best

    # ------------------------------------------------------------------ the snow itself

    @staticmethod
    def tilt(g, right):
        """How much of the feet's push to steer goes across the piste, flat, on the snow under g: ride.js puts the
        way to the right (flat) onto the snow and makes it a whole push again, so where the snow leans across,
        the push does 1 / tilt times the work the speed across says. At least a half (a slope of 60 degrees:
        steeper is only the gorge's walls, at a hole's rim, where check_energy's slack takes over)."""
        return max(0.5, math.sqrt(max(0.0, 1 - (right[0] * g.normal[0] + right[1] * g.normal[2]) ** 2)))

    def snow_credit(self, a, b):
        """Energy (J/kg) the snow can have lifted a rolling chair by between a and b, on the way from one to the
        other: G times the snow's rise less the rise the normals (track.js's) make of the way, a quarter of a metre
        at a time with the normal halfway. Near the powder's step at the bank's top the normals lean over it (they
        are worked out 0.15 m either side), so there it goes 2 cm at a time with the normal that makes the least
        of the rise, of those under the chair over a game step before (it takes each step along the normal it
        starts on). Nothing over a hole: a flight over one comes down with its own landing."""
        top, G = self.route.piste + self.route.bank, self.route.g
        length = hypot(b.x - a.x, b.z - a.z)
        steps = max(1, min(24, math.ceil(length / 0.25)))
        dx, dz = (b.x - a.x) / steps, (b.z - a.z) / steps
        reach = 1.5 * STEP * max(a.speed, b.speed)
        hint, last, net, fine = self.where[a.i].i, self.where[a.i], 0.0, {}

        def at(f):
            return self.under(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, hint)

        def rise(n, ddx, ddz):
            return -(n[0] * ddx + n[2] * ddz) / n[1]

        for k in range(1, steps + 1):
            q = self.where[b.i] if k == steps else at(k / steps)
            if q.hole or last.hole:
                return 0.0
            if (abs(last.d) - top) * (abs(q.d) - top) > 0 and \
                    min(abs(abs(last.d) - top), abs(abs(q.d) - top)) > 0.4 + reach:
                net += q.y - last.y - rise(at((k - 0.5) / steps).normal, dx, dz)
            else:
                n = math.ceil(length / steps / 0.02)
                back = math.ceil(reach * n * steps / length) if length else 0
                for j in range((k - 1) * n, k * n):
                    for i in range(j - back, j + 2):
                        if i not in fine:
                            fine[i] = at(i / (n * steps))
                    if fine[j + 1].hole:
                        return 0.0
                    least = min(rise(fine[i].normal, dx / n, dz / n) for i in range(j - back, j + 1))
                    net += fine[j + 1].y - fine[j].y - least
            last = q
        return G * max(0.0, net)

    # ------------------------------------------------------------------ what check_energy asks for

    def credit(self, a, b, need=math.inf):
        """The energy (J/kg) the game can have given the chair between a and b by itself, or at least need of it:
        the cheap parts first, and no further than need (an edited replay can ask on every step); nothing past
        WORK."""
        credit = 0.0
        if self.work > WORK:
            return credit
        if a.mode == GROUND or b.mode == GROUND:
            credit += self.push_credit(a, b)
        if credit < need and b.has("land"):
            credit += self.landing_credit(b)
        if credit < need and a.mode == GROUND and b.mode == GROUND:
            credit += self.snow_credit(a, b)
        return credit

    def credited(self, a, b, excess):
        """A step's excess energy (J/kg) less what the game gave the chair by itself, never below nothing."""
        return excess if excess <= 0 else max(0.0, excess - self.credit(a, b, excess))


class Window:
    """check_energy's excess energy (J/kg) over the last few seconds, a step at a time, and its total. A step whose
    excess is within the tolerance on its own comes in without its credit, with its pair (a, b); while the total is
    past limit, the latest of those have theirs (Give.credited()). Each step has it at most once, and the verdict is
    the one that working it out for every step as it came gives, without the work where it makes no difference."""

    def __init__(self, checker, seconds, limit):
        self.checker, self.seconds, self.limit = checker, seconds, limit
        self.clear()

    def clear(self):
        self.steps, self.owed, self.total = collections.deque(), [], 0.0

    def add(self, t, excess, pair=None):
        step = [t, excess, pair]
        self.steps.append(step)
        if pair is not None:
            self.owed.append(step)
        self.total += excess
        while self.steps and self.steps[0][0] < t - self.seconds:
            gone = self.steps.popleft()
            self.total -= gone[1]
            gone[2] = None
        while self.total > self.limit and self.owed:
            step = self.owed.pop()
            if step[2] is not None:
                credited = self.checker.credited(*step[2], step[1])
                self.total -= step[1] - credited
                step[1], step[2] = credited, None
        return self.total
