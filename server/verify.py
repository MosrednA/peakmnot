"""Checks a recorded climb (peak/scores/replay.js) against the route (route.py) and the game's physics
(peak/mnot/player.js, balance.js, peak/game.js). It doesn't re-run the game; it checks that every step of the replay is something the game can
do: Mnot stands on rock that is there (the gondola where it was at that moment), never goes faster than its legs,
the ice, the wind and the gondola allow, flies on exact parabolas, crosses planks and the rope at walking pace,
jumps only after Space, comes back from a fall only where it was safe, and reaches every checkpoint and the summit.

verify(route, replay, claim, splits) returns None for a good climb, or a Rejection (reason, detail, at). The
tolerances are rounding (the replay is in mm, mm/s and ms) plus a little; see server/README.md.
"""
import math

from replayformat import (AIR, BEAM, FLAG, GROUND, MAX_TIME_MS, MOVE_KEYS, OUT, Malformed, Sample,  # noqa: F401
                          parse)

# The game's own numbers (player.js, balance.js, game.js); route.json carries the rig and the route.
EDGE, AIR_REACH, STEP_UP, STEP_DOWN, BEAM_CATCH = 0.1, 0.14, 0.26, 0.32, 0.6
KNOCK_VY, SLIP_VY = 3.2, 0.8
FADE = {"fall": 2.4, "flat": 1.4}
FADE_GAP = 0.45
TICK = 1 / 60                   # the longest physics step
# Allowances on top of the legs: wind pushes up to 0.27 m/s on the ground and 0.5 in the air, a wind gap's jet up
# to 1.5 more; ice and a gondola's ride carry their speed into a jump for a while.
WIND = {GROUND: 0.3, AIR: 0.5}
JET = 1.5
CARRY = 1.5
SPACE_BEFORE_JUMP = 1.0         # seconds: buffer (0.14) + takeoff (0.12 to 0.2) + coyote, with room
EVERY = 0.1                     # seconds: the recorder samples once this long has passed, on the step that gets there
MAX_GAP = 0.25                  # seconds between samples while Mnot is in play (the recorder takes ~0.1)
CORRIDOR = 8.0                  # metres from the walking line
WINDOW = 1.0                    # seconds: the speed check also adds up the steps over this long, so the rounding
                                # allowance per step (3 cm) can't be stacked into a faster climb


class Rejection(Exception):
    def __init__(self, reason, detail="", at=None, **numbers):
        super().__init__(f"{reason}: {detail}")
        self.reason, self.detail, self.at, self.numbers = reason, detail, at, numbers


