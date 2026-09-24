'use strict';

// A revoked session must lose its realtime feed too (v2.105.2).
//
// A WebSocket was authorised once, at the `auth` handshake, and never asked
// again. The heartbeat checked whether the connection was ALIVE, not whether it
// was still ALLOWED, and nothing closed a socket when its session was revoked.
// So:
//
//   * "sign out my other devices" left those devices streaming;
//   * a password change after a compromise left the intruder's socket reading
//     every new message;
//   * refresh-token reuse detection killed the family and the replayed session
//     kept receiving;
//   * unpairing a federation peer left its users' sockets connected.
//
// v2.103.2 (CORTEX-COMM-008) closed the handshake, so a revoked token could not
// OPEN a socket. It did not touch sockets already established, which is the
// half that matters once someone is already in.
//
// Two mechanisms are tested: an immediate close at the revocation site, and a
// periodic revalidation sweep as the net under it — because a hand-maintained
// list of "everywhere authority is withdrawn" is the shape of thing that fell
// behind the schema in v2.105.1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Revocation123!';

test('a revoked session loses its socket', { timeout: 120000 }, async (t) => {
  const WebSocket = serverRequire('ws');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-revoke-'));
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

    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    for (const id of ['local', 'guest', 'pwuser']) {
      seed.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
    }
    // A remote person whose standing is borrowed from a peer we are paired with.
    seed.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                     VALUES ('fed-1', 'their.node', 'https://their.node', 'key', 'active', ?)`)
      .run(new Date().toISOString());
    seed.db.prepare("UPDATE users SET is_cross_port = 1, home_node = 'their.node', home_user_id = 'remote-1' WHERE id = 'guest'").run();
    seed.db.close();

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('REVOKE_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-revocation-00000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'us.example', SEED_DEMO_DATA: 'false',
        // The same sweep, run often enough that the suite is not waiting a minute.
        SOCKET_REVALIDATE_MS: '1500',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/REVOKE_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const port = output.match(/REVOKE_PORT=(\d+)/)[1];
    const base = `http://127.0.0.1:${port}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };

    const login = async (handle) => {
      const res = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(res.status, 200, `login failed for ${handle}: ${JSON.stringify(res.body)}`);
      return res.body.token;
    };

    /** An authenticated socket, with its closure observable. */
    const connect = async (token) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const state = { closed: false, code: null, reason: null, messages: [] };
      ws.on('close', (code, reason) => {
        state.closed = true; state.code = code; state.reason = String(reason || '');
      });
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
        setTimeout(() => reject(new Error('socket never opened')), 8000);
      });
      const authed = new Promise((resolve, reject) => {
        const onMessage = (raw) => {
          const msg = JSON.parse(raw);
          state.messages.push(msg);
          if (msg.type === 'auth_success') { ws.off('message', onMessage); resolve(msg); }
          if (msg.type === 'auth_error') { ws.off('message', onMessage); reject(new Error(msg.error)); }
        };
        ws.on('message', onMessage);
        setTimeout(() => reject(new Error('no auth reply')), 8000);
      });
      ws.send(JSON.stringify({ type: 'auth', token }));
      await authed;
      ws.on('message', (raw) => state.messages.push(JSON.parse(raw)));
      return { ws, state };
    };

    const waitForClose = async (state, ms) => {
      const until = Date.now() + ms;
      while (!state.closed && Date.now() < until) await new Promise(r => setTimeout(r, 50));
      return state.closed;
    };

    await t.test('signing out closes that device\'s socket immediately', async () => {
      const token = await login('local');
      const { state } = await connect(token);
      assert.equal(state.closed, false, 'precondition: the socket is up');

      await api('POST', '/api/auth/logout', { token });
      assert.ok(await waitForClose(state, 5000), 'the socket outlived the session it was authorised by');
      assert.equal(state.code, 1008);
      assert.ok(state.messages.some(m => m.code === 'SESSION_REVOKED'),
        'the client should be told why, not just dropped');
    });

    await t.test('changing the password evicts the other device but not this one', async () => {
      // Its own account: this test changes a password, and a test that leaves
      // the fixture altered for its neighbours produces failures that look like
      // findings. (It did, on the counterfactual run.)
      const staying = await login('pwuser');
      const leaving = await login('pwuser');
      const here = await connect(staying);
      const there = await connect(leaving);

      const changed = await api('POST', '/api/profile/password', {
        token: staying, body: { currentPassword: password, newPassword: 'Revocation456!' },
      });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));

      assert.ok(await waitForClose(there.state, 8000),
        'the whole point of a password change is to evict whoever else is in');
      assert.equal(here.state.closed, false,
        'and it must not sign you out of the device you are sitting at');

      here.ws.close();
    });

    await t.test('unpairing a peer closes its users\' sockets', async () => {
      const token = await login('guest');
      const { state } = await connect(token);
      assert.equal(state.closed, false, 'precondition: a remote member is connected');

      // The operator suspends the pairing. Nothing else happens — no request
      // from that user, no expiry — so only the sweep can notice.
      const side = new DatabaseSQLite({ dbPath });
      side.db.prepare("UPDATE federation_nodes SET status = 'suspended' WHERE node_name = 'their.node'").run();
      side.db.close();

      assert.ok(await waitForClose(state, 20000),
        'a withdrawn pairing has to reach the realtime layer, or unpairing means nothing');
      assert.equal(state.code, 1008);
    });

    await t.test('a withdrawn pairing is also refused on the next ordinary request', async () => {
      // The other half of the same gap: their current access token stayed valid
      // until it expired, which is up to an hour.
      const res = await api('GET', '/api/waves', { token: await (async () => {
        // Re-pair, sign in, then unpair again — a token minted while trusted.
        const side = new DatabaseSQLite({ dbPath });
        side.db.prepare("UPDATE federation_nodes SET status = 'active' WHERE node_name = 'their.node'").run();
        side.db.close();
        const token = await login('guest');
        const side2 = new DatabaseSQLite({ dbPath });
        side2.db.prepare("UPDATE federation_nodes SET status = 'suspended' WHERE node_name = 'their.node'").run();
        side2.db.close();
        return token;
      })() });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'SESSION_REVOKED');
    });

    await t.test('a local user is unaffected by any of it', async () => {
      // The control. A fix that closed sockets too eagerly would pass
      // everything above and disconnect the whole node.
      const token = await login('local');
      const { ws, state } = await connect(token);
      assert.equal((await api('GET', '/api/waves', { token })).status, 200);
      await new Promise(r => setTimeout(r, 2000));
      assert.equal(state.closed, false, 'nothing here should be closing healthy sockets');
      ws.close();
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
