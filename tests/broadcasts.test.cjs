'use strict';

// Live broadcasts (v2.109.0): one performer, many hidden viewers.
//
// Runs a disposable server with dummy LiveKit credentials — tokens are signed
// locally, so no LiveKit is needed — and decodes the tokens it hands out,
// because the grants inside them ARE the access control: who may publish,
// who is hidden, which room.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const grants = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).video;

test('Live broadcasts', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-broadcast-'));
  const password = 'Broadcast123!';
  let child;
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const dbPath = path.join(serverDir, 'data/farhold.db');
    fs.appendFileSync(path.join(serverDir, 'server.js'), "\nserver.on('listening', () => console.log('API_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-broadcasts-000000000', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
        LIVEKIT_URL: 'wss://livekit.invalid', LIVEKIT_API_KEY: 'APItestkey', LIVEKIT_API_SECRET: 'testsecrettestsecrettestsecret1234',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/API_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/API_TEST_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body, stepUp } = {}) => {
      const res = await fetch(base + urlPath, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null; try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login ${handle}`);
      return { token: login.body.token, id: login.body.user.id };
    };
    const setFeatures = async (features) => {
      const stepUp = (await api('POST', '/api/auth/step-up', { token: admin.token, body: { password } })).body.stepUpToken;
      const res = await api('PUT', '/api/admin/instance-config', { token: admin.token, stepUp, body: { features } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };

    const admin = await makeUser('nodeadmin');
    const performer = await makeUser('performer');
    const viewer = await makeUser('viewer');
    const outsider = await makeUser('outsider');
    const wave = (await api('POST', '/api/waves', { token: performer.token, body: { title: 'Opening Night', privacy: 'private', participants: [viewer.id] } })).body;
    const waveId = wave.id || wave.wave?.id;
    assert.ok(waveId, JSON.stringify(wave));

    await t.test('off until an operator turns it on', async () => {
      const res = await api('POST', `/api/waves/${waveId}/broadcasts`, { token: performer.token, body: { title: 'Act One' } });
      assert.equal(res.status, 403);
      assert.equal(res.body.feature, 'broadcasts');
    });

    let b;
    await t.test('the performer starts a broadcast and holds the only publishing token', async () => {
      await setFeatures({ broadcasts: true });
      const res = await api('POST', `/api/waves/${waveId}/broadcasts`, { token: performer.token, body: { title: 'Act One' } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      b = res.body.broadcast;
      const g = grants(res.body.token);
      assert.equal(g.room, `broadcast-${b.id}`, 'its own room, never the wave call room');
      assert.notEqual(g.room, waveId);
      assert.equal(g.canPublish, true);
      assert.ok(!g.hidden);
      assert.equal(b.publicEnabled, false, 'no public link unless asked for');
    });

    await t.test('one live broadcast per wave', async () => {
      const res = await api('POST', `/api/waves/${waveId}/broadcasts`, { token: viewer.token, body: { title: 'Again' } });
      assert.equal(res.status, 409);
    });

    await t.test('a member watches with a hidden, subscribe-only token', async () => {
      const res = await api('POST', `/api/broadcasts/${b.id}/token`, { token: viewer.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const g = grants(res.body.token);
      assert.equal(g.canPublish, false);
      assert.equal(g.canSubscribe, true);
      assert.equal(g.hidden, true);
      assert.equal(g.room, `broadcast-${b.id}`);
    });

    await t.test('someone outside the wave cannot see or join it', async () => {
      assert.equal((await api('GET', `/api/broadcasts/${b.id}`, { token: outsider.token })).status, 404);
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/token`, { token: outsider.token })).status, 404);
      assert.equal((await api('GET', `/api/waves/${waveId}/broadcast`, { token: outsider.token })).status, 404);
    });

    await t.test('only the performer or wave staff control it', async () => {
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/public-link`, { token: viewer.token, body: { enabled: true } })).status, 403);
      assert.equal((await api('GET', `/api/broadcasts/${b.id}/audience`, { token: viewer.token })).status, 403);
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/end`, { token: viewer.token })).status, 403);
    });

    let link1;
    await t.test('the public link: open, watch as a guest, withdraw, re-open as a NEW link', async () => {
      const on = await api('POST', `/api/broadcasts/${b.id}/public-link`, { token: performer.token, body: { enabled: true } });
      assert.equal(on.status, 200, JSON.stringify(on.body));
      link1 = on.body.broadcast.publicLink.split('/live/')[1];
      const info = await api('GET', `/api/public/broadcasts/${link1}`);
      assert.equal(info.status, 200);
      assert.equal(info.body.broadcast.title, 'Act One');
      const guest = await api('POST', `/api/public/broadcasts/${link1}/token`);
      assert.equal(guest.status, 200);
      const g = grants(guest.body.token);
      assert.equal(g.canPublish, false);
      assert.equal(g.hidden, true);

      const off = await api('POST', `/api/broadcasts/${b.id}/public-link`, { token: performer.token, body: { enabled: false } });
      assert.equal(off.status, 200);
      assert.equal((await api('GET', `/api/public/broadcasts/${link1}`)).status, 404, 'a withdrawn link stops working');
      assert.equal((await api('POST', `/api/public/broadcasts/${link1}/token`)).status, 404);

      const again = await api('POST', `/api/broadcasts/${b.id}/public-link`, { token: performer.token, body: { enabled: true } });
      const link2 = again.body.broadcast.publicLink.split('/live/')[1];
      assert.notEqual(link2, link1, 'withdrawn links never come back to life');
      assert.equal((await api('GET', `/api/public/broadcasts/${link1}`)).status, 404);
      assert.equal((await api('GET', `/api/public/broadcasts/${link2}`)).status, 200);
    });

    await t.test('no public links while public pages are switched off', async () => {
      await setFeatures({ broadcasts: true, publicPortal: false });
      const res = await api('POST', `/api/broadcasts/${b.id}/public-link`, { token: performer.token, body: { enabled: true } });
      assert.equal(res.status, 403);
      const live = (await api('GET', `/api/broadcasts/${b.id}`, { token: performer.token })).body.broadcast.publicLink.split('/live/')[1];
      assert.equal((await api('GET', `/api/public/broadcasts/${live}`)).status, 404, 'an existing link goes dark too');
      await setFeatures({ broadcasts: true, publicPortal: true });
    });

    await t.test('ending it closes everything', async () => {
      const link = (await api('GET', `/api/broadcasts/${b.id}`, { token: performer.token })).body.broadcast.publicLink.split('/live/')[1];
      const end = await api('POST', `/api/broadcasts/${b.id}/end`, { token: performer.token });
      assert.equal(end.status, 200);
      assert.equal(end.body.broadcast.state, 'ended');
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/token`, { token: viewer.token })).status, 410);
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/token`, { token: performer.token })).status, 410);
      assert.equal((await api('GET', `/api/public/broadcasts/${link}`)).status, 404, 'the public link ends with it');
      assert.equal((await api('GET', `/api/waves/${waveId}/broadcast`, { token: viewer.token })).body.broadcast, null);
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/end`, { token: performer.token })).status, 409);
      // and the wave can go live again
      assert.equal((await api('POST', `/api/waves/${waveId}/broadcasts`, { token: performer.token, body: { title: 'Act Two' } })).status, 201);
    });

    await t.test('an event from another wave cannot be attached', async () => {
      const other = (await api('POST', '/api/waves', { token: outsider.token, body: { title: 'Elsewhere', privacy: 'private' } })).body;
      const otherId = other.id || other.wave?.id;
      const ev = (await api('POST', '/api/events', { token: outsider.token, body: { title: 'Their show', eventDate: '2030-01-01', scope: 'wave', waveId: otherId } })).body;
      const eventId = ev.event?.id || ev.id;
      assert.ok(eventId, JSON.stringify(ev));
      // A fresh wave that is not already live, so only the event check can refuse it.
      const fresh = (await api('POST', '/api/waves', { token: performer.token, body: { title: 'Matinee', privacy: 'private' } })).body;
      const freshId = fresh.id || fresh.wave?.id;
      const res = await api('POST', `/api/waves/${freshId}/broadcasts`, { token: performer.token, body: { title: 'Mixup', eventId } });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.error, /does not belong/);
    });
  } finally {
    child?.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
