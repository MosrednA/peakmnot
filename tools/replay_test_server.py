"""Serve the Demo climb and Demo falls replays for the local browser integration check.

Run from any working directory with `python3 tools/replay_test_server.py`; the fixture data and
static game files are resolved from this script's repository checkout.
"""
import gzip
import json
import sys
import tempfile
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))

from peak_scores import App, networks  # noqa: E402
from verify import verify  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5291, help="local port for the fixture server (default: 5291)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="peak-replay-test-") as data_dir:
        app = App(data_dir, [b"local-replay-test-key"], [], networks("127.0.0.1/32"),
                  static=True, quiet=True)
        for fixture_name in ("climb", "falls"):
            fixture_path = SERVER / "fixtures" / f"{fixture_name}.json.gz"
            with gzip.open(fixture_path, "rt", encoding="utf-8") as fixture_file:
                fixture = json.load(fixture_file)
            error = verify(app.route, fixture["replay"], fixture["claim"], fixture["splits"])
            if error:
                raise RuntimeError(f"Invalid {fixture_name} replay fixture: {error}")
            run_id, _ = app.store.new_run("local-test", 0)
            app.store.finish(app.store.run(run_id), b"finish", fixture["claim"], "ok", None,
                             gzip.compress(json.dumps(fixture["replay"]).encode()), {})
            app.store.claim(app.store.run(run_id), b"claim", None, None, f"Demo {fixture_name}")

        server = app.serve("127.0.0.1", args.port)
        print(f"Local replay test server: http://127.0.0.1:{args.port} (Ctrl-C to stop)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            app.db.close()


if __name__ == "__main__":
    main()
