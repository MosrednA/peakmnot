"""Peak Mnot's score server: every mini game's high scores (games.py) under /api/<game>, and with --static the
games themselves (production, one origin). Python's standard library only. See server/README.md.

    python -X utf8 server/peak_scores.py                  # dev: the API on 127.0.0.1:5281, next to the 5280 viewer
    python server/peak_scores.py --static --host 0.0.0.0 --port 8080        # production (the Dockerfile)
    python server/peak_scores.py --backup data/backup.sqlite3              # a consistent copy of the database
    python server/peak_scores.py --reverify RUN_ID [--game downhill]       # check a stored replay again
    python server/peak_scores.py --fixture latest [--as climb] [--game peak]    # the last run as a test fixture
    python server/peak_scores.py --showcase FILE --as NAME      # a recorded climb shown by link only, not on the board

Settings come from the environment: DATA_DIR, PEAK_SECRET (and PEAK_SECRET_OLD while rotating), ALLOWED_ORIGINS,
TRUSTED_PROXIES; the command line overrides HOST and PORT.
"""
import argparse
import base64
import gzip
import hashlib
import ipaddress
import json
import os
import re
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api as api_module            # noqa: E402
from db import Database             # noqa: E402
import games                        # noqa: E402
import names                        # noqa: E402
from perf import PerfLog            # noqa: E402
from store import Store             # noqa: E402
import verify                       # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = Path(os.environ.get("SITE_DIR") or ROOT).resolve()     # what --static serves: the repository, or a build
STATIC = re.compile(r"^/((" + "|".join(games.NAMES) + r")\.html|sounds\.js|music\.js|favicon\.(png|ico)|share(-[a-z]+)?\.jpg|"
                    r"manifest\.webmanifest|peak/([a-z]+/)?[a-z0-9_-]+\.(js|css|jpg)|models/mnot\.glb|"
                    r"audio/([a-z]+/)?[a-z0-9_-]+\.(wav|mp3|m4a)|audio/music/[a-z0-9_-]+\.mp3)$")
# the pages: the first game's at /, every other game's at /<game> too, the page of all the games at /games and the
# viewer (index.html, the model and every game's moves) at /viewer; a route names its file, which needs no STATIC
PAGES = {"/": f"/{games.NAMES[0]}.html", **{f"/{name}": f"/{name}.html" for name in games.NAMES[1:]},
         "/games": "/games.html", "/viewer": "/index.html"}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".glb": "model/gltf-binary", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".png": "image/png",
         ".m4a": "audio/mp4", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}
SECURE = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
          "Cross-Origin-Opener-Policy": "same-origin", "X-Frame-Options": "DENY"}
API_CSP = "default-src 'none'; frame-ancestors 'none'"
# The page may be shown in an iframe on the podcast's mascot site, and only there: frame-ancestors names it, and the
# page goes without X-Frame-Options, which can't name a site.
PAGE_CSP = ("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://stats.mosredna.eu {hashes}; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; media-src 'self' blob:; "
            "connect-src 'self' https://cdn.jsdelivr.net https://stats.mosredna.eu; worker-src 'self' blob:; "
            "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://mnot.nl https://*.mnot.nl")
DRAIN = 4 * 1024 * 1024               # bytes of an oversized body read (and dropped) before saying no
INLINE_SCRIPT = re.compile(rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)
# The page loads its code through v/BUILD/ (App.page): Cloudflare tells browsers to keep JS and CSS for hours, so a
# path that changes with the code is what keeps a new page from running with old modules. Any id is served; only the
# current one is cached for good.
VERSIONED = re.compile(r"^/v/([0-9a-f]{12})(/(?![a-z]+\.html$).*)$")    # the code, never a page itself
PAGE_CODE = re.compile(rb'((?:src|href)=")(peak/)')
BUILD_FILES = ("*.js", "peak/**/*", "audio/**/*")    # what loads through v/BUILD/: the modules and, by music.js, music
# A built site (tools/build.mjs, dist/) has its code, styles and sounds in assets/, each named by its content, so
# each is kept for good; its page links them by those names.
HASHED = re.compile(r"^/assets/[a-z0-9_-]+-[A-Z2-7]{8}\.(js|css|m4a|mp3|wav|jpg)$")


