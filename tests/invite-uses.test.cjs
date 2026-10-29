'use strict';

// Shared account invitations (v2.123.0).
//
// An admin invited a whole crew on one 7-day link and the first person to sign
// up used it: account invitations were single-use. Now an invitation can be
// shared by up to 100 people. A shared link makes only user accounts and is not
// tied to an email address, and taking a use happens in the same transaction
// that creates the account, so nobody gets an account once the uses are gone.
// That last point has a counterfactual: with the guard stripped from a copy of
// database-sqlite.js, a fourth person gets in on a three-use link.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

// A copy of the server directory, so a test can edit its source.
function copyServer(temp, edit) {
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
  if (edit) edit(serverDir);
  return serverDir;
}

async function openDb(serverDir) {
  const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
  return new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
}

const future = (ms = 3600_000) => new Date(Date.now() + ms).toISOString();
const person = (n) => ({
  id: `user-${n}`, handle: `crew${n}`, email: `crew${n}@example.test`,
  passwordHash: 'x', displayName: `Crew ${n}`, avatar: 'C', nodeName: 'Local', status: 'online',
});

/** Three-use invitation, then four people try it. Returns who got an account. */
async function fourPeopleOnThreeUses(serverDir) {
  const db = await openDb(serverDir);
  db.createUser(person('admin'));
  db.createInvitation({ id: 'inv-crew', tokenHash: 'h1', createdBy: 'user-admin', expiresAt: future(), maxUses: 3 });
  const results = [1, 2, 3, 4].map(n => db.createUserWithInvitation('inv-crew', person(n)));
  const accounts = db.db.prepare(`SELECT handle FROM users WHERE handle LIKE 'crew_' ORDER BY handle`).all().map(r => r.handle);
  return { db, results, accounts };
}

