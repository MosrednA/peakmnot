"""The /api/peak endpoints, without the HTTP plumbing (peak_scores.py feeds requests in): rate limits, the
signature and nonce on every request after the first, the checks on splits and the finish, the replay check
(verify.py), and the eggs (eggs.py) for anything that doesn't add up.

Api.handle(method, path, query, headers, body, ip) -> (status, headers, body bytes); body is the raw request body
(already capped in size), ip the client's address.
"""
import collections
import gzip
import hashlib
import hmac
import json
import re
import threading
import time
import traceback
import zlib

import eggs
import names
import verify as verifier
from store import Store, body_hash

MAX_BODY = 512 * 1024           # bytes on the wire
MAX_UNZIPPED = 2 * 1024 * 1024  # bytes after gunzip
SLACK = 2.0                     # seconds of clock difference forgiven between the game and the server
MAX_T0 = 15000                  # ms: the game's clock when it asked for a run
LIMITS = {                      # (requests, per seconds)
    "run": (30, 600), "write": (150, 600), "read": (120, 60), "claim": (20, 3600), "egg": (30, 60),
}
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{8,40}$")
SIG = re.compile(r"^[0-9a-f]{64}$")


class Limiter:
    """A sliding window per key, in memory: a restart forgets, which is fine."""

    def __init__(self, clock):
        self.clock = clock
        self.hits = collections.defaultdict(collections.deque)
        self.lock = threading.Lock()
        self.swept = clock()

    def allow(self, bucket, who):
        limit, window = LIMITS[bucket]
        now = self.clock()
        with self.lock:
            if now - self.swept > 300:
                for key in [k for k, q in self.hits.items() if not q or q[-1] < now - 3600]:
                    del self.hits[key]
                self.swept = now
            q = self.hits[(bucket, who)]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


class Answer(Exception):
    """An early answer: status, a JSON body, and what Mnot says about it."""

    def __init__(self, status, body, says=None, burn=False, headers=None):
        super().__init__(status)
        self.status, self.body, self.says, self.burn, self.headers = status, body, says, burn, headers or {}


def loud(code, burn=False, **numbers):
    status, message = eggs.loud(code, **numbers)
    return Answer(status, {"error": code, "message": message}, says=message, burn=burn)


