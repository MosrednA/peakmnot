// The arena with several visitors at once, in headless Chromium: node --test tools/check_arena.mjs. It starts its own
// room server (arena/server.mjs) and serves the pages itself, on free ports, so the shared ones aren't touched. Set
// PLAYWRIGHT to Playwright's index.mjs if it isn't installed here, and CHROME to a browser to use instead of
// Playwright's own. Needs the network for three.js and the font.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from '../arena/node_modules/ws/wrapper.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.json': 'application/json' };
const wait = ms => new Promise(r => setTimeout(r, ms));
// the ports past 1023 that Chromium refuses (ERR_UNSAFE_PORT): Windows may hand out free ports from 1024 up
const UNSAFE = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080]);

// on a free port a browser will open
async function listen(server) {
  for (;;) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    if (!UNSAFE.has(server.address().port)) return server;
    await new Promise(r => server.close(r));
  }
}

function files() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__dev_version') {         // the page's live reload asks; nothing changes here
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"version":"check"}');
      return;
    }
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    let ok = path.startsWith(ROOT);
    try { ok &&= statSync(path).isFile(); } catch { ok = false; }
    if (!ok) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return listen(server);
}

// without the bots that keep a lone visitor company, unless asked for
function roomServer(port, bots = 0) {
  const child = spawn(process.execPath, ['arena/server.mjs'],
    { cwd: ROOT, env: { ...process.env, PORT: port, ARENA_BOTS: String(bots) } });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('Mnot arena')) resolve(child); });
    child.on('exit', code => reject(new Error(`room server stopped (${code})`)));
  });
}

async function freePort() {
  const s = await listen(http.createServer());
  const { port } = s.address();
  await new Promise(r => s.close(r));
  return port;
}

