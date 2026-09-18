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
          RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000',
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
