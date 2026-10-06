'use strict';

// CORTEX-COMM-021 — handing a Community over (v2.107.2).
//
// Before this, an owner could not transfer at all: the capability existed and
// nothing consumed it, granting the owner role is refused at your own priority,
// and the last owner may not leave. The only exit was deleting their account.
// The model under test: an owner OFFERS (with step-up), the recipient ACCEPTS,
// and the swap — recipient becomes owner, giver steps down to admin — is atomic.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Community ownership transfer', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-021-'));
  const password = 'Transfer123!';
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
    {
      const seed = new DatabaseSQLite({ dbPath });
      seed.updateInstanceConfig({ features: { communities: true } });
      seed.db.close();
    }
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('API_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-ownership-transfer-000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
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
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}),
        },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed for ${handle}`);
      const stepUp = (await api('POST', '/api/auth/step-up', { token: login.body.token, body: { password } })).body?.stepUpToken;
      assert.ok(stepUp, 'step-up fixture');
      return { token: login.body.token, id: login.body.user.id, stepUp };
    };
    const roleNames = async (id, user, viewer) =>
      (await api('GET', `/api/communities/${id}/members`, { token: viewer.token })).body.members
        .find(m => (m.userId || m.user_id || m.id) === user.id)?.roles?.map(r => r.name || r).sort() || [];

    await makeUser('nodeadmin');
    const founder = await makeUser('founder');
    const heir = await makeUser('heir');
    const staffer = await makeUser('staffer');
    const stranger = await makeUser('stranger');

    const c = (await api('POST', '/api/communities', { token: founder.token, body: { name: 'Hand Me Down', slug: 'handmedown', visibility: 'public' } })).body.community;
    for (const u of [heir, staffer]) {
      assert.equal((await api('POST', `/api/communities/${c.id}/members`, { token: founder.token, body: { userId: u.id } })).status, 201);
    }
    const adminRole = (await api('GET', `/api/communities/${c.id}/roles`, { token: founder.token })).body.roles.find(r => r.name === 'admin');
    assert.equal((await api('PUT', `/api/communities/${c.id}/members/${staffer.id}/roles/${adminRole.id}`, { token: founder.token })).status, 200);

    await t.test('before: the only owner cannot leave', async () => {
      const res = await api('POST', `/api/communities/${c.id}/leave`, { token: founder.token });
      assert.equal(res.status, 409);
    });

    await t.test('offering requires step-up re-authentication', async () => {
      const res = await api('POST', `/api/communities/${c.id}/transfer`, { token: founder.token, body: { toUserId: heir.id } });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'STEP_UP_REQUIRED');
    });

    await t.test('an admin cannot give away what they do not own', async () => {
      const res = await api('POST', `/api/communities/${c.id}/transfer`, { token: staffer.token, stepUp: staffer.stepUp, body: { toUserId: heir.id } });
      assert.equal(res.status, 403);
    });

    await t.test('not to themselves, and not to a non-member', async () => {
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer`, { token: founder.token, stepUp: founder.stepUp, body: { toUserId: founder.id } })).status, 400);
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer`, { token: founder.token, stepUp: founder.stepUp, body: { toUserId: stranger.id } })).status, 404);
    });

    let offer;
    await t.test('an offer is made, shown to the recipient, and nothing changes yet', async () => {
      const res = await api('POST', `/api/communities/${c.id}/transfer`, { token: founder.token, stepUp: founder.stepUp, body: { toUserId: heir.id } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      offer = res.body.transfer;
      assert.equal(offer.state, 'pending');
      const mine = (await api('GET', '/api/communities/ownership-offers', { token: heir.token })).body.offers;
      assert.equal(mine.length, 1);
      assert.equal(mine[0].communityName, 'Hand Me Down');
      assert.deepEqual(await roleNames(c.id, heir, founder), ['member'], 'an offer confers nothing');
      assert.ok(!(await api('GET', `/api/communities/${c.id}/transfer`, { token: stranger.token })).body.transfer, 'outsiders do not see it');
    });

    await t.test('one offer at a time', async () => {
      const res = await api('POST', `/api/communities/${c.id}/transfer`, { token: founder.token, stepUp: founder.stepUp, body: { toUserId: staffer.id } });
      assert.equal(res.status, 409);
    });

    await t.test('only the recipient can accept it', async () => {
      for (const u of [staffer, stranger, founder]) {
        assert.equal((await api('POST', `/api/communities/${c.id}/transfer/${offer.id}/accept`, { token: u.token })).status, 404);
      }
    });

    await t.test('accepting swaps the roles atomically, and the giver can then leave', async () => {
      const res = await api('POST', `/api/communities/${c.id}/transfer/${offer.id}/accept`, { token: heir.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok((await roleNames(c.id, heir, heir)).includes('owner'), 'recipient owns it');
      const giver = await roleNames(c.id, founder, heir);
      assert.ok(!giver.includes('owner'), 'giver is no longer an owner');
      assert.ok(giver.includes('admin'), 'giver stays on as admin');
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer/${offer.id}/accept`, { token: heir.token })).status, 409, 'cannot be accepted twice');
      assert.equal((await api('POST', `/api/communities/${c.id}/leave`, { token: founder.token })).status, 200, 'the old owner is no longer stuck');
    });

    await t.test('decline and cancel close an offer without a handover', async () => {
      const make = async () => (await api('POST', `/api/communities/${c.id}/transfer`, { token: heir.token, stepUp: heir.stepUp, body: { toUserId: staffer.id } })).body.transfer;
      const a = await make();
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer/${a.id}/decline`, { token: staffer.token })).status, 200);
      const b = await make();
      assert.equal((await api('DELETE', `/api/communities/${c.id}/transfer/${b.id}`, { token: heir.token })).status, 200);
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer/${b.id}/accept`, { token: staffer.token })).status, 409, 'a withdrawn offer cannot be accepted');
      assert.ok(!(await roleNames(c.id, staffer, heir)).includes('owner'));
    });

    await t.test('an expired offer cannot be accepted', async () => {
      const o = (await api('POST', `/api/communities/${c.id}/transfer`, { token: heir.token, stepUp: heir.stepUp, body: { toUserId: staffer.id } })).body.transfer;
      const db = new DatabaseSQLite({ dbPath });
      db.db.prepare('UPDATE community_ownership_transfers SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), o.id);
      db.db.close();
      assert.equal((await api('POST', `/api/communities/${c.id}/transfer/${o.id}/accept`, { token: staffer.token })).status, 409);
      assert.ok(!(await roleNames(c.id, staffer, heir)).includes('owner'));
      assert.equal((await api('GET', '/api/communities/ownership-offers', { token: staffer.token })).body.offers.length, 0);
    });

    await t.test('every step is in the audit log', async () => {
      const log = (await api('GET', `/api/communities/${c.id}/audit`, { token: heir.token })).body;
      const actions = (log.entries || log.audit || log).map(e => e.action);
      for (const a of ['ownership.offer', 'ownership.accept', 'ownership.decline', 'ownership.cancel']) {
        assert.ok(actions.includes(a), `${a} recorded`);
      }
    });
  } finally {
    child?.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
