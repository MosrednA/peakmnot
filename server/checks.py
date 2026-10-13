"""What every game's replay checker shares (games.py), whatever the game's physics: the replay's shape, and the checks
that hold for any run. A game's checker describes its replay (Format), subclasses Checker and adds its own checks on
top (downhill.py). The climb's verify.py came first and has its own copies of these; it raises the same Rejection
and Malformed.

A replay: { v: 1, route: fingerprint, phase: ms,
            samples: [[t ms, x, y, z mm, vx, vy, vz mm/s, mode, flags, ...the game's own columns], ...],
            inputs: [[t ms, key mask], ...], events: [[t ms, name, argument], ...] }
"""
import math

MAX_TIME_MS = 3 * 3600 * 1000       # a run's clock: a run expires sooner anyway (store.py)
MAX_SAMPLES = 30000


class Malformed(Exception):
    """Not a replay at all: a 400, not a run."""


class Rejection(Exception):
    """A replay that doesn't add up: reason (a code eggs.py has words for), what and when (ms)."""

    def __init__(self, reason, detail="", at=None, **numbers):
        super().__init__(f"{reason}: {detail}")
        self.reason, self.detail, self.at, self.numbers = reason, detail, at, numbers


class Format:
    """A game's replay: its flags by name (bits), its event names, the ranges of its own columns after the flags,
    the modes a sample can be in, the bits of the key mask, and the longest a sample's coordinates and speeds go."""

    def __init__(self, flags, events, extra=(), modes=(0, 1, 2, 3), keys=63, reach=10**6, speed=10**5):
        self.flags, self.events, self.extra, self.modes = dict(flags), set(events), tuple(extra), set(modes)
        self.keys, self.reach, self.speed = keys, reach, speed
        self.all_flags = sum(self.flags.values())


class Sample:
    __slots__ = ("t", "ms", "x", "y", "z", "vx", "vy", "vz", "mode", "flags", "extra", "i", "fmt")

    def __init__(self, row, i, fmt):
        self.ms = row[0]
        self.t = row[0] / 1000
        self.x, self.y, self.z = row[1] / 1000, row[2] / 1000, row[3] / 1000
        self.vx, self.vy, self.vz = row[4] / 1000, row[5] / 1000, row[6] / 1000
        self.mode, self.flags, self.extra, self.i, self.fmt = row[7], row[8], tuple(row[9:]), i, fmt

    def has(self, name):
        return bool(self.flags & self.fmt.flags[name])

    @property
    def speed(self):
        return math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz)


def whole(v, lo, hi):
    if type(v) is not int or not lo <= v <= hi:
        raise Malformed(f"{v!r} is not a whole number in {lo}..{hi}")
    return v


def parse(replay, fmt):
    """The replay's shape: anything off here is a malformed request, not a run."""
    if not isinstance(replay, dict) or replay.get("v") != 1:
        raise Malformed("replay")
    if not isinstance(replay.get("route"), str) or len(replay["route"]) > 128:
        raise Malformed("route")
    whole(replay.get("phase"), 0, 30 * 24 * 3600 * 1000)
    samples, inputs, events = replay.get("samples"), replay.get("inputs"), replay.get("events")
    if not isinstance(samples, list) or not 2 <= len(samples) <= MAX_SAMPLES:
        raise Malformed("samples")
    if not isinstance(inputs, list) or len(inputs) > 4 * MAX_SAMPLES:
        raise Malformed("inputs")
    if not isinstance(events, list) or len(events) > 4 * MAX_SAMPLES:
        raise Malformed("events")
    rows, width = [], 9 + len(fmt.extra)
    for i, row in enumerate(samples):
        if not isinstance(row, list) or len(row) != width:
            raise Malformed(f"sample {i}")
        whole(row[0], 0, MAX_TIME_MS)
        for v in row[1:4]:
            whole(v, -fmt.reach, fmt.reach)
        for v in row[4:7]:
            whole(v, -fmt.speed, fmt.speed)
        if row[7] not in fmt.modes or type(row[7]) is not int:
            raise Malformed(f"sample {i} mode")
        whole(row[8], 0, fmt.all_flags)
        for v, (lo, hi) in zip(row[9:], fmt.extra):
            whole(v, lo, hi)
        rows.append(Sample(row, i, fmt))
    for row in inputs:
        if not isinstance(row, list) or len(row) != 2:
            raise Malformed("input")
        whole(row[0], 0, MAX_TIME_MS)
        whole(row[1], 0, fmt.keys)
    for row in events:
        if not isinstance(row, list) or len(row) != 3 or row[1] not in fmt.events:
            raise Malformed("event")
        whole(row[0], 0, MAX_TIME_MS)
        if not (type(row[2]) is int and -1 <= row[2] <= 99999 or isinstance(row[2], str) and len(row[2]) <= 16):
            raise Malformed("event argument")
    return rows, [tuple(r) for r in inputs], [tuple(r) for r in events]