def page_csp(html):
    """The page's policy, with a hash for each of its inline scripts (the import map and the dev reload check), so
    nothing else inline can run."""
    hashes = " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(m).digest()).decode()}'"
                      for m in INLINE_SCRIPT.findall(html))
    policy = PAGE_CSP.format(hashes=hashes)
    # a built page brings three.js along in its own code, so it needs nothing from the CDN
    return policy if b"cdn.jsdelivr.net" in html else policy.replace(" https://cdn.jsdelivr.net", "")


def build_id(root=SITE):
    """A short hash of every file the page loads through v/BUILD/, so the path changes whenever one of them does."""
    digest = hashlib.sha256()
    for file in sorted({f for pattern in BUILD_FILES for f in root.glob(pattern) if f.is_file()}):
        path = "/" + file.relative_to(root).as_posix()
        if STATIC.match(path):
            digest.update(path.encode() + b"\0" + file.read_bytes())
    return digest.hexdigest()[:12]


def networks(text):
    return [ipaddress.ip_network(part.strip(), strict=False) for part in text.split(",") if part.strip()]


def client_ip(peer, forwarded, trusted):
    """The caller's address: the socket's, unless that's a proxy we trust, then the right-most X-Forwarded-For
    entry that isn't one of ours (the left ones are whatever the client wrote)."""
    def ours(text):
        try:
            return any(ipaddress.ip_address(text) in net for net in trusted)
        except ValueError:
            return False
    if not forwarded or not ours(peer):
        return peer
    for hop in reversed([h.strip() for h in forwarded.split(",")]):
        try:
            ipaddress.ip_address(hop)
        except ValueError:
            break
        if not ours(hop):
            return hop
    return peer


def server_keys(data_dir):
    keys = [os.environ.get("PEAK_SECRET"), os.environ.get("PEAK_SECRET_OLD")]
    if not keys[0]:
        path = Path(data_dir) / "secret.key"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(secrets.token_hex(32), encoding="ascii")
            try:
                path.chmod(0o600)
            except OSError:
                pass
        keys[0] = path.read_text(encoding="ascii").strip()
    return [hashlib.sha256(k.encode()).digest() for k in keys if k]


class Handler(BaseHTTPRequestHandler):
    server_version = "Mnot/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    timeout = 20                       # seconds a slow client may take per read

    def version_string(self):
        return self.server_version

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("HEAD")

    def do_POST(self):
        self.dispatch("POST")

    def do_OPTIONS(self):
        self.dispatch("OPTIONS")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        app = self.server.app
        url = urlsplit(self.path)
        path = url.path
        if method in ("GET", "HEAD") and app.static:
            versioned = VERSIONED.match(path)
            routed = PAGES.get(path)
            file = routed or (versioned.group(2) if versioned else path)
            current = bool(versioned) and versioned.group(1) == app.build
            if self.static(file, method == "HEAD", current, routed=bool(routed)):
                return
        body = b""
        if method == "POST":
            try:
                size = int(self.headers.get("Content-Length", ""))
            except ValueError:
                size = -1
            if self.headers.get("Transfer-Encoding") or size < 0 or size > api_module.MAX_BODY:
                # refused, and the connection closed; a body up to DRAIN is read and dropped first so the client
                # hears why (closing on unread data resets the connection); a bigger one isn't worth reading
                oversized = size > api_module.MAX_BODY
                if oversized and size <= DRAIN and not self.headers.get("Transfer-Encoding"):
                    self.drain(size)
                return self.refuse("oversized" if oversized else "malformed")
            body = self.rfile.read(size)
        ip = client_ip(self.client_address[0], self.headers.get("X-Forwarded-For"), app.trusted)
        headers = {k: self.headers.get(k) for k in ("Origin", "Content-Type", "X-Mnot-Sig")}
        self.answer(*app.api.handle(method, path, parse_qs(url.query), headers, body, ip))

    def drain(self, size):
        while size > 0:
            chunk = self.rfile.read(min(size, 65536))
            if not chunk:
                return
            size -= len(chunk)

    def refuse(self, code):
        status, message = api_module.eggs.loud(code)
        data = json.dumps({"error": code, "message": message}).encode()
        headers = {"Content-Type": "application/json; charset=utf-8", "X-Mnot-Says": message,
                   **self.server.app.api.cors({"Origin": self.headers.get("Origin")})}
        self.answer(status, headers, data, close=True)

    def answer(self, status, headers, data, close=False):
        self.send_response(status)
        for key, value in {**SECURE, "Content-Security-Policy": API_CSP, "Cache-Control": "no-store", **headers}.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        if close:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def static(self, path, head, current=False, routed=False):
        """A file of the game; current when asked for through this build's v/BUILD/, or named by its content
        (HASHED), so it can be kept for good; routed when a page's route (PAGES) named it."""
        hashed = bool(HASHED.match(path))
        if not (routed or STATIC.match(path) or hashed):
            return False
        file = (SITE / path.lstrip("/")).resolve()
        if SITE not in file.parents or not file.is_file():
            return False
        app, page = self.server.app, file.suffix == ".html"
        stat = file.stat()
        # the page names the build in its links, so its tag does too: new code, new page
        tag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}' + (f'-{app.build}"' if page else '"')
        cache = "public, max-age=31536000, immutable" if current or hashed else "no-cache"
        headers = {**SECURE, "Content-Type": TYPES[file.suffix], "ETag": tag, "Cache-Control": cache}
        if page:
            data, headers["Content-Security-Policy"] = app.page(file)
            del headers["X-Frame-Options"]          # frame-ancestors says who may frame it (PAGE_CSP)
        if self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            for key in ("ETag", "Cache-Control"):
                self.send_header(key, headers[key])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        if not page:
            data = file.read_bytes()
        self.send_response(200)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if not head:
            self.wfile.write(data)
        return True

    def log_message(self, fmt, *args):
        if self.server.app.quiet or fmt.startswith("Request timed out"):      # an idle keep-alive, not news
            return
        if getattr(self, "path", None) == "/api/peak/health" and args[1:2] == ("200",):     # Docker, every 30 s
            return
        sys.stderr.write(f"{self.log_date_time_string()} {fmt % args}\n")


