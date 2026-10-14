"""The perf runs: what `?perf` measured on other people's computers, in every game that has it (`peak.html?perf`,
`downhill.html?perf`; peak/kit/perf.js sends it to /api/<game>/perf at the end of a run, docs/performance.md), kept
so nobody has to copy the table by hand.

Each run is one JSON line in DATA_DIR/perf.jsonl, with the game it's of, rolled over to perf.1.jsonl at its cap so the
newest runs are always kept, and one line in the server's log. No IP address is kept: the computer is described by
what its browser says about itself (graphics chip, screen, browser), and by the name in `?perf&by=NAME` if the link
had one.
"""
import json
import threading
import time
from pathlib import Path

MAX_BODY = 64 * 1024            # bytes: a run with its whole table is about 8 KB
CAP = 8 * 1024 * 1024           # bytes each of the two files holds (some 1000 runs)
MAX_TEXT = 12000                # characters of the table kept


def clean(value, depth=0):
    """Plain values only, clipped, a few levels deep: whatever a browser sends, nothing grows the file."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, str):
        return value[:300]
    if isinstance(value, (int, float)):
        return round(value, 2) if value == value and abs(value) != float("inf") else None
    if depth >= 3:
        return None
    if isinstance(value, list):
        return [clean(v, depth + 1) for v in value[:120]]
    if isinstance(value, dict):
        return {str(k)[:40]: clean(v, depth + 1) for k, v in list(value.items())[:40]}
    return None


def keepable(data, now=None, game=None):
    """The run as kept, with the game it came from (its board's name) if given, or None for anything that isn't one."""
    if not isinstance(data, dict) or data.get("v") != 1 or not isinstance(data.get("text"), str):
        return None
    rest = {k: v for k, v in data.items() if k not in ("v", "text", "game")}
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now if now is not None else time.time()))
    return {"at": at, **({"game": game} if game else {}), **clean(rest), "text": data["text"][:MAX_TEXT]}


def summary(run):
    """One line a person can read in the server's log."""
    def num(key, unit):
        value = run.get(key)
        return f"{value:.1f}{unit}" if isinstance(value, (int, float)) else "?"
    by = f" by {run['by']}" if run.get("by") else ""
    canvas = "×".join(str(v) for v in run["canvas"]) if isinstance(run.get("canvas"), list) else "?"
    of = f" ({run['game']})" if run.get("game") else ""
    return (f"perf run{of}: frame {num('frame', ' ms')}, {num('fps', ' fps')} played, on {run.get('gpu') or '?'}, "
            f"canvas {canvas}{by}")


class PerfLog:
    def __init__(self, path, quiet=False):
        self.path, self.quiet = Path(path), quiet
        self.lock = threading.Lock()

    def keep(self, run):
        line = json.dumps(run, separators=(",", ":"), ensure_ascii=False) + "\n"
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            size = self.path.stat().st_size if self.path.exists() else 0
            if size + len(line.encode()) > CAP:
                self.path.replace(self.path.with_name(self.path.stem + ".1.jsonl"))
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line)
        if not self.quiet:
            print(summary(run), flush=True)