class Checker:
    """The checks any game's run passes. A game's checker sets these and calls run() from its own:

    format: its Format; checkpoint: the event (and flag) a checkpoint comes with, its argument the checkpoint's
    index; finish: the flag the last sample has; out: the mode a sample is in while the player is out of play (a
    fall), skipped by the motion checks; top_speed (m/s) and max_gap (s between samples)."""

    format = None
    checkpoint = "cp"
    finish = "finish"
    out = 3
    top_speed = 50.0
    max_gap = 0.25
    reach = 0.05                    # m: the rounding and a little, for where a sample can be from the one before

    def __init__(self, route, replay, claim, splits):
        self.route, self.claim, self.splits = route, claim, splits
        self.samples, self.inputs, self.events = parse(replay, self.format)
        self.fingerprint = replay["route"]

    def fail(self, reason, sample=None, detail="", **numbers):
        raise Rejection(reason, detail, sample.ms if sample else None, **numbers)

    def run(self):
        self.check_timeline()
        self.check_flags()
        self.check_splits()
        self.check_motion()

    def check_timeline(self):
        s = self.samples
        if self.fingerprint != self.route.fingerprint:
            self.fail("edited", detail="the replay is for another route")
        for a, b in zip(s, s[1:]):
            if b.ms < a.ms:
                self.fail("timeline", b, "time runs backwards")
        last = s[-1].ms
        if any(e[0] > last for e in self.events) or any(i[0] > last for i in self.inputs):
            self.fail("timeline", s[-1], "events after the finish")
        if any(b[0] < a[0] for a, b in zip(self.events, self.events[1:])) or \
                any(b[0] < a[0] for a, b in zip(self.inputs, self.inputs[1:])):
            self.fail("timeline", None, "events out of order")
        if not s[-1].has(self.finish) or any(x.has(self.finish) for x in s[:-1]):
            self.fail("finish", s[-1], "no finish at the end")

    def at_sample(self, name):
        """The events of this name, each with its sample (the first at that time); an event without one fails."""
        by_time = {}
        for x in self.samples:
            by_time.setdefault(x.ms, x)
        found = []
        for t, event, arg in self.events:
            if event == name:
                x = by_time.get(t)
                if x is None:
                    self.fail("edited", None, f"a {name} without its sample")
                found.append((t, arg, x))
        return found

    def check_flags(self):
        """Each event that comes with a flag has its flagged sample, and there are as many flags as events."""
        for name in self.format.flags:
            if name not in self.format.events:
                continue
            found = self.at_sample(name)
            if any(not x.has(name) for _, _, x in found):
                self.fail("edited", found[0][2], f"a {name} without its flag")
            if sum(1 for x in self.samples if x.has(name)) != len({x.i for _, _, x in found}):
                self.fail("edited", None, f"{name} flags without events")

    def check_splits(self):
        """The checkpoints in order, one each, and the splits the game sent as it went say the same."""
        found = self.at_sample(self.checkpoint)
        wanted = list(range(1, len(self.route.checkpoints)))
        if [arg for _, arg, _ in found] != wanted:
            self.fail("skipped", None, f"checkpoints {[arg for _, arg, _ in found]}")
        if len(self.splits) != len(found) or any(sc != arg or abs(st - t) > 1
                                                 for (sc, st), (t, arg, _) in zip(self.splits, found)):
            self.fail("edited", None, "the splits don't match the replay")
        self.checkpoints = found

    def keys_held(self, t0, t1):
        """Every key held at some moment from t0 to t1 (ms), as one mask."""
        mask = 0
        for t, keys in self.inputs:
            if t > t1:
                break
            mask = keys if t <= t0 else mask | keys
        return mask

    def check_motion(self):
        """No gap in the record, never faster than the game goes, and never further from one sample to the next
        than its speed takes it."""
        for a, b in zip(self.samples, self.samples[1:]):
            dt = b.t - a.t
            if dt > self.max_gap:
                self.fail("timeline", b, f"{dt:.2f} s without a sample")
            if b.mode == self.out:
                continue
            if b.speed > self.top_speed:
                self.fail("too_fast", b, f"{b.speed:.1f} m/s", metres_per_second=b.speed)
            if a.mode == self.out or self.jumps(a, b):
                continue
            moved = math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
            if moved > max(a.speed, b.speed) * dt + self.reach + self.give(a, b):
                self.fail("teleport", b, f"{moved:.2f} m in {dt:.3f} s")

    def jumps(self, a, b):
        """Whether b is somewhere new by the game's own doing (a respawn), so the motion checks skip the step."""
        return False

    def give(self, a, b):
        """Metres a step may go past its speed by the game's own doing (pushed out of an obstacle, say)."""
        return 0.0
