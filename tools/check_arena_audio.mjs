// Real Chromium/Web Audio, with a private room and file server on free ports; leaves shared previews alone.
// As check_arena.mjs: PLAYWRIGHT may point to an installed playwright/index.mjs, CHROME to its browser.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
  '.css': 'text/css', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.json': 'application/json', '.png': 'image/png' };
// Windows may allocate ports from 1024 up, including ports Chromium refuses (ERR_UNSAFE_PORT).
const UNSAFE = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080]);

async function listen(server) {
  for (;;) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    if (!UNSAFE.has(server.address().port)) return server;
    await new Promise(r => server.close(r));
  }
}

test('plaza audio: real hooks, distance, crowds, the shared switch, phase and cleanup', async t => {
  const pages = http.createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://local').pathname)));
    let ok = path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT+sep);
    try { ok &&= statSync(path).isFile(); } catch { ok = false; }
    if (!ok) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    createReadStream(path).pipe(res);
  });
  await listen(pages);
  const portProbe = await listen(http.createServer());
  const port = portProbe.address().port;
  await new Promise(r => portProbe.close(r));
  const room = spawn(process.execPath, ['arena/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });
  let browser;
  const errors = [], loads = [];
  try {
    await new Promise((resolve, reject) => {
      room.stdout.on('data', d => { if (String(d).includes('Mnot arena')) resolve(); });
      room.on('exit', code => reject(new Error(`Room stopped: ${code}`)));
    });
    browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
    const context = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('/audio/arena/')) loads.push(r.url()); });
    const base = `http://127.0.0.1:${pages.address().port}`;
    await page.goto(`${base}/arena.html?manual&server=127.0.0.1:${port}`);
    await page.waitForFunction(() => window.arena?.room.connected, null, { timeout: 60000 });
    await t.test('palette and music wait for a gesture; a trusted Join unlocks them', async () => {
      assert.equal(loads.length, 0);
      await page.fill('#join-name', 'Audio can');
      await page.click('#join-go');
      await page.waitForFunction(() => arena.me?.can && arena.music.ready && arena.sfx.ready);
      assert.equal(await page.evaluate(() => arena.sounds.context.state), 'running');
      assert.equal(await page.evaluate(() => arena.music.state.playing), true);
      assert.equal(await page.evaluate(() => arena.sfx.buffers.size), 13);
      assert.equal(await page.evaluate(() => arena.sfx.counts.get('join-self')), 1);
    });
    // No room packets may overwrite the deliberately placed acoustic fixtures below.
    await page.evaluate(() => { arena.net.ws.onmessage = null; });
    await t.test('decoded music and AAC loops retain their lengths and smooth seams', async () => {
      const pcm = await page.evaluate(() => {
        const edge = b => Math.max(...Array.from({ length: b.numberOfChannels }, (_, i) => {
          const x = b.getChannelData(i); return Math.abs(x[0]-x[x.length-1]);
        }));
        return { music: arena.music.buffer.duration, edge: edge(arena.music.buffer),
          loops: ['dance', 'reel'].map(id => ({ id, duration: arena.sfx.buffers.get(id).duration,
            edge: edge(arena.sfx.buffers.get(id)) })) };
      });
      assert.ok(Math.abs(pcm.music-80)<.001 && pcm.edge<.02, JSON.stringify(pcm));
      assert.ok(pcm.loops.every(l => Math.abs(l.duration-2.5)<.001 && l.edge<.04), JSON.stringify(pcm));
    });
    await t.test('all UI and local cues sound, with a strict voice cap', async () => {
      const result = await page.evaluate(() => {
        for (const type of ['join-self', 'join', 'leave', 'idle', 'chat-self', 'chat', 'bump', 'full', 'slow', 'lost', 'back']) {
          arena.sfx.last.clear(); arena.sfx.beginFrame(); arena.sfx.cue(type, 0);
        }
        for (let i=0; i<30; i++) { arena.sfx.last.clear(); arena.sfx.beginFrame(); arena.sfx.cue('bump', 0); }
        return arena.sfx.state;
      });
      for (const id of ['join-self', 'join', 'leave', 'idle', 'chat-self', 'chat', 'bump', 'full', 'slow', 'lost', 'back']) {
        assert.ok(result.counts[id]>0, id);
      }
      assert.ok(result.voices<=12);
      await wait(650);
    });
    await t.test('no distant, invalid or spectator world sounds; nearby chat and departures use real hooks', async () => {
      const counts = await page.evaluate(() => {
        const sfx = arena.sfx, mine = arena.me.can;
        const at = { x: mine.x+1, z: mine.z, y: 0 };
        arena.net.emit('add', { id: 100, name: 'Near can', color: 1 });
        arena.net.emit('add', { id: 101, name: 'Far can', color: 2 });
        arena.shown.set(100, at);
        arena.shown.set(101, { ...at, x: mine.x+8 });
        const before = sfx.counts.get('chat') ?? 0;
        sfx.last.clear(); sfx.beginFrame();
        arena.net.emit('chat', { id: 101, text: 'Too far' });
        for (const distance of [7, 8, -1, NaN, Infinity]) sfx.cue('chat', distance);
        const far = sfx.counts.get('chat') ?? 0;
        arena.net.emit('chat', { id: 100, text: 'Hi nearby' });
        const near = sfx.counts.get('chat') ?? 0;
        sfx.last.clear(); sfx.beginFrame();
        const left = sfx.counts.get('leave') ?? 0;
        arena.net.emit('remove', { id: 100, why: 'left' });
        return { before, far, near, left, departed: sfx.counts.get('leave') ?? 0,
          attenuation: [sfx.level(0), sfx.level(3.5), sfx.level(7)] };
      });
      assert.equal(counts.far, counts.before);
      assert.equal(counts.near, counts.before+1);
      assert.equal(counts.departed, counts.left+1);
      assert.ok(counts.attenuation[0]>counts.attenuation[1] && counts.attenuation[1]>counts.attenuation[2]);
    });
    await t.test('twelve simultaneous chat lines make one blip, even between frames', async () => {
      await wait(300);
      const counts = await page.evaluate(() => {
        const sfx = arena.sfx, before = sfx.counts.get('chat') ?? 0;
        sfx.beginFrame();
        for (let i=0; i<12; i++) { sfx.beginFrame(); sfx.cue('chat', 1); }
        return { before, after: sfx.counts.get('chat') ?? 0 };
      });
      assert.equal(counts.after, counts.before+1);
    });
    await t.test('animation states drive one dance and one reel layer; clearing them stops both', async () => {
      const state = await page.evaluate(() => {
        arena.me.can.emote = 2; arena.me.can.ground = true;
        arena.step(.01, .01);
        const dance = arena.sfx.state.loops.slice();
        arena.me.can.daze = .9;
        arena.step(.01, .01);
        const reel = arena.sfx.state.loops.slice();
        arena.me.can.emote = 0; arena.me.can.daze = 0;
        arena.step(.01, .01);
        return { dance, reel, clear: arena.sfx.state.loops };
      });
      assert.deepEqual(state.dance, ['dance']);
      assert.deepEqual(state.reel, ['reel']);
      assert.deepEqual(state.clear, []);
    });
    await t.test('mute/focus releases voices and resumes the continuing musical phase', async () => {
      const origin = await page.evaluate(() => arena.music.origin);
      await page.evaluate(() => { arena.sfx.update({ reel: 1, dance: 1 }); arena.sounds.setEnabled(false); });
      await wait(160);
      assert.equal(await page.evaluate(() => arena.sfx.voices.size+arena.music.voices.size), 0);
      await page.evaluate(() => arena.sounds.setEnabled(true));
      await page.waitForFunction(() => arena.music.state.playing);
      assert.equal(await page.evaluate(() => arena.music.origin), origin);
      await page.evaluate(() => arena.sounds.pause());
      await wait(160);
      assert.equal(await page.evaluate(() => arena.sfx.voices.size+arena.music.voices.size), 0);
      await page.evaluate(() => arena.sounds.resume());
      await page.waitForFunction(() => arena.music.state.playing);
    });
    await t.test('UI hooks, line lost/back, spectators and disposal', async () => {
      const result = await page.evaluate(() => {
        const sfx = arena.sfx;
        sfx.last.clear(); sfx.beginFrame();
        arena.net.emit('full'); arena.net.emit('slow'); arena.net.emit('idle');
        arena.net.emit('close', { was: true });
        const before = sfx.counts.get('chat') ?? 0;
        arena.net.emit('add', { id: 102, name: 'Watching', color: 3 });
        arena.shown.set(102, { x: 0, z: 0 });
        arena.net.emit('chat', { id: 102, text: 'Spectators hear no world cues' });
        const after = sfx.counts.get('chat') ?? 0;
        arena.net.emit('joined', { id: 103, name: 'Back again' });
        const counts = sfx.state.counts;
        sfx.dispose(); arena.music.dispose();
        return { counts, before, after };
      });
      assert.equal(result.before, result.after);
      for (const id of ['full', 'slow', 'idle', 'lost', 'back']) assert.ok(result.counts[id]>0, id);
      await wait(160);
      assert.equal(await page.evaluate(() => arena.sfx.voices.size+arena.music.voices.size), 0);
      assert.equal(await page.evaluate(() => arena.sfx.error || arena.music.error), null);
      assert.deepEqual(errors, []);
    });
    await context.close();
    await t.test('the production page loads its hashed audio and still joins', async () => {
      const c = await browser.newContext({ viewport: { width: 480, height: 270 } });
      const p = await c.newPage(), failed = [], exceptions = [], assets = [];
      p.on('pageerror', e => exceptions.push(e.message));
      p.on('response', r => { if (r.status()>=400) failed.push(r.url()); });
      p.on('request', r => { if (/\/assets\/(plaza|reel|dance|join-self)-.*\.(mp3|m4a)/.test(r.url())) assets.push(r.url()); });
      try {
        await p.goto(`${base}/dist/arena.html?manual&server=127.0.0.1:${port}`);
        await p.waitForFunction(() => window.arena?.room.connected, null, { timeout: 60000 });
        await p.fill('#join-name', 'Built audio');
        await p.click('#join-go');
        await p.waitForFunction(() => arena.me?.can && arena.sfx.ready && arena.music.ready);
        assert.equal(await p.evaluate(() => arena.sfx.error || arena.music.error), null);
        assert.equal(await p.evaluate(() => arena.music.state.playing), true);
        assert.ok(assets.length>=4, JSON.stringify(assets));
        assert.deepEqual(exceptions, []);
        assert.deepEqual(failed.filter(url => !url.includes('favicon')), []);
      } finally { await c.close(); }
    });
    await t.test('a broken effect codec leaves the room, shared effects and music working', async () => {
      const c = await browser.newContext({ viewport: { width: 480, height: 270 } });
      const p = await c.newPage(), exceptions = [];
      p.on('pageerror', e => exceptions.push(e.message));
      await p.route('**/audio/arena/bump.m4a', r => r.fulfill({ status: 200, body: 'broken audio', contentType: 'audio/mp4' }));
      try {
        await p.goto(`${base}/arena.html?manual&server=127.0.0.1:${port}`);
        await p.waitForFunction(() => window.arena?.room.connected, null, { timeout: 60000 });
        await p.fill('#join-name', 'Codec can');
        await p.click('#join-go');
        await p.waitForFunction(() => arena.me?.can && arena.sfx.error && arena.music.state.playing && arena.sounds.ready);
        const result = await p.evaluate(() => {
          const before = arena.me.can.z;
          arena.drive(0, -1); arena.step(.4, 1/60);
          return { before, after: arena.me.can.z, pending: arena.sfx.pending.length, music: arena.music.error };
        });
        assert.ok(result.after<result.before-.1);
        assert.equal(result.pending, 0);
        assert.equal(result.music, null);
        assert.deepEqual(exceptions, []);
      } finally { await c.close(); }
    });
  } finally {
    await browser?.close();
    room.kill();
    await new Promise(r => pages.close(r));
  }
});
