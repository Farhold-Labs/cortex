'use strict';

// CORTEX-COMM-016 — a Community change and its audit record commit together
// (closed v2.107.2).
//
// A disposable server whose audit insert can be made to fail for chosen
// actions, by writing them to a flag file while the test runs. For each
// change: with the audit failing, the request must fail AND the change must
// not have happened; with the audit working, the same request succeeds. The
// second half is the control — it shows the first half failed because of the
// audit, not because the request was wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Community changes roll back when their audit record cannot be written', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-016-'));
  const password = 'AuditAtomic123!';
  const failFile = path.join(temp, 'fail-audit');
  const failAudit = (...actions) => fs.writeFileSync(failFile, actions.join(','));
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

    // The fault: the audit INSERT fails, as it would on a full disk, for the
    // actions named in the flag file.
    const dbFile = path.join(serverDir, 'database-sqlite.js');
    const signature = '  logCommunityAudit(communityId, { actorId = null, action, targetType = null, targetId = null, metadata = null }) {\n';
    let dbSource = fs.readFileSync(dbFile, 'utf8');
    assert.ok(dbSource.includes(signature), 'could not find logCommunityAudit to fault');
    dbSource = dbSource.replace(signature, signature +
      `    if (fs.existsSync(${JSON.stringify(failFile)}) && fs.readFileSync(${JSON.stringify(failFile)}, 'utf8').split(',').includes(action)) throw new Error('SQLITE_FULL: database or disk is full');\n`);
    fs.writeFileSync(dbFile, dbSource);

    {
      const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
      const seedDb = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
      seedDb.updateInstanceConfig({ features: { communities: true } });
      seedDb.db.close();
    }
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('API_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-audit-atomicity-0000000',
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

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      return { token: login.body.token, id: login.body.user.id };
    };

    await makeUser('nodeadmin');
    const founder = await makeUser('founder');
    const joiner = await makeUser('joiner');

    failAudit();
    const created = await api('POST', '/api/communities', { token: founder.token, body: { name: 'Atomic', slug: 'atomic', visibility: 'public' } });
    assert.equal(created.status, 201);
    const id = created.body.community.id;

    await t.test('an update does not stand without its record', async () => {
      failAudit('community.update');
      const res = await api('PATCH', `/api/communities/${id}`, { token: founder.token, body: { name: 'Renamed' } });
      assert.equal(res.status, 500);
      const after = await api('GET', `/api/communities/${id}`, { token: founder.token });
      assert.equal(after.body.community.name, 'Atomic', 'the rename was rolled back');

      failAudit();
      const ok = await api('PATCH', `/api/communities/${id}`, { token: founder.token, body: { name: 'Renamed' } });
      assert.equal(ok.status, 200, 'control: the same change succeeds when the audit can be written');
    });

    await t.test('a role is not created without its record', async () => {
      const count = async () => (await api('GET', `/api/communities/${id}/roles`, { token: founder.token })).body.roles.length;
      const before = await count();
      failAudit('role.create');
      const res = await api('POST', `/api/communities/${id}/roles`, { token: founder.token, body: { name: 'stagehand', priority: 10, permissions: [] } });
      assert.equal(res.status, 500);
      assert.equal(await count(), before, 'no role row left behind');
    });

    await t.test('a failed redemption does not spend a single-use invite or admit anyone', async () => {
      failAudit();
      const invite = await api('POST', `/api/communities/${id}/invites`, { token: founder.token, body: { maxUses: 1 } });
      assert.equal(invite.status, 201, JSON.stringify(invite.body));

      failAudit('invite.redeem');
      const res = await api('POST', '/api/communities/join', { token: joiner.token, body: { token: invite.body.invite.token } });
      assert.equal(res.status, 500);
      const member = await api('GET', `/api/communities/${id}/members`, { token: founder.token });
      assert.ok(!member.body.members.some(m => m.user_id === joiner.id || m.userId === joiner.id || m.id === joiner.id), 'not admitted');

      failAudit();
      const retry = await api('POST', '/api/communities/join', { token: joiner.token, body: { token: invite.body.invite.token } });
      assert.equal(retry.status, 200, `the single use was not spent by the failed attempt: ${JSON.stringify(retry.body)}`);
    });

    await t.test('leaving does not stand without its record', async () => {
      failAudit('member.leave');
      const res = await api('POST', `/api/communities/${id}/leave`, { token: joiner.token });
      assert.equal(res.status, 500);
      const still = await api('GET', `/api/communities/${id}`, { token: joiner.token });
      assert.ok(still.body.capabilities?.length > 0, 'still a member with their capabilities');
    });
  } finally {
    child?.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
