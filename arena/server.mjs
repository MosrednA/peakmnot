// The arena's room server: one Room (room.mjs) behind a WebSocket at /arena/ws, stepped TICK at a time on a steady
// clock, and /arena/health for a look at who's in. `node server.mjs`, or `npm start`; PORT (5298) and HOST
// (127.0.0.1) say where it listens, ARENA_ORIGINS (comma separated) which pages may connect besides local ones.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { TICK } from '../peak/arena/sim.js';
import { PATH } from '../peak/arena/protocol.js';
import { Room } from './room.mjs';

const PORT = Number(process.env.PORT ?? 5298);
const HOST = process.env.HOST ?? '127.0.0.1';
const ORIGINS = new Set((process.env.ARENA_ORIGINS ?? 'https://peakmnot.mosredna.eu').split(',').map(s => s.trim()));
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const HEARTBEAT = 20;           // s between pings; a connection that didn't answer the last one is gone
const SNAPSHOT_BACKLOG = 64 * 1024;   // bytes waiting to go out before a slow connection skips snapshots
const MESSAGES = { second: 120 };     // messages a connection may send in a second (inputs are 30)

const room = new Room();

const server = http.createServer((req, res) => {
  if (req.url === '/arena/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, playing: room.playing, watching: room.watching, max: room.max }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`The arena's room server (WebSocket at ${PATH}). The page is arena.html, on the dev server.\n`);
});

const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 2048 });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin ?? '';
  if (new URL(req.url, 'http://x').pathname !== PATH || !(LOCAL.test(origin) || ORIGINS.has(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws, req));
});

sockets.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const client = {
    send(data) {
      if (ws.readyState !== ws.OPEN) return;
      // snapshots are thirty a second and the next one says it all; text (joins, chat) always goes
      if (typeof data !== 'string' && ws.bufferedAmount > SNAPSHOT_BACKLOG) return;
      ws.send(data);
    },
    close(code, why) { ws.close(code, why); },
  };
  const session = room.open(client);
  if (!session) return;
  let second = Math.floor(performance.now() / 1000), count = 0;
  ws.on('message', (data, binary) => {
    const now = Math.floor(performance.now() / 1000);
    if (now !== second) { second = now; count = 0; }
    if (++count > MESSAGES.second) { ws.close(1008, 'too fast'); return; }
    room.receive(session, data, binary);
  });
  ws.on('close', () => room.close(session));
  ws.on('error', () => ws.terminate());
});

setInterval(() => {
  for (const ws of sockets.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT * 1000).unref();

// The steady clock: every TICK one step, caught up when the timer was late (at most a few; past that, it lets the
// lost time go). Nobody connected, nothing runs.
let next = performance.now();
function loop() {
  const now = performance.now();
  if (!room.sessions.size) next = now + TICK * 1000;
  for (let n = 0; now >= next && n < 4; n++) {
    room.tick();
    next += TICK * 1000;
  }
  if (now - next > TICK * 4000) next = now;
  setTimeout(loop, Math.max(1, next - performance.now()));
}
loop();

server.listen(PORT, HOST, () => console.log(`Mnot arena: ws://${HOST}:${PORT}${PATH}, up to ${room.max} cans`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const ws of sockets.clients) ws.close(1001, 'server going down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
