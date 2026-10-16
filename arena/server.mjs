// The arena's room server: one Room (room.mjs) behind a WebSocket at /arena/ws, stepped TICK at a time on a steady
// clock, and /arena/health for a look at who's in. `node server.mjs`, or `npm start`; PORT (5298) and HOST
// (127.0.0.1) say where it listens, ARENA_ORIGINS (comma separated) which pages may connect besides local ones, and
// ARENA_BOTS (3) how many bots keep a lone visitor company (room.mjs, fill).
// Live, the score server passes the page's WebSocket on to it (server/arena.py), with the visitor's address, and
// BESIDE (host:port) is that score server, whose network this shares (see "Beside the score server" below).
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { TICK } from '../peak/arena/sim.js';
import { PATH } from '../peak/arena/protocol.js';
import { Room } from './room.mjs';

const PORT = Number(process.env.PORT ?? 5298);
const HOST = process.env.HOST ?? '127.0.0.1';
const ORIGINS = new Set((process.env.ARENA_ORIGINS ?? 'https://peakmnot.mosredna.eu').split(',').map(s => s.trim()));
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const BESIDE = process.env.BESIDE ?? '';
const BOTS = Number(process.env.ARENA_BOTS ?? 3);

const HEARTBEAT = 20;           // s between pings; a connection that didn't answer the last one is gone
const SNAPSHOT_BACKLOG = 64 * 1024;   // bytes waiting to go out before a slow connection skips snapshots
const MESSAGES = { second: 120 };     // messages a connection may send in a second (inputs are 30)
const PER_ADDRESS = 4;                // connections from one address (players and watchers); this computer has none
const KNOCK = { every: 2, missed: 3 };   // s between knocks on BESIDE, and knocks in a row unanswered before stopping

const room = new Room({ bots: BOTS });
const addresses = new Map();          // connections open, by address

// Who's at the other end. Live, that's the score server on this container's network, which passes the visitor's
// address on in X-Forwarded-For (server/arena.py): believed from this computer only, and only its last entry.
function addressOf(req) {
  const peer = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for']?.split(',').at(-1).trim();
  return LOOPBACK.test(peer) && forwarded ? forwarded : peer;
}

const server = http.createServer((req, res) => {
  if (req.url === '/arena/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, playing: room.playing, watching: room.watching, bots: room.crowd.length,
      max: room.max, addresses: addresses.size }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`The arena's room server (WebSocket at ${PATH}). The page is arena.html, on the dev server.\n`);
});

const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 2048 });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin ?? '', address = addressOf(req), open = addresses.get(address) ?? 0;
  const refuse = status => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (new URL(req.url, 'http://x').pathname !== PATH || !(LOCAL.test(origin) || ORIGINS.has(origin))) {
    return refuse('403 Forbidden');
  }
  if (open >= PER_ADDRESS && !LOOPBACK.test(address)) return refuse('429 Too Many Requests');
  // counted from here until the line closes, whether the upgrade goes through or not
  addresses.set(address, open + 1);
  socket.once('close', () => {
    const left = addresses.get(address) - 1;
    if (left > 0) addresses.set(address, left);
    else addresses.delete(address);
  });
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

// Beside the score server: live, this runs on the score server's container's network (docker-compose.yml). When that
// container starts again (a crash, a restart) it gets a new network, and this would stay behind in the old one, out
// of reach. So once the score server has answered here, KNOCK.missed knocks in a row that it doesn't answer stop this
// too, and Docker starts it again, beside the score server in its new network.
if (BESIDE) {
  const [, host, port] = BESIDE.match(/^\[?(.*?)\]?:(\d+)$/);
  let seen = false, missed = 0;
  setInterval(() => {
    const knock = net.connect({ host, port: Number(port), timeout: 1000 });
    let done = false;
    const heard = answered => {
      if (done) return;
      done = true;
      knock.destroy();
      if (answered) { seen = true; missed = 0; }
      else if (seen && ++missed >= KNOCK.missed) {
        console.log(`Mnot arena: the score server at ${BESIDE} is gone; stopping, to start again beside it`);
        process.exit(1);
      }
    };
    knock.once('connect', () => heard(true));
    knock.once('error', () => heard(false));
    knock.once('timeout', () => heard(false));
  }, KNOCK.every * 1000).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`Mnot arena: ws://${HOST}:${server.address().port}${PATH}, up to ${room.max} cans`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const ws of sockets.clients) ws.close(1001, 'server going down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
