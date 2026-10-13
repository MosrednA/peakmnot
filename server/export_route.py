"""Refresh a game's route file from the game: run this, open the page it names with ?manual, and paste the line it
prints into the browser console. The page exports the route and posts it here once; this writes the file (one key
per line, so a diff shows what changed) and stops.

    python -X utf8 server/export_route.py              # the climb: server/route.json, from peak/scores/routedata.js
    python -X utf8 server/export_route.py downhill     # server/downhill.json, from peak/downhill/routedata.js
"""
import json
import secrets
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "route.json"
ORIGINS = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (5280, 5293)}
# game: (the file, the keys it must have, the page, the export in the page's console)
GAMES = {
    "peak": (OUT, {"v", "rig", "beamSpeed", "solids", "beams", "checkpoints", "summit", "rail", "gusts", "fingerprint",
                   "movers"},
             "peak.html", "(await import('./peak/scores/routedata.js')).exportRoute(peak)"),
    "downhill": (HERE / "downhill.json", {"v", "game", "g", "feel", "chair", "piste", "features", "river", "floes",
                                          "line", "lip", "hard", "pins", "bonus", "fingerprint"},
                 "downhill.html", "(await import('./peak/downhill/routedata.js')).exportRoute(downhill)"),
}


def write(route, path=OUT):
    lines = [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in route.items()]
    path.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8", newline="\n")


def main(game="peak", port=5289):
    out, needed, page, export = GAMES[game]
    ticket = secrets.token_urlsafe(12)
    done = {}

    class Handler(BaseHTTPRequestHandler):
        def cors(self):
            origin = self.headers.get("Origin", "")
            if origin in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.end_headers()

        def do_POST(self):
            size = int(self.headers.get("Content-Length") or 0)
            ok = self.path == f"/route?ticket={ticket}" and 0 < size < 2_000_000
            route = json.loads(self.rfile.read(size)) if ok else None
            ok = ok and isinstance(route, dict) and needed <= route.keys()
            if ok:
                write(route, out)
                done["fingerprint"] = route["fingerprint"]
            self.send_response(200 if ok else 400)
            self.cors()
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Paste this into the console of http://127.0.0.1:5280/{page}?manual :\n")
    print(f"fetch('http://127.0.0.1:{port}/route?ticket={ticket}', {{ method: 'POST', body: JSON.stringify("
          f"await {export}) }})"
          f".then(r => console.log(r.status))\n")
    while "fingerprint" not in done:
        server.handle_request()
    print(f"Wrote {out} (fingerprint {done['fingerprint'][:12]}).")


if __name__ == "__main__":
    args = sys.argv[1:]
    name = args.pop(0) if args and args[0] in GAMES else "peak"
    main(name, int(args[0]) if args else 5289)