class Api:
    def __init__(self, store: Store, route, origins=(), clock=time.time):
        self.store, self.route, self.clock = store, route, clock
        self.origins = set(origins)
        self.limiter = Limiter(clock)
        self.segments = route.segments()
        self.locks = collections.defaultdict(threading.Lock)
        self.locks_guard = threading.Lock()
        self.purged = 0.0

    # ------------------------------------------------------------------ the way in

    def handle(self, method, path, query, headers, body, ip):
        try:
            status, payload, says, extra = self.route_request(method, path, query, headers, body, ip)
        except Answer as answer:
            status, payload, says, extra = answer.status, answer.body, answer.says, answer.headers
        except Exception:                   # a bug of ours: logged, and a plain 500 (the game retries or gives up)
            traceback.print_exc()
            says = "Mnot tripped over its own laces. Not your fault; try again in a bit."
            status, payload, extra = 500, {"error": "server", "message": says}, {}
        out = {"X-Mnot-Says": says or eggs.saying(), **extra}
        out.update(self.cors(headers))
        if isinstance(payload, str):
            out["Content-Type"] = "text/plain; charset=utf-8"
            data = payload.encode()
        else:
            out["Content-Type"] = "application/json; charset=utf-8"
            data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
        return status, out, data

    def cors(self, headers):
        origin = headers.get("Origin")
        if origin not in self.origins:
            return {}
        return {"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                "Access-Control-Expose-Headers": "X-Mnot-Says, Retry-After"}

    def route_request(self, method, path, query, headers, body, ip):
        if self.clock() - self.purged > 3600:
            self.purged = self.clock()
            self.store.purge()
        who = self.store.ip_hash(ip)
        if path.rstrip("/").lower() in eggs.PROBES or path.startswith("/api/peak/admin"):
            self.limit("egg", who)
            raise loud("probe")
        if method == "OPTIONS":
            allowed = headers.get("Origin") in self.origins
            return 204, "", None, {"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                                   "Access-Control-Allow-Headers": "Content-Type, X-Mnot-Sig",
                                   "Access-Control-Max-Age": "600"} if allowed else {}
        if path in ("/robots.txt", "/api/peak/robots", "/api/peak/robots.txt"):
            return 200, eggs.ROBOTS, None, {}
        if path == "/.well-known/mnot":
            return 200, eggs.WELL_KNOWN, None, {}
        if not path.startswith("/api/peak/"):
            raise loud("not_found")
        parts = path[len("/api/peak/"):].strip("/").split("/")
        if method == "GET":
            self.limit("read", who)
            if parts == ["health"]:
                return 200, {"ok": True, "route": self.route.fingerprint[:12], "db": self.store.db.version}, None, {}
            if parts == ["board"]:
                return 200, self.board(query), None, {}
            if len(parts) == 2 and parts[0] == "replay":
                replay_id = parts[1]
                if not RUN_ID.fullmatch(replay_id):
                    raise loud("not_found")
                replay = self.store.public_replay(replay_id)
                if replay is None:
                    raise loud("not_found")
                return 200, replay, None, {}
            if parts == ["shame"]:
                return 200, {"hallOfShame": self.store.hall_of_shame(),
                             "note": "Climbs that didn't add up. Their climbers were told they came first."}, None, {}
            raise loud("not_found")
        if method != "POST":
            raise loud("method")
        if parts == ["run"]:
            self.limit("run", who)
            return self.new_run(headers, body, who)
        if len(parts) == 3 and parts[0] == "run" and parts[2] in ("split", "finish", "claim"):
            self.limit("write", who)
            return self.signed(parts[1], parts[2], headers, body)
        raise loud("not_found")

    def limit(self, bucket, who):
        if not self.limiter.allow(bucket, who):
            answer = loud("rate")
            answer.headers["Retry-After"] = str(LIMITS[bucket][1] // 4)
            raise answer

    # ------------------------------------------------------------------ reading

    def board(self, query):
        try:
            limit = max(1, min(50, int(query.get("limit", ["10"])[0])))
        except ValueError:
            raise loud("malformed")
        me = query.get("me", [None])[0]
        if me is not None and not re.fullmatch(r"[0-9a-f]{16}", me):
            me = None
        return self.store.board(limit, me)

    def decode(self, headers, body, zipped_ok=False):
        if len(body) > MAX_BODY:
            raise loud("oversized")
        kind = (headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if kind == "application/gzip" and zipped_ok:
            try:
                unzip = zlib.decompressobj(16 + zlib.MAX_WBITS)
                body = unzip.decompress(body, MAX_UNZIPPED)
                if unzip.unconsumed_tail:
                    raise loud("oversized")
            except zlib.error:
                raise loud("malformed")
        elif kind != "application/json":
            raise loud("malformed")
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            raise loud("malformed")
        if not isinstance(data, dict):
            raise loud("malformed")
        return data

    # ------------------------------------------------------------------ the climb

    def new_run(self, headers, body, who):
        data = self.decode(headers, body)
        t0 = data.get("t0")
        if data.get("v") != 1 or type(t0) is not int or not 0 <= t0 <= MAX_T0:
            raise loud("malformed")
        if data.get("route") != self.route.fingerprint:
            raise loud("route")
        run_id, nonce = self.store.new_run(who, t0)
        return 201, {"run": run_id, "nonce": nonce, "expires": int(self.clock() + 3 * 3600)}, None, {}

    def signed(self, run_id, action, headers, body):
        if not RUN_ID.match(run_id):
            raise loud("not_found")
        if len(body) > MAX_BODY:
            raise loud("oversized")
        sig = (headers.get("X-Mnot-Sig") or "").lower()
        if not SIG.match(sig):
            raise loud("teapot")
        with self.locks_guard:
            lock = self.locks[run_id]
        with lock:
            run = self.store.run(run_id)
            if run is None:
                raise loud("not_found")
            fresh = hmac.compare_digest(sig, hmac.new(run["nonce"].encode(), body, hashlib.sha256).hexdigest())
            if not fresh:
                old = run["prev_nonce"]
                if old and hmac.compare_digest(sig, hmac.new(old.encode(), body, hashlib.sha256).hexdigest()):
                    if run["last_hash"] == body_hash(body) and run["last_response"]:
                        # the same request again (its answer got lost on the way): the same answer
                        return run["last_status"], json.loads(run["last_response"]), None, {"X-Mnot-Replay": "1"}
                    raise loud("stale")
                raise loud("teapot")
            if run["state"] == "burned":
                raise loud("burned")
            if run["state"] == "claimed":
                raise loud("duplicate")
            if self.store.expired(run):
                raise loud("expired")
            try:
                return getattr(self, action)(run, headers, body)
            except Answer as answer:
                if answer.burn:
                    self.store.burn(run_id)
                raise

    def elapsed_ms(self, run):
        return (self.clock() - run["created"]) * 1000 + run["t0"]

    def split(self, run, headers, body):
        if run["state"] != "open":
            raise loud("duplicate", burn=True)
        data = self.decode(headers, body)
        cp, t = data.get("cp"), data.get("t")
        if type(cp) is not int or type(t) is not int or not 0 < t < verifier.MAX_TIME_MS:
            raise loud("malformed", burn=True)
        splits = json.loads(run["splits"])
        expected = len(splits) + 1
        if cp < expected:
            raise loud("duplicate", burn=True)
        if cp > expected or cp >= len(self.route.checkpoints):
            raise loud("skipped_split", burn=True)
        self.check_segment(run, splits, cp, t)
        status, response = self.store.add_split(run, body, cp, t)
        return status, response, None, {}

    def check_segment(self, run, splits, index, t):
        """A split (or the finish, index len(checkpoints)): after the one before, not ahead of the wall clock,
        and not quicker than the stretch can be done."""
        before = splits[-1][1] if splits else 0
        if t <= before or t > self.elapsed_ms(run) + SLACK * 1000:
            raise loud("time_travel", burn=True)
        metres, least = self.segments[index - 1]
        seconds = (t - before) / 1000
        if seconds < least:
            raise loud("too_fast_split", burn=True, **eggs.speed_words(metres / seconds, self.route.run_speed))

    def finish(self, run, headers, body):
        if run["state"] != "open":
            raise loud("duplicate", burn=True)
        data = self.decode(headers, body, zipped_ok=True)
        claim = {k: data.get(k) for k in ("time", "falls", "dents")}
        player = data.get("player")
        if any(type(v) is not int or v < 0 for v in claim.values()) or not (player is None or isinstance(player, str)):
            raise loud("malformed", burn=True)
        splits = json.loads(run["splits"])
        if len(splits) != len(self.route.checkpoints) - 1:
            raise loud("skipped_split", burn=True)
        self.check_segment(run, splits, len(self.route.checkpoints), claim["time"])
        try:
            rejection = verifier.verify(self.route, data.get("replay"), claim, [(cp, t) for cp, t, _ in splits])
        except verifier.Malformed:
            raise loud("malformed", burn=True)
        replay = gzip.compress(json.dumps(data.get("replay"), separators=(",", ":")).encode())
        if rejection is None:
            response = dict(self.store.verdict(player, claim["time"], claim["falls"]), provisional=True)
            status, response = self.store.finish(run, body, claim, "ok", None, replay, response)
            return status, response, None, {}
        says = self.shadow_says(rejection)
        details = json.dumps({"reason": rejection.reason, "detail": rejection.detail, "at": rejection.at})
        response = {"rank": 1, "total": self.store.total() + 1, "best": None, "provisional": True, "psst": says}
        status, response = self.store.finish(run, body, claim, rejection.reason, details, replay, response)
        return status, response, says, {}

    def shadow_says(self, rejection):
        numbers = {}
        if "metres_per_second" in rejection.numbers:
            numbers = eggs.speed_words(rejection.numbers["metres_per_second"], self.route.run_speed)
        return eggs.shadow(rejection.reason, **numbers)

    def claim(self, run, headers, body):
        if run["state"] not in ("verified", "shadow"):
            raise loud("duplicate", burn=True)
        data = self.decode(headers, body)
        player_id, secret = data.get("player"), data.get("secret")
        try:
            name, note = names.clean(data.get("name"))
        except ValueError:
            raise loud("malformed", burn=True)
        if not (player_id is None or isinstance(player_id, str)) or not (secret is None or isinstance(secret, str)):
            raise loud("malformed", burn=True)
        if names.taken(name, self.store.house_names()):
            name, note = names.mystery(), names.NOTES["house"]
        extra = {"nameNote": note} if note else {}
        if run["state"] == "shadow":
            says = eggs.shadow(run["verdict"])
            status, response = self.store.shame(run, body, name, run["verdict"], dict(extra, psst=says))
            return status, response, says, {}
        known = self.store.player(player_id) if player_id else None
        if known is not None:
            if known["house"]:
                raise loud("house")                   # not burned either: claim it as yourself
            self.limit("claim", known["id"])
            if not self.store.check_secret(known, secret):
                raise loud("forged_secret")          # not burned: the game drops its stale player and asks again
        status, response = self.store.claim(run, body, known["id"] if known else None, secret, name)
        response.update(extra)
        return status, response, None, {}
