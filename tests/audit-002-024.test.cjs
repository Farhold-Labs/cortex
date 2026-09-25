'use strict';

// CORTEX-COMM-002 (exchange half) and CORTEX-COMM-024 (v2.105.3).
//
// 002: the cross-port code exchange validated the code against the `guestNode`
// in the request BODY — a value the caller writes — while the authenticated
// peer sat unused in `req.federationNode`. A paired but hostile peer holding a
// code issued for an honest guest could redeem it by simply naming that guest.
// The same shape as CORTEX-COMM-001: the signature said one thing, the body
// said another, and the body was believed.
//
// 024: two latent hazards with no reachable path today, which is the reason to
// close them now rather than after something reaches them.
//
//   * `resolveActor` matched remote handles with `LIKE 'handle%'`, so `alice`
//     also matched `alice_admin` — and cross-port auth manufactures exactly
//     that collision, since a remote handle clashing with a local account is
//     stored suffixed.
//   * Role grants had no same-Community check on either side, so a role from
//     one Community attached to a membership in another would have had its
//     capabilities unioned into the wrong answer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function sign({ method, pathname, host, body, privateKey, nodeName }) {
  const bodyString = JSON.stringify(body);
  const digest = `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`;
  const date = new Date().toUTCString();
  const signer = crypto.createSign('RSA-SHA256');
  signer.update([
    `(request-target): ${method.toLowerCase()} ${pathname}`,
    `host: ${host}`, `date: ${date}`, `digest: ${digest}`,
  ].join('\n'));
  return {
    headers: {
      'Content-Type': 'application/json', Date: date, Digest: digest,
      Signature: `keyId="https://${nodeName}/api/federation/identity#main-key",` +
                 `algorithm="rsa-sha256",headers="(request-target) host date digest",` +
                 `signature="${signer.sign(privateKey, 'base64')}"`,
    },
    bodyString,
  };
}

