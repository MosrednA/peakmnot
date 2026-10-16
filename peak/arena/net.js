// The page's line to the room server (arena/server.mjs): a WebSocket that comes back by itself when it drops, the
// server's messages as events (protocol.js: JSON by its `t`, snapshots decoded), and the round trip, measured every
// two seconds. ?lag=ms holds every message that long each way, to play as if the server were far away.
import { PATH, encodeInput, decodeSnapshot, kindOf, KIND } from './protocol.js';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const DEV_PORT = 5298;                            // the server's port on this computer (.claude/launch.json)

// Where the server is: ?server=host:port, else the page's own host; a page from a local dev server (another port)
// talks to the room server on this computer.
export function serverUrl(location) {
  const params = new URLSearchParams(location.search);
  const local = LOCAL.includes(location.hostname) && location.port !== String(DEV_PORT);
  const host = params.get('server') ?? (local ? `${location.hostname}:${DEV_PORT}` : location.host);
  const secure = location.protocol === 'https:' && !LOCAL.includes(host.split(':')[0]);
  return `${secure ? 'wss' : 'ws'}://${host}${PATH}`;
}

export class Net {
  constructor(url, { lag = 0 } = {}) {
    this.url = url;
    this.lag = Math.max(0, lag);
    this.ws = null;
    this.listeners = new Map();
    this.rtt = null;
    this.retry = 0;
    this.connected = false;
    this.connect();
    setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
  }

  on(type, fn) { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(fn); }
  emit(type, data) { for (const fn of this.listeners.get(type) ?? []) fn(data); }

  connect() {
    const ws = this.ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.emit('open');
    };
    ws.onmessage = e => this.later(() => this.receive(e.data));
    ws.onclose = e => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      this.emit('close', { was, code: e.code, reason: e.reason });
      // back again in 1, 2, 4 … up to 10 s
      setTimeout(() => this.connect(), Math.min(10, 2 ** this.retry++) * 1000);
    };
  }

  receive(data) {
    if (typeof data === 'string') {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'pong') this.rtt = performance.now() - m.at;
      else this.emit(m.t, m);
    } else if (kindOf(data) === KIND.snapshot) {
      const snapshot = decodeSnapshot(data);
      if (snapshot) this.emit('snapshot', snapshot);
    }
  }

  send(message) { this.out(JSON.stringify(message)); }
  sendInput(input) { this.out(encodeInput(input)); }

  out(data) {
    const ws = this.ws;
    this.later(() => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
  }

  // half the made-up lag each way
  later(fn) {
    if (this.lag) setTimeout(fn, this.lag / 2);
    else fn();
  }
}
