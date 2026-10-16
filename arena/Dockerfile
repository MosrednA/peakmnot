# Mnot Arena's room server (peak/arena/README.md, "Live") in a container of its own, next to the score server's:
# Node, ws, the room and the rules it shares with the page. Built from the repository's root (docker-compose.yml),
# so .dockerignore is the root's.
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
# the shared rules (peak/arena/*.js) are ES modules, as the repository's package.json says for every .js
RUN echo '{ "type": "module" }' > package.json
COPY arena/package.json arena/package-lock.json ./arena/
RUN cd arena && npm ci --omit=dev --no-audit --no-fund
COPY peak/arena/sim.js peak/arena/protocol.js ./peak/arena/
COPY arena/server.mjs arena/room.mjs arena/brain.mjs arena/words.mjs ./arena/

USER node
EXPOSE 5298

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5298) + '/arena/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "arena/server.mjs"]
