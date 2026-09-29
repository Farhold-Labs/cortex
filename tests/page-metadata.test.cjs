'use strict';

// Per-route <head> metadata, and robots.txt (v2.105.7).
//
// index.html is built once and serves every route on every node — the same dist
// ships to each instance, which is what makes one build reusable. So it cannot
// name a route or an instance, and it never did: every page of every node
// carried "CORTEX - Secure Wave Communications" and a description about Google
// Wave. Anything reading only the head — a link preview, a crawler, an agent
// with no script runtime — learned nothing about the instance or the event.
//
// This is NOT server-side rendering and these tests do not pretend otherwise:
// the body is still an empty div. What is pinned is what MACHINES read.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

test('the metadata composer', async (t) => {
  const { buildMetadata, classifyPath, injectMetadata } =
    await import('../client/page-metadata.mjs');
  const branding = { instanceName: 'Potter-McKean Players', tagline: 'Small town theater with Broadway spirit' };

  await t.test('it recognises the public routes, with or without a trailing slash', () => {
    assert.deepEqual(classifyPath('/portal'), { kind: 'portal' });
    assert.deepEqual(classifyPath('/portal/'), { kind: 'portal' });
    assert.deepEqual(classifyPath('/events'), { kind: 'events', slug: null, eventId: null });
    assert.deepEqual(classifyPath('/events/'), { kind: 'events', slug: null, eventId: null });
    assert.deepEqual(classifyPath('/events/pmp'), { kind: 'events', slug: 'pmp', eventId: null });
    assert.deepEqual(classifyPath('/events/pmp/event-9'), { kind: 'events', slug: 'pmp', eventId: 'event-9' });
    assert.deepEqual(classifyPath('/waves'), { kind: 'app' });
  });

  await t.test('the events index names the instance, not the platform', () => {
    const m = buildMetadata({ pathname: '/events', branding });
    assert.match(m.title, /Potter-McKean Players/);
    assert.doesNotMatch(m.title, /Secure Wave Communications/);
    assert.match(m.description, /Small town theater/);
  });

  await t.test('a single event names the event, with when and where', () => {
    const m = buildMetadata({
      pathname: '/events/pmp/event-1', branding,
      event: { title: 'Full run: reblock: wet tech', date: '2026-09-29', time: '18:00', endTime: '20:00', location: 'CHS' },
    });
    assert.match(m.title, /^Full run: reblock: wet tech — Potter-McKean Players$/);
    assert.match(m.description, /Tuesday,? 29 September 2026/);
    assert.match(m.description, /18:00–20:00/);
    assert.match(m.description, /at CHS/);
  });

  await t.test('an unknown event degrades instead of inventing detail', () => {
    // A wrong preview is worse than a plain one.
    const m = buildMetadata({ pathname: '/events/pmp/event-gone', branding, event: null });
    assert.match(m.title, /Events — Potter-McKean Players/);
    assert.doesNotMatch(m.description, /undefined|null|NaN|Invalid/);
  });

  await t.test('no branding at all still produces something sane', () => {
    const m = buildMetadata({ pathname: '/events', branding: {} });
    assert.match(m.title, /Cortex/);
    assert.doesNotMatch(m.title, /undefined/);
    assert.doesNotMatch(m.description, /undefined/);
  });

  await t.test('private routes are marked noindex; public ones are not', () => {
    assert.match(buildMetadata({ pathname: '/waves', branding }).tags, /noindex/);
    assert.doesNotMatch(buildMetadata({ pathname: '/events', branding }).tags, /noindex/);
    assert.doesNotMatch(buildMetadata({ pathname: '/portal', branding }).tags, /noindex/);
  });

  await t.test('user-supplied text cannot break out of an attribute', () => {
    const m = buildMetadata({
      pathname: '/events/pmp/e1', branding,
      event: { title: 'Hamlet" onload="alert(1)', date: '2026-10-01', location: '<script>x</script>' },
    });
    assert.doesNotMatch(m.tags, /onload="alert/);
    assert.doesNotMatch(m.tags, /<script>/);
    assert.match(m.tags, /&quot;|&lt;/);
  });

  await t.test('injection replaces the built-in tags rather than duplicating them', () => {
    const html = '<!doctype html><html><head><title>CORTEX - Secure Wave Communications</title>' +
                 '<meta name="description" content="Privacy-first federated communication platform">' +
                 '</head><body><div id="root"></div></body></html>';
    const out = injectMetadata(html, buildMetadata({ pathname: '/events', branding }));
    assert.equal((out.match(/<title>/g) || []).length, 1, 'exactly one title');
    assert.equal((out.match(/name="description"/g) || []).length, 1, 'exactly one description');
    assert.doesNotMatch(out, /Secure Wave Communications/);
    assert.match(out, /id="root"/, 'the body is untouched — this is not SSR');
  });
});

test('the static server serves composed metadata and robots.txt', { timeout: 60000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-meta-'));
  let child, api;
  try {
    // A stand-in API, so the test does not depend on a running Cortex.
    const apiPort = await freePort();
    api = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/instance-config') {
        return res.end(JSON.stringify({
          branding: { instanceName: 'Potter-McKean Players', tagline: 'Small town theater with Broadway spirit' },
          features: { publicPortal: true },
        }));
      }
      if (req.url === '/api/public/events') {
        return res.end(JSON.stringify({ events: [{ id: 'event-1', title: 'Opening night', date: '2026-10-02', time: '19:30', location: 'CHS' }] }));
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise(r => api.listen(apiPort, '127.0.0.1', r));

    const dir = path.join(temp, 'client');
    fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true });
    for (const f of ['serve.mjs', 'page-metadata.mjs']) {
      fs.copyFileSync(path.join(root, 'client', f), path.join(dir, f));
    }
    fs.symlinkSync(path.join(root, 'client/node_modules'), path.join(dir, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(dir, 'dist', 'index.html'),
      '<!doctype html><html><head><title>CORTEX - Secure Wave Communications</title>' +
      '<meta name="description" content="Privacy-first federated communication platform"></head>' +
      '<body><div id="root"></div></body></html>');
    fs.writeFileSync(path.join(dir, 'dist', 'assets', 'index-abc123.js'), 'x');

    const port = await freePort();
    child = spawn(process.execPath, ['serve.mjs'], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', API_ORIGIN: `http://127.0.0.1:${apiPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20000;
    for (;;) {
      if (child.exitCode !== null) throw new Error('exited: ' + output.slice(-1500));
      if (Date.now() > deadline) throw new Error('never answered: ' + output.slice(-1500));
      try { await fetch(base + '/'); break; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.text() }; };

    await t.test('every HTML route gets composed metadata, including /', async () => {
      // `/` was answered by the static middleware until the directory-index
      // lookup was disabled at the level the library actually reads.
      for (const p of ['/', '/events', '/events/', '/portal', '/waves']) {
        const res = await get(p);
        assert.equal(res.status, 200);
        assert.doesNotMatch(res.body, /Secure Wave Communications/, `${p} still carries the built-in title`);
        assert.match(res.body, /Potter-McKean Players/, `${p} should name the instance`);
      }
    });

    await t.test('a named event is looked up and described', async () => {
      const res = await get('/events/pmp/event-1');
      assert.match(res.body, /Opening night/);
      assert.match(res.body, /og:title/);
    });

    await t.test('robots.txt exists, allows the public pages, and points at the API', async () => {
      const res = await get('/robots.txt');
      assert.equal(res.status, 200);
      assert.match(res.body, /Allow: \/events/);
      assert.match(res.body, /Allow: \/portal/);
      assert.match(res.body, /Disallow: \/api\//);
      assert.match(res.body, /api\/public\/events/, 'tell machines where the readable data is');
    });

    await t.test('assets are untouched by any of this', async () => {
      assert.equal((await get('/assets/index-abc123.js')).status, 200);
      assert.equal((await get('/assets/nope-deadbeef.js')).status, 404);
    });
  } finally {
    if (child) child.kill('SIGKILL');
    if (api) await new Promise(r => api.close(r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