class App:
    def __init__(self, data_dir, keys, origins, trusted, static=False, route=None, clock=None, quiet=False,
                 downhill_route=None, levels=None):
        """route, downhill_route: a game's route instead of its file's; levels: the games' other levels, as
        games.load() takes them (tests)."""
        self.db = Database(Path(data_dir) / "peak.sqlite3")
        kwargs = {"clock": clock} if clock else {}
        self.store = Store(self.db, keys, **kwargs)                 # the climb's; .for_game() for another's
        self.games = {game.name: game for game in games.load(peak_route=route, downhill_route=downhill_route,
                                                             levels=levels)}
        for game in self.games.values():
            self.store.for_game(game.name).house(game.house)
        self.route = self.games["peak"].route
        self.api = api_module.Api(self.store, self.games.values(), origins,
                                  perf=PerfLog(Path(data_dir) / "perf.jsonl", quiet), **kwargs)
        self.trusted, self.static, self.quiet = trusted, static, quiet
        self.build = build_id() if static else ""
        self.page_cache = {}
        self.lock = threading.Lock()

    def page(self, file):
        """A game's page as served, with its links into peak/ going through v/BUILD/, and its policy."""
        stat = file.stat()
        with self.lock:
            cached = self.page_cache.get(str(file))
            if cached is None or cached[0] != stat.st_mtime_ns:
                html = PAGE_CODE.sub(rb"\1v/" + self.build.encode() + rb"/\2", file.read_bytes())
                cached = self.page_cache[str(file)] = (stat.st_mtime_ns, (html, page_csp(html)))
            return cached[1]

    def serve(self, host, port):
        server = ThreadingHTTPServer((host, port), Handler)
        server.daemon_threads = True
        server.app = self
        return server


