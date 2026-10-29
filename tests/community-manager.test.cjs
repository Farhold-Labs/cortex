'use strict';

// The Community manager (v2.124.0): admins and moderators can finally be
// appointed from the UI, and the member list can be searched and filtered to
// staff. The rank rules are the server's (v2.94.0); these tests pin the routes
// the new manager relies on, end to end.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Community manager (v2.124.0)', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-mgr-'));
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
    const modU = await makeUser('moduser');
    const plain = await makeUser('plainuser');
    const pct = await makeUser('pct_user');
    const outsider = await makeUser('outsider');

    const created = await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Crew', slug: 'crew', visibility: 'public' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const cid = created.body.community.id;
    for (const u of [adminU, modU, plain, pct]) {
      const j = await api('POST', `/api/communities/${cid}/join`, { token: u.token });
      assert.ok(j.status < 300, JSON.stringify(j.body));
    }
    const roles = (await api('GET', `/api/communities/${cid}/roles`, { token: owner.token })).body.roles;
    const roleId = name => roles.find(r => r.name === name).id;
    const grant = (actor, target, name) =>
      api('PUT', `/api/communities/${cid}/members/${target.id}/roles/${roleId(name)}`, { token: actor.token });
    const revoke = (actor, target, name) =>
      api('DELETE', `/api/communities/${cid}/members/${target.id}/roles/${roleId(name)}`, { token: actor.token });

    await t.test('the detail tells you your own roles, and only yours', async () => {
      const mine = await api('GET', `/api/communities/${cid}`, { token: owner.token });
      assert.deepEqual(mine.body.myRoles.map(r => r.name), ['owner', 'member'].filter(n => mine.body.myRoles.some(r => r.name === n)));
      assert.equal(mine.body.myRoles[0].name, 'owner', 'highest role first');
      const theirs = await api('GET', `/api/communities/${cid}`, { token: outsider.token });
      assert.equal(theirs.status, 200, 'a public Community is readable');
      assert.deepEqual(theirs.body.myRoles, [], 'a non-member is told no roles');
    });

    await t.test('the owner appoints an admin; an admin cannot make a peer', async () => {
      assert.equal((await grant(owner, adminU, 'admin')).status, 200);
      const peer = await grant(adminU, plain, 'admin');
      assert.equal(peer.status, 403, 'an admin granting admin would mint an equal');
    });

    await t.test('an admin appoints and removes a moderator; a moderator appoints nobody', async () => {
      assert.equal((await grant(adminU, modU, 'moderator')).status, 200);
      assert.equal((await grant(modU, plain, 'moderator')).status, 403);
      assert.equal((await grant(adminU, plain, 'moderator')).status, 200);
      assert.equal((await revoke(adminU, plain, 'moderator')).status, 200);
      assert.equal((await revoke(adminU, owner, 'owner')).status, 403, 'nobody acts upward');
      assert.equal((await revoke(modU, adminU, 'admin')).status, 403);
    });

    await t.test('staff=1 lists exactly the owner, admins and moderators', async () => {
      const res = await api('GET', `/api/communities/${cid}/members?staff=1`, { token: plain.token });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.members.map(m => m.handle).sort(), ['adminuser', 'founder', 'moduser']);
      assert.equal(res.body.total, 3, 'the total counts the filtered set');
    });

    await t.test('q searches the whole membership as plain text', async () => {
      const res = await api('GET', `/api/communities/${cid}/members?q=MOD`, { token: plain.token });
      assert.deepEqual(res.body.members.map(m => m.handle), ['moduser']);
      assert.equal(res.body.total, 1);
      // A typed % or _ is a character, not a LIKE wildcard.
      const pctRes = await api('GET', `/api/communities/${cid}/members?q=${encodeURIComponent('_')}`, { token: plain.token });
      assert.deepEqual(pctRes.body.members.map(m => m.handle), ['pct_user']);
      const wild = await api('GET', `/api/communities/${cid}/members?q=${encodeURIComponent('%')}`, { token: plain.token });
      assert.equal(wild.body.members.length, 0);
      const none = await api('GET', `/api/communities/${cid}/members?q=zzz`, { token: plain.token });
      assert.equal(none.body.total, 0);
      // Non-members still cannot list a Community's members at all.
      const out = await api('GET', `/api/communities/${cid}/members?q=mod`, { token: outsider.token });
      assert.equal(out.status, 403);
    });

    await t.test("a role change reaches the person's open app", async () => {
      const { createRequire } = require('node:module');
      const WebSocket = createRequire(path.join(root, 'server/package.json'))('ws');
      const ws = new WebSocket(base.replace('http:', 'ws:'));
      try {
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        const seen = [];
        ws.on('message', bytes => { try { seen.push(JSON.parse(bytes)); } catch { /* not JSON */ } });
        ws.send(JSON.stringify({ type: 'auth', token: plain.token }));
        const until = async (pred, ms = 3000) => {
          const end = Date.now() + ms;
          while (Date.now() < end) { if (seen.some(pred)) return true; await new Promise(r => setTimeout(r, 25)); }
          return false;
        };
        assert.ok(await until(m => m.type === 'auth_success'), 'authenticated');
        assert.equal((await grant(adminU, plain, 'moderator')).status, 200);
        assert.ok(await until(m => m.type === 'community_roles_changed' && m.communityId === cid), 'granted: pushed');
        seen.length = 0;
        assert.equal((await revoke(adminU, plain, 'moderator')).status, 200);
        assert.ok(await until(m => m.type === 'community_roles_changed' && m.communityId === cid), 'revoked: pushed');
      } finally { ws.terminate(); }
    });

    await t.test('logos (v2.125.0): managers set and remove them; the old file goes', async () => {
      const { createRequire } = require('node:module');
      const sharp = createRequire(path.join(root, 'server/package.json'))('sharp');
      const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffd23f' } }).png().toBuffer();
      const upload = (actor, buf = png, type = 'image/png') => {
        const form = new FormData();
        form.append('logo', new Blob([buf], { type }), 'logo.png');
        return fetch(`${base}/api/communities/${cid}/logo`, {
          method: 'POST', headers: { Authorization: `Bearer ${actor.token}` }, body: form,
        }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
      };
      // Only community.manage: a moderator and an outsider are refused.
      assert.equal((await upload(modU)).status, 403);
      assert.equal((await upload(outsider)).status, 403);
      assert.equal((await upload(owner, Buffer.from('<svg/>'), 'image/svg+xml')).status, 400, 'not an allowed type');

      const first = await upload(adminU);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const url1 = first.body.community.logo_url;
      assert.match(url1, /\/uploads\/community-logos\/[a-f0-9-]{36}-\d{13}-[a-f0-9]{8}\.webp$/);
      const file1 = path.join(serverDir, 'uploads', 'community-logos', path.basename(url1));
      assert.ok(fs.existsSync(file1), 'stored');
      const meta = await sharp(fs.readFileSync(file1)).metadata();
      assert.equal(meta.width, 256); assert.equal(meta.height, 256); assert.equal(meta.format, 'webp');

      // Members see it in the Community they belong to.
      const mine = await api('GET', '/api/communities/mine', { token: plain.token });
      assert.equal(mine.body.communities.find(c => c.id === cid).logo_url, url1);
      const served = await fetch(base + url1);
      assert.equal(served.status, 200);

      const second = await upload(owner);
      assert.equal(second.status, 200);
      assert.notEqual(second.body.community.logo_url, url1);
      assert.ok(!fs.existsSync(file1), 'the replaced logo is deleted');

      assert.equal((await api('DELETE', `/api/communities/${cid}/logo`, { token: modU.token })).status, 403);
      const removed = await api('DELETE', `/api/communities/${cid}/logo`, { token: owner.token });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.community.logo_url, null);
      assert.ok(!fs.existsSync(path.join(serverDir, 'uploads', 'community-logos', path.basename(second.body.community.logo_url))));
    });

    await t.test('the manager wires every control to the routes that enforce it', async () => {
      const ui = fs.readFileSync(path.join(root, 'client/src/components/communities/CommunitySettingsPanel.jsx'), 'utf8');
      for (const route of [
        '/members/${m.userId}/roles/${target.id}`, { method: \'PUT\' }',
        '/members/${m.userId}`, { method: \'DELETE\' }',
        '/bans`',
        '/leave`',
        '/communities/${community.id}`, { method: \'PATCH\'',
        'members?staff=1',
      ]) assert.ok(ui.includes(route), `manager calls ${route}`);
      // One section open at a time, the Settings accordion.
      assert.match(ui, /isOpen: open === key, onToggle: \(\) => toggle\(key\)/);
    });

  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
