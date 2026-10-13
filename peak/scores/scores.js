// High scores (server/README.md). When the climb starts the server hands out a run; each checkpoint is reported as
// it's reached; at the summit the recorded climb (replay.js) goes up, the server checks it and says where it ranks,
// and the player may put a name on it. Every request after the first is signed with the run's nonce, which the
// server swaps for a fresh one each time. The card and the Hall of Fame are leaderboard.js.
// ?manual (tests and bots) never talks to the server.
import { Recorder } from './replay.js';
import { routeFingerprint } from './routedata.js';
import { Leaderboard } from './leaderboard.js';

const STORE = 'peakmnot.player';     // { id, secret, name } once the server has given this browser a player
const CARD_DELAY = 2000;             // ms after the summit: the dance has started (moments.js)
const ms = s => Math.round(s * 1000);
const sleep = t => new Promise(resolve => setTimeout(resolve, t));
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

// The dev server on 5280 has the score server next door on 5281; anywhere else it's behind the same origin.
export function apiBase(loc = location) {
  return loc.port === '5280' ? `${loc.protocol}//${loc.hostname}:5281/api/peak` : '/api/peak';
}

// localStorage can be missing or throw (private windows, blocked storage): then there's just no "your best".
const saved = {
  get() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; } },
  set(value) { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch { /* no memory, no harm */ } },
};

async function sign(key, bytes) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, bytes));
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function createScores({ player, game, world, manual = false }) {
  // the Web Crypto API needs a secure context (https or localhost)
  if (manual || !globalThis.crypto?.subtle) return { step() {} };
  const base = apiBase();
  const route = routeFingerprint({ world, player });      // the snapshot is taken now, before the first step
  let run = null, nonce = null, status = 'idle', queue = Promise.resolve(), verdict = null;

  // one request at a time, in order: each one needs the nonce the one before brought back
  const enqueue = (job) => { const done = queue.then(job); queue = done.catch(() => {}); return done; };

  async function post(path, data, { zip = false, signed = true } = {}) {
    let body = new TextEncoder().encode(JSON.stringify(data)), type = 'application/json';
    if (zip && typeof CompressionStream === 'function') { body = await gzip(body); type = 'application/gzip'; }
    const headers = { 'Content-Type': type };
    if (signed) headers['X-Mnot-Sig'] = await sign(nonce, body);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(base + path, { method: 'POST', headers, body, credentials: 'omit' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.nonce) nonce = json.nonce;
        return { ok: res.ok, status: res.status, json };
      } catch (err) {
        // the network, not the server: the same request again (the server answers a retry the same way)
        if (attempt >= 2) throw err;
        await sleep(800 * (attempt + 1));
      }
    }
  }

  const off = (why) => {
    status = 'off';
    if (why) console.info(`Peak Mnot high scores are off for this climb: ${why}`);
  };

  async function start() {
    status = 'starting';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // t0: how far the climb's clock had got when this left, so a slow start doesn't look like time travel
        const res = await post('/run', { v: 1, route: await route, t0: ms(game.time) }, { signed: false });
        if (!res.ok) return off(res.json.message ?? `the server said ${res.status}`);
        ({ run, nonce } = res.json);
        status = 'live';
        return;
      } catch {
        await sleep(1500);
      }
    }
    off('the score server is out of reach');
  }

  const recorder = new Recorder({ player, game, world, onBegin: () => enqueue(start) });

  game.on('checkpoint', (cp) => {
    if (!recorder.recording) return;
    const split = { cp: cp.index, t: ms(game.time) };
    enqueue(async () => {
      if (status !== 'live') return;
      const res = await post(`/run/${run}/split`, split).catch(() => null);
      if (!res?.ok) off(res?.json?.message ?? 'a checkpoint went missing on the way');
    });
  });

  const board = new Leaderboard({
    load: async (limit) => {
      const me = saved.get()?.id;
      const res = await fetch(`${base}/board?limit=${limit}${me ? `&me=${encodeURIComponent(me)}` : ''}`,
        { credentials: 'omit' });
      return res.ok ? res.json() : null;
    },
    submit: name => enqueue(async () => {
      if (status !== 'verified') return null;
      let me = saved.get();
      let res = await post(`/run/${run}/claim`, { name, player: me?.id ?? null, secret: me?.secret ?? null });
      if (res.status === 403 && me) {
        // the server doesn't know this browser's secret (a new key, a restored database): carry on as a new player
        saved.set(null);
        me = null;
        res = await post(`/run/${run}/claim`, { name, player: null, secret: null });
      }
      if (res.ok) {
        status = 'claimed';
        saved.set({ id: res.json.player, secret: res.json.secret ?? me?.secret, name: res.json.name });
      }
      return res;
    }),
  });

  // At the summit (the step after it, once the recorder has its last sample): send the climb, show the card.
  function finish() {
    const samples = recorder.samples, last = samples[samples.length - 1];
    const result = { time: last[0], falls: game.falls, dents: recorder.events.filter(e => e[1] === 'dent').length };
    setTimeout(() => {
      board.showResult(result, saved.get()?.name ?? '');
      if (status === 'off') board.offline();
      else if (verdict) board.verdict(verdict);
    }, CARD_DELAY);
    enqueue(async () => {
      if (status !== 'live') return;
      status = 'finishing';
      const replay = recorder.data(await route);
      const res = await post(`/run/${run}/finish`, { ...result, player: saved.get()?.id ?? null, replay },
        { zip: true }).catch(() => null);
      if (!res?.ok) { off(res?.json?.message ?? 'the climb went missing on the way'); board.offline(); return; }
      status = 'verified';
      verdict = res.json;
      if (board.view === 'result') board.verdict(verdict);
    });
  }

  return {
    board,
    get status() { return status; },
    step(dt, intent) {
      const was = recorder.state;
      recorder.step(dt, intent);
      if (recorder.state === 'done' && was !== 'done') finish();
      if (recorder.state === 'full' && was !== 'full') off('this climb took too long for the board');
    },
  };
}
