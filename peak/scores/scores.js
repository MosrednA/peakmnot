// High scores (server/README.md). When the climb starts the server hands out a run; each checkpoint is reported as
// it's reached; at the summit the recorded climb (replay.js) goes up, the server checks it and says where it ranks,
// and the player may put a name on it. Every request after the first is signed with the run's nonce, which the
// server swaps for a fresh one each time. The card and the Hall of Fame are leaderboard.js. The run and the board
// are every game's (createRun, createBoard): the downhill's peak/downhill/scores.js is on them too.
// ?manual (tests and bots) never talks to the server.
import { Recorder } from './replay.js';
import { routeFingerprint } from './routedata.js';
import { Leaderboard } from './leaderboard.js';

const STORE = 'peakmnot.player';     // { id, secret, name } once the server has given this browser a player, in
                                     // every game: the server knows one player by the same name in all of them
const CARD_DELAY = 2000;             // ms after the summit: the dance has started (moments.js)
const ms = s => Math.round(s * 1000);
const sleep = t => new Promise(resolve => setTimeout(resolve, t));
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

// The dev server on 5280 has the score server next door on 5281 (the downhill's preview on 5293 has one on 5294);
// anywhere else it's behind the same origin. game: 'peak' (the climb) or 'downhill'.
export function apiBase(loc = location, game = 'peak') {
  const dev = { 5280: 5281, 5293: 5294 }[loc.port];
  return dev ? `${loc.protocol}//${loc.hostname}:${dev}/api/${game}` : `/api/${game}`;
}

// localStorage can be missing or throw (private windows, blocked storage): then there's just no "your best".
export const storage = key => ({
  get() { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } },
  set(value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* no memory, no harm */ } },
});
const saved = storage(STORE);

export async function sign(key, bytes) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, bytes));
}

export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A POST to the API: JSON, gzipped if zip (and the browser can), signed with key (the run's nonce) unless it's null.
// A network error is tried again twice: the server answers a retry the same way.
export async function postJson(url, data, { zip = false, key = null } = {}) {
  let body = new TextEncoder().encode(JSON.stringify(data)), type = 'application/json';
  if (zip && typeof CompressionStream === 'function') { body = await gzip(body); type = 'application/gzip'; }
  const headers = { 'Content-Type': type };
  if (key) headers['X-Mnot-Sig'] = await sign(key, body);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body, credentials: 'omit' });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(800 * (attempt + 1));
    }
  }
}

// One request at a time, in order: each one needs the nonce the one before brought back.
export function createQueue() {
  let queue = Promise.resolve();
  return (job) => { const done = queue.then(job); queue = done.catch(() => {}); return done; };
}

// The name this browser's player goes by, for the card's name field.
export const playerName = () => saved.get()?.name ?? '';

