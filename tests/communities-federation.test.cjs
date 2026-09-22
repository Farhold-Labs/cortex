'use strict';

// Communities Phase 4 — remote membership, across two real nodes (v2.97.0).
//
// Two servers are started, paired as federation peers, and a person with an
// account on one is made a member of a Community on the other by running the
// actual cross-port handshake: initiate -> approve at home -> server-to-server
// exchange -> session. Nothing is simulated except the browser redirect, which
// is a URL the test follows itself.
//
// Per implementation plan §2 there is NO state replication here: a Community
// lives on one node and its members come from many. So the work being tested is
// authorization and lifecycle for a person with no local account, not consensus.
//
// The case that matters most is the last one. Rights held here by a remote
// member are BORROWED from their home node, and when the lender withdraws —
// the node is suspended or unpaired — they have to be given back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

test('Communities across two federated nodes', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fed-comm-'));
  const password = 'FederatedCommunities1!';
  const children = [];

  try {
    const portA = await freePort();
    const portB = await freePort();
    const nodeA = `127.0.0.1:${portA}`;   // home node — where Alice has her account
    const nodeB = `127.0.0.1:${portB}`;   // guest node — where the Community lives

    const keys = {};
    for (const name of [nodeA, nodeB]) {
      keys[name] = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
    }

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');

    // Build a node: copy the server, seed its identity and its peer, start it.
    const buildNode = async (selfName, selfPort, peerName, peerPort) => {
      const dir = path.join(temp, selfName.replace(/[.:]/g, '_'));
      fs.mkdirSync(dir);
      for (const name of fs.readdirSync(path.join(root, 'server'))) {
        if (/\.(js|sql)$/.test(name) || name === 'package.json') {
          fs.copyFileSync(path.join(root, 'server', name), path.join(dir, name));
        }
      }
      fs.cpSync(path.join(root, 'server/lib'), path.join(dir, 'lib'), { recursive: true });
      fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(dir, 'node_modules'), 'dir');
      fs.mkdirSync(path.join(dir, 'data'));

      // Seed identity and pairing BEFORE boot, so the servers come up already
      // federated rather than needing an admin to pair them mid-test.
      const db = new DatabaseSQLite({ dbPath: path.join(dir, 'data/farhold.db') });
      db.setServerIdentity({
        nodeName: selfName,
        publicKey: keys[selfName].publicKey,
        privateKey: keys[selfName].privateKey,
      });
      db.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                     VALUES (?, ?, ?, ?, 'active', ?)`)
        .run(`peer-${peerPort}`, peerName, `http://${peerName}`, keys[peerName].publicKey,
             new Date().toISOString());
      // Communities is opt-in from v2.99.0; switch it on before boot so these
      // tests exercise remote membership rather than the feature gate.
      db.updateInstanceConfig({ features: { communities: true } });
      db.db.close();

      fs.appendFileSync(path.join(dir, 'server.js'),
        `\nserver.on('listening', () => console.log('NODE_READY=${selfPort}'));\n`);

      let out = '';
      const child = spawn(process.execPath, ['server.js'], {
        cwd: dir,
        env: {
          PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(selfPort),
          USE_SQLITE: 'true', JWT_SECRET: `test-secret-federated-communities-${selfPort}`,
          SEED_DEMO_DATA: 'false', FEDERATION_ENABLED: 'true',
          FEDERATION_NODE_NAME: selfName, APP_BASE_URL: `http://${selfName}`,
          RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      child.stdout.on('data', b => { out += b; });
      child.stderr.on('data', b => { out += b; });

      const deadline = Date.now() + 25000;
      while (!out.includes(`NODE_READY=${selfPort}`)) {
        if (child.exitCode !== null || Date.now() > deadline) {
          throw new Error(`${selfName} failed to start: ` + out.slice(-3000));
        }
        await new Promise(r => setTimeout(r, 50));
      }
      return { name: selfName, url: `http://127.0.0.1:${selfPort}`, dir };
    };

    const A = await buildNode(nodeA, portA, nodeB, portB);
    const B = await buildNode(nodeB, portB, nodeA, portA);

    const call = async (node, method, urlPath, { token, body } = {}) => {
      const res = await fetch(node.url + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };

    const register = async (node, handle) => {
      await call(node, 'POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await call(node, 'POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed on ${node.name}: ${JSON.stringify(login.body)}`);
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    // Alice lives on A. Bob runs a Community on B and has never met her node's users.
    await register(A, 'nodeadmin_a');
    const alice = await register(A, 'alice');
    await register(B, 'nodeadmin_b');
    const bob = await register(B, 'bob');

    const community = (await call(B, 'POST', '/api/communities', {
      token: bob.token, body: { name: 'Allied Productions', slug: 'allied', visibility: 'private' },
    })).body.community;
    assert.ok(community, 'community created on B');

    /** Run the real cross-port handshake and return Alice's credentials on B. */
    const signInCrossPort = async () => {
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      const redirect = new URL(initiate.body.redirectUrl);
      const approve = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          callbackUrl: redirect.searchParams.get('callback'),
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      const session = await call(B, 'POST', '/api/cross-port/session', {
        body: {
          code: new URL(approve.body.callbackUrl).searchParams.get('code'),
          state: redirect.searchParams.get('nonce'),
          homeServerUrl: A.url,
        },
      });
      assert.equal(session.status, 200, `re-login failed: ${JSON.stringify(session.body)}`);
      return { token: session.body.token, id: session.body.user.id, refreshToken: session.body.refreshToken };
    };

    await t.test('an invitation may only be addressed into a federated peer', async () => {
      const stranger = await call(B, 'POST', `/api/communities/${community.id}/members/remote`, {
        token: bob.token, body: { address: 'someone@not-a-peer.example' },
      });
      assert.equal(stranger.status, 403,
        'an arbitrary hostname would make the invitation table a free-text store keyed by attacker input');

      const malformed = await call(B, 'POST', `/api/communities/${community.id}/members/remote`, {
        token: bob.token, body: { address: 'no-at-sign' },
      });
      assert.equal(malformed.status, 400);
    });

    await t.test('an invitation cannot be addressed to an administrative role', async () => {
      const roles = (await call(B, 'GET', `/api/communities/${community.id}/roles`, { token: bob.token })).body.roles;
      const res = await call(B, 'POST', `/api/communities/${community.id}/members/remote`, {
        token: bob.token,
        body: { address: `alice@${nodeA}`, roleId: roles.find(r => r.name === 'admin').id },
      });
      assert.equal(res.status, 403, 'an address is no more entitled to confer admin than a link is');
    });

    await t.test('an invitation waits for someone who has no local account yet', async () => {
      const res = await call(B, 'POST', `/api/communities/${community.id}/members/remote`, {
        token: bob.token, body: { address: `alice@${nodeA}` },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.invitation.state, 'pending');

      // Nothing has been granted and no account has been created on the
      // strength of a name — the address is not a person yet.
      const members = (await call(B, 'GET', `/api/communities/${community.id}/members`, { token: bob.token }))
        .body.members;
      assert.equal(members.length, 1, 'only Bob is a member so far');
    });

    let aliceOnB;
    await t.test('the real cross-port handshake makes Alice a member of a Community on B', async () => {
      // 1. B starts the flow and produces the URL Alice's browser would follow.
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', {
        body: { homeServerUrl: A.url },
      });
      assert.equal(initiate.status, 200, JSON.stringify(initiate.body));
      const redirect = new URL(initiate.body.redirectUrl);
      const requestId = redirect.searchParams.get('request_id');
      const nonce = redirect.searchParams.get('nonce');
      const callbackUrl = redirect.searchParams.get('callback');

      // 2. Alice approves, at home, as herself.
      const approve = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: { guestNode: nodeB, callbackUrl, nonce, requestId },
      });
      assert.equal(approve.status, 200, JSON.stringify(approve.body));
      const code = new URL(approve.body.callbackUrl).searchParams.get('code');

      // 3. B exchanges the code with A server-to-server (signed), then issues a
      //    local session. This is the step that creates Alice's stub row on B.
      const session = await call(B, 'POST', '/api/cross-port/session', {
        body: { code, state: nonce, homeServerUrl: A.url },
      });
      assert.equal(session.status, 200, JSON.stringify(session.body));
      assert.equal(session.body.user.isCrossPort, true);
      aliceOnB = { token: session.body.token, id: session.body.user.id };

      // 4. The invitation bound on arrival: she is a member, without anyone on
      //    B ever touching her account.
      const mine = await call(B, 'GET', '/api/communities/mine', { token: aliceOnB.token });
      assert.equal(mine.status, 200);
      assert.deepEqual(mine.body.communities.map(c => c.slug), ['allied'],
        'the pending invitation was redeemed by her arrival');
    });

    await t.test('she holds member powers on B and no more', async () => {
      const detail = await call(B, 'GET', `/api/communities/${community.id}`, { token: aliceOnB.token });
      assert.equal(detail.status, 200);
      assert.ok(detail.body.capabilities.includes('channel.create_wave'));
      assert.ok(!detail.body.capabilities.includes('member.ban'));
      assert.ok(!detail.body.capabilities.includes('community.manage'));

      // And she cannot restructure the place she has just joined.
      const denied = await call(B, 'POST', `/api/communities/${community.id}/channels`, {
        token: aliceOnB.token, body: { name: 'Mine', slug: 'mine' },
      });
      assert.equal(denied.status, 403);
    });

    await t.test('a remote member is visibly remote in the member list', async () => {
      const members = (await call(B, 'GET', `/api/communities/${community.id}/members`, { token: bob.token }))
        .body.members;
      const remote = members.find(m => m.userId === aliceOnB.id);
      assert.ok(remote, 'she is listed');
      assert.equal(remote.isCrossPort, true);
      assert.equal(remote.homeNode, nodeA, 'an operator can see whose user this actually is');
    });

    await t.test('binding is idempotent — a second login does not duplicate anything', async () => {
      const before = (await call(B, 'GET', `/api/communities/${community.id}/members`, { token: bob.token }))
        .body.members.length;

      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      const redirect = new URL(initiate.body.redirectUrl);
      const approve = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          callbackUrl: redirect.searchParams.get('callback'),
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      const code = new URL(approve.body.callbackUrl).searchParams.get('code');
      const again = await call(B, 'POST', '/api/cross-port/session', {
        body: { code, state: redirect.searchParams.get('nonce'), homeServerUrl: A.url },
      });
      assert.equal(again.status, 200);

      const after = (await call(B, 'GET', `/api/communities/${community.id}/members`, { token: bob.token }))
        .body.members;
      assert.equal(after.length, before, 'no duplicate membership');
      assert.equal(after.filter(m => m.userId === aliceOnB.id).length, 1);
    });

    // ----- The borrowed-rights case -----

    // ----- Cross-port session renewal (v2.100.0) -----

    await t.test('a cross-port session is renewable, not a 24-hour dead end', async () => {
      // It used to be 24 hours with no refresh token at all, so a remote member
      // re-ran the whole approve-at-home redirect daily.
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      const redirect = new URL(initiate.body.redirectUrl);
      const approve = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          callbackUrl: redirect.searchParams.get('callback'),
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      const session = await call(B, 'POST', '/api/cross-port/session', {
        body: {
          code: new URL(approve.body.callbackUrl).searchParams.get('code'),
          state: redirect.searchParams.get('nonce'),
          homeServerUrl: A.url,
        },
      });
      assert.equal(session.status, 200);
      assert.ok(session.body.refreshToken, 'a refresh token is issued, which it never used to be');

      const refreshed = await call(B, 'POST', '/api/auth/token/refresh', {
        body: { refreshToken: session.body.refreshToken },
      });
      assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
      assert.ok(refreshed.body.token, 'and renewing works without going back to the home node by hand');
      aliceOnB = { token: refreshed.body.token, id: session.body.user.id, refreshToken: refreshed.body.refreshToken };
    });

    await t.test('a renewal cannot outlive the member standing at home', async () => {
      // The reason those sessions were short and non-renewable. Suspending
      // Alice AT HOME must stop the guest node renewing her, and it is the home
      // node's answer that decides — nothing the client presents can override it.
      //
      // Disabling rather than deleting, because it is reversible and because it
      // is the realistic case: an operator suspends an account far more often
      // than they erase one.
      const dbA = new DatabaseSQLite({ dbPath: path.join(A.dir, 'data/farhold.db') });
      dbA.db.prepare("UPDATE users SET account_status = 'disabled' WHERE handle = 'alice'").run();
      dbA.db.close();

      // Force the guest to re-ask rather than trust its cached answer.
      const dbB1 = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
      dbB1.db.prepare('UPDATE users SET cross_port_verified_at = ? WHERE id = ?')
        .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), aliceOnB.id);
      dbB1.db.close();

      const denied = await call(B, 'POST', '/api/auth/token/refresh', {
        body: { refreshToken: aliceOnB.refreshToken },
      });
      assert.equal(denied.status, 401, 'the home node said no, so the renewal must fail');
      assert.equal(denied.body.code, 'SESSION_REVOKED');
      // The MESSAGE matters: it separates "your home node declined" from "your
      // home node could not be reached". Accepting the latter would mean the
      // test proved the grace window rather than the revocation.
      assert.match(denied.body.error, /no longer authorises/,
        `expected a decline, got: ${denied.body.error}`);

      // Restore her standing at home.
      const dbA2 = new DatabaseSQLite({ dbPath: path.join(A.dir, 'data/farhold.db') });
      dbA2.db.prepare("UPDATE users SET account_status = 'active' WHERE handle = 'alice'").run();
      dbA2.db.close();
    });

    await t.test('a fresh sign-in works again afterwards', async () => {
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      const redirect = new URL(initiate.body.redirectUrl);
      const approve = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          callbackUrl: redirect.searchParams.get('callback'),
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      const session = await call(B, 'POST', '/api/cross-port/session', {
        body: {
          code: new URL(approve.body.callbackUrl).searchParams.get('code'),
          state: redirect.searchParams.get('nonce'),
          homeServerUrl: A.url,
        },
      });
      assert.equal(session.status, 200, JSON.stringify(session.body));
      aliceOnB = { token: session.body.token, id: session.body.user.id, refreshToken: session.body.refreshToken };
    });

    await t.test('CORTEX-COMM-003: the legacy renewal route also asks the home node', async () => {
      // v2.100.0 gated /api/auth/token/refresh and stopped there. This route
      // mints a session too, so a person banned at home could simply renew here
      // instead and keep their Community authority for as long as their peer
      // stayed paired. A revocation control with a second door beside it is not
      // a revocation control.
      const dbA = new DatabaseSQLite({ dbPath: path.join(A.dir, 'data/farhold.db') });
      dbA.db.prepare("UPDATE users SET account_status = 'disabled' WHERE handle = 'alice'").run();
      dbA.db.close();

      const dbB = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
      dbB.db.prepare('UPDATE users SET cross_port_verified_at = ? WHERE id = ?')
        .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), aliceOnB.id);
      dbB.db.close();

      const renewed = await call(B, 'POST', '/api/auth/renew', { token: aliceOnB.token, body: {} });
      assert.equal(renewed.status, 401, 'renewing after a home ban must fail');
      assert.equal(renewed.body.code, 'SESSION_REVOKED');
      assert.match(renewed.body.error, /no longer authorises/,
        `expected a decline, got: ${renewed.body.error}`);

      // And the session it was renewing is gone, not merely un-renewed.
      const after = await call(B, 'GET', '/api/communities/mine', { token: aliceOnB.token });
      assert.equal(after.status, 401, 'the old token is revoked too');

      const dbA2 = new DatabaseSQLite({ dbPath: path.join(A.dir, 'data/farhold.db') });
      dbA2.db.prepare("UPDATE users SET account_status = 'active' WHERE handle = 'alice'").run();
      dbA2.db.close();

      // This test does its job by ending Alice's session, so the tests after it
      // need her signed in again.
      aliceOnB = await signInCrossPort();
    });

    await t.test('CORTEX-COMM-002: the approval code goes to the peer, not to a supplied URL', async () => {
      // An attacker sends someone an approval link naming a genuinely trusted
      // guest node — so the page says the reassuring thing — while pointing the
      // callback at themselves. Checking the NODE is trusted says nothing about
      // where the code is being sent.
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      const redirect = new URL(initiate.body.redirectUrl);

      const hijacked = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          callbackUrl: 'http://127.0.0.1:9/stolen',   // a trusted node named, an untrusted destination
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      assert.equal(hijacked.status, 200, 'the request still succeeds');
      assert.equal(new URL(hijacked.body.callbackUrl).origin, `http://${nodeB}`,
        'but the code goes to the registered peer, not to the supplied URL');
      assert.ok(!hijacked.body.callbackUrl.includes('stolen'),
        'the attacker destination is not honoured');

      // Omitting it entirely is fine — the peer record knows where to send it.
      const derived = await call(A, 'POST', '/api/cross-port/approve', {
        token: alice.token,
        body: {
          guestNode: nodeB,
          nonce: redirect.searchParams.get('nonce'),
          requestId: redirect.searchParams.get('request_id'),
        },
      });
      assert.equal(derived.status, 200, JSON.stringify(derived.body));
      assert.equal(new URL(derived.body.callbackUrl).origin, `http://${nodeB}`,
        'and it points at the registered peer');
      assert.ok(new URL(derived.body.callbackUrl).searchParams.get('code'));
    });

    await t.test('CORTEX-COMM-008: a revoked session cannot open a socket', async () => {
      // Revocation the realtime layer ignores is not revocation; it just takes
      // the slow door. The socket used to check the signature and the account
      // status and stop there.
      const WebSocket = require(path.join(root, 'server/node_modules/ws'));
      const fresh = await signInCrossPort();

      const openSocket = (token) => new Promise((resolve) => {
        const ws = new WebSocket(B.url.replace('http://', 'ws://'));
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(v); } };
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
        ws.on('message', (raw) => {
          let m; try { m = JSON.parse(raw); } catch { return; }
          if (m.type === 'auth_success') done({ authed: true });
          if (m.type === 'auth_error') done({ authed: false, code: m.code });
        });
        ws.on('error', () => done({ authed: false, code: 'SOCKET_ERROR' }));
        setTimeout(() => done({ authed: false, code: 'TIMEOUT' }), 6000);
      });

      const before = await openSocket(fresh.token);
      assert.equal(before.authed, true, 'precondition: a live session authenticates');

      // End the session the ordinary way.
      const out = await call(B, 'POST', '/api/auth/logout', { token: fresh.token });
      assert.ok([200, 204].includes(out.status), `logout failed: ${out.status}`);

      const after = await openSocket(fresh.token);
      assert.equal(after.authed, false, 'a revoked token must not open a socket');

      aliceOnB = await signInCrossPort();
    });

    await t.test('CORTEX-COMM-001: a peer cannot claim another peer\'s identities', async () => {
      // The audit's critical finding. A malicious peer M, merely paired with B,
      // answers the code exchange with a user id in honest peer A's namespace.
      // Because the stub row is keyed on (home_node, home_user_id), B used to
      // hand M a session on ALICE's existing row — and every Community role
      // attached to it. The home-node standing check did not help: it reads the
      // same home_node the attacker supplied.
      //
      // Rather than stand up a third server, this drives B's own session
      // endpoint against a stand-in peer that answers the exchange with A's
      // namespace. What is under test is B's handling of that answer.
      const evil = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const aliceOnA = await (async () => {
        const dbA = new DatabaseSQLite({ dbPath: path.join(A.dir, 'data/farhold.db') });
        const row = dbA.db.prepare('SELECT id FROM users WHERE handle = ?').get('alice');
        dbA.db.close();
        return row.id;
      })();

      // A peer that answers the exchange claiming A's namespace.
      const rogue = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            userId: aliceOnA,        // Alice's id, on A
            homeNode: nodeA,         // and she is claimed to be A's user
            handle: 'alice',
            displayName: 'Alice',
            avatar: 'A',
          }));
        });
      });
      await new Promise(r => rogue.listen(0, '127.0.0.1', r));
      const roguePort = rogue.address().port;
      const rogueName = `127.0.0.1:${roguePort}`;

      try {
        // M is an ordinary active peer of B. That is the only prerequisite.
        const dbB = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
        dbB.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                        VALUES (?, ?, ?, ?, 'active', ?)`)
          .run('fed-rogue', rogueName, `http://${rogueName}`, evil.publicKey, new Date().toISOString());
        const aliceStub = dbB.db.prepare(
          'SELECT id FROM users WHERE is_cross_port = 1 AND home_node = ?').get(nodeA);
        dbB.db.close();
        assert.ok(aliceStub, 'precondition: Alice already has a stub on B');

        const initiate = await call(B, 'POST', '/api/cross-port/initiate', {
          body: { homeServerUrl: `http://${rogueName}` },
        });
        assert.equal(initiate.status, 200, JSON.stringify(initiate.body));
        const nonce = new URL(initiate.body.redirectUrl).searchParams.get('nonce');

        const stolen = await call(B, 'POST', '/api/cross-port/session', {
          body: { code: 'anything', state: nonce, homeServerUrl: `http://${rogueName}` },
        });

        assert.notEqual(stolen.status, 200,
          'a peer claiming another peer\'s namespace must never get a session');
        assert.equal(stolen.status, 403);

        // And nothing was created or rebound under the victim's identity.
        const dbAfter = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
        const stubs = dbAfter.db.prepare(
          'SELECT id, home_node FROM users WHERE is_cross_port = 1').all();
        dbAfter.db.close();
        assert.equal(stubs.filter(u => u.home_node === nodeA).length, 1,
          'Alice still has exactly one identity, and it belongs to her node');
        assert.ok(!stubs.some(u => u.home_node === rogueName),
          'and the rogue peer did not acquire one by the attempt');
      } finally {
        await new Promise(r => rogue.close(r));
      }
    });

    await t.test('suspending her home node withdraws her Community access', async () => {
      // Rights held here were borrowed from the relationship with her node.
      // Before v2.97.0 nothing checked this: her stub row behaved like a local
      // account forever, so unpairing the node that vouched for her left her
      // membership fully intact.
      assert.equal((await call(B, 'GET', `/api/communities/${community.id}`,
        { token: aliceOnB.token })).status, 200, 'precondition: she can see it');

      const dbB = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
      dbB.db.prepare("UPDATE federation_nodes SET status = 'suspended' WHERE node_name = ?").run(nodeA);
      dbB.db.close();

      const after = await call(B, 'GET', `/api/communities/${community.id}`, { token: aliceOnB.token });
      assert.equal(after.status, 200, 'the Community row is still visible to her session');
      assert.deepEqual(after.body.capabilities, [],
        'but she holds no capabilities once her node is no longer vouching for her');

      const blocked = await call(B, 'GET', `/api/communities/${community.id}/members`,
        { token: aliceOnB.token });
      assert.equal(blocked.status, 403, 'and gated endpoints refuse her');

      const mine = await call(B, 'GET', '/api/communities/mine', { token: aliceOnB.token });
      assert.ok(mine.status === 200, 'membership rows survive — this is a suspension, not a deletion');
    });

    await t.test('restoring the pairing restores her standing', async () => {
      // Suspension must be reversible without an admin re-inviting everybody.
      const dbB = new DatabaseSQLite({ dbPath: path.join(B.dir, 'data/farhold.db') });
      dbB.db.prepare("UPDATE federation_nodes SET status = 'active' WHERE node_name = ?").run(nodeA);
      dbB.db.close();

      const detail = await call(B, 'GET', `/api/communities/${community.id}`, { token: aliceOnB.token });
      assert.ok(detail.body.capabilities.includes('channel.create_wave'), 'her powers come back');
    });

    await t.test('the home node going DOWN does not revoke a remote member', async () => {
      // Phase 7, federation failure. Standing is about the PAIRING, not about
      // reachability: a network blip, a reboot or a slow host must not quietly
      // eject everyone who came from that node. Only an operator suspending or
      // unpairing it should do that, and that is a deliberate act.
      assert.ok((await call(B, 'GET', `/api/communities/${community.id}`, { token: aliceOnB.token }))
        .body.capabilities.length > 0, 'precondition: she has powers');

      const homeChild = children[0];
      homeChild.kill('SIGKILL');
      await new Promise(r => setTimeout(r, 1500));

      const stillUp = await call(B, 'GET', `/api/communities/${community.id}`, { token: aliceOnB.token });
      assert.equal(stillUp.status, 200, 'B must not fall over because A did');
      assert.ok(stillUp.body.capabilities.includes('channel.create_wave'),
        'a remote member keeps working while their node is merely unreachable');

      // And a NEW cross-port login fails cleanly rather than hanging or
      // returning something that looks like success.
      const initiate = await call(B, 'POST', '/api/cross-port/initiate', { body: { homeServerUrl: A.url } });
      assert.equal(initiate.status, 200, 'initiating still works — it only needs local state');
      const nonce = new URL(initiate.body.redirectUrl).searchParams.get('nonce');
      const started = Date.now();
      const session = await call(B, 'POST', '/api/cross-port/session', {
        body: { code: 'never-issued-because-the-home-node-is-down', state: nonce, homeServerUrl: A.url },
      });
      const elapsed = Date.now() - started;
      assert.ok(session.status >= 400, `a login against a dead node must fail, got ${session.status}`);
      assert.ok(elapsed < 20000, `it must fail promptly, took ${elapsed}ms`);
    });

    await t.test("a local member's powers are unaffected by any of this", async () => {
      // The gate must apply to borrowed standing only. Bob has no home node but
      // this one, and nothing about federation should be able to lock him out
      // of his own Community.
      const detail = await call(B, 'GET', `/api/communities/${community.id}`, { token: bob.token });
      assert.ok(detail.body.capabilities.includes('community.delete'));
    });
  } finally {
    for (const child of children) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