test('CORTEX-COMM-002: a code is redeemable only by the peer it was issued to', { timeout: 90000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-002-'));
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

    // Two peers this node genuinely trusts: the honest guest, and a hostile one.
    const keys = {};
    for (const node of ['honest.guest', 'hostile.peer']) {
      keys[node] = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
    }

    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath });
    seed.createUser({
      id: 'alice', handle: 'alice', email: 'alice@example.test',
      passwordHash: 'x', displayName: 'Alice',
    });
    const now = new Date().toISOString();
    for (const node of ['honest.guest', 'hostile.peer']) {
      seed.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                       VALUES (?, ?, ?, ?, 'active', ?)`)
        .run(`fed-${node}`, node, `https://${node}`, keys[node].publicKey, now);
    }
    seed.db.close();

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('X2_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-002-0000000000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'home.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/X2_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const port = output.match(/X2_PORT=(\d+)/)[1];
    const host = `127.0.0.1:${port}`;
    const EXCHANGE = '/api/federation/cross-port/exchange';

    /** A live approval code, issued for the honest guest. */
    const mintCode = () => {
      const db = new DatabaseSQLite({ dbPath });
      const code = `code-${crypto.randomUUID()}`;
      const requestId = `req-${crypto.randomUUID()}`;
      const nonce = crypto.randomUUID();
      const future = new Date(Date.now() + 60_000).toISOString();
      db.db.prepare(`INSERT INTO cross_port_requests (id, guest_node, guest_base_url, nonce, status, created_at, expires_at)
                     VALUES (?, 'honest.guest', 'https://honest.guest', ?, 'approved', ?, ?)`)
        .run(requestId, nonce, new Date().toISOString(), future);
      db.db.prepare(`INSERT INTO cross_port_codes (code, user_id, guest_node, request_id, nonce, created_at, expires_at, used)
                     VALUES (?, 'alice', 'honest.guest', ?, ?, ?, ?, 0)`)
        .run(code, requestId, nonce, new Date().toISOString(), future);
      db.db.close();
      return code;
    };

    const codeIsSpent = (code) => {
      const db = new DatabaseSQLite({ dbPath });
      const row = db.db.prepare('SELECT used FROM cross_port_codes WHERE code = ?').get(code);
      db.db.close();
      return !!(row && row.used);
    };

    const exchange = async (asNode, body) => {
      const { headers, bodyString } = sign({
        method: 'POST', pathname: EXCHANGE, host, body,
        privateKey: keys[asNode].privateKey, nodeName: asNode,
      });
      const res = await fetch(`http://${host}${EXCHANGE}`, { method: 'POST', headers, body: bodyString });
      assert.notEqual(res.status, 401, 'signature rejected — the fixture is wrong, not the server');
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };

    await t.test('the guest it was issued to redeems it normally', async () => {
      // The control, and it runs first: if this ever fails, the fix has broken
      // cross-port login rather than hardened it.
      const code = mintCode();
      const res = await exchange('honest.guest', { code, guestNode: 'honest.guest' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.handle, 'alice');
      assert.equal(res.body.userId, 'alice');
      assert.ok(codeIsSpent(code), 'a redeemed code is single-use');
    });

    await t.test('a different peer cannot redeem it by naming the honest guest', async () => {
      const code = mintCode();
      const res = await exchange('hostile.peer', { code, guestNode: 'honest.guest' });
      assert.equal(res.status, 403, 'the signature says who is asking; the body is just a claim');
      assert.equal(codeIsSpent(code), false,
        'and the refusal must not burn the code — that alone would deny the honest guest their login');

      // The honest guest's own exchange still works afterwards.
      const ok = await exchange('honest.guest', { code, guestNode: 'honest.guest' });
      assert.equal(ok.status, 200);
    });

    await t.test('a peer cannot redeem its own way in by naming itself', async () => {
      // The code was never issued to them, so claiming their real identity
      // fails too — there is no phrasing that works.
      const code = mintCode();
      const res = await exchange('hostile.peer', { code, guestNode: 'hostile.peer' });
      assert.equal(res.status, 403);
      assert.equal(codeIsSpent(code), false);
    });

    await t.test('a body that disagrees with the signature is refused', async () => {
      const code = mintCode();
      const res = await exchange('honest.guest', { code, guestNode: 'hostile.peer' });
      assert.equal(res.status, 403, 'the two must agree, so a caller that drifts fails loudly');
      assert.equal(codeIsSpent(code), false);
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CORTEX-COMM-024: identity and role scope are exact', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-024-'));
  try {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const authorize = await import('../server/lib/communities/authorize.js');

    const fresh = () => new DatabaseSQLite({ dbPath: path.join(temp, `${Math.random().toString(36).slice(2)}.db`) });
    const addRemote = (db, { id, handle, homeNode, homeUserId }) => {
      const now = new Date().toISOString();
      db.db.prepare(`INSERT INTO users (id, handle, display_name, avatar, password_hash, role,
                                        is_cross_port, home_node, home_user_id, created_at, last_seen, preferences)
                     VALUES (?, ?, ?, '?', '', 'user', 1, ?, ?, ?, ?, '{}')`)
        .run(id, handle, handle, homeNode, homeUserId, now, now);
    };

    await t.test('a handle prefix no longer resolves to a different person', async () => {
      const db = fresh();
      // The collision cross-port auth itself creates: `alice` was taken
      // locally, so their handle was suffixed.
      addRemote(db, { id: 'u-admin', handle: 'alice_admin', homeNode: 'their.node', homeUserId: 'remote-admin' });

      // An actor naming the bare handle must not land on them.
      assert.equal(
        authorize.resolveActor(db, { kind: 'federated', node: 'their.node', handle: 'alice' }),
        null,
        'resolving one person to another is the worst outcome available to this function');
      db.db.close();
    });

    await t.test('the two legitimate spellings still resolve', async () => {
      // The control. An exact match that matched nothing would break remote
      // actors entirely.
      const db = fresh();
      addRemote(db, { id: 'u-plain', handle: 'bob', homeNode: 'their.node', homeUserId: 'remote-bob' });
      addRemote(db, { id: 'u-sfx', handle: 'carol_their', homeNode: 'their.node', homeUserId: 'remote-carol' });

      assert.equal(authorize.resolveActor(db, { kind: 'federated', node: 'their.node', handle: 'bob' }), 'u-plain');
      assert.equal(authorize.resolveActor(db, { kind: 'federated', node: 'their.node', handle: 'carol' }), 'u-sfx',
        'the suffixed form is what upsertCrossPortUser stores on a collision');

      // And the stable identifier is still preferred over any handle.
      assert.equal(
        authorize.resolveActor(db, { kind: 'federated', node: 'their.node', homeUserId: 'remote-bob', handle: 'wrong' }),
        'u-plain');
      db.db.close();
    });

    await t.test('a handle from another node does not resolve', async () => {
      const db = fresh();
      addRemote(db, { id: 'u-1', handle: 'dave', homeNode: 'their.node', homeUserId: 'remote-dave' });
      assert.equal(
        authorize.resolveActor(db, { kind: 'federated', node: 'other.node', handle: 'dave' }),
        null);
      db.db.close();
    });

    await t.test('a role cannot be granted across Communities', async () => {
      const db = fresh();
      const now = new Date().toISOString();
      db.db.prepare(`INSERT INTO users (id, handle, display_name, avatar, password_hash, role, created_at, last_seen, preferences)
                     VALUES ('owner','owner','owner','?','','user',?,?,'{}')`).run(now, now);
      const a = db.createCommunity({ slug: 'alpha', name: 'Alpha', createdBy: 'owner' });
      const b = db.createCommunity({ slug: 'beta', name: 'Beta', createdBy: 'owner' });

      const membershipInB = db.getCommunityMembership(b.id, 'owner');
      const adminRoleInA = db.getCommunityRole(a.id, 'admin');

      assert.equal(db.grantCommunityRole(membershipInB.id, adminRoleInA.id, { grantedBy: 'owner' }), false,
        'the invalid state should never be stored');

      const rolesInB = db.getMemberRoles(b.id, 'owner').map(r => r.name);
      assert.ok(!rolesInB.includes('admin'),
        'a role from one Community must not appear in another Community\'s answer');
      db.db.close();
    });

    await t.test('a cross-Community row already on disk is not read back', async () => {
      // Live nodes may already hold such a row, so refusing new ones is not
      // enough on its own — the reads are defended too.
      const db = fresh();
      const now = new Date().toISOString();
      db.db.prepare(`INSERT INTO users (id, handle, display_name, avatar, password_hash, role, created_at, last_seen, preferences)
                     VALUES ('owner','owner','owner','?','','user',?,?,'{}')`).run(now, now);
      const a = db.createCommunity({ slug: 'alpha', name: 'Alpha', createdBy: 'owner' });
      const b = db.createCommunity({ slug: 'beta', name: 'Beta', createdBy: 'owner' });

      const membershipInB = db.getCommunityMembership(b.id, 'owner');
      const adminRoleInA = db.getCommunityRole(a.id, 'admin');
      // Straight past the guard, the way a bad importer would.
      db.db.prepare(`INSERT INTO community_membership_roles (membership_id, role_id, granted_by, granted_at)
                     VALUES (?, ?, 'owner', ?)`).run(membershipInB.id, adminRoleInA.id, now);

      assert.ok(!db.getMemberRoles(b.id, 'owner').map(r => r.name).includes('admin'));
      const bulk = db.getMemberRolesBulk(b.id, ['owner']).get('owner').map(r => r.name);
      assert.ok(!bulk.includes('admin'), 'the batched reader has to agree with the single one');

      // And the capability union — the answer that actually decides things.
      const caps = db.getMemberCapabilities(b.id, 'owner');
      const aAdminCaps = JSON.parse(adminRoleInA.permissions);
      const leaked = aAdminCaps.filter(c => caps.has(c) && !db.getMemberRoles(b.id, 'owner').some(r => JSON.parse(r.permissions).includes(c)));
      assert.deepEqual(leaked, [], 'no capability may arrive from another Community');
      db.db.close();
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