test('the arena: joining, walking, chat, emotes, bumps, a full room, leaving, the line lost, the bots', async t => {
  const pages = await files(), port = await freePort();
  let room = await roomServer(port), browser = null;
  const errors = [];
  const base = `http://127.0.0.1:${pages.address().port}/arena.html?server=127.0.0.1:${port}`;
  // A page in, watching. Its warm-up builds every shader, which takes a while here (headless Chromium draws in
  // software, and the pages already open draw on the same processor), most when they show a full room.
  async function visit(query = '') {
    const page = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + query);
    try {
      await page.waitForFunction(() => window.arena?.room.connected && !document.getElementById('join').hidden,
        null, { timeout: 60000 });
    } catch (e) {
      // what the page has, and what the server says
      const state = await page.evaluate(() => ({ arena: !!window.arena, connected: window.arena?.room.connected,
        card: document.getElementById('join')?.hidden, status: document.getElementById('join-status')?.textContent,
        players: window.arena?.room.players.size, snaps: window.arena?.snaps.length,
        ready: window.arena?.net.ws.readyState, me: window.arena?.me?.name }));
      const health = await Promise.race([fetch(`http://127.0.0.1:${port}/arena/health`).then(r => r.text()),
        wait(3000).then(() => 'no answer from the server')]);
      throw new Error(`the page didn't open: ${JSON.stringify(state)} ${health} ${errors.slice(-5).join(' | ')}`);
    }
    return page;
  }
  async function joinAs(page, name) {
    await page.fill('#join-name', name);
    await page.click('#join-go');
    await page.waitForFunction(() => !!window.arena.me?.can);
    return page.evaluate(() => ({ id: arena.me.id, name: arena.me.name }));
  }
  const until = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
  const bots = [];

  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
    const a = await visit(), b = await visit();
    await t.test('a visitor sees the plaza and the join card', async () => {
      assert.match(await b.textContent('#join-status'), /Nobody here yet/);
      const fps = await b.evaluate(() => new Promise(r => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(f)) : r(n));
        requestAnimationFrame(f);
      }));
      t.diagnostic(`${fps} frames a second here, with two pages open`);
    });

    let alpha, beta;
    await t.test('joining gives a can that the others see; a name is one of a kind', async () => {
      alpha = await joinAs(a, 'Alpha');
      assert.equal(alpha.name, 'Alpha');
      await until(b, id => arena.room.players.has(id) && arena.shown.has(id), alpha.id);
      beta = await joinAs(b, 'alpha');
      assert.equal(beta.name, 'alpha 2');
      assert.equal(await a.textContent('#count'), '2/12');
    });

    await t.test('chat goes to everyone, in the log and over the can', async () => {
      await a.keyboard.press('Enter');
      await a.keyboard.type('hallo daar');
      await a.keyboard.press('Enter');
      await until(b, () => document.getElementById('log').textContent.includes('hallo daar'));
      assert.equal(await b.evaluate(id => arena.cans.list.get(id).bubble.textContent, alpha.id), 'hallo daar');
    });

    await t.test('walking: my can answers at once and evenly, the others see it where the server has it', async () => {
      // where my can is drawn, every frame, at the frame's time
      const start = await a.evaluate(() => {
        const root = arena.cans.list.get(arena.me.id).root;
        window.trail = [];
        window.walkFrom = document.timeline.currentTime;
        const f = ts => {
          trail.push([ts, root.position.x, root.position.z]);
          if (trail.length < 300) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
        return arena.me.can.z;
      });
      await a.keyboard.down('KeyS');
      await wait(900);
      await a.keyboard.up('KeyS');
      const moved = await a.evaluate(() => arena.me.can.z);
      assert.ok(start - moved > 1.5, `walked ${start - moved} m`);
      // at full speed (from 0.4 s in), as fast in every frame: no frame ahead of the others, none standing still
      const speeds = await a.evaluate(() => trail.slice(1).map(([ts, x, z], i) => [ts - walkFrom,
        Math.hypot(x - trail[i][1], z - trail[i][2]) / ((ts - trail[i][0]) / 1000)])
        .filter(([at]) => at > 400 && at < 750).map(([, v]) => +v.toFixed(2)));
      assert.ok(speeds.length >= 2 && speeds.every(v => Math.abs(v - 3.2) < 0.15), `m/s a frame: ${speeds}`);
      await wait(600);
      const [mine, seen] = [await a.evaluate(() => ({ ...arena.me.can, offset: arena.me.offset.length() })),
        await b.evaluate(id => ({ ...arena.shown.get(id) }), alpha.id)];
      assert.ok(Math.hypot(mine.x - seen.x, mine.z - seen.z) < 0.03, 'the same place on both pages');
      assert.ok(mine.offset < 0.01, `no correction needed: ${mine.offset}`);
    });

    await t.test('jumping and waving show on the other page', async () => {
      await a.keyboard.press('Space');
      await until(b, id => arena.shown.get(id)?.y > 0.2, alpha.id);
      await wait(900);
      await a.keyboard.press('KeyE');
      await until(b, id => arena.cans.list.get(id).animator.current === 'Wave', alpha.id);
      await b.keyboard.press('KeyQ');
      await until(a, id => arena.cans.list.get(id).animator.current === 'Dance', beta.id);
    });

    await t.test('two cans running into each other both reel, and agree on it', async () => {
      const [pa, pb] = [await a.evaluate(() => ({ ...arena.me.can })), await b.evaluate(() => ({ ...arena.me.can }))];
      const dx = pb.x - pa.x, dz = pb.z - pa.z, d = Math.hypot(dx, dz);
      await a.evaluate(([x, z]) => arena.drive(x, z), [dx / d, dz / d]);
      await b.evaluate(([x, z]) => arena.drive(x, z), [-dx / d, -dz / d]);
      await until(a, n => arena.me.can.bumps > n, pa.bumps);
      await a.evaluate(() => arena.drive(null));
      await b.evaluate(() => arena.drive(null));
      await until(b, () => arena.me.can.bumps > 0);
      await wait(1500);
      const [ma, mb] = [await a.evaluate(() => ({ ...arena.me.can })), await b.evaluate(() => ({ ...arena.me.can }))];
      const seen = await b.evaluate(id => ({ ...arena.shown.get(id) }), alpha.id);
      assert.equal(seen.bumps, ma.bumps, 'the bump counted the same on both pages');
      assert.ok(Math.hypot(ma.x - mb.x, ma.z - mb.z) > 0.7, 'apart again');
    });

    await t.test('far from the server (?lag=200), my can still answers at once and lands where the server says',
      async () => {
        const c = await visit('&lag=200');
        const charlie = await joinAs(c, 'Charlie');
        await c.evaluate(() => {
          window.worst = 0;
          setInterval(() => { worst = Math.max(worst, arena.me?.offset.length() ?? 0); }, 20);
        });
        const start = await c.evaluate(() => ({ ...arena.me.can }));
        await c.evaluate(() => arena.drive(0.6, -0.8));
        await wait(150);
        const early = await c.evaluate(() => ({ ...arena.me.can }));
        assert.ok(Math.hypot(early.x - start.x, early.z - start.z) > 0.15, 'moving before the server has heard');
        await wait(700);
        await c.evaluate(() => arena.drive(null));
        await wait(900);
        const [mine, seen] = [await c.evaluate(() => ({ ...arena.me.can, worst })),
          await a.evaluate(id => ({ ...arena.shown.get(id) }), charlie.id)];
        assert.ok(Math.hypot(mine.x - seen.x, mine.z - seen.z) < 0.03, 'the same place on both pages');
        assert.ok(mine.worst < 0.05, `corrections stayed small: ${mine.worst}`);
        await c.close();
        await until(a, id => !arena.room.players.has(id), charlie.id);
      });

    await t.test('twelve is full: a thirteenth watches, and gets in when a spot frees up', async () => {
      for (let i = 0; i < 10; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/arena/ws`, { origin: 'http://127.0.0.1' });
        await new Promise(r => ws.on('open', r));
        ws.send(JSON.stringify({ t: 'join', name: `Filler ${i}` }));
        bots.push(ws);
      }
      const d = await visit();
      await until(d, () => document.getElementById('count').textContent === '12/12');
      assert.equal(await d.isDisabled('#join-go'), true);
      assert.match(await d.textContent('#join-status'), /Full/);
      bots.pop().close();
      await until(d, () => !document.getElementById('join-go').disabled);
      await joinAs(d, 'Delta');
      await d.close();
    });

    await t.test('leaving: back to watching, and gone for the others', async () => {
      await a.click('#leave');
      await until(b, id => !arena.room.players.has(id), alpha.id);
      await until(a, () => !document.getElementById('join').hidden && !arena.me);
    });

    await t.test('the line drops and comes back: in again with the same name', async () => {
      room.kill();
      await until(b, () => !arena.room.connected && !arena.me);
      room = await roomServer(port);
      await until(b, () => arena.me?.name === 'alpha 2', null, 15000);
    });

    await t.test('alone, three bots keep me company, and one makes room for each person more', async () => {
      room.kill();
      await until(b, () => !arena.room.connected);
      room = await roomServer(port, 3);
      await until(b, () => arena.me?.name === 'alpha 2', null, 15000);
      const botsOn = page => page.evaluate(() => [...arena.room.players.values()].filter(p => p.bot).map(p => p.id));
      await until(a, () => arena.room.connected && arena.room.players.size === 4, null, 15000);
      const ids = await botsOn(a);
      assert.equal(ids.length, 3);
      assert.equal(await a.textContent('#count'), '1/12');
      assert.match(await a.textContent('#join-status'), /1 of 12 cans on the plaza, and 3 bots/);
      const where = () => a.evaluate(list => list.map(id => ({ ...arena.shown.get(id) })), ids);
      const from = await where();
      await wait(2000);
      const to = await where();
      assert.ok(to.some((p, i) => Math.hypot(p.x - from[i].x, p.z - from[i].z) > 0.3), 'they walk about');
      await joinAs(a, 'Alpha');
      await until(b, () => [...arena.room.players.values()].filter(p => p.bot).length === 2);
      await until(b, () => document.getElementById('log').textContent.includes('made room'));
      assert.equal(await b.textContent('#count'), '2/12');
    });

    assert.deepEqual(errors.filter(e => !/ERR_CONNECTION_REFUSED|WebSocket/.test(e)), []);
  } finally {
    for (const ws of bots) ws.close();
    await browser?.close();
    room.kill();
    pages.close();
  }
});