test('a shared invitation admits as many people as it has uses, and no more', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-uses-'));
  try {
    const { db, results, accounts } = await fourPeopleOnThreeUses(copyServer(temp));
    assert.deepEqual(results.map(u => u?.handle ?? null), ['crew1', 'crew2', 'crew3', null]);
    assert.deepEqual(accounts, ['crew1', 'crew2', 'crew3'], 'the fourth person has no account');

    const inv = db.listInvitations().find(i => i.id === 'inv-crew');
    assert.equal(inv.useCount, 3);
    assert.equal(inv.maxUses, 3);
    assert.equal(inv.status, 'used');
    assert.deepEqual(inv.usedByHandles, ['crew1', 'crew2', 'crew3']);
    assert.equal(inv.usedBy, 'user-1', 'used_by keeps the first taker');
    assert.equal(db.revokeInvitation('inv-crew'), false, 'nothing left to revoke');

    // A partly used invitation can be revoked, which stops the rest.
    db.createInvitation({ id: 'inv-half', tokenHash: 'h2', createdBy: 'user-admin', expiresAt: future(), maxUses: 5 });
    assert.ok(db.createUserWithInvitation('inv-half', person(5)));
    assert.equal(db.revokeInvitation('inv-half'), true);
    assert.equal(db.createUserWithInvitation('inv-half', person(6)), null);
    assert.equal(db.getInvitationById('inv-half').status, 'revoked');

    // An expired one admits nobody, even with uses left.
    db.createInvitation({ id: 'inv-old', tokenHash: 'h3', createdBy: 'user-admin', expiresAt: new Date(Date.now() - 1000).toISOString(), maxUses: 5 });
    assert.equal(db.createUserWithInvitation('inv-old', person(7)), null);

    // A failed account creation spends no use.
    db.createInvitation({ id: 'inv-one', tokenHash: 'h4', createdBy: 'user-admin', expiresAt: future() });
    assert.throws(() => db.createUserWithInvitation('inv-one', person(1)), 'crew1 already exists');
    assert.equal(db.getInvitationById('inv-one').useCount, 0);
    assert.equal(db.getInvitationById('inv-one').status, 'pending');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: without the use guard, a fourth person gets in', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-uses-cf-'));
  try {
    const serverDir = copyServer(temp, (dir) => {
      const file = path.join(dir, 'database-sqlite.js');
      const src = fs.readFileSync(file, 'utf8');
      const guard = 'WHERE id = ? AND revoked_at IS NULL AND use_count < max_uses AND expires_at > ?';
      assert.ok(src.includes(guard), 'the guard is where the test expects it');
      fs.writeFileSync(file, src.replace(guard, 'WHERE id = ? AND revoked_at IS NULL AND expires_at > ?'));
    });
    const { accounts } = await fourPeopleOnThreeUses(serverDir);
    assert.deepEqual(accounts, ['crew1', 'crew2', 'crew3', 'crew4']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('existing invitations stay single-use through the migration', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-migrate-'));
  try {
    const serverDir = copyServer(temp);
    let db = await openDb(serverDir);
    db.createUser(person('admin'));
    db.createUser(person(1));
    // Put the table back the way v2.67.0–v2.122 had it, with one used and one fresh invitation.
    db.db.exec(`
      DROP TABLE user_invitation_uses;
      DROP TABLE user_invitations;
      CREATE TABLE user_invitations (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, email TEXT,
        role TEXT NOT NULL DEFAULT 'user', note TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
        used_by TEXT REFERENCES users(id) ON DELETE SET NULL, revoked_at TEXT
      );
    `);
    const now = new Date().toISOString();
    db.db.prepare(`INSERT INTO user_invitations (id, token_hash, created_by, created_at, expires_at, used_at, used_by)
      VALUES ('inv-used', 'a', 'user-admin', ?, ?, ?, 'user-1')`).run(now, future(), now);
    db.db.prepare(`INSERT INTO user_invitations (id, token_hash, created_by, created_at, expires_at)
      VALUES ('inv-fresh', 'b', 'user-admin', ?, ?)`).run(now, future());
    db.db.close();

    db = await openDb(serverDir);
    const used = db.listInvitations().find(i => i.id === 'inv-used');
    assert.equal(used.status, 'used');
    assert.equal(used.maxUses, 1);
    assert.equal(used.useCount, 1);
    assert.deepEqual(used.usedByHandles, ['crew1'], 'the old taker is listed');
    assert.equal(db.createUserWithInvitation('inv-used', person(2)), null);

    const fresh = db.getInvitationById('inv-fresh');
    assert.equal(fresh.maxUses, 1);
    assert.ok(db.createUserWithInvitation('inv-fresh', person(3)));
    assert.equal(db.createUserWithInvitation('inv-fresh', person(4)), null, 'still single-use');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('shared invitations through a real server', { timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-e2e-'));
  const password = 'Invites123!xyz';
  let child;
  try {
    const serverDir = copyServer(temp);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('INVITE_TEST_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-shared-invites-0000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/INVITE_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/INVITE_TEST_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const register = (handle, inviteToken) => api('POST', '/api/auth/register', {
      body: { handle, email: `${handle}@example.test`, password, displayName: handle, inviteToken },
    });

    const first = await register('nodeadmin');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const admin = first.body.token;

    // The rules on what may be shared.
    for (const [body, why] of [
      [{ maxUses: 0 }, 'zero uses'],
      [{ maxUses: 101 }, 'over the cap'],
      [{ maxUses: 2.5 }, 'not whole'],
      [{ maxUses: 'lots' }, 'not a number'],
      [{ maxUses: 5, role: 'moderator' }, 'shared moderator link'],
      [{ maxUses: 5, email: 'one@example.test' }, 'shared email invitation'],
    ]) {
      const res = await api('POST', '/api/admin/invites', { token: admin, body });
      assert.equal(res.status, 400, `${why}: ${JSON.stringify(res.body)}`);
    }

    // The crew link: three uses.
    const made = await api('POST', '/api/admin/invites', { token: admin, body: { maxUses: 3, expiresInDays: 7, note: 'stage crew' } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.invitation.maxUses, 3);
    const token = made.body.token;

    for (const handle of ['crewone', 'crewtwo', 'crewthree']) {
      assert.equal((await api('GET', `/api/invites/${token}`)).status, 200, `${handle} sees a valid link`);
      const res = await register(handle, token);
      assert.equal(res.status, 201, `${handle}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.user.role ?? 'user', 'user');
    }
    assert.equal((await api('GET', `/api/invites/${token}`)).status, 404, 'used up');
    const late = await register('crewfour', token);
    assert.equal(late.status, 400);
    const login = await api('POST', '/api/auth/login', { body: { handle: 'crewfour', password } });
    assert.notEqual(login.status, 200, 'no account for the fourth person');

    const listed = (await api('GET', '/api/admin/invites', { token: admin })).body.invitations.find(i => i.id === made.body.invitation.id);
    assert.equal(listed.useCount, 3);
    assert.equal(listed.status, 'used');
    assert.deepEqual(listed.usedByHandles, ['crewone', 'crewtwo', 'crewthree']);

    // A plain invitation is still single-use.
    const single = await api('POST', '/api/admin/invites', { token: admin, body: {} });
    assert.equal(single.body.invitation.maxUses, 1);
    assert.equal((await register('soloone', single.body.token)).status, 201);
    assert.equal((await register('solotwo', single.body.token)).status, 400);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
