"""Peak Mnot's score server: the high-score API under /api/peak, and with --static the game itself (production,
one origin). Python's standard library only. See server/README.md.

    python -X utf8 server/peak_scores.py                  # dev: the API on 127.0.0.1:5281, next to the 5280 viewer
    python server/peak_scores.py --static --host 0.0.0.0 --port 8080        # production (the Dockerfile)
    python server/peak_scores.py --backup data/backup.sqlite3              # a consistent copy of the database
    python server/peak_scores.py --reverify RUN_ID                         # check a stored replay again
    python server/peak_scores.py --fixture latest [--as climb]   # the last climb as a test fixture (server/fixtures/)

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
from route import Route             # noqa: E402
from store import Store             # noqa: E402
import verify                       # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATIC = re.compile(r"^/(peak\.html|sounds\.js|music\.js|favicon\.(png|ico)|share\.jpg|manifest\.webmanifest|"
                    r"peak/([a-z]+/)?[a-z0-9_-]+\.(js|css)|models/mnot\.glb|audio/[a-z0-9_-]+\.(wav|mp3)|"
                    r"audio/music/[a-z0-9_-]+\.mp3)$")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".glb": "model/gltf-binary", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".png": "image/png",
         ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}
SECURE = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
          "Cross-Origin-Opener-Policy": "same-origin", "X-Frame-Options": "DENY"}
API_CSP = "default-src 'none'; frame-ancestors 'none'"
PAGE_CSP = ("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net {hashes}; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
DRAIN = 4 * 1024 * 1024               # bytes of an oversized body read (and dropped) before saying no
INLINE_SCRIPT = re.compile(rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)


def page_csp(html):
    """The page's policy, with a hash for each of its inline scripts (the import map and the dev reload check), so
    nothing else inline can run."""
    hashes = " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(m).digest()).decode()}'"
                      for m in INLINE_SCRIPT.findall(html))
    return PAGE_CSP.format(hashes=hashes)


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
        if method in ("GET", "HEAD") and app.static and (path == "/" or STATIC.match(path)):
            if self.static("/peak.html" if path == "/" else path, method == "HEAD"):
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

    def static(self, path, head):
        if not STATIC.match(path):
            return False
        file = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in file.parents or not file.is_file():
            return False
        stat = file.stat()
        tag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        headers = {**SECURE, "Content-Type": TYPES[file.suffix], "ETag": tag, "Cache-Control": "no-cache"}
        if file.suffix == ".html":
            headers["Content-Security-Policy"] = self.server.app.csp(file)
        if self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            for key in ("ETag", "Cache-Control"):
                self.send_header(key, headers[key])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
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
    def __init__(self, data_dir, keys, origins, trusted, static=False, route=None, clock=None, quiet=False):
        self.db = Database(Path(data_dir) / "peak.sqlite3")
        kwargs = {"clock": clock} if clock else {}
        self.store = Store(self.db, keys, **kwargs)
        self.route = route or Route.load()
        self.api = api_module.Api(self.store, self.route, origins, **kwargs)
        self.trusted, self.static, self.quiet = trusted, static, quiet
        self.csp_cache = {}
        self.lock = threading.Lock()

    def csp(self, file):
        stat = file.stat()
        key = (str(file), stat.st_mtime_ns)
        with self.lock:
            if key not in self.csp_cache:
                self.csp_cache = {key: page_csp(file.read_bytes())}
            return self.csp_cache[key]

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
    p.add_argument("--as", dest="fixture_name", default="climb", metavar="NAME", help="the fixture's name (climb)")
    args = p.parse_args(argv)
    data_dir = Path(os.environ.get("DATA_DIR") or ROOT / "data")
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://127.0.0.1:5280,http://localhost:5280")
               .split(",") if o.strip()]
    trusted = networks(os.environ.get("TRUSTED_PROXIES", "127.0.0.1/32,::1/128"))
    app = App(data_dir, server_keys(data_dir), origins, trusted, static=args.static)
    if args.backup:
        app.db.backup(args.backup)
        print(f"Backed up {app.db.path} to {args.backup}")
        return
    if args.reverify:
        return reverify(app, args.reverify)
    if args.fixture:
        return fixture(app, args.fixture, args.fixture_name)
    server = app.serve(args.host, args.port)
    print(f"Peak Mnot scores on http://{args.host}:{args.port}/api/peak (data in {data_dir}, "
          f"{'serving the game' if args.static else 'API only'}, route {app.route.fingerprint[:12]})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def stored_climb(app, run_id):
    if run_id == "latest":
        row = app.db.one("SELECT id FROM runs WHERE finished IS NOT NULL ORDER BY finished DESC LIMIT 1")
        run_id = row["id"] if row else ""
    stored, run = app.store.replay(run_id), app.store.run(run_id)
    if not stored or not run:
        print("No such replay.")
        return None
    claim = {"time": run["time_ms"], "falls": run["falls"], "dents": run["dents"]}
    return stored, claim, [(cp, t) for cp, t, _ in json.loads(run["splits"])]


def fixture(app, run_id, name="climb"):
    climb = stored_climb(app, run_id)
    if climb is None:
        return 1
    (replay, verdict, _), claim, splits = climb
    out = ROOT / "server" / "fixtures" / f"{re.sub(r'[^a-z0-9_-]', '', name.lower()) or 'climb'}.json.gz"
    out.parent.mkdir(exist_ok=True)
    data = {"route": app.route.data, "claim": claim, "splits": splits, "replay": replay}    # the route it was climbed on
    out.write_bytes(gzip.compress(json.dumps(data, separators=(",", ":")).encode(), mtime=0))
    print(f"Saved the {verdict} climb ({claim['time']} ms, {len(replay['samples'])} samples) to {out}")
    return 0


def reverify(app, run_id):
    climb = stored_climb(app, run_id)
    if climb is None:
        return 1
    (replay, verdict, details), claim, splits = climb
    rejection = verify.verify(app.route, replay, claim, splits)
    print(f"stored verdict: {verdict} {details or ''}")
    print("now: ok" if rejection is None else f"now: {rejection.reason} at {rejection.at} ms: {rejection.detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
