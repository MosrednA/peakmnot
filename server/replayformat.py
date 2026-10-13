"""The shape of a recorded climb (peak/scores/replay.js), checked before anything else looks at it: anything off here
is a malformed request (400), not a climb. verify.py checks what the climb says.

    { v: 1, route: fingerprint, phase: ms,
      samples: [[t ms, x, y, z mm, vx, vz, vy mm/s, mode, flags, support], ...],
      inputs: [[t ms, key mask], ...], events: [[t ms, name, argument], ...] }

The key mask: 1 up, 2 down, 4 left, 8 right, 16 careful steps, 32 a move without a movement key (a touch stick).
"""

GROUND, AIR, BEAM, OUT = 0, 1, 2, 3
FLAG = {"jump": 1, "land": 2, "beam": 4, "slip": 8, "lost": 16, "respawn": 32, "checkpoint": 64, "summit": 128,
        "knock": 256}
MOVE_KEYS = 1 | 2 | 4 | 8 | 32     # any of these means Mnot is being steered
EVENTS = {"space", "lost", "respawn", "cp", "dent", "summit"}
MAX_SAMPLES = 30000
MAX_TIME_MS = 3 * 3600 * 1000


class Malformed(Exception):
    pass


class Sample:
    __slots__ = ("t", "ms", "x", "y", "z", "vx", "vz", "vy", "mode", "flags", "support", "i")

    def __init__(self, row, i):
        self.ms = row[0]
        self.t = row[0] / 1000
        self.x, self.y, self.z = row[1] / 1000, row[2] / 1000, row[3] / 1000
        self.vx, self.vz, self.vy = row[4] / 1000, row[5] / 1000, row[6] / 1000
        self.mode, self.flags, self.support, self.i = row[7], row[8], row[9], i

    def has(self, name):
        return bool(self.flags & FLAG[name])


def _int(v, lo, hi):
    if type(v) is not int or not lo <= v <= hi:
        raise Malformed(f"{v!r} is not a whole number in {lo}..{hi}")
    return v


def parse(replay):
    """The replay's shape: anything off here is a malformed request, not a climb."""
    if not isinstance(replay, dict) or replay.get("v") != 1:
        raise Malformed("replay")
    if not isinstance(replay.get("route"), str) or len(replay["route"]) > 128:
        raise Malformed("route")
    _int(replay.get("phase"), 0, 30 * 24 * 3600 * 1000)
    samples, inputs, events = replay.get("samples"), replay.get("inputs"), replay.get("events")
    if not isinstance(samples, list) or not 2 <= len(samples) <= MAX_SAMPLES:
        raise Malformed("samples")
    if not isinstance(inputs, list) or len(inputs) > 4 * MAX_SAMPLES:
        raise Malformed("inputs")
    if not isinstance(events, list) or len(events) > 4 * MAX_SAMPLES:
        raise Malformed("events")
    rows = []
    for i, row in enumerate(samples):
        if not isinstance(row, list) or len(row) != 10:
            raise Malformed(f"sample {i}")
        _int(row[0], 0, MAX_TIME_MS)
        for v in row[1:4]:
            _int(v, -10**6, 10**6)
        for v in row[4:7]:
            _int(v, -10**5, 10**5)
        _int(row[7], 0, 3)
        _int(row[8], 0, 511)
        _int(row[9], -1, 999)
        rows.append(Sample(row, i))
    for row in inputs:
        if not isinstance(row, list) or len(row) != 2:
            raise Malformed("input")
        _int(row[0], 0, MAX_TIME_MS)
        _int(row[1], 0, 63)
    for row in events:
        if not isinstance(row, list) or len(row) != 3 or row[1] not in EVENTS:
            raise Malformed("event")
        _int(row[0], 0, MAX_TIME_MS)
        if not (type(row[2]) is int and -1 <= row[2] <= 99 or isinstance(row[2], str) and len(row[2]) <= 16):
            raise Malformed("event argument")
    return rows, [tuple(r) for r in inputs], [tuple(r) for r in events]
