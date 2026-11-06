'use strict';

// The Community roles editor (v2.139.0). Custom roles existed on the server
// since v2.96.0 with no way to make them in the app. These tests pin what the
// editor relies on: names unique whatever their case, refused input refused
// rather than dropped, usage counts only for role managers, a role's holders,
// and the edit rule (only what changes has to be yours).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Community roles editor (v2.139.0)', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-roles-'));
  const password = 'CommunityMgr123!';
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
// Communities is an OPT-IN instance feature from v2.99.0, so a fresh database
// has it switched off and every route below would answer 403. The feature is
// enabled here BEFORE the server boots — the same shape as the federation test
// seeding its pairing — so that these tests exercise the feature rather than
// the gate. The gate has its own test.
    {
      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
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
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-communities-api-0000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    if (process.env.DEBUG_SERVER) { child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr); }

    const deadline = Date.now() + 25000;
    while (!/API_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/API_TEST_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty body */ }
      return { status: res.status, body: json };
    };

    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('founder');
    const adminU = await makeUser('adminuser');
    const plain = await makeUser('plainuser');
    const other = await makeUser('otherfounder');

    const created = await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Players', slug: 'players', visibility: 'public' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const cid = created.body.community.id;
    for (const u of [adminU, plain]) {
      const j = await api('POST', `/api/communities/${cid}/join`, { token: u.token });
      assert.ok(j.status < 300, JSON.stringify(j.body));
    }
    const rolesOf = async (u) => (await api('GET', `/api/communities/${cid}/roles`, { token: u.token })).body.roles;
    const builtIn = await rolesOf(owner);
    const idOf = name => builtIn.find(r => r.name === name).id;
    assert.equal((await api('PUT', `/api/communities/${cid}/members/${adminU.id}/roles/${idOf('admin')}`, { token: owner.token })).status, 200);
    const newRole = (u, body) => api('POST', `/api/communities/${cid}/roles`, { token: u.token, body });

    let cast;
    await t.test('a role is made with no powers, and names are unique whatever their case', async () => {
      const made = await newRole(owner, { name: 'Cast' });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      cast = made.body.role;
      assert.equal(cast.priority, 100);
      assert.deepEqual(JSON.parse(cast.permissions), []);
      for (const name of ['cast', 'CAST ', 'Admin', 'owner']) {
        const dup = await newRole(owner, { name });
        assert.equal(dup.status, 409, `${name}: ${JSON.stringify(dup.body)}`);
        assert.equal(dup.body.code, 'ROLE_NAME_TAKEN');
      }
      const crew = (await newRole(owner, { name: 'Crew' })).body.role;
      const rename = await api('PATCH', `/api/communities/${cid}/roles/${crew.id}`, { token: owner.token, body: { name: 'moderator' } });
      assert.equal(rename.status, 409, 'renaming onto a built-in is refused too');
      const same = await api('PATCH', `/api/communities/${cid}/roles/${crew.id}`, { token: owner.token, body: { name: 'crew' } });
      assert.equal(same.status, 200, 'a role may change the case of its own name');
      assert.equal((await api('DELETE', `/api/communities/${cid}/roles/${crew.id}`, { token: owner.token })).status, 200);
    });

    await t.test('input it cannot use is refused, not dropped', async () => {
      assert.equal((await newRole(owner, { name: 'Odd', permissions: ['member.view', 'made.up'] })).status, 400);
      assert.equal((await newRole(owner, { name: 'Odd', permissions: 'member.view' })).status, 400);
      assert.equal((await newRole(owner, { name: 'Odd', priority: '150' })).status, 400);
      assert.equal((await rolesOf(owner)).some(r => r.name === 'Odd'), false);
    });

    await t.test('an admin makes roles below their own rank holding only their own powers', async () => {
      const stage = await newRole(adminU, { name: 'Stage crew', priority: 250, permissions: ['voice.moderate'] });
      assert.equal(stage.status, 201, JSON.stringify(stage.body));
      assert.equal((await newRole(adminU, { name: 'Peer', priority: 300 })).status, 403);
      assert.equal((await newRole(adminU, { name: 'Closer', priority: 150, permissions: ['community.delete'] })).status, 403);
      assert.equal((await newRole(plain, { name: 'Mine' })).status, 403, 'a member makes no roles');
    });

    await t.test('only what changes has to be yours', async () => {
      // The owner gives a role something admins lack.
      const board = (await newRole(owner, { name: 'Board', priority: 150, permissions: ['community.transfer'] })).body.role;
      const patch = (body) => api('PATCH', `/api/communities/${cid}/roles/${board.id}`, { token: adminU.token, body });
      assert.equal((await patch({ permissions: ['community.transfer', 'member.invite'] })).status, 200,
        'adding a power the admin holds, keeping one they lack');
      const after = (await rolesOf(owner)).find(r => r.id === board.id);
      assert.deepEqual(JSON.parse(after.permissions).sort(), ['community.transfer', 'member.invite']);
      assert.equal((await patch({ permissions: ['member.invite'] })).status, 403, 'taking away a power they lack');
      assert.equal((await patch({ permissions: ['community.transfer', 'member.invite', 'community.delete'] })).status, 403,
        'adding a power they lack');
      assert.equal((await patch({ name: 'The board' })).status, 200, 'renaming touches no power');
      assert.equal((await patch({ priority: 300 })).status, 403, 'raising it to their own rank');
      // The Board role is not the admin's to hand out: it holds a power they lack.
      const give = await api('PUT', `/api/communities/${cid}/members/${plain.id}/roles/${board.id}`, { token: adminU.token });
      assert.equal(give.status, 403);
    });

    let channel, wave;
    await t.test('holders, and what a role is used for', async () => {
      assert.equal((await api('PUT', `/api/communities/${cid}/members/${plain.id}/roles/${cast.id}`, { token: owner.token })).status, 200);
      channel = (await api('POST', `/api/communities/${cid}/channels`, { token: owner.token, body: { name: 'Rehearsals', slug: 'rehearsals' } })).body.channel;
      const rule = await api('PUT', `/api/communities/${cid}/channels/${channel.id}/roles/${cast.id}`, {
        token: owner.token, body: { allow: ['channel.view'], deny: [] },
      });
      assert.equal(rule.status < 300, true, JSON.stringify(rule.body));
      wave = (await api('POST', '/api/waves', { token: owner.token, body: { title: 'Notes', privacy: 'public', channelId: channel.id } })).body;
      const narrowed = await api('PUT', `/api/waves/${wave.id}/audience`, { token: owner.token, body: { mode: 'only', roleIds: [cast.id] } });
      assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body));

      const seen = (await rolesOf(owner)).find(r => r.id === cast.id);
      assert.equal(seen.holders, 1);
      assert.equal(seen.channels, 1);
      assert.equal(seen.waves, 1);
      const asMember = (await rolesOf(plain)).find(r => r.id === cast.id);
      assert.equal(asMember.holders, 1, 'a member sees how many hold it');
      assert.equal('waves' in asMember, false, 'but not how many narrowed waves exist');
      assert.equal('channels' in asMember, false);

      const holders = await api('GET', `/api/communities/${cid}/members?role=${cast.id}`, { token: owner.token });
      assert.deepEqual(holders.body.members.map(m => m.handle), ['plainuser']);
      assert.equal(holders.body.total, 1);

      // Another Community's role names nobody here.
      const theirs = (await api('POST', '/api/communities', { token: other.token, body: { name: 'Elsewhere', slug: 'elsewhere', visibility: 'public' } })).body.community;
      const theirRole = (await api('POST', `/api/communities/${theirs.id}/roles`, { token: other.token, body: { name: 'Cast' } })).body.role;
      assert.ok(theirRole, 'the same name is free in another Community');
      const cross = await api('GET', `/api/communities/${cid}/members?role=${theirRole.id}`, { token: owner.token });
      assert.deepEqual(cross.body.members, []);
    });

    await t.test('deleting a role takes its grants, channel rules and wave audience with it', async () => {
      assert.equal((await api('DELETE', `/api/communities/${cid}/roles/${cast.id}`, { token: owner.token })).status, 200);
      const Database = require(path.join(root, 'server/node_modules/better-sqlite3'));
      const conn = new Database(path.join(temp, 'server/data/farhold.db'), { readonly: true });
      try {
        const left = (sql) => conn.prepare(sql).get(cast.id).c;
        assert.equal(left('SELECT COUNT(*) AS c FROM community_membership_roles WHERE role_id = ?'), 0);
        assert.equal(left('SELECT COUNT(*) AS c FROM channel_permissions WHERE role_id = ?'), 0);
        assert.equal(left("SELECT COUNT(*) AS c FROM wave_audience WHERE kind = 'role' AND ref_id = ?"), 0);
      } finally { conn.close(); }
      const builtInDelete = await api('DELETE', `/api/communities/${cid}/roles/${idOf('moderator')}`, { token: owner.token });
      assert.equal(builtInDelete.status, 403, 'built-in roles stay');
    });
  } finally {
    if (child && child.exitCode === null) child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
