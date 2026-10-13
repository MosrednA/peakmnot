"""Refresh server/route.json from the game: run this, open http://127.0.0.1:5280/peak.html?manual, and paste the
line it prints into the browser console. The page exports the route (peak/scores/routedata.js) and posts it here once;
this writes route.json (one key per line, so a diff shows what changed) and stops.

    python -X utf8 server/export_route.py
"""
import json
import secrets
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

OUT = Path(__file__).resolve().parent / "route.json"
ORIGINS = {"http://127.0.0.1:5280", "http://localhost:5280"}
NEEDED = {"v", "rig", "beamSpeed", "solids", "beams", "checkpoints", "summit", "rail", "gusts", "fingerprint", "movers"}


def write(route, path=OUT):
    lines = [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in route.items()]
    path.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8", newline="\n")


def main(port=5289):
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
            ok = ok and isinstance(route, dict) and NEEDED <= route.keys()
            if ok:
                write(route)
                done["fingerprint"] = route["fingerprint"]
            self.send_response(200 if ok else 400)
            self.cors()
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    print("Paste this into the console of http://127.0.0.1:5280/peak.html?manual :\n")
    print(f"fetch('http://127.0.0.1:{port}/route?ticket={ticket}', {{ method: 'POST', body: JSON.stringify("
          f"await (await import('./peak/scores/routedata.js')).exportRoute(peak)) }})"
          f".then(r => console.log(r.status))\n")
    while "fingerprint" not in done:
        server.handle_request()
    print(f"Wrote {OUT} (fingerprint {done['fingerprint'][:12]}).")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5289)
