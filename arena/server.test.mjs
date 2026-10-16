// The room server over real sockets: who may connect, how many from one address, and stopping when the score server
// beside it is gone. `npm test` in arena/ (node --test); it starts server.mjs on a free port of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import WebSocket from 'ws';

const SITE = 'https://peakmnot.mosredna.eu';

function start(env = {}) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ARENA_ORIGINS: SITE, ...env } });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      const port = String(d).match(/ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
      if (port) resolve({ child, port: Number(port) });
    });
    child.on('exit', code => reject(new Error(`the room server stopped (${code})`)));
  });
}

// A line to the room as a page (or the score server passing one on) opens it: 'open', or the refusal's status.
function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/arena/ws`, { headers: { Origin: SITE, ...headers } });
  const result = new Promise(resolve => {
    ws.once('open', () => resolve('open'));
    ws.once('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.once('error', () => resolve('error'));
  });
  return { ws, result };
}

async function health(port) {
  return (await fetch(`http://127.0.0.1:${port}/arena/health`)).json();
}

const closed = ws => new Promise(resolve => { ws.once('close', resolve); ws.close(); });

test('the site and local pages may connect, others not', async t => {
  const { child, port } = await start();
  t.after(() => child.kill());
  for (const [origin, want] of [[SITE, 'open'], ['http://127.0.0.1:5297', 'open'], ['http://localhost', 'open'],
    ['https://elsewhere.example', 403], ['', 403]]) {
    const { ws, result } = connect(port, { Origin: origin });
    assert.equal(await result, want, origin);
    ws.terminate();
  }
});

test('one address keeps at most four lines open; this computer as many as it likes', async t => {
  const { child, port } = await start();
  t.after(() => child.kill());
  const from = ip => connect(port, { 'X-Forwarded-For': ip });
  const four = [1, 2, 3, 4].map(() => from('203.0.113.7'));
  assert.deepEqual(await Promise.all(four.map(c => c.result)), ['open', 'open', 'open', 'open']);
  assert.equal(await from('203.0.113.7').result, 429);
  // the score server's address on the end of the list is the one that counts; the visitor's own say is ignored
  assert.equal(await from('6.6.6.6, 203.0.113.7').result, 429);
  const other = from('198.51.100.2');
  assert.equal(await other.result, 'open');
  assert.deepEqual(await health(port), { ok: true, playing: 0, watching: 5, bots: 3, max: 12, addresses: 2 });

  await closed(four[0].ws);
  await new Promise(r => setTimeout(r, 50));
  const again = from('203.0.113.7');
  assert.equal(await again.result, 'open');

  const local = [1, 2, 3, 4, 5, 6].map(() => connect(port));
  assert.ok((await Promise.all(local.map(c => c.result))).every(r => r === 'open'));
  for (const c of [...four, other, again, ...local]) c.ws.terminate();
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await health(port)).addresses, 0);
});

test('when the score server beside it is gone, it stops (and Docker starts it again beside the new one)', async t => {
  const knocks = [];
  const beside = net.createServer(socket => { knocks.push(Date.now()); socket.destroy(); });
  await new Promise(r => beside.listen(0, '127.0.0.1', r));
  const { child, port } = await start({ BESIDE: `127.0.0.1:${beside.address().port}` });
  t.after(() => child.kill());
  const stopped = new Promise(resolve => child.once('exit', code => resolve(code)));
  while (!knocks.length) await new Promise(r => setTimeout(r, 100));
  assert.equal((await health(port)).ok, true);
  const gone = Date.now();
  beside.close();
  assert.equal(await stopped, 1);
  const after = (Date.now() - gone) / 1000;
  assert.ok(after > 3 && after < 10, `stopped ${after} s after`);
});
