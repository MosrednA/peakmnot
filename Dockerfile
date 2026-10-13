# Peak Mnot in one small container: the games, built, and the score server (Python's standard library only) on one
# port. See server/README.md, "Production".

# The games' code bundled and named by its content (tools/build.mjs, README.md "Run it yourself"), into /src/dist
FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN node tools/build.mjs

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    DATA_DIR=/data

RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin mnot \
 && mkdir -p /data \
 && chown mnot /data

WORKDIR /app

# Only what the pages and the server use (server/peak_scores.py serves an allowlist of these): the built site, with
# its code, styles and sounds in assets/; .dockerignore keeps the tests, fixtures, the bot and the masters out.
COPY --from=build /src/dist/ ./
COPY server/ ./server/

USER mnot
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(urllib.request.urlopen('http://127.0.0.1:8080/api/peak/health', timeout=4).status != 200)"]

CMD ["python", "server/peak_scores.py", "--static", "--host", "0.0.0.0", "--port", "8080"]
