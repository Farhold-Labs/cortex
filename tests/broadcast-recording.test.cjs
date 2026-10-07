'use strict';

// Broadcast recording (v2.110.0): LiveKit Egress → S3-compatible bucket.
//
// One local HTTP server plays both LiveKit (its Twirp API) and the bucket
// (path-style S3), so the real code paths run — starting the egress, settling
// it, posting the ping, streaming byte ranges, deleting, and the trigger that
// queues a deleted wave's recording for removal — without LiveKit or B2.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const BUCKET = 'cortex-recordings';
const VIDEO = crypto.randomBytes(4096); // stands in for the mp4

function fakeUpstream() {
  const state = { egress: new Map(), objects: new Map(), calls: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      // --- LiveKit (Twirp, JSON) ---
      const twirp = /^\/twirp\/livekit\.(\w+)\/(\w+)$/.exec(url.pathname);
      if (twirp) {
        const [, , method] = twirp;
        const data = body ? JSON.parse(body) : {};
        state.calls.push({ method, data });
        const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (method === 'StartRoomCompositeEgress') {
          const egressId = `EG_${crypto.randomBytes(4).toString('hex')}`;
          const key = data.file?.filepath || data.fileOutputs?.[0]?.filepath;
          state.egress.set(egressId, { roomName: data.roomName, key, status: 'EGRESS_ACTIVE' });
          return json({ egressId, roomName: data.roomName, status: 'EGRESS_STARTING' });
        }
        if (method === 'StopEgress') {
          const e = state.egress.get(data.egressId);
          if (e) { e.status = 'EGRESS_COMPLETE'; state.objects.set(`/${BUCKET}/${e.key}`, VIDEO); }
          return json({ egressId: data.egressId, status: 'EGRESS_ENDING' });
        }
        if (method === 'ListEgress') {
          const e = state.egress.get(data.egressId);
          if (!e) return json({ items: [] });
          const done = e.status === 'EGRESS_COMPLETE';
          return json({ items: [{
            egressId: data.egressId, roomName: e.roomName, status: e.status,
            fileResults: done ? [{ filename: e.key, size: String(VIDEO.length), duration: String(95 * 1e9) }] : [],
          }] });
        }
        return json({}); // DeleteRoom, ListParticipants …
      }
      // --- S3, path style ---
      const obj = state.objects.get(url.pathname);
      if (req.method === 'DELETE') { state.objects.delete(url.pathname); state.calls.push({ method: 'S3Delete', key: url.pathname }); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && obj) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (m) {
          const start = +m[1], end = m[2] ? Math.min(+m[2], obj.length - 1) : obj.length - 1;
          res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${obj.length}` });
          return res.end(obj.subarray(start, end + 1));
        }
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': obj.length });
        return res.end(obj);
      }
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code></Error>');
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

test('Broadcast recording', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-recording-'));
  const password = 'Recording123!';
  const upstream = await fakeUpstream();
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
    fs.appendFileSync(path.join(serverDir, 'server.js'), "\nserver.on('listening', () => console.log('API_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-recording-00000000000', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
        LIVEKIT_URL: upstream.url, LIVEKIT_API_KEY: 'APItestkey', LIVEKIT_API_SECRET: 'testsecrettestsecrettestsecret1234',
        FEDERATION_NODE_NAME: 'rec.example.test',
        RECORDING_S3_ENDPOINT: upstream.url, RECORDING_S3_REGION: 'us-test-1', RECORDING_S3_BUCKET: BUCKET,
        RECORDING_S3_ACCESS_KEY: 'testaccess', RECORDING_S3_SECRET_KEY: 'testsecret',
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
    const api = async (method, urlPath, { token, body, stepUp, headers = {} } = {}) => {
      const res = await fetch(base + urlPath, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}), ...headers },
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
    const until = async (fn, ms = 20000) => {
      const end = Date.now() + ms;
      for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 250)); }
    };

    const admin = await makeUser('nodeadmin');
    const performer = await makeUser('performer');
    const viewer = await makeUser('viewer');
    const outsider = await makeUser('outsider');
    const stepUp = (await api('POST', '/api/auth/step-up', { token: admin.token, body: { password } })).body.stepUpToken;
    assert.equal((await api('PUT', '/api/admin/instance-config', { token: admin.token, stepUp, body: { features: { broadcasts: true } } })).status, 200);
    const mkWave = async (title) => { const w = (await api('POST', '/api/waves', { token: performer.token, body: { title, privacy: 'private', participants: [viewer.id] } })).body; return w.id || w.wave?.id; };
    const waveId = await mkWave('Opening Night');

    await t.test('the server says recording is available', async () => {
      const res = await api('GET', '/api/broadcast-capabilities', { token: viewer.token });
      assert.deepEqual(res.body, { recording: true });
    });

    let b;
    await t.test('asking to record does not start it before the camera is up', async () => {
      const res = await api('POST', `/api/waves/${waveId}/broadcasts`, { token: performer.token, body: { title: 'Act One', record: true } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      b = res.body.broadcast;
      assert.equal(b.record, true);
      assert.equal(b.recordingStatus, 'none');
      assert.ok(!upstream.state.calls.some(c => c.method === 'StartRoomCompositeEgress'));
    });

    await t.test('only the performer or wave staff can start it', async () => {
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/recording/start`, { token: viewer.token })).status, 403);
      assert.equal((await api('POST', `/api/broadcasts/${b.id}/recording/start`, { token: outsider.token })).status, 404);
    });

    await t.test('the studio starts it once, into this node\'s prefix', async () => {
      const res = await api('POST', `/api/broadcasts/${b.id}/recording/start`, { token: performer.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.broadcast.recordingStatus, 'recording');
      const again = await api('POST', `/api/broadcasts/${b.id}/recording/start`, { token: performer.token });
      assert.equal(again.status, 200);
      const starts = upstream.state.calls.filter(c => c.method === 'StartRoomCompositeEgress');
      assert.equal(starts.length, 1, 'a retry or second tab must not start a second recording');
      assert.equal(starts[0].data.roomName, `broadcast-${b.id}`);
      const file = starts[0].data.file || starts[0].data.fileOutputs?.[0];
      assert.equal(file.filepath, `rec.example.test/broadcasts/${b.id}.mp4`);
      assert.equal(file.s3.bucket, BUCKET);
    });

    await t.test('nothing to watch while it is still live', async () => {
      const res = await api('GET', `/api/broadcasts/${b.id}/recording`, { token: viewer.token });
      assert.equal(res.body.status, 'recording');
      assert.equal(res.body.streamUrl, null);
    });

    let streamUrl;
    await t.test('ending stops the egress, then it settles and is posted to the wave', async () => {
      const end = await api('POST', `/api/broadcasts/${b.id}/end`, { token: performer.token });
      assert.equal(end.status, 200);
      assert.ok(upstream.state.calls.some(c => c.method === 'StopEgress'));
      const rec = await until(async () => {
        const r = await api('GET', `/api/broadcasts/${b.id}/recording`, { token: viewer.token });
        return r.body.status === 'ready' ? r.body : null;
      });
      assert.equal(rec.size, VIDEO.length);
      assert.equal(rec.durationMs, 95000);
      assert.equal(rec.canDelete, false, 'a viewer cannot delete it');
      assert.match(rec.streamUrl, /^\/api\/recordings\/.+\/stream\?t=/);
      streamUrl = rec.streamUrl;
      const pings = (await api('GET', `/api/waves/${waveId}`, { token: viewer.token })).body;
      const all = JSON.stringify(pings);
      assert.ok(all.includes(`/recording/${b.id}`), 'the ready recording is posted to the wave');
    });

    await t.test('it streams with byte ranges', async () => {
      const full = await fetch(base + streamUrl);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('content-type'), 'video/mp4');
      assert.ok(Buffer.from(await full.arrayBuffer()).equals(VIDEO));
      const part = await fetch(base + streamUrl, { headers: { Range: 'bytes=100-199' } });
      assert.equal(part.status, 206);
      assert.equal(part.headers.get('content-range'), `bytes 100-199/${VIDEO.length}`);
      assert.ok(Buffer.from(await part.arrayBuffer()).equals(VIDEO.subarray(100, 200)));
    });

    await t.test('the stream link is not a login, and is bound to its recording', async () => {
      const t = new URL(base + streamUrl).searchParams.get('t');
      assert.equal((await api('GET', '/api/auth/me', { token: t })).status, 401, 'a recording link must never authenticate');
      assert.equal((await fetch(`${base}/api/recordings/00000000-0000-0000-0000-000000000000/stream?t=${encodeURIComponent(t)}`)).status, 401);
      assert.equal((await fetch(`${base}/api/recordings/${b.id}/stream`)).status, 401);
      assert.equal((await fetch(`${base}/api/recordings/${b.id}/stream?t=${encodeURIComponent(performer.token)}`)).status, 401, 'a session token is not a recording link');
    });

    await t.test('outsiders cannot see it at all', async () => {
      assert.equal((await api('GET', `/api/broadcasts/${b.id}/recording`, { token: outsider.token })).status, 404);
    });

    await t.test('being removed from the wave cuts off a link already handed out', async () => {
      const left = await api('DELETE', `/api/waves/${waveId}/participants/${viewer.id}`, { token: performer.token });
      assert.ok([200, 204].includes(left.status), JSON.stringify(left.body));
      assert.equal((await fetch(base + streamUrl)).status, 404);
    });

    await t.test('the performer deletes it from the bucket', async () => {
      assert.equal((await api('DELETE', `/api/broadcasts/${b.id}/recording`, { token: outsider.token })).status, 404);
      const res = await api('DELETE', `/api/broadcasts/${b.id}/recording`, { token: performer.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.broadcast.recordingStatus, 'deleted');
      assert.ok(!upstream.state.objects.has(`/${BUCKET}/rec.example.test/broadcasts/${b.id}.mp4`));
      const r = await api('GET', `/api/broadcasts/${b.id}/recording`, { token: performer.token });
      assert.equal(r.body.status, 'deleted');
      assert.equal(r.body.streamUrl, null);
    });

    await t.test('deleting a wave queues its recordings for removal', async () => {
      const w2 = await mkWave('Matinee');
      const b2 = (await api('POST', `/api/waves/${w2}/broadcasts`, { token: performer.token, body: { title: 'Matinee', record: true } })).body.broadcast;
      assert.equal((await api('POST', `/api/broadcasts/${b2.id}/recording/start`, { token: performer.token })).status, 200);
      await api('POST', `/api/broadcasts/${b2.id}/end`, { token: performer.token });
      await until(async () => (await api('GET', `/api/broadcasts/${b2.id}/recording`, { token: performer.token })).body?.status === 'ready');
      const del = await api('DELETE', `/api/waves/${w2}`, { token: performer.token });
      assert.ok([200, 204].includes(del.status), JSON.stringify(del.body));
      // Inspect the queue directly — the sweep runs on a 10-minute timer.
      const Database = require(path.join(root, 'server/node_modules/better-sqlite3'));
      const db = new Database(path.join(serverDir, 'data/farhold.db'), { readonly: true });
      const queued = db.prepare('SELECT recording_key FROM recording_deletions').all().map(r => r.recording_key);
      db.close();
      assert.deepEqual(queued, [`rec.example.test/broadcasts/${b2.id}.mp4`]);
    });
  } finally {
    child?.kill('SIGKILL');
    upstream.server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
