'use strict';

// client/serve.mjs route handling.
//
// Two requirements pull in opposite directions, which is why this needs a test
// rather than a careful read:
//
//   1. Unknown ROUTES must serve the SPA shell, so deep links work. Including
//      with a trailing slash — the client router accepts `/events/` (its pattern
//      ends `\/?$`) and the server has to agree.
//   2. Missing ASSETS must 404, never answer 200 with HTML. That is the v2.60.3
//      incident: the service worker cached index.html as if it were the bundle
//      and permanently bricked clients whose shell referenced a previous build's
//      hashed filenames.
//
// The guard for (2) used to read `req.path`, which serve-static REWRITES when it
// looks for a directory index: `/events/` became `/events/index.html`, the guard
// saw a dot, and a real route 404'd. `/events/` and `/portal/` — both public
// pages — returned "Not found" while `/events` worked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const net = require('node:net');

/** A free port, chosen here because serve.mjs logs the port it was ASKED for —
 *  so PORT=0 would have it announce ":0" and tell us nothing. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const root = path.resolve(__dirname, '..');

/** serve.mjs resolves DIST from its own location, so give it a home. */
function stage(temp) {
  const dir = path.join(temp, 'client');
  fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true });
  // serve.mjs imports page-metadata.mjs, so both have to travel.
  for (const f of ['serve.mjs', 'page-metadata.mjs']) {
    fs.copyFileSync(path.join(root, 'client', f), path.join(dir, f));
  }
  fs.symlinkSync(path.join(root, 'client/node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'),
    '<!doctype html><html><head><title>Cortex</title></head><body><div id="root">' +
    '<!-- server-fallback:start --><div id="initial-loader">ESTABLISHING SIGNAL…</div>' +
    '<!-- server-fallback:end --></div></body></html>');
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'index-abc123.js'), 'console.log("bundle");');
  fs.writeFileSync(path.join(dir, 'dist', 'sw.js'), '// service worker');
  return dir;
}

// No stand-in API is started here, deliberately: this file also proves the
// server behaves when the API is unreachable, which is when metadata degrades to
// something generic rather than the page failing.
test('the static server distinguishes routes from assets', { timeout: 60000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-serve-'));
  let child;
  try {
    const dir = stage(temp);
    const port = await freePort();
    let output = '';
    child = spawn(process.execPath, ['serve.mjs'], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20000;
    for (;;) {
      if (child.exitCode !== null) throw new Error('server exited: ' + output.slice(-2000));
      if (Date.now() > deadline) throw new Error('server never answered: ' + output.slice(-2000));
      try { await fetch(base + '/'); break; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    const get = async (p) => {
      const res = await fetch(base + p);
      return { status: res.status, body: await res.text(), headers: res.headers };
    };

    await t.test('a route with a trailing slash serves the shell', async () => {
      // The bug. Both of these are public pages on a live node.
      for (const p of ['/events/', '/portal/']) {
        const res = await get(p);
        assert.equal(res.status, 200, `${p} must not 404 — the client router accepts it`);
        assert.match(res.body, /id="root"/, `${p} must receive the SPA shell`);
      }
    });

    await t.test('routes without a slash, and nested ones, still work', async () => {
      for (const p of ['/', '/events', '/portal', '/waves', '/events/pmp', '/events/pmp/', '/events/pmp/event-1']) {
        const res = await get(p);
        assert.equal(res.status, 200, `${p} should serve the shell`);
        assert.match(res.body, /id="root"/);
      }
    });

    await t.test('a missing asset 404s — it must NEVER answer 200 with HTML', async () => {
      // v2.60.3: answering a stale hashed filename with index.html let the
      // service worker cache HTML as the bundle and brick clients for good.
      for (const p of ['/assets/index-deadbeef.js', '/assets/nope.css', '/missing.png',
                       '/assets/deep/x.js', '/favicon.ico']) {
        const res = await get(p);
        assert.equal(res.status, 404, `${p} must 404`);
        assert.doesNotMatch(res.body, /id="root"/, `${p} must not be answered with the shell`);
      }
    });

    await t.test('assets that do exist are still served, with their cache headers', async () => {
      const asset = await get('/assets/index-abc123.js');
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('cache-control') || '', /immutable/,
        'hashed filenames are safe to cache forever');

      const sw = await get('/sw.js');
      assert.equal(sw.status, 200);
      assert.match(sw.headers.get('cache-control') || '', /no-cache|no-store/,
        'a cached service worker can stay stale for a day after a deploy');
    });

    await t.test('the shell is never cached, however it is reached', async () => {
      // '/' used to come from the static middleware and now comes from the
      // fallback. Both must say no-cache: the shell names hashed assets.
      for (const p of ['/', '/events', '/events/']) {
        const res = await get(p);
        assert.match(res.headers.get('cache-control') || '', /no-cache|no-store/,
          `${p} returned cacheable HTML`);
      }
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