class Checker:
    def __init__(self, route, replay, claim, splits):
        self.route = route
        self.samples, self.inputs, self.events = parse(replay)
        self.phase = replay["phase"] / 1000
        self.fingerprint = replay["route"]
        self.claim = claim
        self.splits = splits
        self.mover_speed = max((m.top_speed for m in route.movers), default=0.0)
        self.mover_climb = max((m.top_climb for m in route.movers), default=0.0)

    def fail(self, reason, sample=None, detail="", **numbers):
        raise Rejection(reason, detail, sample.ms if sample else None, **numbers)

    # ------------------------------------------------------------------ the whole climb

    def run(self):
        r, s = self.route, self.samples
        if self.fingerprint != r.fingerprint:
            self.fail("edited", detail="the replay is for another route")
        for a, b in zip(s, s[1:]):
            if b.ms < a.ms:
                self.fail("timeline", b, "time runs backwards")
        last = s[-1].ms
        if any(e[0] > last for e in self.events) or any(i[0] > last for i in self.inputs):
            self.fail("timeline", s[-1], "events after the summit")
        if any(b[0] < a[0] for a, b in zip(self.events, self.events[1:])) or \
                any(b[0] < a[0] for a, b in zip(self.inputs, self.inputs[1:])):
            self.fail("timeline", None, "events out of order")
        self.check_ends()
        self.check_events()
        self.check_motion()

    def check_ends(self):
        r, first, last = self.route, self.samples[0], self.samples[-1]
        start = r.checkpoints[0]["respawn"]
        if first.ms > 300 or math.hypot(first.x - start[0], first.z - start[2]) > 0.6 or abs(first.y - start[1]) > 0.05:
            self.fail("start", first, "not at base camp")
        if not last.has("summit") or any(x.has("summit") for x in self.samples[:-1]):
            self.fail("summit", last, "no summit at the end")
        at, radius = r.summit["at"], r.summit["radius"]
        if last.mode not in (GROUND, BEAM) or self.dist3(last, at) > radius + 0.4 + 0.02:
            self.fail("summit", last, "not at the summit flag")
        if self.claim["time"] != last.ms:
            self.fail("edited", last, "the time isn't the replay's")

    def check_events(self):
        """The events, the flags on the samples and the claim tell the same story."""
        r = self.route
        by_time = {}
        for x in self.samples:
            by_time.setdefault(x.ms, x)
        cps, lost, respawns, dents = [], [], [], 0
        for t, name, arg in self.events:
            x = by_time.get(t)
            if name == "cp":
                if not x or not x.has("checkpoint"):
                    self.fail("edited", x, "a checkpoint without its sample")
                cps.append((arg, t, x))
            elif name == "lost":
                if not x or not x.has("lost") or x.mode != OUT or arg not in FADE:
                    self.fail("edited", x, "a fall without its sample")
                lost.append((t, arg))
            elif name == "respawn":
                if not x or not x.has("respawn"):
                    self.fail("edited", x, "a respawn without its sample")
                respawns.append(t)
            elif name == "dent":
                dents += 1
        flagged = lambda name: sum(1 for x in self.samples if x.has(name))
        if flagged("checkpoint") != len(cps) or flagged("lost") != len(lost) or flagged("respawn") != len(respawns):
            self.fail("edited", None, "flags without events")
        wanted = [c["index"] for c in r.checkpoints[1:]]
        if [c[0] for c in cps] != wanted:
            self.fail("skipped", None, f"checkpoints {[c[0] for c in cps]}")
        for (index, t, x), cp in zip(cps, r.checkpoints[1:]):
            if x.mode not in (GROUND, BEAM) or self.dist3(x, cp["at"]) > cp["radius"] + 0.02:
                self.fail("skipped", x, f"checkpoint {index} is elsewhere")
        if len(self.splits) != len(cps) or any(sc != c[0] or abs(st - c[1]) > 1 for (sc, st), c in zip(self.splits, cps)):
            self.fail("edited", None, "the splits don't match the replay")
        if sum(1 for _, reason in lost if reason == "fall") != self.claim["falls"]:
            self.fail("edited", None, "the falls don't add up")
        if dents != self.claim["dents"]:
            self.fail("edited", None, "the dents don't add up")
        self.cp_times = [(t, cp) for (_, t, _), cp in zip(cps, r.checkpoints[1:])]
        self.lost_reason = dict(lost)

    # ------------------------------------------------------------------ step by step

    def check_motion(self):
        r = self.route
        self.last_ice = self.last_mover = self.last_air = -math.inf
        self.lost_at = None
        self.safe = []                       # where a fall can bring Mnot back to
        self.cp = r.checkpoints[0]
        self.stay = None                     # (beam, s, t) where Mnot got on the current beam
        self.window = []                     # (t, metres, metres allowed) for the steps of the last WINDOW seconds
        cps = list(self.cp_times)
        for i, b in enumerate(self.samples):
            while cps and cps[0][0] <= b.ms:
                self.cp = cps.pop(0)[1]
            self.check_place(b)
            if i:
                self.check_pair(self.samples[i - 1], b)
            self.remember(b)

    def remember(self, b):
        r = self.route
        if b.mode == GROUND:
            if r.on_ice(b.x, b.y, b.z, margin=0.05):
                self.last_ice = b.t
            solid = self.solid
            if solid is not None and solid.moving:
                self.last_mover = b.t
            if solid is not None and not solid.moving and not solid.loose and not r.on_ice(b.x, b.y, b.z, 0.05) \
                    and solid.distance(b.x, b.z) <= -0.15:
                self.safe.append((b.x, b.y, b.z))
        elif b.mode in (AIR, BEAM):
            self.last_air = b.t
        if b.mode != BEAM:
            self.stay = None

    def check_place(self, b):
        """Where a single sample is: on rock, on a beam, or anywhere in the air, but near the route."""
        r = self.route
        self.solid = None
        if b.mode == OUT:
            return
        if r.rail_distance(b.x, b.z) > CORRIDOR:
            self.fail("off_route", b, "far from the walking line")
        if b.mode == GROUND and not b.has("respawn"):
            w = b.t + self.phase
            solid = r.standing_on(b.x, b.y, b.z, w, edge=EDGE + 0.015, tol=0.006, lag=TICK + 0.003)
            if solid is None:
                moving = 0 <= b.support < len(r.solids) and r.solids[b.support].moving
                self.fail("gondola" if moving or r.near_mover(b.x, b.y, b.z, 0.5) else "levitate", b, "no rock here")
            self.solid = solid
        elif b.mode == BEAM:
            if not 0 <= b.support < len(r.beams):
                self.fail("levitate", b, "no such beam")
            beam = r.beams[b.support]
            s, lat = beam.project(b.x, b.z)
            if not -0.02 <= s <= 1.02 or abs(lat) > BEAM_CATCH + 0.3:
                self.fail("levitate", b, "beside the beam")

    def check_pair(self, a, b):
        dt = b.t - a.t
        if a.mode == OUT:
            return self.check_respawn(a, b, dt)
        if b.has("respawn"):
            self.fail("respawn", b, "back without falling")
        if b.mode == OUT:
            if not b.has("lost"):
                self.fail("timeline", b, "out without a fall")
            self.lost_at = b
            return self.check_speed(a, b, dt)
        if dt > MAX_GAP:
            self.fail("timeline", b, "a gap in the recording")
        if dt <= 0:
            if math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 0.01:
                self.fail("teleport", b, "moved in no time")
            return None
        if a.mode == BEAM and b.mode == BEAM:
            self.check_beam(a, b, dt)
        else:
            self.check_speed(a, b, dt)
        if b.has("jump"):
            self.check_space(b)
        kind = (a.mode, b.mode)
        if kind == (GROUND, GROUND):
            self.check_steps(a, b, dt)
        elif kind == (GROUND, AIR):
            self.check_takeoff(a, b)
        elif kind == (AIR, AIR):
            self.check_flight(a, b, dt)
        elif kind == (AIR, GROUND):
            self.check_landing(a, b, dt)
        elif kind == (AIR, BEAM):
            self.check_beam_landing(a, b, dt)
        elif kind == (GROUND, BEAM):
            self.check_step_on(a, b)
        elif kind == (BEAM, GROUND):
            self.check_step_off(a, b)
        elif kind == (BEAM, AIR):
            if abs(b.vy - SLIP_VY) > 0.003 or b.has("jump"):
                self.fail("antigravity", b, "off a beam upwards")
        return None

    # ------------------------------------------------------------------ the checks

    def dist3(self, x, p):
        return math.hypot(x.x - p[0], x.y - p[1], x.z - p[2])

    def allowance(self, a, b):
        """The fastest Mnot can go between a and b: its legs (or the ice's slide), plus the wind, a wind gap's jet
        and a gondola's ride where those can be."""
        r = self.route
        base = r.run_speed * 1.01
        if b.t - self.last_ice <= CARRY or any(r.on_ice(x.x, x.y, x.z, margin=0.5) for x in (a, b)):
            base = max(base, r.slide_max)
        extra = WIND[AIR] if AIR in (a.mode, b.mode) else WIND[GROUND]
        if any(r.gust_reach(x.x, x.y, x.z, margin=1.0) for x in (a, b)):
            extra += JET
        if b.t - self.last_mover <= CARRY or any(r.near_mover(x.x, x.y, x.z, 2.0) for x in (a, b)):
            extra += self.mover_speed
        return base + extra

    def check_speed(self, a, b, dt):
        d = math.hypot(b.x - a.x, b.z - a.z)
        allowed = self.allowance(a, b)
        limit = allowed * max(dt, 0.0) * 1.04 + 0.03
        if d > limit:
            speed = d / max(dt, 1e-3)
            reason = "teleport" if d > 1.0 and d > 2 * limit else "too_fast"
            self.fail(reason, b, f"{d:.2f} m in {dt:.3f} s", metres_per_second=speed, allowed=allowed)
        self.window = [w for w in self.window if w[0] > b.t - WINDOW] + [(b.t, d, allowed * max(dt, 0.0))]
        went, budget = sum(w[1] for w in self.window), sum(w[2] for w in self.window)
        if went > budget * 1.04 + 0.06:
            span = b.t - self.window[0][0] + dt
            self.fail("too_fast", b, f"{went:.2f} m in {span:.2f} s", metres_per_second=went / max(span, 1e-3),
                      allowed=allowed)

    def check_beam(self, a, b, dt):
        r = self.route
        if a.support != b.support:
            self.fail("teleport", b, "from beam to beam")
        beam = r.beams[b.support]
        sa, _ = beam.project(a.x, a.z)
        sb, _ = beam.project(b.x, b.z)
        if abs(sb - sa) * beam.length > r.beam_speed * dt + 0.004:
            self.fail("beam_speed", b, f"{abs(sb - sa) * beam.length / dt:.2f} m/s on a beam")
        if self.stay is None or self.stay[0] is not beam:
            self.stay = (beam, sa, a.t)
        _, s0, t0 = self.stay
        if abs(sb - s0) * beam.length > r.beam_speed * (b.t - t0) + 0.012:
            self.fail("beam_speed", b, "too quick across the beam")
        if abs(b.y - beam_height(beam, sb)) > 0.008:
            self.fail("levitate", b, "off the beam's surface")

    def check_steps(self, a, b, dt):
        """Rock to rock: up and down only as far as steps go, and moving only with a key held."""
        r = self.route
        sa = r.standing_on(a.x, a.y, a.z, a.t + self.phase, EDGE + 0.015, 0.006, TICK + 0.003)
        moving = any(s is not None and s.moving for s in (sa, self.solid))
        d = math.hypot(b.x - a.x, b.z - a.z)
        if not moving and not a.has("respawn"):
            hops = 1 + int(d / 0.15)
            if b.y - a.y > STEP_UP * hops + 0.01 or a.y - b.y > STEP_DOWN * hops + 0.01:
                self.fail("antigravity", b, f"a {b.y - a.y:+.2f} m step")
        if moving or d <= WIND[GROUND] * dt + 0.03 or a.t - self.last_air < 0.6:
            return
        if b.t - self.last_ice <= CARRY or r.on_ice(a.x, a.y, a.z, 0.6) or r.on_ice(b.x, b.y, b.z, 0.6):
            return
        if r.gust_reach(b.x, b.y, b.z, 1.0) or r.near_mover(b.x, b.y, b.z, 2.0):
            return
        if not self.keys_held(a.ms - 600, b.ms):
            self.fail("moonwalk", b, f"{d:.2f} m with no key held")

    def check_takeoff(self, a, b):
        r = self.route
        if b.has("jump"):
            # a jump off the gondola carries its climb; its last sample on the pallet can be a whole sample interval
            # and a step before the takeoff's (frames vary), and the times are rounded to the ms
            carried = self.mover_climb if b.t - self.last_mover <= EVERY + TICK + 0.002 else 0.0
            if not any(L - 0.02 <= b.vy <= L + carried + 0.02 for L in (r.launch_stand, r.launch_run)):
                self.fail("antigravity", b, f"a jump at {b.vy:.2f} m/s")
        elif abs(b.vy) > 0.003 and abs(b.vy - KNOCK_VY) > 0.003:
            self.fail("antigravity", b, f"off the ground at {b.vy:.2f} m/s")

    def arc(self, a, dt):
        g = self.route.gravity
        return a.y + a.vy * dt - g * dt * dt / 2, a.vy - g * dt

    def tolerance(self, a, b, dt):
        return 0.003 + 0.0012 * max(abs(a.vy), abs(b.vy)) + 0.001 * dt

    def check_flight(self, a, b, dt):
        r = self.route
        y, vy = self.arc(a, dt)
        tol_y = self.tolerance(a, b, dt)
        if abs(b.y - y) <= tol_y and abs(b.vy - vy) <= 0.02:
            return
        if b.has("jump"):           # a jump just after running off an edge: straight into a running jump's flight
            g = r.gravity
            if r.launch_run - g * TICK - 0.03 <= b.vy <= r.launch_run + 0.02:
                # it falls on its arc until the jump's step, then rises on the launch for that step (h, read off
                # the speed it has left): up to 13 cm above the plain arc late in the coyote time
                h = min(max((r.launch_run - b.vy) / g, 0.0), TICK, dt)
                y0, _ = self.arc(a, dt - h)
                if abs(b.y - (y0 + r.launch_run * h - g * h * h / 2)) <= tol_y + 0.005:
                    return
        if abs(b.vy - KNOCK_VY) <= 0.003 and abs(b.y - y) <= tol_y:
            return                  # a falling rock's bonk
        self.fail("antigravity", b, f"off the arc by {b.y - y:+.3f} m, {b.vy - vy:+.2f} m/s")

    def check_landing(self, a, b, dt):
        y, vy = self.arc(a, dt)
        tol_y = self.tolerance(a, b, dt)
        if vy > 0.02 or abs(b.vy) > 0.003:
            self.fail("antigravity", b, "landed on the way up")
        if not y - tol_y <= b.y <= y + abs(vy) * (TICK + 0.001) + AIR_REACH + tol_y + 0.005:
            self.fail("antigravity", b, f"landed {b.y - y:+.2f} m off the arc")

    def check_beam_landing(self, a, b, dt):
        r = self.route
        y, vy = self.arc(a, dt)
        tol_y = self.tolerance(a, b, dt)
        beam = r.beams[b.support]
        s, _ = beam.project(b.x, b.z)
        surface = beam.height(s)
        if vy > 0.02 or abs(b.y - y) > tol_y or not -0.03 <= surface - b.y <= abs(vy) * (TICK + 0.001) + 0.03:
            self.fail("antigravity", b, "landed on a beam off the arc")

    def check_step_on(self, a, b):
        beam = self.route.beams[b.support]
        s, _ = beam.project(b.x, b.z)
        surface = beam.height(s)
        if not b.y - STEP_DOWN - 0.01 <= surface <= b.y + STEP_UP + 0.01:
            self.fail("levitate", b, "stepped onto a beam from too far")

    def check_step_off(self, a, b):
        beam = self.route.beams[a.support] if 0 <= a.support < len(self.route.beams) else None
        if beam is None:
            self.fail("levitate", b)
        s, _ = beam.project(b.x, b.z)
        if 0.004 < s < 0.996:
            self.fail("teleport", b, "off a beam half-way along")

    def check_space(self, b):
        lo = b.ms - SPACE_BEFORE_JUMP * 1000
        if not any(name == "space" and lo <= t <= b.ms for t, name, _ in self.events):
            self.fail("spacebar", b, "a jump without Space")

    def keys_held(self, t0, t1):
        mask = 0
        for t, m in self.inputs:
            if t <= t0:
                mask = m
            elif t <= t1:
                if m & MOVE_KEYS:
                    return True
            else:
                break
        return bool(mask & MOVE_KEYS)

    def check_respawn(self, a, b, dt):
        if b.mode == OUT:
            return
        if not b.has("respawn") or self.lost_at is None:
            self.fail("respawn", b, "back without a respawn")
        reason = self.lost_reason.get(self.lost_at.ms, "flat")
        if b.t - self.lost_at.t < FADE[reason] + FADE_GAP - TICK - 0.004:
            self.fail("respawn", b, f"back after {b.t - self.lost_at.t:.2f} s")
        self.lost_at = None
        spots = [c["respawn"] for c in self.route.checkpoints if c["index"] <= self.cp["index"]]
        if any(self.dist3(b, p) <= 0.03 for p in spots):
            return
        if not any(math.hypot(b.x - x, b.z - z) <= 0.45 and abs(b.y - y) <= 0.012 for x, y, z in self.safe):
            self.fail("respawn", b, "back somewhere it never stood")


def beam_height(beam, s):
    """The walking surface at s with Mnot standing at s (world.js Beam.heightAt with load = s)."""
    y = beam.a[1] + (beam.b[1] - beam.a[1]) * s - beam.sag * 4 * s * (1 - s)
    if beam.dip > 0:
        p = min(0.98, max(0.02, min(1.0, max(0.0, s))))
        peak = beam.dip * 4 * p * (1 - p)
        y -= peak * s / p if s < p else peak * (1 - s) / (1 - p)
    return y


def verify(route, replay, claim, splits):
    """None if the climb holds up, else the Rejection. Raises Malformed for a replay that isn't one."""
    try:
        Checker(route, replay, claim, splits).run()
    except Rejection as rejection:
        return rejection
    return None
