# Peak Mnot in one small container: the game's files and its score server (Python's standard library only) on one
# port. See server/README.md, "Production".
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    DATA_DIR=/data

RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin mnot \
 && mkdir -p /data \
 && chown mnot /data

WORKDIR /app

# Only what the page and the server use (server/peak_scores.py serves an allowlist of these); .dockerignore keeps
# the tests, fixtures, the bot and the masters out.
COPY peak.html sounds.js music.js favicon.png favicon.ico manifest.webmanifest ./
COPY peak/ ./peak/
COPY models/mnot.glb ./models/
COPY audio/ ./audio/
COPY server/ ./server/

USER mnot
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(urllib.request.urlopen('http://127.0.0.1:8080/api/peak/health', timeout=4).status != 200)"]

CMD ["python", "server/peak_scores.py", "--static", "--host", "0.0.0.0", "--port", "8080"]
