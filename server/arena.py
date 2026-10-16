"""The arena's door (peak/arena/README.md, "Live"). The arena's room server (arena/server.mjs) runs in a container of
its own on this one's network, and this server, the only one the site's proxy reaches, passes its two paths on: the
page's WebSocket at /arena/ws, byte for byte both ways once the request is through, and /arena/health.
ARENA_UPSTREAM (host:port) says where the room server listens; without it both paths are 404, as before.

The room server limits connections per address, so it hears the visitor's address from here, in X-Forwarded-For
(client_ip in peak_scores.py, with TRUSTED_PROXIES); whatever the visitor sent about their address stays behind.
"""
import json
import socket
import threading
import urllib.request

WS, HEALTH = "/arena/ws", "/arena/health"
MOST = 64                # lines passed on at once (the room server takes 48: LIMITS.connections in arena/room.mjs)
CONNECT = 3              # s to reach the room server
CHUNK = 65536
UNSAID = {"x-forwarded-for", "x-real-ip", "forwarded"}      # the visitor's say about their address


def door(text):
    """ARENA_UPSTREAM's host:port as a Door, or None when it's empty."""
    if not (text or "").strip():
        return None
    host, _, port = text.strip().rpartition(":")
    return Door((host.strip("[]") or "127.0.0.1", int(port)))


class Door:
    def __init__(self, address):
        self.address = address
        self.open = threading.BoundedSemaphore(MOST)

    def __str__(self):
        host, port = self.address
        return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"

    def health(self):
        """The room server's /arena/health, as (status, headers, body) for Handler.answer."""
        try:
            with urllib.request.urlopen(f"http://{self}{HEALTH}", timeout=CONNECT) as r:
                return 200, {"Content-Type": "application/json"}, r.read(4096)
        except (OSError, ValueError):
            return 502, {"Content-Type": "application/json"}, json.dumps({"ok": False}).encode()

    def splice(self, target, headers, ip, client, rfile):
        """Pass one WebSocket on: the request as it came (target, headers), but for the address, which is ip now, and
        then every byte both ways until either side closes. 'done', or 'busy' (MOST open) or 'down' (the room server
        can't be reached) before anything was sent."""
        if not self.open.acquire(blocking=False):
            return "busy"
        try:
            try:
                room = socket.create_connection(self.address, timeout=CONNECT)
            except OSError:
                return "down"
            lines = [f"GET {target} HTTP/1.1"]
            lines += [f"{key}: {' '.join(value.split())}" for key, value in headers.items()
                      if key.lower() not in UNSAID]
            lines.append(f"X-Forwarded-For: {ip}")
            # from here a line lives as long as the room server and the page keep it; the room server pings it
            room.settimeout(None)
            client.settimeout(None)

            def end():
                for s in (room, client):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

            try:
                room.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
                back = threading.Thread(target=pump, args=(room.recv, client, end), daemon=True)
                back.start()
                pump(rfile.read1, room, end)        # the request's reader: it may hold the first bytes already
                back.join()
            finally:
                room.close()
            return "done"
        finally:
            self.open.release()


def pump(read, sink, end):
    """Bytes from read() to sink until either side is done, then both."""
    try:
        while data := read(CHUNK):
            sink.sendall(data)
    except (OSError, ValueError):
        pass
    finally:
        end()