// A run on a game's board, from its start to its name: asked for now, each checkpoint reported as it's reached
// (split), the recorded run at the end (finish), and a name on it (claim), in order on enqueue (createQueue()).
// base: apiBase()'s; route: a promise of the route's fingerprint; clock(): the game's clock in seconds, so a slow
// start doesn't look like time travel; words: { game, run, checkpoint } for the console; onOff(run) when the
// board is off for this run. status: 'starting', 'live', 'finishing', 'verified', 'claimed' or 'off'.
export function createRun({ base, enqueue, route, clock, words, onOff = () => {} }) {
  const run = { id: null, nonce: null, status: 'starting', verdict: null };

  async function post(path, data, { zip = false, signed = true } = {}) {
    const res = await postJson(base + path, data, { zip, key: signed ? run.nonce : null });
    if (res.ok && res.json.nonce) run.nonce = res.json.nonce;
    return res;
  }

  run.off = (why) => {
    run.status = 'off';
    if (why) console.info(`${words.game} high scores are off for this ${words.run}: ${why}`);
    onOff(run);
  };

  enqueue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // t0: how far the game's clock had got when this left
        const res = await post('/run', { v: 1, route: await route, t0: ms(clock()) }, { signed: false });
        if (!res.ok) return run.off(res.json.message ?? `the server said ${res.status}`);
        Object.assign(run, { id: res.json.run, nonce: res.json.nonce, status: 'live' });
        return;
      } catch {
        await sleep(1500);
      }
    }
    run.off('the score server is out of reach');
  });

  run.split = (cp, t) => enqueue(async () => {
    if (run.status !== 'live') return;
    const res = await post(`/run/${run.id}/split`, { cp, t }).catch(() => null);
    if (!res?.ok) run.off(res?.json?.message ?? `a ${words.checkpoint} went missing on the way`);
  });

  // result: the numbers the finish sends ({ time, falls, dents } and any of the game's own); replay(): the recorded
  // run, once it's sent. The server's verdict, or null.
  run.finish = (result, replay) => enqueue(async () => {
    if (run.status !== 'live') return null;
    run.status = 'finishing';
    const data = { ...result, player: saved.get()?.id ?? null, replay: await replay() };
    const res = await post(`/run/${run.id}/finish`, data, { zip: true }).catch(() => null);
    if (!res?.ok) { run.off(res?.json?.message ?? `the ${words.run} went missing on the way`); return null; }
    run.status = 'verified';
    run.verdict = res.json;
    return run.verdict;
  });

  run.claim = name => enqueue(async () => {
    if (run.status !== 'verified') return null;
    let me = saved.get();
    let res = await post(`/run/${run.id}/claim`, { name, player: me?.id ?? null, secret: me?.secret ?? null });
    if (res.status === 403 && me) {
      // the server doesn't know this browser's secret (a new key, a restored database): carry on as a new player
      saved.set(null);
      me = null;
      res = await post(`/run/${run.id}/claim`, { name, player: null, secret: null });
    }
    if (res.ok) {
      run.status = 'claimed';
      saved.set({ id: res.json.player, secret: res.json.secret ?? me?.secret, name: res.json.name });
    }
    return res;
  });

  return run;
}

// The card and the Hall of Fame (leaderboard.js) for a game's board: run() is the run a name would go on; words,
// again and isRunActive as Leaderboard takes them.
export function createBoard({ base, run, words, again, isRunActive }) {
  return new Leaderboard({
    words, again, isRunActive,
    load: async (limit) => {
      const me = saved.get()?.id;
      const res = await fetch(`${base}/board?limit=${limit}${me ? `&me=${encodeURIComponent(me)}` : ''}`,
        { credentials: 'omit' });
      return res.ok ? res.json() : null;
    },
    submit: name => run()?.claim(name) ?? Promise.resolve(null),
  });
}

const CLIMB = { game: 'Peak Mnot', run: 'climb', checkpoint: 'checkpoint' };

export function createScores({ player, game, world, manual = false, replayMode = false }) {
  // the Web Crypto API needs a secure context (https or localhost)
  if (manual || replayMode || !globalThis.crypto?.subtle) return { step() {}, status: 'off', board: null };
  const base = apiBase();
  const route = routeFingerprint({ world, player });      // the snapshot is taken now, before the first step
  const enqueue = createQueue();
  let run = null;
  // the card, when it's up: a run that goes off before the server has answered says so there
  const onOff = (r) => { if (board.view === 'result' && !r.verdict) board.offline(); };
  const recorder = new Recorder({ player, game, world,
    onBegin: () => { run = createRun({ base, enqueue, route, clock: () => game.time, words: CLIMB, onOff }); } });

  game.on('checkpoint', (cp) => {
    if (recorder.recording) run?.split(cp.index, ms(game.time));
  });

  const board = createBoard({ base, run: () => run, isRunActive: () => recorder.recording && !game.done });

  // At the summit (the step after it, once the recorder has its last sample): send the climb, show the card.
  function finish() {
    const samples = recorder.samples, last = samples[samples.length - 1];
    const result = { time: last[0], falls: game.falls, dents: recorder.events.filter(e => e[1] === 'dent').length };
    setTimeout(() => {
      board.showResult(result, playerName());
      if (run?.status === 'off') board.offline();
      else if (run?.verdict) board.verdict(run.verdict);
    }, CARD_DELAY);
    run?.finish(result, async () => recorder.data(await route)).then((verdict) => {
      if (verdict && board.view === 'result') board.verdict(verdict);
    });
  }

  return {
    board,
    get status() { return run?.status ?? 'idle'; },
    step(dt, intent) {
      const was = recorder.state;
      recorder.step(dt, intent);
      if (recorder.state === 'done' && was !== 'done') finish();
      if (recorder.state === 'full' && was !== 'full') run?.off('this climb took too long for the board');
    },
  };
}
