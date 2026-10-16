"""The arena's door (arena.py): the score server passing /arena/ws and /arena/health on to the arena's room server,
here a stand-in that answers the upgrade and sends back what it gets.

    python -X utf8 -m unittest discover -s server -p "test_*.py"
"""
import json
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import arena                                               # noqa: E402
from peak_scores import App, networks                      # noqa: E402

SITE = "https://peakmnot.mosredna.eu"
UPGRADE = ("GET /arena/ws HTTP/1.1\r\nHost: peakmnot.mosredna.eu\r\nOrigin: https://peakmnot.mosredna.eu\r\n"
           "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
           "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{extra}\r\n")


class Room:
    """A stand-in for arena/server.mjs: /arena/health, and an upgrade answered with 101 and then an echo. Keeps the
    requests it got."""

    def __init__(self):
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.port = self.listener.getsockname()[1]
        self.requests = []
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            threading.Thread(target=self.talk, args=(conn,), daemon=True).start()

    def talk(self, conn):
        with conn:
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                data += chunk
            head, _, rest = data.partition(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            self.requests.append((lines[0], dict(line.split(": ", 1) for line in lines[1:])))
            if lines[0].startswith("GET /arena/health"):
                body = json.dumps({"ok": True, "playing": 2, "addresses": 2}).encode()
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                             + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
                return
            conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            if rest:
                conn.sendall(rest)
            while data := conn.recv(4096):
                if data == b"bye":
                    return
                conn.sendall(data)

    def close(self):
        self.listener.close()


class Door(unittest.TestCase):
    def setUp(self):
        self.room = Room()
        self.tmp = tempfile.TemporaryDirectory()
        # the site's proxy is on this computer: its X-Forwarded-For is believed
        self.app = App(self.tmp.name, [b"k" * 32], [SITE], networks("127.0.0.1/32"), static=True, quiet=True,
                       arena=arena.door(f"127.0.0.1:{self.room.port}"))
        self.httpd = self.app.serve("127.0.0.1", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.db.close()
        self.room.close()
        self.tmp.cleanup()

    def line(self, extra=""):
        s = socket.create_connection(self.httpd.server_address, timeout=5)
        s.sendall(UPGRADE.format(extra=extra).encode())
        return s

    @staticmethod
    def head(s):
        data = b""
        while b"\r\n\r\n" not in data:
            data += s.recv(4096)
        return data.split(b"\r\n", 1)[0].decode()

    def get(self, path, headers=""):
        with socket.create_connection(self.httpd.server_address, timeout=5) as s:
            s.sendall(f"GET {path} HTTP/1.1\r\nHost: x\r\n{headers}Connection: close\r\n\r\n".encode())
            data = b""
            while chunk := s.recv(4096):
                data += chunk
        head, _, body = data.partition(b"\r\n\r\n")
        return head.decode("latin-1"), body

    def test_the_websocket_goes_through_both_ways(self):
        with self.line("X-Forwarded-For: 6.6.6.6, 203.0.113.9\r\nX-Real-IP: 6.6.6.6\r\n") as s:
            self.assertEqual(self.head(s), "HTTP/1.1 101 Switching Protocols")
            for message in (b"\x81\x05hello", b"\x82" + bytes(range(100))):
                s.sendall(message)
                got = b""
                while len(got) < len(message):
                    got += s.recv(4096)
                self.assertEqual(got, message)
            s.sendall(b"bye")
            self.assertEqual(s.recv(4096), b"")             # the room server closed it: so does the door
        target, headers = self.room.requests[0]
        self.assertEqual(target, "GET /arena/ws HTTP/1.1")
        self.assertEqual(headers["Origin"], SITE)
        self.assertEqual(headers["Sec-WebSocket-Key"], "dGhlIHNhbXBsZSBub25jZQ==")
        # the visitor's address as the trusted proxy saw it, and nothing the visitor said about it
        self.assertEqual(headers["X-Forwarded-For"], "203.0.113.9")
        self.assertNotIn("X-Real-IP", headers)

    def test_a_visitor_without_a_proxy_is_their_own_address(self):
        app = App(self.tmp.name, [b"k" * 32], [SITE], networks("10.0.0.0/8"), static=True, quiet=True,
                  arena=self.app.arena)
        httpd = app.serve("127.0.0.1", 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with socket.create_connection(httpd.server_address, timeout=5) as s:
                s.sendall(UPGRADE.format(extra="X-Forwarded-For: 6.6.6.6\r\n").encode())
                self.assertEqual(self.head(s), "HTTP/1.1 101 Switching Protocols")
            self.assertEqual(self.room.requests[0][1]["X-Forwarded-For"], "127.0.0.1")
        finally:
            httpd.shutdown()
            httpd.server_close()
            app.db.close()

    def test_health_is_passed_on(self):
        head, body = self.get("/arena/health")
        self.assertTrue(head.startswith("HTTP/1.1 200"), head)
        self.assertEqual(json.loads(body), {"ok": True, "playing": 2, "addresses": 2})

    def test_only_a_websocket(self):
        head, _ = self.get("/arena/ws")
        self.assertTrue(head.startswith("HTTP/1.1 426"), head)
        self.assertEqual(self.room.requests, [])

    def test_the_room_server_down(self):
        self.room.close()
        self.app.arena.address = ("127.0.0.1", self.free_port())
        with self.line() as s:
            self.assertTrue(self.head(s).startswith("HTTP/1.1 502"))
        head, body = self.get("/arena/health")
        self.assertTrue(head.startswith("HTTP/1.1 502"), head)
        self.assertEqual(json.loads(body), {"ok": False})

    def test_at_most_so_many_lines(self):
        self.app.arena.open = threading.BoundedSemaphore(1)
        with self.line() as first:
            self.assertEqual(self.head(first), "HTTP/1.1 101 Switching Protocols")
            with self.line() as second:
                self.assertTrue(self.head(second).startswith("HTTP/1.1 503"))
            first.sendall(b"bye")
            self.assertEqual(first.recv(4096), b"")
        for _ in range(50):                                 # the first line's thread lets go of its place
            if self.app.arena.open.acquire(timeout=0.1):
                self.app.arena.open.release()
                break
        with self.line() as third:
            self.assertEqual(self.head(third), "HTTP/1.1 101 Switching Protocols")

    def test_the_page_is_served_and_may_connect_to_its_own_host(self):
        head, body = self.get("/arena")
        self.assertTrue(head.startswith("HTTP/1.1 200"), head)
        self.assertIn(b"<title>Mnot Arena</title>", body)
        policy = next(line for line in head.split("\r\n") if line.startswith("Content-Security-Policy:"))
        connect = next(part for part in policy.split(";") if part.strip().startswith("connect-src")).split()
        self.assertEqual(connect[:3], ["connect-src", "'self'", "wss://peakmnot.mosredna.eu"])

    @staticmethod
    def free_port():
        with socket.create_server(("127.0.0.1", 0)) as s:
            return s.getsockname()[1]


class NoArena(unittest.TestCase):
    def test_without_an_upstream_nothing_changes(self):
        self.assertIsNone(arena.door(""))
        self.assertIsNone(arena.door(None))
        self.assertEqual(arena.door("127.0.0.1:5298").address, ("127.0.0.1", 5298))
        self.assertEqual(str(arena.door("[::1]:5298")), "[::1]:5298")
        with tempfile.TemporaryDirectory() as tmp:
            app = App(tmp, [b"k" * 32], [SITE], networks("127.0.0.1/32"), static=True, quiet=True)
            httpd = app.serve("127.0.0.1", 0)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                for path in ("/arena/ws", "/arena/health"):
                    with socket.create_connection(httpd.server_address, timeout=5) as s:
                        s.sendall(UPGRADE.replace("/arena/ws", path).replace("Connection: Upgrade", "Connection: close")
                                  .format(extra="").encode())
                        status = s.recv(4096).split(b"\r\n", 1)[0]
                    self.assertRegex(status, rb"^HTTP/1.1 (404|418)", path)
                self.assertNotIn("wss:", app.page(Path(__file__).resolve().parent.parent / "arena.html")[1])
            finally:
                httpd.shutdown()
                httpd.server_close()
                app.db.close()


if __name__ == "__main__":
    unittest.main()
