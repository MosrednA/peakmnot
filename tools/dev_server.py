"""Serve the viewer without caching and report source changes for live reload."""

import hashlib
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


class DevServer(ThreadingHTTPServer):
    allow_reuse_address = False  # Windows otherwise allows two listeners on the same preview port.


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if urlsplit(self.path).path != "/__dev_version":
            return super().do_GET()
        revision = hashlib.sha256()
        for path in sorted([
            ROOT / "index.html", ROOT / "sounds.js", *ROOT.glob("peak.html"), *ROOT.glob("peak/*.js"),
            *ROOT.glob("models/*.glb"), *ROOT.glob("audio/*.wav"),
        ]):
            stat = path.stat()
            revision.update(f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}".encode())
        body = json.dumps({"version": revision.hexdigest()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_request(self, code="-", size="-"):
        if urlsplit(self.path).path != "/__dev_version":
            super().log_request(code, size)


if __name__ == "__main__":
    server = DevServer(("127.0.0.1", 5280), DevHandler)
    print("Mnot live preview: http://127.0.0.1:5280/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