def main(argv=None):
    p = argparse.ArgumentParser(description="Peak Mnot's score server")
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5281")))
    p.add_argument("--static", action="store_true", help="also serve the game (production)")
    p.add_argument("--backup", metavar="FILE", help="copy the database to FILE and stop")
    p.add_argument("--reverify", metavar="RUN", help="check a stored replay against today's route and stop")
    p.add_argument("--fixture", metavar="RUN", help="save a stored climb ('latest' for the last) as a test fixture")
    p.add_argument("--showcase", metavar="FILE", help="check a recorded climb's replay JSON ('-' for stdin) and keep "
                   "it to be played by link only, never on the board; prints the link's id")
    p.add_argument("--as", dest="name", metavar="NAME", help="the fixture's name (climb), or the showcased climber's")
    boards = [games.board_name(name, level) for name in games.NAMES for level in ("", *games.LEVELS[name])]
    p.add_argument("--game", default="peak", choices=boards, help="whose run --reverify and --fixture mean "
                   "(a game, or a level of one: downhill-<level>)")
    args = p.parse_args(argv)
    data_dir = Path(os.environ.get("DATA_DIR") or ROOT / "data")
    dev = ",".join(f"http://{host}:{port}" for port in (5280, 5293) for host in ("127.0.0.1", "localhost"))
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", dev).split(",") if o.strip()]
    trusted = networks(os.environ.get("TRUSTED_PROXIES", "127.0.0.1/32,::1/128"))
    app = App(data_dir, server_keys(data_dir), origins, trusted, static=args.static)
    if args.backup:
        app.db.backup(args.backup)
        print(f"Backed up {app.db.path} to {args.backup}")
        return
    if args.reverify:
        return reverify(app, args.reverify, args.game)
    if args.fixture:
        return fixture(app, args.fixture, args.name or ("climb" if args.game == "peak" else args.game), args.game)
    if args.showcase:
        return showcase(app, args.showcase, args.name)
    server = app.serve(args.host, args.port)
    boards = ", ".join(f"/api/{name} (route {game.route.fingerprint[:12]})" for name, game in app.games.items())
    print(f"Peak Mnot scores on http://{args.host}:{args.port}: {boards} (data in {data_dir}, "
          f"{'serving the games' if args.static else 'API only'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def stored_climb(app, run_id, game="peak"):
    """A stored run of the game's: its replay, the claim it finished with and its splits."""
    store = app.store.for_game(game)
    if run_id == "latest":
        row = app.db.one("SELECT id FROM runs WHERE finished IS NOT NULL AND game = ? ORDER BY finished DESC LIMIT 1",
                         (game,))
        run_id = row["id"] if row else ""
    stored, run = store.replay(run_id), store.run(run_id)
    if not stored or not run:
        print("No such replay.")
        return None
    claim = {"time": run["time_ms"], "falls": run["falls"], "dents": run["dents"]}
    if "clock" in app.games[game].claim:            # the clock is the replay's last sample; the bonus came off it
        clock = stored[0]["samples"][-1][0]
        claim.update(clock=clock, bonus=clock - run["time_ms"])
    return stored, claim, [(cp, t) for cp, t, _ in json.loads(run["splits"])]


def fixture(app, run_id, name="climb", game="peak"):
    climb = stored_climb(app, run_id, game)
    if climb is None:
        return 1
    (replay, verdict, _), claim, splits = climb
    folder = ROOT / "server" / "fixtures" / ("" if game == "peak" else game)         # another game's in its folder
    out = folder / f"{re.sub(r'[^a-z0-9_-]', '', name.lower()) or 'climb'}.json.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    route = app.games[game].route.data                  # the route it was played on
    data = {"route": route, "claim": claim, "splits": splits, "replay": replay}
    out.write_bytes(gzip.compress(json.dumps(data, separators=(",", ":")).encode(), mtime=0))
    print(f"Saved the {verdict} run ({claim['time']} ms, {len(replay['samples'])} samples) to {out}")
    return 0


def reverify(app, run_id, game="peak"):
    climb = stored_climb(app, run_id, game)
    if climb is None:
        return 1
    (replay, verdict, details), claim, splits = climb
    rejection = app.games[game].verify(app.games[game].route, replay, claim, splits)
    print(f"stored verdict: {verdict} {details or ''}")
    print("now: ok" if rejection is None else f"now: {rejection.reason} at {rejection.at} ms: {rejection.detail}")
    return 0


def showcase(app, path, name):
    """Check a recorded climb like a finish would (its claim and splits read off the replay) and keep it, shown by
    link only: peak.html?replay=ID. For climbs that aren't a player's, such as the AI climber's (ai/)."""
    if not name or names.clean(name) != (name, None):
        print("Give it a name with --as that the board would take as it is.")
        return 1
    try:
        replay = json.loads(sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8"))
        events = replay["events"]
        claim = {"time": replay["samples"][-1][0], "falls": sum(1 for e in events if e[1:] == ["lost", "fall"]),
                 "dents": sum(1 for e in events if e[1] == "dent")}
        rejection = verify.verify(app.route, replay, claim, [(e[2], e[0]) for e in events if e[1] == "cp"])
    except (OSError, ValueError, KeyError, IndexError, TypeError, verify.Malformed) as e:
        print(f"Not a replay: {e!r}")
        return 1
    if rejection is not None:
        print(f"Turned down: {rejection.reason} at {rejection.at} ms: {rejection.detail}")
        return 1
    run_id = app.store.showcase(name, claim, gzip.compress(json.dumps(replay, separators=(",", ":")).encode()))
    print(f"Showcased {name} ({claim['time']} ms, {claim['falls']} falls): peak.html?replay={run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
