'use strict';

// WebSocket heartbeat contract (v2.87.1).
//
// The client now treats an unanswered ping as a dead socket and reconnects.
// That is only safe while the server actually answers `{type:'ping'}` with
// `{type:'pong'}` — if that ever regresses, every healthy client would tear
// down and rebuild its connection on a timer, which would look like a network
// problem rather than a broken reply.
//
// Also pins `serverVersion` onto auth_success, which is what drives the
// "new version, refresh" banner.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

test('server answers application-level pings and reports its version on auth', async (t) => {
  const WebSocket = serverRequire('ws');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ws-'));
  const password = 'Heartbeat123!';
  const jwtSecret = 'test-secret-for-ws-heartbeat-only-0000000000';
  let child;

  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') {
        fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
      }
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    db.createUser({
      id: 'beat', handle: 'beat', email: 'beat@example.test',
      passwordHash: serverRequire('bcryptjs').hashSync(password, 4), displayName: 'beat',
    });
    db.db.close();

    fs.appendFileSync(
      path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('WS_TEST_PORT=' + server.address().port));\n"
    );

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: jwtSecret, FEDERATION_ENABLED: 'false',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/WS_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error('Cortex startup failed: ' + output.slice(-4000));
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const port = output.match(/WS_TEST_PORT=(\d+)/)[1];

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'beat', password }),
    });
    const login = await loginRes.json();
    assert.equal(loginRes.status, 200, JSON.stringify(login));
    assert.ok(login.token, 'expected a token');

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const received = [];
    const waitFor = (type, ms = 8000) => new Promise((resolve, reject) => {
      const hit = received.find(m => m.type === type);
      if (hit) return resolve(hit);
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"; saw: ${received.map(m => m.type).join(', ') || 'nothing'}`)),
        ms
      );
      const onMessage = (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === type) { clearTimeout(timer); ws.off('message', onMessage); resolve(msg); }
      };
      ws.on('message', onMessage);
    });

    ws.on('message', (raw) => received.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      setTimeout(() => reject(new Error('websocket never opened')), 8000);
    });

    ws.send(JSON.stringify({ type: 'auth', token: login.token }));
    const auth = await waitFor('auth_success');

    await t.test('auth_success carries the server version', () => {
      assert.match(auth.serverVersion || '', /^\d+\.\d+\.\d+$/);
      assert.equal(auth.serverVersion, serverRequire('./package.json').version);
    });

    await t.test('an application-level ping is answered with a pong', async () => {
      ws.send(JSON.stringify({ type: 'ping' }));
      const pong = await waitFor('pong');
      assert.equal(pong.type, 'pong');
    });

    await t.test('pings keep being answered, not just the first', async () => {
      for (let i = 0; i < 3; i++) {
        const idx = received.length;
        ws.send(JSON.stringify({ type: 'ping' }));
        await new Promise(r => setTimeout(r, 250));
        assert.ok(
          received.slice(idx).some(m => m.type === 'pong'),
          `ping ${i + 1} went unanswered — the client would drop this socket`
        );
      }
    });

    ws.close();
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
