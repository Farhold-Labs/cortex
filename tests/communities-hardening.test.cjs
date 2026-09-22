'use strict';

// Communities Phase 7 — hardening (v2.99.2).
//
// Fuzz, load, and backward compatibility. Nothing new is built here; the point
// is to attack what phases 1 to 6 produced and see what gives.
//
// The upgrade test earns its place. A node adopting Communities runs six
// guarded migrations against a database already full of real waves, and "it
// worked on a fresh install" proves nothing about that — a guarded CREATE TABLE
// does not gain later columns, which this codebase has been bitten by before.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Communities survives an upgrade from a database that predates it', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-upgrade-'));
  try {
    const dbPath = path.join(temp, 'farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');

    // A node with real content, the way a live one looks before upgrading.
    let db = new DatabaseSQLite({ dbPath });
    const users = ['alpha', 'beta', 'gamma'].map((handle) => db.createUser({
      id: `user-${handle}`, handle, email: `${handle}@example.test`,
      passwordHash: 'x', displayName: handle,
    }));
    const waves = [];
    for (let i = 0; i < 5; i++) {
      waves.push(db.createWave({
        title: `Wave ${i}`, createdBy: users[i % users.length].id,
        privacy: i % 2 ? 'private' : 'public',
        participants: users.map(u => u.id),
      }));
    }
    const count = (d) => ({
      users: d.db.prepare('SELECT COUNT(*) n FROM users').get().n,
      waves: d.db.prepare('SELECT COUNT(*) n FROM waves').get().n,
      participants: d.db.prepare('SELECT COUNT(*) n FROM wave_participants').get().n,
    });
    const before = count(db);

    // Strip Communities back out, leaving the database as it was before the
    // feature existed.
    const communityTables = db.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND (name LIKE 'communit%' OR name IN ('channels','channel_permissions'))`
    ).all().map(r => r.name);
    assert.ok(communityTables.length >= 12, `expected the full set, saw ${communityTables.length}`);

    db.db.pragma('foreign_keys = OFF');
    for (const name of communityTables) db.db.exec(`DROP TABLE IF EXISTS ${name}`);
    // The indexes have to go first: SQLite refuses to drop a column an index
    // still names, which is itself worth knowing — the migration creates both,
    // so both have to be undone to simulate a database that never had them.
    db.db.exec('DROP INDEX IF EXISTS idx_waves_community');
    db.db.exec('DROP INDEX IF EXISTS idx_waves_channel');
    db.db.exec('ALTER TABLE waves DROP COLUMN community_id');
    db.db.exec('ALTER TABLE waves DROP COLUMN channel_id');
    db.db.close();

    // Reopen. This is the upgrade.
    db = new DatabaseSQLite({ dbPath });

    const restored = db.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND (name LIKE 'communit%' OR name IN ('channels','channel_permissions'))`
    ).all().map(r => r.name);
    assert.equal(restored.length, communityTables.length, 'every table comes back');

    const waveCols = db.db.prepare('PRAGMA table_info(waves)').all().map(c => c.name);
    assert.ok(waveCols.includes('community_id'), 'community_id restored');
    assert.ok(waveCols.includes('channel_id'), 'channel_id restored');
    assert.ok(
      db.db.prepare('PRAGMA table_info(community_invites)').all().some(c => c.name === 'role_id'),
      'the later ALTER runs too, not only the CREATE TABLEs');

    assert.deepEqual(count(db), before, 'not one row may be lost to the upgrade');

    // Working, not merely present.
    const community = db.createCommunity({ name: 'After Upgrade', slug: 'after-upgrade', createdBy: users[0].id });
    const channel = db.createChannel({ communityId: community.id, name: 'Main', slug: 'main' });
    db.setWaveChannel(waves[0].id, channel.id);
    assert.equal(db.getWave(waves[0].id).channelId, channel.id);

    // Migrations run at every boot, so they have to be idempotent.
    db.db.close();
    db = new DatabaseSQLite({ dbPath });
    assert.equal(db.listChannels(community.id).length, 1, 'a reboot duplicates nothing');
    assert.equal(db.getWave(waves[0].id).channelId, channel.id, 'nor undoes anything');
    db.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Communities refuses malformed input rather than misbehaving', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fuzz-'));
  const password = 'HardeningTest123!';
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
    {
      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
      const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
      seed.updateInstanceConfig({ features: { communities: true } });
      seed.db.close();
    }
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('FUZZ_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-community-hardening-0',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '100000',
        RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/FUZZ_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/FUZZ_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body, raw } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(raw !== undefined
          ? { body: raw }
          : (body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {})),
      });
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    await makeUser('fuzzadmin');
    const owner = await makeUser('fuzzowner');
    const community = (await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Fuzz', slug: 'fuzz-target', visibility: 'private' },
    })).body.community;

    await t.test('type confusion is refused, never coerced', async () => {
      // A name that is an object must not become "[object Object]", and a slug
      // that is an array must not be joined into something addressable.
      const cases = [
        { name: { evil: true }, slug: 'obj-name' },
        { name: ['a', 'b'], slug: 'arr-name' },
        { name: 12345, slug: 'num-name' },
        { name: null, slug: 'null-name' },
        { name: 'ok', slug: { nested: 1 } },
        { name: 'ok', slug: ['a'] },
      ];
      for (const body of cases) {
        const res = await api('POST', '/api/communities', { token: owner.token, body });
        assert.equal(res.status, 400, `${JSON.stringify(body)} should be 400, got ${res.status}`);
      }
    });

    await t.test('a permissions list of the wrong shape confers nothing', async () => {
      // The danger is a string being iterated a character at a time, or an
      // object's keys being read as capabilities.
      for (const permissions of ['community.delete', { 0: 'community.delete' }, 42, null]) {
        const res = await api('POST', `/api/communities/${community.id}/roles`, {
          token: owner.token,
          body: { name: `r-${Math.random().toString(36).slice(2, 7)}`, permissions },
        });
        if (res.status === 201) {
          assert.deepEqual(JSON.parse(res.body.role.permissions), [],
            `permissions ${JSON.stringify(permissions)} must confer nothing`);
        } else {
          assert.ok([400, 403].includes(res.status), `unexpected ${res.status}`);
        }
      }
    });

    await t.test('a nonsense state version refuses rather than being skipped', async () => {
      // The hazard is a garbage value comparing equal to nothing and quietly
      // bypassing the check it was meant to fail.
      for (const expectedStateVersion of ['not-a-number', {}, [], -1, 999999]) {
        const res = await api('PATCH', `/api/communities/${community.id}`, {
          token: owner.token, body: { name: 'Renamed', expectedStateVersion },
        });
        assert.notEqual(res.status, 200,
          `expectedStateVersion ${JSON.stringify(expectedStateVersion)} must not pass`);
      }
      const current = (await api('GET', `/api/communities/${community.id}`, { token: owner.token }))
        .body.community.state_version;
      assert.equal((await api('PATCH', `/api/communities/${community.id}`, {
        token: owner.token, body: { name: 'Fuzz', expectedStateVersion: current },
      })).status, 200, 'and the real one still works');
    });

    await t.test('hostile strings are stored as data, not executed', async () => {
      const nasties = [
        "'; DROP TABLE communities; --",
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '../../etc/passwd',
        'Unicode Community',
      ];
      for (const name of nasties) {
        const slug = `n-${Math.random().toString(36).slice(2, 9)}`;
        const res = await api('POST', '/api/communities', { token: owner.token, body: { name, slug } });
        assert.ok([201, 400].includes(res.status), `${JSON.stringify(name)} gave ${res.status}`);
        if (res.status === 201) {
          assert.ok(!/<script|onerror=/i.test(res.body.community.name),
            `markup survived sanitisation: ${JSON.stringify(res.body.community.name)}`);
        }
      }
      // The table is still there, which is the point of the first one.
      assert.equal((await api('GET', '/api/communities/mine', { token: owner.token })).status, 200);
    });

    await t.test('a malformed body is a 4xx, not a crash', async () => {
      for (const raw of ['{not json', '', '[]', 'null', '"just a string"', '{"name":']) {
        const res = await api('POST', '/api/communities', { token: owner.token, raw });
        assert.ok(res.status >= 400 && res.status < 500, `raw ${JSON.stringify(raw)} gave ${res.status}`);
      }
      assert.equal((await api('GET', '/api/communities/mine', { token: owner.token })).status, 200,
        'and the server is still serving');
    });

    await t.test('an id belonging to another table is not a way in', async () => {
      // Opaque ids are not a control, so handlers must check ownership rather
      // than mere existence.
      const waveRes = await api('POST', '/api/waves', {
        token: owner.token, body: { title: 'Decoy', privacy: 'private' },
      });
      const waveId = (waveRes.body.wave || waveRes.body).id;
      for (const url of [
        `/api/communities/${waveId}`,
        `/api/communities/${waveId}/channels`,
        `/api/communities/${community.id}/channels/${waveId}`,
      ]) {
        const res = await api('GET', url, { token: owner.token });
        assert.ok([403, 404].includes(res.status), `${url} gave ${res.status}`);
      }
    });

    await t.test('CORTEX-COMM-010: an uploaded file cannot run in this origin', async () => {
      // Upload filters judge the mimetype the CLIENT declares, not the bytes,
      // so a file announced as an image can hold markup. Served back with a
      // type inferred from its extension, that is stored XSS in the origin
      // holding everyone's session — which would defeat every other control in
      // the application, including the ones just added.
      const uploads = path.join(serverDir, 'uploads');
      fs.mkdirSync(uploads, { recursive: true });
      fs.writeFileSync(path.join(uploads, 'evil.html'), '<script>parent.steal()</script>');
      fs.writeFileSync(path.join(uploads, 'evil.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>');
      fs.writeFileSync(path.join(uploads, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const head = async (name) => {
        const res = await fetch(`${base}/uploads/${name}`);
        return {
          status: res.status,
          type: res.headers.get('content-type') || '',
          disposition: res.headers.get('content-disposition') || '',
          nosniff: res.headers.get('x-content-type-options') || '',
          csp: res.headers.get('content-security-policy') || '',
        };
      };

      for (const name of ['evil.html', 'evil.svg']) {
        const r = await head(name);
        assert.equal(r.status, 200, `${name} is still served`);
        assert.match(r.type, /octet-stream/, `${name} must not be served as something a browser renders`);
        assert.match(r.disposition, /attachment/, `${name} must download rather than display`);
        assert.equal(r.nosniff, 'nosniff', 'and the browser must not second-guess the type');
        assert.match(r.csp, /sandbox/, 'and even then it executes nothing');
      }

      // A genuine image is untouched, or the fix has broken every avatar.
      const png = await head('ok.png');
      assert.equal(png.status, 200);
      assert.match(png.type, /image\/png/, 'real images still render');
      assert.ok(!png.disposition.includes('attachment'), 'and are not forced to download');
      assert.equal(png.nosniff, 'nosniff', 'while still refusing to be sniffed');
    });

    await t.test('listing many channels stays one request, not one per channel', async () => {
      // The listing counts waves per channel. Done naively that is a query per
      // channel, which is fine at three and not at two hundred.
      const big = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Wide', slug: 'wide-community', visibility: 'private' },
      })).body.community;
      for (let i = 0; i < 40; i++) {
        const res = await api('POST', `/api/communities/${big.id}/channels`, {
          token: owner.token, body: { name: `Channel ${i}`, slug: `ch-${i}` },
        });
        if (res.status === 429) break;   // hit the mutation budget; enough made
      }
      const started = Date.now();
      const listed = await api('GET', `/api/communities/${big.id}/channels`, { token: owner.token });
      const elapsed = Date.now() - started;
      assert.equal(listed.status, 200);
      assert.ok(listed.body.channels.length > 10, `only made ${listed.body.channels.length} channels`);
      assert.ok(elapsed < 2000, `listing ${listed.body.channels.length} channels took ${elapsed}ms`);
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
